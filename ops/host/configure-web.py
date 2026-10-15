#!/usr/bin/env python3
"""Render the stable public proxy; releases change only geometrydash-ui-upstream.conf."""
import json
import os
import subprocess
from pathlib import Path

config = json.loads(Path('/etc/geometrydash-ui/config.json').read_text())
domain = config['domain']
cert = Path('/etc/letsencrypt/live') / domain
http = f'''server {{
    listen 80 default_server;
    server_name {domain};
    location /.well-known/acme-challenge/ {{ root /var/www/acme; }}
    location / {{ return 308 https://{domain}$request_uri; }}
}}
'''
if (cert / 'fullchain.pem').exists():
    http += f'''server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate {cert}/fullchain.pem;
    ssl_certificate_key {cert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;
    add_header Strict-Transport-Security "max-age=86400" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    # Assets accumulate across releases so older tabs can create their worker.
    location /assets/ {{
        root /var/lib/geometrydash-ui/public;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options nosniff always;
    }}
    location / {{
        proxy_pass http://geometrydash_ui_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
    }}
}}
'''
path = Path('/etc/nginx/sites-available/geometrydash-ui')
previous = path.read_text() if path.exists() else None
temporary = path.with_suffix('.new')
temporary.write_text(http)
os.replace(temporary, path)
link = Path('/etc/nginx/sites-enabled/geometrydash-ui')
created_link = not (link.exists() or link.is_symlink())
if created_link:
    link.symlink_to(path)
try:
    subprocess.run(['nginx', '-t'], check=True)
except Exception:
    # A broken TLS/proxy configuration must not prevent a release from failing
    # back to the old upstream. Restore the previous config before propagating.
    if previous is None:
        path.unlink(missing_ok=True)
    else:
        temporary.write_text(previous)
        os.replace(temporary, path)
    if created_link:
        link.unlink(missing_ok=True)
    raise
