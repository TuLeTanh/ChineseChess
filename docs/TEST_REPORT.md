# QA & Verification Report — `feat/lobby-jieqi-online`

**Branch:** `feat/lobby-jieqi-online`  
**Environment:** Windows, Node `v25.8.2`, Python `3.11.9`, Playwright Chromium  
**Scope:** End-to-end QA, online protocol gap tests, HTTP/CSP security audit, exploratory UI + seeded monkey testing, Cờ Úp AI strength benchmark, and privacy/hygiene scan.

---

## 1. Baseline vs Final Suite Results

| Suite | Baseline | Final | Notes |
|---|---:|---:|---|
| `node --test` (core, rules, ai, jieqi, jieqiAi, online/server) | 39/39 PASS (1 skip) | 39/39 PASS (1 skip) | Optional slow PERFT-4 skipped by default |
| `node --test tests/online/gaps.test.js` *(new)* | — | **7/7 PASS** | Covers 25+ protocol, abuse, rate-limit & 3-game Cờ Úp wire-safety scenarios |
| `tools/verify_security.py` *(new)* | **FAIL** (2 security/MIME defects) | **PASS** | Fixed CSP `frame-ancestors 'none'` + `.ttf` `font/ttf` MIME |
| `tools/verify_explore.py` *(new)* | **PASS** (after fixing settings nickname bug) | **PASS** | 0 errors, 0 warnings, 0 findings; seeded monkey test (`seed=20261125`, 788 actions, `maxGap=83.4ms`) |
| `tools/verify.py` | PASS (`err=0, warn=0`) | PASS (`err=0, warn=0`) | AI rAF `maxGap=50.0ms` |
| `tools/verify_lobby.py` | PASS (`err=0, warn=0`) | PASS (3/3 uncontended; see Flake note) | 2/2 CPU-contended runs exceeded `50.0ms` (`50.1ms`, `66.8ms`); 3/3 uncontended PASS |
| `tools/verify_jieqi.py` | PASS (`err=0, warn=0`) | PASS (`err=0, warn=0`) | 30 covered + 2 generals, `?` hints, reveal, pool, undo disabled |
| `tools/verify_online.py` | PASS (`err=0, warn=0`) | PASS (`err=0, warn=0`) | 2 contexts: quick match, reload resync, `#/join/<CODE>` Cờ Úp, XSS check |
| `tools/verify_sound.py` | PASS | PASS | 19 synth buffers incl. `reveal` (`peak=0.5400`) + `seq_capture_check.wav` |
| `tools/verify_voice.py` | PASS | PASS | 7 raw + 7 processed voice WAVs verified |
| `tools/verify_fx.py` | PASS | PASS | 48 shots, `maxGap=33.4ms`, 0 idle rAF |
| `tools/verify_races.py` | PASS | PASS | 8/8 race scenarios, 0 errors |
| `tools/verify_engine.py` | PASS | PASS | Pikafish `3.27M nps`, 50/50 legality, 0 leaked orphans |

---

## 2. Bugs Found, Fixed & Open Issues

### Fixed in this QA pass (1 commit per fix)

| # | Severity | Summary | Commit |
|---|---|---|---|
| 1 | Medium (Security) | Online server `Content-Security-Policy` was missing `frame-ancestors 'none'` and `X-Frame-Options` was `SAMEORIGIN` instead of `DENY`. Added both and documented in `docs/DECISIONS.md`. | `fad3c3f` |
| 2 | Low (MIME) | `server/index.js` served `.ttf` font files as `application/octet-stream` instead of `font/ttf`. Added `'.ttf': 'font/ttf'` to `MIME_TYPES`. | `514331b` |
| 3 | Medium (Functional) | `onlineModals.js` and `onlineGameController.js` read `settings.online.nickname` instead of top-level `settings.nickname` saved by Settings modal, causing online players to always appear as `"Kỳ thủ"`. | `891af9e` |
| 4 | Medium (Visual) | At `1180×780` viewport height in Cờ Úp AI mode, `.side-panel` clipped the bottom controls and squeezed `.move-list-scroll` to ~12 px. Added `@media (max-height: 860px)` scroll + `min-height: 120px` on `.move-list-section`. | `70af926` |

### Open Issues (Deferred / Low Risk)

