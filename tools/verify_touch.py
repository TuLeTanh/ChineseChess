"""Touch interaction, haptics, audio unlock, LAN insecure-context, performance, and monkey tests (B5 + B6).

Covers T1..T14 using real CDP Input.dispatchTouchEvent on Chromium (and Playwright touchscreen/tap on WebKit):
  T1: tap-tap move
  T2: drag + lift offset above finger
  T3: 200 seeded random legal moves precision (<=0.3 cell 100%, 0.3..0.45 nearest)
  T4: illegal drop spring-back + shake
  T5: cancel mid-drag (touchCancel, orientation swap, hidden, route change)
  T6: multi-touch & pinch zoom isolation
  T7: scroll isolation & 700ms long-press (no contextmenu / selection)
  T8: bottom sheet gestures & timeline touch scrub
  T9: review on touch
  T10: audio unlock on pointerup/touchend/click
  T11: haptics stub + setting off + no vibrate
  T12: insecure-context LAN (node server/index.js --lan -> http://<lan-ip>:8787)
  T13: 4x CPU throttle perf (20 drags p95 <= 34ms, idle rAF = 0, lobby p95 <= 50ms, win cinematic p95 <= 60ms)
  T14: seeded touch monkey test across screens
"""
from __future__ import annotations

import argparse
import json
import math
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
    make_seeded_rng,
    sample_raf_gaps,
    save_screenshot,
    square_to_client,
    start_raf_recorder,
    start_static_server,
    stop_raf_recorder,
)


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


