# Progress Log

## Prompt 0 — Context, Plan & Risk Analysis
- **Built**: Created `docs/DECISIONS.md` with the concise web-stack plan, the 5 biggest risks + mitigations, and the user-directed tech stack override.
- **Files touched**: `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- **Status**: Passed. Proceeding to Prompt 1.

## Prompt 1 — Project Scaffold, Font Subsetting & Board SVG
- **Built**: Static web app scaffold (`index.html`, `css/style.css`, `js/main.js`, `js/theme.js`, `js/render/boardSvg.js`, `run.bat`, `tools/shot.py`, module stubs). Downloaded `LXGWWenKaiTC-Regular.ttf` + `LICENSE-OFL.txt` and subsetted with `pyftsubset` to `assets/fonts/LXGWWenKaiTC-Subset.ttf` (43.3 KB).
- **Files touched**: `index.html`, `css/style.css`, `js/theme.js`, `js/render/boardSvg.js`, `js/main.js`, `js/engine.js`, module stubs, `assets/fonts/LXGWWenKaiTC-Subset.ttf`, `assets/fonts/LICENSE-OFL.txt`, `run.bat`, `tools/shot.py`.
- **Commands & Results**:
  - `python -m fontTools.subset ...` → succeeded (43,308 bytes).
  - `python tools/shot.py board` → `[board] saved. errors=0 warnings=0`.
- **Visual Review (`preview/board.png`)**:
  - Wood grain horizontal, gentle, no seams/banding: PASS.
  - Grid lines crisp, river gaps files 1–7, palace diagonals: PASS.
  - Cannon/soldier tick marks, edge files inward only: PASS.
  - River text `楚河` / `漢界` engraved, `漢界` rotated 180°: PASS (tuned `riverY` from 577 → 575 for exact vertical centering).
  - File labels `九…一` bottom, `1…9` top rotated: PASS.

## Prompt 2 — 14 Piece SVGs, Gallery & 2-Round Art-Director Critique
- **Built**: `js/render/pieceSvg.js` implementing all 7 layers of DESIGN.md §6 using reusable `<symbol>` + `<use>` definitions, `?preview=pieces` (240 px 7×2), `?preview=pieces_small` (88 px 7×2), and `?gallery` (64, 88, 140 px on wood `#CE9650` and grey `#CFC7BA`).
- **Files touched**: `js/render/pieceSvg.js`, `js/theme.js`, `js/main.js`, `css/style.css`.
- **Commands & Results**:
  - `python tools/shot.py board pieces pieces_small` → all saved, `errors=0 warnings=0`.
  - Round 1 & Round 2 re-exports → `errors=0 warnings=0`.
- **Art-Director Tuning (2 rounds, within ±30% of DESIGN.md)**:
  - *Round 1*: raised glyph vertical center `57 → 55.6`, tightened engraved highlight offset `(0.8, 1.3) → (0.6, 1.0)` & opacity `0.75 → 0.85`, softened shadow blur `3.2 → 3.9` (`cy 66 → 66.8`, opacity `0.38 → 0.42`), toned down gloss opacity `0.38 → 0.30` (`cy 38 → 36.5`), boosted ring highlight opacity `0.70 → 0.85`.
  - *Round 2*: refined gloss ellipse `(50, 36.5, 26×15) → (49, 35.5, 23×12.5)` at opacity `0.28`, deepened bevel dark rim opacity `0.70 → 0.85`, raised inner hairline ring opacity `0.60 → 0.72` for 88 px clarity, fine-tuned glyph `y=55.4` with highlight `(+0.5, +0.9)`, nudged shadow `cx 60 → 61.2` to align with top-left light source.
- **Visual Review (`preview/pieces_sheet.png`, `preview/pieces_small.png`)**: All 4 Piece checklist items PASS.

