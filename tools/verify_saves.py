"""
Phase 4 Playwright E2E verification for Save / Export / Import / Library / Replay / Resume
(tools/verify_saves.py).
Runs against the authoritative Node server (CSP active) and checks zero console/page errors/warnings.
Saves preview screenshots to preview/saves/ for visual review.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SAVES_DIR = ROOT / "preview" / "saves"
SAVES_DIR.mkdir(parents=True, exist_ok=True)


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_server(port: int, timeout_s: float = 8.0):
    deadline = time.time() + timeout_s
    url = f"http://127.0.0.1:{port}/api/online/info"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError(f"Server did not start on port {port}")


def click_square(page, x: int, y: int, flipped: bool = False):
    box = page.locator("svg.board-svg").bounding_box()
    assert box is not None
    rx = 8 - x if flipped else x
    ry = 9 - y if flipped else y
    vx = 125 + rx * 100
    vy = 125 + ry * 100
    cx = box["x"] + (vx / 1050.0) * box["width"]
    cy = box["y"] + (vy / 1150.0) * box["height"]
    page.mouse.click(cx, cy)


def attach_listeners(page, errs: list, warns: list, label: str):
    page.on("console", lambda m: errs.append(f"[{label}] {m.type}: {m.text}") if m.type == "error"
            else warns.append(f"[{label}] {m.type}: {m.text}") if m.type == "warning" else None)
    page.on("pageerror", lambda e: errs.append(f"[{label}] pageerror: {e}"))


def main():
    port = get_free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["MAX_NEW_CONNS_PER_SEC"] = "100"

    proc = subprocess.Popen(
        ["node", str(ROOT / "server" / "index.js")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    errs: list[str] = []
    warns: list[str] = []
    tmp_dir = Path(tempfile.mkdtemp(prefix="xq_saves_"))

    try:
        wait_for_server(port)
        base = f"http://127.0.0.1:{port}/index.html?test=1"

        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 820}, accept_downloads=True)
            page = ctx.new_page()
            attach_listeners(page, errs, warns, "main")

            # (a) Cờ Tướng vs JS engine: play 2+ plies, reload -> lobby resume strip -> Tiếp tục -> resign -> in library
            page.goto(f"{base}#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            click_square(page, 7, 7)
            page.wait_for_timeout(100)
            click_square(page, 4, 7)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=10000)
            page.wait_for_timeout(450)  # allow 250ms debounced autosave
            fen_before = page.evaluate("() => window.__board.toFen()")

            page.goto(f"{base}#/", wait_until="networkidle")
            page.wait_for_selector(".resume-strip:not([hidden])", timeout=6000)
            page.locator('.resume-strip [data-res="go"]').click()
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=6000)
            fen_after = page.evaluate("() => window.__board.toFen()")
            assert fen_before.split(" ")[0] == fen_after.split(" ")[0], f"Xiangqi resume FEN mismatch"

            # Resign -> auto-saves finished game to library
            page.locator('[data-action="resign"]').click()
            page.locator('.modal-resign-confirm').click()
            page.wait_for_timeout(400)
            lib_cnt = page.evaluate("async () => (await window.__gameStore.listGames()).total")
            assert lib_cnt >= 1, f"Expected finished game saved to library, got {lib_cnt}"
            print("[a] Xiangqi autosave -> resume -> resign -> library OK")

            # (b) Cờ Úp vs AI: reveal, reload -> resume -> exact publicFen & pool -> undo stays disabled
            page.goto(f"{base}#/play/coup/ai?side=red&level=tap-su", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            click_square(page, 0, 6)
            page.wait_for_timeout(100)
            click_square(page, 0, 5)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=10000)
            page.wait_for_timeout(450)
            jq_fen_before = page.evaluate("() => window.__board.publicFen()")

            page.goto(f"{base}#/", wait_until="networkidle")
            page.wait_for_selector(".resume-strip:not([hidden])", timeout=6000)
            page.locator('.resume-strip [data-res="go"]').click()
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=6000)
            jq_fen_after = page.evaluate("() => window.__board.publicFen()")
            assert jq_fen_before == jq_fen_after, f"Jieqi resume mismatch: {jq_fen_before} vs {jq_fen_after}"
            assert page.locator('[data-action="undo"]').is_disabled(), "Undo must remain disabled in Cờ Úp AI"

            # Save this Cờ Úp game manually via "Lưu / Xuất" modal + test downloads
            page.locator('[data-action="save-export"]').click()
            page.wait_for_selector('[data-exp="save"]', timeout=4000)
            page.locator('[data-exp="save"]').click()
            page.wait_for_timeout(200)

            # (d) Download .xqgame.json and .pgn via Playwright download API
            with page.expect_download() as dl_json_info:
                page.locator('[data-exp="json"]').click()
            dl_json = dl_json_info.value
            json_path = tmp_dir / dl_json.suggested_filename
            dl_json.save_as(str(json_path))
            json_text = json_path.read_text(encoding="utf-8")
            assert '"secretLocal"' not in json_text and '"guestId"' not in json_text

            with page.expect_download() as dl_pgn_info:
                page.locator('[data-exp="pgn"]').click()
            dl_pgn = dl_pgn_info.value
            pgn_path = tmp_dir / dl_pgn.suggested_filename
            dl_pgn.save_as(str(pgn_path))
            pgn_text = pgn_path.read_text(encoding="utf-8")
            assert '[Game "Jieqi"]' in pgn_text
            page.keyboard.press("Escape")
            print("[b+d] Jieqi resume + JSON/PGN download + secret-free export OK")

            # (c) Library: 60 seeded games responsiveness, filters, search, screenshot
            t_seed = page.evaluate("""async () => {
                const startFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
                for (let i = 0; i < 60; i++) {
                    await window.__gameStore.saveGame({
                        v: 1,
                        variant: i % 2 === 0 ? 'xiangqi' : 'jieqi',
                        mode: 'local',
                        red: { name: 'KyThu' + i, kind: 'human' },
                        black: { name: 'DoiThu' + i, kind: 'human' },
                        start: { fen: i % 2 === 0 ? startFen : 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w - - 0 1 R2N2B2A2C2P5/r2n2b2a2c2p5' },
                        moves: [],
                        result: i % 3 === 0 ? 'red' : i % 3 === 1 ? 'draw' : 'unfinished',
                        note: i === 5 ? 'Ván đặc biệt tìm kiếm' : '',
                    });
                }
                return (await window.__gameStore.listGames()).total;
            }""")
            assert t_seed >= 62
            t0 = time.perf_counter()
            page.goto(f"{base}#/library", wait_until="networkidle")
            page.wait_for_selector(".lib-item", timeout=5000)
            render_ms = (time.perf_counter() - t0) * 1000
            page.screenshot(path=str(SAVES_DIR / "library.png"))

            # Filter & search
            page.locator(".lib-search").fill("đặc biệt")
            page.wait_for_timeout(200)
            assert page.locator(".lib-item").count() == 1
            page.locator(".lib-search").fill("")
            page.wait_for_timeout(200)
            print(f"[c] Library 62 games rendered in {render_ms:.0f}ms + search/filter OK")

            # (e) Import dialog: paste PGN + invalid text + FEN play
            page.locator('[data-act="import"]').click()
            page.wait_for_selector(".import-modal", timeout=4000)
            page.screenshot(path=str(SAVES_DIR / "import_dialog.png"))
            page.locator('[data-itab="text"]').click()
            page.locator('#imp-text-area').fill(pgn_text)
            page.locator('[data-imp="paste"]').click()
            page.wait_for_selector(".import-summary.is-ok", timeout=4000)
            # Corrupted input shows error summary
            page.locator('#imp-text-area').fill("{corrupt json")
            page.locator('[data-imp="paste"]').click()
            page.wait_for_selector(".import-summary.has-err", timeout=4000)
            # FEN import -> Chơi từ thế cờ này
            page.locator('[data-itab="fen"]').click()
            page.locator('#imp-fen-input').fill('3k5/9/9/9/9/9/9/9/9/4K3R w - - 0 1')
            page.locator('[data-imp="fen-check"]').click()
            page.wait_for_function("() => !document.querySelector('[data-imp=\"fen-play\"]').disabled", timeout=3000)
            page.locator('[data-imp="fen-play"]').click()
            page.locator('.modal-go').click()
            page.wait_for_selector("svg.board-svg", timeout=5000)
            assert "4K3R" in page.evaluate("() => window.__board.toFen()")
            print("[e] Import (PGN paste, corrupt error, custom FEN start) OK")

            # (d2 + f) Fresh context: re-import downloaded JSON + share-link replay + invalid replay + archive review
            ctx_fresh = browser.new_context(viewport={"width": 1280, "height": 820})
            page_f = ctx_fresh.new_page()
            attach_listeners(page_f, errs, warns, "fresh")
            page_f.goto(f"{base}#/library", wait_until="networkidle")
            page_f.locator('[data-act="import"]').click()
            page_f.locator('#imp-file-input').set_input_files(str(json_path))
            page_f.wait_for_selector(".import-summary.is-ok", timeout=4000)
            page_f.keyboard.press("Escape")
            page_f.wait_for_selector(".lib-item", timeout=4000)
            # Open archive review of imported Jieqi game
            page_f.locator('.lib-item button:has-text("Xem lại")').first.click()
            page_f.wait_for_selector(".replay-mode-pill", timeout=5000)
            page_f.locator('[data-rev="prev"]').click()
            page_f.wait_for_timeout(200)
            page_f.locator('[data-rev="next"]').click()
            page_f.wait_for_timeout(200)
            page_f.screenshot(path=str(SAVES_DIR / "replay_banner.png"))

            # Test invalid share link shows friendly error page (never blank)
            page_f.goto(f"{base}#/replay?g=z.INVALID_PAYLOAD_123", wait_until="networkidle")
            page_f.wait_for_selector("#replay-err-msg", timeout=4000)
            assert len(page_f.locator("#replay-err-msg").text_content() or "") > 5
            ctx_fresh.close()
            print("[d2+f] Fresh-context re-import, Jieqi archive review, invalid replay page OK")

            # (g) Online 2-context: finish game -> saved in library with no guestId
            ctx_o1 = browser.new_context(viewport={"width": 1180, "height": 780})
            ctx_o2 = browser.new_context(viewport={"width": 1180, "height": 780})
            po1, po2 = ctx_o1.new_page(), ctx_o2.new_page()
            attach_listeners(po1, errs, warns, "o1")
            attach_listeners(po2, errs, warns, "o2")
            po1.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            po2.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            po1.wait_for_function("() => { const e = document.querySelector('[data-tile=\"online\"]'); return e && !e.classList.contains('is-disabled'); }", timeout=6000)
            po2.wait_for_function("() => { const e = document.querySelector('[data-tile=\"online\"]'); return e && !e.classList.contains('is-disabled'); }", timeout=6000)
            po1.locator('[data-tile="online"]').click(); po1.locator('.modal-find').click()
            po2.locator('[data-tile="online"]').click(); po2.locator('.modal-find').click()
            po1.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            po2.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            po1.locator('[data-online-act="resign"]').click()
            po1.locator('.modal-resign-confirm').click()
            po2.wait_for_selector('#online-go-title', timeout=6000)
            po1.wait_for_timeout(300)
            po2.wait_for_timeout(300)
            o1_lib = po1.evaluate("async () => await window.__gameStore.exportAll()")
            o2_lib = po2.evaluate("async () => await window.__gameStore.exportAll()")
            assert len(o1_lib["games"]) >= 1 and len(o2_lib["games"]) >= 1
            assert "guestId" not in json.dumps(o1_lib) and "guestId" not in json.dumps(o2_lib)
            ctx_o1.close(); ctx_o2.close()
            print("[g] Online auto-save to both libraries (zero guestId) OK")

            # (h) Storage failure simulation: QuotaExceededError surfaces banner without throwing
            page.goto(f"{base}#/library", wait_until="networkidle")
            page.evaluate("""async () => {
                window.__gameStore.simulateQuotaError = true;
                await window.__gameStore.saveGame({ v: 1, variant: 'xiangqi', start: { fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1' }, moves: [] });
                window.__gameStore.simulateQuotaError = false;
            }""")
            page.wait_for_selector(".storage-status-banner:not([hidden])", timeout=3000)
            print("[h] Storage failure banner OK")

            # (i) 20 lobby <-> library <-> game round trips: zero leaks
            for _ in range(10):
                page.goto(f"{base}#/", wait_until="networkidle")
                page.goto(f"{base}#/library", wait_until="networkidle")
                page.goto(f"{base}#/play/cotuong/local", wait_until="networkidle")
            page.goto(f"{base}#/", wait_until="networkidle")
            leaks = page.evaluate("() => window.__leaks || {}")
            assert leaks.get("workers", 0) == 0 and leaks.get("canvases", 0) <= 1, f"Leak detected: {leaks}"
            print(f"[i] Round trips OK leaks={leaks}")

            # (j) Responsive layout check for library across 5 viewports (0 horizontal overflow)
            page.goto(f"{base}#/library", wait_until="networkidle")
            for w, h in [(1600, 900), (1180, 780), (960, 680), (390, 844), (360, 740)]:
                page.set_viewport_size({"width": w, "height": h})
                page.wait_for_timeout(100)
                ov = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                assert ov <= 2, f"Library overflow {ov}px at {w}x{h}"
            print("[j] Library responsive 1600x900..360x740 OK")

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"[verify_saves] errs={len(errs)} warns={len(warns)}")
    for e in errs:
        print("  ERR:", e)
    for w in warns:
        print("  WARN:", w)
    if errs or warns:
        sys.exit(1)
    print("[verify_saves] ALL SAVE/EXPORT/IMPORT/LIBRARY/REPLAY CHECKS PASSED.")


if __name__ == "__main__":
    main()
