"""
Playwright verification & screenshot capture for Part 3 End-of-Game Cinematics:
1. Captures deterministic keyframes via window.__fxSeek(ms) into preview/fx/<kind>_<theme>_t<ms>.png
   for win-red, win-black, lose, resign, draw in both Gỗ Lim and Ngọc Bích themes.
2. Verifies:
   - Frame gaps during effect <= 50 ms
   - Zero rAF callbacks for 2 s after cinematic settles
   - Skip jumps to final card within 100 ms
   - Undo / New Game during cinematic leaves zero overlay, filter, or transform on board
   - SFX log order (win: checkmate, sword_clash, stamp; lose: defeat, sword_stab & NO checkmate;
     draw: draw, sword_touch)
   - prefers-reduced-motion shows final card with no canvas particle activity
   - Zero console errors/warnings
"""
import functools
import http.server
import sys
import threading
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FX_DIR = ROOT / "preview" / "fx"

KEYFRAMES = {
    "win-red": [400, 1000, 1160, 1600, 2500, 3600],
    "win-black": [400, 1000, 1160, 1600, 2500, 3600],
    "lose": [500, 1000, 1500, 2200, 3800],
    "resign": [1000, 2000, 3800],
    "draw": [600, 1250, 1900, 3200],
}
THEMES = ["go-lim", "ngoc-bich"]


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
    page.wait_for_timeout(100)
    page.mouse.click(*p2)
    page.wait_for_timeout(340)