## Prompt 3 — Model, Rules Stub, Interaction & Start Position
- **Built**: `js/model/{piece,moves,fen,board}.js`, `js/rules.js` (`RulesProvider` + `PermissiveRules`), `js/ui/anim.js` (demand-driven `Animator` with zero idle `rAF`), `js/ui/boardView.js` (click-click, drag-and-drop with 4 px threshold and 160 ms spring-back, 90 ms lift, 200 ms slide + 70 ms settle, 150 ms capture fade, 350 ms upright flip, 160 ms undo, last-move brackets, check-pulse hook, keyboard shortcuts `Ctrl+Z`, `N`, `F`, `Esc`), `tests/model.test.js`.
- **Files touched**: `js/model/*`, `js/rules.js`, `js/ui/anim.js`, `js/ui/boardView.js`, `js/main.js`, `css/style.css`, `tests/model.test.js`, `js/render/boardSvg.js`.
- **Commands & Results**:
  - `node --test tests/model.test.js` → 3/3 passed.
  - `python tools/shot.py start` → `[start] saved. errors=0 warnings=0`.
- **Visual Review (`preview/start_position.png`)**:
  - FEN placement (`帥` at `(4,9)`, `將` at `(4,0)`, all 32 pieces on exact intersections with 12-unit gap): PASS.
  - Caught back-rank pieces overlapping file labels at `y=78` / `y=1072`; adjusted labels to `y=60` / `y=1093` (size `26`) and logged in `docs/DECISIONS.md`.

## Prompt 4 — Side Panel, Ngọc Bích Theme, Modal & HiDPI
- **Built**: `js/ui/sidePanel.js` (Black/Red player cards with active gold outline, static `10:00` clocks, overlapping miniature captured trays reusing `<symbol>`s with 120 ms fade-in, two-column auto-scrolling ICCS move list, `"Lượt của Đỏ"` / `"Lượt của Đen"` indicator, `"Cho phép đi tự do"` toggle, 4 pill buttons, confirm modal for `"Ván mới"`), second theme `"Ngọc Bích"` in `js/theme.js` with 200 ms cross-fade, and `tools/verify.py`.
- **Files touched**: `js/ui/sidePanel.js`, `js/theme.js`, `js/main.js`, `css/style.css`, `tools/verify.py`.
- **Commands & Results**:
  - `python tools/shot.py all app_jade` → all 7 previews saved, `errors=0 warnings=0`.
  - `python tools/verify.py` → click-click (`h2e2`), drag capture, undo, upright flip, theme toggle, new-game modal, layouts (`960×680`, `1180×780`, `1600×900`), HiDPI (`1.0`, `1.5`, `2.0`), gallery (`84` SVGs) all PASS with `errors=0 warnings=0`.
- **Visual Review (`preview/start_position.png`, `preview/start_position_jade.png`, `preview/app_default.png`)**: All items PASS.

## Prompt 5 — Final Verification & Handoff
- **Built**: Vietnamese `README.md` with run instructions, URL flags, keyboard shortcuts, project tree, OFL font credits, and "Bước tiếp theo" extension guide (real `RulesProvider`, UCI `Engine` bridge, sound effects).
- **Files touched**: `README.md`, `docs/PROGRESS.md`.
- **Status**: Complete.

## Visual Polish Pass
- **Change 1 — Glyph weight (both themes)**:
  - Checked LXGW WenKai TC Medium on Google Fonts (`404` — only Light/Regular/Bold exist). Kept subsetted Regular and added `stroke-width="0.75" stroke-linejoin="round" paint-order="stroke fill"` matching glyph/highlight fill in `js/render/pieceSvg.js`.
  - *Before/After*: Thin calligraphic strokes at 88 px → crisp, confident carved strokes with zero clogging in complex glyphs (`傌`, `俥`, `砲`, `將`) in `preview/pieces_small.png`. Kept.
- **Change 2 — "Gỗ Lim" contrast**:
  - Deepened playing surface gradient `#E3B572/#CE9650/#DDAA64` → `#D9A55F/#C4883F/#D19A52` (frame unchanged).
  - Added large-scale horizontal plank variation (`feTurbulence fractalNoise`, `baseFrequency="0.004 0.05"`, `numOctaves="2"`, `seed="19"`, `multiply`, opacity `0.14`) over existing fine wood grain.
  - Added soft lamp-light radial gradient centred at `(50%, 42%)` (white `10%` → transparent at `70%`) + corner vignette (`14%` black).
  - Increased piece contact shadow (`opacity 0.42 → 0.50`, `cy +1.0`, soft blur `3.9`) and ring stroke `3 → 3.4` in Gỗ Lim only.
  - *Before/After*: Ivory discs now separate much more clearly from the warmer wooden plank surface with stronger tactile depth in `preview/start_position.png`. Kept.
