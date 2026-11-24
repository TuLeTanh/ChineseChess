# Bộ prompt cho agent (Antigravity) — Cờ Tướng UI bằng Rust

## Cách dùng

1. Tạo thư mục project `Chinese Chess`, copy file **DESIGN.md** vào thư mục gốc (agent sẽ đọc file này làm "kinh thánh").
2. Dán **Prompt 0** vào agent một lần để nó nắm bối cảnh và luật làm việc.
3. Dán lần lượt **Prompt 1 → 5**. Mỗi bước xong, bạn chạy thử `cargo run` (hoặc mở ảnh trong `preview/`) rồi mới sang bước tiếp.
4. Nếu agent làm lệch, dùng **Prompt sửa lỗi** ở cuối.

Prompt viết bằng tiếng Anh vì agent code ổn định hơn; phần giải thích của mình bằng tiếng Việt. Bạn có thể sửa nội dung thoải mái.

---

## Prompt 0 — Bối cảnh và luật làm việc (dán đầu tiên)

```text
You are a senior Rust + UI engineer. We are building a desktop Xiangqi (Chinese chess) game.
This session is about the UI ONLY: a beautiful board, beautiful pieces, smooth interaction, a side panel.
No rule validation and no AI in this phase.

Before doing anything:
1. Read DESIGN.md in the project root completely. It is the single source of truth for visuals,
   geometry, colours, animation timings, file layout and acceptance checklist.
2. Do not start coding until you have written a short plan (max 15 lines) in docs/DECISIONS.md.

Working rules:
- Language: Rust. GUI: eframe/egui. Art: SVG generated in Rust, rasterized with resvg. See DESIGN.md section 2.
- Check the latest stable versions of crates on crates.io and read their docs on docs.rs before using an API.
  Never guess an API from memory; compile early and often (cargo check after every small step).
- Keep files under ~400 lines, no unwrap()/expect() outside tests and main.
- cargo fmt and cargo clippy -- -D warnings must pass before you say "done" on any step.
- Do not add features that are not in DESIGN.md. If you want to deviate, write the reason in docs/DECISIONS.md first.
- You must be able to SEE your result: implement the --export-preview tool from DESIGN.md section 13 as early as
  possible and review the generated PNGs against the checklist in section 14 after each visual change.
- At the end of each step, reply with: what you built, files touched, how I can run/see it, and any open issues.
  Keep the reply short.

Confirm you understood by replying only with: the 5 biggest risks you see in DESIGN.md and how you will handle each.
Do not write code yet.
```

---

## Prompt 1 — Khung dự án và pipeline vẽ SVG → texture

```text
Step 1: Project scaffold and the rendering pipeline.

Do:
1. cargo init the project (binary crate), add dependencies (eframe, egui, resvg, anyhow, log, env_logger).
   Use the latest stable versions and make sure it compiles on Windows.
2. Create the folder layout from DESIGN.md section 3 (empty modules are fine, but they must compile).
3. Fonts (DESIGN.md section 7): download LXGW WenKai TC (fallback Noto Serif TC), subset it with pyftsubset to the needed glyphs,
   put the result in assets/fonts/ with the OFL license file. Embed with include_bytes!.
   If you cannot download, tell me exactly which file to place where and continue with a temporary system font.
4. render/raster.rs: build a usvg Options with a fontdb that contains the embedded font; function
   rasterize(svg: &str, width_px: u32, height_px: u32) -> egui::ColorImage. Make sure premultiplied alpha is handled correctly
   (tiny-skia gives premultiplied RGBA; convert properly for egui).
5. theme.rs: Theme struct with every colour/gradient stop used in DESIGN.md sections 5, 6, 8 and the "Gỗ Lim" preset.
6. render/svg_board.rs: generate the board SVG exactly as DESIGN.md section 5 describes (all 6 layers, correct geometry).
7. main.rs: implement --export-preview for now producing preview/board.png only. Add preview/ to .gitignore.
8. app.rs: open the window, draw the dark background and the board texture centred with the correct aspect ratio and margins.

Then run --export-preview, open preview/board.png, and review it item by item against the "Board" part of DESIGN.md section 14.
Fix everything that fails. Report which items you had to iterate on.

Do NOT draw pieces yet.
```

**Bạn kiểm tra:** `cargo run` thấy bàn cờ gỗ có đường kẻ, sông, nhãn số. Mở `preview/board.png` xem vân gỗ.

---

## Prompt 2 — Vẽ 14 quân cờ thật đẹp

```text
Step 2: The pieces. This is the most important visual step, take your time.

Do:
1. render/svg_piece.rs: function piece_svg(kind, side, theme) -> String following DESIGN.md section 6 layer by layer
   (shadow, thickness, face, bevel, engraved rings, engraved character, gloss). Use exactly the characters from the table.
2. render/textures.rs: texture cache for 14 piece textures (+ board), keyed by (theme, size bucket), re-rasterizing rules from section 11.
3. Extend --export-preview to produce pieces_sheet.png, pieces_small.png as specified in section 13.
4. Add --gallery to open a window showing the 14 pieces at 3 sizes (64, 88, 140 px) on the board-wood colour and on a neutral grey.

Review loop (mandatory): after generating the PNGs, critique them yourself as if you were an art director:
- Is the character centred in the ring? Is the stroke weight of the glyph consistent across pieces?
- Does it look like a turned wooden/ivory disc, or like a flat sticker?
- Is the red/black difference obvious at 88 px?
- Is the gloss too strong or too weak? Is the shadow too hard?
Write 5 concrete improvements, apply them, re-export, and compare. Do this at least 2 rounds.
Stay within the palette in DESIGN.md; tune only opacity, offsets and blur amounts within ±30 %.

Deliver: the two PNGs and a short note on what you tuned.
```

