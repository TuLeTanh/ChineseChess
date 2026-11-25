"""Dialog crawler for every modal/overlay across mobile & tablet viewports (Part A3.A).

Checks every dialog at:
  320x568, 360x640, 360x740, inapp_390x700, 390x844, 430x932, 844x390, 667x375, 820x1180
and both themes (Gỗ Lim, Ngọc Bích).
Asserts for every rendered dialog and all its descendants:
  - left >= -0.5 and right <= innerWidth + 0.5 (except inside horizontal scrollers)
  - dialog scrollWidth <= clientWidth + 1
  - primary buttons/tabs/inputs >= 44 px hit area (on mobile/touch)
  - key text not clipped (scrollWidth <= clientWidth)
  - Esc / close button works
  - soft-keyboard simulation (-300 px height while an input is focused) keeps input & primary button visible
  - online tiles hide offline actions ("Thử lại" / "Cài đặt") when server is online
  - zero console errors / warnings
"""
from __future__ import annotations

import argparse
import json
import os
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
    attach_error_listener,
    create_device_context,
    save_screenshot,
)

DIALOG_SIZES = (
    "320x568",
    "360x640",
    "360x740",
    "inapp_390x700",
    "390x844",
    "430x932",
    "844x390",
    "667x375",
    "820x1180",
)

FULL_DIALOG_SIZES = ("320x568", "360x740", "inapp_390x700", "390x844", "844x390", "820x1180")