- **Change 3 — "Ngọc Bích" river text**:
  - Updated `riverTextOpacity` `0.88 → 1.0` and `riverTextFill` `#A9C8BC → #C9E0D6` (all other jade board/piece values unchanged).
  - *Before/After*: `楚河` / `漢界` noticeably clearer against the deep slate-teal surface in `preview/start_position_jade.png`. Kept.
- **Live App Playwright Verification (`tools/verify.py`)**:
  - Captured `app_default.png`, `app_midgame.png` (8 moves + Red & Black captures), `app_dragging.png` (mid-drag lifted piece + gold target brackets), `app_flipped.png` (180° board rotation with upright glyphs), `app_jade.png`.
  - All assertions (drag-and-drop move, undo restores captured piece, flip keeps glyphs upright, theme switch, responsive layout, HiDPI 1.0/1.5/2.0) passed with `errors=0 warnings=0`.

## Feature Pass — Part A (Full Xiangqi Rules) & Part B (Web Audio Sound)
- **Part A — Rules (`js/rules.js`, `js/model/board.js`, `js/model/fen.js`, `js/ui/boardView.js`, `js/ui/sidePanel.js`, `js/main.js`, `tests/rules.test.js`)**:
  - Implemented `XiangqiRules` over a compact `Int8Array(90)` scratch board with zero-allocation `isGeneralAttacked` and make/unmake legal filtering (all 7 piece types + horse leg + elephant eye/river + cannon screen + flying general + `Check`/`Checkmate`/`Stalemate`/`DrawRepetition`/`DrawNoCapture`).
  - Added `halfmoveClock` and `positionHistory` to `Board` with full undo consistency.
  - PERFT from `START_FEN`: depth 1 = `44`, depth 2 = `1,920`, depth 3 = `79,666` (12 ms), depth 4 = `3,290,240` (254 ms). All 11 rules tests + 3 model tests pass.
  - UI integration: `"Đi tự do (luyện tập)"` toggle (default OFF), gold empty-target dots (`r=0.14 cell`) + red-orange capture rings (`r=0.5 cell`), illegal drag spring-back + 2-cycle 4 px shake, `"Chiếu tướng!"` 1.4 s toast + pulsing red glow, game-over modal (`Ván mới` / `Xem lại bàn cờ`), `+`/`#` move suffixes, undo across game over.
- **Part B — Sound (`js/audio/synth.js`, `js/audio/sfx.js`, `assets/sounds/README.md`, `tools/verify_sound.py`)**:
  - Synthesized all 9 events offline with `OfflineAudioContext` (`select`, `move`, `capture`, `check`, `checkmate` with Karplus-Strong pentatonic arpeggio, `start`, `illegal`, `draw`, `undo`).
  - Lazy `AudioContext` + master gain + `DynamicsCompressorNode`, ±5% pitch / ±8% gain anti-machine-gun variation (except gongs), `assets/sounds/` sample override discovery without 404 console errors, speaker mute + volume slider (`localStorage`, `M` shortcut, `document.hidden`), `?sounds` demo page, and `window.__sfxLog` test hook (`?test`).
  - `python tools/verify_sound.py` → all 9 sounds passed RMS/peak/click/duration checks and exported to `preview/sounds/*.wav`.
  - `python tools/verify.py` → all rules, interaction, SFX log, layout, and HiDPI assertions passed (`errors=0 warnings=0`); captured `app_default.png`, `app_legal_hints.png`, `app_check.png`, `app_checkmate.png`, `app_midgame.png`, `app_dragging.png`, `app_flipped.png`, `app_jade.png`.

