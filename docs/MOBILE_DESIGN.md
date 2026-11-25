# Mobile & Touch Design Map (`docs/MOBILE_DESIGN.md`)

> Phase A audit & mapping for Upgrade Pass 2 (Mobile / Touch).
> Updated as implementation progresses.

---

## (a) Role-to-Selector / File Map

| Role in Design | Current Selector(s) / ID(s) | Owning File(s) | Notes for Mobile / Touch |
|---|---|---|---|
| **App root / Game shell** | `#app.app-shell.game-shell` | `index.html`, `js/screens/gameScreen.js`, `js/screens/replayScreen.js`, `css/style.css` | Currently `display: flex; min-width: 960px; min-height: 680px; width: 100vw; height: 100vh;`. Will switch to `data-layout="desktop\|side\|stack"` with CSS Grid named areas on `stack`/`side`, leaving `desktop` untouched. |
| **Top bar** | `.game-top-nav`, `[data-nav="lobby"]`, `[data-nav="settings"]`, `.replay-mode-pill` | `js/screens/gameScreen.js`, `js/screens/replayScreen.js` | Currently floating `position: absolute; top: 14px; left: 16px` inside `#board-stage`. In `stack`: dedicated grid row 1 (`height: calc(44px + var(--sat))`), with `← Sảnh`, centered title chip (`data-testid="top-mode-chip"`), `💾` save/export (`data-testid="top-save-btn"`), and `⚙`. In `side`: compact top row inside panel. |
| **Opponent strip** | `.player-card-black` (when Red at bottom) or `.player-card-red` (when flipped) | `js/ui/sidePanel.js`, `js/online/onlineGameController.js` | Both `.player-card-black` and `.player-card-red` live inside `#side-panel`. Using `display: contents` on `#side-panel` in `stack`, we place opponent card in grid area `opp` and player card in grid area `me` (swapped via CSS class `is-flipped` on `.game-shell` without DOM re-parenting!). |
| **Player strip** | `.player-card-red` (default) or `.player-card-black` (when flipped), `.player-clock`, `.captured-tray` | `js/ui/sidePanel.js`, `js/online/onlineGameController.js` | Active side gets `.is-active` gold outline. In `stack`, also displays the compact one-line status/check text (`aria-live="polite"`). |
| **Board** | `#board-stage`, `.game-board-host`, `.board-wrapper`, `svg.board-svg` | `js/ui/boardView.js`, `js/render/boardSvg.js` | Aspect `1050 / 1150`. Compact viewBox applied when rendered width `< 480px`: grid spans `125..925` × `125..1025`, piece disc radius `44`, plus margin `8` => `viewBox="73 73 904 1004"` (hides `.board-layer-labels`, thin 2px frame border, preserves piece/river legibility and zero clipping). |
| **Move strip (new, stack only)** | `[data-testid="move-strip"]`, `[data-testid="sheet-open-btn"]` | `js/ui/moveStrip.js` (new) | Single horizontal scrollable row of flat move chips + `⌃` button (44×44) in `stack` layout; auto-scrolls to viewed ply, fade masks at ends, subscribes to board/review updates. |
| **Controls bar** | `.controls-grid`, `.ai-actions-row`, `.online-actions-row`, `.archive-actions-bar`, `[data-testid="mobile-controls"]` | `js/ui/sidePanel.js`, `js/screens/gameScreen.js`, `js/online/onlineGameController.js`, `js/screens/replayScreen.js` | Desktop keeps `.controls-grid` + `.ai-actions-row` / `.online-actions-row` untouched. In `stack` / `side`, a dedicated thumb-reachable controls bar (`data-testid="mobile-controls"`) delegates clicks to the exact same controller callbacks (and keeps existing `[data-action="..."]` buttons inside the sheet/panel intact). |
| **Bottom sheet (new, stack only)** | `[data-testid="bottom-sheet"]`, `[data-testid="sheet-handle"]`, `[data-testid="sheet-backdrop"]`, `[data-testid="sheet-tabs"]` | `js/ui/bottomSheet.js` (new) | States `closed \| half \| full`. Hosts the existing `.move-list-section`, `.jieqi-pool-panel`, and options controls (`.mode-bar`, `.status-block`, `.controls-grid`, `.audio-bar`, `.side-export-row`) via CSS/mount placement — never duplicating state. |
| **Status line** | `.status-block`, `.turn-indicator`, `.turn-label`, `.result-banner`, `[data-testid="strip-status"]` | `js/ui/sidePanel.js` | In `stack`, mirrored into the player strip one-line status slot with `aria-live="polite"`. |
| **Result card** | `.modal-gameover`, `#gameover-title`, `#online-go-title`, `.modal-review`, `.modal-export`, `.modal-new-game` | `js/ui/sidePanel.js`, `js/online/onlineGameController.js` | In `stack` / `<600px`: `max-width: 92vw`, `max-height: 80dvh`, stacked 48px buttons, positioned over the board area without covering the bottom controls bar. |
| **Toast & Voice caption** | `.board-toast`, `.board-capture-caption`, `.online-draw-toast` | `js/ui/boardView.js`, `js/online/onlineGameController.js` | Sized relative to board width (`max-width: calc(100% - 16px)`), stacked below `.online-disconnect-banner` without overlap. |
| **Banners** | `.review-banner`, `[data-review="live"]`, `[data-review="continue"]`, `.online-disconnect-banner`, `.storage-status-banner` | `js/ui/boardView.js`, `js/online/onlineGameController.js`, `js/main.js` | Stacked cleanly above board / move strip without overlapping controls bar or player strips. |
| **Modals** | `#modal-root`, `.modal-backdrop`, `.modal-card`, `.settings-modal`, `.setup-modal`, `.import-modal` | `js/ui/settingsModal.js`, `js/ui/saveModals.js`, `js/online/onlineModals.js`, `js/screens/modeScreen.js` | On `stack` or width `< 600px`: bottom-sheet style (`width: 100%`, `max-height: calc(var(--vvh) - 16px)`, rounded top corners, internal scroll, safe-area padding, 48px stacked buttons when > 2, horizontal scrollable settings tabs). |
| **Cinematics** | `.fx-overlay`, `.fx-canvas`, `.fx-svg`, `.fx-skip-btn` | `js/fx/endFx.js`, `js/fx/particles.js` | Already mounted inside `.board-wrapper`, which matches the board rect; will cap coarse-pointer particles at 50%, DPR at 2, scale shake amplitude with board width, and ensure tap-to-skip works on touch. |