**Bạn kiểm tra:** mở `preview/pieces_sheet.png`. Quân phải trông như viên cờ gỗ/ngà có khắc chữ, không phẳng như sticker.

---

## Prompt 3 — Dữ liệu bàn cờ, vị trí xuất phát, tương tác kéo thả

```text
Step 3: Model + board view + interaction (still no rules).

Do:
1. model/: Side, Kind, Piece, Pos, Move, Board with from_fen/to_fen, start position FEN from DESIGN.md section 4,
   move apply/undo stack. Write unit tests (start FEN round-trip, apply + undo restores the exact board including captures).
2. rules.rs: RulesProvider trait and PermissiveRules exactly as DESIGN.md section 9. Add an empty engine.rs stub with the Engine trait only.
3. ui/anim.rs: small tween helper + easing (ease-out cubic, ease-in-out). No external animation crate.
4. ui/board_view.rs:
   - map between logical (x, y) and screen position, supporting the flipped view,
   - draw the pieces from textures at the correct size (0.88 × cell) on the intersections,
   - hit-testing (0.48 × cell),
   - hover circle, selection (lift + gold ring), click-click moves, drag-and-drop with spring-back, slide animation, capture fade,
   - last-move corner brackets,
   - keyboard shortcuts (Ctrl+Z, N, F, Esc).
   All timings and numbers come from DESIGN.md section 10.
5. Extend --export-preview with start_position.png (board + pieces from the start FEN, no window needed).

Verify with start_position.png against the "Start position" checklist. Then run the app and test by hand:
move a piece by click-click, by drag, capture one, undo it, flip the board. Fix any glitch (flicker, wrong z-order while dragging,
dragged piece must be drawn above all others, pieces must never appear upside-down when flipped).

Idle CPU must be near zero: only request_repaint while something is animating.
```

---

## Prompt 4 — Side panel, chrome và hoàn thiện giao diện

```text
Step 4: Side panel and polish.

Do:
1. ui/side_panel.rs following DESIGN.md section 8: black player card, move list (ICCS-like text, newest row highlighted and auto-scrolled),
   red player card with active-turn gold outline, captured-pieces trays (miniature pieces reusing the cached textures),
   and the buttons row (Ván mới, Đi lại, Xoay bàn, Giao diện).
2. Hook everything to the game state: after each move update the move list, the captured trays, and the active card.
3. Modal confirm for "Ván mới" when there are moves.
4. Vietnamese strings must render with correct diacritics. Test: "Ván mới", "Đi lại", "Xoay bàn cờ", "Lượt của Đỏ".
5. Second theme "Ngọc Bích" from DESIGN.md section 12 + the "Giao diện" button to switch with a 200 ms cross-fade.
6. Window defaults and minimum size from section 8. Make sure resizing the window keeps the board crisp (re-raster rules in section 11)
   and the layout never overlaps.
7. HiDPI check: set pixels_per_point to 1.0, 1.5 and 2.0 via an env var (e.g. XQ_SCALE) and confirm the art stays sharp.

Then do a final art-director pass over start_position.png for BOTH themes and fix what looks off.
```

---

## Prompt 5 — Kiểm tra cuối và bàn giao

```text
Step 5: Final verification and handoff.

1. Run cargo fmt --check, cargo clippy -- -D warnings, cargo test, cargo build --release. Fix everything.
2. Go through the full checklist in DESIGN.md section 14 and reply with a table: item | pass/fail | note. Fix every fail.
3. Profile quickly: confirm idle CPU is near zero and dragging/animation stay smooth at 1180x780 and when maximized.
4. Write README.md (Vietnamese): how to build/run, CLI flags, keyboard shortcuts, project structure, font credits and licenses.
5. Update docs/DECISIONS.md with the final list of deviations from DESIGN.md.
6. Add a section "Next steps" listing exactly where to plug in:
   (a) a real RulesProvider (move generation, check detection),
   (b) an Engine implementation over UCI (Pikafish/PikaRust),
   (c) sound effects.
Do not implement (a)-(c).
```

---

## Prompt sửa lỗi (dùng khi cần chỉnh)

```text
The result does not match DESIGN.md in these points:
- <liệt kê cụ thể, ví dụ: "chữ trên quân bị lệch xuống dưới khoảng 4px", "vân gỗ quá đậm", "quân bị tối khi kéo">

Re-read the related sections of DESIGN.md, fix only these points, regenerate the preview PNGs, and show me a before/after comparison
description. Do not refactor unrelated code.
```

## Prompt tinh chỉnh phong cách (tùy chọn)

```text
Keep the geometry and layout, but push the look toward: <chọn 1: "ván cờ gỗ cổ, ố vàng nhẹ, đường kẻ mực nho" / "hiện đại tối giản, quân mờ nhám matte" / "quân gỗ mun và gỗ hoàng đàn">.
Only change the Theme values and the SVG gradient/filter parameters. Export previews and compare before/after.
```