## Feature Pass — Chinese "Ancient General" Voice Lines
- **TTS & Audition (`tools/gen_voice.py`, `assets/voice/`)**:
  - Installed `edge-tts`; discovered 3 zh-CN male candidates: `zh-CN-YunjianNeural`, `zh-CN-YunyangNeural`, `zh-CN-YunxiNeural`.
  - Generated 9 audition MP3s in `preview/voices/audition/` + `audition.json` for `?voices`.
  - Generated 7 final MP3s + `assets/voice/manifest.json` using `zh-CN-YunjianNeural`, `pitch=-35Hz`, `rate=-15%`, plus Vietnamese `assets/voice/README.md` and ToS note in `docs/DECISIONS.md`.
- **Font Re-subsetting**: Added `將軍吃殺死承讓請和棋` to `assets/fonts/LXGWWenKaiTC-Subset.ttf` (49.4 KB); visually confirmed authentic LXGW WenKai TC calligraphy rendering in `preview/app_check_voice.png`.
- **Audio & UI (`js/audio/synth.js`, `js/audio/voice.js`, `js/audio/sfx.js`, `js/ui/boardView.js`, `js/ui/sidePanel.js`, `js/main.js`, `css/style.css`)**:
  - Added synthesized `"drum"` (`95 → 48 Hz`, `480 ms`, peak `0.4516`), `createVoiceChain` (lowshelf +6 dB @ 180 Hz, peaking +2.5 dB @ 2.2 kHz Q 0.9, compressor -22 dB ratio 4, dry 0.82 + stereo 0.9 s hall ConvolverNode wet 0.20), RMS normalization to 0.11 (capped 3x), priority cancellation (60 ms fade-out), `speechSynthesis` fallback.
  - Added `"Giọng nói (V)"` icon toggle + `localStorage` persistence, calligraphy + pinyin + Vietnamese toast captions (top for check/checkmate/start/draw; compact bottom `0.9 s` badge for `吃`/`殺`), `?voices` audition page, and `?sounds` Voice section + full checkmate sequence demo.
- **Verification**:
  - `node --test tests/model.test.js tests/rules.test.js` → 13/13 pass.
  - `python tools/verify_sound.py` → all 10 synth buffers (including `drum`) verified + WAVs exported.
  - `python tools/verify_voice.py` → all 7 raw MP3s + 7 processed stereo WAVs (`peak <= 0.62`) verified.
  - `python tools/verify.py` → all rules, interaction, voice priority, mute/voice-off, `?voices`, `?sounds`, layout & HiDPI assertions pass with `errors=0 warnings=0`; captured `preview/app_check_voice.png`.

## Feature Pass — Voice Silence Trimming & Play vs Computer (AI)
- **Part A — Voice Silence Trimming (`js/audio/voice.js`, `js/audio/sfx.js`, `tools/verify_voice.py`)**:
  - Added `trimSilence(ctx, buf)` on decode (leading `|x| > 0.01` minus `15 ms`; trailing `+120 ms` tail with `60 ms` fade-out) and `voice.getDuration(eventKey)`.
  - Reduced padded `1.87–2.45 s` files to `0.466–1.316 s` (all in `[0.25, 1.6] s`), and scheduled `checkmate2` (`承讓`) from trimmed `checkmate_1` (`將死`) duration (`450 + 1316 + 420 = 2186 ms`).
- **Part B — Offline Xiangqi AI (`js/ai/{levels,eval,movegen,search,worker,client}.js`, `tests/ai.test.js`)**:
  - Fast allocation-free `movegen.js` verified identical to `XiangqiRules` on PERFT (`44 / 1920 / 79666`).
  - Negamax alpha-beta + iterative deepening + 64-bit Zobrist (two `Uint32`s) + `2^20` TT + MVV-LVA/killers/history + quiescence (depth 6) + check extension + repetition handling + seeded RNG.
  - Depth 5 from `START_FEN`: `164,504 nodes`, **`2,334,890 nps`** (71 ms). All 7 AI tests (100 random positions legality, 3 mate-in-1 puzzles, hanging chariot capture, 4-game self-play `Nghiệp dư` 3–1 `Tập sự`, edge cases) pass.
  - ES Module Web Worker (`worker.js`) with chunked main-thread fallback (`client.js`) and `beforeunload` termination; `[AI rAF check] frames=200 maxGap=16.8ms`.
  - UI (`sidePanel.js`, `boardView.js`, `main.js`, `style.css`): `Hai người | Đấu máy`, `Bạn cầm: Đỏ / Đen` (Black auto-flips & AI moves first), 4 levels (`Tập sự`, `Nghiệp dư`, `Cao thủ`, `Đại sư`), `localStorage` persistence, `Máy đang nghĩ…` + depth/score readout, 450 ms minimum delay, 2-ply undo, `Gợi ý (3)` blue arrow, `Đầu hàng` modal, `README.md` & `DECISIONS.md` updated.
  - All gates pass (`20/20` unit tests, `verify_sound.py`, `verify_voice.py`, `verify.py` `errors=0 warnings=0`); captured `app_vs_ai_thinking.png`, `app_hint_arrow.png`, `app_vs_ai_gameover.png`.

