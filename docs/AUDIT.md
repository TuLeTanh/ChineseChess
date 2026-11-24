# Read-Only Technical Audit — Chinese Chess (Xiangqi)

> **Scope:** Read-only audit of the codebase, game-state integrity, rules, persistence, cross-environment layout, fresh-clone setup, licensing, and runtime resources. No game code was modified during this audit; all findings are reported here for future sprints.

---

## 1. Code Health

### File Line Counts (files > 400 lines flagged)

| Lines | File | Flag |
|---:|---|---|
| 1556 | `css/style.css` | `> 400` |
| 1273 | `js/ui/boardView.js` | `> 400` |
| 1253 | `js/main.js` | `> 400` |
| 987 | `js/ui/sidePanel.js` | `> 400` |
| 838 | `js/audio/synth.js` | `> 400` |
| 709 | `js/fx/endFx.js` | `> 400` |
| 652 | `js/ai/search.js` | `> 400` |
| 646 | `tools/server.py` | `> 400` |
| 606 | `tools/verify.py` | `> 400` |
| 534 | `tools/engine_launch.py` | `> 400` |
| 519 | `js/rules.js` | `> 400` |
| 484 | `tools/verify_engine.py` | `> 400` |
| 435 | `js/audio/voice.js` | `> 400` |
| 412 | `js/audio/sfx.js` | `> 400` |

### Top 5 Biggest Functions

1. `init` (`js/main.js:417`) — **835 lines** (orchestrates game state, review mode, AI turns, cinematics, keyboard shortcuts, and utility page routing).
2. `playEndFx` (`js/fx/endFx.js:79`) — **631 lines** (builds SVG/canvas DOM, `render(t)` for 4 cinematic modes, skip/cancel/visibility lifecycle).
3. `main` (`tools/verify.py:95`) — **510 lines** (Playwright end-to-end suite).
4. `renderSoundBuffer` (`js/audio/synth.js:341`) — **498 lines** (18 procedural sound generators in one `switch`).
5. `searchBestMove` (`js/ai/search.js:176`) — **459 lines** (iterative deepening, negamax, quiescence, TT, move ordering).

### Module Graph, Exports, Duplication & Debug Code

- **Circular imports in `js/`**: **0** (verified via DFS over all ES module imports).
- **Unused exports (24)**: mostly intentional tuning constants/helpers (`js/ai/eval.js`: `TEMPO_BONUS`, `DEFENSIVE_PAIR_BONUS`, `MOBILITY_WEIGHT`, `PST_*`; `js/ai/levels.js`: `HINT_LEVEL`; `js/ai/levelsPikafish.js`: `PIKAFISH_LEVELS`; `js/fx/endFx.js`: `FX_TIMINGS`; `js/audio/voice.js`: `VOICE_PRIORITY`, `createHallImpulse`, `measureBufferRms`; `js/render/pieceSvg.js`: `PIECE_KINDS`, `PIECE_SIDES`, `PIECE_GLYPHS`, `buildPieceSharedDefs`, `buildPieceLayers`; `js/rules.js`: `perftCells`; `js/model/moves.js`: `posToIccs`; `js/ai/search.js`: `moveToString`).
- **Duplicated logic**:
  - `parseIccs` is defined independently in `js/main.js`, `tools/verify_engine.py` (inline JS), and `js/ai/client.js` / `pikafishClient.js`.
  - Slide-and-capture animation blocks appear in three places in `js/ui/boardView.js` (`_performMove`, `undo`, and `setReviewState`).
  - `js/ai/movegen.js` reimplements Xiangqi move generation on `Int8Array(90)` separately from `js/rules.js` (intentional for performance; kept in sync via PERFT tests).
- **Global state**: Test hooks `window.__sfx`, `window.__sfxLog`, `window.__board`, `window.__view`, `window.__fxSeek` are only attached when `?test` is in the URL.
- **Leftover `console.*` calls (2)**:
  - `js/ai/client.js:109`: `console.info('Web Worker unavailable; falling back to chunked main-thread AI search.')`
  - `js/main.js:592`: `console.debug('Pikafish returned illegal move, falling back to JS engine:', res.move)`
