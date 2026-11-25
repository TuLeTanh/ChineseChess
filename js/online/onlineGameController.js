/**
 * Authoritative Online Game Session bridge for gameScreen.js:
 * - Connects/reuses OnlineConnection and handles page-reload resync via `game.state`
 * - Intercepts local human moves -> sends `game.move` -> applies authoritative `game.move`
 * - Drives live clocks (mm:ss, red pulse < 20 s), opponent status dot, disconnect banner,
 *   draw offer/response toast, resign, rematch, and reconnect overlay
 * - Renders ALL user-provided nicknames via textContent (strict XSS safety)
 */
import { OnlineConnection } from './connection.js';
import { formatClockMs, formatOnlineReasonVi } from './protocol.js';
import { parseIccs } from '../game/GameController.js';
import { RED, BLACK, oppositeSide } from '../model/piece.js';
import { moveToIccs } from '../model/moves.js';
import { buildRecordFromBoard } from '../storage/gameRecord.js';
import { openExportModal, saveRecordWithPrunePrompt } from '../ui/saveModals.js';
import { leakTracker } from '../app/router.js';

export class OnlineGameBridge {
  /**
   * @param {{
   *   ctx: any,
   *   controller: any,
   *   boardView: any,
   *   sidePanel: any,
   *   stageEl: HTMLElement,
   * }} opts
   */
  constructor(opts) {
    this.ctx = opts.ctx;
    this.controller = opts.controller;
    this.boardView = opts.boardView;
    this.sidePanel = opts.sidePanel;
    this.stageEl = opts.stageEl;

    this.conn = null;
    this.gameId = null;
    this.mySide = RED;
    this.tc = 'nhanh';
    this.clocks = { red: 600_000, black: 600_000 };
    this.lastClockSyncMs = performance.now();
    this.players = {
      red: { nickname: 'Đỏ', connected: true },
      black: { nickname: 'Đen', connected: true },
    };
    this.over = false;
    this.disposed = false;
    this._clockTimer = null;
    this._unsubs = [];

    this._mountOnlineUi();
  }

  _mountOnlineUi() {
    // Reconnecting overlay + disconnect banner + draw offer toast on board stage
    this.reconnectOverlay = document.createElement('div');
    this.reconnectOverlay.className = 'online-reconnect-overlay';
    this.reconnectOverlay.hidden = true;
    this.reconnectOverlay.innerHTML = `
      <div class="online-reconnect-box">
        <div class="search-ring" aria-hidden="true"></div>
        <p>Đang kết nối lại…</p>
      </div>
    `;

    this.disconnectBanner = document.createElement('div');
    this.disconnectBanner.className = 'online-disconnect-banner';
    this.disconnectBanner.hidden = true;

    this.drawToast = document.createElement('div');
    this.drawToast.className = 'online-draw-toast';
    this.drawToast.hidden = true;
    this.drawToast.innerHTML = `
      <span>Đối thủ xin hòa</span>
      <div class="draw-toast-btns">
        <button type="button" class="mini-seg-btn" data-draw="accept">Chấp nhận</button>
        <button type="button" class="mini-seg-btn" data-draw="decline">Từ chối</button>
      </div>
    `;
    this.drawToast.querySelector('[data-draw="accept"]').addEventListener('click', () => {
      this.drawToast.hidden = true;
      this.conn?.send('game.draw.respond', { accept: true });
    });
    this.drawToast.querySelector('[data-draw="decline"]').addEventListener('click', () => {
      this.drawToast.hidden = true;
      this.conn?.send('game.draw.respond', { accept: false });
    });

    this.stageEl.append(this.disconnectBanner, this.drawToast, this.reconnectOverlay);

    // Online action bar in side panel (Xin hòa / Đầu hàng)
    this.onlineActions = document.createElement('div');
    this.onlineActions.className = 'online-actions-row';
    this.onlineActions.innerHTML = `
      <button type="button" class="pill-btn pill-btn-compact" data-online-act="draw">Xin hòa</button>
      <button type="button" class="pill-btn pill-btn-compact pill-btn-resign" data-online-act="resign">Đầu hàng</button>
    `;
    this.drawBtn = this.onlineActions.querySelector('[data-online-act="draw"]');
    this.resignBtn = this.onlineActions.querySelector('[data-online-act="resign"]');
    this.drawBtn.addEventListener('click', () => {
      if (!this.over) {
        this.conn?.send('game.draw.offer', {});
        this.boardView.showToast('Đã gửi lời mời hòa');
      }
    });
    this.resignBtn.addEventListener('click', () => {
      if (!this.over) this.sidePanel.requestResign();
    });

    const controlsGrid = this.sidePanel.container.querySelector('.controls-grid');
    if (controlsGrid) {
      controlsGrid.parentNode.insertBefore(this.onlineActions, controlsGrid);
    }
    // Hide offline mode-bar/practice-toggle and disable undo/new-game in online mode
    this.sidePanel.mode = 'online';
    const modeBar = this.sidePanel.container.querySelector('.mode-bar');
    if (modeBar) modeBar.style.display = 'none';
    if (this.sidePanel.practiceWrap) this.sidePanel.practiceWrap.style.display = 'none';
    const newBtn = this.sidePanel.container.querySelector('[data-action="new"]');
    if (newBtn) newBtn.disabled = true;
    if (this.sidePanel.undoBtn) this.sidePanel.undoBtn.disabled = true;

    // Intercept local human moves so server is strictly authoritative
    this.boardView.onInterceptMove = (from, to) => {
      if (this.over || !this.conn || this.controller.board.sideToMove !== this.mySide) return;
      const iccs = moveToIccs(from, to);
      this.conn.send('game.move', { gameId: this.gameId, move: iccs });
    };

    // Intercept resign callback from sidePanel modal
    this.sidePanel.callbacks.onResign = () => {
      this.conn?.send('game.resign', {});
    };

    // Start 200 ms clock UI ticker
    leakTracker.trackTimer(1);
    this._clockTimer = window.setInterval(() => this._renderClocks(), 200);
  }