## Sound Tuning Pass — Decisive Voice & Crisp Loud Wood Clacks
- **Part A — Voice (`tools/gen_voice.py`, `js/audio/voice.js`, `js/audio/sfx.js`, `tools/verify_voice.py`)**:
  - Generated `preview/voices/audition2/` (`rate ∈ {+5%, +15%, +25%} × pitch ∈ {-30Hz, -40Hz, -50Hz} × volume +20%` + punctuation variants `将军!` and `将，军！`), grouped by rate on `?voices`.
  - Regenerated all 7 final files with `zh-CN-YunjianNeural`, `rate=+15%`, `pitch=-40Hz`, `volume=+20%`. Every single file met its strict trimmed duration target (`0.292 s .. 0.924 s`) without needing per-file speedups.
  - Upgraded `voice.js`: tighter trim (`|x| > 0.015 - 5 ms`, `+50 ms` tail w/ `30 ms` fade-out, `3 ms` fade-in), `1.35x -> 1.0` 90 ms transient boost, `+4 dB @ 2.4 kHz` presence peak, `WaveShaper` soft `tanh` (drive `1.6`, `2x` oversample), faster compressor (`2 ms / 80 ms`, ratio `5`), drier shorter hall (`0.45 s`, pre-delay `10 ms`, `dry 0.95`, `wet 0.08`).
  - Re-timed all voice entries (`capture +20 ms`, `check drum +40 ms / voice +70 ms / gong +80 ms ducked -7 dB`, `checkmate drums +80/220 ms / voice +300 ms / arp @ end / 承讓 +220 ms after end`, `start +250 ms`, `draw +300 ms`).
- **Part B — Wood Clacks & Mix (`js/audio/synth.js`, `js/audio/sfx.js`, `assets/sounds/README.md`, `tools/verify_sound.py`)**:
  - Redesigned `move` (`0.140 s`, peak `0.9000`, RMS `0.1734`, attack `0.23 ms`, centroid `1618 Hz` vs classic `657 Hz`) and `capture` (`0.260 s`, peak `0.9400`, RMS `0.2425`, attack `0.36 ms`, centroid `1382 Hz` vs classic `642 Hz`), preserving `move_classic` & `capture_classic` for A/B toggle on `?sounds`.
  - Added separate buses (`SFX_BUS_GAIN = 1.25`, `GONG_GAIN = 0.80`, `VOICE_BUS_GAIN = 1.0`), master limiter (`-3 dB`, ratio `20`, `1 ms / 60 ms`), zero-delay synchronous `currentTime` playback, and `seq_capture_check.wav` (`peak = 0.8554 <= 0.95`).
  - All gates passed (`20/20` unit tests, `verify_sound.py`, `verify_voice.py`, `verify.py` `errors=0 warnings=0`).