---

## (b) Current Pointer-Event Flow in `js/ui/boardView.js`

1. **Mount (`_mount`)**:
   - Registers 5 listeners on `this.svg`: `pointerdown`, `pointermove`, `pointerup`, `pointercancel` (bound to `_onPointerUp`), and `pointerleave`.
   - No `lostpointercapture` handler, no `contextmenu` prevention, no `touch-action: none`.
   - `clientToBoard(clientX, clientY)` maps client coords using `BOARD_WIDTH / rect.width` and `BOARD_HEIGHT / rect.height` (assumes `viewBox="0 0 1050 1150"` — must be updated to use the active viewBox `vx, vy, vw, vh` when compact viewBox is active!).
   - `hitTest(bx, by)` rounds to nearest `(rawX, rawY)` in `0..8 × 0..9`, checks `Math.hypot <= 0.48 * CELL_SIZE`, and flips if `this.flipped`.

2. **Pointer Down (`_onPointerDown`)**:
   - Ignores `ev.button !== 0 || this.locked || this.reviewActive`.
   - Does NOT filter non-primary pointers (`!ev.isPrimary`) or ignore second fingers while a drag is active.
   - Calls `clientToBoard` + `hitTest`. If `!pos`, calls `clearSelection()`.
   - If `this.selected` is already set and `pos` is a legal target (and not same square):
     - If clicking own piece (in practice mode), switches selection.
     - Otherwise executes move (`onInterceptMove` for online, else `_performMove(selected, pos, null, false)`).
   - Else if `_canSelect(pos)`:
     - Calls `this.svg.setPointerCapture(ev.pointerId)` and `this.onSelectPiece(pos)`.
     - Initializes `this.drag = { pointerId, from, piece, startClientX, startClientY, currentBoard, active: false, wasSelected, el: null, hoverTarget: null }`.
     - If `!wasSelected`, calls `_selectPos(pos)` (sets `selected`, computes `legalTargets`, starts 90 ms lift tween).
   - Else if `this.selected`: calls `this.onIllegalMove()`.

3. **Pointer Move (`_onPointerMove`)**:
   - If `this.drag && ev.pointerId === this.drag.pointerId`:
     - Computes `dist = hypot(dx, dy)`. Once `dist > 4` (`DRAG_THRESHOLD_PX`), sets `drag.active = true`, hides origin piece via `hiddenKeys`, creates dragged `<g>` in `layerDrag` at scale `1.1`.
     - Updates `<g>` transform directly at raw pointer `pt` (no lift offset, no clamping, no snapped gold target ring — uses corner brackets via `hitTest`).
   - Otherwise updates `this.hovered` and cursor.

