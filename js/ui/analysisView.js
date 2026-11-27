/**
 * Full-Swap Redesigned Analysis Panel (Phase 3 — Blocks A..G):
 *  A. Sticky Header: "← Về ván" | "Phân tích" | engine badge | "⋯" preset/rerun/export menu
 *  B. Verdict Card: 5 Vietnamese advantage bands, score ("+1.8" / "Chiếu bí sau N nước"), 2-color win% bar
 *  C. Move Quality Card: Vietnamese class + symbol, win% lost, explanatory sentence, "Xem nước tốt hơn" & "Thử nước này"
 *  D. Next Moves (6 plies / 3 moves each side, validated through XiangqiRules): clickable PV chips for non-destructive
 *     ghost board preview ("Đang xem phương án của máy", Esc returns), numbered arrows 1..6 + toggle, top-2 lines,
 *     and "Sâu hơn" (8 plies at next preset / x3 time / depth+1, cached with extension level)
 *  E. SVG Area Graph of Red's win% + legend + pointer/touch scrub
 *  F. Summary Card: accuracy rings, class counts, top-3 mistakes per side, "Chỉ hiện sai lầm" filter
 *  G. Run Controls: whole-game analysis (finished/archive) OR live single-position analysis (live local, 250ms debounce)
 *     + "Phân tích cả ván"
 */
import {
  winPercent,
  formatEvalScore,
  normalizeToRed,
  wdlToRed,
  classifyMove,
  analysisKey,
  gameFingerprint,
  isMistakeClass,
  selectAnalysisPositionData,
} from '../analysis/math.js';
import {
  ANALYSIS_PRESETS,
  probeAnalysisEngine,
  runGameAnalysis,
} from '../analysis/analyzer.js';
import {
  verdictForWinPercent,
  buildValidatedPvChips,
  createLiveAnalysisScheduler,
} from '../app/panelPolicy.js';
import { pieceSymbolId } from '../render/pieceSvg.js';
import { formatMoveDisplay, formatMoveWithParen, formatLine } from './moveText.js';

const FILES = 'abcdefghi';

function parseIccs(str) {
  if (!str || str.length !== 4) return null;
  const fx = FILES.indexOf(str[0]);
  const fy = 9 - Number(str[1]);
  const tx = FILES.indexOf(str[2]);
  const ty = 9 - Number(str[3]);
  if (fx < 0 || tx < 0 || Number.isNaN(fy) || Number.isNaN(ty)) return null;
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

function formatScoreLongVi(scoreRed) {
  if (!scoreRed) return '0.0';
  if (typeof scoreRed.mate === 'number') {
    if (scoreRed.mate === 0 && scoreRed.winner) {
      return scoreRed.winner === 'red' ? 'Đỏ chiếu bí' : 'Đen chiếu bí';
    }
    const n = Math.abs(scoreRed.mate);
    return scoreRed.mate > 0 ? `Đỏ chiếu bí sau ${n} nước` : `Đen chiếu bí sau ${n} nước`;
  }
  return formatEvalScore(scoreRed);
}

function ringSvg(pct, label, sideCls) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const val = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
  const dash = ((val / 100) * circ).toFixed(1);
  const txt = pct === null || pct === undefined ? '—' : `${Math.round(val)}%`;
  return `
    <div class="an-ring-box ${sideCls}">
      <svg viewBox="0 0 56 56" width="52" height="52" aria-hidden="true">
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5"/>
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="currentColor" stroke-width="5"
          stroke-dasharray="${dash} ${circ.toFixed(1)}" stroke-linecap="round"
          transform="rotate(-90 28 28)"/>
        <text x="28" y="32" text-anchor="middle" fill="currentColor" font-size="13" font-weight="700">${txt}</text>
      </svg>
      <span class="an-ring-label">${label}</span>
    </div>
  `;
}

export class AnalysisPanel {
  /**
   * @param {{
   *   ctx: any,
   *   hostEl: HTMLElement,
   *   evalBar: any,
   *   boardView: any,
   *   sidePanel: any,
   *   startFen: string,
   *   moves: string[],
   *   variant: 'xiangqi' | 'jieqi',
   *   isUnfinished?: boolean,
   *   isLiveLocal?: boolean,
   *   getBoardState?: () => { startFen: string, moves: string[], currentFen: string, viewPly: number, sideToMove: 'red'|'black' },
   *   onSelectPly: (ply: number, opts?: any) => void,
   *   onTryMove?: (ply: number, iccs: string) => void,
   *   onPreviewFen?: (fen: string | null, label?: string) => void,
   *   onClose?: () => void,
   *   onResultChange?: (result: any) => void,
   * }} opts
   */
  constructor(opts) {
    this.ctx = opts.ctx;
    this.hostEl = opts.hostEl;
    this.evalBar = opts.evalBar;
    this.boardView = opts.boardView;
    this.sidePanel = opts.sidePanel;
    this.startFen = opts.startFen;
    this.moves = opts.moves || [];
    this.variant = opts.variant || 'xiangqi';
    this.notation = opts.notation || opts.ctx?.settingsStore?.get?.()?.notation || 'traditional';
    this.isUnfinished = Boolean(opts.isUnfinished);
    this.isLiveLocal = Boolean(opts.isLiveLocal);
    this.getBoardState = opts.getBoardState || null;
    this.onSelectPly = opts.onSelectPly || (() => {});
    this.onTryMove = opts.onTryMove || null;
    this.onPreviewFen = opts.onPreviewFen || null;
    this.onClose = opts.onClose || null;
    this.onResultChange = opts.onResultChange || null;

    this.gameKey = gameFingerprint(this.startFen, this.moves);
    this.key = analysisKey(this.startFen, this.moves);
    this.lastRunOpts = { preset: 'fast' };
    this.result = null;
    this.livePosData = null; // live single-position analysis result
    this.prevLivePosData = null; // previous ply live data for move-quality diff
    this.deepCache = new Map(); // `${fen}|ext` -> extended pos data
    this.deepLoading = false;
    this.running = null;
    this.active = false;
    this.viewPly = this.moves.length;
    this.focusedMistakePly = null;
    this.showArrows = true;
    this.mistakesOnly = false;
    this.previewActive = false;
    this.disposed = false;
    this._scrubbing = false;
    this._engineBadgeText = 'Nội bộ (yếu hơn)';
    this._pikafishAvailable = false;

    this._liveScheduler = createLiveAnalysisScheduler({
      debounceMs: 250,
      runSearch: ({ fen, ply, sideToMove, deep }) => this._runSinglePositionSearch(fen, ply, sideToMove, deep),
      onStart: ({ deep }) => {
        if (deep) {
          this.deepLoading = true;
          this._renderNextMoves(this.viewPly);
        }
      },
      onResult: (posRes) => {
        this.deepLoading = false;
        if (!posRes || this.disposed) return;
        if (posRes._deep) {
          this.deepCache.set(posRes.fen, posRes);
          if (this.result) {
            this.result.extensions = { ...(this.result.extensions || {}), [posRes.fen]: posRes };
            if (this.ctx.gameStore && this.result.analyzed > 0) {
              this.ctx.gameStore.putAnalysis(this.result);
            }
          }
        }
        if (this.livePosData && this.livePosData.ply === posRes.ply - 1) {
          this.prevLivePosData = this.livePosData;
        }
        this.livePosData = posRes;
        this._syncLiveUi();
      },
      onError: (err) => {
        this.deepLoading = false;
        if (this.disposed) return;
        this.noticeEl.hidden = false;
        this.noticeEl.textContent = err?.message || 'Không thể phân tích thế cờ.';
        this._renderNextMoves(this.viewPly);
      },
    });

    this._renderSkeleton();
    probeAnalysisEngine().then((info) => {
      if (this.disposed) return;
      this._pikafishAvailable = Boolean(info.available);
      this._engineBadgeText = info.available ? 'Pikafish' : 'Nội bộ (yếu hơn)';
      if (this.engineBadgeEl) this.engineBadgeEl.textContent = this._engineBadgeText;
    });
  }

