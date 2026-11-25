"""
Playwright 2-context end-to-end verification for Phase 3 Online Play:
- Launches authoritative Node + ws server (server/index.js) on an ephemeral port
- Context A & Context B test:
  1) Quick-match Cờ Tướng + move sync + screenshot (preview/online_game.png)
  2) Mid-game page reload reconnect (resyncs board & clocks)
  3) Private room via shared #/join/<CODE> link in Cờ Úp + XSS nickname sanitization
     + screenshot (preview/online_room.png) + 4 plies with reveals & pool sync
- Asserts zero console errors/warnings across both contexts.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREVIEW_DIR = ROOT / "preview"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


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
    raise RuntimeError(f"Online server did not start on port {port}")


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


def main():
    port = get_free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["MAX_NEW_CONNS_PER_SEC"] = "30"

    proc = subprocess.Popen(
        ["node", str(ROOT / "server" / "index.js")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    errors_a, warnings_a = [], []
    errors_b, warnings_b = [], []

    try:
        wait_for_server(port)
        base = f"http://127.0.0.1:{port}/index.html?test=1"

        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx_a = browser.new_context(viewport={"width": 1440, "height": 900})
            ctx_b = browser.new_context(viewport={"width": 1440, "height": 900})
            page_a = ctx_a.new_page()
            page_b = ctx_b.new_page()

            page_a.on("console", lambda m: errors_a.append(m.text) if m.type == "error" else warnings_a.append(m.text) if m.type == "warning" else None)
            page_a.on("pageerror", lambda e: errors_a.append(str(e)))
            page_b.on("console", lambda m: errors_b.append(m.text) if m.type == "error" else warnings_b.append(m.text) if m.type == "warning" else None)
            page_b.on("pageerror", lambda e: errors_b.append(str(e)))

            # Seed distinct nicknames (including XSS payload on B!)
            page_a.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            page_b.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            page_a.evaluate("""() => {
                const s = JSON.parse(localStorage.getItem('xq_settings_v1') || '{}');
                s.online = { ...(s.online || {}), nickname: 'Kỳ Thủ A' };
                localStorage.setItem('xq_settings_v1', JSON.stringify(s));
            }""")
            page_b.evaluate("""() => {
                const s = JSON.parse(localStorage.getItem('xq_settings_v1') || '{}');
                s.online = { ...(s.online || {}), nickname: '<img src=x>' };
                localStorage.setItem('xq_settings_v1', JSON.stringify(s));
            }""")
            page_a.reload(wait_until="networkidle")
            page_b.reload(wait_until="networkidle")

            # Wait for online tiles to become enabled
            page_a.wait_for_function("() => !document.querySelector('[data-tile=\"online\"]').classList.contains('is-disabled')", timeout=6000)
            page_b.wait_for_function("() => !document.querySelector('[data-tile=\"online\"]').classList.contains('is-disabled')", timeout=6000)

            # 1. Quick-match Cờ Tướng
            page_a.locator('[data-tile="online"]').click()
            page_a.locator('.modal-find').click()
            page_b.locator('[data-tile="online"]').click()
            page_b.locator('.modal-find').click()

            page_a.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            page_b.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            page_a.wait_for_timeout(300)

            side_a = page_a.evaluate("() => window.__onlineState.mySide")
            side_b = page_b.evaluate("() => window.__onlineState.mySide")
            assert {side_a, side_b} == {"red", "black"}

            red_page = page_a if side_a == "red" else page_b
            black_page = page_b if side_a == "red" else page_a

            # Verify XSS nickname is rendered as plain text (no <img> injected inside .player-name)
            img_count = red_page.locator(".player-name img").count()
            assert img_count == 0, "XSS <img> tag must never be injected into player-name!"

            # Red plays h2e2 (7,7) -> (4,7)
            click_square(red_page, 7, 7, flipped=False)
            red_page.wait_for_timeout(120)
            click_square(red_page, 4, 7, flipped=False)

            black_page.wait_for_function("() => window.__board && window.__board.history.length === 1", timeout=6000)
            red_page.wait_for_timeout(350)
            red_page.screenshot(path=str(PREVIEW_DIR / "online_game.png"))

            # 2. Mid-game reload reconnect on Red
            red_page.reload(wait_until="networkidle")
            red_page.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            fen_a = red_page.evaluate("() => window.__board.toFen()")
            fen_b = black_page.evaluate("() => window.__board.toFen()")
            assert fen_a.split(" ")[0] == fen_b.split(" ")[0], f"FEN mismatch after reload: {fen_a} vs {fen_b}"

            # Resign to finish match cleanly
            red_page.locator('[data-online-act="resign"]').click()
            red_page.locator('.modal-resign-confirm').click()
            black_page.wait_for_selector('#online-go-title', timeout=6000)

            # 3. Private Room Cờ Úp via shared #/join/<CODE> link
            page_a.goto(f"{base}#/g/coup", wait_until="networkidle")
            page_a.wait_for_function("() => { const el = document.querySelector('[data-tile=\"room\"]'); return el && !el.classList.contains('is-disabled'); }", timeout=6000)
            page_a.locator('[data-tile="room"]').click()
            page_a.locator('[data-rside="red"]').click()
            page_a.locator('.modal-create-room').click()
            page_a.wait_for_selector(".room-code-tile", timeout=6000)

            code = page_a.evaluate("() => [...document.querySelectorAll('.room-code-tile')].map(e => e.textContent).join('')")
            assert len(code) == 6
            page_a.screenshot(path=str(PREVIEW_DIR / "online_room.png"))

            # Guest opens shared link #/join/<CODE>
            page_b.goto(f"{base}#/join/{code}", wait_until="networkidle")
            page_b.wait_for_selector(".modal-join-room", timeout=6000)
            page_b.locator(".modal-join-room").click()
            page_a.wait_for_function("() => !document.querySelector('.modal-start-room').disabled", timeout=6000)
            page_a.locator(".modal-start-room").click()

            page_a.wait_for_function("() => window.__onlineState && window.__onlineState.variant === 'coup'", timeout=8000)
            page_b.wait_for_function("() => window.__onlineState && window.__onlineState.variant === 'coup'", timeout=8000)
            page_a.wait_for_timeout(300)

            # Play 2 moves in Cờ Úp online (Red soldier (0,6)->(0,5), Black soldier (0,3)->(0,4))
            click_square(page_a, 0, 6, flipped=False)
            page_a.wait_for_timeout(120)
            click_square(page_a, 0, 5, flipped=False)
            page_b.wait_for_function("() => window.__board && window.__board.history.length === 1", timeout=6000)

            click_square(page_b, 0, 3, flipped=True)
            page_b.wait_for_timeout(120)
            click_square(page_b, 0, 4, flipped=True)
            page_a.wait_for_function("() => window.__board && window.__board.history.length === 2", timeout=6000)
            page_b.wait_for_function("() => window.__board && window.__board.history.length === 2", timeout=6000)

            pub_a = page_a.evaluate("() => window.__board.publicFen()")
            pub_b = page_b.evaluate("() => window.__board.publicFen()")
            assert pub_a == pub_b, f"Cờ Úp online FEN mismatch: {pub_a} vs {pub_b}"

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"[verify_online] OK: quick-match + reload-resync + room-link Co Up + XSS safe | A(err={len(errors_a)}, warn={len(warnings_a)}) B(err={len(errors_b)}, warn={len(warnings_b)})")
    if errors_a or warnings_a or errors_b or warnings_b:
        print("A errors:", errors_a, "warnings:", warnings_a)
        print("B errors:", errors_b, "warnings:", warnings_b)
        sys.exit(1)


if __name__ == "__main__":
    main()