4. **Pointer Up / Cancel (`_onPointerUp`)**:
   - Ignores if `!this.drag || ev.pointerId !== this.drag.pointerId`.
   - Releases pointer capture, clears `this.drag`.
   - Note: `pointercancel` currently routes to `_onPointerUp` — if a drag is cancelled over a legal square, it would erroneously *execute* the move instead of cancelling and springing back! Must split `_onPointerCancel` / `lostpointercapture` to always spring back cleanly.
   - If `!drag.active`: if `drag.wasSelected`, clears selection; returns.
   - If `drag.active`: removes `drag.el`, checks `hitTest(pt)` against `legalTargets`:
     - Legal: deletes `originKey`, calls `onInterceptMove` or `_performMove(drag.from, target, pt, true)` (90 ms slide from `pt`).
     - Illegal / outside: triggers `onIllegalMove()` if dropped elsewhere, springs back over 160 ms + 140 ms 2-cycle shake.

---

## (c) CSS Rules Blocking Small Screens (`css/style.css`)

| Line(s) | Selector / Rule | Problem on Mobile / Small Screens | Fix Strategy |
|---|---|---|---|
| `28–39` | `html, body { width: 100%; height: 100%; overflow: hidden; }` | Uses `100%` / `100vh`, lacks `overscroll-behavior: none`, `-webkit-text-size-adjust: 100%`, `-webkit-tap-highlight-color: transparent`. | Keep desktop untouched; set `100dvh` / `var(--app-h)` and `overscroll-behavior: none` on `.game-shell[data-layout="stack"], .game-shell[data-layout="side"]`. |
| `41–49` | `.app-shell { width: 100vw; height: 100vh; min-width: 960px; min-height: 680px; }` | **Primary blocker**: forces horizontal overflow (`scrollWidth >= 960`) on all phones & portrait tablets and uses `100vh` (clips behind mobile address bar). | Remove `min-width: 960px; min-height: 680px` for `[data-layout="stack"]` and `[data-layout="side"]`, use `position: fixed; inset: 0; width: 100%; height: var(--app-h, 100dvh);`. |
| `51–61` | `.board-stage { padding: 24px; }` | Wastes 48px horizontally on narrow phones (`320px` / `360px`). | Set `padding: 0` in `stack` layout and `4px` vertical padding in `side` layout. |
| `85–97` | `.side-panel { flex: 0 0 320px; width: 320px; margin: 24px 24px 24px 0; }` | Fixed 320px column beside board doesn't fit portrait phones. | In `stack`: `display: contents` so children map to CSS Grid named areas / sheet. In `side`: dynamic width `clamp(280px, ..., 340px)` with compact padding/margins. |
| `463–470` | `.modal-card { width: 340px; }` | Fixed `340px` overflows `320px` screens! | On `< 600px` / `stack`: convert `.modal-card` to bottom-sheet (`width: 100%; max-width: 100%; max-height: calc(var(--vvh) - 16px); border-radius: 16px 16px 0 0`). |
| `1608–1617` | `.lobby-shell { width: 100vw; height: 100vh; }` | `100vh` clips behind mobile browser chrome; `100vw` can cause horizontal scroll if scrollbar appears. | Use `width: 100%; height: var(--app-h, 100dvh); min-height: var(--app-h, 100dvh); overscroll-behavior: contain;`. |
| `1951` | `.lobby-cards { grid-template-columns: repeat(2, minmax(280px, 370px)); }` | Already has `@media (max-width: 899px)` -> `1fr`, good; verify 320px padding/font sizes. | Check 320px overflow and tap targets `>= 44px`. |
| `2221–2254` | `.settings-modal { max-height: 86vh; }`, `.settings-tabs` | Uses `vh`, small tap targets on mobile. | On `< 600px` / `stack`: bottom sheet with `max-height: calc(var(--vvh) - 16px)`, scrollable top tab bar, 44px tab hit targets. |
| `2299–2308` | `.set-input { font-size: 13.5px; }`, `.set-textarea { font-size: 12px; }` | `< 16px` triggers iOS Safari auto-zoom on focus (fails M5). | Set `font-size: 16px` on inputs/textareas/selects on coarse/small screens (or globally on mobile layouts). |
| `565–578`, `1314–1328`, `1588–1601` | `.icon-btn` (34×34), `.rev-btn` (30×26), `.game-nav-btn` (h=32), `.pill-btn` (h=40), `.mini-seg-btn` (h=26) | Below 44×44 CSS px touch hit-area requirement (M3). | On `stack`/`side` (or coarse pointers), enlarge hit areas to `>= 44×44` CSS px while keeping desktop unchanged. |

---

## (d) Selectors Used by Existing Tests & Preservation Rule

**Rule**: Keep EVERY existing selector, class name, ID, and `data-*` attribute intact and working in desktop mode. Add `data-testid="..."` attributes for all new mobile/touch elements.

