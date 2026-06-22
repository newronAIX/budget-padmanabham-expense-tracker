#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
CAPTURE_HELPER = ROOT / "scripts/capture_screen.mjs"
BUNDLED_NODE = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
BUNDLED_NODE_MODULES = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
NODE = os.environ.get("BUDGET_VISUAL_NODE") or (str(BUNDLED_NODE) if BUNDLED_NODE.exists() else "node")
REFERENCE_DIR = ROOT / "tests/visual/references"
LEGACY_ACTIVITY_REFERENCE = ROOT / "tests/visual/stitch-recent-activity.png"

SCREENS = {
    "recent-activity": {
        "path": "/?preview=1&visual=activity",
        "size": (440, 356),
        "reference": LEGACY_ACTIVITY_REFERENCE,
        "threshold": 92.0,
    },
    "mobile-home": {
        "path": "/?preview=1&tab=dashboard",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-home.png",
        "threshold": 90.0,
    },
    "mobile-expenses": {
        "path": "/?preview=1&tab=expenses",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-expenses.png",
        "threshold": 90.0,
    },
    "mobile-insights": {
        "path": "/?preview=1&tab=insights",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-insights.png",
        "threshold": 90.0,
    },
    "mobile-add-expense": {
        "path": "/?preview=1&tab=dashboard&modal=expense",
        "size": (390, 844),
        "reference": REFERENCE_DIR / "mobile-add-expense.png",
        "threshold": 90.0,
    },
    "mobile-income": {
        "path": "/?preview=1&tab=income",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-income.png",
        "threshold": 90.0,
    },
    "mobile-categories": {
        "path": "/?preview=1&tab=categories",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-categories.png",
        "threshold": 90.0,
    },
    "mobile-family": {
        "path": "/?preview=1&tab=family",
        "size": (390, 1200),
        "reference": REFERENCE_DIR / "mobile-family.png",
        "threshold": 90.0,
    },
    "desktop-insights": {
        "path": "/?preview=1&tab=insights",
        "size": (1180, 900),
        "reference": REFERENCE_DIR / "desktop-insights.png",
        "threshold": 90.0,
    },
}


def wait_for_server(url, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError(f"Timed out waiting for {url}")


def capture(url, output, width, height):
    env = os.environ.copy()
    if BUNDLED_NODE_MODULES.exists():
        env["NODE_PATH"] = str(BUNDLED_NODE_MODULES)
    subprocess.run(
        [
            NODE,
            str(CAPTURE_HELPER),
            url,
            str(output),
            str(width),
            str(height),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )


def ssim_luma(reference, target):
    ref = np.asarray(reference.convert("L"), dtype=np.float64)
    tgt = np.asarray(target.convert("L"), dtype=np.float64)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    mu_ref = ref.mean()
    mu_tgt = tgt.mean()
    sigma_ref = ref.var()
    sigma_tgt = tgt.var()
    sigma_ref_tgt = ((ref - mu_ref) * (tgt - mu_tgt)).mean()
    numerator = (2 * mu_ref * mu_tgt + c1) * (2 * sigma_ref_tgt + c2)
    denominator = (mu_ref**2 + mu_tgt**2 + c1) * (sigma_ref + sigma_tgt + c2)
    return float(numerator / denominator)


def compare(reference_path, target_path, diff_path):
    reference = Image.open(reference_path).convert("RGB")
    target = Image.open(target_path).convert("RGB")
    if target.size != reference.size:
        target = target.resize(reference.size, Image.Resampling.LANCZOS)
        target.save(target_path)

    ref_arr = np.asarray(reference, dtype=np.float64)
    tgt_arr = np.asarray(target, dtype=np.float64)
    delta = np.abs(ref_arr - tgt_arr)
    mae = float(delta.mean())
    rmse = float(math.sqrt(np.square(ref_arr - tgt_arr).mean()))
    similarity = max(0.0, 100.0 * (1.0 - mae / 255.0))
    ssim = ssim_luma(reference, target)

    diff = ImageChops.difference(reference, target)
    diff = diff.filter(ImageFilter.GaussianBlur(radius=0.5))
    diff = diff.point(lambda value: min(255, value * 4))
    diff.save(diff_path)

    return {
        "similarity_percent": round(similarity, 2),
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "ssim_luma": round(ssim, 4),
    }


def run_screen(name, screen, base_url, output_dir, default_threshold):
    width, height = screen["size"]
    url = f"{base_url}{screen['path']}"
    target_path = output_dir / f"{name}.png"
    diff_path = output_dir / f"{name}-diff.png"
    reference_path = Path(screen["reference"])
    if reference_path.exists() and name != "recent-activity":
        ref_width, ref_height = Image.open(reference_path).size
        height = max(height, round(ref_height * (width / ref_width)))
    capture(url, target_path, width, height)

    threshold = float(screen.get("threshold", default_threshold))
    report = {
        "screen": name,
        "passed": True,
        "threshold": threshold,
        "reference": str(reference_path),
        "target": str(target_path),
        "diff": str(diff_path),
        "url": url,
        "width": width,
        "height": height,
    }

    if not reference_path.exists():
        report.update({
            "status": "captured_without_reference",
            "reference_missing": True,
        })
        return report

    metrics = compare(reference_path, target_path, diff_path)
    report.update(metrics)
    report["passed"] = metrics["similarity_percent"] >= threshold
    report["status"] = "passed" if report["passed"] else "failed"
    return report


def main():
    parser = argparse.ArgumentParser(description="Compare Budget Padmanabham UI against Stitch visual references.")
    parser.add_argument("--screen", choices=["all", *SCREENS.keys()], default="all")
    parser.add_argument("--out", default="/tmp/budget-visual-parity")
    parser.add_argument("--port", type=int, default=5194)
    parser.add_argument("--threshold", type=float, default=92.0)
    parser.add_argument("--keep-server", action="store_true")
    args = parser.parse_args()

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"

    base_url = f"http://127.0.0.1:{args.port}"
    health_url = f"http://127.0.0.1:{args.port}/"
    selected = SCREENS if args.screen == "all" else {args.screen: SCREENS[args.screen]}

    env = os.environ.copy()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(args.port), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    try:
        wait_for_server(health_url)
        results = [run_screen(name, screen, base_url, output_dir, args.threshold) for name, screen in selected.items()]
        report = {
            "passed": all(result["passed"] for result in results),
            "output_dir": str(output_dir),
            "results": results,
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
        if not report["passed"]:
            return 1
        return 0
    finally:
        if not args.keep_server:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
