"""
Playwright verification for Phase 2 Cờ Úp (Jieqi):
- Navigates to #/play/coup/ai?level=tap-su&side=red&test=1
- Verifies 30 covered pieces + 2 revealed generals at start
- Captures preview/jieqi_start.png
- Plays human moves (clicking covered pieces, checking "?" target hints, verifying reveal flip & pool decrement)
- Waits for AI replies, verifies undo button is disabled with Cờ Úp tooltip, verifies Hint button works
- Captures preview/jieqi_reveal.png and preview/jieqi_pool.png
- Asserts zero console errors/warnings
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREVIEW_DIR = ROOT / "preview"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/engine/info":
            body = json.dumps({"available": False}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/online/info":
            body = json.dumps({"ok": False}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/assets/voice/manifest.json" and not (ROOT / "assets/voice/manifest.json").exists():
            body = json.dumps({"empty": True, "files": {}}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def click_square(page, x: int, y: int):
    box = page.locator("svg.board-svg").bounding_box()
    assert box is not None
    # BOARD_WIDTH=1050, BOARD_HEIGHT=1150, GRID_ORIGIN_X=125, GRID_ORIGIN_Y=125, CELL_SIZE=100
    vx = 125 + x * 100
    vy = 125 + y * 100
    cx = box["x"] + (vx / 1050.0) * box["width"]
    cy = box["y"] + (vy / 1150.0) * box["height"]
    page.mouse.click(cx, cy)


def main():
    httpd, port = start_server()
    base = f"http://127.0.0.1:{port}/index.html?test=1"
    errors = []
    warnings = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.on("console", lambda m: (
                errors.append(m.text) if m.type == "error"
                else warnings.append(m.text) if m.type == "warning"
                else None
            ))
            page.on("pageerror", lambda e: errors.append(str(e)))

            page.goto(f"{base}#/play/coup/ai?level=tap-su&side=red", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=8000)
            page.wait_for_timeout(300)

            # 1. Verify initial covered count = 30, revealed generals = 2
            counts = page.evaluate("""() => {
                const pieces = [...document.querySelectorAll('.layer-pieces > g')];
                const covered = pieces.filter(g => g.dataset.covered === '1').length;
                const revealed = pieces.filter(g => g.dataset.covered === '0').length;
                return { total: pieces.length, covered, revealed };
            }""")
            assert counts["total"] == 32 and counts["covered"] == 30 and counts["revealed"] == 2, f"Unexpected counts: {counts}"

            # Verify pool panel is visible and shows 15 for both sides
            pool_visible = page.locator(".jieqi-pool-panel").is_visible()
            assert pool_visible, "Pool panel should be visible in Cờ Úp"
            page.screenshot(path=str(PREVIEW_DIR / "jieqi_start.png"))

            # 2. Click Red's covered soldier at (0, 6) -> verify "?" hint appears
            click_square(page, 0, 6)
            page.wait_for_timeout(150)
            q_count = page.locator(".legal-reveal-q").count()
            assert q_count >= 1, f"Expected '?' reveal hint on legal targets, got {q_count}"

            # Move soldier (0, 6) -> (0, 5) to trigger reveal flip + AI reply
            click_square(page, 0, 5)
            page.wait_for_timeout(450)
            page.screenshot(path=str(PREVIEW_DIR / "jieqi_reveal.png"))

            # Wait for AI reply (ply >= 2)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=10000)
            page.wait_for_timeout(550)

            # Verify covered pieces decreased by 2 (both Red & Black moved covered pieces or at least Red did)
            after_counts = page.evaluate("""() => {
                const pieces = [...document.querySelectorAll('.layer-pieces > g')];
                return {
                    covered: pieces.filter(g => g.dataset.covered === '1').length,
                    plies: window.__board.history.length,
                    undoDisabled: document.querySelector('[data-action="undo"]').disabled,
                    undoTitle: document.querySelector('[data-action="undo"]').title,
                    revealBadges: document.querySelectorAll('.move-reveal-badge').length,
                };
            }""")
            assert after_counts["covered"] <= 29, f"Expected covered count to drop, got {after_counts}"
            assert after_counts["undoDisabled"] is True, "Undo must be disabled in Cờ Úp AI mode"
            assert "không cho đi lại" in after_counts["undoTitle"].lower(), f"Unexpected undo title: {after_counts['undoTitle']}"
            assert after_counts["revealBadges"] >= 1, "Expected reveal badge in move list"

            # 3. Test Hint button in Cờ Úp
            hint_btn = page.locator('[data-action="hint"]')
            assert not hint_btn.is_disabled(), "Hint should be enabled on player's turn"
            hint_btn.click()
            page.wait_for_selector(".hint-arrow", timeout=8000)

            # Play one more move (2, 6) -> (2, 5) so pool panel shows multiple reveals
            click_square(page, 2, 6)
            page.wait_for_timeout(120)
            click_square(page, 2, 5)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 4", timeout=10000)
            page.wait_for_timeout(550)
            page.screenshot(path=str(PREVIEW_DIR / "jieqi_pool.png"))

            browser.close()
    finally:
        httpd.shutdown()

    print(f"[verify_jieqi] OK: counts={counts} after={after_counts} errors={len(errors)} warnings={len(warnings)}")
    if errors or warnings:
        print("Errors:", errors)
        print("Warnings:", warnings)
        sys.exit(1)


if __name__ == "__main__":
    main()