## Voice Per-Event Override & Pikafish UCI Engine Pass
- **Part A — Yunyang Voice for `check` & `capture` (`tools/gen_voice.py`, `js/audio/voice.js`, `js/main.js`, `tools/verify_voice.py`)**:
  - Added `--voice-map` and `--eq-boost` CLI options to `tools/gen_voice.py`, storing per-file `voice` (`name`, `pitch`, `rate`) and `eqBoost` in `assets/voice/manifest.json`, plus 3-attempt retry & atomic `.tmp.mp3` writes.
  - Switched `check` (`將軍`) and `capture` (`吃`, `殺`) to `zh-CN-YunyangNeural` (`-20Hz`, `+5%`, `+20%` volume); kept `start`, `checkmate_1`, `checkmate_2`, `draw` on `zh-CN-YunjianNeural` (`-40Hz`, `+15%`, `+20%`).
  - Generated `preview/voices/audition3/` (`将军！`, `吃！`, `杀！` × rates `{-10%, +0%, +5%, +10%}`) under `"Yunyang -20Hz"` on `?voices`, read real defaults from `manifest.json`, and added `?v=` cache-busting.
  - Spectral centroid check: Yunyang (`2342 Hz`) > `1.25×` Yunjian (`1774 Hz`), so added per-file `"eqBoost": 2` (`+2 dB` lowshelf @ `160 Hz`) for `check` & `capture` (`2309 Hz` vs `1774 Hz`, `1.30×`). All 7 trimmed durations met targets (`0.267–0.924 s`) and processed WAV peaks `0.46–0.52 <= 0.95`.
- **Part B — Pikafish UCI Engine (`tools/setup_engine.py`, `tools/server.py`, `js/ai/pikafishClient.js`, `js/ai/levelsPikafish.js`, `tools/verify_engine.py`)**:
  - Downloaded `Pikafish 2026-09-06` (`Pikafish-Windows-x86-64-universal.exe` + `pikafish.nnue`, `50.7 MB`), copied GPL v3 `engine/LICENSE`, wrote Vietnamese `engine/README.md`, and git-ignored binaries/logs.
  - Built stdlib-only `tools/server.py` (127.0.0.1 bind, Host check, lazy single Pikafish process, relative `EvalFile` for Windows Unicode paths, strict FEN/move/64 KB body validation, SSE `/api/engine/stream`, `/api/engine/{info,search,stop,newgame}`, rotating `logs/server.log`, zero-orphan shutdown) and updated `run.bat` & `README.md`.
  - Wired `"Máy: Pikafish | Nội bộ (JS)"` selector into `Đấu máy` panel (`localStorage` persisted, auto-detect `/api/engine/info`, graceful JS fallback, live SSE `độ sâu · score · nps` readout, `XiangqiRules` legality guard).
  - Verified with `tools/verify_engine.py`: depth-12 `3,877,900 nps` (`31 ms`), API & security tests pass, `50/50` random legality, `3/3` mate-in-1 puzzles, **4–0** Pikafish vs JS `Đại sư` at `300 ms/move`, Playwright UI `rAF maxGap=33.3ms`, `0` console errors/warnings, `0` orphan processes; captured `preview/app_engine_selector.png` & `preview/app_pikafish_thinking.png`.
  - All gates green (`20/20` `node --test`, `verify.py`, `verify_sound.py`, `verify_voice.py`, `verify_engine.py`).

