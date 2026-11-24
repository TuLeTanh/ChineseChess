import { RED, BLACK } from '../model/piece.js';
import { GameStatus } from '../rules.js';
import { pieceSymbolId } from '../render/pieceSvg.js';
import { AI_LEVELS } from '../ai/levels.js';

/**
 * Format a game-over status into Vietnamese result text (supports 2-player and AI modes).
 * @param {string} status
 * @param {'red'|'black'} sideToMove
 * @param {{ vsAi?: boolean, playerSide?: 'red'|'black', resigned?: boolean }} [opts]
 * @returns {string | null}
 */
export function formatGameOverText(status, sideToMove, opts = {}) {
  if (opts.resigned) {
    return 'Bạn đã đầu hàng - Máy thắng';
  }
  if (status === GameStatus.DrawRepetition) return 'Hòa (lặp thế cờ)';
  if (status === GameStatus.DrawNoCapture) return 'Hòa (60 nước không ăn quân)';

  const winnerSide = sideToMove === RED ? BLACK : RED;
  if (status === GameStatus.Checkmate) {
    if (opts.vsAi) {
      return winnerSide === opts.playerSide ? 'Chiếu bí! Bạn thắng!' : 'Chiếu bí! Máy thắng!';
    }
    return `Chiếu bí! ${winnerSide === RED ? 'Đỏ' : 'Đen'} thắng`;
  }
  if (status === GameStatus.Stalemate) {
    if (opts.vsAi) {
      return winnerSide === opts.playerSide ? 'Hết nước đi! Bạn thắng!' : 'Hết nước đi! Máy thắng!';
    }
    return `Hết nước đi! ${winnerSide === RED ? 'Đỏ' : 'Đen'} thắng`;
  }
  return null;
}

/**
 * Format centipawn or UCI scoreObj `{ cp?, mate? }` into a compact Vietnamese string.
 * @param {number} scoreCp
 * @param {{ cp?: number, mate?: number } | null} [scoreObj]
 * @returns {string}
 */
