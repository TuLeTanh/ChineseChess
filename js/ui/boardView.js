import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  CELL_SIZE,
  buildBoardInnerSvg,
} from '../render/boardSvg.js';
import { buildPieceSymbolsDefs, pieceSymbolId } from '../render/pieceSvg.js';
import { samePos } from '../model/moves.js';
import { RED, BLACK } from '../model/piece.js';
import { Animator, easeOutCubic, easeInOutCubic, lerp } from './anim.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOARD_CX = BOARD_WIDTH / 2;
const BOARD_CY = BOARD_HEIGHT / 2;
const PIECE_SYMBOL_SIZE = 120; // Disc r=44 => diameter 88 = 0.88 * CELL_SIZE
const PIECE_ANCHOR_X = 60;
const PIECE_ANCHOR_Y = 56;
const HIT_RADIUS = 0.48 * CELL_SIZE;
const DRAG_THRESHOLD_PX = 4;

/**
 * Create an SVG element with attributes.
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Build SVG path data for 4 corner brackets around (cx, cy).
 * @param {number} cx
 * @param {number} cy
 * @param {number} [gap]
 * @param {number} [arm]
 * @returns {string}
 */
function cornerBracketsPath(cx, cy, gap = 38, arm = 16) {
  return [
    `M ${cx - gap} ${cy - gap + arm} V ${cy - gap} H ${cx - gap + arm}`,
    `M ${cx + gap - arm} ${cy - gap} H ${cx + gap} V ${cy - gap + arm}`,
    `M ${cx - gap} ${cy + gap - arm} V ${cy + gap} H ${cx - gap + arm}`,
    `M ${cx + gap - arm} ${cy + gap} H ${cx + gap} V ${cy + gap - arm}`,
  ].join(' ');
}

/**
 * Static start-position SVG (board + pieces, no window/interaction) for ?preview=start.
 * @param {import('../model/board.js').Board} board
 * @param {import('../theme.js').Theme} theme
 * @returns {string}
 */
export function renderStaticBoardWithPieces(board, theme) {
  const prefix = 'static';
  const pieceUses = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const piece = board.at({ x, y });
      if (!piece) continue;
      const cx = GRID_ORIGIN_X + x * CELL_SIZE;
      const cy = GRID_ORIGIN_Y + y * CELL_SIZE;
      const id = pieceSymbolId(theme.id, piece.side, piece.kind, prefix);
      pieceUses.push(
        `<use href="#${id}" x="${cx - PIECE_ANCHOR_X}" y="${cy - PIECE_ANCHOR_Y}" width="${PIECE_SYMBOL_SIZE}" height="${PIECE_SYMBOL_SIZE}"/>`
      );
    }
  }
  return `<div class="preview-start-container">
    <svg class="board-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}">
      ${buildPieceSymbolsDefs(theme, prefix)}
      <g>${buildBoardInnerSvg(theme, 'preview-start')}</g>
      <g>${pieceUses.join('\n      ')}</g>
    </svg>
  </div>`;
}

/**
 * Interactive Xiangqi board view supporting click-click, drag-and-drop,
 * flip rotation (with upright pieces), legal target hints, illegal shake,
 * check toast, animations, and sound/state callbacks.
 */
export class BoardView {
  /**
   * @param {{
   *   container: HTMLElement,
   *   board: import('../model/board.js').Board,
   *   rules: import('../rules.js').RulesProvider,
   *   theme: import('../theme.js').Theme,
   *   practiceMode?: boolean,
   *   onStateChange?: (evt: { type: string, move?: any }) => void,
   *   onSelectPiece?: (pos: import('../model/moves.js').Pos) => void,
   *   onMoveLanded?: (move: any) => void,
   *   onIllegalMove?: () => void,
   * }} opts
   */
  constructor(opts) {
    this.container = opts.container;
    this.board = opts.board;
    this.rules = opts.rules;
    this.theme = opts.theme;
    this.practiceMode = Boolean(opts.practiceMode);
    this.locked = false;
    /** @type {'red'|'black'|null} */
    this.humanSide = null; // null = both sides human (2-player mode)

    this.onStateChange = opts.onStateChange || (() => {});
    this.onSelectPiece = opts.onSelectPiece || (() => {});
    this.onMoveLanded = opts.onMoveLanded || (() => {});
    this.onIllegalMove = opts.onIllegalMove || (() => {});
    this.onReturnToLive = opts.onReturnToLive || (() => {});
    this.onContinueFromHere = opts.onContinueFromHere || (() => {});

    /** @type {import('../model/board.js').Board | null} */
    this.displayBoard = null;
    /** @type {any} */
    this.displayLastMove = null;
    this.reviewActive = false;
    this._crossFadeCancel = null;

    this.flipped = false;
    this.flipAngle = 0;
    this.animator = new Animator();

    /** @type {import('../model/moves.js').Pos | null} */
    this.selected = null;
    /** @type {import('../model/moves.js').Pos[]} */
    this.legalTargets = [];
    /** @type {import('../model/moves.js').Pos | null} */
    this.hovered = null;
    /** @type {{ from: import('../model/moves.js').Pos, to: import('../model/moves.js').Pos } | null} */
    this.hintArrow = null;
    this._hintTimer = null;
    this.selectionLift = 0;
    this.cancelSelectLift = null;
    this._toastTimer = null;

    /** @type {Object | null} */
    this.drag = null;
    /** @type {Set<string>} */
    this.hiddenKeys = new Set();

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    this._mount();
    this.renderPieces();
    this._renderOverlays();
  }

