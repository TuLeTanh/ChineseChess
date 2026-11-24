# Xiangqi (Chinese Chess) — UI Design Spec v1

> Audience: a coding agent. Read the whole file before writing code.
> Every number below is intentional. If something is ambiguous, pick the option that looks
> closest to a premium physical wooden xiangqi set, write your choice in `docs/DECISIONS.md`, and continue.
> Scope of v1: **UI only** (board, pieces, interaction, side panel). No move-rule validation, no AI.
> Build clean extension points for those (see section 9).

---

## 1. Goal and feel

A small desktop game that feels like a **real wooden xiangqi set on a table in a quiet tea house**:
warm wood, ivory-coloured turned discs with engraved calligraphy, soft shadows, calm motion.
Not flat, not neon, not "AI-generated gradient soup". Restraint wins.

Keywords: wood grain, engraved, ivory/boxwood, ink lines, soft lamp light, tactile, calm.

## 2. Tech stack (fixed)

- Language: Rust (edition 2021 or 2024, whichever the installed toolchain supports).
- GUI: `eframe` + `egui` (latest stable on crates.io; check docs.rs before using any API, APIs change between versions).
- Vector art: **SVG strings generated in Rust** → rasterized with `resvg` (`usvg` + `tiny-skia`) → uploaded as egui textures.
  Reason: SVG gives real gradients, blur shadows and wood-grain filters (`feTurbulence`) that egui's painter cannot do.
- Fonts: embedded with `include_bytes!`, loaded both into egui and into the `fontdb` used by `usvg`.
- No other heavy dependencies. Allowed extras: `anyhow`, `log`/`env_logger`, `serde` (only if needed).
- Fallback: if resvg filters misbehave, replace the offending filter with plain gradients and note it in `docs/DECISIONS.md`. Do not abandon SVG entirely.

## 3. Project layout

```
chinese-chess/
├─ Cargo.toml
├─ DESIGN.md                 (this file)
├─ docs/DECISIONS.md         (append every non-obvious choice)
├─ assets/fonts/             (subset CJK font + LICENSE-OFL.txt)
├─ preview/                  (generated PNGs for visual self-review; git-ignored)
└─ src/
   ├─ main.rs                (CLI flags + eframe bootstrap)
   ├─ app.rs                 (egui App: layout, input routing)
   ├─ model/                 (Board, Piece, Pos, Move, FEN, undo stack)
   ├─ theme.rs               (Theme struct + presets)
   ├─ render/
   │  ├─ svg_board.rs        (board SVG generator)
   │  ├─ svg_piece.rs        (piece SVG generator)
   │  ├─ raster.rs           (SVG → RGBA → egui::ColorImage, font db setup)
   │  └─ textures.rs         (texture cache, re-raster on scale change)
   ├─ ui/
   │  ├─ board_view.rs       (draw board, pieces, overlays, hit-testing, drag)
   │  ├─ side_panel.rs       (player cards, move list, buttons)
   │  └─ anim.rs             (tween helpers, easing)
   └─ rules.rs               (trait RulesProvider + PermissiveRules)
```

Rules: files under ~400 lines, no `unwrap()`/`expect()` outside tests and `main`, `cargo fmt` and `cargo clippy -- -D warnings` must pass.
Code, comments and identifiers in English. User-visible strings in Vietnamese (see section 8).

## 4. Data model

- Board: 9 files (x = 0..8, left to right as seen by Red) × 10 ranks (y = 0..9, top to bottom). **Red starts at the bottom (y = 5..9), Black at the top (y = 0..4).**
- `Side { Red, Black }`
- `Kind { General, Advisor, Elephant, Horse, Chariot, Cannon, Soldier }`
- `Piece { kind, side }`
- `Pos { x: u8, y: u8 }`
- `Move { from, to, captured: Option<Piece> }`
- FEN (xiangqi, Red uppercase, Black lowercase; letters: k a b n r c p):
  start position = `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`
  Implement `Board::from_fen`, `Board::to_fen`, plus unit tests for the start position round-trip.
