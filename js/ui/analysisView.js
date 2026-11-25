/**
 * Analysis UI controller & widgets (Part B4):
 * - Setup modal (Nhanh / Chuẩn / Sâu, Pikafish vs JS fallback notice)
 * - Live progress bar + Cancel ("Dừng" -> marks "Chưa đầy đủ")
 * - Interactive SVG Eval Area Graph with pointer/touch scrub
 * - Best-move card (top 2-3 lines, board arrows toggle, "Thử nước này")
 * - Summary card (Red/Black accuracy rings, class counts, clickable top-3 mistakes)
 * - Move-list badges & "Chỉ hiện sai lầm" filter
 */
import {
  winPercent,
  formatEvalScore,
  MOVE_CLASSES,
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

function ringSvg(pct, label, sideCls) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const val = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
  const dash = ((val / 100) * circ).toFixed(1);
  const txt = pct === null || pct === undefined ? '—' : `${Math.round(val)}%`;
  return `
    <div class="an-ring-box ${sideCls}">
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
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
   *   onSelectPly: (ply: number, opts?: { isScrub?: boolean }) => void,
   *   onTryMove?: (ply: number, iccs: string) => void,
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
    this.isUnfinished = Boolean(opts.isUnfinished);
    this.onSelectPly = opts.onSelectPly || (() => {});
    this.onTryMove = opts.onTryMove || null;
    this.onResultChange = opts.onResultChange || null;

    this.gameKey = gameFingerprint(this.startFen, this.moves);
    this.key = analysisKey(this.startFen, this.moves);
    this.lastRunOpts = { preset: 'fast' };
    this.result = null;
    this.running = null;
    this.viewPly = this.moves.length;
    this.focusedMistakePly = null;
    this.showArrows = true;
    this.mistakesOnly = false;
    this.disposed = false;
    this._scrubbing = false;

    this._renderSkeleton();
  }

  _renderSkeleton() {
    this.hostEl.innerHTML = '';
    this.root = document.createElement('section');
    this.root.className = 'analysis-panel';
    this.root.dataset.testid = 'analysis-panel';
    this.root.innerHTML = `
      <div class="an-header">
        <span class="an-title">Phân tích ván</span>
        <div class="an-header-actions">
          <button type="button" class="mini-seg-btn an-btn-arrows is-active" data-an="arrows" title="Bật/tắt mũi tên phân tích">Mũi tên</button>
          <button type="button" class="mini-seg-btn an-btn-filter" data-an="filter" title="Chỉ hiện sai lầm">Chỉ hiện sai lầm</button>
          <button type="button" class="mini-seg-btn an-btn-run" data-an="run">Phân tích</button>
        </div>
      </div>
      <div class="an-notice" hidden></div>
      <div class="an-progress-wrap" hidden>
        <div class="an-progress-top">
          <span class="an-progress-label">Đang phân tích…</span>
          <button type="button" class="mini-seg-btn an-btn-stop" data-an="stop">Dừng</button>
        </div>
        <div class="an-progress-bar"><div class="an-progress-fill"></div></div>
      </div>
      <div class="an-graph-wrap" hidden>
        <svg class="an-graph-svg" viewBox="0 0 300 72" preserveAspectRatio="none" role="slider" aria-label="Biểu đồ đánh giá"></svg>
      </div>
      <div class="an-best-card" hidden></div>
      <div class="an-summary-card" hidden></div>
    `;
    this.hostEl.appendChild(this.root);

    this.noticeEl = this.root.querySelector('.an-notice');
    this.progressWrap = this.root.querySelector('.an-progress-wrap');
    this.progressLabel = this.root.querySelector('.an-progress-label');
    this.progressFill = this.root.querySelector('.an-progress-fill');
    this.graphWrap = this.root.querySelector('.an-graph-wrap');
    this.graphSvg = this.root.querySelector('.an-graph-svg');
    this.bestCard = this.root.querySelector('.an-best-card');
    this.summaryCard = this.root.querySelector('.an-summary-card');
    this.arrowsBtn = this.root.querySelector('[data-an="arrows"]');
    this.filterBtn = this.root.querySelector('[data-an="filter"]');
    this.runBtn = this.root.querySelector('[data-an="run"]');

    if (this.variant === 'jieqi') {
      this.noticeEl.hidden = false;
      this.noticeEl.textContent = 'Cờ Úp chưa hỗ trợ phân tích.';
      this.runBtn.disabled = true;
      return;
    }
    if (this.isUnfinished) {
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
      this.syncPly(this.viewPly);
    });
    this.filterBtn.addEventListener('click', () => {
      this.mistakesOnly = !this.mistakesOnly;
      this.filterBtn.classList.toggle('is-active', this.mistakesOnly);
      this._applyMoveListFilter();
    });

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

  async loadCached() {
    if (this.variant === 'jieqi' || this.isUnfinished || !this.ctx.gameStore) return null;
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
      this.applyResult(hit, { persist: false });
      return hit;
    }
    return null;
  }

  async openSetupModal() {
    if (this.variant === 'jieqi' || this.isUnfinished) return;
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
          <h3 id="an-setup-title">Phân tích ván cờ</h3>
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
    if (this.variant === 'jieqi' || this.isUnfinished) return null;
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
    handle.promise.catch(() => {}); // handled via onError
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

  applyResult(res, { persist = false, live = false } = {}) {
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

  /**
   * Select a played move (1..N) from mistake list, move chip, or graph dot.
   * If that move is mistake/blunder/missed_mate, displays position BEFORE the move (ply - 1)
   * with blue (best) + red (played) arrows. Otherwise displays position after the move (ply).
   */
  selectMove(ply, opts = {}) {
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
    if (!opts.keepMistakeFocus || this.focusedMistakePly !== ply + 1) {
      this.focusedMistakePly = null;
    }
    if (!this.result) return;
    const pos = this.result.positions.find((p) => p.ply === ply) || this.result.positions[this.result.positions.length - 1];
    if (pos && this.evalBar) {
      this.evalBar.setScore(pos.scoreRed, pos.wdlRed);
    }
    this._renderGraphCursor();
    this._renderBestCard(ply);
    this._renderArrows(ply);
  }

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

    // Mistake/blunder markers
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

  _renderBestCard(ply) {
    if (!this.result) {
      this.bestCard.hidden = true;
      return;
    }
    const data = selectAnalysisPositionData(this.result, ply, this.focusedMistakePly);
    if (!data) {
      this.bestCard.hidden = true;
      return;
    }
    this.bestCard.hidden = false;

    let headHtml = '';
    if (data.isMistakeFocus && data.focusedAnn) {
      const fa = data.focusedAnn;
      headHtml = `<div class="an-move-verdict" style="border-left:3px solid ${fa.color}">
        <strong>Máy chọn: <code>${data.bestMove || '—'}</code></strong>
        <span class="an-better">Thay cho nước ${fa.ply} (${fa.label})</span>
      </div>`;
    } else {
      const ctxLabel = ply === 0 ? 'Thế ban đầu' : `Sau nước ${ply}`;
      headHtml = `<div class="an-move-verdict">
        <strong>Máy chọn (${ctxLabel}): <code>${data.bestMove || '—'}</code></strong>
        <span>${formatEvalScore(data.pos.scoreRed)}</span>
      </div>`;
    }

    const linesHtml = data.lines
      .map(
        (ln) => `
        <div class="an-line-row">
          <span class="an-line-score">${formatEvalScore(ln.scoreRed)}</span>
          <span class="an-line-pv">${(ln.pv || [ln.move]).slice(0, 5).join(' ')}</span>
          ${this.onTryMove && ln.move ? `<button type="button" class="mini-seg-btn an-try-btn" data-try-move="${ln.move}">Thử nước này</button>` : ''}
        </div>`
      )
      .join('');

    const playedHtml = data.playedNext
      ? `<div class="an-played-row" data-testid="an-played-row" style="border-left:3px solid ${data.playedNext.color}">
          <span>Nước đã đi: <strong>${data.playedNext.move}</strong> (${formatEvalScore(data.playedNext.scoreRed)})</span>
          <span style="color:${data.playedNext.color};font-weight:700">${data.playedNext.symbol} ${data.playedNext.label}</span>
        </div>`
      : '';

    this.bestCard.innerHTML = `${headHtml}<div class="an-lines">${linesHtml || '<span class="set-hint">Không còn nước đi.</span>'}</div>${playedHtml}`;
    if (this.onTryMove) {
      this.bestCard.querySelectorAll('[data-try-move]').forEach((btn) => {
        btn.addEventListener('click', () => this.onTryMove(data.boardPly, btn.dataset.tryMove));
      });
    }
  }

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
              .map(
                (m) => `
              <button type="button" class="an-mistake-item" data-jump-ply="${m.ply}">
                <span class="an-mistake-sym" style="color:${m.color}">${m.symbol}</span>
                <span>Nước ${m.ply} (${m.side === 'red' ? 'Đỏ' : 'Đen'}): <strong>${m.move}</strong></span>
                <span class="an-mistake-drop">-${Math.round(m.winDrop)}%</span>
              </button>`
              )
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
    if (!this.showArrows || !this.result) {
      this.boardView.setAnalysisArrows([]);
      return;
    }
    const data = selectAnalysisPositionData(this.result, ply, this.focusedMistakePly);
    this.boardView.setAnalysisArrows(data ? data.arrows : []);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    if (this.boardView && typeof this.boardView.setAnalysisArrows === 'function') {
      this.boardView.setAnalysisArrows([]);
    }
  }
}