- **Hardcoded user path in tool script**:
  - `tools/setup_engine.py:93`: fallback 7-Zip path `r"C:\Users\ADMIN\scoop\shims\7z.exe"` (should use `Path.home() / "scoop/shims/7z.exe"` in a future cleanup).

### Proposed Safe Refactor Plan (Ordered)

1. Extract utility pages (`?effects`, `?voices`, `?sounds`, `?gallery`, `?preview`) out of `js/main.js` into `js/pages/` (~350 lines removed from `main.js`).
2. Extract `GameController` (review state, AI turn coordinator, truncation, undo) out of `init()` in `js/main.js` into `js/gameController.js`.
3. Extract a shared `_animateStep(from, to, piece, captured, reverse)` helper inside `js/ui/boardView.js`.
4. Split `js/fx/endFx.js` renderers (`renderWin`, `renderLose`, `renderResign`, `renderDraw`) into separate pure helper functions.
5. Split `css/style.css` into `css/base.css`, `css/panel.css`, and `css/fx.css` (imported via `<link>` or `@import`).

---

## 2. Game-State Integrity & Race Conditions

### Mutation Points of the Live `Board`

All mutations to the real `Board` occur in:
- `BoardView._performMove()` (`js/ui/boardView.js`) — human click/drag and `boardView.playMove()` (AI when live).
- `BoardView.undo()` and `handleUndo()` (`js/main.js`) — 1-ply (PvP) or 2-ply (AI) undo.
- `maybeTriggerAiTurn()` (`js/main.js`) — background `board.applyMove()` when an AI reply arrives while `isReviewing()` is true.
- `startFreshGame()` (`js/main.js`) — `board.loadFen(START_FEN)`.
- `handleContinueFromHere()` (`js/main.js`) — `board.truncateTo(ply)`.

Review mode never mutates the live `Board`; it constructs a read-only `Board.fromFen(board.viewFen(viewPly))` for rendering.

### Race-Condition Test Suite (`python tools/verify_races.py`)

| Scenario | Result | Details |
|---|:---:|---|
| Engine reply after Undo | **PASS** | `total=0 ply=0` (`aiSearchToken` invalidated) |
| Engine reply after New Game | **PASS** | `total=0 ply=0` |
| Engine reply after Truncate ("Chơi tiếp từ đây") | **PASS** | `total=2 ply=2` |
| Engine reply after Resign | **PASS** | `total=3 modal=True` |
| Rapid clicks during animation & AI thinking | **PASS** | `total=2` (no double move) |
| Tab `visibilitychange` (hidden → visible) during search | **PASS** | `total=2` |
| Switching AI level mid-search | **PASS** | `total=2` |
| Mode switch `ai → pvp → ai` (Worker terminate & respawn) | **PASS** | `total=2` |

Console/page errors across all 8 scenarios: **0**.

**Observed subtle gap (non-failing in tests, worth noting):**
- Switching `aiLevel` mid-search does not cancel and restart the in-flight search; the current move finishes at the previous level and the new level applies starting on the next turn.

---

## 3. Rules Gaps & Pikafish Repetition Comparison

### Unimplemented Rules
- **Perpetual check (trường chiếu) & perpetual chase (trường tróc)**: Not implemented. Any 3-fold position repetition is adjudicated as `DrawRepetition`, whereas official Chinese/Asian Xiangqi rules forbid perpetual check/chase (the offending side loses).
- **Insufficient material draw**: Not explicitly adjudicated (reaches 60-move no-capture draw instead).

### 20 Pikafish-vs-Pikafish Self-Play Games (100 ms/move, 160-ply cap)

Run against `tools/server.py` (`Pikafish 2026-09-06`) with varied 2-ply openings:
- **Checkmate**: `2 / 20`
- **Stalemate**: `0 / 20`
- **3-fold Repetition (`DrawRepetition`)**: `4 / 20` (20%)
- **60-move No-Capture (`DrawNoCapture`)**: `0 / 20`
- **Reached 160-ply cap**: `14 / 20` (average length `149.2` plies)

In all 4 repetition games, `XiangqiRules.status()` ended the game as a draw on the 3rd occurrence, while Pikafish's internal repetition scoring evaluates perpetual checks/chases differently — meaning in edge cases Pikafish may avoid or seek a repetition that the UI scores as a draw.

---

