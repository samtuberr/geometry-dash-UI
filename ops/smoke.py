#!/usr/bin/env python3
"""Check the deployed HTTP contract using only the Python standard library."""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request


def check(base, revision):
    base = base.rstrip('/')

    def get(path, mime=None):
        with urllib.request.urlopen(base + path, timeout=15) as response:
            data = response.read()
            if mime:
                assert mime in response.headers.get('Content-Type', ''), f'Wrong MIME for {path}'
            return data

    assert get('/healthz').strip() == b'ok', 'Health check failed'
    version = json.loads(get('/version.json', 'application/json'))
    assert version['revision'] == revision, f'Wrong revision: {version}'
    html = get('/', 'text/html')
    assert b'id="root"' in html, 'Missing application root'
    for route in ['/results', '/import', '/guide', '/meshes/mesh_01']:
        assert get(route, 'text/html') == html, f'SPA route failed: {route}'
    assert json.loads(get('/sample/manifest.json', 'application/json'))['mesh_count'] == 10
    assert 'predictions' in json.loads(get('/sample/predictions.json', 'application/json'))
    assets = set(re.findall(rb'(?:src|href)="(/assets/[^"<>]+)"', html))
    assert assets, 'No built assets found'
    workers = set()
    for asset in assets:
        path = asset.decode()
        mime = 'javascript' if path.endswith('.js') else 'text/css'
        data = get(path, mime)
        if path.endswith('.js'):
            workers.update(re.findall(rb'/assets/import\.worker-[A-Za-z0-9_-]+\.js', data))
    assert workers, 'No built import worker found'
    for worker in workers:
        get(worker.decode(), 'javascript')
    for missing in ['/assets/not-a-real-file.js', '/sample/not-a-real-file.json']:
        try:
            get(missing)
        except urllib.error.HTTPError as error:
            assert error.code == 404, f'Expected 404 for {missing}, got {error.code}'
        else:
            raise AssertionError(f'Missing asset returned success: {missing}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('revision')
    parser.add_argument('--attempts', type=int, default=1, help='Bounded retries for startup/reload propagation')
    args = parser.parse_args()
    if args.attempts < 1:
        parser.error('--attempts must be positive')
    for attempt in range(args.attempts):
        try:
            check(args.url, args.revision)
            break
        except Exception as error:
            if attempt == args.attempts - 1:
                raise
            print(f'Waiting for the expected release: {error}', file=sys.stderr)
            time.sleep(2)
    print(f'HTTP smoke checks passed: {args.url} ({args.revision})')