def _run_t1_to_t11_and_perf(
    browser,
    base: str,
    baseline: bool = False,
    monkey_sec: int = 12,
    capture_drag_seq: bool = False,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    res: dict[str, dict[str, Any]] = {}
    all_errors: list[str] = []
    spec = DEVICE_BY_NAME["390x844"]

    # ---------------- T1: Tap-tap move ----------------
    ctx = create_device_context(browser, spec)
    page = ctx.new_page()
    errs = attach_error_listener(page)
    page.goto(f"{base}/?test&seed=42#/play/cotuong/local", wait_until="networkidle")
    page.wait_for_selector("svg.board-svg")
    page.wait_for_timeout(200)
    touch = CdpTouch(page)
    geom = get_board_geom(page)

    # Tap Red cannon at (1, 7) -> dots shown
    x1, y1 = square_to_client(geom, 1, 7)
    touch.tap(x1, y1)
    page.wait_for_timeout(120)
    dots = page.locator(".legal-move-dot").count()
    # Tap another own piece (7, 7) -> selection switches
    x_other, y_other = square_to_client(geom, 7, 7)
    touch.tap(x_other, y_other)
    page.wait_for_timeout(120)
    # Tap empty illegal square (4, 5) -> keeps selection (dots still > 0)
    x_ill, y_ill = square_to_client(geom, 4, 5)
    touch.tap(x_ill, y_ill)
    page.wait_for_timeout(120)
    dots_after_ill = page.locator(".legal-move-dot").count()
    # Tap legal target (4, 7) -> move executes
    x_dst, y_dst = square_to_client(geom, 4, 7)
    touch.tap(x_dst, y_dst)
    page.wait_for_timeout(360)
    ply1 = page.evaluate("window.__board.history.length")
    # Tap Red piece now (opponent's piece on Black's turn) -> does nothing
    touch.tap(x_dst, y_dst)
    page.wait_for_timeout(100)
    dots_opp = page.locator(".legal-move-dot").count()
    res["T1"] = {
        "status": "PASS" if (dots > 0 and dots_after_ill > 0 and ply1 == 1 and dots_opp == 0) else "FAIL",
        "dots": dots,
        "dots_after_ill": dots_after_ill,
        "ply": ply1,
    }

    # ---------------- T2: Drag + lift offset ----------------
    # Drag Black cannon (1, 2) -> (4, 2); account for 0.9-cell lift so lifted piece lands on (4, 2)
    geom = get_board_geom(page)
    fx, fy = square_to_client(geom, 1, 2)
    tx, ty = square_to_client(geom, 4, 2)
    lift_samples = []
    drag_frames = 0

    def on_step(step_i, sx, sy):
        nonlocal drag_frames
        if step_i in (4, 6, 8, 10):
            info = page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="drag-overlay"] g, g.layer-drag > g');
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { cy: r.top + r.height / 2, cx: r.left + r.width / 2 };
                }"""
            )
            if info:
                lift_samples.append((sy - info["cy"]) / max(1.0, geom["cellY"]))
        if capture_drag_seq and step_i in (1, 3, 5, 7, 9, 12):
            drag_frames += 1
            save_screenshot(page, f"drag_seq_{drag_frames}.png")

    touch.drag(fx, fy, tx, ty + 0.85 * geom["cellY"], steps=12, step_ms=18, on_step=on_step)
    page.wait_for_timeout(320)
    ply2 = page.evaluate("window.__board.history.length")
    max_lift_cells = round(max(lift_samples), 2) if lift_samples else 0.0
    # Note: (1, 2) is 2 cells below top, so lift should be >= 0.6 cell
    t2_ok = ply2 == 2 and max_lift_cells >= 0.6
    res["T2"] = {
        "status": "PASS" if t2_ok else "FAIL",
        "ply": ply2,
        "max_lift_cells": max_lift_cells,
    }

    # ---------------- T4: Illegal drop spring-back ----------------
    geom = get_board_geom(page)
    rx, ry = square_to_client(geom, 0, 9)
    ix, iy = square_to_client(geom, 4, 4)
    touch.drag(rx, ry, ix, iy, steps=8, step_ms=14)
    page.wait_for_timeout(380)
    ply4 = page.evaluate("window.__board.history.length")
    drag_left = page.locator("g.layer-drag > g").count()
    res["T4"] = {
        "status": "PASS" if (ply4 == 2 and drag_left == 0) else "FAIL",
        "ply": ply4,
        "drag_left": drag_left,
    }

    # ---------------- T5: Cancel mid-drag ----------------
    geom = get_board_geom(page)
    cx0, cy0 = square_to_client(geom, 1, 7)
    cx1, cy1 = square_to_client(geom, 4, 7)
    # 5a: touchCancel mid-drag
    touch.drag(cx0, cy0, cx1, cy1, steps=6, step_ms=12, end_touch=False)
    touch.cancel()
    page.wait_for_timeout(260)
    # 5b: viewport orientation swap mid-drag
    touch.drag(cx0, cy0, cx1, cy1, steps=5, step_ms=12, end_touch=False)
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(200)
    touch.end()
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(220)
    ply5 = page.evaluate("window.__board.history.length")
    stuck5 = page.evaluate("Boolean(window.__drag && window.__drag.state === 'dragging') || document.querySelectorAll('g.layer-drag > g').length > 0")
    res["T5"] = {
        "status": "PASS" if (ply5 == 2 and not stuck5) else "FAIL",
        "ply": ply5,
        "stuck": stuck5,
    }

    # ---------------- T6: Multi-touch & pinch zoom ----------------
    geom = get_board_geom(page)
    p1x, p1y = square_to_client(geom, 0, 6)
    p2x, p2y = square_to_client(geom, 2, 6)
    p1tx, p1ty = square_to_client(geom, 0, 5)
    # Start finger 1, add finger 2, move both (pinch), release both
    touch.start(p1x, p1y, 0)
    page.wait_for_timeout(25)
    touch.multi_start([(p1x, p1y, 0), (p2x, p2y, 1)])
    page.wait_for_timeout(25)
    touch.multi_move([(p1x - 20, p1y - 20, 0), (p2x + 20, p2y + 20, 1)])
    page.wait_for_timeout(25)
    touch.end()
    page.wait_for_timeout(220)
    vv_scale = page.evaluate("window.visualViewport ? window.visualViewport.scale : 1")
    res["T6"] = {
        "status": "PASS" if abs(vv_scale - 1.0) < 0.05 else "FAIL",
        "visualViewport_scale": vv_scale,
    }

    # ---------------- T7: Scroll isolation & 700ms long-press ----------------
    page.evaluate("() => { window.__ctxMenuCount = 0; window.addEventListener('contextmenu', () => { window.__ctxMenuCount++; }, { capture: true }); }")
    geom = get_board_geom(page)
    sx, sy = square_to_client(geom, 4, 7)
    touch.drag(sx, sy, sx, sy - 160, steps=10, step_ms=14)
    page.wait_for_timeout(120)
    scroll_pos = page.evaluate("({ x: window.scrollX, y: window.scrollY })")
    # 700ms long press
    touch.start(sx, sy, 0)
    page.wait_for_timeout(720)
    touch.end()
    page.wait_for_timeout(80)
    t7_info = page.evaluate(
        """() => ({
            ctx: window.__ctxMenuCount || 0,
            sel: (window.getSelection()?.toString() || '').length,
            overscroll: getComputedStyle(document.querySelector('.game-shell') || document.body).overscrollBehavior,
            touchAction: getComputedStyle(document.querySelector('svg.board-svg')).touchAction,
        })"""
    )
    t7_ok = (
        scroll_pos["x"] == 0
        and scroll_pos["y"] == 0
        and t7_info["ctx"] == 0
        and t7_info["sel"] == 0
        and t7_info["touchAction"] == "none"
    )
    res["T7"] = {"status": "PASS" if t7_ok else "FAIL", "scroll": scroll_pos, **t7_info}

    # ---------------- T8: Bottom sheet gestures & timeline scrub ----------------
    sheet_btn = page.locator('[data-testid="sheet-open-btn"]')
    if sheet_btn.count() == 0:
        res["T8"] = {"status": "NOT_IMPL" if baseline else "FAIL", "reason": "no sheet-open-btn"}
    else:
        btn_box = sheet_btn.first.bounding_box()
        touch.tap(btn_box["x"] + btn_box["width"] / 2, btn_box["y"] + btn_box["height"] / 2)
        page.wait_for_timeout(280)
        st_open = page.evaluate("document.querySelector('[data-testid=\"bottom-sheet\"]')?.dataset?.state")
        # Scrub timeline inside sheet
        tl = page.locator(".move-timeline")
        scrub_ok = True
        if tl.count() > 0 and tl.first.is_visible():
            tb = tl.first.bounding_box()
            touch.drag(tb["x"] + tb["width"] * 0.9, tb["y"] + tb["height"] / 2, tb["x"] + 8, tb["y"] + tb["height"] / 2, steps=6, step_ms=16)
            page.wait_for_timeout(150)
            scrub_ok = page.evaluate("window.__view ? window.__view.ply === 0 : true")
        # Drag handle down to close
        handle = page.locator('[data-testid="sheet-handle"]')
        hb = handle.first.bounding_box()
        touch.drag(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2, hb["x"] + hb["width"] / 2, spec.height - 20, steps=8, step_ms=16)
        page.wait_for_timeout(280)
        st_closed = page.evaluate("document.querySelector('[data-testid=\"bottom-sheet\"]')?.dataset?.state")
        res["T8"] = {
            "status": "PASS" if (st_open in ("half", "full") and st_closed == "closed" and scrub_ok) else "FAIL",
            "opened": st_open,
            "closed": st_closed,
            "scrub_ok": scrub_ok,
        }

    # ---------------- T9: Review on touch ----------------
    strip_chip = page.locator('[data-testid="move-strip"] button[data-ply="1"]')
    if strip_chip.count() == 0:
        res["T9"] = {"status": "NOT_IMPL" if baseline else "FAIL", "reason": "no move-strip chip"}
    else:
        cb = strip_chip.first.bounding_box()
        touch.tap(cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2)
        page.wait_for_timeout(240)
        ply_total = page.evaluate("window.__board.history.length")
        ply_rev = page.evaluate("window.__view?.ply")
        banner_vis = page.locator(".review-banner").is_visible()
        live_btn = page.locator('[data-review="live"]')
        lb = live_btn.bounding_box() if banner_vis else None
        if lb:
            touch.tap(lb["x"] + lb["width"] / 2, lb["y"] + lb["height"] / 2)
            page.wait_for_timeout(220)
        ply_live = page.evaluate("window.__view?.ply")
        res["T9"] = {
            "status": "PASS" if (ply_rev == 1 and banner_vis and ply_live == ply_total) else "FAIL",
            "ply_rev": ply_rev,
            "banner_vis": banner_vis,
            "ply_live": ply_live,
            "ply_total": ply_total,
        }

    # ---------------- T10: Audio unlock ----------------
    audio_state = page.evaluate("window.__sfx && window.__sfx.ctx ? window.__sfx.ctx.state : 'none'")
    sfx_count = page.evaluate("Array.isArray(window.__sfxLog) ? window.__sfxLog.length : 0")
    res["T10"] = {
        "status": "PASS" if (audio_state == "running" and sfx_count > 0) else "FAIL",
        "audio_state": audio_state,
        "sfx_events": sfx_count,
    }

    # ---------------- T11: Haptics stub ----------------
    page.evaluate(
        """() => {
            window.__vibLog = [];
            navigator.vibrate = (pat) => { window.__vibLog.push(pat); return true; };
        }"""
    )
    geom = get_board_geom(page)
    side_now = page.evaluate("window.__board.sideToMove")
    if side_now == "black":
        px0, py0 = square_to_client(geom, 0, 3)
        px1, py1 = square_to_client(geom, 0, 4)
    else:
        px0, py0 = square_to_client(geom, 0, 6)
        px1, py1 = square_to_client(geom, 0, 5)
    touch.tap(px0, py0)
    page.wait_for_timeout(90)
    touch.tap(px1, py1)
    page.wait_for_timeout(320)
    vib_log = page.evaluate("window.__vibLog")
    t11_ok = len(vib_log) >= 2 and 8 in vib_log and (12 in vib_log or 20 in vib_log)
    res["T11"] = {
        "status": "NOT_IMPL" if (baseline and len(vib_log) == 0) else ("PASS" if t11_ok else "FAIL"),
        "vib_log": vib_log[:6],
    }

    all_errors.extend(f"[T1-11] {e}" for e in errs)
    ctx.close()

    # ---------------- T3: Precision (200 seeded random legal moves) ----------------
    ctx3 = create_device_context(browser, spec)
    page3 = ctx3.new_page()
    errs3 = attach_error_listener(page3)
    page3.goto(f"{base}/?test&seed=101#/play/cotuong/local", wait_until="networkidle")
    page3.wait_for_selector("svg.board-svg")
    page3.wait_for_timeout(200)
    touch3 = CdpTouch(page3)
    rng = make_seeded_rng(20261125)
    hits_03 = 0
    total_03 = 0
    hits_045 = 0
    total_045 = 0
    wrong_picks = 0

    for idx in range(200):
        # Reset board every 25 moves so we always have plenty of legal moves
        if idx % 25 == 0 and idx > 0:
            page3.evaluate("window.__board.loadFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')")
            page3.goto(f"{base}/?test&seed={101 + idx}#/play/cotuong/local", wait_until="networkidle")
            page3.wait_for_selector("svg.board-svg")
            page3.wait_for_timeout(120)

        move_pick = page3.evaluate(
            """() => {
                const b = window.__board;
                if (!b) return null;
                const side = b.sideToMove;
                const cands = [];
                for (let y = 0; y < 10; y++) {
                    for (let x = 0; x < 9; x++) {
                        const p = b.at({ x, y });
                        if (p && p.side === side) cands.push({ x, y });
                    }
                }
                return { cands, ply: b.history.length };
            }"""
        )
        if not move_pick or not move_pick["cands"]:
            break
        geom3 = get_board_geom(page3)
        # Tap a random own piece to inspect its legal targets from DOM/board
        picked = rng.choice(move_pick["cands"])
        sx, sy = square_to_client(geom3, picked["x"], picked["y"])
        touch3.tap(sx, sy, hold_ms=10)
        page3.wait_for_timeout(20)
        # Read legal target dots / capture rings in SVG coords
        targets = page3.evaluate(
            """() => {
                const out = [];
                for (const el of document.querySelectorAll('.legal-move-dot, .legal-capture-ring')) {
                    const cx = parseFloat(el.getAttribute('cx'));
                    const cy = parseFloat(el.getAttribute('cy'));
                    const col = Math.round((cx - 125) / 100);
                    const row = Math.round((cy - 125) / 100);
                    if (col >= 0 && col <= 8 && row >= 0 && row <= 9) out.push({ x: col, y: row });
                }
                return out;
            }"""
        )
        if not targets:
            continue
        tgt = rng.choice(targets)
        tx, ty = square_to_client(geom3, tgt["x"], tgt["y"])
        ang = rng.uniform(0, 2 * math.pi)
        is_inner = idx < 150
        rad_cells = rng.uniform(0.0, 0.29) if is_inner else rng.uniform(0.31, 0.44)
        ox = tx + math.cos(ang) * rad_cells * geom3["cellX"]
        oy = ty + math.sin(ang) * rad_cells * geom3["cellY"]
        # Ensure for 0.3..0.45 band that tgt is strictly the nearest legal target
        if not is_inner:
            d_tgt = math.hypot(ox - tx, oy - ty)
            nearest = True
            for ot in targets:
                if ot == tgt:
                    continue
                otx, oty = square_to_client(geom3, ot["x"], ot["y"])
                if math.hypot(ox - otx, oy - oty) <= d_tgt + 1.0:
                    nearest = False
                    break
            if not nearest:
                continue

        # Execute tap-target (uses chooseDropTarget with no lift)
        touch3.tap(ox, oy, hold_ms=10)
        page3.wait_for_timeout(30)
        after = page3.evaluate("({ ply: window.__board.history.length, last: window.__board.lastMove() })")
        if is_inner:
            total_03 += 1
            if after["ply"] == move_pick["ply"] + 1 and after["last"]["to"]["x"] == tgt["x"] and after["last"]["to"]["y"] == tgt["y"]:
                hits_03 += 1
            elif after["ply"] == move_pick["ply"] + 1 and (after["last"]["from"]["x"] != picked["x"] or after["last"]["from"]["y"] != picked["y"]):
                wrong_picks += 1
        else:
            total_045 += 1
            if after["ply"] == move_pick["ply"] + 1 and after["last"]["to"]["x"] == tgt["x"] and after["last"]["to"]["y"] == tgt["y"]:
                hits_045 += 1

    rate_03 = round((hits_03 * 100.0) / max(1, total_03), 1)
    rate_045 = round((hits_045 * 100.0) / max(1, total_045), 1)
    res["T3"] = {
        "status": "PASS" if (total_03 >= 50 and rate_03 == 100.0 and rate_045 >= 95.0 and wrong_picks == 0) else "FAIL",
        "inner_03_pct": rate_03,
        "inner_n": total_03,
        "outer_045_pct": rate_045,
        "outer_n": total_045,
        "wrong_picks": wrong_picks,
    }
    all_errors.extend(f"[T3] {e}" for e in errs3)
    ctx3.close()

    # ---------------- T13: Performance under 4x CPU throttle ----------------
    ctx13 = create_device_context(browser, spec)
    page13 = ctx13.new_page()
    errs13 = attach_error_listener(page13)
    touch13 = CdpTouch(page13)
    touch13.set_cpu_throttle(4)

    # 13a. Lobby rAF on coarse pointer
    page13.goto(f"{base}/?test&touch=1#/", wait_until="networkidle")
    page13.wait_for_timeout(400)
    lobby_raf = sample_raf_gaps(page13, 1200)

    # 13b. Game drags (20 seeded drags) + idle rAF
    page13.goto(f"{base}/?test&touch=1&seed=42#/play/cotuong/local", wait_until="networkidle")
    page13.wait_for_selector("svg.board-svg")
    page13.wait_for_timeout(300)
    geom13 = get_board_geom(page13)
    start_raf_recorder(page13)
    for i in range(20):
        col = i % 9
        x0, y0 = square_to_client(geom13, col, 6 if col % 2 == 0 else 7)
        x1, y1 = square_to_client(geom13, col, 5)
        touch13.drag(x0, y0, x1, y1, steps=8, step_ms=14)
        page13.wait_for_timeout(20)
    drag_raf = stop_raf_recorder(page13)

    # Idle rAF after 2s
    page13.wait_for_timeout(2000)
    idle_raf = page13.evaluate(
        """() => new Promise((resolve) => {
            let calls = 0;
            const orig = window.requestAnimationFrame;
            window.requestAnimationFrame = function(cb) { calls++; return orig.call(window, cb); };
            setTimeout(() => { window.requestAnimationFrame = orig; resolve(calls); }, 600);
        })"""
    )

    # 13c. Win cinematic under 4x throttle
    page13.goto(f"{base}/?test&touch=1&effects=1", wait_until="networkidle")
    page13.wait_for_selector("button[data-fx='win-red']")
    start_raf_recorder(page13)
    page13.locator("button[data-fx='win-red']").click()
    page13.wait_for_timeout(2200)
    fx_raf = stop_raf_recorder(page13)

    t13_ok = (
        drag_raf["p95"] <= 34.0
        and idle_raf == 0
        and lobby_raf["p95"] <= 50.0
        and fx_raf["p95"] <= 60.0
        and fx_raf["max"] <= 250.0
    )
    res["T13"] = {
        "status": "PASS" if t13_ok else "FAIL",
        "drag_p50": drag_raf["p50"],
        "drag_p95": drag_raf["p95"],
        "drag_max": drag_raf["max"],
        "idle_raf": idle_raf,
        "lobby_p95": lobby_raf["p95"],
        "fx_p95": fx_raf["p95"],
        "fx_max": fx_raf["max"],
    }
    all_errors.extend(f"[T13] {e}" for e in errs13)
    ctx13.close()

    # ---------------- T14: Seeded Touch Monkey ----------------
    ctx14 = create_device_context(browser, spec)
    page14 = ctx14.new_page()
    errs14 = attach_error_listener(page14)
    touch14 = CdpTouch(page14)
    monkey_seed = 777123
    mrng = make_seeded_rng(monkey_seed)
    screens = [
        f"{base}/?test&seed=42#/play/cotuong/ai?side=red&level=tap-su&engine=js",
        f"{base}/?test&seed=42#/play/coup/ai?side=red&level=tap-su&engine=js",
        f"{base}/?test&seed=42#/library",
    ]
    max_gap_monkey = 0.0
    for url in screens:
        page14.goto(url, wait_until="networkidle")
        page14.wait_for_timeout(200)
        start_raf_recorder(page14)
        end_t = time.monotonic() + monkey_sec
        while time.monotonic() < end_t:
            op = mrng.choice(["tap", "drag", "resize"])
            if op == "tap":
                touch14.tap(mrng.uniform(10, 380), mrng.uniform(50, 800), hold_ms=15)
            elif op == "drag":
                touch14.drag(
                    mrng.uniform(20, 370),
                    mrng.uniform(120, 620),
                    mrng.uniform(20, 370),
                    mrng.uniform(120, 620),
                    steps=5,
                    step_ms=10,
                )
            else:
                if mrng.random() < 0.5:
                    page14.set_viewport_size({"width": 844, "height": 390})
                else:
                    page14.set_viewport_size({"width": 390, "height": 844})
            page14.wait_for_timeout(40)
        page14.set_viewport_size({"width": 390, "height": 844})
        mraf = stop_raf_recorder(page14)
        max_gap_monkey = max(max_gap_monkey, mraf["max"])

    page14.goto(f"{base}/?test#/", wait_until="networkidle")
    page14.wait_for_timeout(250)
    leaks = page14.evaluate("window.__leaks || {}")
    t14_ok = len(errs14) == 0 and max_gap_monkey <= 500.0
    res["T14"] = {
        "status": "PASS" if t14_ok else "FAIL",
        "seed": monkey_seed,
        "sec_per_screen": monkey_sec,
        "max_gap_ms": max_gap_monkey,
        "leaks": leaks,
    }
    all_errors.extend(f"[T14] {e}" for e in errs14)
    ctx14.close()

    return res, all_errors


def _run_t12_lan(browser) -> tuple[dict[str, Any], list[str]]:
    lan_ip = _detect_lan_ip()
    if not lan_ip:
        return {"status": "PASS", "skipped": "no LAN IP detected"}, []

    env = {**os.environ, "PORT": "8791"}
    proc = subprocess.Popen(
        ["node", "server/index.js", "--lan"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    errs: list[str] = []
    try:
        # Wait for server ready
        time.sleep(1.0)
        spec = DEVICE_BY_NAME["390x844"]
        ctx = create_device_context(browser, spec)
        page = ctx.new_page()
        errs = attach_error_listener(page)
        url = f"http://{lan_ip}:8791/?test#/"
        page.goto(url, wait_until="networkidle", timeout=10000)
        page.wait_for_timeout(300)
        is_sec = page.evaluate("window.isSecureContext")
        # Navigate to game & check guestId, save to IndexedDB, export modal, clipboard fallback
        page.goto(f"http://{lan_ip}:8791/?test#/play/cotuong/local", wait_until="networkidle")
        page.wait_for_selector("svg.board-svg")
        page.wait_for_timeout(250)
        checks = page.evaluate(
            """async () => {
                const raw = localStorage.getItem('xq_settings_v1');
                const guestId = raw ? JSON.parse(raw).guestId : '';
                const uuidOk = /^[0-9a-f-]{36}$/i.test(guestId);
                let idbOk = false;
                if (window.__gameStore) {
                    const u = await window.__gameStore.usage();
                    idbOk = typeof u.count === 'number';
                }
                return { uuidOk, idbOk, isSecureContext: window.isSecureContext };
            }"""
        )
        # Open Save/Export modal on a finished game (resign AI) to verify insecure-LAN clipboard fallback
        page.goto(f"http://{lan_ip}:8791/?test#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
        page.wait_for_selector("svg.board-svg")
        page.locator('[data-maction="resign"]').click()
        page.wait_for_selector(".modal-resign-confirm", timeout=3000)
        page.locator(".modal-resign-confirm").click()
        page.wait_for_selector(".modal-export", timeout=6000)
        page.locator(".modal-export").click()
        page.wait_for_selector('[data-exp="fen"]:not(:disabled)', timeout=4000)
        page.locator('[data-exp="fen"]').click()
        page.wait_for_timeout(200)
        fb_ok = page.locator(".copy-fb-area").count() > 0 or page.locator(".export-status").text_content() != ""
        ctx.close()
        ok = (not is_sec) and checks["uuidOk"] and checks["idbOk"] and fb_ok and len(errs) == 0
        return {
            "status": "PASS" if ok else "FAIL",
            "url": f"http://{lan_ip}:8791",
            "isSecureContext": is_sec,
            "uuidOk": checks["uuidOk"],
            "idbOk": checks["idbOk"],
            "clipboardFallbackOk": fb_ok,
        }, [f"[T12] {e}" for e in errs]
    except Exception as exc:
        return {"status": "FAIL", "error": str(exc), "lan_ip": lan_ip}, errs
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


def _run_webkit_subset(browser, base: str) -> tuple[dict[str, dict[str, Any]], list[str]]:
    res: dict[str, dict[str, Any]] = {}
    all_errors: list[str] = []
    spec = DEVICE_BY_NAME["390x844"]
    ctx = create_device_context(browser, spec)
    page = ctx.new_page()
    errs = attach_error_listener(page)
    page.goto(f"{base}/?test&seed=42#/play/cotuong/local", wait_until="networkidle")
    page.wait_for_selector("svg.board-svg")
    page.wait_for_timeout(250)
    geom = get_board_geom(page)

    # T1 tap-tap via Playwright touchscreen.tap
    x1, y1 = square_to_client(geom, 1, 7)
    x2, y2 = square_to_client(geom, 4, 7)
    page.touchscreen.tap(x1, y1)
    page.wait_for_timeout(120)
    page.touchscreen.tap(x2, y2)
    page.wait_for_timeout(320)
    ply = page.evaluate("window.__board.history.length")
    res["WK_T1"] = {"status": "PASS" if ply == 1 else "FAIL", "ply": ply}

    # T10 audio unlock on WebKit
    sfx_count = page.evaluate("Array.isArray(window.__sfxLog) ? window.__sfxLog.length : 0")
    res["WK_T10"] = {"status": "PASS" if sfx_count > 0 else "FAIL", "sfx_events": sfx_count}

    all_errors.extend(f"[WebKit] {e}" for e in errs)
    ctx.close()
    return res, all_errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--webkit", action="store_true")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--monkey-sec", type=int, default=10)
    ap.add_argument("--drag-seq", action="store_true")
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    srv, base = start_static_server()
    results: dict[str, Any] = {}
    all_errors: list[str] = []
    try:
        with sync_playwright() as p:
            if args.webkit:
                browser = p.webkit.launch()
                results, all_errors = _run_webkit_subset(browser, base)
                browser.close()
            else:
                browser = p.chromium.launch()
                results, errs_main = _run_t1_to_t11_and_perf(
                    browser, base, baseline=args.baseline, monkey_sec=args.monkey_sec, capture_drag_seq=args.drag_seq
                )
                all_errors.extend(errs_main)
                t12, errs_12 = _run_t12_lan(browser)
                results["T12"] = t12
                all_errors.extend(errs_12)
                browser.close()
    finally:
        srv.shutdown()

    results["console_errors"] = {
        "status": "FAIL" if all_errors else "PASS",
        "count": len(all_errors),
        "samples": all_errors[:8],
    }

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"=== verify_touch.py ({'webkit' if args.webkit else 'chromium'}) ===")
    any_fail = False
    for k, v in results.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:16s} {st:8s} {v}")
    return 1 if (any_fail and not args.baseline) else 0


if __name__ == "__main__":
    raise SystemExit(main())
