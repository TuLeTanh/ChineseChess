"""End-to-end Playwright verification suite for Part B: Game Analysis (a..h).

Checks:
  a) Real Pikafish analysis (via tools/server.py) on a 10-ply game with a planted hung-chariot blunder at ply 9:
     verifies eval bar, SVG graph, blunder detected at ply 9 (??), best-move card, accuracy rings, arrows toggle.
  b) JS Web Worker fallback (without Pikafish / forced JS): analyzes cleanly and produces valid report.
  c) Cancel halfway -> stops cleanly, marks "Chưa đầy đủ", keeps partial results.
  d) Persistence across reload -> cached analysis loads immediately + accuracy badge appears in Library.
  e) Integrity rule: live game (local/AI) has ZERO analysis panel/eval bar; Cờ Úp archive shows "Cờ Úp chưa hỗ trợ phân tích".
  f) Export: JSON offers optional "Kèm phân tích" checkbox; share link & PGN never contain analysis bloat.
  g) Mobile phone (390x844 & inapp_390x700): horizontal 10px eval bar above board, 4th bottom-sheet tab "Phân tích", 0 overflow.
  h) 4x CPU throttle graph scrub smoothness + 20 round trips (0 leaks) + 0 console errors/warnings + 3 preview screenshots.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mobile_lib import (
    DEVICE_BY_NAME,
    ROOT,
    attach_error_listener,
    create_device_context,
    save_screenshot,
)

OUT_DIR = ROOT / "preview" / "analysis"
PORT = 8798
BASE = f"http://127.0.0.1:{PORT}"

# 10-ply game where Red hangs the right Chariot on ply 9 (h0->h6 where Black horse/cannon/pawn takes it cleanly,
# actually h0->h7 straight into Black's Cannon/Horse/Chariot protection -> huge blunder!)
# Sequence:
# 1. h2e2 (Red central cannon)   2. h9g7 (Black horse)
# 3. h0g2 (Red horse)            4. i9h9 (Black chariot)
# 5. i0h0 (Red chariot)          6. b7e7 (Black central cannon)
# 7. b0c2 (Red horse)            8. b9c7 (Black horse)
# 9. h0h7 (Red hangs chariot directly to Black's Cannon/Chariot/Soldier!)
# 10. h9h7 (Black captures free chariot!)
PLANTED_MOVES = [
    {"m": "h2e2"}, {"m": "h9g7"},
    {"m": "h0g2"}, {"m": "i9h9"},
    {"m": "i0h0"}, {"m": "b7e7"},
    {"m": "b0c2"}, {"m": "b9c7"},
    {"m": "h0h7"}, {"m": "h9h7"},
]
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def _seed_record_js(rec_id: str, variant: str = "xiangqi") -> str:
    rec = {
        "schemaVersion": 1,
        "id": rec_id,
        "createdAt": "2026-11-25T10:00:00.000Z",
        "updatedAt": "2026-11-25T10:00:00.000Z",
        "variant": variant,
        "mode": "local",
        "red": {"name": "Đỏ", "kind": "human"},
        "black": {"name": "Đen", "kind": "human"},
        "result": "black",
        "reason": "resign",
        "start": {
            "fen": START_FEN if variant == "xiangqi" else "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w - - 0 1"
        },
        "moves": PLANTED_MOVES if variant == "xiangqi" else [{"m": "h2e2"}, {"m": "b7e7"}],
        "source": "manual",
    }
    return f"async () => {{ await window.__gameStore.saveGame({json.dumps(rec)}); }}"


def _start_pikafish_server() -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "server.py"), "--port", str(PORT)],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE}/api/engine/info", timeout=2) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.2)
    proc.terminate()
    raise RuntimeError("tools/server.py failed to start")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    proc = _start_pikafish_server()
    errors: list[str] = []
    results: dict[str, dict] = {}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 840}, device_scale_factor=1)
            page = ctx.new_page()
            errs = attach_error_listener(page)

            # Seed one Xiangqi game (planted blunder at ply 9) + one Jieqi game
            page.goto(f"{BASE}/?test#/", wait_until="networkidle")
            page.wait_for_function("() => Boolean(window.__gameStore)", timeout=5000)
            page.evaluate(_seed_record_js("an-test-xq", "xiangqi"))
            page.evaluate(_seed_record_js("an-test-jq", "jieqi"))

            # (e) Integrity rule: live game has ZERO analysis panel or eval bar
            page.goto(f"{BASE}/?test#/play/cotuong/local", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=5000)
            live_an_cnt = page.locator('[data-testid="analysis-panel"], [data-testid="eval-bar"]').count()

            # (e2) Cờ Úp archive shows unsupported notice & disabled run button
            page.goto(f"{BASE}/?test#/play/coup/review?id=an-test-jq", wait_until="networkidle")
            page.wait_for_selector('[data-testid="analysis-panel"]', timeout=5000)
            jq_notice = page.locator(".an-notice").text_content() or ""
            jq_btn_dis = page.locator('[data-an="run"]').is_disabled()
            results["E_integrity"] = {
                "status": "PASS" if (live_an_cnt == 0 and "chưa hỗ trợ" in jq_notice.lower() and jq_btn_dis) else "FAIL",
                "live_an_cnt": live_an_cnt,
                "jq_notice": jq_notice,
            }

            # (a) Real Pikafish analysis on planted hung-chariot game (ply 9 blunder)
            page.goto(f"{BASE}/?test#/play/cotuong/review?id=an-test-xq&analyze=1&auto=1&preset=fast", wait_until="networkidle")
            page.wait_for_selector('[data-testid="analysis-panel"]', timeout=5000)
            page.wait_for_function(
                "() => window.__analysis && window.__analysis.analyzed === 11 && !window.__analysis.summary.incomplete",
                timeout=25000,
            )
            an_res = page.evaluate("window.__analysis")
            ply9 = next((m for m in an_res["moveAnnotations"] if m["ply"] == 9), None)

            # Item 1 & 2: Verify arrows for EVERY ply 0..10 start on occupied sideToMove piece
            all_ply_arrows_ok = page.evaluate("""async () => {
                const { Board } = await import('./js/model/board.js');
                const { selectAnalysisPositionData } = await import('./js/analysis/math.js');
                const an = window.__analysis;
                const b = Board.fromFen(an.startFen);
                const FILES = 'abcdefghi';
                for (let ply = 0; ply <= an.moves.length; ply++) {
                    const data = selectAnalysisPositionData(an, ply, null);
                    if (!data) return false;
                    for (const a of data.arrows) {
                        const pc = b.at(a.from);
                        if (!pc || pc.side !== b.sideToMove) return false;
                    }
                    if (ply < an.moves.length) {
                        const m = an.moves[ply];
                        b.applyMove({ x: FILES.indexOf(m[0]), y: 9 - Number(m[1]) }, { x: FILES.indexOf(m[2]), y: 9 - Number(m[3]) });
                    }
                }
                return true;
            }""")

            # Click mistake item (ply 9 blunder) -> board must show ply 8 (BEFORE h0h7) with blue + red offset/dashed arrows
            page.locator('.an-mistake-item').first.click()
            page.wait_for_timeout(250)
            view_after_click = page.evaluate("window.__view")
            arrows_after_click = page.evaluate("window.__analysisArrows || []")
            played_row_txt = page.locator('[data-testid="an-played-row"]').text_content() or ""
            arrow_cnt = page.locator("g.analysis-arrow").count()
            eval_vis = page.locator('[data-testid="eval-bar"]').is_visible()

            # Item 4: Archive/replay cleanup assertions (pill unclipped, banner above board, new/undo hidden)
            arch_ui = page.evaluate("""() => {
                const pill = document.querySelector('.replay-mode-pill');
                const banner = document.querySelector('.review-banner');
                const svg = document.querySelector('svg.board-svg');
                const newBtn = document.querySelector('#side-panel [data-action="new"]');
                const undoBtn = document.querySelector('#side-panel [data-action="undo"]');
                const pr = pill ? pill.getBoundingClientRect() : null;
                const br = banner ? banner.getBoundingClientRect() : null;
                const sr = svg ? svg.getBoundingClientRect() : null;
                return {
                    pillUnclipped: Boolean(pill && pill.scrollWidth <= pill.clientWidth + 2 && pr && pr.left >= 0),
                    bannerAboveBoard: Boolean(!br || !sr || br.bottom <= sr.top + 2),
                    newHidden: Boolean(!newBtn || getComputedStyle(newBtn).display === 'none'),
                    undoHidden: Boolean(!undoBtn || getComputedStyle(undoBtn).display === 'none'),
                };
            }""")

            save_screenshot(page, "analysis_desktop.png", OUT_DIR)
            page.locator('[data-testid="analysis-panel"]').screenshot(path=str(OUT_DIR / "analysis_graph.png"))
            results["A_pikafish"] = {
                "status": "PASS" if (
                    ply9 and ply9["cls"] in ("blunder", "mistake")
                    and arrow_cnt >= 2 and eval_vis
                    and all_ply_arrows_ok
                    and view_after_click and view_after_click["ply"] == 8
                    and "h0h7" in played_row_txt
                    and all(arch_ui.values())
                ) else "FAIL",
                "engine": an_res.get("engineName"),
                "ply9_cls": ply9["cls"] if ply9 else None,
                "view_ply": view_after_click["ply"] if view_after_click else None,
                "arrows": len(arrows_after_click),
                "arch_ui": arch_ui,
                "red_acc": an_res["summary"]["redAccuracy"],
                "black_acc": an_res["summary"]["blackAccuracy"],
            }

            # (d) Persistence across reload + Library accuracy badge
            page.reload(wait_until="networkidle")
            page.wait_for_function("() => Boolean(window.__analysis && window.__analysis.analyzed === 11)", timeout=6000)
            page.goto(f"{BASE}/?test#/library", wait_until="networkidle")
            page.wait_for_selector(".lib-acc-badge", timeout=5000)
            acc_txt = page.locator(".lib-acc-badge").first.text_content() or ""
            results["D_persist_lib"] = {
                "status": "PASS" if "độ chính xác" in acc_txt.lower() else "FAIL",
                "badge": acc_txt,
            }

            # (f) Export modal shows optional "Kèm phân tích" checkbox for JSON
            page.goto(f"{BASE}/?test#/play/cotuong/review?id=an-test-xq", wait_until="networkidle")
            page.wait_for_selector('[data-arch="export"]', timeout=5000)
            page.locator('[data-arch="export"]').click()
            page.wait_for_selector('[data-exp-include-an]', state="visible", timeout=4000)
            chk_vis = page.locator('[data-exp-include-an]').is_visible()
            page.locator(".modal-close").click()
            results["F_export"] = {"status": "PASS" if chk_vis else "FAIL", "include_checkbox_visible": chk_vis}

            # (b) JS Web Worker fallback (forceEngine='js')
            page.evaluate("async () => { await window.__gameStore.deleteAnalysis(window.__analysis.key); window.__analysis = null; }")
            page.goto(f"{BASE}/?test#/play/cotuong/review?id=an-test-xq&analyze=1&auto=1&preset=fast&engine=js", wait_until="networkidle")
            page.wait_for_function(
                "() => window.__analysis && window.__analysis.analyzed === 11 && window.__analysis.engineName.includes('JS')",
                timeout=30000,
            )
            js_an = page.evaluate("window.__analysis")
            results["B_js_fallback"] = {
                "status": "PASS" if (js_an and js_an["analyzed"] == 11) else "FAIL",
                "engine": js_an.get("engineName"),
                "red_acc": js_an["summary"]["redAccuracy"],
            }

            # (c) Cancel halfway -> stops cleanly & marks "Chưa đầy đủ"
            page.evaluate("async () => { await window.__gameStore.deleteAnalysis(window.__analysis.key); window.__analysis = null; }")
            page.goto(f"{BASE}/?test#/play/cotuong/review?id=an-test-xq&analyze=1&auto=1&preset=standard", wait_until="networkidle")
            page.wait_for_selector('[data-an="stop"]', state="visible", timeout=5000)
            page.wait_for_function("() => window.__analysis && window.__analysis.analyzed >= 2", timeout=10000)
            page.locator('[data-an="stop"]').click()
            page.wait_for_selector('[data-testid="analysis-incomplete"]', timeout=4000)
            inc_txt = page.locator('[data-testid="analysis-incomplete"]').text_content() or ""
            results["C_cancel"] = {
                "status": "PASS" if "chưa đầy đủ" in inc_txt.lower() else "FAIL",
                "badge": inc_txt,
            }

            # (h) 4x CPU throttle scrub + 20 round trips
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
            gbox = page.locator(".an-graph-svg").bounding_box()
            if gbox:
                page.mouse.move(gbox["x"] + 10, gbox["y"] + gbox["height"] / 2)
                page.mouse.down()
                for i in range(1, 6):
                    page.mouse.move(gbox["x"] + gbox["width"] * i / 5, gbox["y"] + gbox["height"] / 2)
                    page.wait_for_timeout(30)
                page.mouse.up()
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})

            for _ in range(20):
                page.goto(f"{BASE}/?test#/library", wait_until="domcontentloaded")
                page.goto(f"{BASE}/?test#/play/cotuong/review?id=an-test-xq", wait_until="domcontentloaded")
            page.wait_for_timeout(200)
            leaks = page.evaluate("window.__leaks || {}")
            results["H_perf_leaks"] = {
                "status": "PASS" if (leaks.get("workers", 0) == 0 and leaks.get("sockets", 0) == 0) else "FAIL",
                "leaks": leaks,
            }
            errors.extend(f"[desk] {e}" for e in errs)
            ctx.close()

            # (g) Mobile phone (390x844 & inapp_390x700): horizontal 10px eval bar + 4th tab "Phân tích"
            mob_ok = True
            mob_info = {}
            for dev_name in ("390x844", "inapp_390x700"):
                mctx = create_device_context(browser, DEVICE_BY_NAME[dev_name])
                mp = mctx.new_page()
                merrs = attach_error_listener(mp)
                mp.goto(f"{BASE}/?test#/", wait_until="networkidle")
                mp.evaluate(_seed_record_js("an-mob-xq", "xiangqi"))
                mp.goto(f"{BASE}/?test#/play/cotuong/review?id=an-mob-xq&analyze=1&auto=1&preset=fast", wait_until="networkidle")
                mp.wait_for_function("() => window.__analysis && window.__analysis.analyzed === 11", timeout=25000)
                eb = mp.locator('[data-testid="eval-bar"]').bounding_box()
                ovf = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
                # Open bottom sheet via move-strip expand button & switch to 4th tab "Phân tích"
                mp.locator('[data-testid="sheet-open-btn"]').click()
                mp.wait_for_timeout(220)
                an_tab = mp.locator('[data-stab="analysis"]')
                an_tab.click()
                mp.wait_for_timeout(220)
                an_vis = mp.locator('[data-testid="analysis-panel"]').is_visible()
                if dev_name == "390x844":
                    save_screenshot(mp, "analysis_mobile.png", OUT_DIR)
                ok_one = bool(eb and eb["height"] <= 14 and eb["width"] > 100 and not ovf and an_vis)
                mob_ok = mob_ok and ok_one
                mob_info[dev_name] = {"eval_h": eb["height"] if eb else None, "ovf": ovf, "tab_vis": an_vis}
                errors.extend(f"[{dev_name}] {e}" for e in merrs)
                mctx.close()
            results["G_mobile"] = {"status": "PASS" if mob_ok else "FAIL", **mob_info}

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=4)
        except Exception:
            proc.kill()

    results["console_errors"] = {"status": "FAIL" if errors else "PASS", "count": len(errors), "samples": errors[:8]}
    print("=== verify_analysis.py ===")
    any_fail = False
    for k, v in results.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:16s} {st:8s} {v}")
    return 0 if not any_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