- Undo: a `Vec<Move>`; undo restores captured piece.

## 5. Board art (SVG, coordinate system = 1 cell = 100 units)

SVG `viewBox="0 0 1050 1150"`.

- Grid origin (top-left intersection) = **(125, 125)**. Intersection (i, j) → `(125 + 100·i, 125 + 100·j)`.
- Grid spans x 125…925 and y 125…1025.
- Layers, bottom to top:

1. **Table-edge/frame**: rounded rect 0,0,1050,1150 radius 28. Fill vertical gradient `#6B4226 → #4A2B17`.
   Inner bevel: 1.5 px light line `#8A5A35` along top and left inside edge, 1.5 px dark line `#2F1A0D` along bottom and right.
2. **Playing surface**: rounded rect inset 35 on all sides (x 35, y 35, w 980, h 1080), radius 14.
   - Base fill: vertical gradient `#E3B572` (0%) → `#CE9650` (50%) → `#DDAA64` (100%).
   - Wood grain overlay: same rect filled with an `feTurbulence` filter
     (`type="fractalNoise"`, `baseFrequency="0.010 0.22"`, `numOctaves="3"`, `seed="7"`),
     piped through `feColorMatrix` to brown tones (`#5A3512`-ish), blended `multiply`, overall opacity **0.28**.
     Grain must run **horizontally** (long streaks left-right).
   - Very subtle vignette: radial gradient transparent center → `#000` at 12 % opacity at the corners.
   - 1 px inner stroke `#B07A3C` opacity 0.6.
3. **Grid lines**: colour `#3B2314`, `stroke-linecap="round"`.
   - Outer border rectangle (125,125)-(925,1025): stroke width **4.5**.
   - Second thin outer rectangle offset **12** units outwards: stroke width **1.6**.
   - 10 horizontal lines (j = 0..9): full width, stroke **2.2**.
   - Vertical lines: files i = 0 and i = 8 run full height (already covered by the border).
     Files i = 1..7 are **broken at the river**: draw y 125…525 and y 625…1025 only. Stroke **2.2**.
   - Palaces (diagonals, stroke 2.2): (3,0)-(5,2), (5,0)-(3,2), (3,7)-(5,9), (5,7)-(3,9).
4. **Position marks** (cannon and soldier points): small corner ticks around the intersection.
   - Points: cannons (1,2) (7,2) (1,7) (7,7); soldiers (0,3) (2,3) (4,3) (6,3) (8,3) (0,6) (2,6) (4,6) (6,6) (8,6).
   - Each tick is an L shape: gap 9 from the intersection, arm length 20, stroke 2, same line colour.
   - For file 0 draw only the two ticks on the right side; for file 8 only the two ticks on the left side; otherwise all four.
5. **River text**: between y = 525 and y = 625 (centre y = 575).
   - `楚河` centred at x ≈ 325, `漢界` centred at x ≈ 725. Font size 54, letter-spacing 28, fill `#3B2314` opacity 0.85,
     with a 0.8 px light offset shadow `#F3D9A4` opacity 0.6 (engraved look).
   - Rotate the `漢界` group 180° around its own centre so it reads correctly for the Black player (like a real board).
