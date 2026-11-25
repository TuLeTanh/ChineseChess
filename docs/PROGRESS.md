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


## Phase 2 — Cờ Úp (Jieqi) (branch `feat/lobby-jieqi-online`)
- Implemented pure Node-importable Cờ Úp rules (`js/jieqi/rules.js`), variant descriptor (`js/variants/jieqi.js`), PIMC AI presets (`js/ai/levelsJieqi.js`), PIMC search (`js/ai/jieqiSearch.js`), and Vietnamese rules reference (`docs/RULES_JIEQI.md`).
- Added covered-piece SVG art (`pieceBackSymbolId`, lacquer crimson + ebony medallions) in `js/render/pieceSvg.js`, reveal flip animation and `"?"` target hints in `js/ui/boardView.js`, remaining-pool panel and reveal badges/diamonds in `js/ui/sidePanel.js`, and pentatonic pitched `reveal` synth sound in `js/audio/synth.js` + `js/audio/sfx.js`.
- Wired Cờ Úp into Web Worker (`js/ai/worker.js`, `js/ai/client.js`), `GameController`, and `gameScreen` (disabling undo & truncate in Cờ Úp AI/online modes).
- Added `tests/jieqi.test.js` (10/10 invariants incl. 44/1920, 300×5 legality independence, 300-ply undo round-trip, no-peeking), `tests/jieqiAi.test.js` (4/4 incl. 100 random positions, 3 mate-in-1 puzzles, 4-game self-play, no-peeking), and `tools/verify_jieqi.py` (passed with `errors=0 warnings=0`).
- All 32/32 Node unit tests + `verify_sound.py` (19 buffers incl. `reveal` peak 0.54) + `verify_jieqi.py` + `verify.py` passed.


## Phase 3 — Online Play (branch `feat/lobby-jieqi-online`)
- Added shared protocol (`js/online/protocol.js`), authoritative Node + `ws` server (`server/package.json`, `server/package-lock.json`, `server/index.js`), browser client (`js/online/connection.js`, `js/online/onlineModals.js`, `js/online/onlineGameController.js`).
- Features: FIFO matchmaking (120 s timeout), 6-char private rooms + `#/join/<CODE>` invite links, server-authoritative Xiangqi & Cờ Úp (server-only `_secret`, zero wire leak), monotonic `hrtime.bigint()` clocks + timeout, 90 s/180 s reconnect grace & reload resync, draw offers, resign, rematch with swapped colors, strict static whitelist, origin checks, rate limits, and XSS-safe `textContent` nicknames.
- Added `Dockerfile`, `.dockerignore`, `docs/DEPLOY.md`, `docs/PROTOCOL.md`, updated `README.md` and `docs/DECISIONS.md`, and curated 6 optimized screenshots in `docs/screenshots/` (163–305 KB each).
- Added `tests/online/server.test.js` (7/7 passed) and `tools/verify_online.py` (2 Playwright contexts: quick-match, reload resync, room link Cờ Úp, XSS check — passed with `err=0, warn=0`).


