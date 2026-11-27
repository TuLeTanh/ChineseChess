/**
 * Interactive "Cách đọc nước đi" help dialog (C4).
 * Uses real SVG board + pieces (260 px max) with 3 tappable examples whose
 * explanations are generated from `moveToTraditional().parts`.
 * Keyboard accessible (focus trap, Esc closes, focus returns), both themes, 320 px safe.
 */
import { Board } from '../model/board.js';
import { START_FEN } from '../model/fen.js';
import { buildBoardInnerSvg, GRID_ORIGIN_X, GRID_ORIGIN_Y, CELL_SIZE } from '../render/boardSvg.js';
import { buildPieceSymbolsDefs, pieceSymbolId } from '../render/pieceSvg.js';
import { moveToTraditional } from '../notation/traditional.js';

function boardToSvg(x, y) {
  return { x: GRID_ORIGIN_X + x * CELL_SIZE, y: GRID_ORIGIN_Y + y * CELL_SIZE };
}

const FILES = 'abcdefghi';
const EXAMPLES = [
  { iccs: 'h2e2', from: { x: 7, y: 7 }, to: { x: 4, y: 7 } },
  { iccs: 'h0g2', from: { x: 7, y: 9 }, to: { x: 6, y: 7 } },
  { iccs: 'h2h9', from: { x: 7, y: 7 }, to: { x: 7, y: 0 } },
];

function explainFromParts(tr) {
  const { name, filePart, dir, arg } = tr.parts;
  const isDiagonal = name === 'Mã' || name === 'Tượng' || name === 'Sĩ';
  if (dir === 'bình') {
    return `${name} ở cột ${filePart} đi ngang sang cột ${arg}.`;
  }
  if (isDiagonal) {
    return `${name} ở cột ${filePart} đi ${dir} tới cột ${arg}.`;
  }
  return `${name} ở cột ${filePart} đi ${dir} ${arg} bước.`;
}

function buildMiniBoardSvg(theme, ex) {
  const prefix = 'nhelp';
  const b = Board.fromFen(START_FEN);
  const p1 = boardToSvg(ex.from.x, ex.from.y);
  const p2 = boardToSvg(ex.to.x, ex.to.y);

  const pieces = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const pc = b.at({ x, y });
      if (!pc) continue;
      const pos = boardToSvg(x, y);
      const sym = pieceSymbolId(theme.id, pc.side, pc.kind, prefix);
      const isHi = x === ex.from.x && y === ex.from.y;
      pieces.push(
        `<g transform="translate(${pos.x - 60} ${pos.y - 56})">` +
          (isHi ? `<circle cx="60" cy="56" r="49" fill="none" stroke="#FACC15" stroke-width="6"/>` : '') +
          `<use href="#${sym}" width="120" height="120"/>` +
        `</g>`
      );
    }
  }

  // Shorten arrow tip slightly so arrowhead lands cleanly on target square
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = p2.x - (dx / len) * 26;
  const ty = p2.y - (dy / len) * 26;

  return `
    <svg class="nhelp-board-svg" viewBox="0 0 1050 1150" aria-hidden="true">
      ${buildPieceSymbolsDefs(theme, prefix)}
      <defs>
        <marker id="nhelp-arrow" markerWidth="6" markerHeight="6" refX="3.5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#38BDF8"/>
        </marker>
      </defs>
      ${buildBoardInnerSvg(theme, prefix)}
      <g>${pieces.join('')}</g>
      <line x1="${p1.x}" y1="${p1.y}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"
            stroke="#38BDF8" stroke-width="14" stroke-linecap="round" opacity="0.92"
            marker-end="url(#nhelp-arrow)"/>
    </svg>
  `;
}

export function openNotationHelpModal(ctx, returnFocusEl = null) {
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return;
  const prevFocus = returnFocusEl || document.activeElement;
  const startBoard = Board.fromFen(START_FEN);
  let activeIdx = 0;

  const close = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch {}
    }
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  const render = () => {
    const theme = ctx.getTheme();
    const ex = EXAMPLES[activeIdx];
    const tr = moveToTraditional(startBoard, ex.iccs, { variant: 'xiangqi' });
    const explain = explainFromParts(tr);

    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="nhelp-title" data-testid="notation-help-modal">
        <div class="modal-card nhelp-modal">
          <div class="settings-header">
            <h3 id="nhelp-title">Cách đọc nước đi</h3>
            <button type="button" class="icon-btn nhelp-close" aria-label="Đóng hướng dẫn">✕</button>
          </div>
          <div class="nhelp-body">
            <p class="nhelp-intro"><strong>Mỗi nước ghi: Tên quân + Cột + Tiến/Thoái/Bình + Số.</strong></p>
            <ul class="nhelp-rules">
              <li>Cột đếm 1 đến 9 từ bên <strong>PHẢI</strong> của người đi.</li>
              <li>Quân đi thẳng (Xe, Pháo, Tướng, Tốt): số cuối là <strong>số bước</strong>. Quân đi chéo hoặc chữ L (Mã, Tượng, Sĩ): số cuối là <strong>cột đến</strong>.</li>
              <li>Tiến = về phía đối thủ, Thoái = lùi, Bình = đi ngang. Hai quân cùng loại cùng cột: ghi <strong>Trước</strong> hoặc <strong>Sau</strong>.</li>
            </ul>

            <div class="nhelp-example-box">
              <div class="nhelp-ex-tabs" role="tablist" aria-label="Ví dụ minh họa">
                ${EXAMPLES.map((e, i) => {
                  const t = moveToTraditional(startBoard, e.iccs);
                  return `<button type="button" role="tab" class="mini-seg-btn${i === activeIdx ? ' is-selected' : ''}" aria-selected="${i === activeIdx}" data-ex="${i}">${t.short}</button>`;
                }).join('')}
              </div>
              <div class="nhelp-ex-grid">
                <div class="nhelp-board-wrap">${buildMiniBoardSvg(theme, ex)}</div>
                <div class="nhelp-ex-info">
                  <div class="nhelp-ex-pair">
                    <span class="nhelp-ex-trad">${tr.full}</span>
                    <span class="nhelp-ex-coord">${ex.iccs}</span>
                  </div>
                  <div class="nhelp-ex-short">Rút gọn: <strong>${tr.short}</strong></div>
                  <p class="nhelp-ex-explain">${explain}</p>
                </div>
              </div>
            </div>

            <div class="nhelp-short-table">
              <span><strong>+</strong> tiến</span>
              <span>·</span>
              <span><strong>−</strong> thoái</span>
              <span>·</span>
              <span><strong>=</strong> bình</span>
            </div>
            <p class="set-hint nhelp-jieqi-note">Cờ Úp: Quân úp được gọi theo ô nó đứng. Sau khi lật mới biết quân thật.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="pill-btn pill-btn-gold nhelp-ok">Đã hiểu</button>
          </div>
        </div>
      </div>
    `;

    modalRoot.querySelector('.nhelp-close').addEventListener('click', close);
    modalRoot.querySelector('.nhelp-ok').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
    modalRoot.querySelectorAll('[data-ex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeIdx = Number(btn.dataset.ex) || 0;
        render();
      });
    });
  };

  render();
}
