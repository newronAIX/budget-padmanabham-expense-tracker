#!/usr/bin/env python3
"""Serve the app on an ephemeral port and run scripts/smoke.mjs against it.

Wrapper so `npm run test:smoke` is one command with no manual server juggling.
Reuses the node/playwright resolution from visual_parity.py.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from visual_parity import ROOT, resolve_node, wait_for_server  # noqa: E402

PORT = 5196


def main():
    node, env = resolve_node()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        base = f"http://127.0.0.1:{PORT}"
        wait_for_server(f"{base}/")
        return subprocess.run(
            [node, str(ROOT / "scripts/smoke.mjs"), base], env=env
        ).returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