## 4. Persistence

### Currently Saved (`localStorage`)
- `xq_game_mode` (`'pvp' | 'ai'`)
- `xq_player_side` (`'red' | 'black'`)
- `xq_ai_level` (`'tap-su' | 'nghiep-du' | 'cao-thu' | 'dai-su'`)
- `xq_ai_engine` (`'pikafish' | 'js'`)
- `xq_sfx_muted` (`'0' | '1'`)
- `xq_sfx_volume` (`0..1`)
- `xq_voice_enabled` (`'0' | '1'`)

### Lost on Refresh
- Current game board, move history, review ply, remaining hint count, active theme (`go-lim` vs `ngoc-bich` is not persisted to `localStorage`), and practice mode checkbox.

### Effort Estimate for Save / Load / Export / Autosave
- **Autosave current game** (`localStorage` storing `{ startFen, moves: iccs[], mode, playerSide, theme }`): ~0.5 day (very small, replays moves via `board.applyMove` on load).
- **Export / Import (FEN + ICCS move list / PGN-like text modal + copy/paste)**: ~1 day.

---

## 5. Cross-Environment (Phone & Tablet Touch Emulation)

Tested via Playwright with `has_touch=True` (screenshots saved to `preview/audit/`, gitignored):

| Viewport | Load Time | Tap-to-Move | `app-shell` Width | Panel Clipped? | Board `touch-action` |
|---|---:|:---:|---:|:---:|---|
| Phone (`390×844`) | 625 ms | **PASS** | `960 px` | **YES** (`panelRight=936 > 390`) | `auto` |
| Tablet (`820×1180`) | 609 ms | **PASS** | `960 px` | **YES** (`panelRight=936 > 820`) | `auto` |

**Findings:**
1. `.app-shell` enforces `min-width: 960px` while `html, body` sets `overflow: hidden`, so on viewports narrower than 960 px the right-hand side panel is clipped off-screen with no way to scroll to it.
2. `svg.board-svg` has `touch-action: auto` instead of `touch-action: none`, so dragging pieces on a real touch device can trigger browser pan/pull-to-refresh gestures (tap-tap still works cleanly).

---

## 6. Fresh-Clone Check (`<temp>/thư mục thử/ChineseChess`)

Cloned the local git repo into a temporary folder whose path contains both spaces and Vietnamese diacritics (`thư mục thử`), with no `engine/dist`, `assets/voice/*.mp3`, `preview/`, or `logs/`:

1. **`python tools/server.py --port 8774`** → Started cleanly; `GET /api/engine/info` returned `200 OK` with `{"available": false}`.
2. **Load page & play vs JS engine** → Board rendered, JS engine replied (`2` move chips), **1 console error**: `Failed to load resource: the server responded with a status of 404 (File not found)` when `js/audio/voice.js` fetched the absent `assets/voice/manifest.json` (game continued normally with sound effects and silent voice).
3. **`python -X utf8=0 tools/setup_engine.py`** → Exited `0`: downloaded `Pikafish.2026-09-06.7z` (53.6 MB), extracted into `thư mục thử\ChineseChess\engine\dist`, probed `Pikafish-Windows-x86-64-universal.exe: OK (Pikafish 2026-09-06, strategy=direct)`, wrote `engine/engine.json`.
4. **Restart `tools/server.py` & check `/api/engine/info`** → Returned `available: true`, `name: "Pikafish 2026-09-06"`.
5. **Voice generation (`tools/gen_voice.py`)** → Confirmed CLI requires `python tools/gen_voice.py` (no `--no-audition` flag); `README.md` command `python tools/gen_voice.py` is accurate.

---

## 7. Licensing & Third-Party Assets

