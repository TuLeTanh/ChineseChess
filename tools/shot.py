"""
Headless screenshot & console-check runner for Chinese Chess previews.
Starts an in-process HTTP server and captures PNGs into preview/.
Usage:
  python tools/shot.py board
  python tools/shot.py pieces
  python tools/shot.py start
  python tools/shot.py all
"""
import functools
import http.server
import os
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW_DIR = ROOT / "preview"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def capture(page, url, out_path, viewport, dpr=1, clip_selector=None):
    errors = []
    warnings = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("console", lambda msg: (
        errors.append(msg.text) if msg.type == "error"
        else warnings.append(msg.text) if msg.type == "warning"
        else None
    ))
    page.set_viewport_size(viewport)
    page.goto(url, wait_until="networkidle")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(150)

    if clip_selector:
        el = page.locator(clip_selector).first
        el.screenshot(path=str(out_path))
    else:
        page.screenshot(path=str(out_path))

    return errors, warnings


def main():
    targets = sys.argv[1:] or ["board"]
    if "all" in targets:
        targets = ["board", "pieces", "pieces_small", "start", "app", "start_jade"]

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    all_errors = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for target in targets:
                dpr = 1
                if target == "board":
                    ctx = browser.new_context(viewport={"width": 1100, "height": 1200}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?preview=board", PREVIEW_DIR / "board.png", {"width": 1100, "height": 1200}, clip_selector=".preview-board-container")
                    ctx.close()
                elif target == "pieces":
                    ctx = browser.new_context(viewport={"width": 1800, "height": 600}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?preview=pieces", PREVIEW_DIR / "pieces_sheet.png", {"width": 1800, "height": 600}, clip_selector=".preview-pieces-sheet")
                    ctx.close()
                elif target == "pieces_small":
                    ctx = browser.new_context(viewport={"width": 800, "height": 300}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?preview=pieces_small", PREVIEW_DIR / "pieces_small.png", {"width": 800, "height": 300}, clip_selector=".preview-pieces-small")
                    ctx.close()
                elif target == "start":
                    ctx = browser.new_context(viewport={"width": 1100, "height": 1200}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?preview=start", PREVIEW_DIR / "start_position.png", {"width": 1100, "height": 1200}, clip_selector=".preview-start-container")
                    ctx.close()
                elif target == "start_jade":
                    ctx = browser.new_context(viewport={"width": 1100, "height": 1200}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?preview=start&theme=ngoc-bich", PREVIEW_DIR / "start_position_jade.png", {"width": 1100, "height": 1200}, clip_selector=".preview-start-container")
                    ctx.close()
                elif target == "app":
                    ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/", PREVIEW_DIR / "app_default.png", {"width": 1180, "height": 780})
                    ctx.close()
                elif target == "app_jade":
                    ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
                    page = ctx.new_page()
                    errs, warns = capture(page, f"{base}/?theme=ngoc-bich", PREVIEW_DIR / "app_jade.png", {"width": 1180, "height": 780})
                    ctx.close()
                else:
                    print(f"Unknown target: {target}")
                    continue

                print(f"[{target}] saved. errors={len(errs)} warnings={len(warns)}")
                for e in errs:
                    print(f"  ERROR: {e}")
                for w in warns:
                    print(f"  WARN: {w}")
                all_errors.extend(errs)
            browser.close()
    finally:
        server.shutdown()

    if all_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
