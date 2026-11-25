"""
Playwright race-condition verification suite for Chinese Chess.
Tests game-state integrity under concurrent UI actions and async engine replies:
  1. Engine reply after Undo
  2. Engine reply after New Game
  3. Engine reply after Truncate ("Chơi tiếp từ đây")
  4. Engine reply after Resign
  5. Rapid clicks during animation & AI thinking
  6. Tab visibilitychange (hidden -> visible) during AI search & cinematic
  7. Switching AI level mid-search
  8. Mode switch (ai -> pvp -> ai) closing and recreating Worker
"""
import functools
import http.server
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/api/engine/info"):
            body = b'{"available":false,"options":[]}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def board_point(page, x, y):
    rect = page.locator("svg.board-svg").bounding_box()
    bx = 125 + x * 100
    by = 125 + y * 100
    return rect["x"] + (bx / 1050.0) * rect["width"], rect["y"] + (by / 1150.0) * rect["height"]


def click_move(page, x1, y1, x2, y2):
    p1 = board_point(page, x1, y1)
    p2 = board_point(page, x2, y2)
    page.mouse.click(*p1)
    page.wait_for_timeout(80)
    page.mouse.click(*p2)
    page.wait_for_timeout(310)


def main():
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    results = []
    errors = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780})
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            # 1. Engine reply after Undo mid-search
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=dai-su&engine=js", wait_until="networkidle")
            click_move(page, 7, 7, 4, 7)
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.keyboard.press("Control+z")
            page.wait_for_timeout(900)
            v = page.evaluate("() => window.__view")
            ok1 = v["total"] == 0 and v["ply"] == 0
            results.append(("Engine reply after Undo", ok1, f"total={v['total']} ply={v['ply']}"))

            # 2. Engine reply after New Game mid-search
            click_move(page, 7, 7, 4, 7)
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.keyboard.press("n")
            page.locator(".modal-confirm").click()
            page.wait_for_timeout(900)
            v = page.evaluate("() => window.__view")
            ok2 = v["total"] == 0 and v["ply"] == 0
            results.append(("Engine reply after New Game", ok2, f"total={v['total']} ply={v['ply']}"))

            # 3. Engine reply after Truncate ("Chơi tiếp từ đây") mid-search
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
            click_move(page, 7, 7, 4, 7)
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=8000)
            page.locator(".ai-level-select").evaluate("el => { el.value = 'dai-su'; el.dispatchEvent(new Event('change')); }")
            click_move(page, 7, 9, 6, 7)
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.locator("button.move-chip[data-ply='2']").click()
            page.locator("[data-review='continue']").click()
            page.locator(".modal-truncate-confirm").click()
            page.wait_for_timeout(900)
            v = page.evaluate("() => window.__view")
            ok3 = v["total"] == 2 and v["ply"] == 2
            results.append(("Engine reply after Truncate", ok3, f"total={v['total']} ply={v['ply']}"))

            # 4. Engine reply after Resign mid-search
            click_move(page, 7, 9, 6, 7)
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.locator('[data-pact="resign"]').click()
            page.locator(".modal-resign-confirm").click()
            page.locator(".fx-skip-btn").wait_for(state="visible", timeout=2000)
            page.locator(".fx-skip-btn").click()
            page.wait_for_timeout(900)
            v = page.evaluate("() => window.__view")
            ok4 = v["total"] == 3 and page.locator(".modal-gameover").is_visible()
            results.append(("Engine reply after Resign", ok4, f"total={v['total']} modal={page.locator('.modal-gameover').is_visible()}"))

            # 5. Rapid clicks during animation & AI thinking
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=cao-thu&engine=js", wait_until="networkidle")
            p1 = board_point(page, 7, 7)
            p2 = board_point(page, 4, 7)
            p3 = board_point(page, 1, 7)
            page.mouse.click(*p1)
            page.mouse.click(*p2)
            for _ in range(6):
                page.mouse.click(*p3)
                page.mouse.click(*p1)
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=8000)
            v = page.evaluate("() => window.__view")
            ok5 = v["total"] == 2
            results.append(("Rapid clicks during animation/search", ok5, f"total={v['total']}"))

            # 6. Tab visibilitychange during AI search
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=cao-thu&engine=js", wait_until="networkidle")
            click_move(page, 7, 7, 4, 7)
            page.evaluate("""() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
            }""")
            page.wait_for_timeout(200)
            page.evaluate("""() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
                document.dispatchEvent(new Event('visibilitychange'));
            }""")
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=8000)
            v = page.evaluate("() => window.__view")
            ok6 = v["total"] == 2
            results.append(("Tab hidden/visible during search", ok6, f"total={v['total']}"))

            # 7. Switching AI level mid-search
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=dai-su&engine=js", wait_until="networkidle")
            click_move(page, 7, 7, 4, 7)
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.locator(".ai-level-select").evaluate("el => { el.value = 'tap-su'; el.dispatchEvent(new Event('change')); }")
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=10000)
            v = page.evaluate("() => window.__view")
            ok7 = v["total"] == 2
            results.append(("Switch level mid-search", ok7, f"total={v['total']}"))

            # 8. Mode switch ai -> local -> ai via route (worker terminate & respawn)
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
            click_move(page, 7, 7, 4, 7)
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="networkidle")
            page.wait_for_timeout(200)
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
            page.wait_for_timeout(150)
            click_move(page, 7, 7, 4, 7)
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=8000)
            v = page.evaluate("() => window.__view")
            ok8 = v["total"] == 2
            results.append(("Mode switch ai->pvp->ai (worker respawn)", ok8, f"total={v['total']}"))

            ctx.close()
            browser.close()
    finally:
        server.shutdown()

    print("| Scenario | Result | Details |")
    print("|---|:---:|---|")
    all_ok = True
    for name, ok, detail in results:
        print(f"| {name} | {'PASS' if ok else 'FAIL'} | {detail} |")
        if not ok:
            all_ok = False
    print(f"Console/page errors: {len(errors)}")
    for e in errors:
        print("  ERR:", e)
    if not all_ok or errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