## QA + Fix + Push Pass (`feat/lobby-jieqi-online`)
- Added `tests/online/gaps.test.js` (7/7), `tools/verify_security.py`, `tools/verify_explore.py` (seeded monkey test + full UI/route/settings/online checks), and `tools/jieqi_strength.js`.
- Fixed 4 bugs (1 commit each): `fad3c3f` (CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`), `514331b` (`.ttf` `font/ttf` MIME type), `891af9e` (read top-level `settings.nickname` in online sessions), `70af926` (prevent side-panel / move-list clipping at 780 px viewport in Cờ Úp).
- Wrote full QA report in `docs/TEST_REPORT.md` including Cờ Úp AI strength table (5-1-0, 5-0-1, 4-2-0), security headers, visual review, and privacy scan (0 hits).


## Upgrade Pass 1 — Cleanups + Save / Export / Import (`feat/save-export`)
- **Phase 0 Cleanups**: hid redundant PvP/AI segmented mode toggle on game screen (`3f5d38b`), prevented Cờ Úp move-chip ICCS truncation (`b381784`), stacked `.board-toast` below `.online-disconnect-banner` (`b281092`), upgraded `verify_lobby.py` rAF assertion to p95/2%/250ms (`4458ae9`), and added adaptive 32-node clock-check granularity for low Jieqi budgets (`13117cf`, bringing `tap-su` max/budget from `1.92x` to `1.14x`).
- **Phase 1 Pure Formats (`6543fc8`)**: `js/storage/gameRecord.js`, `js/storage/formats.js` (JSON, PGN-like, FEN, deflate-raw base64url share links with 256 KB zip-bomb cap), `js/storage/validate.js` (strict full-rules replay & prototype-pollution guard), `dealRemainingPool` in `js/jieqi/rules.js`, `docs/FORMATS.md`, `tests/storage/formats.test.js` (5/5).
- **Phase 2 Storage Layer (`be39a89`)**: IndexedDB `GameStore` (`js/storage/gameStore.js`) with in-memory fallback, quota error handling, 200-game prune prompt, autosave snapshots, settings schema v2 (`js/app/settings.js`), and `tests/storage/store.test.js` (3/3).
- **Phase 3 & 4 UI, E2E & Docs**: Library (`#/library`), Archive/Share Replay (`#/play/<game>/review`, `#/replay?g=...`), Lobby Resume strip & drag-drop import, Export/Import modals, Settings > Dữ liệu controls, online auto-save, `tools/verify_saves.py` (a–j all PASS, `errs=0 warns=0`), and 3 curated screenshots in `docs/screenshots/`.


## Upgrade Pass 2 — Mobile / Touch (`feat/mobile-touch`)
- **Phase A (Read & Map)**: Audited layout/pointer/CSS/selectors into `docs/MOBILE_DESIGN.md`; verified baseline `54/54` Node unit tests + `12/12` Playwright suites green; captured 12 desktop baseline PNGs (`960x680`, `1180x780`, `1600x900`) into `preview/mobile_baseline/`; installed Playwright WebKit 26.5.
- **Phase B (Test System RED Baseline, `9f5d4f2`)**: Added `js/ui/touchMath.js` stub, `tests/touch/touchMath.test.js` (8/8 RED), `tools/mobile_lib.py`, `tools/verify_mobile.py` (M1–M9), `tools/verify_touch.py` (T1–T14 + LAN + 4× CPU perf + monkey), `tools/verify_mobile_all.py`, and recorded RED baseline in `docs/MOBILE_SCOREBOARD.md`.
- **Phase C (Implementation, C1–C9)**:
  - **C1 (`7c67e98`)**: `viewport-fit=cover`, `--sat/--sar/--sab/--sal` + `--app-h`/`--vvh`, `js/ui/device.js`, `touch-action: none` on board, `16px` mobile inputs, `contextmenu` prevented.
  - **C2 (`321fe0d`)**: Full `js/ui/touchMath.js` (8/8 GREEN), `js/ui/layoutManager.js`, `js/ui/moveStrip.js`, `stack`/`side` CSS Grid without DOM re-parenting, compact board `viewBox` (`73 73 904 1004`).
  - **C3 (`c5268af`)**: `js/ui/bottomSheet.js` (`closed`/`half`/`full`, 44 px handle, pointer-capture flick snap, 40% backdrop, Esc + focus return, 3 tabs reusing existing DOM).
  - **C4 (`baeba1d`)**: Touch drag-and-drop in `js/ui/boardView.js` (`0.55` pick radius, `1.25x` scale + `computeLiftOffset`, gold snapped ring, `chooseDropTarget` from piece center, multi-touch/cancel isolation, `0.18` coarse dots) + `js/ui/haptics.js` (40 ms throttle).
  - **C5 (`ee5953a`)**: Bottom-sheet modals on `< 600px`, stacked 48 px result card buttons above controls bar, board-relative toasts/banners, mobile-optimized `js/fx/endFx.js`.
  - **C6 (`eca140d`)**: `haptics`, `touchLift`, `keepAwake` settings + Settings > Trò chơi toggles + coarse-pointer `low` lobby background default.
  - **C7 (`bcce88a`)**: `js/app/wakeLock.js` + iOS/mobile `AudioContext` gesture unlock (1-sample silent buffer + `visibilitychange`/`statechange` resume).
  - **C8 (`41f81e3`)**: `js/app/uuid.js` (`getRandomValues` UUID v4 fallback) + clipboard fallbacks for insecure HTTP LAN contexts.
  - **C9**: Updated `README.md` (mobile/tablet & LAN guide + updated known limits), `docs/DECISIONS.md`, and 4 optimized screenshots (`mobile_stack.png` 205 KB, `mobile_sheet.png` 96 KB, `mobile_landscape.png` 114 KB, `mobile_tablet.png` 319 KB).
- **Phase D (Self-Evaluation Loop — 6 Rounds -> 35/35 PASS)**:
  - **Round 1**: Caught `moveStrip.js` import (`f94f1e9`), `renderMobileControls` TDZ (`0ea8413`), `data-action` collision + closed sheet visibility (`f00e264`).
  - **Round 2**: WebKit 10/10 PASS; Chromium M1/M4/M6/M7/M8/M9 + T1/T3/T6/T7/T8/T10/T12/T14 PASS. Fixed tablet 44 px nav buttons, height-constrained `768x1024` stack chrome, `endFx.js` coarse filters, and T2 lift-adjusted drop (`b5d7ed1`).
  - **Round 3**: Chromium M1–M9 10/10 PASS (`M8 = 0.27%`), WebKit 10/10 PASS. Visual review spotted `844x390` landscape panel clipping & `320px` `← Sảnh` wrap; fixed landscape panel fit, `endFx` continuous `pushScale` on coarse, and T9/T11 turn sync (`785b733`).
  - **Round 4**: T11 PASS (`[8, 12]`), `fx_p95` dropped to `66.7 ms`. Removed per-frame `generalEl.style.filter` and set coarse canvas DPR to `1` (`a2fa22f`).
  - **Round 5**: T13 PASS (`drag_p95=16.8ms`, `fx_p95=50ms`, `idle_raf=0`). Diagnosed T9 real touch bug (horizontal scroller swallowing chip `click`); fixed with direct `pointerup` tap in `moveStrip.js` (`64c46dd`).
  - **Round 6 (Final)**: **35/35 PASS** across Chromium M1–M9, T1–T14, and WebKit M1–M6 + WK_T1/WK_T10, 0 console errors/warnings, `M8 = 0.265%`.
  - **Visual Rubric Scores (1–5)**:
    - Round 3: R1=5, R2=5, R3=5, R4=4, R5=4, R6=5, R7=3 (landscape bottom card clipped), R8=5.
    - Round 6 (Final): **R1=5, R2=5, R3=5, R4=5, R5=5, R6=5, R7=5, R8=5** (all >= 4).

## Part A — Mobile Online Dialogs & Full Rematch Matrix (`fix/mobile-online-dialogs`)

- **Root causes fixed**:
  1. `.code-boxes` / `.code-box` lacked `min-width: 0; flex: 1 1 0; width: 100%` (default HTML `<input size="20">` inflated modal to `scrollWidth = 1480 px` on phones).
  2. `.mode-offline-actions` set `display: inline-flex` without `[hidden] { display: none !important; }`, causing "Thử lại" & "Cài đặt" to remain visible even when online server was connected.
  3. Global `--vvh` / `--app-h` viewport sync moved to `js/main.js` so all lobby/mode/online modals shrink cleanly above soft keyboards.
  4. Added `inapp_390x700` and `360x740` to `tools/mobile_lib.py`; added landscape centered-panel modal rule, clipboard fallback for LAN HTTP, and `>= 44 px` modal touch targets.
  5. Implemented full **Rematch Matrix (`a..k`)** in `server/index.js`, `js/online/onlineGameController.js`, `tests/online/rematch.test.js`, and `docs/PROTOCOL.md` (waiting + cancel, receiver banner accept/decline, opponent-left, simultaneous-press idempotency, double-tap guard, reload pending resync + TTL expiry, TC preservation, stale `gameId` rejection, and explicit leave forfeit).
- **Verification**:
  - `tools/verify_dialogs.py`: **PASS** (`checked=90, failures=0, offline_bug=0, console_errors=0`, down from 72 failures + 6 offline bugs in RED baseline).
  - `tools/verify_online_mobile.py`: **PASS** (S1..S10 + Rematch Matrix + LAN insecure context + 0 console errors).
  - `node --test`: **45/45 PASS** (including `tests/online/rematch.test.js`).
  - **Self-Eval Round 1**: **R1=5, R2=5, R3=5, R4=5, R5=5** (all >= 4).