  async attach() {
    const existing = this.ctx.onlineSession;
    this.ctx.onlineSession = null;

    if (existing && existing.conn) {
      this.conn = existing.conn;
      this._bindSocketEvents();
      if (existing.gameState) {
        this._applyFullState(existing.gameState);
      }
      return;
    }

    // Reloaded directly onto #/play/<game>/online -> reconnect and resync active game
    const s = this.ctx.settingsStore.get();
    this.conn = new OnlineConnection({
      nickname: s.nickname || s.online?.nickname || 'Kỳ thủ',
      serverUrl: s.online?.serverUrl || '',
    });
    this._bindSocketEvents();
    this.reconnectOverlay.hidden = false;
    const ok = await this.conn.connect();
    if (!ok && !this.disposed) {
      this.reconnectOverlay.innerHTML = `<div class="online-reconnect-box"><p>Không thể kết nối máy chủ online.</p><button type="button" class="pill-btn" data-back-lobby="1">Về sảnh</button></div>`;
      this.reconnectOverlay.querySelector('[data-back-lobby]')?.addEventListener('click', () => {
        this.ctx.router.navigate('/');
      });
    }
  }

  _bindSocketEvents() {
    const on = (type, fn) => {
      const off = this.conn.on(type, fn);
      this._unsubs.push(off);
    };

    on('status', ({ status }) => {
      if (this.disposed) return;
      this.reconnectOverlay.hidden = status === 'open';
    });

    on('game.start', (state) => {
      if (this.disposed) return;
      this.sidePanel.closeModal();
      this._applyFullState(state);
      this.ctx.sfx.play('start');
    });

    on('game.state', (state) => {
      if (this.disposed) return;
      this.reconnectOverlay.hidden = true;
      this._applyFullState(state);
    });

    on('game.move', (msg) => {
      if (this.disposed || (this.gameId && msg.gameId !== this.gameId)) return;
      this.drawToast.hidden = true;
      this.clocks = msg.clocks || this.clocks;
      this.lastClockSyncMs = performance.now();

      const { from, to } = parseIccs(msg.move);
      const externalReveal =
        msg.reveal || msg.capturedReveal
          ? {
              type: msg.reveal?.type,
              capturedType: msg.capturedReveal?.type,
            }
          : null;

      if (this.controller.isReviewing()) {
        const mv = this.controller.board.applyMove(from, to, externalReveal);
        if (mv) {
          this.controller.hasNewLiveMoves = true;
          this.controller.evaluateStatus({ type: 'move', move: mv });
        }
      } else {
        this.boardView.playMove(from, to, externalReveal);
      }
      this._syncPlayerCards();
      this._renderClocks();
      if (this.sidePanel.undoBtn) this.sidePanel.undoBtn.disabled = true;
    });

    on('opponent.disconnected', ({ graceMs }) => {
      if (this.disposed) return;
      const oppSide = oppositeSide(this.mySide);
      this.players[oppSide].connected = false;
      this._syncPlayerCards();
      const secs = Math.round((graceMs || 90_000) / 1000);
      this.disconnectBanner.textContent = `Đối thủ mất kết nối · chờ ${secs} giây…`;
      this.disconnectBanner.hidden = false;
      this.stageEl.classList.add('has-disconnect-banner');
    });

    on('opponent.reconnected', () => {
      if (this.disposed) return;
      const oppSide = oppositeSide(this.mySide);
      this.players[oppSide].connected = true;
      this._syncPlayerCards();
      this.disconnectBanner.hidden = true;
      this.stageEl.classList.remove('has-disconnect-banner');
      this.boardView.showToast('Đối thủ đã kết nối lại');
    });

    on('game.draw.offered', () => {
      if (this.disposed || this.over) return;
      this.drawToast.hidden = false;
    });

    on('game.draw.declined', () => {
      if (this.disposed) return;
      this.boardView.showToast('Đối thủ từ chối hòa');
    });

    on('game.rematch.offered', () => {
      if (this.disposed) return;
      this.boardView.showToast('Đối thủ muốn tái đấu!');
    });

    on('game.over', (msg) => {
      if (this.disposed || (this.gameId && msg.gameId !== this.gameId)) return;
      this.over = true;
      this.drawToast.hidden = true;
      this.disconnectBanner.hidden = true;
      this.stageEl.classList.remove('has-disconnect-banner');
      if (msg.clocks) this.clocks = msg.clocks;
      this._renderClocks();
      this.boardView.setLocked(true);
      this.drawBtn.disabled = true;
      this.resignBtn.disabled = true;

      const reasonText = formatOnlineReasonVi(msg.reason, msg.winner, this.mySide);
      const kind = !msg.winner ? 'draw' : msg.winner === this.mySide ? 'win' : 'lose';

      const reasonMap = {
        checkmate: 'checkmate',
        stalemate: 'stalemate',
        timeout: 'timeout',
        resign: 'resign',
        abandon: 'abandon',
        draw_agreement: 'drawAgreed',
        draw_repetition: 'repetition',
        draw_no_capture: 'noCapture',
      };
      const finalRecord = buildRecordFromBoard({
        board: this.controller.board,
        variant: this.controller.board.isJieqi ? 'jieqi' : 'xiangqi',
        mode: 'online',
        red: { name: this.players.red?.nickname || 'Đỏ', kind: 'human' },
        black: { name: this.players.black?.nickname || 'Đen', kind: 'human' },
        tc: this.tc,
        result: msg.winner || 'draw',
        reason: reasonMap[msg.reason] || null,
        source: 'autosave',
      });
      this._lastFinishedRecord = finalRecord;
      if (this.ctx.gameStore && this.ctx.settingsStore.get().storage?.saveFinishedGames !== false) {
        saveRecordWithPrunePrompt(this.ctx, finalRecord);
      }

      this._showOnlineGameOverModal(reasonText, kind, msg.ply || this.controller.board.history.length);
    });

    on('error', (msg) => {
      if (this.disposed) return;
      if (msg.message) this.boardView.showToast(msg.message);
    });
  }