## Bugfix — `setup_engine.py` Non-ASCII Path Probe Failure (`cp1252` PowerShell)
- **Root cause**: `setup_engine.py`'s `test_binary()` passed the absolute `nnue_path` containing Vietnamese characters (`<project root>`) to `subprocess.run(..., text=True)` without `encoding="utf-8"`. Under default Windows PowerShell (`cp1252`), `stdin.write()` threw `UnicodeEncodeError: 'charmap' codec can't encode characters`, which `except Exception: return False, ""` swallowed as `unsupported/failed`. Additionally, `print(extract_dir)` crashed under `cp1252`.
- **Fix (`tools/engine_launch.py`, `tools/setup_engine.py`, `tools/server.py`, `tools/verify_engine.py`)**:
  - Extracted shared `tools/engine_launch.py` used by both `setup_engine.py` and `server.py` (identical `cwd=exe.parent`, relative `EvalFile`, UTF-8 pipes, `CREATE_NO_WINDOW`, Windows `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` to prevent orphan processes).
  - Added 20 s first-run threaded `uci -> uciok -> EvalFile -> isready -> readyok` probe, automatic non-ASCII fallbacks (`direct` -> Windows 8.3 short path via `GetShortPathNameW` -> `%LOCALAPPDATA%\ChineseChessEngine\` copy), antivirus quarantine & missing VC++ Redist (`0xC0000135`) diagnostics, `logs/setup_engine.log`, safe idempotent re-verification of existing `engine/engine.json`, and UTF-8 stdout reconfiguration.
  - Added Vietnamese-folder (`thư mục thử`) `-X utf8=0` probe test to `tools/verify_engine.py`.
  - All gates passed (`setup_engine.py --force`, idempotent `setup_engine.py`, `verify_engine.py` depth-12 `2,881,857 nps`, `0` orphans, `verify.py`, `verify_sound.py`, `verify_voice.py`, `node --test` `20/20`).

## Feature Pass — Review Mode, Scrollbar-Free Move List & End-of-Game Cinematics
- **Part 1 — Review Mode (`js/model/board.js`, `js/ui/boardView.js`, `js/main.js`, `tests/history.test.js`)**:
  - Separated live `Board` state from `viewPly` using O(1) per-ply `snapshots` (`fen`, `sideToMove`, `move`, `captured`, `gaveCheck`, `isCheckmate`, `capturedByRed`, `capturedByBlack`) + `truncateTo(ply)`.
  - Added 1-ply forward/backward slide animations + quiet `-9 dB` review clacks, 120 ms cross-fade on jumps, board input lock + amber frame outline + slim review banner (`Đang xem lại nước X/N`, `Có nước mới`, `Về hiện tại`, `Chơi tiếp từ đây` with confirm modal), `⏮ ◀ ▶ ⏭ ⏯` bar (800 ms auto-replay), keyboard shortcuts (`←`, `→`, `Home`, `End`, `Space`, `Esc`), non-disruptive background AI replies, and `window.__view` hook.
- **Part 2 — New Move List & Timeline Strip (`js/ui/sidePanel.js`, `css/style.css`)**:
  - Hid native scrollbar (`offsetWidth - clientWidth === 0`) with dynamic 18 px top/bottom fade masks, `"Thế ban đầu"` chip, clickable `#` row numbers, `<button>` move chips with 18 px piece SVG icons, capture (`×` + red-orange left border), check (gold dot), checkmate (red-gold bg), roving `tabindex`, floating `"↓ Nước mới"` pill, and scrubbable 34 px SVG timeline strip with pointer-capture tooltip.
- **Part 3 — End-of-Game Cinematics & Sounds (`js/fx/{swords,particles,endFx}.js`, `js/audio/{synth,sfx}.js`, `assets/fonts/LXGWWenKaiTC-Subset.ttf`, `tools/verify_fx.py`)**:
  - Re-subset `LXGWWenKaiTC-Subset.ttf` to include `勝 敗 和 投 降` (120 glyphs, 54.5 KB).
  - Added 6 synthesized sounds (`sword_clash`, `sword_stab`, `stamp`, `sword_touch`, `defeat`, `cloth_whoosh`), all verified in `verify_sound.py` (`18/18` buffers + `seq_capture_check.wav`).
  - Built deterministic `render(t)` cinematics for **Win** (*Song kiếm giao phong*), **Lose** (*Bại trận*), **Resign** (white flag), and **Draw** (*Hạ kiếm*) with theme-aware accents (`Gỗ Lim` & `Ngọc Bích`), `?effects` preview page, `window.__fxSeek(ms)`, instant skip (`0.7 ms`), clean cancel on undo/new game, and `prefers-reduced-motion` fallback.
  - Visual review tuning: moved `<canvas>` above `<svg>` and bumped clash spark initial offset so `t=1160` clash sparks pop over crossed blades; added dark stroke outline on Vietnamese captions for contrast over bright steel; dismissed lingering live toasts on entering review; removed redundant font `<link rel="preload">` from `index.html` (0 warnings).
  - All gates green: `node --test` (`22/22` pass), `verify.py` (`errors=0 warnings=0`, captured `app_review.png` & `app_movelist_long.png`), `verify_sound.py` (`18/18`), `verify_voice.py` (`7/7`), `verify_fx.py` (`48` shots, `maxGap=33.4ms <= 50ms`, `0` idle rAF calls for 2 s, `errors=0 warnings=0`), `verify_engine.py` (`3,741,967 nps`, `0` leaked orphans).

