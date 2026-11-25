# Mobile & Touch Scoreboard — Baseline (before)

| Check ID | Status | Key Numbers / Notes |
|---|---|---|
| `mobile.M1` | **PASS** | ok |
| `mobile.M2` | **FAIL** | min_disc_320=47.6, min_disc_360=47.6, issues=8: 320x568/go-lim/start {'ok': False, 'mode': 'unknown', 'boardW': 568, 'boardH': 632, 'discDiam': 47.6, 'insideVp': False, 'unclippedVb': True, 'minWidthOk': True, 'minDiscOk': True} |
| `mobile.M3` | **FAIL** | min_hit=32, issues=8: 320x568/go-lim/start ['.game-top-nav button(66x32)', '.game-top-nav button(35x32)'] |
| `mobile.M4` | **PASS** | ok |
| `mobile.M5` | **FAIL** | issues=8: 320x568/go-lim/start {'ok': False, 'clipped': [], 'badInputs': ['SELECT:12.5px'], 'bodyFs': 16} |
| `mobile.M6` | **NOT_IMPL** | ok |
| `mobile.M7` | **PASS** | ok |
| `mobile.M8` | **PASS** | max_diff_pct=0.21 |
| `mobile.M9` | **FAIL** | min_contrast=1.36, issues=8: 320x568/go-lim contrast=1.36 |
| `mobile.console_errors` | **FAIL** | count=63 |
| `touch.T1` | **PASS** | dots=11, dots_after_ill=11, ply=1 |
| `touch.T2` | **FAIL** | ply=1, max_lift_cells=0.0 |
| `touch.T3` | **FAIL** | inner_03_pct=52.8, inner_n=36, outer_045_pct=75.0, outer_n=8, wrong_picks=0 |
| `touch.T4` | **FAIL** | ply=1, drag_left=0 |
| `touch.T5` | **FAIL** | ply=1, stuck=False |
| `touch.T6` | **FAIL** | visualViewport_scale=1.1107430458068848 |
| `touch.T7` | **FAIL** | scroll={'x': 0, 'y': 0}, ctx=0, sel=0, overscroll=auto, touchAction=auto |
| `touch.T8` | **NOT_IMPL** | reason=no sheet-open-btn |
| `touch.T9` | **NOT_IMPL** | reason=no move-strip chip |
| `touch.T10` | **PASS** | audio_state=running, sfx_events=3 |
| `touch.T11` | **NOT_IMPL** | vib_log=[] |
| `touch.T12` | **FAIL** | error=Page.goto: net::ERR_CONNECTION_REFUSED at http://10.20.3.252:8791/?test#/
Call log:
  - navigating to "http://10.20.3.252:8791/?test#/", waiting until "networkidle"
, lan_ip=10.20.3.252 |
| `touch.T13` | **FAIL** | drag_p50=16.7, drag_p95=33.4, drag_max=150, idle_raf=0, lobby_p95=16.7, fx_p95=116.7, fx_max=116.7 |
| `touch.T14` | **FAIL** | seed=777123, sec_per_screen=4, max_gap_ms=16.8, leaks={'listeners': 2, 'canvases': 1, 'workers': 0, 'sockets': 0, 'timers': 1, 'trackListener': None, 'trackCanvas': None, 'trackWorker': None, 'trackSocket': None, 'trackTimer': None, 'snapshot': None} |
| `touch.console_errors` | **FAIL** | count=13 |
| `webkit.M1` | **PASS** | ok |
| `webkit.M2` | **FAIL** | min_disc_320=None, min_disc_360=None, issues=8: 390x844/go-lim/start {'ok': False, 'mode': 'unknown', 'boardW': 568, 'boardH': 796, 'discDiam': 47.6, 'insideVp': False, 'unclippedVb': True, 'minWidthOk': True, 'minDiscOk': True} |
| `webkit.M3` | **FAIL** | min_hit=32, issues=6: 390x844/go-lim/start ['.game-top-nav button(66x32)', '.game-top-nav button(41x32)'] |
| `webkit.M4` | **PASS** | ok |
| `webkit.M5` | **FAIL** | issues=6: 390x844/go-lim/start {'ok': False, 'clipped': [], 'badInputs': ['SELECT:12.5px'], 'bodyFs': 16} |
| `webkit.M6` | **NOT_IMPL** | ok |
| `webkit.console_errors` | **FAIL** | count=15 |
| `webkit.WK_T1` | **PASS** | ply=1 |
| `webkit.WK_T10` | **PASS** | sfx_events=2 |
| `webkit.console_errors` | **FAIL** | count=1 |