  _applyFullState(state) {
    this.gameId = state.gameId;
    this.mySide = state.mySide || RED;
    this.tc = state.tc || 'nhanh';
    this.players = state.players || this.players;
    this.clocks = state.clocks || { red: null, black: null };
    this.lastClockSyncMs = performance.now();
    this.over = Boolean(state.over);

    // Reconstruct authoritative board state cleanly
    const board = this.controller.board;
    if (board.isJieqi) {
      board.loadPublicFen(state.fen);
    } else {
      board.loadFen(state.fen);
    }
    this.controller.playerSide = this.mySide;
    this.controller.viewPly = board.history.length;
    this.controller.inReviewMode = false;

    this.boardView.setHumanSide(this.mySide);
    this.boardView.setFlipped(this.mySide === BLACK);
    this.boardView.syncAfterReset();
    this.boardView.setLocked(this.over);

    this.drawBtn.disabled = this.over;
    this.resignBtn.disabled = this.over;
    this.disconnectBanner.hidden = state.opponentConnected !== false;

    this.controller.evaluateStatus({ type: 'reset' });
    this._syncPlayerCards();
    this._renderClocks();

    if (this.ctx.testMode && typeof window !== 'undefined') {
      window.__onlineState = {
        gameId: this.gameId,
        mySide: this.mySide,
        variant: state.variant,
        tc: this.tc,
      };
    }
  }