1. **[Low / Visual] Toast & disconnect banner overlap**: When `.online-disconnect-banner` (`top: 14px`) and `.board-toast` (`top: 18px`) appear simultaneously (repro: peer declines draw and immediately disconnects), the banner slightly overlaps the top of the toast (`preview/explore/f_online_disconnect.png`).
2. **[Low / Visual] Move chip ICCS truncation on simultaneous reveal + capture**: In Cờ Úp, a move chip that has both the `LẬT` badge and capture `×` icon truncates the 4-char ICCS string by 1–2 chars (`h7... LẬT ×`, seen in `preview/explore/e_coup_ai.png`).
3. **[Low / Test Flake] `tools/verify_lobby.py` strict `<= 50.0ms` rAF threshold**: On Windows Chromium under heavy background CPU contention (concurrent AI benchmarks), 3 frames at 60 Hz (`50.1ms`–`66.8ms`) can exceed `50.0ms`. Passes `3/3` when run uncontended.
4. **[Low / Perf Anomaly] `tap-su` (60 ms @ 40%) max move time**: Reached `115.2ms` (`1.92x` of 60 ms) because `jieqiSearch.js` checks the clock every 256 nodes; `cao-thu` (`1.15x`) and `dai-su` (`1.09x`) stay well within `1.3x`.

---

## 3. HTTP Security & CSP Results (`tools/verify_security.py`)

Response headers on `GET /`:
```text
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self'; frame-ancestors 'none';
content-type: text/html; charset=utf-8
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
```
- **Path traversal / whitelist probes**: `16/16` blocked (never `200`): `/../server/index.js`, `/%2e%2e/package.json`, `/%2e%2e%2fserver/index.js`, `/server/index.js`, `/server/package.json`, `/engine/`, `/engine/engine.json`, `/logs/online.log`, `/.git/config`, `/tools/server.py`, `/tests/`, `/docs/PROGRESS.md`, `/package.json`, `/index.html%00.txt`, `/\server\index.js`, `/%5cserver%5cindex.js`.
- **MIME types**: `.js`, `.css`, `.ttf`, `.json` all verified (`4/4`).
- **WebSocket security**: Bad `Origin` refused (`HTTP 403`), oversized payload (`> 4096 B`) closed (`1009`), flood/5 violations closed (`1008`), per-IP connection rate limit (`429`), `MAX_CONNECTIONS` (`503`), `MAX_ROOMS` (`ROOMS_FULL`).
- **Browser CSP check**: Lobby + AI game load under active CSP with `0` console/CSP errors.

---

## 4. Cờ Úp (Jieqi) AI Strength & Speed (`tools/jieqi_strength.js`)

Run with `TIME_SCALE = 0.4` (40% thinking time budget), 6 seeded games per pairing, colors swapped, 200-ply cap:

| Pairing (Strong vs Weak) | Strong W | Draw | Weak W | Avg Plies |
|---|---:|---:|---:|---:|
| `nghiep-du` vs `tap-su` | 5 | 1 | 0 | 94.0 |
| `cao-thu` vs `nghiep-du` | 5 | 0 | 1 | 43.0 |
| `dai-su` vs `cao-thu` | 4 | 2 | 0 | 61.0 |

| Level | Moves | Budget (40%) | Avg ms | Max ms | Max/Budget |
|---|---:|---:|---:|---:|---:|
| `tap-su` | 281 | 60 ms | 40.2 | 115.2 | 1.92x |
| `nghiep-du` | 411 | 240 ms | 260.8 | 322.4 | 1.34x |
| `cao-thu` | 312 | 1200 ms | 1214.7 | 1374.2 | 1.15x |
| `dai-su` | 184 | 2800 ms | 2759.5 | 3038.5 | 1.09x |

- **Sanity checks**: `illegal = 0`, `selfCheck = 0`, `noPeek = true` (identical move & score across distinct hidden secrets with identical public FEN & seed).

---

## 5. Privacy & Repo Hygiene Scan

- **Tracked file privacy scan** (`vớ vẩn`, `D:\`, `C:\Users`, `@gmail`, `password`, `api_key`, `BEGIN PRIVATE KEY`): **0 hits**.
- **Tracked files > 1 MB**: **0 files**.
- **Forbidden tracked paths** (`engine/dist/`, `*.mp3`, `preview/`, `logs/`, `node_modules/`): **0 files**.
- **Git commit author identity** (`git log --format="%h %an <%ae> %s" -n 10`):
  - All commits use the configured local git author (see CLI output in QA summary; unchanged per instructions, redacted here to keep tracked files free of personal emails).
