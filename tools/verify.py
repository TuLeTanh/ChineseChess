"""
End-to-end Playwright verification & live-app screenshot capture for Chinese Chess UI + Rules + SFX.
Produces into preview/:
  - app_default.png      (1180x780, Gỗ Lim, start position, side panel visible)
  - app_legal_hints.png  (piece selected with gold dots & red-orange capture ring, rules enforced)
  - app_check.png        (a check with pulsing red glow + "Chiếu tướng!" toast)
  - app_checkmate.png    (checkmate result modal "Chiếu bí! Đỏ thắng")
  - app_midgame.png      (8 moves played including captures; move list & captured trays populated)
  - app_dragging.png     (piece mid-drag, lifted, gold target brackets visible)
  - app_flipped.png      (board flipped; piece glyphs still upright)
  - app_jade.png         (1180x780, Ngọc Bích)

Also asserts:
  - drag-and-drop moves a piece, undo restores captured piece, flip keeps glyphs upright,
    theme switch has zero console errors/warnings
  - SFX log (?test): normal move -> [select, move], capture -> [select, capture],
    check -> [..., check] after landing, illegal drop -> [..., illegal],
    mute -> no new entries, New Game -> [..., start]
  - responsive layout (960x680, 1180x780, 1600x900) and HiDPI (1.0, 1.5, 2.0)
"""
import functools
import http.server
import sys
import threading
import urllib.parse
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
        super().do_GET()


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def board_point(page, x, y, flipped=False):
    rect = page.locator("svg.board-svg").bounding_box()
    gx = 8 - x if flipped else x
    gy = 9 - y if flipped else y
    bx = 125 + gx * 100
    by = 125 + gy * 100
    return rect["x"] + (bx / 1050.0) * rect["width"], rect["y"] + (by / 1150.0) * rect["height"]


def click_move(page, x1, y1, x2, y2):
    p1 = board_point(page, x1, y1)
    p2 = board_point(page, x2, y2)
    page.mouse.click(*p1)
    page.wait_for_timeout(110)
    page.mouse.click(*p2)
    page.wait_for_timeout(340)