  /** Switch visual theme without recreating state. @param {import('../theme.js').Theme} theme */
  setTheme(theme) {
    this.theme = theme;
    this._rebuildSvgDefsAndBoard();
    this.renderPieces();
    this._renderOverlays();
  }

  /**
   * Swap active RulesProvider and practice-mode flag.
   * @param {import('../rules.js').RulesProvider} rules
   * @param {boolean} practiceMode
   */
  setRules(rules, practiceMode) {
    this.rules = rules;
    this.practiceMode = practiceMode;
    this.clearSelection();
    this._renderOverlays();
  }

  /** Return the board currently being rendered (viewed board in review, else live board). */
  _activeBoard() {
    return this.displayBoard || this.board;
  }

  /** Return the last move for the currently rendered position. */
  _activeLastMove() {
    return this.displayBoard ? this.displayLastMove : this.board.lastMove();
  }

  /** Find the SVG coordinates (in viewBox 1050x1150) of a side's general on the active board. */
  getGeneralBoardPos(side) {
    const b = this._activeBoard();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = b.at({ x, y });
        if (p && p.kind === 'general' && p.side === side) {
          return { x, y, ...this.logicalToBoard({ x, y }) };
        }
      }
    }
    return null;
  }

  /**
   * Update review display state without mutating the real game board.
   * @param {{
   *   active: boolean,
   *   viewPly: number,
   *   totalPlies: number,
   *   hasNewMoves?: boolean,
   *   viewBoard: import('../model/board.js').Board | null,
   *   lastMove: any,
   *   transition?: 'forward' | 'backward' | 'jump' | 'instant',
   *   stepMove?: any,
   *   reducedMotion?: boolean,
   * }} opts
   */
  setReviewState(opts) {
    const {
      active,
      viewPly,
      totalPlies,
      hasNewMoves = false,
      viewBoard = null,
      lastMove = null,
      transition = 'instant',
      stepMove = null,
      reducedMotion = false,
    } = opts;

    this.reviewActive = Boolean(active);
    this.displayBoard = active ? viewBoard : null;
    this.displayLastMove = active ? lastMove : null;

    if (active) {
      this.clearSelection();
      this.clearHintArrow();
      if (this.toastEl) this.toastEl.classList.remove('is-visible');
      if (this.captureCaptionEl) this.captureCaptionEl.classList.remove('is-visible');
      this.svg.style.cursor = 'default';
    }

    if (this.wrapper) {
      this.wrapper.classList.toggle('is-reviewing', this.reviewActive);
    }

    if (this.reviewBannerEl) {
      if (this.reviewActive) {
        const label =
          viewPly === 0
            ? `Đang xem lại thế ban đầu (0/${totalPlies})`
            : `Đang xem lại nước ${viewPly}/${totalPlies}`;
        this.reviewBannerText.textContent = label;
        this.reviewNewBadge.hidden = !hasNewMoves;
        this.reviewBannerEl.hidden = false;
      } else {
        this.reviewBannerEl.hidden = true;
      }
    }

    // Cancel any previous review transition cleanly
    if (this._crossFadeCancel) {
      this._crossFadeCancel();
      this._crossFadeCancel = null;
    }
    this.layerAnim.innerHTML = '';
    this.hiddenKeys.clear();
    this.layerPieces.setAttribute('opacity', '1');

    if (reducedMotion || transition === 'instant') {
      this.renderPieces();
      this._renderOverlays();
      return;
    }

    if (transition === 'forward' && stepMove) {
      const fromPt = this.logicalToBoard(stepMove.from);
      const toPt = this.logicalToBoard(stepMove.to);
      const destKey = `${stepMove.to.x},${stepMove.to.y}`;
      this.hiddenKeys.add(destKey);

      if (stepMove.captured) {
        const capGhost = this._createPieceGroup(stepMove.captured, toPt.x, toPt.y, 1, 1);
        this.layerAnim.appendChild(capGhost);
        this.animator.tween({
          duration: 150,
          easing: easeOutCubic,
          onUpdate: (e) => {
            this._positionPieceGroup(capGhost, toPt.x, toPt.y, lerp(1.0, 0.72, e), 1 - e);
          },
          onComplete: () => capGhost.remove(),
        });
      }

      this.renderPieces();
      this._renderOverlays();

      const mover = this._createPieceGroup(stepMove.piece, fromPt.x, fromPt.y, 1.05, 1, true);
      this.layerAnim.appendChild(mover);
      this.animator.tween({
        duration: 185,
        easing: easeOutCubic,
        onUpdate: (e) => {
          this._positionPieceGroup(
            mover,
            lerp(fromPt.x, toPt.x, e),
            lerp(fromPt.y, toPt.y, e),
            lerp(1.05, 1.0, e),
            1
          );
        },
        onComplete: () => {
          mover.remove();
          this.hiddenKeys.delete(destKey);
          this.renderPieces();
          this._renderOverlays();
        },
      });
      return;
    }

    if (transition === 'backward' && stepMove) {
      const fromPt = this.logicalToBoard(stepMove.to);
      const toPt = this.logicalToBoard(stepMove.from);
      const destKey = `${stepMove.from.x},${stepMove.from.y}`;
      this.hiddenKeys.add(destKey);

      if (stepMove.captured) {
        const capPt = this.logicalToBoard(stepMove.to);
        const capKey = `${stepMove.to.x},${stepMove.to.y}`;
        this.hiddenKeys.add(capKey);
        const capGhost = this._createPieceGroup(stepMove.captured, capPt.x, capPt.y, 0.85, 0);
        this.layerAnim.appendChild(capGhost);
        this.animator.tween({
          duration: 160,
          easing: easeOutCubic,
          onUpdate: (e) => {
            this._positionPieceGroup(capGhost, capPt.x, capPt.y, lerp(0.85, 1.0, e), e);
          },
          onComplete: () => {
            capGhost.remove();
            this.hiddenKeys.delete(capKey);
            this.renderPieces();
          },
        });
      }

      this.renderPieces();
      this._renderOverlays();

      const mover = this._createPieceGroup(stepMove.piece, fromPt.x, fromPt.y, 1.05, 1, true);
      this.layerAnim.appendChild(mover);
      this.animator.tween({
        duration: 185,
        easing: easeOutCubic,
        onUpdate: (e) => {
          this._positionPieceGroup(
            mover,
            lerp(fromPt.x, toPt.x, e),
            lerp(fromPt.y, toPt.y, e),
            lerp(1.05, 1.0, e),
            1
          );
        },
        onComplete: () => {
          mover.remove();
          this.hiddenKeys.delete(destKey);
          this.renderPieces();
          this._renderOverlays();
        },
      });
      return;
    }

    // Jump (> 1 ply): 120 ms cross-fade
    this.renderPieces();
    this._renderOverlays();
    this.layerPieces.setAttribute('opacity', '0.25');
    this._crossFadeCancel = this.animator.tween({
      duration: 120,
      easing: easeOutCubic,
      onUpdate: (e) => {
        this.layerPieces.setAttribute('opacity', lerp(0.25, 1.0, e).toFixed(3));
      },
      onComplete: () => {
        this.layerPieces.setAttribute('opacity', '1');
        this._crossFadeCancel = null;
      },
    });
  }

  /** Lock or unlock board input (e.g. when viewing board after game over). @param {boolean} locked */
  setLocked(locked) {
    this.locked = locked;
    if (locked) {
      this.clearSelection();
      this.svg.style.cursor = 'default';
    }
  }

  /** Restrict human pointer input to one side (`'red'|'black'`), or `null` for both sides. */
  setHumanSide(side) {
    this.humanSide = side;
    if (side && this.selected) {
      const p = this.board.at(this.selected);
      if (!p || p.side !== side) this.clearSelection();
    }
  }

  /** Set flipped orientation immediately (no animation, e.g. when starting AI game as Black). */
  setFlipped(flipped) {
    this.flipped = Boolean(flipped);
    this.flipAngle = this.flipped ? 180 : 0;
    this._applyFlipTransform();
    this.renderPieces();
    this._renderOverlays();
  }

  /** Programmatically execute a move with full animation, sound, and highlight (used by AI). */
  playMove(from, to) {
    this.clearHintArrow();
    this.clearSelection();
    this._performMove(from, to, null, false);
  }

  /** Draw a soft blue hint arrow from `from` to `to` for `durationMs` (default 2500 ms). */
  showHintArrow(from, to, durationMs = 2500) {
    this.clearHintArrow();
    this.hintArrow = { from, to };
    this._renderOverlays();
    this._hintTimer = window.setTimeout(() => {
      this.clearHintArrow();
    }, durationMs);
  }

  /** Clear any active hint arrow. */
  clearHintArrow() {
    if (this._hintTimer) {
      window.clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
    if (this.hintArrow) {
      this.hintArrow = null;
      this._renderOverlays();
    }
  }

  /** Show a non-blocking toast at the top centre of the board for 1.4 s. @param {string} text */
  showToast(text) {
    if (!this.toastEl) return;
    if (this._toastTimer) {
      window.clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('is-visible', 'is-voice-caption');
    void this.toastEl.offsetWidth; // restart fade transition cleanly
    this.toastEl.classList.add('is-visible');
    this._toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this._toastTimer = null;
    }, 1400);
  }

  /**
   * Show a calligraphy voice caption (top toast for major events, small bottom badge for capture).
   * @param {{ event: string, caption: string, pinyin: string, vi: string }} info
   */
  showVoiceCaption(info) {
    if (!info || !info.caption) return;
    if (info.event === 'capture') {
      if (!this.captureCaptionEl) return;
      if (this._captureToastTimer) {
        window.clearTimeout(this._captureToastTimer);
        this._captureToastTimer = null;
      }
      this.captureCaptionEl.innerHTML = `
        <span class="capture-glyph">${info.caption}</span>
        <span class="capture-pinyin">${info.pinyin || ''}</span>
      `;
      this.captureCaptionEl.classList.remove('is-visible');
      void this.captureCaptionEl.offsetWidth;
      this.captureCaptionEl.classList.add('is-visible');
      this._captureToastTimer = window.setTimeout(() => {
        this.captureCaptionEl.classList.remove('is-visible');
        this._captureToastTimer = null;
      }, 900);
      return;
    }

    if (!this.toastEl) return;
    if (this._toastTimer) {
      window.clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    const viHtml = info.vi ? `<div class="toast-vi">${info.vi}</div>` : '';
    this.toastEl.innerHTML = `
      <div class="toast-glyph">${info.caption}</div>
      <div class="toast-pinyin">${info.pinyin || ''}</div>
      ${viHtml}
    `;
    this.toastEl.classList.remove('is-visible');
    this.toastEl.classList.add('is-voice-caption');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('is-visible');
    this._toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this._toastTimer = null;
    }, 1600);
  }

  /** Cancel current selection or drag. */
  clearSelection() {
    if (this.cancelSelectLift) {
      this.cancelSelectLift();
      this.cancelSelectLift = null;
    }
    this.selected = null;
    this.legalTargets = [];
    this.selectionLift = 0;
    if (this.drag) {
      this.drag = null;
      this.layerDrag.innerHTML = '';
      this.hiddenKeys.clear();
      this.svg.style.cursor = 'default';
      this.renderPieces();
    }
    this._renderOverlays();
  }

  /** Flip the board 180° over 350 ms ease-in-out; pieces stay upright. */
  flip() {
    this.clearSelection();
    const startAngle = this.flipAngle;
    this.flipped = !this.flipped;
    const endAngle = this.flipped ? 180 : 0;

    this.animator.tween({
      duration: 350,
      easing: easeInOutCubic,
      onUpdate: (eased) => {
        this.flipAngle = lerp(startAngle, endAngle, eased);
        this._applyFlipTransform();
        this.renderPieces();
        this._renderOverlays();
      },
      onComplete: () => {
        this.flipAngle = endAngle;
        this._applyFlipTransform();
        this.renderPieces();
        this._renderOverlays();
      },
    });
  }

  /** Undo the last move with a 160 ms slide-back and capture fade-in. */
  undo() {
    this.clearSelection();
    const move = this.board.undo();
    if (!move) return false;

    const fromPt = this.logicalToBoard(move.to);
    const toPt = this.logicalToBoard(move.from);
    const destKey = `${move.from.x},${move.from.y}`;
    this.hiddenKeys.add(destKey);

    if (move.captured) {
      const capPt = this.logicalToBoard(move.to);
      const capKey = `${move.to.x},${move.to.y}`;
      this.hiddenKeys.add(capKey);
      const ghost = this._createPieceGroup(move.captured, capPt.x, capPt.y, 0.85, 0);
      this.layerAnim.appendChild(ghost);
      this.animator.tween({
        duration: 150,
        easing: easeOutCubic,
        onUpdate: (e) => {
          this._positionPieceGroup(ghost, capPt.x, capPt.y, lerp(0.85, 1, e), e);
        },
        onComplete: () => {
          ghost.remove();
          this.hiddenKeys.delete(capKey);
          this.renderPieces();
        },
      });
    }

    this.renderPieces();
    const mover = this._createPieceGroup(move.piece, fromPt.x, fromPt.y, 1.05, 1);
    this.layerAnim.appendChild(mover);

    this.animator.tween({
      duration: 160,
      easing: easeOutCubic,
      onUpdate: (e) => {
        const x = lerp(fromPt.x, toPt.x, e);
        const y = lerp(fromPt.y, toPt.y, e);
        this._positionPieceGroup(mover, x, y, lerp(1.05, 1.0, e), 1);
      },
      onComplete: () => {
        mover.remove();
        this.hiddenKeys.delete(destKey);
        this.renderPieces();
        this._renderOverlays();
      },
    });

    this._renderOverlays();
    this.onStateChange({ type: 'undo', move });
    return true;
  }

  /** Reset board view after external board.loadFen(). */
  syncAfterReset() {
    this.animator.clear();
    if (this._crossFadeCancel) {
      this._crossFadeCancel();
      this._crossFadeCancel = null;
    }
    this.hiddenKeys.clear();
    this.layerAnim.innerHTML = '';
    this.layerDrag.innerHTML = '';
    this.layerPieces.setAttribute('opacity', '1');
    this.displayBoard = null;
    this.displayLastMove = null;
    this.reviewActive = false;
    if (this.wrapper) this.wrapper.classList.remove('is-reviewing');
    if (this.reviewBannerEl) this.reviewBannerEl.hidden = true;
    this.selected = null;
    this.legalTargets = [];
    this.drag = null;
    this.locked = false;
    this.renderPieces();
    this._renderOverlays();
  }

  /**
   * Map logical (x, y) to current board SVG coordinates (accounting for flipAngle).
   * @param {import('../model/moves.js').Pos} pos
   * @returns {{ x: number, y: number }}
   */
  logicalToBoard(pos) {
    const ux = GRID_ORIGIN_X + pos.x * CELL_SIZE;
    const uy = GRID_ORIGIN_Y + pos.y * CELL_SIZE;
    if (this.flipAngle === 0) return { x: ux, y: uy };
    if (this.flipAngle === 180) {
      return { x: BOARD_WIDTH - ux, y: BOARD_HEIGHT - uy };
    }
    const rad = (this.flipAngle * Math.PI) / 180;
    const dx = ux - BOARD_CX;
    const dy = uy - BOARD_CY;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: BOARD_CX + dx * cos - dy * sin,
      y: BOARD_CY + dx * sin + dy * cos,
    };
  }

  /**
   * Convert pointer client coordinates to board SVG viewBox coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  clientToBoard(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const scaleX = BOARD_WIDTH / Math.max(1, rect.width);
    const scaleY = BOARD_HEIGHT / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  /**
   * Hit-test board SVG coordinates to the nearest intersection within 0.48 * cell.
   * @param {number} bx
   * @param {number} by
   * @returns {import('../model/moves.js').Pos | null}
   */
  hitTest(bx, by) {
    const rawX = Math.round((bx - GRID_ORIGIN_X) / CELL_SIZE);
    const rawY = Math.round((by - GRID_ORIGIN_Y) / CELL_SIZE);
    if (rawX < 0 || rawX > 8 || rawY < 0 || rawY > 9) return null;

    const ix = GRID_ORIGIN_X + rawX * CELL_SIZE;
    const iy = GRID_ORIGIN_Y + rawY * CELL_SIZE;
    if (Math.hypot(bx - ix, by - iy) > HIT_RADIUS) return null;

    return this.flipped
      ? { x: 8 - rawX, y: 9 - rawY }
      : { x: rawX, y: rawY };
  }

  /** Re-render all stationary pieces. */
  renderPieces() {
    const activeBoard = this._activeBoard();
    this.layerPieces.innerHTML = '';
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const piece = activeBoard.at({ x, y });
        if (!piece) continue;
        if (this.hiddenKeys.has(`${x},${y}`)) continue;

        const pt = this.logicalToBoard({ x, y });
        const isSel = !this.reviewActive && samePos(this.selected, { x, y });
        const scale = isSel ? lerp(1.0, 1.07, this.selectionLift) : 1.0;
        const g = this._createPieceGroup(piece, pt.x, pt.y, scale, 1, isSel && this.selectionLift > 0.1);
        g.dataset.pos = `${x},${y}`;
        g.dataset.kind = piece.kind;
        g.dataset.side = piece.side;
        this.layerPieces.appendChild(g);
      }
    }
  }

  _mount() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'board-wrapper';

    this.svg = svgEl('svg', {
      class: 'board-svg',
      viewBox: `0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`,
      role: 'application',
      'aria-label': 'Bàn cờ tướng',
    });

    this.defsHost = svgEl('g', { class: 'layer-defs' });
    this.boardBase = svgEl('g', { class: 'layer-board-base' });
    this.layerLastMove = svgEl('g', { class: 'layer-last-move', 'pointer-events': 'none' });
    this.layerHover = svgEl('g', { class: 'layer-hover', 'pointer-events': 'none' });
    this.layerCheck = svgEl('g', { class: 'layer-check', 'pointer-events': 'none' });
    this.layerPieces = svgEl('g', { class: 'layer-pieces', 'pointer-events': 'none' });
    this.layerSelection = svgEl('g', { class: 'layer-selection', 'pointer-events': 'none' });
    this.layerAnim = svgEl('g', { class: 'layer-anim', 'pointer-events': 'none' });
    this.layerDrag = svgEl('g', { class: 'layer-drag', 'pointer-events': 'none' });

    this.svg.append(
      this.defsHost,
      this.boardBase,
      this.layerLastMove,
      this.layerHover,
      this.layerCheck,
      this.layerPieces,
      this.layerSelection,
      this.layerAnim,
      this.layerDrag
    );

    this._rebuildSvgDefsAndBoard();

    this.svg.addEventListener('pointerdown', this._onPointerDown);
    this.svg.addEventListener('pointermove', this._onPointerMove);
    this.svg.addEventListener('pointerup', this._onPointerUp);
    this.svg.addEventListener('pointercancel', this._onPointerUp);
    this.svg.addEventListener('pointerleave', this._onPointerLeave);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'board-toast';
    this.toastEl.setAttribute('aria-live', 'polite');

    this.captureCaptionEl = document.createElement('div');
    this.captureCaptionEl.className = 'board-capture-caption';
    this.captureCaptionEl.setAttribute('aria-hidden', 'true');

    this.reviewBannerEl = document.createElement('div');
    this.reviewBannerEl.className = 'review-banner';
    this.reviewBannerEl.hidden = true;
    this.reviewBannerEl.innerHTML = `
      <span class="review-banner-text"></span>
      <span class="review-new-badge" hidden>Có nước mới</span>
      <div class="review-banner-actions">
        <button type="button" class="review-banner-btn" data-review="live" title="Về hiện tại (Esc)">Về hiện tại</button>
        <button type="button" class="review-banner-btn is-accent" data-review="continue">Chơi tiếp từ đây</button>
      </div>
    `;
    this.reviewBannerText = this.reviewBannerEl.querySelector('.review-banner-text');
    this.reviewNewBadge = this.reviewBannerEl.querySelector('.review-new-badge');
    this.reviewBannerEl.querySelector('[data-review="live"]').addEventListener('click', () => {
      this.onReturnToLive();
    });
    this.reviewBannerEl.querySelector('[data-review="continue"]').addEventListener('click', () => {
      this.onContinueFromHere();
    });

    this.wrapper.append(this.svg, this.reviewBannerEl, this.toastEl, this.captureCaptionEl);
    this.container.innerHTML = '';
    this.container.appendChild(this.wrapper);
  }

  _rebuildSvgDefsAndBoard() {
    this.defsHost.innerHTML = buildPieceSymbolsDefs(this.theme, 'live');
    this.boardBase.innerHTML = buildBoardInnerSvg(this.theme, 'live-board');
    this._applyFlipTransform();
  }

  _applyFlipTransform() {
    if (this.flipAngle === 0) {
      this.boardBase.removeAttribute('transform');
    } else {
      this.boardBase.setAttribute('transform', `rotate(${this.flipAngle} ${BOARD_CX} ${BOARD_CY})`);
    }
  }

  _createPieceGroup(piece, cx, cy, scale = 1, opacity = 1, lifted = false) {
    const g = svgEl('g', { opacity });
    if (lifted) {
      g.setAttribute('filter', 'drop-shadow(0px 6px 5px rgba(0,0,0,0.34))');
    }
    const id = pieceSymbolId(this.theme.id, piece.side, piece.kind, 'live');
    const use = svgEl('use', {
      href: `#${id}`,
      x: -PIECE_ANCHOR_X,
      y: -PIECE_ANCHOR_Y,
      width: PIECE_SYMBOL_SIZE,
      height: PIECE_SYMBOL_SIZE,
    });
    g.appendChild(use);
    this._positionPieceGroup(g, cx, cy, scale, opacity);
    return g;
  }

  _positionPieceGroup(g, cx, cy, scale, opacity) {
    g.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${scale.toFixed(4)})`);
    g.setAttribute('opacity', String(opacity));
  }

  _canSelect(pos) {
    if (this.locked || this.reviewActive) return false;
    const piece = this.board.at(pos);
    if (!piece) return false;
    if (this.humanSide && piece.side !== this.humanSide) return false;
    if (this.practiceMode) return true;
    return piece.side === this.board.sideToMove;
  }

  _isLegalTarget(pos) {
    return this.legalTargets.some((t) => samePos(t, pos));
  }

  _selectPos(pos) {
    if (this.cancelSelectLift) this.cancelSelectLift();
    this.selected = { x: pos.x, y: pos.y };
    this.legalTargets = this.rules.legalMoves(this.board, pos);
    this.selectionLift = 0;
    this._renderOverlays();

    this.cancelSelectLift = this.animator.tween({
      duration: 90,
      easing: easeOutCubic,
      onUpdate: (e) => {
        this.selectionLift = e;
        this.renderPieces();
      },
      onComplete: () => {
        this.selectionLift = 1;
        this.cancelSelectLift = null;
        this.renderPieces();
      },
    });
  }

  _performMove(from, to, startPt = null, isDrop = false) {
    const captured = this.board.at(to);
    const move = this.board.applyMove(from, to);
    if (!move) return;

    this.selected = null;
    this.legalTargets = [];
    this.selectionLift = 0;

    const fromPt = startPt || this.logicalToBoard(from);
    const toPt = this.logicalToBoard(to);
    const destKey = `${to.x},${to.y}`;
    this.hiddenKeys.add(destKey);

    if (captured) {
      const capGhost = this._createPieceGroup(captured, toPt.x, toPt.y, 1, 1);
      this.layerAnim.appendChild(capGhost);
      this.animator.tween({
        duration: 150,
        easing: easeOutCubic,
        onUpdate: (e) => {
          this._positionPieceGroup(capGhost, toPt.x, toPt.y, lerp(1.0, 0.7, e), 1 - e);
        },
        onComplete: () => capGhost.remove(),
      });
    }

    this.renderPieces();
    this._renderOverlays();

    const mover = this._createPieceGroup(move.piece, fromPt.x, fromPt.y, 1.07, 1, true);
    this.layerAnim.appendChild(mover);

    // Notify state immediately so move list & status update synchronously
    this.onStateChange({ type: 'move', move });

    const slideDuration = isDrop ? 90 : 200;
    this.animator.tween({
      duration: slideDuration,
      easing: easeOutCubic,
      onUpdate: (e) => {
        const x = lerp(fromPt.x, toPt.x, e);
        const y = lerp(fromPt.y, toPt.y, e);
        this._positionPieceGroup(mover, x, y, 1.07, 1);
      },
      onComplete: () => {
        this.onMoveLanded(move);
        this.animator.tween({
          duration: 70,
          easing: easeOutCubic,
          onUpdate: (e) => {
            this._positionPieceGroup(mover, toPt.x, toPt.y, lerp(1.07, 1.0, e), 1);
          },
          onComplete: () => {
            mover.remove();
            this.hiddenKeys.delete(destKey);
            this.renderPieces();
            this._renderOverlays();
          },
        });
      },
    });
  }

  _onPointerDown(ev) {
    if (ev.button !== 0 || this.locked || this.reviewActive) return;
    const pt = this.clientToBoard(ev.clientX, ev.clientY);
    const pos = this.hitTest(pt.x, pt.y);
    if (!pos) {
      this.clearSelection();
      return;
    }

    // If a piece is already selected and we clicked a legal target, execute click-click move.
    if (this.selected && this._isLegalTarget(pos) && !samePos(this.selected, pos)) {
      const targetPiece = this.board.at(pos);
      const selectedPiece = this.board.at(this.selected);
      if (targetPiece && selectedPiece && targetPiece.side === selectedPiece.side) {
        this.onSelectPiece(pos);
        this._selectPos(pos);
      } else {
        this._performMove(this.selected, pos, null, false);
        return;
      }
    }

    if (this._canSelect(pos)) {
      const wasSelected = samePos(this.selected, pos);
      const piece = this.board.at(pos);
      this.svg.setPointerCapture(ev.pointerId);
      this.onSelectPiece(pos);
      this.drag = {
        pointerId: ev.pointerId,
        from: pos,
        piece,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        currentBoard: pt,
        active: false,
        wasSelected,
        el: null,
        hoverTarget: null,
      };
      if (!wasSelected) {
        this._selectPos(pos);
      }
    } else if (this.selected) {
      // Clicking an illegal target keeps selection and signals rejection
      this.onIllegalMove();
    }
  }

  _onPointerMove(ev) {
    const pt = this.clientToBoard(ev.clientX, ev.clientY);

    if (this.drag && ev.pointerId === this.drag.pointerId) {
      this.drag.currentBoard = pt;
      const dist = Math.hypot(ev.clientX - this.drag.startClientX, ev.clientY - this.drag.startClientY);
      if (!this.drag.active && dist > DRAG_THRESHOLD_PX) {
        this.drag.active = true;
        this.hiddenKeys.add(`${this.drag.from.x},${this.drag.from.y}`);
        this.renderPieces();
        this.drag.el = this._createPieceGroup(this.drag.piece, pt.x, pt.y, 1.1, 1, true);
        this.layerDrag.appendChild(this.drag.el);
        this.svg.style.cursor = 'grabbing';
      }
      if (this.drag.active && this.drag.el) {
        this._positionPieceGroup(this.drag.el, pt.x, pt.y, 1.1, 1);
        const target = this.hitTest(pt.x, pt.y);
        this.drag.hoverTarget =
          target && !samePos(target, this.drag.from) && this._isLegalTarget(target) ? target : null;
        this._renderOverlays();
      }
      return;
    }

    const pos = this.hitTest(pt.x, pt.y);
    if (!samePos(pos, this.hovered)) {
      this.hovered = pos;
      this.svg.style.cursor = pos && this._canSelect(pos) ? 'pointer' : 'default';
      this._renderOverlays();
    }
  }

  _onPointerUp(ev) {
    if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) {
      this.svg.releasePointerCapture(ev.pointerId);
    }
    this.svg.style.cursor = 'default';

    if (!drag.active) {
      if (drag.wasSelected) {
        this.clearSelection();
      }
      return;
    }

    const pt = this.clientToBoard(ev.clientX, ev.clientY);
    const target = this.hitTest(pt.x, pt.y);
    const originKey = `${drag.from.x},${drag.from.y}`;

    if (drag.el) drag.el.remove();
    this.layerDrag.innerHTML = '';

    if (target && !samePos(target, drag.from) && this._isLegalTarget(target)) {
      this.hiddenKeys.delete(originKey);
      this._performMove(drag.from, target, pt, true);
    } else {
      // Illegal drop: spring back (160 ms) + tiny horizontal shake (2 cycles, 4 px, 140 ms)
      const droppedElsewhere = !target || !samePos(target, drag.from);
      if (droppedElsewhere) {
        this.onIllegalMove();
      }
      const originPt = this.logicalToBoard(drag.from);
      const spring = this._createPieceGroup(drag.piece, pt.x, pt.y, 1.1, 1, true);
      this.layerAnim.appendChild(spring);
      this.animator.tween({
        duration: 160,
        easing: easeOutCubic,
        onUpdate: (e) => {
          this._positionPieceGroup(
            spring,
            lerp(pt.x, originPt.x, e),
            lerp(pt.y, originPt.y, e),
            lerp(1.1, 1.0, e),
            1
          );
        },
        onComplete: () => {
          if (!droppedElsewhere) {
            spring.remove();
            this.hiddenKeys.delete(originKey);
            this.renderPieces();
            this._renderOverlays();
            return;
          }
          // 2-cycle horizontal shake (4 px amplitude, 140 ms)
          this.animator.tween({
            duration: 140,
            easing: (t) => t,
            onUpdate: (_e, raw) => {
              const offset = Math.sin(raw * Math.PI * 4) * 4 * (1 - raw);
              this._positionPieceGroup(spring, originPt.x + offset, originPt.y, 1.0, 1);
            },
            onComplete: () => {
              spring.remove();
              this.hiddenKeys.delete(originKey);
              this.renderPieces();
              this._renderOverlays();
            },
          });
        },
      });
    }
  }

  _onPointerLeave() {
    if (this.hovered) {
      this.hovered = null;
      this._renderOverlays();
    }
  }

  _renderOverlays() {
    const activeBoard = this._activeBoard();
    // 1. Last-move gold corner brackets
    this.layerLastMove.innerHTML = '';
    const last = this._activeLastMove();
    if (last) {
      const fromPt = this.logicalToBoard(last.from);
      const toPt = this.logicalToBoard(last.to);
      this.layerLastMove.appendChild(
        svgEl('path', {
          d: cornerBracketsPath(fromPt.x, fromPt.y),
          fill: 'none',
          stroke: '#D9A441',
          'stroke-width': 2.5,
          'stroke-linecap': 'round',
          opacity: 0.5,
        })
      );
      this.layerLastMove.appendChild(
        svgEl('path', {
          d: cornerBracketsPath(toPt.x, toPt.y),
          fill: 'none',
          stroke: '#D9A441',
          'stroke-width': 2.5,
          'stroke-linecap': 'round',
          opacity: 0.9,
        })
      );
    }

    // 2. Hover circle (only when not dragging, not locked, and not reviewing)
    this.layerHover.innerHTML = '';
    if (this.hovered && !this.locked && !this.reviewActive && !(this.drag && this.drag.active)) {
      const hp = this.logicalToBoard(this.hovered);
      this.layerHover.appendChild(
        svgEl('circle', { cx: hp.x, cy: hp.y, r: 50, fill: '#FFFFFF', opacity: 0.08 })
      );
    }

    // 3. Check pulsing red glow on checked General (CSS-animated, zero rAF)
    this.layerCheck.innerHTML = '';
    for (const side of [RED, BLACK]) {
      if (!this.rules.isInCheck(activeBoard, side)) continue;
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 9; x++) {
          const p = activeBoard.at({ x, y });
          if (p && p.kind === 'general' && p.side === side) {
            const kp = this.logicalToBoard({ x, y });
            this.layerCheck.appendChild(
              svgEl('circle', {
                cx: kp.x,
                cy: kp.y,
                r: 52,
                fill: '#C0392B',
                class: 'check-pulse',
              })
            );
          }
        }
      }
    }

    // 4. Selection gold ring + legal target dots/capture rings (< 20 only) + drag target brackets
    this.layerSelection.innerHTML = '';
    if (this.selected && !(this.drag && this.drag.active)) {
      const sp = this.logicalToBoard(this.selected);
      const rings = [
        { r: 54, w: 2.5, op: 0.95 },
        { r: 57, w: 2.0, op: 0.35 },
        { r: 60.5, w: 2.0, op: 0.16 },
        { r: 64, w: 1.5, op: 0.07 },
      ];
      for (const ring of rings) {
        this.layerSelection.appendChild(
          svgEl('circle', {
            cx: sp.x,
            cy: sp.y,
            r: ring.r,
            fill: 'none',
            stroke: '#F2C14E',
            'stroke-width': ring.w,
            opacity: ring.op,
          })
        );
      }
    }

    if (this.selected && this.legalTargets.length > 0 && this.legalTargets.length < 20) {
      for (const t of this.legalTargets) {
        const tp = this.logicalToBoard(t);
        const occupant = this.board.at(t);
        if (occupant) {
          // Capture target: red-orange ring around enemy piece (r = 0.5 cell = 50, stroke 3)
          this.layerSelection.appendChild(
            svgEl('circle', {
              cx: tp.x,
              cy: tp.y,
              r: 50,
              fill: 'none',
              stroke: '#E0573F',
              'stroke-width': 3,
              opacity: 0.95,
              class: 'legal-capture-ring',
            })
          );
        } else {
          // Empty target: gold dot (r = 0.14 cell = 14, #F2C14E at 0.9 opacity, faint dark outline)
          this.layerSelection.appendChild(
            svgEl('circle', {
              cx: tp.x,
              cy: tp.y,
              r: 14,
              fill: '#F2C14E',
              'fill-opacity': 0.9,
              stroke: '#2A1A0E',
              'stroke-width': 1.6,
              'stroke-opacity': 0.55,
              class: 'legal-move-dot',
            })
          );
        }
      }
    }

    if (this.drag && this.drag.active && this.drag.hoverTarget) {
      const tp = this.logicalToBoard(this.drag.hoverTarget);
      this.layerSelection.appendChild(
        svgEl('path', {
          d: cornerBracketsPath(tp.x, tp.y),
          fill: 'none',
          stroke: '#F2C14E',
          'stroke-width': 2.8,
          'stroke-linecap': 'round',
          opacity: 0.95,
        })
      );
    }

    // 5. Soft blue hint arrow (when active)
    if (this.hintArrow) {
      const fp = this.logicalToBoard(this.hintArrow.from);
      const tp = this.logicalToBoard(this.hintArrow.to);
      const dx = tp.x - fp.x;
      const dy = tp.y - fp.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        const ux = dx / len;
        const uy = dy / len;
        const startX = fp.x + ux * 22;
        const startY = fp.y + uy * 22;
        const endX = tp.x - ux * 28;
        const endY = tp.y - uy * 28;
        const tipX = tp.x - ux * 10;
        const tipY = tp.y - uy * 10;
        const px = -uy;
        const py = ux;
        const headBaseX = tipX - ux * 24;
        const headBaseY = tipY - uy * 24;
        const p1x = headBaseX + px * 15;
        const p1y = headBaseY + py * 15;
        const p2x = headBaseX - px * 15;
        const p2y = headBaseY - py * 15;

        const g = svgEl('g', { class: 'hint-arrow', opacity: 0.88 });
        g.appendChild(
          svgEl('line', {
            x1: startX.toFixed(1),
            y1: startY.toFixed(1),
            x2: endX.toFixed(1),
            y2: endY.toFixed(1),
            stroke: '#5BA4F5',
            'stroke-width': 11,
            'stroke-linecap': 'round',
          })
        );
        g.appendChild(
          svgEl('polygon', {
            points: `${tipX.toFixed(1)},${tipY.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`,
            fill: '#5BA4F5',
          })
        );
        this.layerSelection.appendChild(g);
      }
    }
  }
}