Key existing selectors verified across `tools/verify*.py` (12 scripts):
- Board & pieces: `svg.board-svg`, `.board-wrapper`, `g.layer-board-base`, `.layer-pieces > g`, `g.layer-drag > g`, `g.layer-selection path`, `.legal-move-dot`, `.legal-capture-ring`, `.legal-reveal-q`, `.hint-arrow`, `.check-pulse`
- Banners & toasts: `.review-banner`, `.review-banner-text`, `.review-new-badge`, `[data-review="live"]`, `[data-review="continue"]`, `.board-toast.is-visible .toast-glyph`, `.online-disconnect-banner:not([hidden])`, `.online-draw-toast:not([hidden])`, `.storage-status-banner:not([hidden])`
- Side panel & review: `.player-card-red`, `.player-card-black`, `.ai-level-select`, `.ai-thinking-label`, `.free-move-checkbox`, `.jieqi-pool-panel`, `.move-list-scroll`, `.move-list-scroll-wrap`, `.move-row`, `.move-chip[data-ply="..."]`, `.move-timeline`, `[data-rev="prev"]`, `[data-rev="next"]`, `[data-rev="play"]`, `.rev-new-dot`, `[data-tray="black"] svg.captured-mini`
- Action buttons: `[data-action="new"]`, `[data-action="undo"]`, `[data-action="flip"]`, `[data-action="theme"]`, `[data-action="hint"]`, `[data-action="resign"]`, `[data-action="save-export"]`, `[data-online-act="draw"]`, `[data-online-act="resign"]`
- Modals & screens: `#gameover-title`, `#online-go-title`, `.modal-gameover`, `.modal-review`, `.modal-confirm`, `.modal-resign-confirm`, `.modal-truncate-confirm`, `.settings-modal`, `.settings-tab`, `.settings-close`, `#set-nickname`, `.import-modal`, `#imp-file-input`, `#imp-text-area`, `#imp-fen-input`, `.lib-item`, `.lib-search`, `.replay-mode-pill`, `.fx-overlay`, `.fx-canvas`, `.fx-skip-btn`

---

## (e) Potential Friction Points & Smallest Adaptations

1. **No DOM re-parenting for the Bottom Sheet vs Desktop Side Panel**:
   - *Challenge*: In `desktop` and `side`, `.move-list-section`, `.jieqi-pool-panel`, `.mode-bar`, `.audio-bar`, etc. are vertical children of `#side-panel`. In `stack`, the player cards go to grid rows `opp` and `me`, while `.move-list-section`, `.jieqi-pool-panel`, and options live inside the interactive Bottom Sheet.
   - *Smallest adaptation*: Keep a single `.sheet-host` wrapper inside `#side-panel` created at mount time, containing the sheet handle, tab bar, and the existing `.move-list-section`, `.jieqi-pool-panel`, and `.sheet-options-group` (which wraps `.mode-bar`, `.status-block`, `.controls-grid`, `.side-export-row`, `.audio-bar`).
     - In `desktop` and `side`: `.sheet-host` uses `display: contents` (and the sheet handle/tabs/backdrop are `display: none`), so every child lays out identically to today's flex column inside `#side-panel` with zero DOM moves and zero desktop pixel diff!
     - In `stack`: `#side-panel` uses `display: contents` so `.player-card-black` and `.player-card-red` become direct grid items (`grid-area: opp` / `grid-area: me`), while `.sheet-host` becomes `position: fixed` bottom sheet driven by `js/ui/bottomSheet.js`.
     - Zero DOM re-parenting when resizing/rotating between `desktop`, `side`, and `stack`!

2. **Compact Board `viewBox` vs `clientToBoard()` and `endFx.js`**:
   - *Challenge*: `boardView.js` assumes `BOARD_WIDTH = 1050, BOARD_HEIGHT = 1150` starting at `(0, 0)`. When board width `< 480px`, we crop the `viewBox` to `73 73 904 1004` (outermost intersection `125` minus disc radius `44` minus margin `8` = `73`; width = `925 + 44 + 8 - 73 = 904`; height = `1025 + 44 + 8 - 73 = 1004`).
   - *Smallest adaptation*: Store `this.viewBox = { x: 0, y: 0, w: 1050, h: 1150 }` (or `{ x: 73, y: 73, w: 904, h: 1004 }` in compact mode) on `BoardView`. Update `clientToBoard()` to map using `viewBox.x + (clientX - rect.left) * (viewBox.w / rect.width)`. Also update `endFx.js` to sync `.fx-svg` `viewBox` or scale cleanly inside `.board-wrapper` so swords/titles stay framed inside the board rect.

3. **Result Card Over Board Without Covering Controls Bar**:
   - *Challenge*: `sidePanel.showGameOverModal()` currently renders into `#modal-root` (full-screen `position: fixed; inset: 0`).
   - *Smallest adaptation*: Add `.modal-backdrop.is-gameover-backdrop` on the game-over modal; in `stack` layout, give it `bottom: calc(var(--controls-h, 52px) + var(--sab, 0px))` so the result card centers over the board and NEVER covers the controls bar, while desktop keeps full-screen backdrop centering unchanged.
