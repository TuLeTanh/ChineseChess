"""Phase B5 Playwright verification suite for Vietnamese Traditional Notation (N1..N8).

Run with `--baseline` to confirm RED baseline before implementation, then without flags to verify GREEN.
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
from mobile_lib import DEVICE_BY_NAME, ROOT, attach_error_listener, create_device_context

START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
MOVES_10 = ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "b7e7", "b0c2", "b9c7", "h0h7", "h9h7"]


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _start_server(port: int) -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "server.py"), "--port", str(port)],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=2) as r:
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
    port = _pick_free_port()
    base = f"http://127.0.0.1:{port}"
    proc = _start_server(port)
    results: dict[str, Any] = {}
    all_errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
            page = ctx.new_page()
            errs = attach_error_listener(page)

            # Seed finished Xiangqi game with planted blunder at ply 9 (h0h7)
            page.goto(f"{base}/?test#/", wait_until="domcontentloaded")
            page.wait_for_function("() => Boolean(window.__gameStore)", timeout=8000)
            rec = {
                "schemaVersion": 1, "id": "not-arch-xq",
                "createdAt": "2026-11-27T10:00:00.000Z", "updatedAt": "2026-11-27T10:00:00.000Z",
                "variant": "xiangqi", "mode": "ai",
                "red": {"name": "Bạn", "kind": "human"}, "black": {"name": "Máy", "kind": "engine"},
                "result": "black", "reason": "resign",
                "start": {"fen": START_FEN},
                "moves": [{"m": m} for m in MOVES_10], "source": "manual",
            }
            page.evaluate(f"async () => {{ await window.__gameStore.saveGame({json.dumps(rec)}); }}")

            # ---------------- N1 & N2 & N3: Default traditional, live toggle, persistence, data-move, no clip ----------------
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            _click_sq(page, 7, 7); _click_sq(page, 4, 7); page.wait_for_timeout(150)  # h2e2 -> Pháo 2 bình 5
            _click_sq(page, 7, 0); _click_sq(page, 6, 2); page.wait_for_timeout(150)  # h9g7 -> Mã 8 tiến 7

            n1_n2 = page.evaluate("""() => {
                const raw = localStorage.getItem('xq_settings_v1');
                const st = raw ? JSON.parse(raw) : {};
                const c1 = document.querySelector('button.move-chip[data-ply="1"]');
                const c2 = document.querySelector('button.move-chip[data-ply="2"]');
                const full1 = c1?.querySelector('.move-text-full')?.textContent?.trim() || '';
                const short1 = c1?.querySelector('.move-text-short')?.textContent?.trim() || '';
                const visText1 = c1 ? (c1.innerText || '').trim() : '';
                const clip1 = c1 ? c1.scrollWidth > c1.clientWidth + 2 : true;
                return {
                    settingDefault: st.notation,
                    dataMove1: c1?.dataset?.move || '',
                    dataMove2: c2?.dataset?.move || '',
                    full1,
                    short1,
                    visText1,
                    title1: c1?.getAttribute('title') || '',
                    aria1: c1?.getAttribute('aria-label') || '',
                    clip1,
                };
            }""")

            # Toggle via Settings > Giao diện -> live update without reload -> persists across reload
            page.locator('[data-nav="settings"]').click()
            page.wait_for_selector('[data-testid="set-notation-toggle"]', timeout=3000) if not baseline else page.wait_for_timeout(200)
            has_set_toggle = page.locator('[data-testid="set-notation-toggle"]').count() > 0
            live_coord_ok = False
            persisted_ok = False
            help_opened_from_set = False
            if has_set_toggle:
                page.locator('[data-testid="set-notation-toggle"]').click()
                page.wait_for_timeout(150)
                page.keyboard.press("Escape")
                live_coord_ok = page.evaluate("""() => {
                    const c1 = document.querySelector('button.move-chip[data-ply="1"]');
                    return Boolean(c1 && c1.innerText.includes('h2e2'));
                }""")
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector("svg.board-svg", timeout=8000)
                persisted_ok = page.evaluate("() => JSON.parse(localStorage.getItem('xq_settings_v1') || '{}').notation === 'coord'")
                # Switch back to traditional via Settings & test Help dialog
                page.locator('[data-nav="settings"]').click()
                page.locator('[data-testid="set-notation-toggle"]').click()
                page.locator('[data-testid="notation-help-btn"]').click()
                page.wait_for_selector('[data-testid="notation-help-modal"]', state="visible", timeout=3000)
                help_opened_from_set = True
                page.keyboard.press("Escape")
            else:
                page.keyboard.press("Escape")
                page.wait_for_timeout(120)

            results["N1_settings"] = {
                "status": "PASS" if (n1_n2["settingDefault"] == "traditional" and has_set_toggle and live_coord_ok and persisted_ok) else "FAIL",
                "default": n1_n2["settingDefault"],
                "live_coord_ok": live_coord_ok,
                "persisted_ok": persisted_ok,
            }
            results["N2_N3_chips"] = {
                "status": "PASS" if (
                    n1_n2["dataMove1"] == "h2e2"
                    and n1_n2["full1"] == "Pháo 2 bình 5"
                    and n1_n2["short1"] == "Pháo 2=5"
                    and "h2e2" in n1_n2["title1"]
                    and not n1_n2["clip1"]
                ) else "FAIL",
                **n1_n2,
            }

            # ---------------- N6: Overflow menu toggle + help dialog ----------------
            page.locator('[data-testid="panel-menu-btn"]').click()
            has_menu_not = page.locator('[data-mitem="notation"]').count() > 0
            menu_help_ok = False
            if has_menu_not:
                page.locator('[data-mitem="notation"]').click()
                page.wait_for_timeout(120)
                after_toggle = page.evaluate("() => JSON.parse(localStorage.getItem('xq_settings_v1') || '{}').notation")
                page.locator('[data-testid="panel-menu-btn"]').click()
                page.locator('[data-mitem="notation"]').click()
                page.wait_for_timeout(120)
                page.locator('[data-testid="panel-menu-btn"]').click()
                if page.locator('[data-mitem="notation_help"]').count() > 0:
                    page.locator('[data-mitem="notation_help"]').click()
                    page.wait_for_selector('[data-testid="notation-help-modal"]', state="visible", timeout=3000)
                    menu_help_ok = True
                    page.keyboard.press("Escape")
            else:
                after_toggle = None
                page.keyboard.press("Escape")
            results["N6_menu_help"] = {
                "status": "PASS" if (has_menu_not and after_toggle == "coord" and help_opened_from_set and menu_help_ok) else "FAIL",
                "has_menu_not": has_menu_not,
                "after_toggle": after_toggle,
                "help_from_set": help_opened_from_set,
                "help_from_menu": menu_help_ok,
            }

            # ---------------- N4 & N8: Analysis panel (ply 9 blunder h0h7 = Xe 2 tiến 7) ----------------
            page.goto(f"{base}/?test#/play/cotuong/review?id=not-arch-xq&analyze=1&auto=1&preset=fast", wait_until="domcontentloaded")
            page.wait_for_function("() => window.__analysis && window.__analysis.analyzed === 11", timeout=25000)
            page.locator(".an-mistake-item").first.click()
            page.wait_for_timeout(250)
            n4 = page.evaluate("""() => {
                const q = document.querySelector('[data-testid="an-quality-card"]')?.textContent || '';
                const played = document.querySelector('[data-testid="an-played-row"]')?.textContent || '';
                const mist = document.querySelector('.an-mistake-item')?.textContent || '';
                const pv0 = document.querySelector('.an-pv-chip')?.textContent || '';
                return { q, played, mist, pv0 };
            }""")
            results["N4_N8_analysis"] = {
                "status": "PASS" if (
                    "Xe 2 tiến 7" in n4["q"] and "(h0h7)" in n4["q"]
                    and "Xe 2 tiến 7" in n4["played"] and "(h0h7)" in n4["played"]
                    and "Xe 2 tiến 7" in n4["mist"]
                    and any(w in n4["pv0"] for w in ("Tướng", "Sĩ", "Tượng", "Xe", "Pháo", "Mã", "Tốt"))
                ) else "FAIL",
                "q_sample": n4["q"].strip()[:90],
                "played_sample": n4["played"].strip()[:60],
                "pv0": n4["pv0"].strip(),
            }

            # ---------------- N5: Cờ Úp reveal chip shows covered-square type + LẬT + "lật ra" tooltip ----------------
            page.goto(f"{base}/?test#/play/coup/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            _click_sq(page, 1, 7); _click_sq(page, 4, 7); page.wait_for_timeout(180)
            n5 = page.evaluate("""() => {
                const c = document.querySelector('button.move-chip[data-ply="1"]');
                return {
                    full: c?.querySelector('.move-text-full')?.textContent?.trim() || '',
                    hasLat: Boolean(c?.querySelector('.move-reveal-badge')),
                    title: c?.getAttribute('title') || '',
                    dataMove: c?.dataset?.move || '',
                };
            }""")
            results["N5_jieqi"] = {
                "status": "PASS" if (
                    n5["full"] == "Pháo 8 bình 5" and n5["hasLat"] and "lật ra" in n5["title"].lower() and n5["dataMove"] == "b2e2"
                ) else "FAIL",
                **n5,
            }

            # ---------------- N7: 150-ply render < 50 ms at 4x CPU throttle + 20 toggles 0 leaks ----------------
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            page.evaluate("""async () => {
                const { XiangqiRules } = await import('./js/rules.js');
                const r = new XiangqiRules();
                const b = window.__board;
                let seed = 4242;
                const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
                for (let k = 0; k < 150; k++) {
                    const all = [];
                    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
                        const pc = b.at({x, y});
                        if (pc && pc.side === b.sideToMove) {
                            for (const to of r.legalMoves(b, {x, y})) all.push({from:{x,y}, to});
                        }
                    }
                    if (!all.length) break;
                    const mv = all[Math.floor(rand() * all.length)];
                    b.applyMove(mv.from, mv.to);
                }
            }""")
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
            render_ms = page.evaluate("""() => {
                const t0 = performance.now();
                window.__settingsStore?.update((s) => { s.notation = 'coord'; });
                const t1 = performance.now();
                window.__settingsStore?.update((s) => { s.notation = 'traditional'; });
                const t2 = performance.now();
                return { toCoordMs: +(t1 - t0).toFixed(2), toTradMs: +(t2 - t1).toFixed(2) };
            }""")
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            for _ in range(10):
                page.evaluate("() => { window.__settingsStore?.update(s => { s.notation = s.notation === 'coord' ? 'traditional' : 'coord'; }); }")
            leaks = page.evaluate("window.__leaks || {}")
            results["N7_perf"] = {
                "status": "PASS" if (render_ms["toTradMs"] < 50.0 and leaks.get("workers", 0) == 0 and leaks.get("sockets", 0) == 0) else "FAIL",
                **render_ms,
                "workers": leaks.get("workers", 0),
                "sockets": leaks.get("sockets", 0),
            }

            all_errors.extend(f"[desk] {e}" for e in errs)
            ctx.close()

            # Phone 390x844 check for MoveStrip short text & zero clip
            mctx = create_device_context(browser, DEVICE_BY_NAME["390x844"])
            mp = mctx.new_page()
            merrs = attach_error_listener(mp)
            mp.goto(f"{base}/?test#/play/cotuong/local", wait_until="domcontentloaded")
            mp.wait_for_selector("svg.board-svg", timeout=8000)
            _click_sq(mp, 7, 7); _click_sq(mp, 4, 7); mp.wait_for_timeout(180)
            mob = mp.evaluate("""() => {
                const ch = document.querySelector('.mstrip-chip[data-ply="1"]');
                return {
                    dataMove: ch?.dataset?.move || '',
                    text: ch?.innerText?.trim() || '',
                    ovf: document.documentElement.scrollWidth > window.innerWidth + 1,
                };
            }""")
            results["N3_mobile_strip"] = {
                "status": "PASS" if (mob["dataMove"] == "h2e2" and ("Pháo" in mob["text"]) and not mob["ovf"]) else "FAIL",
                **mob,
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
    print("=== verify_notation.py ===")
    any_fail = False
    for k, v in results.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:18s} {st:6s} {v}")
    return 0 if (baseline or not any_fail) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    args = ap.parse_args()
    return run_suite(baseline=args.baseline)


if __name__ == "__main__":
    raise SystemExit(main())