function formatEvalScore(scoreCp, scoreObj = null) {
  if (scoreObj && typeof scoreObj.mate === 'number') {
    const n = Math.abs(scoreObj.mate);
    return scoreObj.mate > 0 ? `chiếu bí sau ${n} nước` : `bị chiếu bí sau ${n} nước`;
  }
  if (Math.abs(scoreCp) >= 29000) {
    return scoreCp > 0 ? '+Chiếu bí' : '-Chiếu bí';
  }
  const pawns = scoreCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function formatNps(nps) {
  if (!nps || nps <= 0) return '';
  if (nps >= 1_000_000) return ` · ${(nps / 1_000_000).toFixed(1)}M nps`;
  if (nps >= 1000) return ` · ${Math.round(nps / 1000)}k nps`;
  return ` · ${nps} nps`;
}

/**
 * Side panel UI: mode/engine selectors, player cards, custom scrollbar-free move list
 * with piece icons & fade masks, interactive timeline scrubber, review controls, and audio bar.
 */
export class SidePanel {
  constructor(opts) {
    this.container = opts.container;
    this.modalRoot = opts.modalRoot;
    this.board = opts.board;
    this.theme = opts.theme;
    this.practiceMode = Boolean(opts.practiceMode);
    this.mode = opts.mode || 'pvp';
    this.playerSide = opts.playerSide || RED;
    this.aiLevel = opts.aiLevel || 'nghiep-du';
    this.engineType = opts.engineType || 'js';
    this.pikafishInfo = opts.pikafishInfo || { available: false };
    this.hintsLeft = opts.hintsLeft ?? 3;
    this.resigned = false;
    this.aiThinking = false;
    this.aiInfo = null;
    this.muted = Boolean(opts.muted);
    this.volume = typeof opts.volume === 'number' ? opts.volume : 0.7;
    this.voiceEnabled = opts.voiceEnabled !== false;
    this.gameStatus = GameStatus.Playing;
    this.callbacks = opts;

    // Review state
    this.viewPly = this.board.history.length;
    this.hasNewMoves = false;
    this.autoPlaying = false;
    this._prevHistoryLen = this.board.history.length;
    this._prevCapturedCounts = { red: 0, black: 0 };
    this._userScrolledUp = false;
    this._scrubbing = false;

    this._buildDom();
    this.syncAudio(this.muted, this.volume, this.voiceEnabled);
    this.update(this.gameStatus);
  }

  /** @param {import('../theme.js').Theme} theme */
  setTheme(theme) {
    this.theme = theme;
    this.update(this.gameStatus);
  }

  /** Update Pikafish availability & selected engine type. */
  setEngineState(engineType, pikafishInfo) {
    this.engineType = engineType;
    if (pikafishInfo) this.pikafishInfo = pikafishInfo;
    this._syncAiCardsAndButtons();
  }

  /** Update AI thinking indicator and depth/score/nps readout. */
  setAiThinking(thinking, info = null) {
    this.aiThinking = Boolean(thinking);
    this.aiInfo = info;
    this._syncAiCardsAndButtons();
  }

  /** Update remaining hint count. */
  setHintsLeft(count) {
    this.hintsLeft = Math.max(0, count);
    this._syncAiCardsAndButtons();
  }

  /** Set resigned flag. */
  setResigned(resigned) {
    this.resigned = Boolean(resigned);
  }

  /** Update review state (viewPly, hasNewMoves, autoPlaying). */
  setReviewState({ viewPly, hasNewMoves = false, autoPlaying = false, skipScroll = false }) {
    this.viewPly = viewPly;
    this.hasNewMoves = Boolean(hasNewMoves);
    this.autoPlaying = Boolean(autoPlaying);
    this.update(this.gameStatus, { skipScroll });
  }

  /** Sync mute button icon, voice toggle icon, and volume slider. */
  syncAudio(muted, volume, voiceEnabled = this.voiceEnabled) {
    this.muted = Boolean(muted);
    this.volume = volume;
    this.voiceEnabled = Boolean(voiceEnabled);
    if (this.muteBtn) {
      this.muteBtn.classList.toggle('is-muted', this.muted);
      this.muteBtn.setAttribute('aria-pressed', String(this.muted));
      this.muteBtn.title = this.muted ? 'Bật âm thanh (M)' : 'Tắt âm thanh (M)';
      this.muteBtn.innerHTML = this.muted
        ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    }
    if (this.voiceBtn) {
      const active = this.voiceEnabled && !this.muted;
      this.voiceBtn.classList.toggle('is-muted', !active);
      this.voiceBtn.setAttribute('aria-pressed', String(this.voiceEnabled));
      this.voiceBtn.title = 'Giọng nói (V)';
      this.voiceBtn.innerHTML = this.voiceEnabled
        ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
        : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
    }
    if (this.volumeSlider) {
      this.volumeSlider.value = String(Math.round(this.volume * 100));
    }
    if (this.volumeValue) {
      this.volumeValue.textContent = `${Math.round(this.volume * 100)}%`;
    }
  }

  /** Open confirm modal if moves exist, otherwise start a new game immediately. */
  requestNewGame() {
    if (this.board.history.length === 0) {
      this.callbacks.onNewGame();
      return;
    }
    this._openNewGameModal();
  }

  /** Open confirm modal for "Chơi tiếp từ đây" truncation. */
  requestTruncate(ply) {
    this.modalRoot.hidden = false;
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="truncate-title">
        <div class="modal-card">
          <h3 id="truncate-title">Chơi tiếp từ đây?</h3>
          <p>Các nước sau nước ${ply} sẽ bị xóa. Tiếp tục?</p>
          <div class="modal-actions">
            <button type="button" class="pill-btn modal-cancel">Hủy</button>
            <button type="button" class="pill-btn pill-btn-gold modal-truncate-confirm">Tiếp tục</button>
          </div>
        </div>
      </div>
    `;
    this.modalRoot.querySelector('.modal-cancel').addEventListener('click', () => this.closeModal());
    this.modalRoot.querySelector('.modal-truncate-confirm').addEventListener('click', () => {
      this.closeModal();
      if (this.callbacks.onConfirmTruncate) this.callbacks.onConfirmTruncate(ply);
    });
    this.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) this.closeModal();
    });
  }

  /** Open confirm modal for resigning in AI mode. */
  requestResign() {
    this.modalRoot.hidden = false;
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resign-title">
        <div class="modal-card">
          <h3 id="resign-title">Xác nhận đầu hàng?</h3>
          <p>Bạn có chắc muốn đầu hàng ván đấu với máy này không?</p>
          <div class="modal-actions">
            <button type="button" class="pill-btn modal-cancel">Hủy</button>
            <button type="button" class="pill-btn pill-btn-danger modal-resign-confirm">Đầu hàng</button>
          </div>
        </div>
      </div>
    `;
    this.modalRoot.querySelector('.modal-cancel').addEventListener('click', () => this.closeModal());
    this.modalRoot.querySelector('.modal-resign-confirm').addEventListener('click', () => {
      this.closeModal();
      this.callbacks.onResign();
    });
    this.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) this.closeModal();
    });
  }

  /** Close any active modal. */
  closeModal() {
    this.modalRoot.hidden = true;
    this.modalRoot.innerHTML = '';
  }

  /**
   * Show the styled game-over result card (Part 3) with "Ván mới" and "Xem lại bàn cờ".
   * @param {string} resultText
   * @param {{ kind?: 'win'|'lose'|'draw'|'resign', reasonText?: string, statsText?: string }} [meta]
   */
  showGameOverModal(resultText, meta = {}) {
    const kind = meta.kind || 'win';
    const totalPlies = this.board.history.length;
    const redCaps = this.board.capturedBy(BLACK).length; // red pieces captured by black
    const blackCaps = this.board.capturedBy(RED).length; // black pieces captured by red
    const reasonText = meta.reasonText || 'Ván cờ đã kết thúc.';
    const statsText =
      meta.statsText ||
      `Số nước: ${totalPlies} · Đã ăn: ${redCaps} quân đỏ, ${blackCaps} quân đen`;

    const swordsEmblem =
      kind === 'win'
        ? `<div class="result-emblem" aria-hidden="true">
            <svg viewBox="0 0 120 56" width="108" height="50">
              <g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.38">
                <line x1="20" y1="48" x2="100" y2="8"/>
                <line x1="100" y1="48" x2="20" y2="8"/>
                <circle cx="60" cy="28" r="14" stroke-dasharray="3 3"/>
              </g>
            </svg>
          </div>`
        : '';

    this.modalRoot.hidden = false;
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
        <div class="modal-card modal-gameover is-kind-${kind}">
          ${swordsEmblem}
          <h3 id="gameover-title">${resultText}</h3>
          <p class="gameover-reason">${reasonText}</p>
          <p class="gameover-stats">${statsText}</p>
          <div class="modal-actions">
            <button type="button" class="pill-btn modal-review">Xem lại bàn cờ</button>
            <button type="button" class="pill-btn pill-btn-gold modal-new-game">Ván mới</button>
          </div>
        </div>
      </div>
    `;

    this.modalRoot.querySelector('.modal-review').addEventListener('click', () => {
      this.closeModal();
      if (this.callbacks.onReviewGameOver) this.callbacks.onReviewGameOver();
    });
    this.modalRoot.querySelector('.modal-new-game').addEventListener('click', () => {
      this.closeModal();
      this.callbacks.onNewGame();
    });
  }

  /** Re-sync cards, captured trays, move list, timeline, review controls, and buttons. */
  update(status = this.gameStatus, opts = {}) {
    this.gameStatus = status;
    const total = this.board.history.length;
    const clampedView = Math.max(0, Math.min(total, this.viewPly));
    this.viewPly = clampedView;
    const isReview = clampedView < total;

    const snap = this.board.snapshotAt(clampedView);
    const viewedSide = snap.sideToMove;
    const vsAi = this.mode === 'ai';
    const resultText = !isReview
      ? formatGameOverText(status, this.board.sideToMove, {
          vsAi,
          playerSide: this.playerSide,
          resigned: this.resigned,
        })
      : null;

    this.blackCard.classList.toggle('is-active', !resultText && viewedSide === BLACK);
    this.redCard.classList.toggle('is-active', !resultText && viewedSide === RED);

    this.turnLabel.textContent = viewedSide === RED ? 'Lượt của Đỏ' : 'Lượt của Đen';
    this.turnDot.className = `turn-dot ${viewedSide === RED ? 'is-red' : 'is-black'}`;
    this.themeBtn.title = `Giao diện hiện tại: ${this.theme.name}`;

    // Undo button disabled at start (or in AI mode when only AI moved first as Red and it's player's turn)
    const canUndo = vsAi
      ? total >= 2 || (total === 1 && this.aiThinking)
      : total > 0;
    this.undoBtn.disabled = !canUndo;

    if (resultText) {
      this.resultBanner.textContent = resultText;
      this.resultBanner.hidden = false;
      this.resultBanner.className = 'result-banner is-gameover';
    } else if (!isReview && status === GameStatus.Check) {
      this.resultBanner.textContent = 'Chiếu tướng!';
      this.resultBanner.hidden = false;
      this.resultBanner.className = 'result-banner is-check';
    } else if (isReview && snap.gaveCheck) {
      this.resultBanner.textContent = 'Chiếu tướng!';
      this.resultBanner.hidden = false;
      this.resultBanner.className = 'result-banner is-check';
    } else {
      this.resultBanner.textContent = '';
      this.resultBanner.hidden = true;
    }

    this._syncAiCardsAndButtons(Boolean(resultText) || isReview);
    this._renderCapturedTray(this.blackTray, this.board.capturedByAt(BLACK, clampedView), 'black');
    this._renderCapturedTray(this.redTray, this.board.capturedByAt(RED, clampedView), 'red');
    this._renderMoveList(Boolean(opts.skipScroll));
    this._renderTimeline();
    this._syncReviewControls();
  }

  _syncAiCardsAndButtons(disableAiActions = false) {
    const vsAi = this.mode === 'ai';
    const pfAvail = Boolean(this.pikafishInfo && this.pikafishInfo.available);
    this.aiConfigRow.hidden = !vsAi;
    this.engineRow.hidden = !vsAi || !pfAvail;
    this.engineHint.hidden = !vsAi || pfAvail;
    this.aiActionsRow.hidden = !vsAi;
    this.practiceWrap.hidden = vsAi;

    this.modePvpBtn.classList.toggle('is-selected', !vsAi);
    this.modeAiBtn.classList.toggle('is-selected', vsAi);
    this.sideRedBtn.classList.toggle('is-selected', this.playerSide === RED);
    this.sideBlackBtn.classList.toggle('is-selected', this.playerSide === BLACK);
    this.engPfBtn.classList.toggle('is-selected', this.engineType === 'pikafish' && pfAvail);
    this.engJsBtn.classList.toggle('is-selected', this.engineType !== 'pikafish' || !pfAvail);
    this.levelSelect.value = this.aiLevel;

    const aiSide = this.playerSide === RED ? BLACK : RED;
    const levelObj = AI_LEVELS.find((l) => l.id === this.aiLevel) || AI_LEVELS[1];
    const engineLabel =
      this.engineType === 'pikafish' && pfAvail
        ? this.pikafishInfo.name || 'Pikafish'
        : 'Nội bộ (JS)';

    const blackNameEl = this.blackCard.querySelector('.player-name');
    const blackSubEl = this.blackCard.querySelector('.player-sub');
    const redNameEl = this.redCard.querySelector('.player-name');
    const redSubEl = this.redCard.querySelector('.player-sub');

    if (vsAi) {
      blackNameEl.textContent = aiSide === BLACK ? `Máy (${levelObj.name})` : 'Bạn (Đen)';
      redNameEl.textContent = aiSide === RED ? `Máy (${levelObj.name})` : 'Bạn (Đỏ)';
    } else {
      blackNameEl.textContent = 'Đen';
      redNameEl.textContent = 'Đỏ';
    }

    const buildAiSub = (cardSide) => {
      if (!vsAi || cardSide !== aiSide) return cardSide === RED ? 'Quân Đỏ' : 'Quân Đen';
      if (this.aiThinking) {
        const infoTxt = this.aiInfo
          ? `độ sâu ${this.aiInfo.depth} · ${formatEvalScore(this.aiInfo.score, this.aiInfo.scoreObj)}${formatNps(this.aiInfo.nps)}`
          : 'đang tính…';
        return `<span class="ai-thinking-label">Máy đang nghĩ<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></span> <span class="ai-eval-meta">${infoTxt}</span>`;
      }
      if (this.aiInfo) {
        return `<span class="ai-engine-badge">${engineLabel}</span> · độ sâu ${this.aiInfo.depth} · ${formatEvalScore(this.aiInfo.score, this.aiInfo.scoreObj)}`;
      }
      return `<span class="ai-engine-badge">${engineLabel}</span>`;
    };

    blackSubEl.innerHTML = buildAiSub(BLACK);
    redSubEl.innerHTML = buildAiSub(RED);

    this.hintBtn.textContent = `Gợi ý (${this.hintsLeft})`;
    this.hintBtn.disabled =
      !vsAi || disableAiActions || this.resigned || this.aiThinking || this.hintsLeft <= 0 || this.board.sideToMove !== this.playerSide;
    this.resignBtn.disabled = !vsAi || disableAiActions || this.resigned;
  }

  _buildDom() {
    const levelOptions = AI_LEVELS.map(
      (l) => `<option value="${l.id}">${l.name}</option>`
    ).join('');

    this.container.innerHTML = `
      <div class="mode-bar">
        <div class="segmented" role="tablist" aria-label="Chế độ chơi">
          <button type="button" class="seg-btn" data-mode="pvp">Hai người</button>
          <button type="button" class="seg-btn" data-mode="ai">Đấu máy</button>
        </div>
        <div class="ai-config-row" hidden>
          <div class="ai-side-pick">
            <span class="ai-label">Bạn cầm:</span>
            <button type="button" class="mini-seg-btn" data-pside="red">Đỏ</button>
            <button type="button" class="mini-seg-btn" data-pside="black">Đen</button>
          </div>
          <select class="ai-level-select" aria-label="Cấp độ máy">${levelOptions}</select>
        </div>
        <div class="engine-row" hidden>
          <span class="ai-label">Máy:</span>
          <div class="engine-pick">
            <button type="button" class="mini-seg-btn" data-engine="pikafish">Pikafish</button>
            <button type="button" class="mini-seg-btn" data-engine="js">Nội bộ (JS)</button>
          </div>
        </div>
        <div class="engine-hint" hidden>Chạy tools/server.py và tools/setup_engine.py để dùng Pikafish</div>
      </div>

      <section class="player-card player-card-black" data-side="black">
        <div class="player-header">
          <div class="player-avatar avatar-black">將</div>
          <div class="player-meta">
            <div class="player-name">Đen</div>
            <div class="player-sub">Quân Đen</div>
          </div>
          <div class="player-clock">10:00</div>
        </div>
        <div class="captured-tray" data-tray="black" aria-label="Quân Đỏ bị Đen ăn"></div>
      </section>

      <section class="move-list-section" aria-label="Lịch sử nước đi">
        <div class="move-list-header">
          <span class="col-num">#</span>
          <span class="col-red">Đỏ</span>
          <span class="col-black">Đen</span>
        </div>
        <div class="move-list-scroll-wrap">
          <div class="move-list-scroll">
            <div class="move-list-empty">Chưa có nước đi</div>
            <button type="button" class="move-start-chip" data-ply="0" hidden>Thế ban đầu</button>
            <div class="move-list-rows" role="list"></div>
          </div>
          <button type="button" class="scroll-latest-pill" hidden>↓ Nước mới</button>
        </div>
        <div class="move-timeline-wrap" hidden>
          <div class="timeline-tooltip" hidden></div>
          <svg class="move-timeline" viewBox="0 0 288 34" preserveAspectRatio="none" tabindex="0" role="slider" aria-label="Thanh thời gian nước đi"></svg>
        </div>
        <div class="review-controls" aria-label="Điều hướng lịch sử">
          <button type="button" class="rev-btn" data-rev="start" title="Thế ban đầu (Home)" aria-label="Thế ban đầu">⏮</button>
          <button type="button" class="rev-btn" data-rev="prev" title="Nước trước (←)" aria-label="Nước trước">◀</button>
          <span class="rev-counter">0 / 0</span>
          <button type="button" class="rev-btn" data-rev="next" title="Nước sau (→)" aria-label="Nước sau">▶</button>
          <button type="button" class="rev-btn" data-rev="live" title="Về hiện tại (End)" aria-label="Về hiện tại">⏭<span class="rev-new-dot" hidden></span></button>
          <button type="button" class="rev-btn" data-rev="play" title="Tự động phát / Tạm dừng (Space)" aria-label="Tự động phát">⏯</button>
        </div>
      </section>

      <section class="player-card player-card-red" data-side="red">
        <div class="player-header">
          <div class="player-avatar avatar-red">帥</div>
          <div class="player-meta">
            <div class="player-name">Đỏ</div>
            <div class="player-sub">Quân Đỏ</div>
          </div>
          <div class="player-clock">10:00</div>
        </div>
        <div class="captured-tray" data-tray="red" aria-label="Quân Đen bị Đỏ ăn"></div>
      </section>

      <div class="status-block">
        <div class="status-strip">
          <div class="turn-indicator">
            <span class="turn-dot is-red"></span>
            <span class="turn-label">Lượt của Đỏ</span>
          </div>
          <label class="free-move-toggle practice-wrap">
            <input type="checkbox" class="free-move-checkbox" ${this.practiceMode ? 'checked' : ''}>
            <span>Đi tự do (luyện tập)</span>
          </label>
        </div>
        <div class="result-banner" hidden></div>
      </div>

      <div class="ai-actions-row" hidden>
        <button type="button" class="pill-btn pill-btn-compact" data-action="hint">Gợi ý (3)</button>
        <button type="button" class="pill-btn pill-btn-compact pill-btn-resign" data-action="resign">Đầu hàng</button>
      </div>

      <div class="controls-grid">
        <button type="button" class="pill-btn" data-action="new">Ván mới</button>
        <button type="button" class="pill-btn" data-action="undo">Đi lại</button>
        <button type="button" class="pill-btn" data-action="flip" title="Xoay bàn cờ (F)">Xoay bàn</button>
        <button type="button" class="pill-btn" data-action="theme">Giao diện</button>
      </div>

      <div class="audio-bar">
        <button type="button" class="icon-btn mute-btn" data-action="mute" aria-label="Tắt hoặc bật âm thanh"></button>
        <button type="button" class="icon-btn voice-btn" data-action="voice" aria-label="Giọng nói" title="Giọng nói (V)"></button>
        <input type="range" class="volume-slider" min="0" max="100" value="70" aria-label="Âm lượng">
        <span class="volume-value">70%</span>
      </div>
    `;

    this.modePvpBtn = this.container.querySelector('[data-mode="pvp"]');
    this.modeAiBtn = this.container.querySelector('[data-mode="ai"]');
    this.aiConfigRow = this.container.querySelector('.ai-config-row');
    this.engineRow = this.container.querySelector('.engine-row');
    this.engineHint = this.container.querySelector('.engine-hint');
    this.engPfBtn = this.container.querySelector('[data-engine="pikafish"]');
    this.engJsBtn = this.container.querySelector('[data-engine="js"]');
    this.sideRedBtn = this.container.querySelector('[data-pside="red"]');
    this.sideBlackBtn = this.container.querySelector('[data-pside="black"]');
    this.levelSelect = this.container.querySelector('.ai-level-select');
    this.aiActionsRow = this.container.querySelector('.ai-actions-row');
    this.hintBtn = this.container.querySelector('[data-action="hint"]');
    this.resignBtn = this.container.querySelector('[data-action="resign"]');
    this.practiceWrap = this.container.querySelector('.practice-wrap');

    this.blackCard = this.container.querySelector('.player-card-black');
    this.redCard = this.container.querySelector('.player-card-red');
    this.blackTray = this.container.querySelector('[data-tray="black"]');
    this.redTray = this.container.querySelector('[data-tray="red"]');
    this.moveScrollWrap = this.container.querySelector('.move-list-scroll-wrap');
    this.moveScroll = this.container.querySelector('.move-list-scroll');
    this.moveEmpty = this.container.querySelector('.move-list-empty');
    this.moveStartChip = this.container.querySelector('.move-start-chip');
    this.moveRows = this.container.querySelector('.move-list-rows');
    this.scrollLatestPill = this.container.querySelector('.scroll-latest-pill');
    this.timelineWrap = this.container.querySelector('.move-timeline-wrap');
    this.timelineTooltip = this.container.querySelector('.timeline-tooltip');
    this.timelineSvg = this.container.querySelector('.move-timeline');
    this.revStartBtn = this.container.querySelector('[data-rev="start"]');
    this.revPrevBtn = this.container.querySelector('[data-rev="prev"]');
    this.revNextBtn = this.container.querySelector('[data-rev="next"]');
    this.revLiveBtn = this.container.querySelector('[data-rev="live"]');
    this.revPlayBtn = this.container.querySelector('[data-rev="play"]');
    this.revCounter = this.container.querySelector('.rev-counter');
    this.revNewDot = this.container.querySelector('.rev-new-dot');

    this.turnDot = this.container.querySelector('.turn-dot');
    this.turnLabel = this.container.querySelector('.turn-label');
    this.resultBanner = this.container.querySelector('.result-banner');
    this.undoBtn = this.container.querySelector('[data-action="undo"]');
    this.themeBtn = this.container.querySelector('[data-action="theme"]');
    this.muteBtn = this.container.querySelector('[data-action="mute"]');
    this.voiceBtn = this.container.querySelector('[data-action="voice"]');
    this.volumeSlider = this.container.querySelector('.volume-slider');
    this.volumeValue = this.container.querySelector('.volume-value');

    this._bindEvents();
  }

  _bindEvents() {
    this.modePvpBtn.addEventListener('click', () => {
      if (this.mode !== 'pvp') {
        this.mode = 'pvp';
        this.callbacks.onModeChange('pvp');
      }
    });
    this.modeAiBtn.addEventListener('click', () => {
      if (this.mode !== 'ai') {
        this.mode = 'ai';
        this.callbacks.onModeChange('ai');
      }
    });
    this.sideRedBtn.addEventListener('click', () => {
      if (this.playerSide !== RED) {
        this.playerSide = RED;
        this.callbacks.onPlayerSideChange(RED);
      }
    });
    this.sideBlackBtn.addEventListener('click', () => {
      if (this.playerSide !== BLACK) {
        this.playerSide = BLACK;
        this.callbacks.onPlayerSideChange(BLACK);
      }
    });
    this.levelSelect.addEventListener('change', (ev) => {
      this.aiLevel = ev.target.value;
      this.callbacks.onAiLevelChange(this.aiLevel);
    });
    this.engPfBtn.addEventListener('click', () => {
      if (this.engineType !== 'pikafish' && this.callbacks.onEngineChange) {
        this.engineType = 'pikafish';
        this.callbacks.onEngineChange('pikafish');
      }
    });
    this.engJsBtn.addEventListener('click', () => {
      if (this.engineType !== 'js' && this.callbacks.onEngineChange) {
        this.engineType = 'js';
        this.callbacks.onEngineChange('js');
      }
    });
    this.hintBtn.addEventListener('click', () => this.callbacks.onHint());
    this.resignBtn.addEventListener('click', () => this.requestResign());

    // Move list clicks (delegated)
    this.moveStartChip.addEventListener('click', () => {
      if (this.callbacks.onSelectPly) this.callbacks.onSelectPly(0);
    });
    this.moveRows.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-ply]');
      if (!btn) return;
      const ply = Number(btn.dataset.ply);
      if (Number.isFinite(ply) && this.callbacks.onSelectPly) {
        this.callbacks.onSelectPly(ply);
      }
    });

    // Scroll fade masks + manual scroll detection
    this.moveScroll.addEventListener('scroll', () => {
      this._updateScrollFades();
      const distBottom =
        this.moveScroll.scrollHeight - this.moveScroll.clientHeight - this.moveScroll.scrollTop;
      this._userScrolledUp = distBottom > 60;
      if (!this._userScrolledUp) {
        this.scrollLatestPill.hidden = true;
      }
    });

    this.scrollLatestPill.addEventListener('click', () => {
      this._userScrolledUp = false;
      this.scrollLatestPill.hidden = true;
      this.moveScroll.scrollTo({ top: this.moveScroll.scrollHeight, behavior: 'smooth' });
      if (this.callbacks.onSelectPly) this.callbacks.onSelectPly(this.board.history.length);
    });

    // Review controls
    this.revStartBtn.addEventListener('click', () => {
      if (this.callbacks.onSelectPly) this.callbacks.onSelectPly(0);
    });
    this.revPrevBtn.addEventListener('click', () => {
      if (this.callbacks.onStepPly) this.callbacks.onStepPly(-1);
    });
    this.revNextBtn.addEventListener('click', () => {
      if (this.callbacks.onStepPly) this.callbacks.onStepPly(1);
    });
    this.revLiveBtn.addEventListener('click', () => {
      if (this.callbacks.onSelectPly) this.callbacks.onSelectPly(this.board.history.length);
    });
    this.revPlayBtn.addEventListener('click', () => {
      if (this.callbacks.onToggleAutoPlay) this.callbacks.onToggleAutoPlay();
    });

    // Timeline scrubbing (pointer capture) + keyboard
    const plyFromClientX = (clientX) => {
      const rect = this.timelineSvg.getBoundingClientRect();
      const total = this.board.history.length;
      if (total === 0 || rect.width <= 0) return 0;
      const pad = 10;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left - pad) / Math.max(1, rect.width - pad * 2)));
      return Math.round(ratio * total);
    };

    const showTip = (ply, clientX) => {
      const rect = this.timelineWrap.getBoundingClientRect();
      const x = Math.max(28, Math.min(rect.width - 28, clientX - rect.left));
      const label =
        ply === 0
          ? 'Thế ban đầu'
          : `nước ${ply}: ${this.board.history[ply - 1]?.iccs || ''}${this.board.history[ply - 1]?.suffix || ''}`;
      this.timelineTooltip.textContent = label;
      this.timelineTooltip.style.left = `${x}px`;
      this.timelineTooltip.hidden = false;
    };

    this.timelineSvg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || this.board.history.length === 0) return;
      this._scrubbing = true;
      this.timelineSvg.setPointerCapture(ev.pointerId);
      const ply = plyFromClientX(ev.clientX);
      showTip(ply, ev.clientX);
      if (this.callbacks.onSelectPly) this.callbacks.onSelectPly(ply, { isScrub: true });
    });

    this.timelineSvg.addEventListener('pointermove', (ev) => {
      if (this.board.history.length === 0) return;
      const ply = plyFromClientX(ev.clientX);
      if (this._scrubbing) {
        showTip(ply, ev.clientX);
        if (ply !== this.viewPly && this.callbacks.onSelectPly) {
          this.callbacks.onSelectPly(ply, { isScrub: true });
        }
      } else {
        showTip(ply, ev.clientX);
      }
    });

    const endScrub = (ev) => {
      if (this._scrubbing && this.timelineSvg.hasPointerCapture(ev.pointerId)) {
        this.timelineSvg.releasePointerCapture(ev.pointerId);
      }
      this._scrubbing = false;
      this.timelineTooltip.hidden = true;
    };
    this.timelineSvg.addEventListener('pointerup', endScrub);
    this.timelineSvg.addEventListener('pointercancel', endScrub);
    this.timelineSvg.addEventListener('pointerleave', () => {
      if (!this._scrubbing) this.timelineTooltip.hidden = true;
    });

    this.timelineSvg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.callbacks.onStepPly) this.callbacks.onStepPly(-1);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.callbacks.onStepPly) this.callbacks.onStepPly(1);
      }
    });

    // Core action buttons
    this.container.querySelector('[data-action="new"]').addEventListener('click', () => {
      this.requestNewGame();
    });
    this.undoBtn.addEventListener('click', () => this.callbacks.onUndo());
    this.container.querySelector('[data-action="flip"]').addEventListener('click', () => {
      this.callbacks.onFlip();
    });
    this.themeBtn.addEventListener('click', () => this.callbacks.onToggleTheme());
    this.container.querySelector('.free-move-checkbox').addEventListener('change', (ev) => {
      this.practiceMode = ev.target.checked;
      this.callbacks.onTogglePractice(this.practiceMode);
    });
    this.muteBtn.addEventListener('click', () => {
      if (this.callbacks.onToggleMute) this.callbacks.onToggleMute();
    });
    this.voiceBtn.addEventListener('click', () => {
      if (this.callbacks.onToggleVoice) this.callbacks.onToggleVoice();
    });
    this.volumeSlider.addEventListener('input', (ev) => {
      const vol = Number(ev.target.value) / 100;
      this.volumeValue.textContent = `${ev.target.value}%`;
      if (this.callbacks.onVolumeChange) this.callbacks.onVolumeChange(vol);
    });
  }

  _updateScrollFades() {
    const el = this.moveScroll;
    const canUp = el.scrollTop > 4;
    const canDown = el.scrollHeight - el.clientHeight - el.scrollTop > 4;
    this.moveScrollWrap.classList.toggle('has-fade-top', canUp);
    this.moveScrollWrap.classList.toggle('has-fade-bottom', canDown);
  }

  _renderCapturedTray(trayEl, pieces, key) {
    const prevCount = this._prevCapturedCounts[key] || 0;
    this._prevCapturedCounts[key] = pieces.length;

    if (pieces.length === 0) {
      trayEl.innerHTML = '<span class="captured-empty">—</span>';
      return;
    }

    const items = pieces.map((piece, idx) => {
      const id = pieceSymbolId(this.theme.id, piece.side, piece.kind, 'live');
      const isNew = idx >= prevCount;
      return `<svg class="captured-mini${isNew ? ' is-new' : ''}" viewBox="0 0 120 120" width="34" height="34" overflow="visible" aria-hidden="true">
        <use href="#${id}" width="120" height="120"/>
      </svg>`;
    });
    trayEl.innerHTML = items.join('');
  }

  _buildChipHtml(move, ply, total, isNewMove) {
    const sideClass = move.side === RED ? 'col-red' : 'col-black';
    const isViewed = ply === this.viewPly;
    const isLatestLive = ply === total && this.viewPly !== total;
    const isCap = Boolean(move.captured);
    const isMate = move.suffix === '#' || Boolean(move.isCheckmate);
    const isChk = !isMate && (move.suffix === '+' || Boolean(move.gaveCheck));

    const classes = ['move-chip', sideClass];
    if (isCap) classes.push('is-capture');
    if (isChk) classes.push('is-check');
    if (isMate) classes.push('is-checkmate');
    if (isViewed) classes.push('is-viewed');
    if (isLatestLive) classes.push('is-latest-live');
    if (isNewMove) classes.push('is-new-move');

    const symId = pieceSymbolId(this.theme.id, move.piece.side, move.piece.kind, 'live');
    const ariaCurr = isViewed ? ' aria-current="step"' : '';
    const tabIdx = isViewed ? '0' : '-1';
    const capSvg = isCap
      ? '<svg class="move-cap-icon" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '';
    const chkDot = isChk ? '<span class="move-check-dot" aria-hidden="true"></span>' : '';
    const liveDot = isLatestLive ? '<span class="move-live-dot" aria-hidden="true"></span>' : '';

    // NOTE: keep text content strictly equal to `${move.iccs}${move.suffix || ''}` for notation/test compatibility
    return `<button type="button" class="${classes.join(' ')}" data-ply="${ply}" tabindex="${tabIdx}"${ariaCurr}><svg class="move-piece-icon" viewBox="0 0 120 120" width="18" height="18" aria-hidden="true"><use href="#${symId}" width="120" height="120"/></svg><span class="move-text">${move.iccs}${move.suffix || ''}</span>${capSvg}${chkDot}${liveDot}</button>`;
  }

  _renderMoveList(skipScroll = false) {
    const history = this.board.history;
    const total = history.length;
    const addedNewLive = total > this._prevHistoryLen;
    this._prevHistoryLen = total;

    if (total === 0) {
      this.moveEmpty.hidden = false;
      this.moveStartChip.hidden = true;
      this.moveRows.innerHTML = '';
      this.scrollLatestPill.hidden = true;
      this._userScrolledUp = false;
      this._updateScrollFades();
      return;
    }

    this.moveEmpty.hidden = true;
    this.moveStartChip.hidden = false;
    const startViewed = this.viewPly === 0;
    this.moveStartChip.classList.toggle('is-viewed', startViewed);
    this.moveStartChip.setAttribute('tabindex', startViewed ? '0' : '-1');
    if (startViewed) this.moveStartChip.setAttribute('aria-current', 'step');
    else this.moveStartChip.removeAttribute('aria-current');

    const rows = [];
    for (let i = 0; i < total; i += 2) {
      const rowNum = Math.floor(i / 2) + 1;
      const ply1 = i + 1;
      const ply2 = i + 2;
      const m1 = history[i];
      const m2 = history[i + 1] || null;
      const isRowActive = this.viewPly === ply1 || this.viewPly === ply2;
      const beforeRowPly = i; // 2 * (rowNum - 1)

      const chip1 = m1 ? this._buildChipHtml(m1, ply1, total, addedNewLive && ply1 === total) : '<span class="move-slot-empty"></span>';
      const chip2 = m2 ? this._buildChipHtml(m2, ply2, total, addedNewLive && ply2 === total) : '<span class="move-slot-empty"></span>';

      rows.push(
        `<div class="move-row${isRowActive ? ' is-current' : ''}" role="listitem">` +
          `<button type="button" class="col-num" data-ply="${beforeRowPly}" tabindex="-1" title="Xem trước nước ${rowNum}">${rowNum}.</button>` +
          chip1 +
          chip2 +
        `</div>`
      );
    }
    this.moveRows.innerHTML = rows.join('');

    if (!skipScroll) {
      if (addedNewLive && this.viewPly === total && this._userScrolledUp) {
        this.scrollLatestPill.hidden = false;
      } else {
        const targetEl =
          this.viewPly === 0
            ? this.moveStartChip
            : this.moveRows.querySelector(`button.move-chip[data-ply="${this.viewPly}"]`);
        if (targetEl) {
          const sRect = this.moveScroll.getBoundingClientRect();
          const tRect = targetEl.getBoundingClientRect();
          const alreadyVisible = tRect.top >= sRect.top + 8 && tRect.bottom <= sRect.bottom - 8;
          targetEl.scrollIntoView({
            block: alreadyVisible ? 'nearest' : 'center',
            behavior: 'smooth',
          });
        }
      }
    }

    window.requestAnimationFrame(() => this._updateScrollFades());
  }

  _renderTimeline() {
    const history = this.board.history;
    const total = history.length;
    if (total === 0) {
      this.timelineWrap.hidden = true;
      this.timelineSvg.innerHTML = '';
      return;
    }

    this.timelineWrap.hidden = false;
    this.timelineSvg.setAttribute('aria-valuemin', '0');
    this.timelineSvg.setAttribute('aria-valuemax', String(total));
    this.timelineSvg.setAttribute('aria-valuenow', String(this.viewPly));

    const W = 288;
    const H = 34;
    const padX = 10;
    const span = W - padX * 2;
    const step = total > 0 ? span / total : span;
    const tickW = total > 60 ? Math.max(1.5, Math.min(2.5, step * 0.72)) : Math.max(2, Math.min(4, step * 0.45));
    const accent = this.theme.ui.fxAccent || this.theme.ui.accentGold || '#D9A441';

    const parts = [];
    // Baseline rail
    parts.push(`<line x1="${padX}" y1="22" x2="${W - padX}" y2="22" stroke="rgba(234,219,196,0.16)" stroke-width="1.5" stroke-linecap="round"/>`);

    // Start tick (ply 0)
    const isStart = this.viewPly === 0;
    parts.push(
      `<rect x="${(padX - 1.5).toFixed(1)}" y="${isStart ? 10 : 15}" width="3" height="${isStart ? 14 : 9}" rx="1.2" fill="${isStart ? accent : 'rgba(234,219,196,0.35)'}"/>`
    );

    // Ply ticks 1..total
    for (let ply = 1; ply <= total; ply++) {
      const m = history[ply - 1];
      const cx = padX + ply * step;
      const isViewed = ply === this.viewPly;
      const isCheck = m.suffix === '+' || m.suffix === '#' || m.gaveCheck || m.isCheckmate;
      const isCap = Boolean(m.captured);
      const baseH = isCheck ? 15 : 10;
      const h = isViewed ? Math.max(16, baseH + 2) : baseH;
      const y = 24 - h;
      const color = isViewed
        ? accent
        : m.side === RED
          ? '#D9534F'
          : '#C4BDB3';

      parts.push(
        `<rect x="${(cx - tickW / 2).toFixed(2)}" y="${y.toFixed(1)}" width="${tickW.toFixed(2)}" height="${h}" rx="1" fill="${color}" opacity="${isViewed ? 1 : 0.85}"/>`
      );
      if (isCap) {
        parts.push(`<circle cx="${cx.toFixed(2)}" cy="${Math.max(4, y - 3.5).toFixed(1)}" r="1.9" fill="#F2C14E"/>`);
      }
    }

    // Live-end small flag
    const liveX = padX + total * step;
    parts.push(`<path d="M ${liveX.toFixed(1)} 26 L ${liveX.toFixed(1)} 32 M ${liveX.toFixed(1)} 26 L ${(liveX + 5).toFixed(1)} 28 L ${liveX.toFixed(1)} 30 Z" fill="#D9A441" stroke="#D9A441" stroke-width="0.9"/>`);

    // Current viewed ply triangular marker
    const curX = padX + this.viewPly * step;
    parts.push(`<polygon points="${curX.toFixed(1)},26 ${(curX - 4).toFixed(1)},32 ${(curX + 4).toFixed(1)},32" fill="${accent}"/>`);

    this.timelineSvg.innerHTML = parts.join('');
  }

  _syncReviewControls() {
    const total = this.board.history.length;
    this.revCounter.textContent = `${this.viewPly} / ${total}`;
    this.revStartBtn.disabled = total === 0 || this.viewPly === 0;
    this.revPrevBtn.disabled = total === 0 || this.viewPly === 0;
    this.revNextBtn.disabled = total === 0 || this.viewPly >= total;
    this.revLiveBtn.disabled = total === 0 || this.viewPly >= total;
    this.revPlayBtn.disabled = total === 0;
    this.revPlayBtn.classList.toggle('is-playing', this.autoPlaying);
    this.revPlayBtn.textContent = this.autoPlaying ? '⏸' : '⏯';
    this.revNewDot.hidden = !(this.hasNewMoves && this.viewPly < total);
  }

  _openNewGameModal() {
    this.modalRoot.hidden = false;
    this.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-card">
          <h3 id="modal-title">Bắt đầu ván mới?</h3>
          <p>Lịch sử nước đi hiện tại sẽ được đặt lại về thế cờ ban đầu.</p>
          <div class="modal-actions">
            <button type="button" class="pill-btn modal-cancel">Hủy</button>
            <button type="button" class="pill-btn pill-btn-danger modal-confirm">Ván mới</button>
          </div>
        </div>
      </div>
    `;

    this.modalRoot.querySelector('.modal-cancel').addEventListener('click', () => this.closeModal());
    this.modalRoot.querySelector('.modal-confirm').addEventListener('click', () => {
      this.closeModal();
      this.callbacks.onNewGame();
    });
    this.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) this.closeModal();
    });
  }
}
