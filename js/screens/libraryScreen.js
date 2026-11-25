/**
 * Library screen (#/library):
 * - Lists saved games with filters (variant, result, search), pagination (50/page),
 *   lazy-drawn 96px SVG board thumbnails, Export / Note / Delete / Continue / Review actions,
 *   and full keyboard navigation (Up/Down/Enter/Delete/Esc).
 */
import { LobbyBackground } from '../ui/lobbyBackground.js';
import { buildPieceSymbolsDefs, pieceSymbolId, pieceBackSymbolId } from '../render/pieceSvg.js';
import { Board } from '../model/board.js';
import { JieqiBoard, LETTER_TO_KIND } from '../jieqi/rules.js';
import { variantToRouteGame } from '../storage/gameRecord.js';
import { gameFingerprint } from '../analysis/math.js';
import {
  formatRelativeDateVi,
  formatResultVi,
  openExportModal,
  openImportModal,
  openContinueFromPositionModal,
  triggerDownload,
} from './../ui/saveModals.js';
import { leakTracker } from '../app/router.js';

const FILES = 'abcdefghi';

function computeFinalPosition(record) {
  try {
    const isJieqi = record.variant === 'jieqi';
    const b = isJieqi ? JieqiBoard.fromPublicFen(record.start.fen) : Board.fromFen(record.start.fen);
    for (const mv of record.moves || []) {
      const from = { x: FILES.indexOf(mv.m[0]), y: 9 - Number(mv.m[1]) };
      const to = { x: FILES.indexOf(mv.m[2]), y: 9 - Number(mv.m[3]) };
      const ext =
        isJieqi && (mv.r || mv.cr)
          ? {
              type: mv.r ? LETTER_TO_KIND[mv.r] : undefined,
              capturedType: mv.cr ? LETTER_TO_KIND[mv.cr] : undefined,
            }
          : null;
      b.applyMove(from, to, ext);
    }
    return b;
  } catch {
    return null;
  }
}

function renderMiniBoardSvg(record, theme) {
  const b = computeFinalPosition(record);
  if (!b) return '';
  const pieces = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = b.at({ x, y });
      if (!p) continue;
      const cx = 10 + x * 10;
      const cy = 10 + y * 10;
      const id = p.covered
        ? pieceBackSymbolId(theme.id, p.side, 'lib')
        : pieceSymbolId(theme.id, p.side, p.kind, 'lib');
      pieces.push(`<use href="#${id}" x="${cx - 4.8}" y="${cy - 4.8}" width="9.6" height="9.6"/>`);
    }
  }
  const bg = theme.board?.surfaceMid || '#C99047';
  const line = theme.board?.gridLine || '#3B2314';
  const gridLines = [];
  for (let y = 0; y < 10; y++) {
    gridLines.push(`<line x1="10" y1="${10 + y * 10}" x2="90" y2="${10 + y * 10}" stroke="${line}" stroke-width="0.6" opacity="0.65"/>`);
  }
  for (let x = 0; x < 9; x++) {
    gridLines.push(`<line x1="${10 + x * 10}" y1="10" x2="${10 + x * 10}" y2="50" stroke="${line}" stroke-width="0.6" opacity="0.65"/>`);
    gridLines.push(`<line x1="${10 + x * 10}" y1="60" x2="${10 + x * 10}" y2="100" stroke="${line}" stroke-width="0.6" opacity="0.65"/>`);
  }
  return `<svg class="lib-thumb-svg" viewBox="0 0 100 110" width="88" height="96" aria-hidden="true">
    <rect x="2" y="2" width="96" height="106" rx="5" fill="${bg}" stroke="${line}" stroke-width="1.2"/>
    ${gridLines.join('')}
    ${pieces.join('')}
  </svg>`;
}

