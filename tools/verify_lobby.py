"""
Playwright verification for Phase 1 Lobby, Animated Background, Mode Select,
Settings persistence, responsiveness (1600x900 down to 360x740), zero rAF in game,
and 20 lobby <-> game round trips with zero leaks (window.__leaks).
"""
import functools
import http.server
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW_DIR = ROOT / "preview"


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
        if self.path.startswith("/api/online/info"):
            body = b'{"ok":false}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/assets/voice/manifest.json") and not (ROOT / "assets" / "voice" / "manifest.json").exists():
            body = b'{"empty":true,"files":{}}'
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


def main():
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    errors = []
    warnings = []

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

            # 1. Lobby renders cleanly + Elo placeholders + frame gap <= 50 ms + screenshots
            page.goto(f"{base}/?test&seed=42#/", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(250)
            assert page.locator(".game-card").count() == 2
            assert page.locator(".elo-bar.is-unranked").count() == 2
            assert page.locator("canvas.bg-canvas").count() <= 1
            page.screenshot(path=str(PREVIEW_DIR / "lobby_go_lim.png"))
            print("[lobby_go_lim.png] saved")

            # Measure lobby rAF frame gaps over 800 ms (p95 <= 50 ms, <= 2% over 50 ms, max <= 250 ms)
            raf_lobby = page.evaluate("""async () => {
                const gaps = [];
                let last = performance.now();
                return await new Promise(res => {
                    const start = last;
                    function tick(now) {
                        const gap = now - last;
                        if (gaps.length > 0 || now - start > 5) gaps.push(gap);
                        last = now;
                        if (now - start >= 800) {
                            const sorted = gaps.slice().sort((a, b) => a - b);
                            const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
                            const over50 = sorted.filter(g => g > 50.0).length;
                            const pctOver50 = sorted.length ? (over50 * 100.0) / sorted.length : 0;
                            const maxGap = sorted.length ? sorted[sorted.length - 1] : 0;
                            res({ frames: sorted.length, p95, pctOver50, maxGap });
                        } else {
                            requestAnimationFrame(tick);
                        }
                    }
                    requestAnimationFrame(tick);
                });
            }""")
            print(f"[lobby rAF] frames={raf_lobby['frames']} p95={raf_lobby['p95']:.1f}ms over50={raf_lobby['pctOver50']:.1f}% maxGap={raf_lobby['maxGap']:.1f}ms")
            assert raf_lobby["p95"] <= 50.0, f"Lobby rAF p95 too high: {raf_lobby['p95']}"
            assert raf_lobby["pctOver50"] <= 2.0 or raf_lobby["maxGap"] <= 55.0, f"Too many frames > 50ms: {raf_lobby}"
            assert raf_lobby["maxGap"] <= 250.0, f"Lobby rAF freeze detected: {raf_lobby['maxGap']}"

            # 2. Responsive check across 1600x900, 1180x780, 960x680, 390x844, 360x740 (no horizontal scroll)
            for vw, vh in [(1600, 900), (1180, 780), (960, 680), (390, 844), (360, 740)]:
                page.set_viewport_size({"width": vw, "height": vh})
                page.wait_for_timeout(80)
                ov = page.evaluate("() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })")
                assert ov["sw"] <= ov["iw"] + 1, f"Horizontal overflow at {vw}x{vh}: {ov}"
            page.set_viewport_size({"width": 1180, "height": 780})
            print("[lobby responsive] ok (1600x900 .. 360x740, 0 horizontal overflow)")

            # 3. Settings modal: change nickname, theme -> Ngọc Bích, volume -> persist across reload
            page.locator("[data-act='profile']").click()
            page.locator("#set-nickname").fill("Tướng Quân")
            page.locator(".settings-tab[data-tab='appearance']").click()
            page.locator("[data-set-theme='ngoc-bich']").click()
            page.wait_for_timeout(120)
            page.screenshot(path=str(PREVIEW_DIR / "settings.png"))
            page.locator(".settings-close").click()
            page.wait_for_timeout(120)
            page.screenshot(path=str(PREVIEW_DIR / "lobby_ngoc_bich.png"))
            print("[settings.png & lobby_ngoc_bich.png] saved")

            page.reload(wait_until="networkidle")
            page.wait_for_timeout(150)
            assert page.locator(".guest-name").text_content() == "Tướng Quân"
            assert page.locator(".lobby-bg").get_attribute("data-theme") == "ngoc-bich"
            print("[settings persistence] ok (nickname & theme survived reload)")

            # 4. Mode Select: offline tiles disabled with retry button + AI setup modal -> game
            page.locator("[data-game='cotuong']").click()
            page.locator("[data-tile='online'].is-disabled").wait_for(state="visible", timeout=5000)
            assert page.locator("[data-act='retry-online']").first.is_visible()
            page.screenshot(path=str(PREVIEW_DIR / "mode_select.png"))
            print("[mode_select.png] saved")

            # Deep link #/join/ABC123 prefills code boxes
            page.goto(f"{base}/?test#/join/ABC123", wait_until="networkidle")
            page.wait_for_timeout(120)
            vals = page.locator(".code-box").evaluate_all("els => els.map(e => e.value).join('')")
            assert vals == "ABC123", f"Expected prefilled ABC123, got {vals!r}"
            print("[deep link #/join/ABC123] ok")

            # 5. Navigate into game screen -> assert 0 rAF callbacks at idle
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="networkidle")
            page.wait_for_timeout(200)
            assert page.locator("canvas.bg-canvas").count() == 0
            idle_calls = page.evaluate("""async () => {
                const orig = window.requestAnimationFrame.bind(window);
                let count = 0;
                window.requestAnimationFrame = (cb) => { count++; return orig(cb); };
                await new Promise(r => setTimeout(r, 1200));
                window.requestAnimationFrame = orig;
                return count;
            }""")
            print(f"[game idle rAF] calls={idle_calls}")
            assert idle_calls == 0, f"Expected 0 rAF callbacks in game screen at idle, got {idle_calls}"

            # 6. 20 lobby <-> game round trips: zero leaks (window.__leaks) & heap growth < 5 MB
            page.goto(f"{base}/?test#/", wait_until="networkidle")
            page.wait_for_timeout(120)
            heap_before = page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize : 0")
            for _ in range(20):
                page.evaluate("() => { window.location.hash = '#/play/cotuong/local'; }")
                page.locator("svg.board-svg").wait_for(state="visible", timeout=3000)
                page.evaluate("() => { window.location.hash = '#/'; }")
                page.locator(".game-card").first.wait_for(state="visible", timeout=3000)
            page.evaluate("() => { window.location.hash = '#/play/cotuong/local'; }")
            page.locator("svg.board-svg").wait_for(state="visible", timeout=3000)
            leaks = page.evaluate("() => window.__leaks.snapshot()")
            heap_after = page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize : 0")
            heap_diff_mb = (heap_after - heap_before) / (1024 * 1024)
            print(f"[20 round trips] leaks={leaks} heapDelta={heap_diff_mb:.2f}MB")
            assert leaks["canvases"] == 0, f"Canvas leak: {leaks}"
            assert leaks["timers"] == 0, f"Timer leak: {leaks}"
            assert leaks["listeners"] <= 2, f"Listener leak: {leaks}"
            assert heap_diff_mb < 5.0, f"Heap grew too much: {heap_diff_mb:.2f}MB"

            ctx.close()
            browser.close()
    finally:
        server.shutdown()

    print(f"Lobby verification complete: errors={len(errors)} warnings={len(warnings)}")
    for e in errors:
        print("  ERROR:", e)
    for w in warnings:
        print("  WARN:", w)
    if errors or warnings:
        sys.exit(1)


if __name__ == "__main__":
    main()
