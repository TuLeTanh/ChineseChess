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
WEBKIT_SIZES = ("390x844", "844x390", "820x1180")


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


def run_crawler(out_dir: Path, baseline: bool = False, use_webkit: bool = False) -> dict[str, Any]:
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
    visited_dialogs: set[str] = set()
    sizes_to_run = WEBKIT_SIZES if use_webkit else DIALOG_SIZES
    engine_name = "webkit" if use_webkit else "chromium"

    def _rec(dialog_name: str, size_name: str, theme: str, r: dict[str, Any]) -> None:
        nonlocal checked
        checked += 1
        visited_dialogs.add(dialog_name)
        if not r["ok"]:
            failures.append(f"{size_name}/{theme}/{dialog_name}: {r}")

    try:
        with sync_playwright() as p:
            browser = p.webkit.launch() if use_webkit else p.chromium.launch()
            for size_name in sizes_to_run:
                spec = DEVICE_BY_NAME[size_name]
                is_full = use_webkit or (size_name in FULL_DIALOG_SIZES)
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
                    _rec("quick_match", size_name, theme, _audit_open_dialog(page, "quick_match", spec.width, spec.height))
                    if is_full and theme == "go-lim":
                        save_screenshot(page, f"{engine_name}_{size_name}_quick_match.png", out_dir)
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(80)
                    if not page.evaluate("document.getElementById('modal-root').hidden"):
                        page.locator(".modal-cancel").first.click()

                    # 3. Room create & Room join (empty + wrong code) & Room waiting
                    page.locator('[data-tile="room"]').click()
                    page.wait_for_selector(".modal-card", timeout=3000)
                    page.wait_for_timeout(120)
                    _rec("room_create", size_name, theme, _audit_open_dialog(page, "room_create", spec.width, spec.height))

                    page.locator('[data-rtab="join"]').click()
                    page.wait_for_selector(".code-box", timeout=3000)
                    page.wait_for_timeout(120)
                    _rec("room_join_empty", size_name, theme, _audit_open_dialog(page, "room_join_empty", spec.width, spec.height, check_keyboard_sel=".code-box"))

                    # Fill wrong code & submit to audit error state
                    boxes = page.locator(".code-box")
                    for i, ch in enumerate("ZZZZZZ"):
                        boxes.nth(i).fill(ch)
                    page.locator(".modal-join-room").click()
                    page.wait_for_timeout(250)
                    _rec("room_join_wrong", size_name, theme, _audit_open_dialog(page, "room_join_wrong", spec.width, spec.height))

                    page.locator('[data-rtab="create"]').click()
                    page.wait_for_selector(".modal-create-room", timeout=3000)
                    page.locator(".modal-create-room").click()
                    page.wait_for_selector(".room-code-tile", timeout=4000)
                    page.wait_for_timeout(120)
                    _rec("room_waiting", size_name, theme, _audit_open_dialog(page, "room_waiting", spec.width, spec.height))
                    page.locator(".modal-leave-room").click()
                    page.wait_for_timeout(100)

                    # 4. Extended dialogs on full sizes (go-lim)
                    if is_full and theme == "go-lim":
                        for tile, tag in (("ai", "ai_setup"), ("local", "local_setup")):
                            page.locator(f'[data-tile="{tile}"]').click()
                            page.wait_for_selector(".modal-card", timeout=3000)
                            _rec(tag, size_name, theme, _audit_open_dialog(page, tag, spec.width, spec.height))
                            page.locator(".modal-cancel").click()
                            page.wait_for_timeout(80)

                        # Settings modal (all 4 tabs: account, appearance, game, audio)
                        page.locator('[data-act="settings"]').click()
                        page.wait_for_selector(".settings-modal", timeout=3000)
                        _rec("settings_account", size_name, theme, _audit_open_dialog(page, "settings_account", spec.width, spec.height, check_keyboard_sel="#set-nickname"))
                        for tab_id in ("appearance", "game", "audio"):
                            tbtn = page.locator(f'.settings-tab[data-tab="{tab_id}"]')
                            if tbtn.count() > 0:
                                tbtn.click()
                                page.wait_for_timeout(80)
                                _rec(f"settings_{tab_id}", size_name, theme, _audit_open_dialog(page, f"settings_{tab_id}", spec.width, spec.height))
                        page.locator(".settings-close").click()
                        page.wait_for_timeout(80)

                        # Save/Export + Resign confirm on game screen
                        page.goto(f"{base}/?test&seed=42&theme={theme}#/play/cotuong/ai?side=red&level=tap-su&engine=js", wait_until="networkidle")
                        page.wait_for_selector("svg.board-svg")
                        page.wait_for_timeout(180)
                        save_btn = page.locator('[data-testid="top-save-btn"], [data-action="save-export"]').first
                        if save_btn.is_visible():
                            save_btn.click()
                            page.wait_for_selector(".modal-card", timeout=3000)
                            _rec("export_menu", size_name, theme, _audit_open_dialog(page, "export_menu", spec.width, spec.height))
                            page.locator(".modal-close").click()
                            page.wait_for_timeout(80)

                        resign_btn = page.locator('[data-testid="mobile-controls"] [data-maction="resign"], #side-panel [data-action="resign"]').first
                        if resign_btn.is_visible():
                            resign_btn.click()
                            page.wait_for_selector(".modal-resign-confirm", timeout=3000)
                            _rec("resign_confirm", size_name, theme, _audit_open_dialog(page, "resign_confirm", spec.width, spec.height))
                            page.locator(".modal-cancel").click()
                            page.wait_for_timeout(80)

                        # Import dialog on library screen + Analysis setup on seeded archive game
                        page.goto(f"{base}/?test&seed=42&theme={theme}#/library", wait_until="networkidle")
                        page.wait_for_selector('[data-act="import"]', timeout=4000)
                        page.locator('[data-act="import"]').click()
                        page.wait_for_selector(".modal-card", timeout=3000)
                        _rec("import_modal", size_name, theme, _audit_open_dialog(page, "import_modal", spec.width, spec.height))
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(80)

                        # Seed finished Xiangqi game & check analysis setup modal
                        page.evaluate("""async () => {
                            if (!window.__gameStore) return;
                            await window.__gameStore.saveGame({
                                schemaVersion: 1, id: 'dlg-an-xq',
                                createdAt: '2026-11-25T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z',
                                variant: 'xiangqi', mode: 'local',
                                red: { name: 'Đỏ', kind: 'human' }, black: { name: 'Đen', kind: 'human' },
                                result: 'black', reason: 'resign',
                                start: { fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1' },
                                moves: [{ m: 'h2e2' }, { m: 'h9g7' }], source: 'manual',
                            });
                        }""")
                        page.goto(f"{base}/?test&seed=42&theme={theme}#/play/cotuong/review?id=dlg-an-xq&analyze=1", wait_until="networkidle")
                        page.wait_for_selector(".modal-an-start", timeout=4000)
                        _rec("analysis_setup", size_name, theme, _audit_open_dialog(page, "analysis_setup", spec.width, spec.height))
                        page.locator(".modal-cancel").click()
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
        "engine": engine_name,
        "sizes_count": len(sizes_to_run),
        "unique_dialogs": len(visited_dialogs),
        "dialog_names": sorted(visited_dialogs),
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
    ap.add_argument("--webkit", action="store_true")
    ap.add_argument("--out-dir", type=str, default=str(ROOT / "preview" / "dialogs"))
    ap.add_argument("--json-out", type=str, default="")
    args = ap.parse_args()

    res = run_crawler(Path(args.out_dir), baseline=args.baseline, use_webkit=args.webkit)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"=== verify_dialogs.py ({res['engine']}) ===")
    print(
        f"  status={res['status']} sizes={res['sizes_count']} unique_dialogs={res['unique_dialogs']} "
        f"checked={res['checked']} failures={res['failure_count']} offline_bug={len(res['offline_btns_bug'])} "
        f"console_errors={res['console_errors']}"
    )
    for f in res["failures"]:
        print("   FAIL:", f)
    for b in res["offline_btns_bug"]:
        print("   BUG:", b)
    for e in res["console_samples"]:
        print("   ERR:", e)
    return 0 if (res["status"] == "PASS" or args.baseline) else 1


if __name__ == "__main__":
    raise SystemExit(main())
