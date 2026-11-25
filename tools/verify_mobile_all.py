"""Unified mobile & touch verification runner (B7).

Runs verify_mobile.py (Chromium), verify_touch.py (Chromium), and WebKit subset
(if WebKit is installed), prints a consolidated scoreboard table, and writes
docs/MOBILE_SCOREBOARD.md.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCOREBOARD = ROOT / "docs" / "MOBILE_SCOREBOARD.md"


def _run_json(cmd: list[str], out_path: Path) -> tuple[int, dict]:
    p = subprocess.run(cmd + ["--json-out", str(out_path)], cwd=str(ROOT))
    data = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    return p.returncode, data


def _fmt_numbers(k: str, v: dict) -> str:
    skip = {"status", "details", "samples"}
    parts = [f"{kk}={vv}" for kk, vv in v.items() if kk not in skip]
    if v.get("details"):
        parts.append(f"issues={len(v['details'])}: {v['details'][0]}")
    return ", ".join(parts) if parts else "ok"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", type=str, default="Current Run")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--monkey-sec", type=int, default=10)
    ap.add_argument("--drag-seq", action="store_true")
    ap.add_argument("--skip-webkit", action="store_true")
    args = ap.parse_args()

    rows: list[tuple[str, str, str]] = []
    any_fail = False

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        m_cmd = [sys.executable, "tools/verify_mobile.py"] + (["--baseline"] if args.baseline else [])
        rc_m, m_res = _run_json(m_cmd, td_p / "mobile.json")
        for k in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "console_errors"):
            if k in m_res:
                st = m_res[k].get("status", "PASS")
                if st == "FAIL":
                    any_fail = True
                rows.append((f"mobile.{k}", st, _fmt_numbers(k, m_res[k])))

        t_cmd = [
            sys.executable,
            "tools/verify_touch.py",
            "--monkey-sec",
            str(args.monkey_sec),
        ]
        if args.baseline:
            t_cmd.append("--baseline")
        if args.drag_seq:
            t_cmd.append("--drag-seq")
        rc_t, t_res = _run_json(t_cmd, td_p / "touch.json")
        for k in ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "console_errors"):
            if k in t_res:
                st = t_res[k].get("status", "PASS")
                if st == "FAIL":
                    any_fail = True
                rows.append((f"touch.{k}", st, _fmt_numbers(k, t_res[k])))

        if not args.skip_webkit:
            wk_m_cmd = [sys.executable, "tools/verify_mobile.py", "--webkit", "--no-shots"] + (["--baseline"] if args.baseline else [])
            rc_wm, wm_res = _run_json(wk_m_cmd, td_p / "wk_mobile.json")
            for k in ("M1", "M2", "M3", "M4", "M5", "M6", "console_errors"):
                if k in wm_res:
                    st = wm_res[k].get("status", "PASS")
                    if st == "FAIL":
                        any_fail = True
                    rows.append((f"webkit.{k}", st, _fmt_numbers(k, wm_res[k])))

            wk_t_cmd = [sys.executable, "tools/verify_touch.py", "--webkit"] + (["--baseline"] if args.baseline else [])
            rc_wt, wt_res = _run_json(wk_t_cmd, td_p / "wk_touch.json")
            for k in ("WK_T1", "WK_T10", "console_errors"):
                if k in wt_res:
                    st = wt_res[k].get("status", "PASS")
                    if st == "FAIL":
                        any_fail = True
                    rows.append((f"webkit.{k}", st, _fmt_numbers(k, wt_res[k])))

    md_lines = [
        f"# Mobile & Touch Scoreboard — {args.label}",
        "",
        "| Check ID | Status | Key Numbers / Notes |",
        "|---|---|---|",
    ]
    for cid, st, num in rows:
        md_lines.append(f"| `{cid}` | **{st}** | {num} |")
    md_text = "\n".join(md_lines) + "\n"
    SCOREBOARD.write_text(md_text, encoding="utf-8")

    print("\n" + md_text)
    return 1 if (any_fail and not args.baseline) else 0


if __name__ == "__main__":
    raise SystemExit(main())