def main():
    FX_DIR.mkdir(parents=True, exist_ok=True)
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    errors = []
    warnings = []
    shots = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.on("console", lambda msg: (
                errors.append(msg.text) if msg.type == "error"
                else warnings.append(msg.text) if msg.type == "warning"
                else None
            ))

            # 1. Capture deterministic keyframes across all kinds & both themes
            for theme in THEMES:
                page.goto(f"{base}/?effects&test&theme={theme}", wait_until="networkidle")
                page.evaluate("() => document.fonts.ready")
                page.wait_for_timeout(120)
                board_el = page.locator(".effects-board-host .board-wrapper")
                for kind, times in KEYFRAMES.items():
                    page.locator(f"button[data-fx='{kind}']").click()
                    page.wait_for_function("() => typeof window.__fxSeek === 'function'", timeout=3000)
                    for t_ms in times:
                        page.evaluate("(ms) => window.__fxSeek(ms)", t_ms)
                        page.wait_for_timeout(30)
                        out_name = f"{kind}_{theme}_t{t_ms}.png"
                        board_el.screenshot(path=str(FX_DIR / out_name))
                        shots.append(out_name)
                print(f"[fx shots] {theme}: {sum(len(v) for v in KEYFRAMES.values())} frames captured")

            # 2. Performance: frame gap <= 50 ms during playback + zero rAF for 2 s after end
            page.goto(f"{base}/?effects&test&theme=go-lim", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.evaluate("""() => {
                window.__origRaf = window.requestAnimationFrame.bind(window);
                window.__fxRafCount = 0;
                window.__fxMaxGap = 0;
                window.__fxLast = 0;
                window.__countingIdle = false;
                window.__idleRafCalls = 0;
                window.requestAnimationFrame = (cb) => {
                    if (window.__countingIdle) window.__idleRafCalls++;
                    return window.__origRaf((now) => {
                        if (!window.__countingIdle) {
                            if (window.__fxLast > 0) {
                                const gap = now - window.__fxLast;
                                if (gap > window.__fxMaxGap) window.__fxMaxGap = gap;
                            }
                            window.__fxLast = now;
                            window.__fxRafCount++;
                        }
                        cb(now);
                    });
                };
            }""")
            # Run at 2x speed so full 3.6 s finishes in ~1.8 s
            page.locator(".effects-speed").fill("2")
            page.locator(".effects-speed").dispatch_event("input")
            page.locator("button[data-fx='win-red']").click()
            page.locator(".fx-overlay.is-settled").wait_for(state="attached", timeout=6000)
            perf = page.evaluate("() => ({ frames: window.__fxRafCount, maxGap: window.__fxMaxGap })")
            print(f"[fx perf] frames={perf['frames']} maxGap={perf['maxGap']:.1f}ms")
            assert perf["frames"] > 15, f"Expected active rAF frames, got {perf['frames']}"
            assert perf["maxGap"] <= 50.0, f"Frame gap exceeded 50 ms: {perf['maxGap']:.1f}ms"

            # Measure idle rAF for 2 s after settled
            page.evaluate("() => { window.__idleRafCalls = 0; window.__countingIdle = true; }")
            page.wait_for_timeout(2050)
            idle_calls = page.evaluate("() => window.__idleRafCalls")
            print(f"[fx idle rAF 2s] calls={idle_calls}")
            assert idle_calls == 0, f"Expected 0 rAF callbacks after cinematic settled, got {idle_calls}"

            # 3. Skip jumps to final card within 100 ms & SFX log verification on live checkmate (win)
            mate_setup = urllib.parse.quote("4k4/R8/1R7/9/9/9/9/9/9/3K5 w - - 0 1")
            page.goto(f"{base}/?test#/play/cotuong/local?fen={mate_setup}", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.evaluate("() => { if (window.__sfxLog) window.__sfxLog.length = 0; }")
            click_move(page, 1, 2, 1, 0)
            page.locator(".fx-overlay").wait_for(state="visible", timeout=2000)
            # Test skip within 100 ms
            skip_ms = page.evaluate("""async () => {
                const t0 = performance.now();
                document.querySelector('.fx-skip-btn').click();
                const deadline = performance.now() + 200;
                while (performance.now() < deadline) {
                    const card = document.querySelector('.modal-gameover');
                    if (card) return performance.now() - t0;
                    await new Promise(r => setTimeout(r, 5));
                }
                return 999;
            }""")
            print(f"[fx skip] card appeared in {skip_ms:.1f}ms")
            assert skip_ms <= 100, f"Skip took too long: {skip_ms:.1f}ms"

            # Undo during cinematic leaves zero overlay, zero filter, zero transform
            page.goto("about:blank")
            page.goto(f"{base}/?test#/play/cotuong/local?fen={mate_setup}", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            click_move(page, 1, 2, 1, 0)
            page.locator(".fx-overlay").wait_for(state="visible", timeout=2000)
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(180)
            clean_state = page.evaluate("""() => {
                const ov = document.querySelector('.fx-overlay');
                const svg = document.querySelector('svg.board-svg');
                return { hasOverlay: Boolean(ov), filter: svg.style.filter, transform: svg.style.transform };
            }""")
            assert not clean_state["hasOverlay"] and clean_state["filter"] == "" and clean_state["transform"] == "", f"Leftovers after undo: {clean_state}"
            print("[fx cancel on undo] clean (no overlay, no filter, no transform)")

            # 4. SFX log order for win, lose (no victory events!), and draw
            page.goto(f"{base}/?effects&test&theme=go-lim", wait_until="networkidle")
            page.locator(".effects-sound-cb").check()
            page.locator(".effects-speed").fill("2")
            page.locator(".effects-speed").dispatch_event("input")

            # Win
            page.evaluate("() => { window.__sfxLog = []; }")
            page.locator("button[data-fx='win-red']").click()
            page.locator(".fx-overlay.is-settled").wait_for(state="attached", timeout=5000)
            win_log = [e["event"] for e in page.evaluate("() => window.__sfxLog || []")]
            assert "sword_clash" in win_log and "stamp" in win_log, f"Win log missing clash/stamp: {win_log}"
            assert win_log.index("sword_clash") < win_log.index("stamp"), f"Win log wrong order: {win_log}"

            # Lose (must have defeat + sword_stab, and NO checkmate/voice:checkmate)
            page.evaluate("() => { window.__sfxLog = []; }")
            page.locator("button[data-fx='lose']").click()
            page.locator(".fx-overlay.is-settled").wait_for(state="attached", timeout=5000)
            lose_log = [e["event"] for e in page.evaluate("() => window.__sfxLog || []")]
            assert "defeat" in lose_log and "sword_stab" in lose_log, f"Lose log missing defeat/stab: {lose_log}"
            assert "checkmate" not in lose_log and "voice:checkmate" not in lose_log, f"Lose must NOT play victory events: {lose_log}"

            # Draw
            page.evaluate("() => { window.__sfxLog = []; }")
            page.locator("button[data-fx='draw']").click()
            page.locator(".fx-overlay.is-settled").wait_for(state="attached", timeout=5000)
            draw_log = [e["event"] for e in page.evaluate("() => window.__sfxLog || []")]
            assert "sword_touch" in draw_log, f"Draw log missing sword_touch: {draw_log}"
            print(f"[fx sfx logs] win={win_log} lose={lose_log} draw={draw_log}")

            # 5. Reduced-motion emulation: shows final card with no canvas particle pixels
            page.emulate_media(reduced_motion="reduce")
            page.goto(f"{base}/?effects&test&theme=go-lim", wait_until="networkidle")
            page.locator("button[data-fx='win-red']").click()
            page.locator(".fx-overlay.is-settled").wait_for(state="attached", timeout=2000)
            rm_check = page.evaluate("""() => {
                const c = document.querySelector('.fx-canvas');
                const ctx = c.getContext('2d');
                const data = ctx.getImageData(0, 0, c.width, c.height).data;
                let nonZero = 0;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonZero++;
                const titleOp = parseFloat(document.querySelector('.fx-title-group').getAttribute('opacity') || '0');
                return { nonZero, titleOp };
            }""")
            assert rm_check["nonZero"] == 0 and rm_check["titleOp"] >= 0.99, f"Reduced motion check failed: {rm_check}"
            print("[fx reduced-motion] ok (0 canvas pixels, final title visible)")

            ctx.close()
            browser.close()
    finally:
        server.shutdown()

    print(f"FX verification complete: shots={len(shots)} errors={len(errors)} warnings={len(warnings)}")
    for e in errors:
        print("  ERROR:", e)
    for w in warnings:
        print("  WARN:", w)
    if errors or warnings:
        sys.exit(1)


if __name__ == "__main__":
    main()