## Repo Hygiene, README, Screenshots, Read-Only Audit & GitHub Push
- **Git & Hygiene**: Initialized `main`, added `.gitattributes`, updated `.gitignore` (excluding `engine/` binaries/NNUE, `assets/voice/*.mp3` + `manifest.json`, `preview/`, `logs/`, zips/caches while preserving READMEs, `engine/LICENSE`, and subset font + OFL license), moved `PROMPTS.md` -> `docs/PROMPTS.md`, scrubbed personal path from `docs/PROGRESS.md`, and created initial local commit.
- **README & Curated Screenshots**: Optimized 10 curated PNGs into `docs/screenshots/` (`52–96 KB` each, `0.74 MB` total), rewrote `README.md` in Vietnamese with factually verified commands, tables, shortcuts, and link-checked relative paths.
- **Read-Only Audit (`docs/AUDIT.md` & `tools/verify_races.py`)**:
  - `verify_races.py`: **8/8** race-condition scenarios PASS (`0` console/page errors).
  - 20 Pikafish-vs-Pikafish games (`100 ms/move`): `2` checkmate, `4` 3-fold repetition draws, `14` 160-ply cap.
  - Cross-env touch tests (`390×844` & `820×1180`): tap-to-move works, side panel clipped due to `min-width: 960px`, `touch-action: auto` noted.
  - Fresh-clone check into `<temp>/thư mục thử/ChineseChess`: JS engine works out of the box (1 expected `404` on absent `manifest.json`), `setup_engine.py` downloads & probes Pikafish cleanly, `/api/engine/info` reports `available: true`.
  - Performance: `594 ms` first load, `61.5 KB` tracked `assets/`, flat `16.31 MB` heap across 100 plies and 10 new games, `0` idle rAF callbacks.

## Feature Branch `feat/lobby-jieqi-online`
### Phase 0 — Foundations & Refactor
- Added root `package.json` (`"type": "module"`) and `tests/core-import.test.js` verifying zero DOM/window access in core model/rules/AI/variant modules.
- Built hash router (`js/app/router.js`) with screen lifecycle `{ mount, unmount }`, `window.__router`, and `window.__leaks`.
- Added versioned settings store (`js/app/settings.js`, `xq_settings_v1`, legacy migration, persisted `theme`, `nickname`, `guestId`, `bgQuality`, `jieqi`, `online`, `last`, `ratings`).
- Extracted `js/pages/utilityPages.js`, `js/game/GameController.js`, `js/screens/gameScreen.js`, and `js/variants/xiangqi.js`; reduced `js/main.js` to a 132-line bootstrap.
- Fixed audit items: `Path.home()` 7z lookup in `tools/setup_engine.py`, silent `200 OK {"empty":true}` fallback on missing `assets/voice/manifest.json`.
- All gates passed (`23/23` unit tests, `verify.py`, `verify_races.py`, `verify_fx.py`, `verify_engine.py`).

### Phase 1 — Lobby, Animated Background, Mode Select & Settings
- Built `js/ui/lobbyBackground.js` ("Đêm hội đèn lồng bên sông": night sky, moon, twinkling stars, 3 ink-wash mountain layers with parallax, mist, single DPR-capped canvas with lanterns, fireflies, petals, shooting star, ink stamps, hover mood crossfade, adaptive quality, `bgQuality` high/low/off, `prefers-reduced-motion`, zero rAF in game).
- Built `js/screens/lobbyScreen.js`, `js/screens/modeScreen.js`, `js/ui/eloBar.js`, and `js/ui/settingsModal.js` (7 tabs, focus trap, Esc close, live validation, persisted theme/nickname/audio/Cờ Úp/online URL).
- Added in-game top-left `← Sảnh` (with leave confirmation if game in progress) and `⚙` buttons.
- Added `tools/verify_lobby.py`: passed `1600x900 .. 360x740` (0 horizontal overflow), `maxGap <= 50 ms`, `0` idle rAF in game, `0` leaks & `0.00 MB` heap delta across 20 round trips, `errors=0 warnings=0`.
