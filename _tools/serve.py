"""Local dev server for the site: python _tools/serve.py [port]

Like `python -m http.server`, but every response says Cache-Control:
no-store. The plain server sends no caching headers at all, so the browser
guesses how long to keep each file - and it kept serving an old
render-webgl.js and main.js beside a new scene.js after a reload: a mix of
two versions of the background, which is how fixes seemed not to have
happened. Serves the site root (the folder above _tools), whatever the
current directory. Binds 127.0.0.1 only.
"""
import functools, http.server, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    handler = functools.partial(NoStore, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'serving {ROOT} at http://127.0.0.1:{port}/ (no-store)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