| Asset / Dependency | License | Bundled in Repo? | Obligations for Public Redistribution |
|---|---|---|---|
| `assets/fonts/LXGWWenKaiTC-Subset.ttf` (LXGW WenKai TC subset, 120 glyphs) | SIL Open Font License 1.1 (`assets/fonts/LICENSE-OFL.txt`) | **Yes** | Keep copyright notice and `LICENSE-OFL.txt`; do not sell font by itself. **Reserved Font Name check**: `LICENSE-OFL.txt` line 1 specifies no Reserved Font Name after the copyright statement, so OFL Section 3 RFN restriction does not apply (and CSS uses `XiangqiCalligraphy`). |
| Pikafish (`official-pikafish/Pikafish`) | GNU GPL v3 (`engine/LICENSE`) | **No** (downloaded by `tools/setup_engine.py`) | If redistributed with the binary, must include GPL v3 license text and corresponding source / source offer. |
| `pikafish.nnue` | Pikafish NNUE terms (non-commercial without permission) | **No** | Do not bundle in commercial distributions without upstream permission. |
| `edge-tts` + Microsoft TTS | Library LGPL; TTS audio subject to Microsoft terms | **No** (`assets/voice/*.mp3` gitignored) | Generate locally for personal use only, or replace with self-recorded audio. |
| All SVG board/piece art, Web Audio SFX, JS/CSS/Python code | Project original (All Rights Reserved until a repo `LICENSE` is added) | **Yes** | Author may add an explicit open-source license (e.g. MIT) if desired. |

---

## 8. Performance & Resource Footprint

- **Tracked `assets/` size**: **61.5 KB** (`LXGWWenKaiTC-Subset.ttf` = 54.5 KB + license/READMEs).
- **First load (`1180×780`, local server)**: **594 ms** (`networkidle` + `document.fonts.ready`).
- **Memory & DOM stability**:
  - Initial: `475` DOM nodes, `0` canvases, `4` SVGs, `16.31 MB` JS heap.
  - After 100-ply game: `475` DOM nodes, `0` canvases, `4` SVGs, `16.31 MB` JS heap.
  - After 10 consecutive New Games: `478` DOM nodes, `0` canvases, `4` SVGs, `16.31 MB` JS heap.
- **Idle CPU / rAF**: **0** `requestAnimationFrame` callbacks over a 2-second idle window after animations and end-of-game cinematics settle (`verify_fx.py`: `calls=0`).

---

## 9. Top 10 Risks / Issues (Ranked by Severity)

| # | Severity | Issue | Location |
|---:|:---:|---|---|
| 1 | **High** | Phone (`390×844`) and tablet (`820×1180`) clip the side panel off-screen due to `.app-shell { min-width: 960px }` + `body { overflow: hidden }`. | `css/style.css:33,45` |
| 2 | **Medium** | Missing `assets/voice/manifest.json` on a fresh clone logs a `404 (File not found)` browser console error when `voice.js` probes it. | `js/audio/voice.js` |
| 3 | **Medium** | `svg.board-svg` uses `touch-action: auto`, so touch-dragging pieces on mobile can conflict with browser scroll/pull-to-refresh. | `css/style.css:79` |
| 4 | **Medium** | Perpetual check / perpetual chase (trường chiếu / trường tróc) is adjudicated as a 3-fold draw instead of a loss for the offending side. | `js/rules.js` |
| 5 | **Low** | Hardcoded Windows user path `C:\Users\ADMIN\scoop\shims\7z.exe` in `find_7z()` fallback list. | `tools/setup_engine.py:93` |
| 6 | **Low** | No game persistence across page reload (and active theme `Gỗ Lim`/`Ngọc Bích` is not saved to `localStorage`). | `js/main.js` |
| 7 | **Low** | Large monolithic files (`js/main.js` 1253 lines, `js/ui/boardView.js` 1273 lines, `css/style.css` 1556 lines) increase maintenance friction. | `js/main.js`, `js/ui/boardView.js`, `css/style.css` |
| 8 | **Low** | Changing AI difficulty level mid-search does not restart the active search; it takes effect on the next turn. | `js/main.js` |
| 9 | **Low** | Duplicated `parseIccs` and piece-slide animation blocks across modules. | `js/main.js`, `js/ui/boardView.js` |
| 10 | **Info** | No repository-level `LICENSE` file yet (defaults to All Rights Reserved). | repo root |

**Recommended order of work:** (1) Fix fresh-clone 404 console error on missing voice manifest, (2) Add responsive mobile/tablet layout + `touch-action: none` on `svg.board-svg`, (3) Replace hardcoded `C:\Users\ADMIN\...` with `Path.home()` in `setup_engine.py`, (4) Add game autosave & FEN/move-list export + persist theme, (5) Split `js/main.js` and `css/style.css`.
