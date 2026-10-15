#!/usr/bin/env python3
"""Serialized blue/green releases with a durable transaction and fail-back."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).parent))
from smoke import check  # noqa: E402


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix('.new')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Releases:
    def __init__(self, root=Path('/var/lib/geometrydash-ui'), config=None):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.config = config or json.loads(Path('/etc/geometrydash-ui/config.json').read_text())
        self.state_path = root / 'state.json'
        self.pending_path = root / 'pending.json'

    def state(self):
        return json.loads(self.state_path.read_text()) if self.state_path.exists() else {'current': None, 'previous': None}

    def event(self, event, **fields):
        line = json.dumps({'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'event': event, **fields})
        print(line, flush=True)
        with Path('/var/log/geometrydash-ui/releases.jsonl').open('a') as stream:
            stream.write(line + '\n')

    def validate(self, image, revision):
        pattern = re.escape(self.config['image_repository']) + r'@sha256:[a-f0-9]{64}'
        if not re.fullmatch(pattern, image) or not re.fullmatch(r'[a-f0-9]{40}', revision):
            raise ValueError('Require a digest in the configured production repository and a full commit SHA')

    def pull(self, image):
        # Short-lived metadata credentials; do not persist tokens in /root/.docker.
        request = urllib.request.Request(
            'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
            headers={'Metadata-Flavor': 'Google'})
        with urllib.request.urlopen(request, timeout=15) as response:
            token = json.load(response)['access_token']
        with tempfile.TemporaryDirectory() as directory:
            registry = self.config['image_repository'].split('/')[0]
            run('docker', '--config', directory, 'login', '-u', 'oauth2accesstoken', '--password-stdin', registry,
                input=token, stdout=subprocess.DEVNULL)
            run('docker', '--config', directory, 'pull', image)

    def prepare(self, release):
        image, revision, port = release['image'], release['revision'], release['port']
        self.validate(image, revision)
        if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode:
            self.pull(image)
        info = json.loads(run('docker', 'image', 'inspect', image, capture_output=True).stdout)[0]
        if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != revision:
            raise ValueError('Container label does not match requested commit')
        name = f'geometrydash-ui-{port}'
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        run('docker', 'run', '-d', '--name', name, '--restart', 'unless-stopped',
            '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '192m', '--cpus', '0.75',
            '--pids-limit', '100', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
            '-p', f'127.0.0.1:{port}:8080', image)
        last_error = None
        for _ in range(15):
            try:
                check(f'http://127.0.0.1:{port}', revision)
                last_error = None
                break
            except Exception as error:
                last_error = error
                time.sleep(2)
        if last_error:
            raise RuntimeError('Candidate did not become healthy') from last_error
        self.retain_assets(name)

    def retain_assets(self, name):
        destination = self.root / 'public' / 'assets'
        destination.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as directory:
            run('docker', 'cp', f'{name}:/usr/share/nginx/html/assets/.', directory)
            for source in Path(directory).rglob('*'):
                if source.is_symlink():
                    raise ValueError('Unexpected asset symlink')
                if not source.is_file():
                    continue
                target = destination / source.relative_to(directory)
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
                        raise ValueError(f'Immutable asset collision: {target.name}')
                else:
                    # Atomic publication; never truncate a file an old tab is requesting.
                    temporary = target.with_suffix(target.suffix + '.new')
                    shutil.copyfile(source, temporary)
                    temporary.chmod(0o644)
                    os.replace(temporary, target)

    def switch(self, release):
        port = release['port'] if release else 8099  # Closed maintenance upstream before first release.
        path = Path('/etc/nginx/conf.d/geometrydash-ui-upstream.conf')
        old = path.read_text() if path.exists() else None
        temporary = path.with_suffix('.new')
        temporary.write_text(f'upstream geometrydash_ui_backend {{ server 127.0.0.1:{port}; }}\n')
        os.replace(temporary, path)
        try:
            run('nginx', '-t')
            if subprocess.run(['systemctl', 'is-active', '--quiet', 'nginx']).returncode == 0:
                run('systemctl', 'reload', 'nginx')
        except Exception:
            if old is not None:
                temporary.write_text(old)
                os.replace(temporary, path)
            raise

    def public_check(self, release):
        # Includes TLS validation and the real public route, never curl --insecure.
        for attempt in range(5):
            try:
                check('https://' + self.config['domain'], release['revision'])
                return
            except Exception:
                if attempt == 4:
                    raise
                # nginx reload is asynchronous; allow its new workers to start.
                time.sleep(1)

    def tls(self):
        cert = Path('/etc/letsencrypt/live') / self.config['domain'] / 'fullchain.pem'
        if not cert.exists():
            run('certbot', 'certonly', '--non-interactive', '--agree-tos', '--webroot',
                '-w', '/var/www/acme', '-d', self.config['domain'], '-m', self.config['acme_email'])
        run('/usr/local/lib/geometrydash-ui/configure-web.py')
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')

    def recover(self):
        # SIGKILL/power loss cannot run a trap. Revert an uncommitted transaction on boot/next command.
        pending = json.loads(self.pending_path.read_text()) if self.pending_path.exists() else None
        state = pending['before'] if pending else self.state()
        if state['current']:
            self.prepare(state['current'])
        self.switch(state['current'])
        atomic_json(self.state_path, state)
        self.pending_path.unlink(missing_ok=True)
        self.event('recovered', revision=(state['current'] or {}).get('revision'))

    def deploy(self, image, revision):
        self.validate(image, revision)
        if self.pending_path.exists():
            self.recover()
        before = self.state()
        if before['current'] and before['current']['image'] == image:
            if before['current']['revision'] != revision:
                raise ValueError('The current digest is already associated with another revision')
            self.public_check(before['current'])
            self.event('already_current', image=image, revision=revision)
            return
        port = 8082 if before['current'] and before['current']['port'] == 8081 else 8081
        candidate = {'image': image, 'revision': revision, 'port': port}
        atomic_json(self.pending_path, {'before': before, 'candidate': candidate})
        try:
            self.prepare(candidate)
            self.tls()
            self.switch(candidate)
            self.public_check(candidate)
            atomic_json(self.state_path, {'current': candidate, 'previous': before['current']})
            self.pending_path.unlink()
        except Exception as error:
            # Leave pending.json in place if restoring the proxy fails; recover can retry it.
            self.switch(before['current'])
            atomic_json(self.state_path, before)
            self.pending_path.unlink()
            self.event('release_failed', image=image, error=str(error), restored=before['current'])
            raise
        self.event('release_committed', **candidate)

    def rollback(self):
        if self.pending_path.exists():
            self.recover()
        previous = self.state()['previous']
        if not previous:
            raise ValueError('No previous successful release exists; supply an approved digest using the recovery workflow')
        self.deploy(previous['image'], previous['revision'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['deploy', 'rollback', 'recover', 'status'])
    parser.add_argument('image', nargs='?')
    parser.add_argument('revision', nargs='?')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo on the production VM')
    with open('/run/geometrydash-ui-release.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        releases = Releases()
        if args.operation == 'deploy':
            if not args.image or not args.revision:
                parser.error('deploy requires image@sha256:digest and commit SHA')
            releases.deploy(args.image, args.revision)
        elif args.operation == 'status':
            print(json.dumps(releases.state(), indent=2))
        else:
            getattr(releases, args.operation)()


if __name__ == '__main__':
    main()