def drag_move(page, x1, y1, x2, y2):
    p1 = board_point(page, x1, y1)
    p2 = board_point(page, x2, y2)
    page.mouse.move(*p1)
    page.mouse.down()
    page.mouse.move((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, steps=6)
    page.mouse.move(*p2, steps=6)
    page.mouse.up()
    page.wait_for_timeout(340)


def get_sfx_log(page):
    return page.evaluate("() => (window.__sfxLog || []).slice()")


def clear_sfx_log(page):
    page.evaluate("() => { if (window.__sfxLog) window.__sfxLog.length = 0; }")


def main():
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    errors = []
    warnings = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # 1. Main interactive session with ?test enabled for __sfxLog (explicitly 2-player mode)
            ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.on("console", lambda msg: (
                errors.append(msg.text) if msg.type == "error"
                else warnings.append(msg.text) if msg.type == "warning"
                else None
            ))

            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(150)

            # Screenshot: app_default.png
            page.screenshot(path=str(PREVIEW_DIR / "app_default.png"))
            print("[app_default.png] saved")

            # Verify default practice checkbox is OFF ("Đi tự do (luyện tập)")
            assert not page.locator(".free-move-checkbox").is_checked(), "Practice mode must default to OFF"

            # Screenshot: app_legal_hints.png — select Red Cannon at (7,7) which has 11 empty dots + 1 capture ring on Black Horse (7,0)
            p_can = board_point(page, 7, 7)
            page.mouse.click(*p_can)
            page.wait_for_timeout(120)
            assert page.locator(".legal-move-dot").count() == 11, "Expected 11 legal empty dots for Cannon"
            assert page.locator(".legal-capture-ring").count() == 1, "Expected 1 capture ring on Black Horse (7,0)"
            page.screenshot(path=str(PREVIEW_DIR / "app_legal_hints.png"))
            print("[app_legal_hints.png] saved")

            # Deselect and test SFX log on normal move: Red Cannon (7,7) -> (4,7)
            page.keyboard.press("Escape")
            page.wait_for_timeout(60)
            clear_sfx_log(page)
            click_move(page, 7, 7, 4, 7)
            log1 = [e["event"] for e in get_sfx_log(page)]
            assert log1 == ["select", "move"], f"Expected [select, move], got {log1}"
            assert page.locator(".move-row .col-red").first.text_content() == "h2e2"

            # Continue opening to reach a check + capture
            click_move(page, 1, 0, 2, 2)  # Black Horse b9->c7
            click_move(page, 7, 9, 6, 7)  # Red Horse h0->g2
            click_move(page, 0, 0, 1, 0)  # Black Chariot a9->b9
            click_move(page, 8, 9, 7, 9)  # Red Chariot i0->h0
            click_move(page, 7, 2, 4, 2)  # Black Cannon h7->e7

            # Move 7: Drag-and-drop capture AND check! Red Cannon (4,7) -> (4,3) captures Black Soldier & checks Black General over (4,2)
            clear_sfx_log(page)
            drag_move(page, 4, 7, 4, 3)
            page.wait_for_timeout(320)  # wait for 120ms check gong + 180ms voice:check
            log_cap_chk = get_sfx_log(page)
            ev_names = [e["event"] for e in log_cap_chk]
            assert ev_names == ["select", "capture", "check", "voice:check"], f"Expected [select, capture, check, voice:check], got {ev_names}"
            assert log_cap_chk[2]["time"] > log_cap_chk[1]["time"], "check gong must fire after capture landing"
            assert log_cap_chk[3]["time"] > log_cap_chk[1]["time"], "voice:check must fire after capture landing"
            assert page.locator(".move-row .col-red").nth(3).text_content() == "e2e6+", "Expected '+' suffix for check"
            assert page.locator(".board-toast.is-visible .toast-glyph").text_content() == "將軍", "Expected calligraphy caption 將軍"
            assert page.locator(".check-pulse").count() == 1, "Expected pulsing red check glow on Black General"

            # Screenshots: app_check.png & app_check_voice.png (glow + calligraphy caption visible!)
            page.screenshot(path=str(PREVIEW_DIR / "app_check.png"))
            page.screenshot(path=str(PREVIEW_DIR / "app_check_voice.png"))
            print("[app_check.png & app_check_voice.png] saved")

            # Test illegal drop sound: try dragging Black Chariot at (1,0) to (1,1) while Black is in check -> illegal!
            clear_sfx_log(page)
            drag_move(page, 1, 0, 1, 1)
            page.wait_for_timeout(220)
            log_ill = [e["event"] for e in get_sfx_log(page)]
            assert "illegal" in log_ill, f"Expected illegal sound on illegal drop, got {log_ill}"

            # Wait for 1.99s voice:check (priority 3) to finish before testing lower-priority voice:capture (priority 2)
            page.wait_for_timeout(1600)

            # Move 8: Black Cannon (4,2) -> (4,6) resolves check AND captures Red Soldier -> logs [select, capture, voice:capture]
            clear_sfx_log(page)
            click_move(page, 4, 2, 4, 6)
            page.wait_for_timeout(180)
            log_cap = get_sfx_log(page)
            cap_names = [e["event"] for e in log_cap]
            assert cap_names == ["select", "capture", "voice:capture"], f"Expected [select, capture, voice:capture], got {cap_names}"
            assert log_cap[2]["time"] > log_cap[1]["time"], "voice:capture must fire after capture landing"
            assert page.locator("[data-tray='black'] svg.captured-mini").count() == 1

            # Screenshot: app_midgame.png
            page.screenshot(path=str(PREVIEW_DIR / "app_midgame.png"))
            print("[app_midgame.png] saved")

            # Undo restores Black's captured Red Soldier
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(250)
            assert page.locator("[data-tray='black'] svg.captured-mini").count() == 0

            # Screenshot: app_dragging.png (Black Cannon at (4,2) mid-drag toward (4,6))
            drag_start = board_point(page, 4, 2)
            drag_target = board_point(page, 4, 6)
            page.mouse.move(*drag_start)
            page.mouse.down()
            page.mouse.move(drag_target[0] - 8, drag_target[1] - 6, steps=8)
            page.wait_for_timeout(80)
            assert page.locator("g.layer-drag > g").count() == 1
            assert page.locator("g.layer-selection path").count() == 1
            page.screenshot(path=str(PREVIEW_DIR / "app_dragging.png"))
            print("[app_dragging.png] saved")
            page.mouse.up()
            page.wait_for_timeout(320)

            # Screenshot: app_flipped.png (upright glyphs verified)
            page.locator("button[data-action='flip']").click()
            page.wait_for_timeout(450)
            base_tf = page.locator("g.layer-board-base").get_attribute("transform") or ""
            assert "rotate(180" in base_tf
            piece_tfs = page.locator("g.layer-pieces > g").evaluate_all(
                "els => els.map(e => e.getAttribute('transform') || '')"
            )
            assert all("rotate" not in t for t in piece_tfs), "Pieces must stay upright when flipped"
            page.screenshot(path=str(PREVIEW_DIR / "app_flipped.png"))
            print("[app_flipped.png] saved")

            # Flip back + switch theme -> Screenshot: app_jade.png
            page.locator("button[data-action='flip']").click()
            page.wait_for_timeout(420)
            page.locator("button[data-action='theme']").click()
            page.wait_for_timeout(320)
            assert "Ngọc Bích" in (page.locator("button[data-action='theme']").get_attribute("title") or "")
            page.screenshot(path=str(PREVIEW_DIR / "app_jade.png"))
            print("[app_jade.png] saved")

            # Test voice toggle OFF (V): NO voice:* entries appear on New Game
            page.keyboard.press("v")
            clear_sfx_log(page)
            page.locator("button[data-action='new']").click()
            page.wait_for_timeout(100)
            assert page.locator(".modal-card").is_visible()
            page.locator(".modal-confirm").click()
            page.wait_for_timeout(720)
            log_no_voice = [e["event"] for e in get_sfx_log(page)]
            assert "start" in log_no_voice, f"Expected start sfx with voice OFF, got {log_no_voice}"
            assert not any(e.startswith("voice:") for e in log_no_voice), f"Voice OFF must not log voice:*, got {log_no_voice}"

            # Re-enable voice (V) + test priority cancellation (higher priority 'check' cancels lower 'start')
            page.keyboard.press("v")
            prio_ok = page.evaluate("""async () => {
                const sfx = window.__sfx;
                await sfx.ensureReady();
                await sfx.voice.ensureLoaded();
                sfx.voice.play('start');
                await new Promise(r => setTimeout(r, 80));
                const firstSrc = sfx.voice.current ? sfx.voice.current.source : null;
                sfx.voice.play('check');
                await new Promise(r => setTimeout(r, 80));
                const secondSrc = sfx.voice.current ? sfx.voice.current.source : null;
                const prio = sfx.voice.current ? sfx.voice.current.priority : 0;
                // Now try lower priority 'capture' while 'check' (prio 3) is playing -> must NOT replace
                sfx.voice.play('capture');
                await new Promise(r => setTimeout(r, 40));
                const thirdSrc = sfx.voice.current ? sfx.voice.current.source : null;
                sfx.voice.stopCurrent();
                return Boolean(firstSrc && secondSrc && firstSrc !== secondSrc && prio === 3 && thirdSrc === secondSrc);
            }""")
            assert prio_ok, "Higher-priority voice must cancel lower one, and lower must not interrupt higher"

            # Test mute produces NO log entries at all
            page.keyboard.press("m")
            clear_sfx_log(page)
            page.locator("button[data-action='new']").click()
            page.wait_for_timeout(200)
            assert len(get_sfx_log(page)) == 0, "Muted state must produce zero sfx/voice log entries"

            # Unmute + New Game (from empty board -> immediate) logs 'start' and 'voice:start'
            page.keyboard.press("m")
            clear_sfx_log(page)
            page.locator("button[data-action='new']").click()
            page.wait_for_timeout(720)
            log_start = [e["event"] for e in get_sfx_log(page)]
            assert "start" in log_start and "voice:start" in log_start, f"Expected start + voice:start, got {log_start}"

            # 2. Checkmate scenario -> Screenshot: app_checkmate.png + verify voice:checkmate then voice:checkmate2
            mate_setup = urllib.parse.quote("4k4/R8/1R7/9/9/9/9/9/9/3K5 w - - 0 1")
            page.goto(f"{base}/?test#/play/cotuong/local?fen={mate_setup}", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(120)
            clear_sfx_log(page)
            click_move(page, 1, 2, 1, 0)
            # Wait for cinematic then skip to result card
            page.locator(".fx-skip-btn").wait_for(state="visible", timeout=2000)
            page.locator(".fx-skip-btn").click()
            page.locator(".modal-gameover").wait_for(state="visible", timeout=1000)
            assert "Chiếu bí! Đỏ thắng" in page.locator("#gameover-title").text_content()
            assert page.locator(".move-row .col-red").first.text_content() == "b7b9#"
            page.screenshot(path=str(PREVIEW_DIR / "app_checkmate.png"))
            print("[app_checkmate.png] saved")

            # Wait for delayed voice:checkmate2 ("承讓")
            page.wait_for_timeout(2500)
            ev_mate = [e["event"] for e in get_sfx_log(page)]
            assert "voice:checkmate" in ev_mate and "voice:checkmate2" in ev_mate, f"Expected voice:checkmate + voice:checkmate2, got {ev_mate}"
            assert ev_mate.index("voice:checkmate2") > ev_mate.index("voice:checkmate")

            # Verify "Xem lại bàn cờ" closes modal, board is locked, and Undo unlocks it!
            page.locator(".modal-review").click()
            page.wait_for_timeout(80)
            assert not page.locator(".modal-gameover").is_visible()
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(220)
            assert page.locator(".move-row").count() == 0, "Undo must work after game over"

            # 2a. Part 1 & Part 2 Review Mode + Move List + Timeline E2E verification
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(120)
            # Play 8 plies including a capture & check
            seq8 = [
                (7, 7, 4, 7), (1, 0, 2, 2),
                (7, 9, 6, 7), (0, 0, 1, 0),
                (8, 9, 7, 9), (7, 2, 4, 2),
                (4, 7, 4, 3), (4, 2, 4, 6),
            ]
            for mv in seq8:
                click_move(page, *mv)
            page.wait_for_timeout(120)
            # Assert piece icons, capture markers, check markers
            assert page.locator(".move-chip .move-piece-icon").count() == 8, "Expected 8 piece SVG icons in move chips"
            assert page.locator(".move-chip.is-capture").count() == 2, "Expected 2 capture markers"
            assert page.locator(".move-chip.is-check").count() == 1, "Expected 1 check marker"

            # Click ply 3 -> window.__view.ply === 3, banner appears, board locked
            page.locator("button.move-chip[data-ply='3']").click()
            page.wait_for_timeout(180)
            v3 = page.evaluate("() => window.__view")
            assert v3["ply"] == 3 and v3["total"] == 8, f"Expected ply 3/8, got {v3}"
            assert page.locator(".review-banner").is_visible(), "Expected review banner visible"
            assert "3/8" in page.locator(".review-banner-text").text_content()
            # Screenshot: preview/app_review.png
            page.screenshot(path=str(PREVIEW_DIR / "app_review.png"))
            print("[app_review.png] saved")

            # Board input locked in review (clicking a Red piece does not select)
            page.mouse.click(*board_point(page, 4, 7))
            page.wait_for_timeout(80)
            assert page.locator(".legal-move-dot").count() == 0, "Board input must be locked in review"

            # ArrowLeft / ArrowRight / Home / End
            page.keyboard.press("ArrowLeft")
            page.wait_for_timeout(120)
            assert page.evaluate("() => window.__view.ply") == 2
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(120)
            assert page.evaluate("() => window.__view.ply") == 3
            page.keyboard.press("Home")
            page.wait_for_timeout(150)
            assert page.evaluate("() => window.__view.ply") == 0
            page.keyboard.press("End")
            page.wait_for_timeout(150)
            assert page.evaluate("() => window.__view.ply") == 8
            assert not page.locator(".review-banner").is_visible()

            # Timeline click & drag scrub
            tl_box = page.locator(".move-timeline").bounding_box()
            page.mouse.click(tl_box["x"] + tl_box["width"] * 0.5, tl_box["y"] + tl_box["height"] * 0.5)
            page.wait_for_timeout(120)
            mid_ply = page.evaluate("() => window.__view.ply")
            assert 2 <= mid_ply <= 6, f"Timeline click expected mid ply, got {mid_ply}"
            page.mouse.move(tl_box["x"] + tl_box["width"] * 0.25, tl_box["y"] + tl_box["height"] * 0.5)
            page.mouse.down()
            page.mouse.move(tl_box["x"] + tl_box["width"] * 0.75, tl_box["y"] + tl_box["height"] * 0.5, steps=6)
            page.mouse.up()
            page.wait_for_timeout(120)
            scrub_ply = page.evaluate("() => window.__view.ply")
            assert scrub_ply >= 5, f"Timeline drag scrub expected >= 5, got {scrub_ply}"

            # Auto-replay reaches the end and stops
            page.locator("button.move-chip[data-ply='6']").click()
            page.wait_for_timeout(100)
            page.locator("button[data-rev='play']").click()
            page.wait_for_timeout(1850)
            assert page.evaluate("() => window.__view.ply") == 8, "Auto-replay must reach live end"
            assert not page.locator("button[data-rev='play'].is-playing").is_visible(), "Auto-replay must stop at end"

            # Undo from review goes live first, then undoes
            page.locator("button.move-chip[data-ply='3']").click()
            page.wait_for_timeout(100)
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(240)
            v_undo = page.evaluate("() => window.__view")
            assert v_undo["ply"] == 7 and v_undo["total"] == 7, f"Undo from review must go live then undo, got {v_undo}"

            # "Chơi tiếp từ đây" truncates history
            page.locator("button.move-chip[data-ply='4']").click()
            page.wait_for_timeout(100)
            page.locator("[data-review='continue']").click()
            page.wait_for_timeout(80)
            page.locator(".modal-truncate-confirm").click()
            page.wait_for_timeout(120)
            v_trunc = page.evaluate("() => window.__view")
            assert v_trunc["ply"] == 4 and v_trunc["total"] == 4, f"Truncate failed: {v_trunc}"

            # Long 60-ply game: hidden native scrollbar + fade masks + preview/app_movelist_long.png
            page.goto(f"{base}/?test#/play/cotuong/local", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.evaluate("""async () => {
                const { XiangqiRules } = await import('./js/rules.js');
                const rules = new XiangqiRules();
                const b = window.__board;
                let seed = 1337;
                const rand = () => {
                    seed = (seed + 0x6d2b79f5) | 0;
                    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
                for (let k = 0; k < 60; k++) {
                    const all = [];
                    for (let y = 0; y < 10; y++) {
                        for (let x = 0; x < 9; x++) {
                            const p = b.at({ x, y });
                            if (!p || p.side !== b.sideToMove) continue;
                            for (const to of rules.legalMoves(b, { x, y })) all.push({ from: { x, y }, to });
                        }
                    }
                    if (!all.length) break;
                    const mv = all[Math.floor(rand() * all.length)];
                    b.applyMove(mv.from, mv.to);
                }
            }""")
            # Trigger UI update via selecting ply 30 so list scrolls to middle with both top & bottom fade masks
            page.keyboard.press("End")
            page.wait_for_timeout(120)
            page.locator("button.move-chip[data-ply='30']").click()
            page.wait_for_timeout(320)
            ml_metrics = page.evaluate("""() => {
                const el = document.querySelector('.move-list-scroll');
                const wrap = document.querySelector('.move-list-scroll-wrap');
                return {
                    scrollHeight: el.scrollHeight,
                    clientHeight: el.clientHeight,
                    scrollbarWidth: el.offsetWidth - el.clientWidth,
                    fadeTop: wrap.classList.contains('has-fade-top'),
                    fadeBottom: wrap.classList.contains('has-fade-bottom'),
                };
            }""")
            assert ml_metrics["scrollHeight"] > ml_metrics["clientHeight"], f"Expected scrollable 60-ply list: {ml_metrics}"
            assert ml_metrics["scrollbarWidth"] == 0, f"Native scrollbar must be hidden: {ml_metrics}"
            assert ml_metrics["fadeTop"] and ml_metrics["fadeBottom"], f"Expected fade masks in middle of 60-ply list: {ml_metrics}"
            page.screenshot(path=str(PREVIEW_DIR / "app_movelist_long.png"))
            print("[app_movelist_long.png] saved (hidden scrollbar + fade masks verified)")

            # Verify ?voices, ?sounds, and ?effects pages load cleanly with zero console errors
            page.goto(f"{base}/?voices", wait_until="networkidle")
            assert page.locator(".voice-audition-btn").count() >= 3, "Expected audition buttons on ?voices"
            page.goto(f"{base}/?sounds", wait_until="networkidle")
            assert page.locator(".voice-demo-btn").count() == 7, "Expected 7 voice buttons on ?sounds"
            page.goto(f"{base}/?effects", wait_until="networkidle")
            assert page.locator("button[data-fx='win-red']").is_visible(), "Expected ?effects buttons"

            # 2b. Play vs AI verification (Web Worker, non-blocking rAF, thinking, hint, undo 2 plies, Black auto-flip, resign)
            page.goto(f"{base}/#/play/cotuong/ai?side=red&level=cao-thu", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(150)

            # Start rAF gap monitor on main thread during Cao thủ search
            page.evaluate("""() => {
                window.__rafMaxGap = 0;
                window.__rafFrames = 0;
                window.__rafStop = false;
                let last = performance.now();
                function tick(now) {
                    const gap = now - last;
                    if (window.__rafFrames > 0 && gap > window.__rafMaxGap) window.__rafMaxGap = gap;
                    window.__rafFrames++;
                    last = now;
                    if (!window.__rafStop) requestAnimationFrame(tick);
                }
                requestAnimationFrame(tick);
            }""")

            # Make 1 legal move as Red: Cannon h2->e2 (7,7 -> 4,7)
            click_move(page, 7, 7, 4, 7)

            # Wait briefly for AI thinking indicator and capture app_vs_ai_thinking.png
            page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
            page.wait_for_timeout(180)
            page.screenshot(path=str(PREVIEW_DIR / "app_vs_ai_thinking.png"))
            print("[app_vs_ai_thinking.png] saved")

            # Wait up to 8 s for AI reply (black move in row 1)
            page.wait_for_function(
                "() => (document.querySelector('.move-row .col-black')?.textContent || '').trim().length >= 4",
                timeout=8000,
            )
            page.wait_for_timeout(350)

            raf_stats = page.evaluate("""() => {
                window.__rafStop = true;
                return { frames: window.__rafFrames, maxGap: window.__rafMaxGap };
            }""")
            print(f"[AI rAF check] frames={raf_stats['frames']} maxGap={raf_stats['maxGap']:.1f}ms")
            assert raf_stats["frames"] > 10, "Expected rAF frames during AI search"
            assert raf_stats["maxGap"] <= 120, f"Main thread blocked during AI search: maxGap={raf_stats['maxGap']:.1f}ms"

            # Assert 2 plies in move list and piece count = 32 - captures
            piece_count = page.locator("g.layer-pieces > g").count()
            cap_count = page.locator("svg.captured-mini").count()
            assert piece_count == 32 - cap_count, f"Expected {32 - cap_count} pieces on board, got {piece_count}"

            # Hint button: draws blue arrow and decrements counter (3 -> 2)
            assert "Gợi ý (3)" in page.locator("button[data-action='hint']").text_content()
            page.locator("button[data-action='hint']").click()
            page.locator(".hint-arrow").wait_for(state="visible", timeout=4000)
            assert "Gợi ý (2)" in page.locator("button[data-action='hint']").text_content()
            page.screenshot(path=str(PREVIEW_DIR / "app_hint_arrow.png"))
            print("[app_hint_arrow.png] saved")

            # Undo in AI mode removes TWO plies (back to 0 moves)
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(300)
            assert page.locator(".move-row").count() == 0, "Undo in AI mode must remove 2 plies"

            # Switch to Black: board auto-flips and computer (Red) moves first
            page.locator("[data-pside='black']").click()
            page.wait_for_timeout(120)
            base_tf_blk = page.locator("g.layer-board-base").get_attribute("transform") or ""
            assert "rotate(180" in base_tf_blk, "Playing as Black must auto-flip the board"
            page.wait_for_function(
                "() => (document.querySelector('.move-row .col-red')?.textContent || '').trim().length >= 4",
                timeout=8000,
            )
            page.wait_for_timeout(350)

            # Resign -> confirm modal -> skip cinematic -> game over modal ("Bạn đã đầu hàng - Máy thắng")
            page.locator("button[data-action='resign']").click()
            page.wait_for_timeout(100)
            page.locator(".modal-resign-confirm").click()
            page.locator(".fx-skip-btn").wait_for(state="visible", timeout=2000)
            page.locator(".fx-skip-btn").click()
            page.locator(".modal-gameover").wait_for(state="visible", timeout=1000)
            assert "Bạn đã đầu hàng - Máy thắng" in page.locator("#gameover-title").text_content()
            page.screenshot(path=str(PREVIEW_DIR / "app_vs_ai_gameover.png"))
            print("[app_vs_ai_gameover.png] saved")

            # AI reply arriving during review does NOT jump viewPly & lights "Có nước mới" dot
            page.goto(f"{base}/?test#/play/cotuong/ai?side=red&level=cao-thu", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            click_move(page, 7, 7, 4, 7)
            # Immediately enter review at ply 0 while AI is thinking
            page.keyboard.press("Home")
            page.wait_for_timeout(80)
            assert page.evaluate("() => window.__view.ply") == 0
            # Wait for AI reply to land in background (total becomes 2)
            page.wait_for_function("() => window.__view && window.__view.total >= 2", timeout=8000)
            v_bg = page.evaluate("() => window.__view")
            assert v_bg["ply"] == 0 and v_bg["total"] == 2, f"AI reply jumped review viewPly: {v_bg}"
            assert page.locator(".review-new-badge").is_visible(), "Expected 'Có nước mới' badge in review banner"
            assert page.locator(".rev-new-dot").is_visible(), "Expected pulsing dot on live button"
            print("[review AI background reply] ok (viewPly stayed 0, 'Có nước mới' lit)")

            # 3. Responsive layout check
            page.goto(f"{base}/#/play/cotuong/local", wait_until="networkidle")
            for vw, vh in [(960, 680), (1180, 780), (1600, 900)]:
                page.set_viewport_size({"width": vw, "height": vh})
                page.wait_for_timeout(80)
                overflow = page.evaluate("""() => {
                    const panel = document.getElementById('side-panel');
                    const board = document.querySelector('.board-wrapper');
                    const pRect = panel.getBoundingClientRect();
                    const bRect = board.getBoundingClientRect();
                    return {
                        overlap: bRect.right > pRect.left + 1,
                        textOverflow: panel.scrollWidth > panel.clientWidth + 1,
                    };
                }""")
                assert not overflow["overlap"], f"Overlap at {vw}x{vh}"
                assert not overflow["textOverflow"], f"Panel overflow at {vw}x{vh}"

            ctx.close()

            # 4. HiDPI check at 1.0, 1.5, 2.0
            for dpr in (1.0, 1.5, 2.0):
                ctx_hi = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=dpr)
                p_hi = ctx_hi.new_page()
                p_hi.on("pageerror", lambda err: errors.append(str(err)))
                p_hi.goto(base, wait_until="networkidle")
                p_hi.evaluate("() => document.fonts.ready")
                assert abs(p_hi.evaluate("() => window.devicePixelRatio") - dpr) < 0.01
                ctx_hi.close()

            browser.close()
    finally:
        server.shutdown()

    print(f"Verification complete: errors={len(errors)} warnings={len(warnings)}")
    for e in errors:
        print("  ERROR:", e)
    for w in warnings:
        print("  WARN:", w)
    if errors or warnings:
        sys.exit(1)


if __name__ == "__main__":
    main()