  _syncPlayerCards() {
    const syncOne = (cardEl, side) => {
      if (!cardEl) return;
      const p = this.players[side] || { nickname: side === RED ? 'Đỏ' : 'Đen', connected: true };
      const nameEl = cardEl.querySelector('.player-name');
      const subEl = cardEl.querySelector('.player-sub');
      if (nameEl) {
        nameEl.textContent = '';
        const dot = document.createElement('span');
        dot.className = `online-conn-dot ${p.connected ? 'is-on' : 'is-off'}`;
        nameEl.appendChild(dot);
        nameEl.appendChild(document.createTextNode(p.nickname));
      }
      if (subEl) {
        subEl.textContent = side === this.mySide ? 'Bạn' : 'Đối thủ';
      }
    };
    syncOne(this.sidePanel.redCard, RED);
    syncOne(this.sidePanel.blackCard, BLACK);
  }

  _renderClocks() {
    if (this.disposed) return;
    const elapsed = this.over ? 0 : Math.max(0, performance.now() - this.lastClockSyncMs);
    const active = this.controller.board.sideToMove;
    const redMs = this.tc === 'none' ? null : Math.max(0, (this.clocks.red ?? 0) - (active === RED ? elapsed : 0));
    const blackMs = this.tc === 'none' ? null : Math.max(0, (this.clocks.black ?? 0) - (active === BLACK ? elapsed : 0));

    const updateClockEl = (cardEl, ms) => {
      const el = cardEl?.querySelector('.player-clock');
      if (!el) return;
      el.textContent = formatClockMs(ms);
      el.classList.toggle('is-low-time', ms !== null && ms > 0 && ms < 20_000);
    };
    updateClockEl(this.sidePanel.redCard, redMs);
    updateClockEl(this.sidePanel.blackCard, blackMs);
  }

  _showOnlineGameOverModal(reasonText, kind, plies) {
    const modalRoot = this.ctx.modalRoot;
    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="online-go-title">
        <div class="modal-card modal-gameover is-kind-${kind}">
          <h3 id="online-go-title"></h3>
          <p class="gameover-stats">Số nước: ${plies}</p>
          <div class="modal-actions">
            <button type="button" class="pill-btn modal-online-lobby">Về sảnh</button>
            <button type="button" class="pill-btn modal-online-export">Xuất</button>
            <button type="button" class="pill-btn pill-btn-gold modal-online-rematch">Tái đấu</button>
          </div>
        </div>
      </div>
    `;
    modalRoot.querySelector('#online-go-title').textContent = reasonText;
    modalRoot.querySelector('.modal-online-lobby').addEventListener('click', () => {
      this.sidePanel.closeModal();
      this.ctx.router.navigate('/');
    });
    modalRoot.querySelector('.modal-online-export').addEventListener('click', () => {
      if (this._lastFinishedRecord) {
        const b = this.controller.board;
        openExportModal(this.ctx, {
          record: this._lastFinishedRecord,
          currentFen: b.isJieqi ? b.publicFen() : b.toFen(),
          allowSaveToLibrary: true,
        });
      }
    });
    const rematchBtn = modalRoot.querySelector('.modal-online-rematch');
    rematchBtn.addEventListener('click', () => {
      rematchBtn.disabled = true;
      rematchBtn.textContent = 'Đang chờ đối thủ…';
      this.conn?.send('game.rematch', {});
    });
  }

  dispose() {
    this.disposed = true;
    if (this._clockTimer) {
      window.clearInterval(this._clockTimer);
      this._clockTimer = null;
      leakTracker.trackTimer(-1);
    }
    for (const off of this._unsubs) off();
    this._unsubs = [];
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }
}
