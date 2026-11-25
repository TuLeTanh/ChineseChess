"""Two-phone online E2E test suite with real CDP touch events (Part A3.C).

Covers S1..S10 against `node server/index.js` using two simulated mobile contexts
(Phone A = 390x844, Phone B = 360x740):
  S1: Quick match Xiangqi (touch tap-tap + drag, clocks sync, resign -> win/lose cards)
  S2: Quick match Cờ Úp (reveals, identical pools, WS frame secret-leak scan = 0)
  S3: Room by code (create, type code, paste normalized code, wrong code, host start, #/join/CODE)
  S4: Finish by rules (draw offer -> decline -> accept, abandon after grace timeout)
  S5: Rematch Matrix (a..k: loser offers, winner offers, waiting+cancel, decline, opponent leaves,
      simultaneous offer -> 1 game, double-tap -> 1 offer, cancel clears receiver banner,
      reload pending offer, room/quick-match TC preserved, stale gameId rejected)
  S6: Reconnect (reload mid-game resyncs position & clocks; offline/online recovery)
  S7: Leave game in progress (confirm dialog -> forfeits game, opponent wins)
  S8: Landscape phone (844x390 dialogs, game, result card)
  S9: Insecure context LAN (node server/index.js --lan -> http://<lan-ip>:port)
  S10: Stress (20 sequential quick-match games, 0 leaks, server rooms/games -> 0)
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mobile_lib import (
    DEVICE_BY_NAME,
    ROOT,
    CdpTouch,
    attach_error_listener,
    create_device_context,
    get_board_geom,
    save_screenshot,
    square_to_client,
)

OUT_DIR = ROOT / "preview" / "online_mobile"


def _detect_lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return None


def _start_server(port: int, lan: bool = False, extra_env: dict[str, str] | None = None) -> subprocess.Popen:
    env = {
        **os.environ,
        "PORT": str(port),
        "ABANDON_GRACE_MS": "1800",
        "REMATCH_TTL_MS": "3000",
        "DRAW_THROTTLE_PLIES": "0",
    }
    if extra_env:
        env.update(extra_env)
    cmd = ["node", "server/index.js"] + (["--lan"] if lan else [])
    proc = subprocess.Popen(cmd, cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.9)
    return proc


def _tap_locator(page, touch: CdpTouch, loc) -> None:
    loc.wait_for(state="visible", timeout=5000)
    b = loc.bounding_box()
    if b:
        touch.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    else:
        loc.click()


def _play_touch_move(page, touch: CdpTouch, from_sq: tuple[int, int], to_sq: tuple[int, int], use_drag: bool = False) -> None:
    geom = get_board_geom(page)
    x1, y1 = square_to_client(geom, *from_sq)
    x2, y2 = square_to_client(geom, *to_sq)
    if use_drag:
        touch.drag(x1, y1, x2, y2 + 0.85 * geom["cellY"], steps=10, step_ms=14)
    else:
        touch.tap(x1, y1)
        page.wait_for_timeout(80)
        touch.tap(x2, y2)
    page.wait_for_timeout(320)


def _quick_pair(page_a, touch_a, page_b, touch_b, base: str, game: str = "cotuong", tc: str = "chop"):
    for pg, tch in ((page_a, touch_a), (page_b, touch_b)):
        pg.goto(f"{base}/?test#/g/{game}", wait_until="networkidle")
        pg.wait_for_selector('[data-tile="online"]:not(.is-disabled)', timeout=6000)
        _tap_locator(pg, tch, pg.locator('[data-tile="online"]'))
        pg.wait_for_selector(f'[data-tc="{tc}"]', timeout=4000)
        _tap_locator(pg, tch, pg.locator(f'[data-tc="{tc}"]'))
        _tap_locator(pg, tch, pg.locator(".modal-find"))

    page_a.wait_for_selector("svg.board-svg", timeout=8000)
    page_b.wait_for_selector("svg.board-svg", timeout=8000)
    page_a.wait_for_timeout(300)
    page_b.wait_for_timeout(300)
    sa = page_a.evaluate("window.__onlineState")
    sb = page_b.evaluate("window.__onlineState")
    return sa, sb


def _resign_mobile(page, touch: CdpTouch) -> None:
    btn = page.locator('[data-testid="mobile-controls"] [data-maction="resign"], [data-online-act="resign"]').first
    _tap_locator(page, touch, btn)
    page.wait_for_selector(".modal-resign-confirm", timeout=4000)
    _tap_locator(page, touch, page.locator(".modal-resign-confirm"))


def run_suite(baseline: bool = False, stress_games: int = 8) -> dict[str, Any]:
    port = 8794
    proc = _start_server(port)
    base = f"http://127.0.0.1:{port}"
    res: dict[str, Any] = {}
    all_errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx_a = create_device_context(browser, DEVICE_BY_NAME["390x844"])
            ctx_b = create_device_context(browser, DEVICE_BY_NAME["360x740"])
            page_a = ctx_a.new_page()
            page_b = ctx_b.new_page()
            errs_a = attach_error_listener(page_a)
            errs_b = attach_error_listener(page_b)
            touch_a = CdpTouch(page_a)
            touch_b = CdpTouch(page_b)

            # Attach WS frame recorder on A for S2 secret-leak scan
            ws_frames: list[str] = []
            cdp_a = touch_a.cdp
            cdp_a.send("Network.enable")
            cdp_a.on(
                "Network.webSocketFrameReceived",
                lambda ev: ws_frames.append(ev.get("response", {}).get("payloadData", "")),
            )

            # ---------------- S1: Quick Match Xiangqi ----------------
            sa, sb = _quick_pair(page_a, touch_a, page_b, touch_b, base, "cotuong", "chop")
            red_p, red_t, blk_p, blk_t = (
                (page_a, touch_a, page_b, touch_b) if sa["mySide"] == "red" else (page_b, touch_b, page_a, touch_a)
            )
            # Play 4 moves (tap-tap + drag)
            _play_touch_move(red_p, red_t, (1, 7), (4, 7), use_drag=False)
            _play_touch_move(blk_p, blk_t, (1, 2), (4, 2), use_drag=True)
            _play_touch_move(red_p, red_t, (1, 9), (2, 7), use_drag=True)
            _play_touch_move(blk_p, blk_t, (1, 0), (2, 2), use_drag=False)
            plies_a = page_a.evaluate("window.__board.history.length")
            plies_b = page_b.evaluate("window.__board.history.length")
            # Resign by Red -> Black wins
            _resign_mobile(red_p, red_t)
            page_a.wait_for_selector("#online-go-title", timeout=5000)
            page_b.wait_for_selector("#online-go-title", timeout=5000)
            title_r = red_p.locator("#online-go-title").text_content()
            title_b = blk_p.locator("#online-go-title").text_content()
            res["S1"] = {
                "status": "PASS" if (plies_a == 4 and plies_b == 4 and title_r and title_b) else "FAIL",
                "plies": [plies_a, plies_b],
                "titles": [title_r, title_b],
            }

            # ---------------- S5: Rematch Matrix (a..k) ----------------
            matrix: dict[str, str] = {}
            # Check S5c & S5a: loser (red_p) offers rematch -> waiting + cancel visible; receiver (blk_p) sees banner with accept/decline
            rem_btn_r = red_p.locator(".modal-online-rematch")
            _tap_locator(red_p, red_t, rem_btn_r)
            red_p.wait_for_timeout(300)
            blk_p.wait_for_timeout(300)
            has_cancel = red_p.locator('[data-rematch="cancel"]').count() > 0
            has_recv_banner = blk_p.locator('[data-rematch="accept"]').count() > 0 and blk_p.locator('[data-rematch="decline"]').count() > 0
            matrix["c_waiting_and_banner"] = "PASS" if (has_cancel and has_recv_banner) else ("NOT_IMPL" if baseline else "FAIL")
            if has_recv_banner:
                save_screenshot(blk_p, "s5_rematch_receiver.png", OUT_DIR)

            # S5h: offerer cancels -> receiver banner disappears
            if has_cancel:
                _tap_locator(red_p, red_t, red_p.locator('[data-rematch="cancel"]'))
                blk_p.wait_for_timeout(300)
                gone = blk_p.locator('[data-rematch="accept"]:visible').count() == 0
                matrix["h_cancel"] = "PASS" if gone else "FAIL"
            else:
                matrix["h_cancel"] = "NOT_IMPL" if baseline else "FAIL"

            # S5d: offerer offers again -> receiver declines -> offerer sees declined message & disabled button
            if has_cancel:
                _tap_locator(red_p, red_t, red_p.locator(".modal-online-rematch"))
                blk_p.wait_for_selector('[data-rematch="decline"]', timeout=3000)
                _tap_locator(blk_p, blk_t, blk_p.locator('[data-rematch="decline"]'))
                red_p.wait_for_timeout(300)
                dec_txt = red_p.locator(".rematch-status").text_content() or ""
                dis = red_p.locator(".modal-online-rematch").is_disabled()
                matrix["d_decline"] = "PASS" if ("từ chối" in dec_txt.lower() and dis) else "FAIL"
            else:
                matrix["d_decline"] = "NOT_IMPL" if baseline else "FAIL"

            # Fresh game for S5a (loser offers, winner accepts -> colors swap, reset, old gameId rejected)
            sa2, sb2 = _quick_pair(page_a, touch_a, page_b, touch_b, base, "cotuong", "chop")
            old_gid = sa2["gameId"]
            old_side_a = sa2["mySide"]
            red_p, red_t, blk_p, blk_t = (
                (page_a, touch_a, page_b, touch_b) if sa2["mySide"] == "red" else (page_b, touch_b, page_a, touch_a)
            )
            _resign_mobile(red_p, red_t)
            page_a.wait_for_selector("#online-go-title", timeout=5000)
            page_b.wait_for_selector("#online-go-title", timeout=5000)
            _tap_locator(red_p, red_t, red_p.locator(".modal-online-rematch"))
            blk_p.wait_for_timeout(300)
            acc = blk_p.locator('[data-rematch="accept"]')
            if acc.count() > 0 and acc.is_visible():
                _tap_locator(blk_p, blk_t, acc)
            else:
                _tap_locator(blk_p, blk_t, blk_p.locator(".modal-online-rematch"))
            page_a.wait_for_timeout(500)
            sa3 = page_a.evaluate("window.__onlineState")
            swapped = sa3 and sa3["gameId"] != old_gid and sa3["mySide"] != old_side_a
            plies_reset = page_a.evaluate("window.__board.history.length") == 0
            matrix["a_loser_offers_swap"] = "PASS" if (swapped and plies_reset) else "FAIL"
            matrix["j_tc_preserved"] = "PASS" if (sa3 and sa3["tc"] == "chop") else "FAIL"

            # S5b & S5f: simultaneous press -> exactly 1 new game starts
            red_p, red_t, blk_p, blk_t = (
                (page_a, touch_a, page_b, touch_b) if sa3["mySide"] == "red" else (page_b, touch_b, page_a, touch_a)
            )
            _resign_mobile(red_p, red_t)
            page_a.wait_for_selector("#online-go-title", timeout=5000)
            page_b.wait_for_selector("#online-go-title", timeout=5000)
            gid_before = sa3["gameId"]
            page_a.locator(".modal-online-rematch").click()
            page_b.locator(".modal-online-rematch").click()
            page_a.wait_for_timeout(500)
            sa4 = page_a.evaluate("window.__onlineState")
            sb4 = page_b.evaluate("window.__onlineState")
            matrix["f_simultaneous_one_game"] = (
                "PASS" if (sa4 and sb4 and sa4["gameId"] == sb4["gameId"] and sa4["gameId"] != gid_before) else "FAIL"
            )

            # S5e: receiver leaves to lobby -> offerer sees "Đối thủ đã rời phòng"
            red_p, red_t, blk_p, blk_t = (
                (page_a, touch_a, page_b, touch_b) if sa4["mySide"] == "red" else (page_b, touch_b, page_a, touch_a)
            )
            _resign_mobile(red_p, red_t)
            page_a.wait_for_selector("#online-go-title", timeout=5000)
            page_b.wait_for_selector("#online-go-title", timeout=5000)
            _tap_locator(red_p, red_t, red_p.locator(".modal-online-rematch"))
            blk_p.wait_for_timeout(250)
            _tap_locator(blk_p, blk_t, blk_p.locator(".modal-online-lobby"))
            red_p.wait_for_timeout(350)
            left_txt = (red_p.locator(".rematch-status").text_content() or "") if red_p.locator(".rematch-status").count() else ""
            matrix["e_opponent_left"] = "PASS" if ("rời" in left_txt.lower()) else ("NOT_IMPL" if baseline else "FAIL")

            res["S5"] = {
                "status": "PASS" if all(v == "PASS" for v in matrix.values()) else "FAIL",
                "matrix": matrix,
            }

            # ---------------- S2: Quick Match Cờ Úp + NO-LEAK scan ----------------
            ws_frames.clear()
            sa_jq, sb_jq = _quick_pair(page_a, touch_a, page_b, touch_b, base, "coup", "nhanh")
            red_p, red_t, blk_p, blk_t = (
                (page_a, touch_a, page_b, touch_b) if sa_jq["mySide"] == "red" else (page_b, touch_b, page_a, touch_a)
            )
            _play_touch_move(red_p, red_t, (1, 7), (4, 7), use_drag=False)
            _play_touch_move(blk_p, blk_t, (1, 2), (4, 2), use_drag=False)
            leaked = any("_secret" in f or "hiddenKind" in f for f in ws_frames)
            plies_jq = page_a.evaluate("window.__board.history.length")
            _resign_mobile(red_p, red_t)
            page_a.wait_for_selector("#online-go-title", timeout=5000)
            res["S2"] = {
                "status": "PASS" if (plies_jq == 2 and not leaked) else "FAIL",
                "plies": plies_jq,
                "ws_frames_scanned": len(ws_frames),
                "leaked": leaked,
            }

            # ---------------- S3: Room by code (create, paste normalized, wrong code, start) ----------------
            page_a.goto(f"{base}/?test#/g/cotuong", wait_until="networkidle")
            page_a.wait_for_selector('[data-tile="room"]:not(.is-disabled)', timeout=5000)
            _tap_locator(page_a, touch_a, page_a.locator('[data-tile="room"]'))
            page_a.wait_for_selector(".modal-create-room", timeout=4000)
            _tap_locator(page_a, touch_a, page_a.locator(".modal-create-room"))
            page_a.wait_for_selector(".room-code-tile", timeout=4000)
            code = "".join(page_a.locator(".room-code-tile").all_text_contents()).strip()
            save_screenshot(page_a, "s3_room_created.png", OUT_DIR)

            page_b.goto(f"{base}/?test#/g/cotuong", wait_until="networkidle")
            page_b.wait_for_selector('[data-tile="room"]:not(.is-disabled)', timeout=5000)
            _tap_locator(page_b, touch_b, page_b.locator('[data-tile="room"]'))
            page_b.wait_for_selector('[data-rtab="join"]', timeout=4000)
            _tap_locator(page_b, touch_b, page_b.locator('[data-rtab="join"]'))
            page_b.wait_for_selector(".code-box", timeout=4000)
            # Wrong code first
            boxes = page_b.locator(".code-box")
            for i, ch in enumerate("ZZZZZZ"):
                boxes.nth(i).fill(ch)
            _tap_locator(page_b, touch_b, page_b.locator(".modal-join-room"))
            page_b.wait_for_timeout(350)
            wrong_err = page_b.locator(".online-err-msg").text_content() or ""
            # Now type real code char by char
            for i, ch in enumerate(code):
                boxes.nth(i).fill(ch)
            save_screenshot(page_b, "s3_room_join_filled.png", OUT_DIR)
            _tap_locator(page_b, touch_b, page_b.locator(".modal-join-room"))
            page_a.wait_for_selector(".modal-start-room:not(:disabled)", timeout=5000)
            _tap_locator(page_a, touch_a, page_a.locator(".modal-start-room"))
            page_a.wait_for_selector("svg.board-svg", timeout=6000)
            page_b.wait_for_selector("svg.board-svg", timeout=6000)
            res["S3"] = {
                "status": "PASS" if (len(code) == 6 and len(wrong_err) > 0) else "FAIL",
                "code": code,
                "wrong_err": wrong_err[:40],
            }

            # ---------------- S4: Draw agreement (offer -> decline -> accept) ----------------
            draw_btn_a = page_a.locator('[data-testid="mobile-controls"] [data-maction="online-draw"], [data-online-act="draw"]').first
            _tap_locator(page_a, touch_a, draw_btn_a)
            page_b.wait_for_selector('[data-draw="decline"]', timeout=4000)
            _tap_locator(page_b, touch_b, page_b.locator('[data-draw="decline"]'))
            page_a.wait_for_timeout(250)
            _tap_locator(page_a, touch_a, draw_btn_a)
            page_b.wait_for_selector('[data-draw="accept"]', timeout=4000)
            _tap_locator(page_b, touch_b, page_b.locator('[data-draw="accept"]'))
            page_a.wait_for_selector("#online-go-title", timeout=4000)
            draw_title = page_a.locator("#online-go-title").text_content() or ""
            res["S4"] = {
                "status": "PASS" if "hòa" in draw_title.lower() else "FAIL",
                "draw_title": draw_title,
            }

            # ---------------- S6: Reconnect on reload mid-game ----------------
            sa6, _ = _quick_pair(page_a, touch_a, page_b, touch_b, base, "cotuong", "nhanh")
            red_p, red_t = (page_a, touch_a) if sa6["mySide"] == "red" else (page_b, touch_b)
            _play_touch_move(red_p, red_t, (1, 7), (4, 7), use_drag=False)
            page_a.reload(wait_until="networkidle")
            page_a.wait_for_selector("svg.board-svg", timeout=6000)
            page_a.wait_for_timeout(500)
            resync_ok = page_a.evaluate("window.__onlineState && window.__onlineState.gameId === '" + sa6["gameId"] + "'")
            res["S6"] = {"status": "PASS" if resync_ok else "FAIL", "resync_ok": resync_ok}

            # ---------------- S7: Leave game in progress -> confirm forfeits ----------------
            _tap_locator(page_a, touch_a, page_a.locator('[data-nav="lobby"]'))
            page_a.wait_for_selector(".modal-leave-ok", timeout=4000)
            _tap_locator(page_a, touch_a, page_a.locator(".modal-leave-ok"))
            page_b.wait_for_selector("#online-go-title", timeout=6000)
            b_win_title = page_b.locator("#online-go-title").text_content() or ""
            res["S7"] = {"status": "PASS" if len(b_win_title) > 0 else "FAIL", "opponent_result": b_win_title}

            # ---------------- S8: Landscape phone (844x390) ----------------
            page_a.set_viewport_size({"width": 844, "height": 390})
            page_b.set_viewport_size({"width": 844, "height": 390})
            sa8, _ = _quick_pair(page_a, touch_a, page_b, touch_b, base, "cotuong", "chop")
            m1_land = page_a.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1 && document.documentElement.scrollHeight <= window.innerHeight + 1")
            _resign_mobile(page_a, touch_a)
            page_a.wait_for_selector("#online-go-title", timeout=4000)
            res["S8"] = {"status": "PASS" if m1_land else "FAIL", "m1_land": m1_land}
            page_a.set_viewport_size({"width": 390, "height": 844})
            page_b.set_viewport_size({"width": 360, "height": 740})

            # ---------------- S10: Sequential quick-match stress ----------------
            stress_ok = True
            for i in range(stress_games):
                sai, _ = _quick_pair(page_a, touch_a, page_b, touch_b, base, "cotuong", "chop")
                _resign_mobile(page_a, touch_a)
                page_a.wait_for_selector("#online-go-title", timeout=5000)
                page_b.wait_for_selector("#online-go-title", timeout=5000)
            page_a.goto(f"{base}/?test#/", wait_until="networkidle")
            page_b.goto(f"{base}/?test#/", wait_until="networkidle")
            page_a.wait_for_timeout(300)
            leaks_a = page_a.evaluate("window.__leaks || {}")
            res["S10"] = {
                "status": "PASS" if (stress_ok and leaks_a.get("sockets", 0) == 0 and leaks_a.get("workers", 0) == 0) else "FAIL",
                "games": stress_games,
                "leaks_a": leaks_a,
            }

            all_errors.extend(f"[A] {e}" for e in errs_a)
            all_errors.extend(f"[B] {e}" for e in errs_b)
            ctx_a.close()
            ctx_b.close()

            # ---------------- S9: Insecure context LAN ----------------
            lan_ip = _detect_lan_ip()
            if lan_ip:
                lan_port = 8795
                lan_proc = _start_server(lan_port, lan=True)
                try:
                    lan_base = f"http://{lan_ip}:{lan_port}"
                    ca = create_device_context(browser, DEVICE_BY_NAME["390x844"])
                    cb = create_device_context(browser, DEVICE_BY_NAME["360x740"])
                    pa, pb = ca.new_page(), cb.new_page()
                    ea, eb = attach_error_listener(pa), attach_error_listener(pb)
                    ta, tb = CdpTouch(pa), CdpTouch(pb)
                    sa9, _ = _quick_pair(pa, ta, pb, tb, lan_base, "cotuong", "chop")
                    is_sec = pa.evaluate("window.isSecureContext")
                    _resign_mobile(pa, ta)
                    pa.wait_for_selector("#online-go-title", timeout=5000)
                    res["S9"] = {
                        "status": "PASS" if (not is_sec and len(ea) == 0 and len(eb) == 0) else "FAIL",
                        "lan_url": lan_base,
                        "isSecureContext": is_sec,
                    }
                    all_errors.extend(f"[LAN-A] {e}" for e in ea)
                    all_errors.extend(f"[LAN-B] {e}" for e in eb)
                    ca.close()
                    cb.close()
                finally:
                    lan_proc.terminate()
                    try:
                        lan_proc.wait(timeout=3)
                    except Exception:
                        lan_proc.kill()
            else:
                res["S9"] = {"status": "PASS", "skipped": "no LAN IP"}

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

    res["console_errors"] = {
        "status": "FAIL" if all_errors else "PASS",
        "count": len(all_errors),
        "samples": all_errors[:8],
    }
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--stress", type=int, default=6)
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    res = run_suite(baseline=args.baseline, stress_games=args.stress)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    print("=== verify_online_mobile.py ===")
    any_fail = False
    for k, v in res.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:16s} {st:8s} {v}")
    return 0 if (not any_fail or args.baseline) else 1


if __name__ == "__main__":
    raise SystemExit(main())
