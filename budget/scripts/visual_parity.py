#!/usr/bin/env python3
"""Visual checks for the Budget Padmanabham web app.

Two independent modes, because they answer different questions:

  --mode stitch    How close is the app to the original Google Stitch mockups?
                   Loose, informational, compares against tests/visual/references/.
                   Never gates a refactor -- the mockups are a design target, not
                   a record of what the app used to look like.

  --mode baseline  Did this change alter rendering? Compares against
                   tests/visual/baseline/, which holds the app's own prior output.
                   Tight thresholds; this is the mode to trust during a refactor.
                   Record/refresh baselines with --update-baseline.

Baselines are captured with a frozen clock (?today=) so seeded preview data does
not drift overnight or roll over at month boundaries.
"""
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
REFERENCE_DIR = ROOT / "tests/visual/references"
BASELINE_DIR = ROOT / "tests/visual/baseline"
LEGACY_ACTIVITY_REFERENCE = ROOT / "tests/visual/stitch-recent-activity.png"

# Every preview URL is pinned to this date. Changing it invalidates all baselines.
FROZEN_TODAY = "2026-07-15"

# Baseline mode defaults: demand pixel-identity.
#
# This is deliberately absolute. Rendering here is deterministic -- all 11 screens
# reproduce at exactly mae 0.0 across independent runs -- so any nonzero diff is a
# real change, and a tolerance only buys false negatives. Measured: rounding the
# corners on three small avatars moves just 0.046% of pixels, so a "generous"
# 0.1% threshold silently passes a change that is plainly visible.
#
# Relax with --max-changed-percent during the spacing stage, where pixels are
# expected to move and diffs get reviewed by hand.
BASELINE_MAX_MAE = 0.0
BASELINE_MAX_CHANGED_PERCENT = 0.0
CHANNEL_NOISE_FLOOR = 2  # per-channel delta at or below this counts as encoder noise

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
    # Desktop had exactly one screenshot; these two cover the layouts that
    # actually branch to different render functions above the 900px breakpoint.
    "desktop-home": {
        "path": "/?preview=1&tab=dashboard",
        "size": (1180, 900),
        "reference": REFERENCE_DIR / "desktop-home.png",
        "threshold": 90.0,
    },
    "desktop-expenses": {
        "path": "/?preview=1&tab=expenses",
        "size": (1180, 900),
        "reference": REFERENCE_DIR / "desktop-expenses.png",
        "threshold": 90.0,
    },
}