export function createLibraryScreen(ctx) {
  let bg = null;
  let observer = null;
  let onKeyDown = null;
  let destroyed = false;

  return {
    async mount(container) {
      destroyed = false;
      const s = ctx.settingsStore.get();
      const theme = ctx.getTheme();

      let filterVariant = 'all';
      let filterResult = 'all';
      let searchQuery = '';
      let cursor = 0;
      const limit = 50;
      let currentItems = [];

      container.className = 'lobby-shell library-shell';
      container.innerHTML = `
        <div class="lobby-content library-content">
          <svg class="lobby-defs-svg" width="0" height="0" aria-hidden="true">
            ${buildPieceSymbolsDefs(theme, 'lib')}
          </svg>
          <header class="lobby-topbar">
            <button type="button" class="pill-btn" data-act="back" title="Về sảnh (Esc)">← Sảnh</button>
            <div class="mode-head-title">
              <h1>Thư viện ván</h1>
              <p class="lib-count-sub">Đang tải…</p>
            </div>
            <div class="lib-top-btns">
              <button type="button" class="pill-btn" data-act="import">Nhập ván</button>
              <button type="button" class="pill-btn" data-act="export-all">Xuất tất cả</button>
            </div>
          </header>

          <div class="lib-toolbar">
            <select class="ai-level-select lib-filter-variant" aria-label="Lọc biến thể">
              <option value="all">Tất cả biến thể</option>
              <option value="xiangqi">Cờ Tướng</option>
              <option value="jieqi">Cờ Úp</option>
            </select>
            <select class="ai-level-select lib-filter-result" aria-label="Lọc kết quả">
              <option value="all">Tất cả kết quả</option>
              <option value="red">Đỏ thắng</option>
              <option value="black">Đen thắng</option>
              <option value="draw">Hòa</option>
              <option value="unfinished">Chưa xong</option>
            </select>
            <input type="search" class="set-input lib-search" placeholder="Tìm theo tên hoặc ghi chú…" aria-label="Tìm ván cờ">
          </div>

          <main class="lib-list-wrap" role="list"></main>
          <div class="lib-pager" hidden>
            <button type="button" class="pill-btn" data-page="prev">← Trang trước</button>
            <span class="lib-page-info"></span>
            <button type="button" class="pill-btn" data-page="next">Trang sau →</button>
          </div>
        </div>
      `;

      bg = new LobbyBackground({
        container,
        theme,
        quality: s.bgQuality,
        seed: 20261125,
      });

      const listEl = container.querySelector('.lib-list-wrap');
      const countSub = container.querySelector('.lib-count-sub');
      const pagerEl = container.querySelector('.lib-pager');
      const pageInfoEl = container.querySelector('.lib-page-info');

      const setupObserver = () => {
        if (observer) observer.disconnect();
        if (typeof IntersectionObserver !== 'function') return;
        observer = new IntersectionObserver(
          (entries) => {
            for (const ent of entries) {
              if (!ent.isIntersecting) continue;
              const holder = ent.target;
              if (holder.dataset.rendered === '1') continue;
              const idx = Number(holder.dataset.idx);
              const rec = currentItems[idx];
              if (rec) {
                holder.innerHTML = renderMiniBoardSvg(rec, ctx.getTheme());
                holder.dataset.rendered = '1';
              }
              observer.unobserve(holder);
            }
          },
          { rootMargin: '120px' }
        );
      };

      const loadList = async () => {
        if (destroyed) return;
        const res = await ctx.gameStore.listGames({
          variant: filterVariant,
          result: filterResult,
          query: searchQuery,
          limit,
          cursor,
        });
        if (destroyed) return;
        const allAnalyses = ctx.gameStore.listAnalyses ? await ctx.gameStore.listAnalyses() : [];
        const analysisByGame = new Map();
        for (const a of allAnalyses) {
          const gk = a.gameKey || gameFingerprint(a.startFen || '', a.moves || []);
          if (!analysisByGame.has(gk)) analysisByGame.set(gk, a);
        }
        currentItems = res.items;
        countSub.textContent = `${res.total} ván đã lưu`;

        if (res.items.length === 0) {
          listEl.innerHTML = `
            <div class="lib-empty">
              <p>Chưa có ván cờ nào phù hợp.</p>
              <p class="set-hint">Ván đấu kết thúc sẽ tự động lưu tại đây, hoặc bạn có thể nhập file .xqgame.json / .pgn.</p>
              <button type="button" class="pill-btn pill-btn-gold" data-act="empty-import">Nhập ván</button>
            </div>
          `;
          listEl.querySelector('[data-act="empty-import"]').addEventListener('click', () => {
            openImportModal(ctx, { onImported: () => { cursor = 0; loadList(); } });
          });
          pagerEl.hidden = true;
          return;
        }

        setupObserver();
        listEl.innerHTML = '';

        res.items.forEach((rec, idx) => {
          const row = document.createElement('article');
          row.className = 'lib-item';
          row.setAttribute('role', 'listitem');
          row.setAttribute('tabindex', '0');
          row.dataset.id = rec.id;

          const thumb = document.createElement('div');
          thumb.className = 'lib-thumb';
          thumb.dataset.idx = String(idx);
          if (idx < 8 || typeof IntersectionObserver !== 'function') {
            thumb.innerHTML = renderMiniBoardSvg(rec, ctx.getTheme());
            thumb.dataset.rendered = '1';
          } else {
            observer.observe(thumb);
          }

          const body = document.createElement('div');
          body.className = 'lib-item-body';

          const topLine = document.createElement('div');
          topLine.className = 'lib-item-top';
          const badge = document.createElement('span');
          badge.className = `lib-variant-badge is-${rec.variant}`;
          badge.textContent = rec.variant === 'jieqi' ? 'Cờ Úp' : 'Cờ Tướng';
          const players = document.createElement('strong');
          players.className = 'lib-players';
          players.textContent = `${rec.red?.name || 'Đỏ'} vs ${rec.black?.name || 'Đen'}`;
          topLine.append(badge, players);

          const meta = document.createElement('div');
          meta.className = 'lib-item-meta';
          meta.textContent = `${formatResultVi(rec)} · ${(rec.moves || []).length} nước · ${formatRelativeDateVi(rec.updatedAt || rec.createdAt)}`;

          body.append(topLine, meta);

          if (rec.variant === 'xiangqi') {
            const gk = gameFingerprint(rec.start?.fen || '', (rec.moves || []).map((m) => m.m));
            const an = analysisByGame.get(gk);
            if (an && an.summary && (an.summary.redAccuracy !== null || an.summary.blackAccuracy !== null)) {
              const accEl = document.createElement('div');
              accEl.className = 'lib-acc-badge';
              const rAcc = an.summary.redAccuracy !== null ? `${Math.round(an.summary.redAccuracy)}%` : '—';
              const bAcc = an.summary.blackAccuracy !== null ? `${Math.round(an.summary.blackAccuracy)}%` : '—';
              accEl.textContent = `Độ chính xác: Đỏ ${rAcc} · Đen ${bAcc}`;
              body.appendChild(accEl);
            }
          }

          if (rec.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'lib-item-note';
            noteEl.textContent = rec.note;
            body.appendChild(noteEl);
          }

          const actions = document.createElement('div');
          actions.className = 'lib-item-actions';

          const mkBtn = (text, cls, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `mini-seg-btn ${cls}`;
            b.textContent = text;
            b.addEventListener('click', (ev) => {
              ev.stopPropagation();
              fn();
            });
            return b;
          };

          const openReview = () => {
            ctx.router.navigate(`/play/${variantToRouteGame(rec.variant)}/review`, { id: rec.id });
          };

          actions.appendChild(mkBtn('Xem lại', 'is-selected', openReview));
          if (rec.variant === 'xiangqi' && rec.result !== 'unfinished') {
            actions.appendChild(
              mkBtn('Phân tích', '', () => {
                ctx.router.navigate('/play/cotuong/review', { id: rec.id, analyze: '1' });
              })
            );
          }
          if (rec.result === 'unfinished') {
            actions.appendChild(
              mkBtn('Chơi tiếp', '', () => {
                const fin = computeFinalPosition(rec);
                if (!fin) return;
                openContinueFromPositionModal(ctx, {
                  variant: rec.variant,
                  fen: fin.isJieqi ? fin.publicFen() : fin.toFen(),
                  pool: fin.isJieqi ? fin.getPool() : null,
                });
              })
            );
          }
          actions.appendChild(
            mkBtn('Xuất', '', () => {
              const fin = computeFinalPosition(rec);
              openExportModal(ctx, {
                record: rec,
                currentFen: fin ? (fin.isJieqi ? fin.publicFen() : fin.toFen()) : rec.start.fen,
                allowSaveToLibrary: false,
              });
            })
          );
          actions.appendChild(
            mkBtn('Ghi chú', '', async () => {
              const next = window.prompt('Ghi chú ván cờ (tối đa 200 ký tự):', rec.note || '');
              if (next !== null) {
                await ctx.gameStore.updateNote(rec.id, next);
                loadList();
              }
            })
          );
          actions.appendChild(
            mkBtn('Xóa', 'lib-btn-del', async () => {
              if (window.confirm('Xóa ván cờ này khỏi thư viện?')) {
                await ctx.gameStore.deleteGame(rec.id);
                loadList();
              }
            })
          );

          row.addEventListener('keydown', async (ev) => {
            if (ev.key === 'ArrowDown') {
              ev.preventDefault();
              row.nextElementSibling?.focus();
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault();
              row.previousElementSibling?.focus();
            } else if (ev.key === 'Enter' && ev.target === row) {
              openReview();
            } else if (ev.key === 'Delete') {
              if (window.confirm('Xóa ván cờ này khỏi thư viện?')) {
                await ctx.gameStore.deleteGame(rec.id);
                loadList();
              }
            }
          });

          row.append(thumb, body, actions);
          listEl.appendChild(row);
        });

        const totalPages = Math.max(1, Math.ceil(res.total / limit));
        const curPage = Math.floor(cursor / limit) + 1;
        pagerEl.hidden = totalPages <= 1;
        pageInfoEl.textContent = `Trang ${curPage} / ${totalPages}`;
        pagerEl.querySelector('[data-page="prev"]').disabled = cursor === 0;
        pagerEl.querySelector('[data-page="next"]').disabled = res.nextCursor === null;
      };

      // Wire controls
      container.querySelector('[data-act="back"]').addEventListener('click', () => ctx.router.navigate('/'));
      container.querySelector('[data-act="import"]').addEventListener('click', () => {
        openImportModal(ctx, { onImported: () => { cursor = 0; loadList(); } });
      });
      container.querySelector('[data-act="export-all"]').addEventListener('click', async () => {
        const bundle = await ctx.gameStore.exportAll();
        const date = new Date().toISOString().slice(0, 10);
        triggerDownload(`xiangqi_library_${date}.xqgame.json`, JSON.stringify(bundle, null, 2));
      });
      container.querySelector('.lib-filter-variant').addEventListener('change', (ev) => {
        filterVariant = ev.target.value;
        cursor = 0;
        loadList();
      });
      container.querySelector('.lib-filter-result').addEventListener('change', (ev) => {
        filterResult = ev.target.value;
        cursor = 0;
        loadList();
      });
      container.querySelector('.lib-search').addEventListener('input', (ev) => {
        searchQuery = ev.target.value;
        cursor = 0;
        loadList();
      });
      pagerEl.querySelector('[data-page="prev"]').addEventListener('click', () => {
        cursor = Math.max(0, cursor - limit);
        loadList();
      });
      pagerEl.querySelector('[data-page="next"]').addEventListener('click', () => {
        cursor += limit;
        loadList();
      });

      onKeyDown = (ev) => {
        if (ev.key === 'Escape' && (!ctx.modalRoot || ctx.modalRoot.hidden)) {
          ctx.router.navigate('/');
        }
      };
      window.addEventListener('keydown', onKeyDown);
      leakTracker.trackListener(1);

      await loadList();
    },

    unmount() {
      destroyed = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (onKeyDown) {
        window.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
        leakTracker.trackListener(-1);
      }
      if (bg) {
        bg.destroy();
        bg = null;
      }
    },
  };
}
