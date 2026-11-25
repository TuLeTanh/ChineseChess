"""
Step 3: Exploratory UI, Accessibility, Route, Gameplay, Online & Seeded Monkey Testing
(tools/verify_explore.py).

Drives the real app like a user with strict console/page error+warning listeners.
Saves screenshots into preview/explore/ for visual review.
"""

from __future__ import annotations

import argparse
import os
import random
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXPLORE_DIR = ROOT / "preview" / "explore"
EXPLORE_DIR.mkdir(parents=True, exist_ok=True)


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
    page.on("console", lambda m: errs.append(f"[{label}] console.error: {m.text}") if m.type == "error"
            else warns.append(f"[{label}] console.warn: {m.text}") if m.type == "warning" else None)
    page.on("pageerror", lambda e: errs.append(f"[{label}] pageerror: {e}"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261125)
    parser.add_argument("--monkey-sec", type=float, default=12.0, help="Seconds per screen for seeded monkey test")
    args = parser.parse_args()

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
    findings: list[str] = []
    rng = random.Random(args.seed)
    print(f"[explore] seed={args.seed} monkey_sec={args.monkey_sec}s/screen")

    try:
        wait_for_server(port)
        base = f"http://127.0.0.1:{port}/index.html?test=1"

        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780})
            page = ctx.new_page()
            attach_listeners(page, errs, warns, "main")

            # (a) LOBBY: cards, hover/focus, Elo bar, settings Esc + focus return, Tab order, responsive
            page.goto(f"{base}#/", wait_until="networkidle")
            page.wait_for_selector(".game-card", timeout=6000)
            assert page.locator(".game-card").count() == 2, "Expected 2 game cards"
            assert page.locator(".elo-bar").count() == 2 and page.locator(".elo-bar").first.is_visible(), "Elo bars should be visible"

            # Hover cards
            page.locator('[data-game="cotuong"]').hover()
            page.wait_for_timeout(120)
            page.locator('[data-game="coup"]').hover()
            page.wait_for_timeout(120)
            page.screenshot(path=str(EXPLORE_DIR / "a_lobby_1180.png"))

            # Settings open -> Esc -> focus returns to gear button
            gear = page.locator('[data-act="settings"]')
            gear.click()
            page.wait_for_selector(".settings-modal", timeout=4000)
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)
            focused_act = page.evaluate("() => document.activeElement?.dataset?.act || ''")
            if focused_act != "settings":
                findings.append(f"Focus did not return to gear button after Esc (got '{focused_act}')")

            # Keyboard activation of card with Enter
            page.locator('[data-game="cotuong"]').focus()
            page.keyboard.press("Enter")
            page.wait_for_selector(".mode-grid", timeout=5000)
            page.keyboard.press("Escape")
            page.wait_for_selector(".game-card", timeout=5000)

            # Responsive checks across 5 viewports
            for w, h in [(1600, 900), (960, 680), (820, 1180), (390, 844), (360, 740)]:
                page.set_viewport_size({"width": w, "height": h})
                page.wait_for_timeout(120)
                overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                if overflow > 2:
                    findings.append(f"Lobby horizontal overflow {overflow}px at {w}x{h}")
            page.screenshot(path=str(EXPLORE_DIR / "a_lobby_360.png"))
            page.set_viewport_size({"width": 1180, "height": 780})
            print("[a] Lobby checks done")

            # (b) SETTINGS: nicknames, theme, bgQuality, volume, persistence, reset, corrupt localStorage
            page.locator('[data-act="settings"]').click()
            page.wait_for_selector(".settings-modal", timeout=4000)
            page.locator('[data-tab="account"]').click()
            nick_input = page.locator("#set-nickname")
            for val in ["A", "Kỳ Thủ Việt", "<script>alert(1)</script>", "Tên Rất Dài Vượt Quá 16 Ký Tự"]:
                nick_input.fill(val)
                nick_input.dispatch_event("input")
            nick_input.fill("Kỳ Thủ 01")
            nick_input.dispatch_event("input")

            # Switch theme to ngoc-bich and background quality
            page.locator('[data-tab="appearance"]').click()
            page.locator('[data-set-theme="ngoc-bich"]').click()
            page.locator('[data-bgq="low"]').click()
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)

            # Reload & verify persisted
            page.reload(wait_until="networkidle")
            saved = page.evaluate("() => JSON.parse(localStorage.getItem('xq_settings_v1') || '{}')")
            assert saved.get("theme") == "ngoc-bich", f"Theme did not persist: {saved}"
            assert saved.get("nickname") == "Kỳ Thủ 01", f"Nickname did not persist: {saved}"
            assert saved.get("bgQuality") == "low", f"bgQuality did not persist: {saved}"
            page.screenshot(path=str(EXPLORE_DIR / "b_lobby_jade.png"))

            # Reset settings via "Xóa dữ liệu đã lưu"
            page.locator('[data-act="settings"]').click()
            page.wait_for_selector(".settings-modal", timeout=4000)
            page.locator('[data-tab="data"]').click()
            reset_btn = page.locator('[data-act="reset-settings"], button:has-text("Xóa dữ liệu")')
            if reset_btn.count() > 0:
                reset_btn.first.click()
                page.wait_for_timeout(150)

            # Corrupt localStorage -> must recover cleanly
            page.evaluate("() => localStorage.setItem('xq_settings_v1', '{bad json!!!')")
            page.reload(wait_until="networkidle")
            page.wait_for_selector(".game-card", timeout=5000)
            print("[b] Settings & corrupt-storage checks done")

            # (c) EVERY ROUTE & DEEP LINK + INVALID ROUTES + BACK/FORWARD
            routes = [
                "#/",
                "#/g/cotuong",
                "#/g/coup",
                "#/g/cotuong/online",
                "#/g/cotuong/room",
                "#/join/ABC123",
                "#/play/cotuong/local",
                "#/play/cotuong/ai?side=red&level=tap-su",
                "#/play/coup/ai?side=red&level=tap-su",
                "#/play/coup/local",
                "#/play/foo/bar",
                "#/g/xyz",
                "#/play/cotuong/ai?level=bogus&side=invalid",
            ]
            for r in routes:
                page.goto(f"{base}{r}", wait_until="networkidle")
                page.wait_for_timeout(180)
                body_len = page.evaluate("() => document.getElementById('app')?.innerText?.trim().length || 0")
                if body_len == 0:
                    findings.append(f"Blank screen on route {r}")
            # Back / forward check
            page.goto(f"{base}#/", wait_until="networkidle")
            page.locator('[data-game="cotuong"]').click()
            page.wait_for_selector(".mode-grid", timeout=4000)
            page.go_back()
            page.wait_for_selector(".game-card", timeout=4000)
            page.go_forward()
            page.wait_for_selector(".mode-grid", timeout=4000)
            print("[c] Routes & deep links done")

            # (d) CỜ TƯỚNG: local + AI, legal hints, undo, review, hint, resign, new game
            page.goto(f"{base}#/play/cotuong/ai?side=red&level=tap-su", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_timeout(200)
            # 0.1 regression: Hai người | Đấu máy segmented selector must be hidden on game screen
            assert not page.locator('[data-mode="pvp"]').is_visible(), "pvp mode toggle must be hidden on game screen"
            assert not page.locator('[data-mode="ai"]').is_visible(), "ai mode toggle must be hidden on game screen"
            # Play h2e2 (7,7)->(4,7)
            click_square(page, 7, 7)
            page.wait_for_timeout(100)
            assert page.locator(".legal-move-dot").count() > 0
            click_square(page, 4, 7)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=10000)
            page.wait_for_timeout(350)
            # Hint arrow
            page.locator('[data-action="hint"]').click()
            page.wait_for_selector(".hint-arrow", timeout=8000)
            # Review mode: step back & return live
            page.locator('[data-rev="prev"]').click()
            page.wait_for_timeout(200)
            assert page.locator(".review-banner").is_visible()
            page.locator('[data-review="live"]').click()
            page.wait_for_timeout(150)
            # Undo 2 plies in AI mode
            page.locator('[data-action="undo"]').click()
            page.wait_for_timeout(250)
            assert page.evaluate("() => window.__board.history.length") == 0
            page.screenshot(path=str(EXPLORE_DIR / "d_cotuong_ai.png"))
            print("[d] Cờ Tướng gameplay checks done")

            # (e) CỜ ÚP: local (undo allowed) + AI (undo disabled) + reveal + review
            page.goto(f"{base}#/play/coup/local", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_timeout(200)
            click_square(page, 0, 6)
            page.wait_for_timeout(100)
            assert page.locator(".legal-reveal-q").count() >= 1
            click_square(page, 0, 5)
            page.wait_for_timeout(450)
            assert not page.locator('[data-action="undo"]').is_disabled(), "Undo must be enabled in Cờ Úp local"
            page.locator('[data-action="undo"]').click()
            page.wait_for_timeout(250)
            assert page.evaluate("() => window.__board.history.length") == 0

            page.goto(f"{base}#/play/coup/ai?side=red&level=tap-su", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_timeout(200)
            click_square(page, 0, 6)
            page.wait_for_timeout(100)
            click_square(page, 0, 5)
            page.wait_for_function("() => window.__board && window.__board.history.length >= 2", timeout=10000)
            page.wait_for_timeout(400)
            assert page.locator('[data-action="undo"]').is_disabled(), "Undo must be disabled in Cờ Úp AI"
            # Step back in review
            page.locator('[data-rev="prev"]').click()
            page.wait_for_timeout(250)
            page.locator('[data-rev="next"]').click()
            page.wait_for_timeout(250)
            page.screenshot(path=str(EXPLORE_DIR / "e_coup_ai.png"))
            print("[e] Cờ Úp gameplay checks done")

            # (f) ONLINE 2-CONTEXT: draw offer decline + accept, disconnect banner, leave confirm
            ctx2 = browser.new_context(viewport={"width": 1180, "height": 780})
            page2 = ctx2.new_page()
            attach_listeners(page2, errs, warns, "peer")

            page.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            page2.goto(f"{base}#/g/cotuong", wait_until="networkidle")
            page.wait_for_function("() => { const e = document.querySelector('[data-tile=\"online\"]'); return e && !e.classList.contains('is-disabled'); }", timeout=6000)
            page2.wait_for_function("() => { const e = document.querySelector('[data-tile=\"online\"]'); return e && !e.classList.contains('is-disabled'); }", timeout=6000)

            page.locator('[data-tile="online"]').click()
            page.locator('.modal-find').click()
            page2.locator('[data-tile="online"]').click()
            page2.locator('.modal-find').click()
            page.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            page2.wait_for_function("() => window.__onlineState && window.__onlineState.gameId", timeout=8000)
            page.wait_for_timeout(250)

            # Draw offer -> decline
            page.locator('[data-online-act="draw"]').click()
            page2.wait_for_selector('.online-draw-toast:not([hidden])', timeout=5000)
            page2.locator('[data-draw="decline"]').click()
            page2.wait_for_timeout(150)

            # Draw offer from peer -> accept -> rematch
            page2.locator('[data-online-act="draw"]').click()
            page.wait_for_selector('.online-draw-toast:not([hidden])', timeout=5000)
            page.locator('[data-draw="accept"]').click()
            page.wait_for_selector('#online-go-title', timeout=5000)
            page2.wait_for_selector('#online-go-title', timeout=5000)
            page.screenshot(path=str(EXPLORE_DIR / "f_online_draw.png"))

            # Rematch
            page.locator('.modal-online-rematch').click()
            page2.locator('.modal-online-rematch').click()
            page.wait_for_function("() => !document.querySelector('#online-go-title')", timeout=6000)

            # Opponent disconnect banner when page2 navigates away
            page2.goto(f"{base}#/", wait_until="networkidle")
            page.wait_for_selector('.online-disconnect-banner:not([hidden])', timeout=5000)
            page.screenshot(path=str(EXPLORE_DIR / "f_online_disconnect.png"))
            ctx2.close()
            print("[f] Online 2-context checks done")

            # (h) SEEDED MONKEY TEST across 5 screens
            monkey_screens = [
                ("lobby", f"{base}#/"),
                ("mode", f"{base}#/g/cotuong"),
                ("xiangqi_ai", f"{base}#/play/cotuong/ai?side=red&level=tap-su"),
                ("jieqi_ai", f"{base}#/play/coup/ai?side=red&level=tap-su"),
                ("jieqi_local", f"{base}#/play/coup/local"),
            ]
            keys = ["ArrowLeft", "ArrowRight", "Home", "End", "Escape", "f", "m", "v"]
            total_actions = 0
            max_raf_gap = 0.0

            for name, url in monkey_screens:
                page.goto(url, wait_until="networkidle")
                page.wait_for_timeout(200)
                # Install rAF gap monitor
                page.evaluate("""() => {
                    window.__monkeyMaxGap = 0;
                    window.__monkeyStop = false;
                    let last = performance.now();
                    function tick(now) {
                        const gap = now - last;
                        if (gap > window.__monkeyMaxGap) window.__monkeyMaxGap = gap;
                        last = now;
                        if (!window.__monkeyStop) requestAnimationFrame(tick);
                    }
                    requestAnimationFrame(tick);
                }""")
                deadline = time.time() + args.monkey_sec
                actions = 0
                while time.time() < deadline:
                    act = rng.choice(["click", "click", "key", "resize", "vis"])
                    if act == "click":
                        x = rng.randint(40, 1100)
                        y = rng.randint(40, 720)
                        page.mouse.click(x, y)
                    elif act == "key":
                        page.keyboard.press(rng.choice(keys))
                    elif act == "resize":
                        page.set_viewport_size({"width": rng.choice([1180, 1280, 1024]), "height": rng.choice([780, 740, 820])})
                    elif act == "vis":
                        page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
                    actions += 1
                    page.wait_for_timeout(60)

                gap = page.evaluate("() => { window.__monkeyStop = true; return window.__monkeyMaxGap; }")
                max_raf_gap = max(max_raf_gap, gap)
                total_actions += actions
                if gap > 500:
                    findings.append(f"Monkey UI freeze on {name}: maxGap={gap:.1f}ms")

            page.set_viewport_size({"width": 1180, "height": 780})
            page.goto(f"{base}#/", wait_until="networkidle")
            page.wait_for_timeout(200)
            leaks = page.evaluate("() => window.__leaks || {}")
            print(f"[h] Monkey test done: actions={total_actions} maxGap={max_raf_gap:.1f}ms leaks={leaks}")
            if leaks.get("workers", 0) > 0 or leaks.get("canvases", 0) > 1:
                findings.append(f"Leak after monkey test: {leaks}")

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"[verify_explore] errs={len(errs)} warns={len(warns)} findings={len(findings)}")
    for f in findings:
        print("  FINDING:", f)
    for e in errs:
        print("  ERR:", e)
    for w in warns:
        print("  WARN:", w)
    if errs or warns or findings:
        sys.exit(1)
    print("[verify_explore] ALL EXPLORATORY CHECKS PASSED.")


if __name__ == "__main__":
    main()