def resolve_node():
    """Find a node that can require('playwright').

    Preference order: BUDGET_VISUAL_NODE, a locally installed playwright, then the
    bundled runtime that ships with some agent environments. Returns (node, env).
    """
    candidates = []
    override = os.environ.get("BUDGET_VISUAL_NODE")
    if override:
        candidates.append((override, None))
    candidates.append(("node", None))

    bundled_node = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    bundled_modules = bundled_node.parent.parent / "node_modules"
    if bundled_node.exists() and bundled_modules.exists():
        candidates.append((str(bundled_node), str(bundled_modules)))

    for node, node_path in candidates:
        env = os.environ.copy()
        if node_path:
            env["NODE_PATH"] = node_path
        try:
            subprocess.run(
                [node, "-e", "require('playwright')"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
            )
            return node, env
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            continue

    raise SystemExit(
        "Could not find a node runtime with playwright available.\n"
        "Fix with either:\n"
        "  npm install --no-save playwright && npx playwright install chromium\n"
        "or point at a node that already has it:\n"
        "  BUDGET_VISUAL_NODE=/path/to/node python3 scripts/visual_parity.py ..."
    )


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


def freeze_clock(path):
    """Pin the preview clock so seeded demo dates are stable across runs."""
    if "preview=1" not in path:
        return path
    separator = "&" if "?" in path else "?"
    return f"{path}{separator}today={FROZEN_TODAY}"


def capture(node, env, url, output, width, height):
    subprocess.run(
        [node, str(CAPTURE_HELPER), url, str(output), str(width), str(height)],
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


def write_diff(reference, target, diff_path):
    diff = ImageChops.difference(reference, target)
    diff = diff.filter(ImageFilter.GaussianBlur(radius=0.5))
    diff = diff.point(lambda value: min(255, value * 4))
    diff.save(diff_path)


def compare_stitch(reference_path, target_path, diff_path, resized_path):
    """Loose design-fidelity comparison against the Stitch mockups.

    Size normalisation writes to a separate file -- the original capture is kept
    intact so a genuine height change stays visible in the artifacts.
    """
    reference = Image.open(reference_path).convert("RGB")
    target = Image.open(target_path).convert("RGB")
    resized = False
    if target.size != reference.size:
        target = target.resize(reference.size, Image.Resampling.LANCZOS)
        target.save(resized_path)
        resized = True

    ref_arr = np.asarray(reference, dtype=np.float64)
    tgt_arr = np.asarray(target, dtype=np.float64)
    delta = np.abs(ref_arr - tgt_arr)
    mae = float(delta.mean())
    rmse = float(math.sqrt(np.square(ref_arr - tgt_arr).mean()))
    similarity = max(0.0, 100.0 * (1.0 - mae / 255.0))

    write_diff(reference, target, diff_path)
    return {
        "similarity_percent": round(similarity, 2),
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "ssim_luma": round(ssim_luma(reference, target), 4),
        "resized_for_comparison": resized,
    }


def compare_baseline(baseline_path, target_path, diff_path):
    """Strict self-comparison. Never resizes -- a size change IS the regression."""
    baseline = Image.open(baseline_path).convert("RGB")
    target = Image.open(target_path).convert("RGB")

    if target.size != baseline.size:
        return {
            "status": "failed",
            "passed": False,
            "reason": (
                f"size changed: baseline {baseline.size[0]}x{baseline.size[1]} "
                f"vs current {target.size[0]}x{target.size[1]}"
            ),
            "baseline_size": list(baseline.size),
            "target_size": list(target.size),
        }

    ref_arr = np.asarray(baseline, dtype=np.int16)
    tgt_arr = np.asarray(target, dtype=np.int16)
    delta = np.abs(ref_arr - tgt_arr)

    mae = float(delta.mean())
    max_delta = int(delta.max())
    # Fraction of pixels where any channel moved beyond encoder noise. This is the
    # metric that actually catches a small element shifting -- a whole-image mean
    # barely registers a 4px nudge on one card.
    changed = np.any(delta > CHANNEL_NOISE_FLOOR, axis=2)
    changed_percent = float(changed.mean() * 100.0)

    write_diff(baseline, target, diff_path)
    return {
        "mae": round(mae, 4),
        "max_channel_delta": max_delta,
        "changed_pixel_percent": round(changed_percent, 4),
        "pixel_identical": max_delta == 0,
    }


def run_screen(name, screen, base_url, output_dir, args, node, env):
    width, height = screen["size"]
    url = f"{base_url}{freeze_clock(screen['path'])}"
    target_path = output_dir / f"{name}.png"
    diff_path = output_dir / f"{name}-diff.png"

    if args.mode == "baseline":
        compare_path = BASELINE_DIR / f"{name}.png"
    else:
        compare_path = Path(screen["reference"])
        # Stitch mode matches the mockup's aspect ratio so the comparison is fair.
        if compare_path.exists() and name != "recent-activity":
            ref_width, ref_height = Image.open(compare_path).size
            height = max(height, round(ref_height * (width / ref_width)))

    capture(node, env, url, target_path, width, height)

    report = {
        "screen": name,
        "mode": args.mode,
        "passed": True,
        "reference": str(compare_path),
        "target": str(target_path),
        "diff": str(diff_path),
        "url": url,
        "width": width,
        "height": height,
    }

    if args.mode == "baseline" and args.update_baseline:
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        Image.open(target_path).save(compare_path)
        report.update({"status": "baseline_updated", "passed": True})
        return report

    if not compare_path.exists():
        if args.mode == "baseline":
            # A missing baseline used to report passed=True, which meant a screen
            # could silently never be checked at all.
            report.update({
                "status": "failed",
                "passed": False,
                "reason": "no baseline recorded; run with --update-baseline first",
            })
        else:
            report.update({"status": "captured_without_reference", "reference_missing": True})
        return report

    if args.mode == "baseline":
        metrics = compare_baseline(compare_path, target_path, diff_path)
        report.update(metrics)
        if "passed" in metrics and metrics["passed"] is False:
            return report
        report["max_mae"] = args.max_mae
        report["max_changed_percent"] = args.max_changed_percent
        report["passed"] = (
            metrics["mae"] <= args.max_mae
            and metrics["changed_pixel_percent"] <= args.max_changed_percent
        )
        report["status"] = "passed" if report["passed"] else "failed"
        return report

    resized_path = output_dir / f"{name}-resized.png"
    metrics = compare_stitch(compare_path, target_path, diff_path, resized_path)
    threshold = float(screen.get("threshold", args.threshold))
    report.update(metrics)
    report["threshold"] = threshold
    report["passed"] = metrics["similarity_percent"] >= threshold
    report["status"] = "passed" if report["passed"] else "failed"
    return report


def main():
    parser = argparse.ArgumentParser(
        description="Visual checks for the Budget Padmanabham web app.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--mode", choices=["stitch", "baseline"], default="stitch")
    parser.add_argument("--screen", choices=["all", *SCREENS.keys()], default="all")
    parser.add_argument("--out", default="/tmp/budget-visual-parity")
    parser.add_argument("--port", type=int, default=5194)
    parser.add_argument("--threshold", type=float, default=92.0, help="stitch mode only")
    parser.add_argument("--max-mae", type=float, default=BASELINE_MAX_MAE, help="baseline mode only")
    parser.add_argument(
        "--max-changed-percent",
        type=float,
        default=BASELINE_MAX_CHANGED_PERCENT,
        help="baseline mode only",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="record current output as the baseline (implies --mode baseline)",
    )
    parser.add_argument("--keep-server", action="store_true")
    args = parser.parse_args()

    if args.update_baseline:
        args.mode = "baseline"

    node, env = resolve_node()

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"

    base_url = f"http://127.0.0.1:{args.port}"
    selected = SCREENS if args.screen == "all" else {args.screen: SCREENS[args.screen]}

    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(args.port), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        wait_for_server(f"{base_url}/")
        results = [
            run_screen(name, screen, base_url, output_dir, args, node, env)
            for name, screen in selected.items()
        ]
        report = {
            "mode": args.mode,
            "frozen_today": FROZEN_TODAY,
            "passed": all(result["passed"] for result in results),
            "output_dir": str(output_dir),
            "results": results,
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
        return 0 if report["passed"] else 1
    finally:
        if not args.keep_server:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
