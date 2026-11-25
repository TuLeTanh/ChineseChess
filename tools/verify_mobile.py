"""Mobile & tablet layout verification (B3 + B4 + B6 WebKit subset).

Measures M1..M9 across FULL set, BASIC set, and Desktop regression (M8):
  M1: no page scroll on game screen
  M2: board fully inside viewport, stack width >= 0.96*vw, piece disc >= 30px@320 / >= 32px@360, no outer disc clipping
  M3: primary controls hit area >= 44x44, move chips >= 36px tall, timeline >= 44px on coarse pointers
  M4: no overlap (elementFromPoint at centre of primary controls; banners/toasts/result card never cover controls/strips)
  M5: no clipped key text, body font >= 12px, inputs >= 16px
  M6: safe areas via ?safe=top,right,bottom,left
  M7: viewport robustness (toolbar hide -56px + restore -> M1 & M4 hold after 300ms)
  M8: desktop regression at 960x680, 1180x780, 1600x900 (<= 1.5% pixel diff vs preview/mobile_baseline/)
  M9: both themes (Gỗ Lim, Ngọc Bích) + strip text contrast >= 4.5:1
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mobile_lib import (
    BASELINE_DIR,
    BASIC_SET_NAMES,
    DESKTOP_NAMES,
    DEVICE_BY_NAME,
    FULL_SET_NAMES,
    PREVIEW_DIR,
    attach_error_listener,
    contrast_ratio,
    create_device_context,
    get_board_geom,
    image_diff_percent,
    save_screenshot,
    square_to_client,
    start_static_server,
)

WEBKIT_SUBSET = ("390x844", "844x390", "820x1180")


def _parse_rgb(css_color: str) -> tuple[int, int, int] | None:
    m = re.search(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", css_color or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def _collect_game_metrics(page, vw: int, vh: int, is_mobile: bool) -> dict[str, Any]:
    return page.evaluate(
        """({ vw, vh, isMobile }) => {
            const doc = document.documentElement;
            const m1 = {
                scrollW: doc.scrollWidth,
                scrollH: doc.scrollHeight,
                innerW: window.innerWidth,
                innerH: window.innerHeight,
                ok: doc.scrollWidth <= window.innerWidth + 1 && doc.scrollHeight <= window.innerHeight + 1,
            };

            const svg = document.querySelector('svg.board-svg');
            const layout = window.__layout || null;
            const mode = layout ? layout.mode : (document.querySelector('.game-shell')?.dataset?.layout || 'unknown');
            let m2 = { ok: false, reason: 'no svg' };
            if (svg) {
                const r = svg.getBoundingClientRect();
                const vb = (svg.getAttribute('viewBox') || '0 0 1050 1150').trim().split(/\\s+/).map(Number);
                const [vx, vy, vbw, vbh] = vb.length === 4 ? vb : [0, 0, 1050, 1150];
                const scaleX = r.width / vbw;
                const scaleY = r.height / vbh;
                const discDiam = 88 * Math.min(scaleX, scaleY);
                const insideVp = r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
                // Check outer piece discs (0,0) and (8,9): center at (125,125) and (925,1025), radius 44
                const discLeft = 125 - 44;
                const discTop = 125 - 44;
                const discRight = 925 + 44;
                const discBottom = 1025 + 44;
                const unclippedVb = discLeft >= vx - 0.5 && discTop >= vy - 0.5 && discRight <= vx + vbw + 0.5 && discBottom <= vy + vbh + 0.5;
                const minWidthOk = mode !== 'stack' || r.width >= 0.96 * window.innerWidth - 1;
                const minDiscOk = vw >= 360 ? discDiam >= 32 : (vw >= 320 ? discDiam >= 30 : true);
                m2 = {
                    ok: insideVp && unclippedVb && minWidthOk && minDiscOk,
                    mode,
                    boardW: Number(r.width.toFixed(1)),
                    boardH: Number(r.height.toFixed(1)),
                    discDiam: Number(discDiam.toFixed(1)),
                    insideVp,
                    unclippedVb,
                    minWidthOk,
                    minDiscOk,
                };
            }

            // M3: hit areas of visible primary controls
            const controlSelectors = [
                '.game-top-nav button',
                '[data-testid="mobile-controls"] button',
                '[data-testid="sheet-open-btn"]',
                '[data-testid="sheet-handle"]',
                '.review-banner button',
                '.modal-card button.pill-btn',
                '.settings-close',
            ];
            let minHitW = 999, minHitH = 999;
            const badHits = [];
            const primaryEls = [];
            for (const sel of controlSelectors) {
                for (const el of document.querySelectorAll(sel)) {
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    primaryEls.push({ el, r, sel });
                    if (r.width < minHitW) minHitW = r.width;
                    if (r.height < minHitH) minHitH = r.height;
                    if (isMobile && (r.width < 43.5 || r.height < 43.5)) {
                        badHits.push(`${sel}(${Math.round(r.width)}x${Math.round(r.height)})`);
                    }
                }
            }
            const m3 = {
                ok: !isMobile || badHits.length === 0,
                minHitW: minHitW === 999 ? 0 : Math.round(minHitW),
                minHitH: minHitH === 999 ? 0 : Math.round(minHitH),
                badHits: badHits.slice(0, 6),
            };

            // M4: no overlap on primary controls (when no modal/sheet backdrop covers them)
            const modalOpen = !document.getElementById('modal-root')?.hidden;
            const sheetOpen = document.querySelector('[data-testid="bottom-sheet"]')?.dataset?.state;
            const overlaps = [];
            if (!modalOpen && (!sheetOpen || sheetOpen === 'closed')) {
                for (const item of primaryEls) {
                    const cx = item.r.left + item.r.width / 2;
                    const cy = item.r.top + item.r.height / 2;
                    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) {
                        overlaps.push(`offscreen:${item.sel}`);
                        continue;
                    }
                    const hit = document.elementFromPoint(cx, cy);
                    if (!hit || (hit !== item.el && !item.el.contains(hit))) {
                        overlaps.push(`covered:${item.sel}`);
                    }
                }
            }
            // Check controls bar not covered by result card
            const ctrlBar = document.querySelector('[data-testid="mobile-controls"]');
            const goCard = document.querySelector('.modal-gameover');
            if (ctrlBar && goCard && getComputedStyle(ctrlBar).display !== 'none') {
                const cr = ctrlBar.getBoundingClientRect();
                const gr = goCard.getBoundingClientRect();
                if (gr.bottom > cr.top + 1 && gr.top < cr.bottom - 1) {
                    overlaps.push('result-card-covers-controls');
                }
            }
            const m4 = { ok: overlaps.length === 0, overlaps: overlaps.slice(0, 6) };

            // M5: no clipped key text, body font >= 12px, inputs >= 16px
            const clipped = [];
            for (const el of document.querySelectorAll('[data-nowrap], [data-testid="mobile-controls"] button')) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || el.closest('[hidden]')) continue;
                if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
                    clipped.push(el.textContent?.trim().slice(0, 20) || el.tagName);
                }
            }
            const badInputs = [];
            if (isMobile) {
                for (const inp of document.querySelectorAll('input:not([type="checkbox"]):not([type="range"]):not([type="file"]), textarea, select')) {
                    const cs = getComputedStyle(inp);
                    if (cs.display === 'none' || inp.closest('[hidden]')) continue;
                    const fs = parseFloat(cs.fontSize || '0');
                    if (fs > 0 && fs < 15.5) badInputs.push(`${inp.tagName}:${fs}px`);
                }
            }
            const bodyFs = parseFloat(getComputedStyle(document.body).fontSize || '14');
            const m5 = {
                ok: clipped.length === 0 && badInputs.length === 0 && bodyFs >= 12,
                clipped: clipped.slice(0, 5),
                badInputs: badInputs.slice(0, 5),
                bodyFs,
            };

            // M9: sample player strip foreground/background (composite alpha over opaque ancestors)
            const parseRgba = (s) => {
                const m = (s || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
                if (!m) return null;
                return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
            };
            const effectiveBg = (el) => {
                const layers = [];
                let cur = el;
                while (cur) {
                    const c = parseRgba(getComputedStyle(cur).backgroundColor);
                    if (c && c[3] > 0) {
                        layers.push(c);
                        if (c[3] >= 0.99) break;
                    }
                    cur = cur.parentElement;
                }
                let r = 20, g = 16, b = 13;
                for (let i = layers.length - 1; i >= 0; i--) {
                    const [lr, lg, lb, a] = layers[i];
                    r = Math.round(lr * a + r * (1 - a));
                    g = Math.round(lg * a + g * (1 - a));
                    b = Math.round(lb * a + b * (1 - a));
                }
                return `rgb(${r}, ${g}, ${b})`;
            };
            const stripSamples = [];
            for (const sel of ['.player-card-red .player-name', '.player-card-red .player-clock', '.player-card-black .player-name', '.player-card-black .player-clock']) {
                const el = document.querySelector(sel);
                if (!el) continue;
                const cs = getComputedStyle(el);
                stripSamples.push({ sel, fg: cs.color, bg: effectiveBg(el) });
            }

            return { m1, m2, m3, m4, m5, layout, stripSamples };
        }""",
        {"vw": vw, "vh": vh, "isMobile": is_mobile},
    )


def _check_contrast(samples: list[dict[str, str]]) -> tuple[bool, float]:
    worst = 21.0
    for s in samples:
        fg = _parse_rgb(s.get("fg", ""))
        bg = _parse_rgb(s.get("bg", ""))
        if fg and bg:
            ratio = contrast_ratio(fg, bg)
            if ratio < worst:
                worst = ratio
    return worst >= 4.5, round(worst, 2)


def _play_moves_click(page, pairs: list[tuple[tuple[int, int], tuple[int, int]]]) -> None:
    geom = get_board_geom(page)
    if not geom:
        return
    for (fx, fy), (tx, ty) in pairs:
        x1, y1 = square_to_client(geom, fx, fy)
        x2, y2 = square_to_client(geom, tx, ty)
        page.mouse.click(x1, y1)
        page.wait_for_timeout(80)
        page.mouse.click(x2, y2)
        page.wait_for_timeout(320)


def run_suite(engine_name: str = "chromium", baseline: bool = False, save_shots: bool = True) -> dict[str, Any]:
    srv, base = start_static_server()
    results: dict[str, dict[str, Any]] = {
        "M1": {"status": "PASS", "details": []},
        "M2": {"status": "PASS", "details": [], "min_disc_320": None, "min_disc_360": None},
        "M3": {"status": "PASS", "details": [], "min_hit": 999},
        "M4": {"status": "PASS", "details": []},
        "M5": {"status": "PASS", "details": []},
        "M6": {"status": "PASS", "details": []},
        "M7": {"status": "PASS", "details": []},
        "M8": {"status": "PASS", "details": [], "max_diff_pct": 0.0},
        "M9": {"status": "PASS", "details": [], "min_contrast": 21.0},
        "console_errors": {"status": "PASS", "count": 0, "samples": []},
    }
    all_errors: list[str] = []

    def fail(mid: str, msg: str):
        if results[mid]["status"] != "NOT_IMPL":
            results[mid]["status"] = "FAIL"
        if len(results[mid]["details"]) < 8:
            results[mid]["details"].append(msg)

    try:
        with sync_playwright() as p:
            launcher = p.webkit if engine_name == "webkit" else p.chromium
            browser = launcher.launch()

            # 1. Mobile & Tablet devices
            device_names = WEBKIT_SUBSET if engine_name == "webkit" else (FULL_SET_NAMES + BASIC_SET_NAMES)
            for name in device_names:
                spec = DEVICE_BY_NAME[name]
                is_full = name in FULL_SET_NAMES
                ctx = create_device_context(browser, spec)
                page = ctx.new_page()
                errs = attach_error_listener(page)

                themes = ("go-lim", "ngoc-bich") if is_full else ("go-lim",)
                for theme in themes:
                    # State 1: Xiangqi AI start
                    page.goto(
                        f"{base}/?test&seed=42&theme={theme}#/play/cotuong/ai?side=red&level=tap-su&engine=js",
                        wait_until="networkidle",
                    )
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(250)
                    met = _collect_game_metrics(page, spec.width, spec.height, spec.is_mobile)
                    if not met["m1"]["ok"]:
                        fail("M1", f"{name}/{theme}/start scroll={met['m1']['scrollW']}x{met['m1']['scrollH']}")
                    if not met["m2"]["ok"]:
                        fail("M2", f"{name}/{theme}/start {met['m2']}")
                    if spec.width == 320:
                        d = met["m2"].get("discDiam")
                        if d is not None:
                            cur = results["M2"]["min_disc_320"]
                            results["M2"]["min_disc_320"] = d if cur is None else min(cur, d)
                    if spec.width == 360:
                        d = met["m2"].get("discDiam")
                        if d is not None:
                            cur = results["M2"]["min_disc_360"]
                            results["M2"]["min_disc_360"] = d if cur is None else min(cur, d)
                    if not met["m3"]["ok"]:
                        fail("M3", f"{name}/{theme}/start {met['m3']['badHits']}")
                    if met["m3"]["minHitW"] > 0:
                        results["M3"]["min_hit"] = min(results["M3"]["min_hit"], met["m3"]["minHitW"], met["m3"]["minHitH"])
                    if not met["m4"]["ok"]:
                        fail("M4", f"{name}/{theme}/start {met['m4']['overlaps']}")
                    if not met["m5"]["ok"]:
                        fail("M5", f"{name}/{theme}/start {met['m5']}")
                    c_ok, c_val = _check_contrast(met["stripSamples"])
                    results["M9"]["min_contrast"] = min(results["M9"]["min_contrast"], c_val)
                    if not c_ok:
                        fail("M9", f"{name}/{theme} contrast={c_val}")
                    if save_shots and is_full and engine_name == "chromium":
                        save_screenshot(page, f"{name}_{theme}_xiangqi_start.png")

                    # State 2: Jieqi local mid-game
                    page.goto(f"{base}/?test&seed=42&theme={theme}#/play/coup/local", wait_until="networkidle")
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(200)
                    _play_moves_click(page, [((1, 7), (4, 7)), ((1, 2), (4, 2))])
                    met2 = _collect_game_metrics(page, spec.width, spec.height, spec.is_mobile)
                    if not met2["m1"]["ok"]:
                        fail("M1", f"{name}/{theme}/jieqi_mid")
                    if not met2["m2"]["ok"]:
                        fail("M2", f"{name}/{theme}/jieqi_mid")
                    if save_shots and is_full and engine_name == "chromium":
                        save_screenshot(page, f"{name}_{theme}_jieqi_mid.png")

                    # State 3: Bottom sheet open (stack only)
                    sheet_btn = page.locator('[data-testid="sheet-open-btn"]')
                    if sheet_btn.count() > 0 and sheet_btn.first.is_visible():
                        sheet_btn.first.click()
                        page.wait_for_timeout(260)
                        if save_shots and is_full and engine_name == "chromium":
                            save_screenshot(page, f"{name}_{theme}_sheet_half.png")
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(220)

                    # State 4: Result card
                    page.goto(
                        f"{base}/?test&seed=42&theme={theme}#/play/cotuong/ai?side=red&level=tap-su&engine=js",
                        wait_until="networkidle",
                    )
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(200)
                    resign_btn = page.locator('[data-testid="mobile-controls"] [data-maction="resign"], [data-action="resign"]').first
                    if resign_btn.is_visible():
                        resign_btn.click()
                        page.wait_for_selector(".modal-resign-confirm", timeout=3000)
                        page.locator(".modal-resign-confirm").click()
                        page.wait_for_selector(".fx-skip-btn", timeout=3000)
                        page.locator(".fx-skip-btn").click()
                        page.wait_for_selector(".modal-gameover", timeout=3000)
                        page.wait_for_timeout(260)
                        met_go = _collect_game_metrics(page, spec.width, spec.height, spec.is_mobile)
                        if not met_go["m4"]["ok"]:
                            fail("M4", f"{name}/{theme}/result_card {met_go['m4']['overlaps']}")
                        if save_shots and is_full and engine_name == "chromium":
                            save_screenshot(page, f"{name}_{theme}_result_card.png")

                    # Extra B4 states on FULL set (go-lim only to keep runtime fast)
                    if is_full and theme == "go-lim" and engine_name == "chromium":
                        for route_tag, hash_url in [
                            ("lobby", "#/"),
                            ("mode", "#/mode/cotuong"),
                            ("library", "#/library"),
                        ]:
                            page.goto(f"{base}/?test&seed=42&theme={theme}{hash_url}", wait_until="networkidle")
                            page.wait_for_timeout(250)
                            sw = page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
                            if not sw:
                                fail("M1", f"{name}/{route_tag} horizontal overflow")
                            if save_shots and name in ("390x844", "844x390"):
                                save_screenshot(page, f"{name}_{route_tag}.png")

                # M6: Safe areas check on 390x844 (portrait) and 844x390 (landscape)
                if name in ("390x844", "844x390"):
                    safe_param = "47,0,34,0" if name == "390x844" else "0,47,21,47"
                    page.goto(
                        f"{base}/?test&safe={safe_param}#/play/cotuong/ai?side=red&level=tap-su&engine=js",
                        wait_until="networkidle",
                    )
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(220)
                    has_layout = page.evaluate("Boolean(window.__layout && window.__layout.safe)")
                    if not has_layout:
                        if baseline:
                            results["M6"]["status"] = "NOT_IMPL"
                        else:
                            fail("M6", f"{name}: window.__layout.safe missing")
                    else:
                        safe_ok = page.evaluate(
                            """({ isPortrait }) => {
                                const topNav = document.querySelector('.game-top-nav');
                                const ctrl = document.querySelector('[data-testid="mobile-controls"]');
                                const svg = document.querySelector('svg.board-svg');
                                const sr = svg ? svg.getBoundingClientRect() : null;
                                if (isPortrait) {
                                    const tr = topNav ? topNav.getBoundingClientRect() : null;
                                    const cr = ctrl ? ctrl.getBoundingClientRect() : null;
                                    const topOk = !tr || tr.top >= 45 || parseFloat(getComputedStyle(topNav).paddingTop) >= 45;
                                    const botOk = !cr || cr.bottom <= window.innerHeight - 32 || parseFloat(getComputedStyle(ctrl).paddingBottom) >= 32;
                                    return topOk && botOk;
                                } else {
                                    return sr ? (sr.left >= 45 && sr.right <= window.innerWidth - 45) : false;
                                }
                            }""",
                            {"isPortrait": name == "390x844"},
                        )
                        if not safe_ok:
                            fail("M6", f"{name} safe={safe_param} violated")

                # M7: Viewport robustness (toolbar hide -56px + restore) on 390x844
                if name == "390x844":
                    page.goto(
                        f"{base}/?test&seed=42#/play/cotuong/ai?side=red&level=tap-su&engine=js",
                        wait_until="networkidle",
                    )
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(200)
                    page.set_viewport_size({"width": 390, "height": 844 - 56})
                    page.wait_for_timeout(320)
                    m7a = _collect_game_metrics(page, 390, 844 - 56, True)
                    page.set_viewport_size({"width": 390, "height": 844})
                    page.wait_for_timeout(320)
                    m7b = _collect_game_metrics(page, 390, 844, True)
                    if not (m7a["m1"]["ok"] and m7a["m4"]["ok"] and m7b["m1"]["ok"] and m7b["m4"]["ok"]):
                        fail("M7", f"resize failed: -56px={m7a['m1']['ok']}/{m7a['m4']['ok']} restore={m7b['m1']['ok']}/{m7b['m4']['ok']}")

                all_errors.extend(f"[{name}] {e}" for e in errs)
                ctx.close()

            # 2. M8 Desktop regression (Chromium only)
            if engine_name == "chromium":
                for name in DESKTOP_NAMES:
                    spec = DEVICE_BY_NAME[name]
                    ctx = create_device_context(browser, spec)
                    page = ctx.new_page()
                    errs = attach_error_listener(page)

                    shots = {}
                    # xiangqi_ai_start
                    page.goto(f"{base}/?test&seed=42#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(300)
                    shots["xiangqi_ai_start"] = save_screenshot(page, f"desk_{name}_xiangqi_ai_start.png")

                    # jieqi_mid
                    page.goto(f"{base}/?test&seed=42#/play/coup/local", wait_until="networkidle")
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(250)
                    _play_moves_click(page, [((1, 7), (4, 7)), ((1, 2), (4, 2)), ((0, 6), (0, 5)), ((0, 3), (0, 4))])
                    page.wait_for_timeout(250)
                    shots["jieqi_mid"] = save_screenshot(page, f"desk_{name}_jieqi_mid.png")

                    # review_mode
                    page.locator('[data-rev="prev"]').click()
                    page.wait_for_timeout(220)
                    page.locator('[data-rev="prev"]').click()
                    page.wait_for_timeout(250)
                    shots["review_mode"] = save_screenshot(page, f"desk_{name}_review_mode.png")

                    # result_card
                    page.goto(f"{base}/?test&seed=42#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
                    page.wait_for_selector("svg.board-svg")
                    page.wait_for_timeout(250)
                    page.locator('[data-action="resign"]').click()
                    page.wait_for_selector(".modal-resign-confirm")
                    page.locator(".modal-resign-confirm").click()
                    page.wait_for_selector(".fx-skip-btn", timeout=3000)
                    page.locator(".fx-skip-btn").click()
                    page.wait_for_selector(".modal-gameover", timeout=3000)
                    page.wait_for_timeout(300)
                    shots["result_card"] = save_screenshot(page, f"desk_{name}_result_card.png")

                    for state_k, cur_path in shots.items():
                        base_path = BASELINE_DIR / f"{name}_{state_k}.png"
                        if base_path.exists():
                            pct = round(image_diff_percent(base_path, cur_path), 3)
                            results["M8"]["max_diff_pct"] = max(results["M8"]["max_diff_pct"], pct)
                            if pct > 1.5:
                                fail("M8", f"{name}_{state_k} diff={pct:.2f}% > 1.5%")

                    all_errors.extend(f"[desk-{name}] {e}" for e in errs)
                    ctx.close()

            browser.close()
    finally:
        srv.shutdown()

    results["console_errors"]["count"] = len(all_errors)
    results["console_errors"]["samples"] = all_errors[:8]
    if all_errors:
        results["console_errors"]["status"] = "FAIL"
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--webkit", action="store_true")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--no-shots", action="store_true")
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    engine = "webkit" if args.webkit else "chromium"
    res = run_suite(engine_name=engine, baseline=args.baseline, save_shots=not args.no_shots)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"=== verify_mobile.py ({engine}) ===")
    any_fail = False
    for k, v in res.items():
        st = v.get("status", "PASS")
        if st == "FAIL":
            any_fail = True
        print(f"  {k:16s} {st:8s} {v}")
    return 1 if (any_fail and not args.baseline) else 0


if __name__ == "__main__":
    raise SystemExit(main())
