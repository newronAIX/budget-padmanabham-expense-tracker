#!/usr/bin/env python3
"""Static server for local demos and screenshots.

Same job as `python3 -m http.server`, with one difference that matters when you
are presenting: every response carries no-store, so a browser (iOS Safari in the
simulator especially) can never hand back a stale app.js after you edit it. A
cached bundle mid-demo looks exactly like "the fix didn't work".

    python3 scripts/serve_demo.py [port]      # default 5188, binds localhost only
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # the budget/ directory


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):          # quieter console during a demo
        if "GET / " in (fmt % args) or " 4" in (fmt % args) or " 5" in (fmt % args):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5188
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {ROOT} at http://localhost:{port}  (no-store)")
        print(f"demo:  http://localhost:{port}/?preview=1")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
