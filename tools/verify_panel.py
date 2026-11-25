"""Phase 1 & 4 Playwright E2E verification suite for the Compact Panel & Swapped Analysis View (P1..P9).

Run with `--baseline` on the pre-redesign code to confirm RED baseline, then run without flags to verify GREEN.
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mobile_lib import (
    DEVICE_BY_NAME,
    ROOT,
    attach_error_listener,
    create_device_context,
    save_screenshot,
)


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


PORT = _pick_free_port()
BASE = f"http://127.0.0.1:{PORT}"
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
MOVES_10 = ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "b7e7", "b0c2", "b9c7", "h0h7", "h9h7"]


def _start_server() -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "server.py"), "--port", str(PORT)],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE}/index.html", timeout=2) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.2)
    proc.terminate()
    raise RuntimeError("tools/server.py failed to start")


def _click_sq(page, x: int, y: int) -> None:
    box = page.locator("svg.board-svg").bounding_box()
    assert box
    vb = page.evaluate("() => document.querySelector('svg.board-svg').getAttribute('viewBox').split(' ').map(Number)")
    bx = 125 + x * 100
    by = 125 + y * 100
    cx = box["x"] + ((bx - vb[0]) / vb[2]) * box["width"]
    cy = box["y"] + ((by - vb[1]) / vb[3]) * box["height"]
    page.mouse.click(cx, cy)


def run_suite(baseline: bool = False) -> dict[str, Any]:
    proc = _start_server()
    results: dict[str, Any] = {}
    all_errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
            page = ctx.new_page()
            errs = attach_error_listener(page)

            # Seed finished archive game
            page.goto(f"{BASE}/?test#/", wait_until="domcontentloaded")
            page.wait_for_function("() => Boolean(window.__gameStore)", timeout=10000)
            rec = {
                "schemaVersion": 1, "id": "p-arch-xq",
                "createdAt": "2026-11-25T10:00:00.000Z", "updatedAt": "2026-11-25T10:00:00.000Z",
                "variant": "xiangqi", "mode": "ai",
                "red": {"name": "Đỏ", "kind": "human"}, "black": {"name": "Máy", "kind": "engine"},
                "result": "black", "reason": "resign",
                "start": {"fen": START_FEN},
                "moves": [{"m": m} for m in MOVES_10], "source": "manual",
            }
            page.evaluate(f"async () => {{ await window.__gameStore.saveGame({json.dumps(rec)}); }}")

            # ---------------- P1 & P2: Compact default panel & no panel scroll ----------------
            page.goto(f"{BASE}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            page.wait_for_timeout(200)
            p1_p2 = page.evaluate("""() => {
                const panel = document.querySelector('#side-panel');
                const menuBtn = document.querySelector('[data-testid="panel-menu-btn"]');
                const anBtn = document.querySelector('[data-testid="panel-analyze-btn"]');
                const modeBarVis = Boolean(document.querySelector('.mode-bar') && getComputedStyle(document.querySelector('.mode-bar')).display !== 'none');
                const oldGridVis = Boolean(document.querySelector('.controls-grid') && getComputedStyle(document.querySelector('.controls-grid')).display !== 'none');
                const scrollOk = panel ? panel.scrollHeight <= panel.clientHeight + 2 : false;
                return {
                    hasMenuBtn: Boolean(menuBtn && getComputedStyle(menuBtn).display !== 'none'),
                    hasAnBtn: Boolean(anBtn && getComputedStyle(anBtn).display !== 'none'),
                    modeBarHidden: !modeBarVis,
                    oldGridHidden: !oldGridVis,
                    scrollOk,
                    panelScrollH: panel ? panel.scrollHeight : 0,
                    panelClientH: panel ? panel.clientHeight : 0,
                };
            }""")
            results["P1_compact"] = {
                "status": "PASS" if (p1_p2["hasMenuBtn"] and p1_p2["modeBarHidden"] and p1_p2["oldGridHidden"]) else "FAIL",
                **p1_p2,
            }
            results["P2_height"] = {
                "status": "PASS" if p1_p2["scrollOk"] else "FAIL",
                "scrollH": p1_p2["panelScrollH"],
                "clientH": p1_p2["panelClientH"],
            }

            # ---------------- P3: Action rows (local: undo/draw/resign; ai: resign only) ----------------
            p3_local = page.evaluate("""() => {
                const row = document.querySelector('[data-testid="panel-action-row"]');
                if (!row) return { ok: false };
                const acts = [...row.querySelectorAll('button:not([hidden])')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.pact);
                return { ok: acts.includes('undo') && acts.includes('local-draw') && acts.includes('local-resign'), acts };
            }""")
            page.goto(f"{BASE}/?test#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            page.wait_for_timeout(200)
            p3_ai = page.evaluate("""() => {
                const row = document.querySelector('[data-testid="panel-action-row"]');
                const anBtn = document.querySelector('[data-testid="panel-analyze-btn"]');
                const anVis = Boolean(anBtn && !anBtn.hidden && getComputedStyle(anBtn).display !== 'none');
                if (!row) return { ok: false, anVis };
                const acts = [...row.querySelectorAll('button:not([hidden])')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.pact);
                return { ok: acts.length === 1 && acts[0] === 'resign', acts, anVis };
            }""")
            results["P3_actions"] = {
                "status": "PASS" if (p3_local.get("ok") and p3_ai.get("ok")) else "FAIL",
                "local": p3_local,
                "ai": p3_ai,
            }

            # ---------------- P4: Analysis visibility matrix ----------------
            page.goto(f"{BASE}/?test#/play/coup/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            page.wait_for_timeout(180)
            jq_an_vis = page.evaluate("""() => {
                const b = document.querySelector('[data-testid="panel-analyze-btn"]');
                return Boolean(b && !b.hidden && getComputedStyle(b).display !== 'none');
            }""")
            results["P4_visibility"] = {
                "status": "PASS" if (p1_p2["hasAnBtn"] and not p3_ai["anVis"] and not jq_an_vis) else "FAIL",
                "local_xq": p1_p2["hasAnBtn"],
                "ai_live": p3_ai["anVis"],
                "local_jq": jq_an_vis,
            }

            # ---------------- P5 + Phase 3: Swap, Live local analysis, 6-ply PV preview, Esc return ----------------
            if p1_p2["hasAnBtn"]:
                page.goto(f"{BASE}/?test#/play/cotuong/local", wait_until="domcontentloaded")
                page.wait_for_selector("svg.board-svg", timeout=8000)
                page.wait_for_timeout(150)
                # Play 2 moves
                _click_sq(page, 7, 7); _click_sq(page, 4, 7); page.wait_for_timeout(200)
                _click_sq(page, 7, 0); _click_sq(page, 6, 2); page.wait_for_timeout(200)

                t0 = time.monotonic()
                page.locator('[data-testid="panel-analyze-btn"]').click()
                page.wait_for_selector('[data-testid="analysis-panel"]', state="visible", timeout=5000)
                # Compact panel must be removed from layout (display: none)
                compact_gone = page.evaluate("""() => {
                    const c = document.querySelector('[data-testid="compact-panel-body"]');
                    return Boolean(c && getComputedStyle(c).display === 'none');
                }""")
                # Wait for live position verdict + PV chips
                page.wait_for_selector('[data-testid="an-verdict-card"]', state="visible", timeout=5000)
                page.wait_for_function("() => document.querySelectorAll('.an-pv-chip').length >= 2", timeout=6000)
                live_ms = int((time.monotonic() - t0) * 1000)

                # Click PV chip -> ghost preview banner appears, Esc returns without mutating history
                plies_before = page.evaluate("window.__board.history.length")
                page.locator('.an-pv-chip').first.click()
                page.wait_for_timeout(150)
                preview_banner = page.locator('[data-testid="pv-preview-banner"]').is_visible()
                page.keyboard.press("Escape")
                page.wait_for_timeout(120)
                plies_after = page.evaluate("window.__board.history.length")

                # Play 3rd move while analysis panel is open -> board still interactive & updates
                _click_sq(page, 7, 9); _click_sq(page, 6, 7); page.wait_for_timeout(400)
                plies_live = page.evaluate("window.__board.history.length")

                # Return via "← Về ván"
                page.locator('[data-testid="an-back-btn"]').click()
                page.wait_for_timeout(150)
                compact_back = page.evaluate("""() => {
                    const c = document.querySelector('[data-testid="compact-panel-body"]');
                    return Boolean(c && getComputedStyle(c).display !== 'none');
                }""")

                # P8 Eval bar width >= 24px and chip >= 3px inside edges
                page.locator('[data-testid="panel-analyze-btn"]').click()
                page.wait_for_selector('[data-testid="eval-bar"]', state="visible", timeout=4000)
                p8_info = page.evaluate("""() => {
                    const bar = document.querySelector('[data-testid="eval-bar"]');
                    const chip = bar && bar.querySelector('.eval-bar-score');
                    if (!bar || !chip) return { ok: false };
                    const br = bar.getBoundingClientRect();
                    const cr = chip.getBoundingClientRect();
                    const topGap = cr.top - br.top;
                    const botGap = br.bottom - cr.bottom;
                    return { ok: br.width >= 23.5 && topGap >= 3 && botGap >= 3, barW: Math.round(br.width), topGap: Math.round(topGap), botGap: Math.round(botGap) };
                }""")

                results["P5_swap_live"] = {
                    "status": "PASS" if (compact_gone and compact_back and preview_banner and plies_before == plies_after and plies_live == plies_before + 1) else "FAIL",
                    "compact_gone": compact_gone,
                    "compact_back": compact_back,
                    "live_ms": live_ms,
                    "preview_banner": preview_banner,
                    "plies": [plies_before, plies_after, plies_live],
                }
                results["P8_eval_bar"] = {"status": "PASS" if p8_info.get("ok") else "FAIL", **p8_info}
            else:
                results["P5_swap_live"] = {"status": "FAIL", "reason": "no panel-analyze-btn"}
                results["P8_eval_bar"] = {"status": "FAIL", "reason": "no panel-analyze-btn"}

            # ---------------- P7: Review banner does not cover board file labels (live review) ----------------
            if page.locator('[data-testid="an-back-btn"]').is_visible():
                page.locator('[data-testid="an-back-btn"]').click()
                page.wait_for_timeout(120)
            page.goto(f"{BASE}/?test#/", wait_until="domcontentloaded")
            page.goto(f"{BASE}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            _click_sq(page, 7, 7); _click_sq(page, 4, 7); page.wait_for_timeout(150)
            _click_sq(page, 7, 0); _click_sq(page, 6, 2); page.wait_for_timeout(150)
            page.locator('[data-rev="prev"]').click()
            page.wait_for_timeout(180)
            p7 = page.evaluate("""() => {
                const b = document.querySelector('.review-banner');
                const svg = document.querySelector('svg.board-svg');
                if (!b || b.hidden || !svg) return { ok: false, reason: 'missing' };
                const br = b.getBoundingClientRect();
                const sr = svg.getBoundingClientRect();
                return { ok: br.bottom <= sr.top + 2, bannerBottom: Math.round(br.bottom), svgTop: Math.round(sr.top) };
            }""")
            results["P7_banner"] = {"status": "PASS" if p7.get("ok") else "FAIL", **p7}

            all_errors.extend(f"[desk] {e}" for e in errs)
            ctx.close()

            # ---------------- P6: Phone 390x844 stack layout ----------------
            mctx = create_device_context(browser, DEVICE_BY_NAME["390x844"])
            mp = mctx.new_page()
            merrs = attach_error_listener(mp)
            mp.goto(f"{BASE}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            mp.wait_for_selector("svg.board-svg", timeout=8000)
            mp.wait_for_timeout(200)
            mob_an_btn = mp.locator('[data-testid="mobile-controls"] [data-maction="analyze"]')
            mob_has_an = mob_an_btn.count() > 0 and mob_an_btn.is_visible()
            mob_ovf = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            mob_sheet_full = False
            if mob_has_an:
                mob_an_btn.click()
                mp.wait_for_timeout(250)
                mob_sheet_full = mp.evaluate("""() => {
                    const sh = document.querySelector('[data-testid="bottom-sheet"]');
                    const ap = document.querySelector('[data-testid="analysis-panel"]');
                    return Boolean(sh && sh.dataset.state === 'full' && ap && getComputedStyle(ap).display !== 'none');
                }""")
            results["P6_phone"] = {
                "status": "PASS" if (mob_has_an and mob_sheet_full and not mob_ovf) else "FAIL",
                "mob_has_an": mob_has_an,
                "mob_sheet_full": mob_sheet_full,
                "ovf": mob_ovf,
            }
            all_errors.extend(f"[390x844] {e}" for e in merrs)
            mctx.close()

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

    results["console_errors"] = {"status": "FAIL" if all_errors else "PASS", "count": len(all_errors), "samples": all_errors[:6]}
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    args = ap.parse_args()
    res = run_suite(baseline=args.baseline)
    print("=== verify_panel.py ===")
    any_fail = False
    for k, v in res.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:16s} {st:8s} {v}")
    return 0 if (not any_fail or args.baseline) else 1


if __name__ == "__main__":
    raise SystemExit(main())
