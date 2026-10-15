#!/usr/bin/env python3
"""Validate the real host proxy renderer with nginx, without modifying this host."""
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from unittest.mock import patch

image = sys.argv[1]
repository = Path(__file__).resolve().parents[2]
artifacts = repository / 'artifacts'
artifacts.mkdir(exist_ok=True)
real_path = type(repository)
real_run = subprocess.run

with tempfile.TemporaryDirectory(prefix='proxy-', dir=artifacts) as directory:
    root = real_path(directory)
    for name in ['etc/geometrydash-ui', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled']:
        (root / name).mkdir(parents=True)
    config = root / 'etc/geometrydash-ui/config.json'
    config.write_text(json.dumps({'domain': 'geometrydash-ui.example.com'}))
    wrapper = root / 'nginx.conf'
    wrapper.write_text(f'''pid /tmp/geometrydash-ui-proxy-test.pid;
events {{}}
http {{
    include /etc/nginx/mime.types;
    upstream geometrydash_ui_backend {{ server 127.0.0.1:8081; }}
    include {root}/etc/nginx/sites-enabled/*;
}}
''')

    def nginx(*_args, **_kwargs):
        return real_run([
            'docker', 'run', '--rm', '--user', '0', '--entrypoint', 'nginx',
            '-v', f'{root}:{root}:ro', image, '-t', '-c', str(wrapper),
        ], check=True, capture_output=True, text=True)

    def render():
        # Redirect only this script's absolute filesystem paths into the fixture.
        def sandbox_path(value):
            return root / str(value).lstrip('/')
        with patch('pathlib.Path', sandbox_path), patch('subprocess.run', nginx):
            runpy.run_path(str(repository / 'ops/host/configure-web.py'), run_name='__main__')

    render()  # Initial HTTP/ACME configuration, before a certificate exists.
    cert = root / 'etc/letsencrypt/live/geometrydash-ui.example.com'
    cert.mkdir(parents=True)
    real_run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=geometrydash-ui.example.com', '-keyout', str(cert / 'privkey.pem'),
        '-out', str(cert / 'fullchain.pem'),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    render()  # nginx loads and validates the certificate/key and HTTPS proxy.
    site = root / 'etc/nginx/sites-available/geometrydash-ui'
    previous = site.read_text()
    assert 'listen 443 ssl;' in previous
    config.write_text(json.dumps({'domain': 'invalid; } broken {'}))
    try:
        render()
    except subprocess.CalledProcessError:
        pass
    else:
        raise AssertionError('nginx should reject the broken candidate configuration')
    assert site.read_text() == previous, 'Rejected configuration did not restore the previous proxy'
    nginx()
print('Host HTTP, TLS and proxy-configuration recovery checks passed.')