6. **File labels** (outside the grid, in the 90-unit margin):
   - Bottom (Red's view): Chinese numerals `九 八 七 六 五 四 三 二 一` from left to right, centre y = 1072.
   - Top (Black's view): Arabic digits `1 2 3 4 5 6 7 8 9` from left to right, centre y = 78, rotated 180° around each label's centre.
   - Font size 30, fill `#5A3A1E`, opacity 0.8.

When the board is **flipped**, do not regenerate the SVG: rotate the whole board image 180° and swap logic coordinates; labels will naturally swap sides.
(The river text and labels are already designed to be rotation-symmetric in meaning.)

## 6. Piece art (SVG, viewBox `0 0 120 120`, disc centre (60, 56))

Displayed diameter on screen = **0.88 × cell size** (disc radius 44 in SVG ≙ that diameter).

Layers, bottom to top:

1. **Drop shadow**: ellipse centre (60, 66), rx 42, ry 40, fill `#000`, opacity 0.38, `feGaussianBlur stdDeviation="3.2"`.
2. **Thickness** (the turned side wall): circle centre (60, 61), r 44, fill vertical gradient `#B58446 → #8A5C2B`.
3. **Face**: circle centre (60, 56), r 44.
   - Fill radial gradient, focal point (42 %, 32 %), radius 75 %:
     `#FBEFD2` (0 %) → `#EFD6A3` (55 %) → `#D8B57A` (85 %) → `#C99E5B` (100 %).
   - Rim stroke 1.4, `#7A4E22`.
4. **Bevel**: circle r 42.2, stroke 2.2, fill none, linear gradient stroke from top-left `#FFF8E6` (opacity 0.9) to bottom-right `#9B6B34` (opacity 0.7).
5. **Engraved ring** (colour = side colour):
   - Main ring: circle r 35, stroke 3, fill none.
   - Inner hairline ring: circle r 31.5, stroke 1, opacity 0.6.
   - Add a 1 px light line `#FFF3D6` opacity 0.7 offset (0, +1) under the ring for the engraved look.
   - Red side colour `#B3261E`; Black side colour `#1B1A19`.
6. **Character**:
   - Centred at (60, 57), `text-anchor: middle`, font size **46**, font-weight normal, fill = side colour.
   - Engraved effect: draw the same text first in `#FFF6DF` opacity 0.75 offset (0.8, 1.3), then the real text on top.
   - Vertical optical centring: verify visually in the preview PNGs and tune the y offset until the glyph sits in the middle of the ring.
     If `dominant-baseline` is unreliable in resvg, compute a y offset instead.
7. **Gloss**: ellipse centre (50, 38), rx 26, ry 15, rotated −25°, fill linear gradient white 38 % → 0 % (top to bottom), `mix-blend-mode` not required.

Characters (traditional forms, exactly these):

| Kind | Red | Black |
|---|---|---|
| General | 帥 | 將 |
| Advisor | 仕 | 士 |
| Elephant | 相 | 象 |
| Horse | 傌 | 馬 |
| Chariot | 俥 | 車 |
| Cannon | 炮 | 砲 |
| Soldier | 兵 | 卒 |

## 7. Fonts

- Primary CJK font: **LXGW WenKai TC** (霞鶩文楷 TC) — SIL Open Font License, github.com/lxgw/LxgwWenKai-TC. Its warm calligraphic strokes suit the engraved look.
  Fallback if unavailable: **Noto Serif TC** (OFL).
- **Subset it** to keep the binary small. Needed glyphs:
  `帥仕相俥傌炮兵將士象車馬砲卒楚河漢界一二三四五六七八九` + ASCII digits and basic Latin + Vietnamese letters used in the UI.
  Use `pyftsubset` (fonttools) with `--text=...` and `--layout-features='*'`, output TTF/WOFF not needed (TTF only).
- UI (non-board) text: use egui's default proportional font for Latin/Vietnamese unless a better OFL font is bundled (Be Vietnam Pro or Inter are good; both OFL).
  The Vietnamese diacritics must render correctly — test with "Ván mới", "Đi lại", "Xoay bàn cờ", "Lượt của Đỏ".
- Include `assets/fonts/LICENSE-OFL.txt` and credit the fonts in the About text.

## 8. Window, layout and UI chrome

- Default window 1180 × 780, min 960 × 680. Title: "Cờ Tướng".
- App background: radial gradient `#2A211B` (centre) → `#14100D` (edges). Paint it each frame with a cheap pre-rendered texture or a mesh, not per-pixel code.
- Left area = board, centred, keeps aspect ratio **1050 : 1150**, uses as much space as possible with 24 px outer margin.
- Right area = side panel, fixed width **320** (scales with `pixels_per_point`).

**Side panel (top → bottom)**, panel fill `#231C17`, border `#3A2D24`, corner radius 14, inner padding 16:

1. **Black player card**: round avatar placeholder (initial letter 將 in a circle), name "Đen" (editable later), clock "10:00" (static placeholder), captured-pieces tray (miniature Red pieces taken by Black, scaled 0.42, overlapping 40 %).
2. **Move list**: scroll area, two columns (Đỏ / Đen), rows numbered, move text in ICCS-like form `h2e2` for v1 (file letter a–i left→right from Red's view, rank digit 0–9 bottom→top from Red's view). Newest row auto-scrolls into view; current row highlighted gold.
3. **Red player card**: same as above for "Đỏ" with captured Black pieces. Active-turn card gets a 2 px gold outline `#D9A441` with soft glow.
4. **Buttons row** (pill buttons, height 40, fill `#3A2D24`, hover `#4A382C`, text `#EADBC4`): `Ván mới`, `Đi lại`, `Xoay bàn`, `Giao diện`.

Colours for UI chrome: text `#EADBC4`, muted `#9C8A74`, accent gold `#D9A441`, danger `#C0392B`.

## 9. Extension points (design now, implement trivially)

```rust
pub trait RulesProvider {
    fn legal_moves(&self, board: &Board, from: Pos) -> Vec<Pos>;
    fn is_in_check(&self, board: &Board, side: Side) -> bool { false }
    fn status(&self, board: &Board, side_to_move: Side) -> GameStatus { GameStatus::Playing }
}
pub struct PermissiveRules; // v1: every square not occupied by own piece is "legal"
```

- The UI must only ask `RulesProvider` for legality. In v1 with `PermissiveRules`, **do not draw legal-move dots** (too noisy); draw them only if the provider returns fewer than 20 targets. This way a real rules engine plugs in later with zero UI changes.
- Add `trait Engine { fn best_move(&mut self, fen: &str, think_ms: u64) -> Option<String>; }` as an empty stub file only (for UCI/Pikafish/PikaRust later). Do not implement.

## 10. Interaction

Input model: both **click-click** and **drag-and-drop** must work.

- Hit-test: nearest intersection within **0.48 × cell** of the pointer.
- **Hover**: when hovering an intersection (and no drag), draw a soft circle radius 0.5 cell, fill `#FFFFFF` opacity 0.08; cursor = pointing hand over any piece, default otherwise.
- **Select**: click a piece of the side to move (v1: turns alternate Red first; add a setting "Cho phép đi tự do" that disables turn enforcement, default **on** for testing).
  - Piece lifts: scale 1.07, shadow grows (offset 5, blur ×1.4) over 90 ms.
  - Gold selection ring around the piece: radius 0.54 cell, stroke 2.5, `#F2C14E`, slight outer glow (draw 3 concentric rings with falling opacity).
- **Move**: click an empty intersection or an enemy piece (when `legal_moves` allows it).
  - Animation: ease-out cubic, **200 ms**, piece slides in a straight line and keeps its lifted look until it lands, then "settles" (scale 1.07 → 1.0 in 70 ms).
  - Capture: captured piece scales to 0.7 and fades out over 150 ms, then appears in the captured tray with a 120 ms fade-in.
- **Drag**: press on a piece, move beyond 4 px → drag starts. The piece follows the pointer, lifted (scale 1.1). Show the target intersection with a gold square-bracket marker (see below) when the pointer is within hit range.
  - Release on a valid target → perform move (animate from the release point). Otherwise spring back to origin in 160 ms.
- **Last-move marker**: on both the from-intersection and the to-intersection draw four gold corner brackets (arm 16, gap 38 from centre, stroke 2.5, `#D9A441` opacity 0.9). The from-intersection one is dimmer (opacity 0.5).
- **Check hint (hook)**: if `is_in_check` is true, the king gets a pulsing red glow (opacity 0.25 ↔ 0.6, period 1.2 s).
- **Flip**: `Xoay bàn` rotates the view 180° with a 350 ms ease-in-out rotation of the board layer; piece glyphs stay upright (never upside-down).
- **Undo**: `Đi lại` pops the last move, animates the piece back (160 ms) and restores any captured piece with a fade-in.
- **New game**: confirm via a small modal when moves exist; resets FEN, clears history.
- Keyboard: `Ctrl+Z` undo, `N` new game, `F` flip, `Esc` cancel selection/drag.

## 11. Rendering performance rules

- Rasterize board once at **2 × display size** (cap at 3072 px on the long edge); pieces at 2 × display piece size (min 128 px).
  Re-rasterize only if the effective size changes by more than 25 % (debounce 150 ms). Use linear filtering.
- Never rasterize per frame. Cache textures in a struct keyed by (theme, size bucket).
- `ctx.request_repaint()` only while animations or hover effects are active; idle CPU should be near zero.
- Target 60 fps on a mid laptop; resizing the window must not stutter noticeably.

## 12. Themes

`Theme` struct holds all colours and gradient stops used in sections 5, 6, 8 so that presets can swap without code changes elsewhere.

- **Preset 1 — "Gỗ Lim" (classic wood)**: everything above. Default.
- **Preset 2 — "Ngọc Bích" (modern jade)** (implement in the polish phase):
  - Board surface: deep slate-teal `#1F3B36 → #2B5148`, fine noise grain (opacity 0.12), frame `#12231F`, lines `#A9C8BC`.
  - Red pieces: lacquered red face `#B3261E → #7D1812`, gold character `#F6D88B`, ring `#F6D88B`.
  - Black pieces: ebony face `#2A3033 → #14191B`, ivory character `#EDEBE4`, ring `#EDEBE4`.
  - Same geometry and layers as preset 1.
- Switching theme re-rasterizes textures and cross-fades 200 ms.

## 13. Dev tooling the agent must build (so it can *see* its own work)

Because the SVG pipeline is headless, add CLI flags to `main.rs`:

- `cargo run -- --export-preview` → writes into `preview/`:
  - `board.png` (full board at 1050 × 1150),
  - `pieces_sheet.png` (all 14 pieces in a 7 × 2 grid on a neutral `#CFC7BA` background, each 240 px),
  - `pieces_small.png` (same pieces at 88 px to check legibility at real size),
  - `start_position.png` (board + all pieces placed by the start FEN, composited without a window),
  then exits with code 0.
- `cargo run -- --gallery` → opens the window directly on a page showing the 14 pieces in a grid at 3 sizes.

**After every visual change, run `--export-preview`, open the PNGs, and compare against the checklist in section 14. Fix and repeat until all items pass.**

## 14. Visual acceptance checklist (self-review)

Board:
- [ ] Wood grain is visible but gentle, horizontal streaks, no tiling seams, no banding.
- [ ] Lines are crisp, same colour, river gaps correct on files 1–7, palace diagonals correct.
- [ ] Cannon/soldier tick marks present, edge files only have inward ticks.
- [ ] River text 楚河 / 漢界 readable, engraved look, 漢界 rotated 180°.
- [ ] File labels correct (九…一 bottom, 1…9 top rotated).

Pieces:
- [ ] All 14 pieces visibly 3-D: shadow, thickness, bevel, gloss. No harsh black outlines.
- [ ] Character is perfectly centred inside the ring, crisp at 88 px, not clipped.
- [ ] Red vs Black distinguishable in under half a second at 88 px.
- [ ] Characters match the table in section 6 exactly (傌 not 馬 for Red, 俥 not 車 for Red, 炮/砲 correct).

Start position:
- [ ] Matches the FEN (Red at bottom, 帥 on file 五 / x = 4, y = 9; 將 at x = 4, y = 0).
- [ ] Pieces sit exactly on intersections with a small visible gap between neighbours.

UI:
- [ ] No text overflow in side panel; Vietnamese diacritics render.
- [ ] Idle CPU near zero; animations smooth.
- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` all pass.

## 15. Out of scope for v1 (do NOT build)

Rule validation, AI/engine, online play, sound, settings persistence, replay files, mobile/web builds.
Leave clean seams (section 9) and stop.
