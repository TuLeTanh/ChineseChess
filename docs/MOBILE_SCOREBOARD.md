# Mobile & Touch Scoreboard — Round 6 (Final)

| Check ID | Status | Key Numbers / Notes |
|---|---|---|
| `mobile.M1` | **PASS** | ok |
| `mobile.M2` | **PASS** | min_disc_320=30.8, min_disc_360=34.6 |
| `mobile.M3` | **PASS** | min_hit=44 |
| `mobile.M4` | **PASS** | ok |
| `mobile.M5` | **PASS** | ok |
| `mobile.M6` | **PASS** | ok |
| `mobile.M7` | **PASS** | ok |
| `mobile.M8` | **PASS** | max_diff_pct=0.265 |
| `mobile.M9` | **PASS** | min_contrast=11.29 |
| `mobile.console_errors` | **PASS** | count=0 |
| `touch.T1` | **PASS** | dots=11, dots_after_ill=11, ply=1 |
| `touch.T2` | **PASS** | ply=2, max_lift_cells=0.92 |
| `touch.T3` | **PASS** | inner_03_pct=100.0, inner_n=143, outer_045_pct=100.0, outer_n=47, wrong_picks=0 |
| `touch.T4` | **PASS** | ply=2, drag_left=0 |
| `touch.T5` | **PASS** | ply=2, stuck=False |
| `touch.T6` | **PASS** | visualViewport_scale=1 |
| `touch.T7` | **PASS** | scroll={'x': 0, 'y': 0}, ctx=0, sel=0, overscroll=none, touchAction=none |
| `touch.T8` | **PASS** | opened=half, closed=closed, scrub_ok=True |
| `touch.T9` | **PASS** | ply_rev=1, banner_vis=True, ply_live=3, ply_total=3 |
| `touch.T10` | **PASS** | audio_state=running, sfx_events=14 |
| `touch.T11` | **PASS** | vib_log=[8, 12] |
| `touch.T12` | **PASS** | url=http://10.20.3.252:8791, isSecureContext=False, uuidOk=True, idbOk=True, clipboardFallbackOk=True |
| `touch.T13` | **PASS** | drag_p50=16.7, drag_p95=16.8, drag_max=150, idle_raf=0, lobby_p95=16.7, fx_p95=50, fx_max=166.7 |
| `touch.T14` | **PASS** | seed=777123, sec_per_screen=10, max_gap_ms=16.8, leaks={'listeners': 2, 'canvases': 1, 'workers': 0, 'sockets': 0, 'timers': 1, 'trackListener': None, 'trackCanvas': None, 'trackWorker': None, 'trackSocket': None, 'trackTimer': None, 'snapshot': None} |
| `touch.console_errors` | **PASS** | count=0 |
| `webkit.M1` | **PASS** | ok |
| `webkit.M2` | **PASS** | min_disc_320=None, min_disc_360=None |
| `webkit.M3` | **PASS** | min_hit=44 |
| `webkit.M4` | **PASS** | ok |
| `webkit.M5` | **PASS** | ok |
| `webkit.M6` | **PASS** | ok |
| `webkit.console_errors` | **PASS** | count=0 |
| `webkit.WK_T1` | **PASS** | ply=1 |
| `webkit.WK_T10` | **PASS** | sfx_events=1 |
| `webkit.console_errors` | **PASS** | count=0 |

## Online Dialogs & Two-Phone E2E — Baseline (before)

| Check ID | Status | Key Numbers / Notes |
|---|---|---|
| `dialogs.crawler` | **FAIL** | checked=90, failures=72 (`room_join scrollW=1480` vs `clientW=318`, `INPUT.code-box` out of bounds, `mini-seg-btn` 26 px < 44 px, `ai-level-select` 28 px, `export` buttons 40 px) |
| `dialogs.offline_btns` | **FAIL** | 6+ hits: `.mode-offline-actions` visible while online (missing `[hidden] { display: none !important }`) |
| `online_mobile.S1..S10` | **FAIL** | S1 resign timeout / S5 rematch cancel+decline+opponent-left not implemented |

