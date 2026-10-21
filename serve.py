"""Serve Runimate on this computer and your local network (for the iPad).

    python serve.py            # http://localhost:8040
    python serve.py 9000       # pick another port
"""
import http.server
import socket
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8040
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


def lan_addresses():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), Handler) as httpd:
    print(f'Runimate is running:  http://localhost:{PORT}')
    for ip in lan_addresses():
        print(f'On your iPad (same Wi-Fi):  http://{ip}:{PORT}')
    print('Press Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
