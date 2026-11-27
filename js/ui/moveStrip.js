/**
 * Horizontal single-row move strip for portrait `stack` layout (C2).
 * Renders flat tappable move chips + a 44x44 "⌃" sheet opener button,
 * auto-scrolls to the active viewed ply, and supports drag-up to open the sheet.
 */
import { formatMoveDisplay, buildMoveTextSpansHtml } from './moveText.js';

const PIECE_CHARS = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

export class MoveStrip {
  /**
   * @param {{
   *   container: HTMLElement,
   *   board: any,
   *   onSelectPly: (ply: number) => void,
   *   onOpenSheet: () => void,
   * }} opts
   */
  constructor(opts) {
    this.container = opts.container;
    this.board = opts.board;
    this.onSelectPly = opts.onSelectPly || (() => {});
    this.onOpenSheet = opts.onOpenSheet || (() => {});
    this.notation = opts.notation === 'coord' ? 'coord' : 'traditional';
    this.viewPly = 0;
    this._lastCount = -1;
    this._lastView = -1;
    this._lastNotation = '';
    this._dragStartY = null;

    this._build();
  }

  setNotation(notation) {
    const next = notation === 'coord' ? 'coord' : 'traditional';
    if (this.notation === next) return;
    this.notation = next;
    this.update(this.viewPly, true);
  }

  _build() {
    this.el = document.createElement('div');
    this.el.className = 'move-strip';
    this.el.dataset.testid = 'move-strip';
    this.el.innerHTML = `
      <div class="move-strip-scroller" role="list" aria-label="Nước đi gần đây"></div>
      <button type="button" class="move-strip-open-btn" data-testid="sheet-open-btn" aria-label="Mở bảng nước đi và tùy chọn" aria-expanded="false">⌃</button>
    `;
    this.scroller = this.el.querySelector('.move-strip-scroller');
    this.openBtn = this.el.querySelector('[data-testid="sheet-open-btn"]');

    this._onClick = (ev) => {
      const btn = ev.target.closest('button[data-ply]');
      if (!btn) return;
      const ply = Number(btn.dataset.ply);
      if (Number.isFinite(ply)) this.onSelectPly(ply);
    };
    this._onOpenClick = () => this.onOpenSheet();

    // Vertical drag-up on strip opens the bottom sheet; short touch tap selects chip immediately
    this._tapInfo = null;
    this._onPointerDown = (ev) => {
      if (ev.target.closest('[data-testid="sheet-open-btn"]')) return;
      this._dragStartY = ev.clientY;
      const btn = ev.target.closest('button[data-ply]');
      if (btn && (ev.pointerType === 'touch' || ev.pointerType === 'pen')) {
        this._tapInfo = {
          pointerId: ev.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          ply: Number(btn.dataset.ply),
        };
      } else {
        this._tapInfo = null;
      }
    };
    this._onPointerMove = (ev) => {
      if (this._dragStartY === null) return;
      if (this._dragStartY - ev.clientY > 24) {
        this._dragStartY = null;
        this._tapInfo = null;
        this.onOpenSheet();
      }
    };
    this._onPointerUp = (ev) => {
      this._dragStartY = null;
      if (this._tapInfo && ev.pointerId === this._tapInfo.pointerId) {
        const dist = Math.hypot(ev.clientX - this._tapInfo.x, ev.clientY - this._tapInfo.y);
        const ply = this._tapInfo.ply;
        this._tapInfo = null;
        if (dist < 10 && Number.isFinite(ply)) {
          ev.preventDefault();
          this.onSelectPly(ply);
        }
      }
    };
    this._onPointerCancel = () => {
      this._dragStartY = null;
      this._tapInfo = null;
    };

    this.scroller.addEventListener('click', this._onClick);
    this.openBtn.addEventListener('click', this._onOpenClick);
    this.el.addEventListener('pointerdown', this._onPointerDown);
    this.el.addEventListener('pointermove', this._onPointerMove);
    this.el.addEventListener('pointerup', this._onPointerUp);
    this.el.addEventListener('pointercancel', this._onPointerCancel);

    this.container.appendChild(this.el);
  }

  setExpanded(expanded) {
    if (this.openBtn) {
      this.openBtn.setAttribute('aria-expanded', String(Boolean(expanded)));
    }
  }

  update(viewPly = this.board.history.length, force = false) {
    const history = this.board.history || [];
    const total = history.length;
    this.viewPly = Math.max(0, Math.min(total, viewPly));

    if (!force && total === this._lastCount && this.viewPly === this._lastView && this.notation === this._lastNotation) return;
    this._lastCount = total;
    this._lastView = this.viewPly;
    this._lastNotation = this.notation;

    if (total === 0) {
      this.scroller.innerHTML = `<span class="mstrip-empty">Chưa có nước đi</span>`;
      return;
    }

    const variant = this.board.isJieqi ? 'jieqi' : 'xiangqi';
    const parts = [];
    for (let i = 0; i < total; i++) {
      const mv = history[i];
      const ply = i + 1;
      const isViewed = ply === this.viewPly;
      const num = i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : '';
      const glyph = mv.piece ? PIECE_CHARS[mv.piece.side]?.[mv.piece.kind] || '' : '';
      const cap = mv.captured ? '<span class="mstrip-cap">×</span>' : '';
      const rev = mv.wasCovered && mv.reveal ? '<span class="move-reveal-badge">LẬT</span>' : '';
      const beforeFen = typeof this.board.snapshotAt === 'function' ? this.board.snapshotAt(i)?.fen : null;
      const disp = formatMoveDisplay({
        position: beforeFen,
        move: mv.iccs || '',
        variant,
        setting: this.notation,
        extras: {
          revealKind: mv.wasCovered && mv.reveal ? mv.reveal.type : null,
          suffix: mv.suffix || '',
        },
      });
      parts.push(
        `<button type="button" class="mstrip-chip${isViewed ? ' is-viewed' : ''}${mv.captured ? ' is-capture' : ''}" data-ply="${ply}" data-move="${disp.coord}" title="${disp.title}" aria-label="${disp.aria}" data-nowrap="1">` +
          (num ? `<span class="mstrip-num">${num}</span>` : '') +
          `<span class="mstrip-glyph is-${mv.side}">${glyph}</span>` +
          `<span class="mstrip-iccs">${buildMoveTextSpansHtml(disp, mv.suffix || '')}</span>${cap}${rev}` +
        `</button>`
      );
    }
    this.scroller.innerHTML = parts.join('');

    const active = this.scroller.querySelector('.mstrip-chip.is-viewed');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' });
    }
  }

  dispose() {
    if (this.scroller) this.scroller.removeEventListener('click', this._onClick);
    if (this.openBtn) this.openBtn.removeEventListener('click', this._onOpenClick);
    if (this.el) {
      this.el.removeEventListener('pointerdown', this._onPointerDown);
      this.el.removeEventListener('pointermove', this._onPointerMove);
      this.el.removeEventListener('pointerup', this._onPointerUp);
      this.el.removeEventListener('pointercancel', this._onPointerCancel);
      this.el.remove();
    }
  }
}