  _renderSkeleton() {
    this.hostEl.innerHTML = '';
    this.root = document.createElement('section');
    this.root.className = 'analysis-panel';
    this.root.dataset.testid = 'analysis-panel';
    this.root.innerHTML = `
      <div class="an-sticky-header">
        <button type="button" class="mini-seg-btn an-back-btn" data-testid="an-back-btn" title="Về bảng ván cờ (Esc)">← Về ván</button>
        <span class="an-title">Phân tích</span>
        <span class="an-engine-badge" data-testid="an-engine-badge">${this._engineBadgeText}</span>
        <div class="an-menu-wrap">
          <button type="button" class="mini-seg-btn an-more-btn" data-an="more" aria-haspopup="menu" aria-expanded="false" title="Tùy chọn phân tích">⋯</button>
          <div class="an-more-menu" role="menu" hidden>
            <button type="button" class="p-menu-item" role="menuitem" data-an-act="preset-fast">Mức: Nhanh</button>
            <button type="button" class="p-menu-item" role="menuitem" data-an-act="preset-standard">Mức: Chuẩn</button>
            <button type="button" class="p-menu-item" role="menuitem" data-an-act="preset-deep">Mức: Sâu</button>
            <button type="button" class="p-menu-item" role="menuitem" data-an-act="rerun">Phân tích cả ván</button>
            <button type="button" class="p-menu-item" role="menuitem" data-an-act="toggle-arrows">Bật / tắt mũi tên</button>
          </div>
        </div>
      </div>

      <div class="an-scroll-body">
        <div class="an-stepper" data-testid="an-stepper" hidden>
          <button type="button" class="rev-btn" data-an-step="start" title="Thế ban đầu (Home)" aria-label="Thế ban đầu">⏮</button>
          <button type="button" class="rev-btn" data-an-step="prev" title="Nước trước (←)" aria-label="Nước trước">◀</button>
          <span class="an-step-counter" data-testid="an-step-counter">0 / 0</span>
          <button type="button" class="rev-btn" data-an-step="next" title="Nước sau (→)" aria-label="Nước sau">▶</button>
          <button type="button" class="rev-btn" data-an-step="end" title="Nước cuối (End)" aria-label="Nước cuối">⏭</button>
        </div>

        <div class="an-notice" hidden></div>

        <div class="an-run-row" data-testid="an-run-row">
          <button type="button" class="pill-btn pill-btn-compact pill-btn-gold an-btn-run" data-an="run">${this.isLiveLocal ? 'Phân tích cả ván' : 'Phân tích'}</button>
          <button type="button" class="mini-seg-btn an-btn-arrows is-active" data-an="arrows" title="Bật/tắt mũi tên phân tích">Mũi tên</button>
          <button type="button" class="mini-seg-btn an-btn-filter" data-an="filter" title="Chỉ hiện sai lầm">Chỉ hiện sai lầm</button>
        </div>

        <div class="an-progress-wrap" hidden>
          <div class="an-progress-top">
            <span class="an-progress-label">Đang phân tích…</span>
            <button type="button" class="mini-seg-btn an-btn-stop" data-an="stop">Dừng</button>
          </div>
          <div class="an-progress-bar"><div class="an-progress-fill"></div></div>
        </div>

        <!-- B. Verdict Card -->
        <div class="an-verdict-card" data-testid="an-verdict-card" aria-live="polite" hidden></div>

        <!-- C. Move Quality Card -->
        <div class="an-quality-card" data-testid="an-quality-card" aria-live="polite" hidden></div>

        <!-- D. Next Moves (6 plies PV chips + Sâu hơn) -->
        <div class="an-best-card" data-testid="an-next-moves" hidden></div>

        <!-- E. Graph -->
        <div class="an-graph-wrap" hidden>
          <svg class="an-graph-svg" viewBox="0 0 300 72" preserveAspectRatio="none" role="slider" aria-label="Biểu đồ đánh giá"></svg>
          <div class="an-graph-legend">
            <span><i class="an-dot-red"></i>Đỏ ưu</span>
            <span><i class="an-dot-black"></i>Đen ưu</span>
            <span><i class="an-dot-err"></i>Sai lầm</span>
          </div>
        </div>

        <!-- F. Summary -->
        <div class="an-summary-card" hidden></div>
      </div>
    `;
    this.hostEl.appendChild(this.root);

    this.backBtn = this.root.querySelector('[data-testid="an-back-btn"]');
    this.engineBadgeEl = this.root.querySelector('[data-testid="an-engine-badge"]');
    this.moreBtn = this.root.querySelector('[data-an="more"]');
    this.moreMenu = this.root.querySelector('.an-more-menu');
    this.stepperEl = this.root.querySelector('[data-testid="an-stepper"]');
    this.stepCounterEl = this.root.querySelector('[data-testid="an-step-counter"]');
    this.noticeEl = this.root.querySelector('.an-notice');
    this.progressWrap = this.root.querySelector('.an-progress-wrap');
    this.progressLabel = this.root.querySelector('.an-progress-label');
    this.progressFill = this.root.querySelector('.an-progress-fill');
    this.verdictCard = this.root.querySelector('[data-testid="an-verdict-card"]');
    this.qualityCard = this.root.querySelector('[data-testid="an-quality-card"]');
    this.bestCard = this.root.querySelector('[data-testid="an-next-moves"]');
    this.graphWrap = this.root.querySelector('.an-graph-wrap');
    this.graphSvg = this.root.querySelector('.an-graph-svg');
    this.summaryCard = this.root.querySelector('.an-summary-card');
    this.arrowsBtn = this.root.querySelector('[data-an="arrows"]');
    this.filterBtn = this.root.querySelector('[data-an="filter"]');
    this.runBtn = this.root.querySelector('[data-an="run"]');

    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        this.clearPreview();
        if (this.onClose) this.onClose();
      });
    }

    if (this.moreBtn && this.moreMenu) {
      this.moreBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = this.moreMenu.hidden;
        this.moreMenu.hidden = !open;
        this.moreBtn.setAttribute('aria-expanded', String(open));
      });
      this.moreMenu.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-an-act]');
        if (!b) return;
        const act = b.dataset.anAct;
        this.moreMenu.hidden = true;
        this.moreBtn.setAttribute('aria-expanded', 'false');
        if (act === 'preset-fast') this.start({ preset: 'fast' });
        else if (act === 'preset-standard') this.start({ preset: 'standard' });
        else if (act === 'preset-deep') this.start({ preset: 'deep' });
        else if (act === 'rerun') this.openSetupModal();
        else if (act === 'toggle-arrows') this.arrowsBtn.click();
      });
    }

    if (this.variant === 'jieqi') {
      this.noticeEl.hidden = false;
      this.noticeEl.textContent = 'Cờ Úp chưa hỗ trợ phân tích.';
      this.runBtn.disabled = true;
      return;
    }
    if (this.isUnfinished && !this.isLiveLocal) {
      this.noticeEl.hidden = false;
      this.noticeEl.textContent = 'Ván chưa kết thúc — phân tích chỉ khả dụng sau khi kết thúc ván.';
      this.runBtn.disabled = true;
      return;
    }

    this.runBtn.addEventListener('click', () => this.openSetupModal());
    this.root.querySelector('[data-an="stop"]').addEventListener('click', () => this.stop());
    this.arrowsBtn.addEventListener('click', () => {
      this.showArrows = !this.showArrows;
      this.arrowsBtn.classList.toggle('is-active', this.showArrows);
      this._renderArrows(this.viewPly);
    });
    this.filterBtn.addEventListener('click', () => {
      this.mistakesOnly = !this.mistakesOnly;
      this.filterBtn.classList.toggle('is-active', this.mistakesOnly);
      this._applyMoveListFilter();
    });

    if (this.stepperEl) {
      this.stepperEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-an-step]');
        if (!b || b.disabled) return;
        const act = b.dataset.anStep;
        if (act === 'start') this.onSelectPly(0);
        else if (act === 'prev') this.onSelectPly(Math.max(0, this.viewPly - 1));
        else if (act === 'next') this.onSelectPly(Math.min(this.moves.length, this.viewPly + 1));
        else if (act === 'end') this.onSelectPly(this.moves.length);
      });
    }

    this._bindGraphScrub();
  }

  _bindGraphScrub() {
    const plyFromX = (clientX) => {
      const rect = this.graphSvg.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(t * this.moves.length);
    };
    this.graphSvg.addEventListener('pointerdown', (ev) => {
      if (!this.result) return;
      const dot = ev.target.closest('circle[data-mistake-ply]');
      if (dot) {
        this.selectMove(Number(dot.dataset.mistakePly));
        return;
      }
      this._scrubbing = true;
      try { this.graphSvg.setPointerCapture(ev.pointerId); } catch {}
      this.onSelectPly(plyFromX(ev.clientX), { isScrub: true });
    });
    this.graphSvg.addEventListener('pointermove', (ev) => {
      if (!this._scrubbing || !this.result) return;
      this.onSelectPly(plyFromX(ev.clientX), { isScrub: true });
    });
    const endScrub = (ev) => {
      if (this._scrubbing) {
        try {
          if (this.graphSvg.hasPointerCapture(ev.pointerId)) {
            this.graphSvg.releasePointerCapture(ev.pointerId);
          }
        } catch {}
      }
      this._scrubbing = false;
    };
    this.graphSvg.addEventListener('pointerup', endScrub);
    this.graphSvg.addEventListener('pointercancel', endScrub);
  }

  /** Sync startFen, moves, viewPly from live GameController whenever getBoardState is wired. */
  _syncFromBoardState() {
    if (!this.getBoardState || this.disposed) return null;
    const st = this.getBoardState();
    const nextMoves = Array.isArray(st.moves) ? st.moves : [];
    const nextGameKey = gameFingerprint(st.startFen, nextMoves);
    const gameChanged = nextGameKey !== this.gameKey;
    this.startFen = st.startFen;
    this.moves = nextMoves;
    this.viewPly = typeof st.viewPly === 'number' ? st.viewPly : nextMoves.length;
    if (gameChanged) {
      this.gameKey = nextGameKey;
      this.key = analysisKey(this.startFen, this.moves);
      if (this.result && this.result.gameKey !== this.gameKey) {
        this.result = null;
        this.focusedMistakePly = null;
        if (this.graphWrap) this.graphWrap.hidden = true;
        if (this.summaryCard) this.summaryCard.hidden = true;
        if (this.qualityCard) this.qualityCard.hidden = true;
        if (this.verdictCard) this.verdictCard.hidden = true;
        if (this.bestCard) this.bestCard.hidden = true;
        if (this.runBtn) this.runBtn.textContent = this.isLiveLocal ? 'Phân tích cả ván' : 'Phân tích';
      }
    }
    this._syncStepper();
    return st;
  }

  _syncStepper() {
    if (!this.stepperEl || !this.stepCounterEl) return;
    const total = this.moves.length;
    this.stepperEl.hidden = total === 0;
    this.stepCounterEl.textContent = `Nước ${this.viewPly} / ${total}`;
    const setDis = (sel, dis) => {
      const b = this.stepperEl.querySelector(sel);
      if (b) b.disabled = dis;
    };
    setDis('[data-an-step="start"]', total === 0 || this.viewPly <= 0);
    setDis('[data-an-step="prev"]', total === 0 || this.viewPly <= 0);
    setDis('[data-an-step="next"]', total === 0 || this.viewPly >= total);
    setDis('[data-an-step="end"]', total === 0 || this.viewPly >= total);
  }

  setNotation(notation) {
    const next = notation === 'coord' ? 'coord' : 'traditional';
    if (this.notation === next) return;
    this.notation = next;
    this._renderQuality(this.viewPly);
    this._renderNextMoves(this.viewPly);
    this._renderSummary();
  }

  /** Activate or deactivate panel (starts/stops live local analysis & eval bar). */
  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) {
      this.clearPreview();
      this._liveScheduler.cancel();
      if (this.boardView && typeof this.boardView.setAnalysisArrows === 'function') {
        this.boardView.setAnalysisArrows([]);
      }
      return;
    }
    this._syncFromBoardState();
    if (this.evalBar) this.evalBar.setVisible(true);
    if (this.isLiveLocal) {
      this.refreshLiveLocalState();
    } else {
      if (!this.result && this.moves.length > 0) {
        this.loadCached().then((hit) => {
          if (this.disposed || !this.active) return;
          if (hit) {
            this.syncPly(this.viewPly);
          } else {
            this.noticeEl.hidden = false;
            this.noticeEl.textContent = `Ván đấu có ${this.moves.length} nước — bấm "Phân tích" để đánh giá toàn bộ ván và vẽ biểu đồ.`;
          }
        });
      }
      this.syncPly(this.viewPly);
    }
  }

  /** Sync game state when moves are played / undone / stepped while panel is mounted. */
  refreshLiveLocalState() {
    if (!this.getBoardState || this.disposed) return;
    const st = this._syncFromBoardState();
    if (!st) return;
    this.clearPreview();
    if (!this.active) return;
    if (this.result) {
      this.syncPly(st.viewPly);
      return;
    }
    if (!this.isLiveLocal || this.running) return;
    this._liveScheduler.schedule({
      fen: st.currentFen,
      ply: st.viewPly,
      sideToMove: st.sideToMove,
      deep: false,
    });
  }

  _runSinglePositionSearch(fen, ply, sideToMove, deep = false) {
    const reqId = `live_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
    let cancelled = false;
    let worker = null;

    const cancel = () => {
      cancelled = true;
      if (worker) {
        try { worker.terminate(); } catch {}
        worker = null;
      }
      if (this._pikafishAvailable && typeof fetch === 'function') {
        fetch('/api/engine/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: reqId }),
        }).catch(() => {});
      }
    };

    const promise = (async () => {
      if (this._pikafishAvailable && typeof fetch === 'function') {
        const res = await fetch('/api/engine/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: reqId,
            fen,
            movetime_ms: deep ? 3000 : 1000,
            multipv: 2,
          }),
        });
        if (!res.ok) {
          const msg = res.status === 409 ? 'Động cơ đang bận ở tác vụ khác. Vui lòng thử lại.' : `HTTP ${res.status}`;
          const err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        if (cancelled) return null;
        const rawLines = Array.isArray(data.lines) && data.lines.length > 0
          ? data.lines
          : data.bestmove
            ? [{ move: data.bestmove, score: data.score, wdl: data.wdl, depth: data.depth, pv: data.pv || [data.bestmove] }]
            : [];
        const lines = rawLines.map((ln) => ({
          move: ln.move,
          scoreRed: normalizeToRed(ln.score, sideToMove),
          wdlRed: wdlToRed(ln.wdl, sideToMove),
          depth: ln.depth || data.depth || 0,
          pv: Array.isArray(ln.pv) ? ln.pv : ln.move ? [ln.move] : [],
        }));
        return {
          ply,
          fen,
          sideToMove,
          bestmove: data.bestmove || lines[0]?.move || null,
          scoreRed: normalizeToRed(data.score, sideToMove),
          wdlRed: wdlToRed(data.wdl, sideToMove),
          depth: data.depth || 0,
          lines,
          _deep: deep,
        };
      }

      // JS Web Worker fallback (depth 5, or depth 6 for "Sâu hơn")
      return await new Promise((resolve, reject) => {
        worker = new Worker(new URL('../ai/worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (ev) => {
          const d = ev.data;
          if (!d || d.type !== 'analyze_result') return;
          try { worker.terminate(); } catch {}
          worker = null;
          if (cancelled) return resolve(null);
          const isMate0 = !d.move && typeof d.score === 'number' && d.score <= -29000;
          const rawScore = isMate0 ? { mate: 0 } : { cp: d.score || 0 };
          const scoreRed = normalizeToRed(rawScore, sideToMove);
          const pv = Array.isArray(d.pv) && d.pv.length > 0 ? d.pv : d.move ? [d.move] : [];
          resolve({
            ply,
            fen,
            sideToMove,
            bestmove: d.move || pv[0] || null,
            scoreRed,
            wdlRed: null,
            depth: d.depth || (deep ? 6 : 5),
            lines: d.move ? [{ move: d.move, scoreRed, wdlRed: null, depth: d.depth || 5, pv }] : [],
            _deep: deep,
          });
        };
        worker.onerror = (err) => {
          try { worker?.terminate(); } catch {}
          worker = null;
          reject(err);
        };
        worker.postMessage({
          type: 'analyze_pos',
          id: 1,
          fen,
          depth: deep ? 6 : 5,
          timeBudgetMs: deep ? 2500 : 1200,
        });
      });
    })();

    return { cancel, promise };
  }

  _syncLiveUi() {
    if (!this.livePosData) return;
    if (this.evalBar) {
      this.evalBar.setVisible(true);
      this.evalBar.setScore(this.livePosData.scoreRed, this.livePosData.wdlRed);
    }
    this._renderVerdict(this.livePosData);
    this._renderQuality(this.viewPly);
    this._renderNextMoves(this.viewPly);
    this._renderArrows(this.viewPly);
    if (this.ctx.testMode && typeof window !== 'undefined') {
      window.__liveAnalysis = this.livePosData;
    }
  }

  clearPreview() {
    if (!this.previewActive) return;
    this.previewActive = false;
    if (this.onPreviewFen) this.onPreviewFen(null);
    this._renderArrows(this.viewPly);
  }

  async loadCached() {
    if (this.variant === 'jieqi' || (this.isUnfinished && !this.isLiveLocal) || !this.ctx.gameStore) return null;
    const all = this.ctx.gameStore.listAnalyses ? await this.ctx.gameStore.listAnalyses() : [];
    const hit = all.find(
      (a) =>
        a &&
        (a.gameKey === this.gameKey ||
          (a.startFen === this.startFen &&
            Array.isArray(a.moves) &&
            a.moves.length === this.moves.length &&
            a.moves.every((m, i) => m === this.moves[i])))
    );
    if (hit && !this.disposed) {
      if (hit.extensions) {
        for (const [f, v] of Object.entries(hit.extensions)) this.deepCache.set(f, v);
      }
      this.applyResult(hit, { persist: false });
      return hit;
    }
    return null;
  }

  async openSetupModal() {
    if (this.variant === 'jieqi' || (this.isUnfinished && !this.isLiveLocal)) return;
    this._syncFromBoardState();
    const modalRoot = this.ctx.modalRoot;
    if (!modalRoot) return;
    const engInfo = await probeAnalysisEngine();
    if (this.disposed) return;

    const isTouch =
      Boolean(window.matchMedia?.('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    let selectedPreset = 'fast';
    const maxPly = this.moves.length;
    const estMsPerPly = (preset) => {
      if (engInfo.available) return (ANALYSIS_PRESETS[preset] || ANALYSIS_PRESETS.fast).movetimeMs;
      return preset === 'deep' ? 1800 : preset === 'standard' ? 900 : 350;
    };
    const formatEst = (plies, preset) => {
      const sec = Math.max(1, Math.ceil((plies * estMsPerPly(preset)) / 1000));
      if (sec < 60) return { sec, text: `Ước tính: ~${sec} giây (${plies} thế cờ)` };
      const mins = Math.floor(sec / 60);
      const rem = sec % 60;
      return { sec, text: `Ước tính: ~${mins} phút ${rem > 0 ? `${rem} giây` : ''} (${plies} thế cờ)` };
    };

    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      modalRoot.hidden = true;
      modalRoot.innerHTML = '';
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);

    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="an-setup-title">
        <div class="modal-card setup-modal">
          <h3 id="an-setup-title">Phân tích cả ván</h3>
          <p class="set-hint">
            Động cơ: <strong>${engInfo.available ? engInfo.name : 'Nội bộ (JS)'}</strong>
            ${engInfo.available ? '(WDL + MultiPV 2)' : '(chạy trực tiếp trên trình duyệt)'}
          </p>
          ${
            !engInfo.available && isTouch
              ? '<p class="set-hint" data-testid="an-battery-hint" style="color:#facc15">Trên thiết bị cảm ứng, phân tích bằng JS có thể tốn pin — mặc định chọn mức Nhanh.</p>'
              : ''
          }
          <div class="set-field" style="margin-top:10px">
            <label>Mức phân tích</label>
            <div class="set-seg-3 an-preset-row">
              <button type="button" class="mini-seg-btn is-active" data-preset="fast">Nhanh</button>
              <button type="button" class="mini-seg-btn" data-preset="standard">Chuẩn</button>
              <button type="button" class="mini-seg-btn" data-preset="deep">Sâu</button>
            </div>
          </div>
          <p class="set-hint an-preset-desc" style="margin-top:8px"></p>
          <p class="set-hint an-est-line" data-testid="an-est-line"></p>
          <div class="an-long-warn" data-testid="an-long-warn" hidden>
            <p class="set-hint" style="color:#facc15;margin:0 0 6px">Ván dài hoặc ước tính trên 5 phút — bạn có thể chỉ phân tích một đoạn:</p>
            <div style="display:flex;gap:8px;align-items:center">
              <label style="font-size:12px">Từ nước <input type="number" class="set-input an-from-ply" min="0" max="${maxPly}" value="0" style="width:72px"></label>
              <label style="font-size:12px">Đến nước <input type="number" class="set-input an-to-ply" min="0" max="${maxPly}" value="${maxPly}" style="width:72px"></label>
            </div>
          </div>
          <div class="modal-actions" style="margin-top:14px">
            <button type="button" class="pill-btn modal-cancel">Đóng</button>
            <button type="button" class="pill-btn pill-btn-gold modal-an-start">Bắt đầu phân tích</button>
          </div>
        </div>
      </div>
    `;

    const descEl = modalRoot.querySelector('.an-preset-desc');
    const estEl = modalRoot.querySelector('.an-est-line');
    const longWarnEl = modalRoot.querySelector('.an-long-warn');
    const fromInput = modalRoot.querySelector('.an-from-ply');
    const toInput = modalRoot.querySelector('.an-to-ply');
    const descs = engInfo.available
      ? { fast: '150 ms/nước · rất nhanh', standard: '600 ms/nước · cân bằng', deep: '2000 ms/nước · chi tiết nhất' }
      : { fast: 'Độ sâu 4 · nhanh', standard: 'Độ sâu 5 · cân bằng', deep: 'Độ sâu 6 · chậm hơn' };

    const refreshEst = () => {
      const f = Math.max(0, Math.min(maxPly, Number(fromInput.value) || 0));
      const t = Math.max(f, Math.min(maxPly, Number(toInput.value) || maxPly));
      const plies = t - f + 1;
      const est = formatEst(plies, selectedPreset);
      descEl.textContent = descs[selectedPreset];
      estEl.textContent = est.text;
      longWarnEl.hidden = !(maxPly > 150 || est.sec > 300);
    };
    refreshEst();

    fromInput.addEventListener('input', refreshEst);
    toInput.addEventListener('input', refreshEst);
    modalRoot.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedPreset = btn.dataset.preset;
        modalRoot.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('is-active', b === btn));
        refreshEst();
      });
    });
    modalRoot.querySelector('.modal-cancel').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
    modalRoot.querySelector('.modal-an-start').addEventListener('click', () => {
      const f = Math.max(0, Math.min(maxPly, Number(fromInput.value) || 0));
      const t = Math.max(f, Math.min(maxPly, Number(toInput.value) || maxPly));
      close();
      this.start({ preset: selectedPreset, fromPly: f, toPly: t });
    });
  }

  start({ preset = 'fast', forceEngine = undefined, fromPly = 0, toPly = undefined } = {}) {
    if (this.variant === 'jieqi' || (this.isUnfinished && !this.isLiveLocal)) return null;
    this._syncFromBoardState();
    this._liveScheduler.cancel();
    this.stop();
    this.lastRunOpts = { preset, forceEngine, fromPly, toPly };
    const endPly = toPly ?? this.moves.length;
    const totalPositions = Math.max(1, endPly - fromPly + 1);
    this.noticeEl.hidden = true;
    this.noticeEl.innerHTML = '';
    this.progressWrap.hidden = false;
    this.progressFill.style.width = '2%';
    this.progressLabel.textContent = `Đang phân tích 0 / ${totalPositions}…`;
    this.runBtn.disabled = true;

    const handle = runGameAnalysis({
      startFen: this.startFen,
      moves: this.moves,
      preset,
      forceEngine,
      fromPly,
      toPly: endPly,
      onProgress: (snap) => {
        if (this.disposed || this.running?.id !== handle.id) return;
        const pct = Math.round((snap.analyzed / Math.max(1, snap.total)) * 100);
        this.progressFill.style.width = `${pct}%`;
        this.progressLabel.textContent = `Đang phân tích ${snap.analyzed} / ${snap.total} (${snap.engineName})…`;
        this.applyResult(snap, { persist: false, live: true });
      },
      onDone: (finalRes) => {
        if (this.disposed || this.running?.id !== handle.id) return;
        this.running = null;
        this.progressWrap.hidden = true;
        this.runBtn.disabled = false;
        this.runBtn.textContent = 'Phân tích lại';
        this.applyResult(finalRes, { persist: true });
      },
      onError: (err, partialSnap) => {
        if (this.disposed || this.running?.id !== handle.id) return;
        this.running = null;
        this.progressWrap.hidden = true;
        this.runBtn.disabled = false;
        if (partialSnap && partialSnap.analyzed > 0) {
          this.applyResult(partialSnap, { persist: true });
        }
        this.noticeEl.hidden = false;
        this.noticeEl.innerHTML = '';
        const span = document.createElement('span');
        span.textContent = `Không thể phân tích: ${err?.message || err} `;
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'mini-seg-btn';
        retryBtn.dataset.an = 'retry';
        retryBtn.textContent = 'Thử lại';
        retryBtn.addEventListener('click', () => this.start(this.lastRunOpts));
        this.noticeEl.append(span, retryBtn);
      },
    });
    this.running = handle;
    handle.promise.catch(() => {});
    return handle;
  }

  stop() {
    if (this.running) {
      const h = this.running;
      h.cancel();
      this.running = null;
      this.progressWrap.hidden = true;
      this.runBtn.disabled = false;
      if (this.result) {
        this.result.summary.incomplete = true;
        this.result.cancelled = true;
        this.applyResult(this.result, { persist: true });
      }
    }
  }

  applyResult(res, { persist = false } = {}) {
    this.result = res;
    if (this.evalBar) this.evalBar.setVisible(true);
    this._renderGraph();
    this._renderSummary();
    this._renderMoveBadges();
    this.syncPly(this.viewPly);
    if (persist && this.ctx.gameStore && res.analyzed > 0) {
      this.ctx.gameStore.putAnalysis(res);
    }
    if (this.onResultChange) this.onResultChange(res);
    if (this.ctx.testMode && typeof window !== 'undefined') {
      window.__analysis = res;
    }
  }

  selectMove(ply, opts = {}) {
    this.clearPreview();
    if (this.result && ply > 0) {
      const ann = (this.result.moveAnnotations || []).find((a) => a.ply === ply);
      if (ann && isMistakeClass(ann.cls)) {
        this.focusedMistakePly = ply;
        this.onSelectPly(ply - 1, { ...opts, keepMistakeFocus: true });
        return;
      }
    }
    this.focusedMistakePly = null;
    this.onSelectPly(ply, opts);
  }

  syncPly(ply, opts = {}) {
    this.viewPly = ply;
    this.clearPreview();
    if (!opts.keepMistakeFocus || this.focusedMistakePly !== ply + 1) {
      this.focusedMistakePly = null;
    }
    this._syncStepper();
    const pos = this._activePosForPly(ply);
    if (pos && this.evalBar) {
      this.evalBar.setScore(pos.scoreRed, pos.wdlRed);
    }
    this._renderGraphCursor();
    this._renderVerdict(pos);
    this._renderQuality(ply);
    this._renderNextMoves(ply);
    this._renderArrows(ply);
  }

  _currentFenForPly(ply) {
    if (this.getBoardState) {
      const st = this.getBoardState();
      if (st.viewPly === ply && st.currentFen) return st.currentFen;
    }
    if (this.sidePanel?.board && typeof this.sidePanel.board.snapshotAt === 'function') {
      return this.sidePanel.board.snapshotAt(ply).fen;
    }
    return this.startFen;
  }

  _activePosForPly(ply) {
    const fen = this._currentFenForPly(ply);
    if (fen && this.deepCache.has(fen)) return this.deepCache.get(fen);
    if (this.result) {
      const hit = this.result.positions.find((p) => p.ply === ply);
      if (hit) return hit;
    }
    if (this.livePosData && this.livePosData.ply === ply) return this.livePosData;
    return this.livePosData || (this.result?.positions?.[this.result.positions.length - 1] ?? null);
  }

  // B. Verdict Card
  _renderVerdict(pos) {
    if (!pos) {
      this.verdictCard.hidden = true;
      return;
    }
    this.verdictCard.hidden = false;
    const wp = winPercent(pos.scoreRed, pos.wdlRed);
    const redPct = Math.round(wp);
    const blackPct = 100 - redPct;
    const band = verdictForWinPercent(wp);
    const scoreTxt = formatScoreLongVi(pos.scoreRed);

    this.verdictCard.innerHTML = `
      <div class="an-verdict-top">
        <span class="an-verdict-label is-${band.side}">${band.label}</span>
        <span class="an-verdict-score">${scoreTxt}</span>
      </div>
      <div class="an-winprob-bar" role="img" aria-label="Đỏ ${redPct}%, Đen ${blackPct}%">
        <div class="an-winprob-red" style="width:${redPct}%"></div>
      </div>
      <div class="an-winprob-labels">
        <span>Đỏ ${redPct} %</span>
        <span>Đen ${blackPct} %</span>
      </div>
    `;
  }

  // C. Move Quality Card
  _renderQuality(ply) {
    let ann = null;
    if (this.result) {
      if (this.focusedMistakePly && ply === this.focusedMistakePly - 1) {
        ann = (this.result.moveAnnotations || []).find((a) => a.ply === this.focusedMistakePly) || null;
      } else if (ply > 0) {
        ann = (this.result.moveAnnotations || []).find((a) => a.ply === ply) || null;
      }
    } else if (this.livePosData && this.prevLivePosData && ply > 0 && this.moves[ply - 1]) {
      const played = this.moves[ply - 1];
      const moverSide = (ply - 1) % 2 === 0 ? 'red' : 'black';
      const c = classifyMove({
        ply,
        playedMove: played,
        bestMove: this.prevLivePosData.bestmove,
        beforeScoreRed: this.prevLivePosData.scoreRed,
        beforeWdlRed: this.prevLivePosData.wdlRed,
        afterScoreRed: this.livePosData.scoreRed,
        afterWdlRed: this.livePosData.wdlRed,
        moverSide,
      });
      ann = { ply, move: played, side: moverSide, bestMove: this.prevLivePosData.bestmove, ...c };
    }

    if (!ann) {
      this.qualityCard.hidden = true;
      return;
    }
    this.qualityCard.hidden = false;
    const sideVi = ann.side === 'red' ? 'Đỏ' : 'Đen';
    const dropRounded = Math.round(ann.winDrop || 0);
    const beforeFen = this._currentFenForPly(Math.max(0, ann.ply - 1));
    const mvFmt = formatMoveWithParen({
      position: beforeFen,
      move: ann.move,
      variant: this.variant,
      setting: this.notation,
    });
    const bestFmt =
      ann.bestMove && ann.bestMove !== ann.move
        ? formatMoveWithParen({
            position: beforeFen,
            move: ann.bestMove,
            variant: this.variant,
            setting: this.notation,
          })
        : null;
    const betterTxt = bestFmt ? ` Nước tốt hơn: ${bestFmt.text}.` : '';
    const sentence =
      dropRounded > 0
        ? `Nước này làm ${sideVi} mất ${dropRounded} % cơ hội thắng.${betterTxt}`
        : `Nước đi chuẩn xác của ${sideVi}.${betterTxt}`;
    const showBetterBtns = isMistakeClass(ann.cls) && ann.bestMove && ann.bestMove !== ann.move;

    this.qualityCard.innerHTML = `
      <div class="an-quality-head" style="border-left:3px solid ${ann.color}">
        <span class="an-quality-sym" style="color:${ann.color}">${ann.symbol}</span>
        <strong>${ann.label}</strong>
        <span class="an-quality-mv">Nước ${ann.ply}: ${mvFmt.html}</span>
      </div>
      <p class="an-quality-desc">${sentence}</p>
      ${
        showBetterBtns
          ? `<div class="an-quality-actions">
              <button type="button" class="mini-seg-btn" data-qact="show-better">Xem nước tốt hơn</button>
              ${this.onTryMove ? `<button type="button" class="mini-seg-btn" data-qact="try-better">Thử nước này</button>` : ''}
            </div>`
          : ''
      }
    `;
    const sb = this.qualityCard.querySelector('[data-qact="show-better"]');
    if (sb) sb.addEventListener('click', () => this.selectMove(ann.ply));
    const tb = this.qualityCard.querySelector('[data-qact="try-better"]');
    if (tb && this.onTryMove) tb.addEventListener('click', () => this.onTryMove(ann.ply - 1, ann.bestMove));
  }

  // D. Next Moves (6 plies validated PV chips + ghost preview + Sâu hơn 8 plies)
  _renderNextMoves(ply) {
    const pos = this._activePosForPly(ply);
    if (!pos) {
      this.bestCard.hidden = true;
      return;
    }
    this.bestCard.hidden = false;
    const fen = this._currentFenForPly(ply);
    const isDeep = Boolean(pos._deep || this.deepCache.has(fen));
    const maxPlies = isDeep ? 8 : 6;
    const themeId = this.ctx.getTheme ? this.ctx.getTheme().id : 'go-lim';

    const data = this.result ? selectAnalysisPositionData(this.result, ply, this.focusedMistakePly) : null;
    const lines = (pos.lines || []).slice(0, 2);

    const buildLineHtml = (ln, idx) => {
      const pvArr = ln.pv || (ln.move ? [ln.move] : []);
      const built = buildValidatedPvChips(fen, pvArr, maxPlies);
      const shortLabels = formatLine(fen, pvArr.slice(0, built.chips.length), { variant: this.variant, style: 'short' });
      const fullLabels = formatLine(fen, pvArr.slice(0, built.chips.length), { variant: this.variant, style: 'full' });
      const chipsHtml = built.chips
        .map((c, ci) => {
          const symId = pieceSymbolId(themeId, c.side, c.kind, 'live');
          const label = this.notation === 'coord' ? c.iccs : (shortLabels[ci] || c.iccs);
          const fullTitle = this.notation === 'coord' ? (fullLabels[ci] || c.iccs) : `${fullLabels[ci] || c.iccs} (${c.iccs})`;
          return `<button type="button" class="an-pv-chip is-${c.side}" data-line="${idx}" data-chip-idx="${c.plyOffset - 1}" data-move="${c.iccs}" data-preview-fen="${c.fenAfter}" title="${fullTitle}">
            <span class="an-pv-num">${c.plyOffset}.</span>
            <svg viewBox="0 0 120 120" width="16" height="16" aria-hidden="true"><use href="#${symId}" width="120" height="120"/></svg>
            <span>${label}</span>
          </button>`;
        })
        .join('');
      return `
        <div class="an-pv-line-block">
          <div class="an-pv-line-head">
            <span class="an-line-score">${formatEvalScore(ln.scoreRed)}</span>
            <span class="set-hint">Phương án ${idx + 1} (độ sâu ${ln.depth || pos.depth || '?'})</span>
            ${this.onTryMove && ln.move ? `<button type="button" class="mini-seg-btn an-try-btn" data-try-move="${ln.move}">Thử nước này</button>` : ''}
          </div>
          <div class="an-pv-chips">${chipsHtml || '<span class="set-hint">Không còn nước đi.</span>'}</div>
        </div>
      `;
    };

    const playedFmt =
      data && data.playedNext
        ? formatMoveWithParen({
            position: fen,
            move: data.playedNext.move,
            variant: this.variant,
            setting: this.notation,
          })
        : null;
    const playedHtml =
      data && data.playedNext && playedFmt
        ? `<div class="an-played-row" data-testid="an-played-row" style="border-left:3px solid ${data.playedNext.color}">
            <span>Nước đã đi: ${playedFmt.html} (${formatEvalScore(data.playedNext.scoreRed)})</span>
            <span style="color:${data.playedNext.color};font-weight:700">${data.playedNext.symbol} ${data.playedNext.label}</span>
          </div>`
        : '';

    this.bestCard.innerHTML = `
      <div class="an-next-head">
        <strong>Phương án tiếp theo (${maxPlies} nước)</strong>
        <button type="button" class="mini-seg-btn an-deeper-btn" data-an="deeper" ${this.deepLoading ? 'disabled' : ''}>
          ${this.deepLoading ? 'Đang tính…' : isDeep ? 'Đã sâu (8 nước)' : 'Sâu hơn'}
        </button>
      </div>
      ${lines.map(buildLineHtml).join('') || '<span class="set-hint">Không còn nước đi.</span>'}
      ${playedHtml}
    `;

    // Bind PV chip non-destructive ghost preview (with numbered arrows 1..k ONLY while previewing)
    const builtLines = lines.map((ln) => buildValidatedPvChips(fen, ln.pv || (ln.move ? [ln.move] : []), maxPlies).chips);
    const moverSide = /\s+b(\s|$)/.test(fen) ? 'black' : 'red';
    this.bestCard.querySelectorAll('.an-pv-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const previewFen = chip.dataset.previewFen;
        if (!previewFen || !this.onPreviewFen) return;
        const lineIdx = Number(chip.dataset.line) || 0;
        const chipIdx = Number(chip.dataset.chipIdx) || 0;
        const seq = (builtLines[lineIdx] || []).slice(0, chipIdx + 1);
        const pvArrows = seq.map((c, i) => ({
          from: c.from,
          to: c.to,
          move: c.iccs,
          kind: i === 0 ? 'best' : 'pv',
          color: c.side === moverSide ? '#38BDF8' : '#94A3B8',
          opacity: i === seq.length - 1 ? 0.95 : Math.max(0.45, 0.82 - i * 0.08),
          badge: String(i + 1),
        }));
        this.previewActive = true;
        this.bestCard.querySelectorAll('.an-pv-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
        this.onPreviewFen(previewFen, pvArrows);
      });
    });

    if (this.onTryMove) {
      this.bestCard.querySelectorAll('[data-try-move]').forEach((btn) => {
        btn.addEventListener('click', () => this.onTryMove(ply, btn.dataset.tryMove));
      });
    }

    const deeperBtn = this.bestCard.querySelector('[data-an="deeper"]');
    if (deeperBtn && !isDeep) {
      deeperBtn.addEventListener('click', () => {
        const sideToMove = /\s+b(\s|$)/.test(fen) ? 'black' : 'red';
        this._liveScheduler.schedule({ fen, ply, sideToMove, deep: true });
      });
    }
  }

  // E. Graph
  _renderGraph() {
    if (!this.result || !this.result.positions.length) {
      this.graphWrap.hidden = true;
      return;
    }
    this.graphWrap.hidden = false;
    const W = 300;
    const H = 72;
    const total = Math.max(1, this.moves.length);
    const pts = [];
    for (const p of this.result.positions) {
      const x = (p.ply / total) * W;
      const wp = winPercent(p.scoreRed, p.wdlRed);
      const y = H - (wp / 100) * H;
      pts.push({ ply: p.ply, x, y, wp });
    }
    pts.sort((a, b) => a.ply - b.ply);
    const linePts = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const lastX = pts[pts.length - 1].x.toFixed(1);
    const firstX = pts[0].x.toFixed(1);
    const redArea = `${firstX},${H} ${linePts} ${lastX},${H}`;
    const blackArea = `${firstX},0 ${linePts} ${lastX},0`;

    const markers = (this.result.moveAnnotations || [])
      .filter((a) => a.cls === 'blunder' || a.cls === 'missed_mate' || a.cls === 'mistake')
      .map((a) => {
        const pt = pts.find((p) => p.ply === a.ply);
        if (!pt) return '';
        const color = a.cls === 'mistake' ? '#FB923C' : '#F87171';
        return `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.2" fill="${color}" data-mistake-ply="${a.ply}" style="cursor:pointer"/>`;
      })
      .join('');

    this.graphSvg.innerHTML = `
      <polygon points="${blackArea}" fill="rgba(40,44,52,0.75)"/>
      <polygon points="${redArea}" fill="rgba(217,83,79,0.52)"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3" stroke-width="1"/>
      <polyline points="${linePts}" fill="none" stroke="#F4E2B8" stroke-width="1.6"/>
      ${markers}
      <line class="an-graph-cursor" x1="0" y1="0" x2="0" y2="${H}" stroke="#D9A441" stroke-width="1.8"/>
    `;
    this._renderGraphCursor();
  }

  _renderGraphCursor() {
    const cur = this.graphSvg?.querySelector('.an-graph-cursor');
    if (!cur) return;
    const total = Math.max(1, this.moves.length);
    const x = ((Math.max(0, Math.min(total, this.viewPly)) / total) * 300).toFixed(1);
    cur.setAttribute('x1', x);
    cur.setAttribute('x2', x);
  }

  // F. Summary
  _renderSummary() {
    if (!this.result || !this.result.summary) {
      this.summaryCard.hidden = true;
      return;
    }
    const s = this.result.summary;
    this.summaryCard.hidden = false;

    const incompleteBadge = s.incomplete
      ? `<div class="an-incomplete-badge" data-testid="analysis-incomplete">Chưa đầy đủ (${this.result.analyzed}/${this.result.total})</div>`
      : '';

    const topHtml =
      s.topMistakes && s.topMistakes.length > 0
        ? `<div class="an-top-mistakes">
            <div class="an-sub-title">Sai lầm lớn nhất</div>
            ${s.topMistakes
              .map((m) => {
                const mFen = this._currentFenForPly(Math.max(0, m.ply - 1));
                const mf = formatMoveWithParen({
                  position: mFen,
                  move: m.move,
                  variant: this.variant,
                  setting: this.notation,
                });
                return `
              <button type="button" class="an-mistake-item" data-jump-ply="${m.ply}" data-move="${m.move}">
                <span class="an-mistake-sym" style="color:${m.color}">${m.symbol}</span>
                <span>Nước ${m.ply} (${m.side === 'red' ? 'Đỏ' : 'Đen'}): ${mf.html}</span>
                <span class="an-mistake-drop">-${Math.round(m.winDrop)}%</span>
              </button>`;
              })
              .join('')}
          </div>`
        : `<p class="set-hint" style="margin:6px 0 0">Không có sai lầm đáng kể.</p>`;

    const cntRow = (side, name) => {
      const c = s.counts[side];
      return `<div class="an-cnt-row"><span>${name}</span><span>★${c.best + c.only_move} · ?!${c.inaccuracy} · ?${c.mistake} · ??${c.blunder + c.missed_mate}</span></div>`;
    };

    this.summaryCard.innerHTML = `
      ${incompleteBadge}
      <div class="an-rings-row">
        ${ringSvg(s.redAccuracy, 'Đỏ', 'is-red')}
        ${ringSvg(s.blackAccuracy, 'Đen', 'is-black')}
      </div>
      <div class="an-counts">
        ${cntRow('red', 'Đỏ')}
        ${cntRow('black', 'Đen')}
      </div>
      ${topHtml}
    `;

    this.summaryCard.querySelectorAll('[data-jump-ply]').forEach((btn) => {
      btn.addEventListener('click', () => this.selectMove(Number(btn.dataset.jumpPly)));
    });
  }

  _renderMoveBadges() {
    if (!this.sidePanel || !this.sidePanel.moveRows || !this.result) return;
    const annByPly = new Map();
    for (const a of this.result.moveAnnotations || []) annByPly.set(a.ply, a);

    for (const chip of this.sidePanel.moveRows.querySelectorAll('button.move-chip[data-ply]')) {
      const ply = Number(chip.dataset.ply);
      const prev = chip.querySelector('.move-an-badge');
      if (prev) prev.remove();
      const ann = annByPly.get(ply);
      if (!ann) continue;
      chip.dataset.anClass = ann.cls;
      const b = document.createElement('span');
      b.className = `move-an-badge is-cls-${ann.cls}`;
      b.style.color = ann.color;
      b.textContent = ann.symbol;
      b.title = `${ann.label} (-${Math.round(ann.winDrop)}%)`;
      chip.appendChild(b);
    }
    this._applyMoveListFilter();
  }

  _applyMoveListFilter() {
    if (!this.sidePanel || !this.sidePanel.moveRows) return;
    const isErr = (cls) => cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder' || cls === 'missed_mate';
    for (const row of this.sidePanel.moveRows.querySelectorAll('.move-row')) {
      if (!this.mistakesOnly) {
        row.hidden = false;
        continue;
      }
      const chips = [...row.querySelectorAll('button.move-chip')];
      const hasMistake = chips.some((c) => isErr(c.dataset.anClass));
      row.hidden = !hasMistake;
    }
  }

  _renderArrows(ply) {
    if (!this.boardView || typeof this.boardView.setAnalysisArrows !== 'function') return;
    if (!this.showArrows || !this.active) {
      this.boardView.setAnalysisArrows([]);
      return;
    }
    if (this.result) {
      const data = selectAnalysisPositionData(this.result, ply, this.focusedMistakePly);
      if (data) {
        this.boardView.setAnalysisArrows(data.arrows || []);
        return;
      }
    }
    const pos = this._activePosForPly(ply);
    if (!pos) {
      this.boardView.setAnalysisArrows([]);
      return;
    }
    // Live single-position mode: draw clean best-move (blue) + optional 2nd-best (subtle grey)
    const arrows = [];
    const best = parseIccs(pos.bestmove || pos.lines?.[0]?.move);
    if (best) {
      arrows.push({ from: best.from, to: best.to, move: pos.bestmove || pos.lines?.[0]?.move, kind: 'best', color: '#38BDF8', opacity: 0.92 });
    }
    const second = pos.lines?.[1]?.move ? parseIccs(pos.lines[1].move) : null;
    if (second && pos.lines[1].move !== (pos.bestmove || pos.lines?.[0]?.move)) {
      arrows.push({ from: second.from, to: second.to, move: pos.lines[1].move, kind: 'second', color: '#94A3B8', opacity: 0.45 });
    }
    this.boardView.setAnalysisArrows(arrows);
  }

  dispose() {
    this.disposed = true;
    this.clearPreview();
    this._liveScheduler.dispose();
    this.stop();
    if (this.boardView && typeof this.boardView.setAnalysisArrows === 'function') {
      this.boardView.setAnalysisArrows([]);
    }
  }
}