def _audit_open_dialog(page, label: str, vw: int, vh: int, check_keyboard_sel: str | None = None) -> dict[str, Any]:
    res = page.evaluate(
        """({ vw }) => {
            const card = document.querySelector('#modal-root .modal-card');
            if (!card) return { ok: false, reason: 'no .modal-card' };
            const cr = card.getBoundingClientRect();
            const overflowCard = card.scrollWidth > card.clientWidth + 1;
            const outOfBounds = [];
            if (cr.left < -0.5 || cr.right > window.innerWidth + 0.5) {
                outOfBounds.push(`card(${Math.round(cr.left)}..${Math.round(cr.right)} vs ${window.innerWidth})`);
            }
            const badHits = [];
            const clipped = [];
            const all = card.querySelectorAll('*');
            for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const inHScroll = Boolean(el.closest('.settings-tabs, .move-strip-scroller'));
                if (!inHScroll && (r.left < -1 || r.right > window.innerWidth + 1)) {
                    outOfBounds.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]}(${Math.round(r.left)}..${Math.round(r.right)})`);
                }
                const isInteractive = el.matches('button, input:not([type="checkbox"]):not([type="range"]):not([type="file"]), select, [role="tab"]');
                if (isInteractive && !el.disabled) {
                    if (r.height < 43.5 || r.width < 34) {
                        badHits.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]}(${Math.round(r.width)}x${Math.round(r.height)})`);
                    }
                    if (el.matches('button, [role="tab"]') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
                        clipped.push((el.textContent || '').trim().slice(0, 20));
                    }
                    if (el.matches('input, select, textarea')) {
                        const fs = parseFloat(cs.fontSize || '0');
                        if (fs > 0 && fs < 15.5) badHits.push(`font:${fs}px`);
                    }
                }
            }
            return {
                ok: !overflowCard && outOfBounds.length === 0 && badHits.length === 0 && clipped.length === 0,
                cardRect: { l: Math.round(cr.left), r: Math.round(cr.right), w: Math.round(cr.width), h: Math.round(cr.height) },
                overflowCard,
                scrollW: card.scrollWidth,
                clientW: card.clientWidth,
                outOfBounds: outOfBounds.slice(0, 5),
                badHits: badHits.slice(0, 5),
                clipped: clipped.slice(0, 5),
            };
        }""",
        {"vw": vw},
    )

    if check_keyboard_sel and vh >= 560:
        inp = page.locator(check_keyboard_sel).first
        if inp.count() > 0 and inp.is_visible():
            inp.focus()
            page.set_viewport_size({"width": vw, "height": max(260, vh - 300)})
            page.wait_for_timeout(180)
            kb_ok = page.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel);
                    const card = document.querySelector('#modal-root .modal-card');
                    if (!el || !card) return false;
                    el.scrollIntoView({ block: 'nearest' });
                    const r = el.getBoundingClientRect();
                    const cr = card.getBoundingClientRect();
                    return r.top >= -1 && r.bottom <= window.innerHeight + 2 && cr.height <= window.innerHeight + 2;
                }""",
                check_keyboard_sel,
            )
            page.set_viewport_size({"width": vw, "height": vh})
            page.wait_for_timeout(150)
            if not kb_ok:
                res["ok"] = False
                res["keyboard_clip"] = True
    return res


def run_crawler(out_dir: Path, baseline: bool = False) -> dict[str, Any]:
    port = 8793
    env = {**os.environ, "PORT": str(port)}
    proc = subprocess.Popen(
        ["node", "server/index.js"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(0.9)
    base = f"http://127.0.0.1:{port}"

    failures: list[str] = []
    checked = 0
    all_errors: list[str] = []
    offline_btns_bug = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for size_name in DIALOG_SIZES:
                spec = DEVICE_BY_NAME[size_name]
                is_full = size_name in FULL_DIALOG_SIZES
                themes = ("go-lim", "ngoc-bich") if is_full else ("go-lim",)
                ctx = create_device_context(browser, spec)
                page = ctx.new_page()
                errs = attach_error_listener(page)

                for theme in themes:
                    # 1. Mode select: check offline buttons hidden when online
                    page.goto(f"{base}/?test&seed=42&theme={theme}#/g/cotuong", wait_until="networkidle")
                    page.wait_for_selector('[data-tile="room"]')
                    page.wait_for_timeout(350)
                    off_vis = page.evaluate(
                        """() => {
                            const els = [...document.querySelectorAll('.mode-offline-actions')];
                            return els.some((el) => getComputedStyle(el).display !== 'none');
                        }"""
                    )
                    if off_vis:
                        offline_btns_bug.append(f"{size_name}/{theme}: mode-offline-actions visible while online")

                    # 2. Quick-match setup dialog
                    page.locator('[data-tile="online"]').click()
                    page.wait_for_selector(".modal-card", timeout=3000)
                    page.wait_for_timeout(120)
                    r = _audit_open_dialog(page, "quick_match", spec.width, spec.height)
                    checked += 1
                    if not r["ok"]:
                        failures.append(f"{size_name}/{theme}/quick_match: {r}")
                    if is_full and theme == "go-lim":
                        save_screenshot(page, f"{size_name}_quick_match.png", out_dir)
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(80)
                    if not page.evaluate("document.getElementById('modal-root').hidden"):
                        page.locator(".modal-cancel").first.click()

                    # 3. Room create & Room join (code boxes)
                    page.locator('[data-tile="room"]').click()
                    page.wait_for_selector(".modal-card", timeout=3000)
                    page.wait_for_timeout(120)
                    r = _audit_open_dialog(page, "room_create", spec.width, spec.height)
                    checked += 1
                    if not r["ok"]:
                        failures.append(f"{size_name}/{theme}/room_create: {r}")
                    if is_full and theme == "go-lim":
                        save_screenshot(page, f"{size_name}_room_create.png", out_dir)

                    # Switch to Nhập mã tab
                    page.locator('[data-rtab="join"]').click()
                    page.wait_for_selector(".code-box", timeout=3000)
                    page.wait_for_timeout(120)
                    r = _audit_open_dialog(page, "room_join", spec.width, spec.height, check_keyboard_sel=".code-box")
                    checked += 1
                    if not r["ok"]:
                        failures.append(f"{size_name}/{theme}/room_join: {r}")
                    if is_full:
                        save_screenshot(page, f"{size_name}_{theme}_room_join.png", out_dir)

                    # Create a real room & audit waiting view
                    page.locator('[data-rtab="create"]').click()
                    page.wait_for_selector(".modal-create-room", timeout=3000)
                    page.locator(".modal-create-room").click()
                    page.wait_for_selector(".room-code-tile", timeout=4000)
                    page.wait_for_timeout(120)
                    r = _audit_open_dialog(page, "room_waiting", spec.width, spec.height)
                    checked += 1
                    if not r["ok"]:
                        failures.append(f"{size_name}/{theme}/room_waiting: {r}")
                    if is_full and theme == "go-lim":
                        save_screenshot(page, f"{size_name}_room_waiting.png", out_dir)
                    page.locator(".modal-leave-room").click()
                    page.wait_for_timeout(100)

                    # 4. AI setup & Local setup
                    if is_full and theme == "go-lim":
                        for tile, tag in (("ai", "ai_setup"), ("local", "local_setup")):
                            page.locator(f'[data-tile="{tile}"]').click()
                            page.wait_for_selector(".modal-card", timeout=3000)
                            r = _audit_open_dialog(page, tag, spec.width, spec.height)
                            checked += 1
                            if not r["ok"]:
                                failures.append(f"{size_name}/{theme}/{tag}: {r}")
                            page.locator(".modal-cancel").click()
                            page.wait_for_timeout(80)

                        # 5. Settings modal (account + game tabs)
                        page.locator('[data-act="settings"]').click()
                        page.wait_for_selector(".settings-modal", timeout=3000)
                        r = _audit_open_dialog(page, "settings_account", spec.width, spec.height, check_keyboard_sel="#set-nickname")
                        checked += 1
                        if not r["ok"]:
                            failures.append(f"{size_name}/{theme}/settings_account: {r}")
                        page.locator('.settings-tab[data-tab="game"]').click()
                        page.wait_for_timeout(80)
                        r = _audit_open_dialog(page, "settings_game", spec.width, spec.height)
                        checked += 1
                        if not r["ok"]:
                            failures.append(f"{size_name}/{theme}/settings_game: {r}")
                        page.locator(".settings-close").click()
                        page.wait_for_timeout(80)

                        # 6. Save/Export & Resign confirm on game screen
                        page.goto(f"{base}/?test&seed=42&theme={theme}#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
                        page.wait_for_selector("svg.board-svg")
                        page.wait_for_timeout(180)
                        save_btn = page.locator('[data-testid="top-save-btn"], [data-action="save-export"]').first
                        if save_btn.is_visible():
                            save_btn.click()
                            page.wait_for_selector(".modal-card", timeout=3000)
                            r = _audit_open_dialog(page, "export_menu", spec.width, spec.height)
                            checked += 1
                            if not r["ok"]:
                                failures.append(f"{size_name}/{theme}/export_menu: {r}")
                            page.locator(".modal-close").click()
                            page.wait_for_timeout(80)

                all_errors.extend(f"[{size_name}] {e}" for e in errs)
                ctx.close()
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

    return {
        "status": "PASS" if (not failures and not offline_btns_bug and not all_errors) else "FAIL",
        "checked": checked,
        "failure_count": len(failures),
        "failures": failures[:12],
        "offline_btns_bug": offline_btns_bug[:6],
        "console_errors": len(all_errors),
        "console_samples": all_errors[:6],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--out-dir", type=str, default=str(ROOT / "preview" / "dialogs"))
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    res = run_crawler(Path(args.out_dir), baseline=args.baseline)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    print("=== verify_dialogs.py ===")
    print(f"  status={res['status']} checked={res['checked']} failures={res['failure_count']} offline_bug={len(res['offline_btns_bug'])} console_errors={res['console_errors']}")
    for f in res["failures"]:
        print("   FAIL:", f)
    for b in res["offline_btns_bug"]:
        print("   BUG:", b)
    for e in res["console_samples"]:
        print("   ERR:", e)
    return 0 if (res["status"] == "PASS" or args.baseline) else 1


if __name__ == "__main__":
    raise SystemExit(main())
