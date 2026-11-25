/**
 * Core game session controller (state: live board, review viewPly, AI turn
 * coordination, undo/truncate, status evaluation, and end-of-game cinematics).
 * Parameterised by variant (xiangqi / jieqi) and mode (local / ai / online).
 */
import { Board } from '../model/board.js';
import { JieqiBoard, LETTER_TO_KIND } from '../jieqi/rules.js';
import { START_FEN } from '../model/fen.js';
import { RED, BLACK } from '../model/piece.js';
import { GameStatus } from '../rules.js';
import { formatGameOverText } from '../ui/sidePanel.js';
import { playEndFx } from '../fx/endFx.js';
import { leakTracker } from '../app/router.js';

const MIN_AI_THINK_MS = 450;
const AUTO_REPLAY_MS = 800;
const REVIEW_STEP_GAIN = 0.355; // -9 dB quiet clack while stepping in review
const FILES = 'abcdefghi';

export function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export class GameController {
  /**
   * @param {{
   *   variant: any,
   *   mode: 'local' | 'ai' | 'online',
   *   playerSide: 'red' | 'black',
   *   aiLevel: string,
   *   engineType: 'pikafish' | 'js',
   *   practiceMode?: boolean,
   *   autoFlipLocal?: boolean,
   *   initialFen?: string,
   *   theme: any,
   *   sfx: any,
   *   aiClient: any,
   *   pikafishClient: any,
   *   testMode?: boolean,
   * }} opts
   */
  constructor(opts) {
    this.variant = opts.variant;
    this.mode = opts.mode || 'local';
    this.playerSide = opts.playerSide || RED;
    this.aiLevel = opts.aiLevel || 'nghiep-du';
    this.engineType = opts.engineType || 'js';
    this.practiceMode = Boolean(opts.practiceMode) && this.mode === 'local';
    this.autoFlipLocal = Boolean(opts.autoFlipLocal);
    this.gameStartFen = opts.initialFen || (this.variant.id === 'coup' ? '' : START_FEN);
    this.theme = opts.theme;
    this.sfx = opts.sfx;
    this.aiClient = opts.aiClient;
    this.pikafishClient = opts.pikafishClient;
    this.testMode = Boolean(opts.testMode);
    this.onPersistHook = opts.onPersistHook || (() => {});

    this.board = this.variant.createInitialState({ fen: this.gameStartFen });
    this.activeRules = this.variant.createRules(this.practiceMode);
    this.strictRules = this.variant.createRules(false);

    this.hintsLeft = 3;
    this.resigned = false;
    this.lastStatus = GameStatus.Playing;
    this.aiSearchToken = 0;

    // Review state (separate from live board)
    this.viewPly = 0;
    this.inReviewMode = false;
    this.hasNewLiveMoves = false;
    this.autoPlayTimer = null;
    this.activeEndFx = null;

    this.boardView = null;
    this.sidePanel = null;
    this.disposed = false;
  }

  attachViews(boardView, sidePanel) {
    this.boardView = boardView;
    this.sidePanel = sidePanel;
    if (this.mode === 'ai') {
      this.boardView.setHumanSide(this.playerSide);
      this.boardView.setFlipped(this.playerSide === BLACK);
    } else {
      this.boardView.setHumanSide(null);
    }
    this.evaluateStatus();

    const initialStatus = this.activeRules.status(this.board, this.board.sideToMove);
    const initialResult = formatGameOverText(initialStatus, this.board.sideToMove, {
      vsAi: this.mode === 'ai',
      playerSide: this.playerSide,
    });
    if (initialResult && this.sidePanel) {
      this.sidePanel.showGameOverModal(initialResult);
    } else if (initialStatus === GameStatus.Check) {
      this.boardView.showVoiceCaption({
        event: 'check',
        caption: '將軍',
        pinyin: 'jiāng jūn',
        vi: 'Chiếu tướng!',
      });
    } else if (this.mode === 'ai' && this.board.sideToMove !== this.playerSide) {
      this.maybeTriggerAiTurn();
    }

    if (this.testMode && typeof window !== 'undefined') {
      window.__board = this.board;
      this.updateViewHook();
    }
  }

  setTheme(theme) {
    this.theme = theme;
  }

  isReviewing() {
    return this.inReviewMode && this.viewPly < this.board.history.length;
  }

  isGameInProgress() {
    return this.board.history.length > 0 && !this.isGameOver();
  }

  canUndo() {
    if (this.board.isJieqi && (this.mode === 'ai' || this.mode === 'online')) return false;
    return true;
  }

  canContinue() {
    if (this.board.isJieqi && (this.mode === 'ai' || this.mode === 'online')) return false;
    if (this.mode === 'online') return false;
    return true;
  }

  _boardFromSnapshotFen(fen) {
    return this.board.isJieqi ? JieqiBoard.fromPublicFen(fen) : Board.fromFen(fen);
  }

  isGameOver() {
    return (
      this.resigned ||
      this.lastStatus === GameStatus.Checkmate ||
      this.lastStatus === GameStatus.Stalemate ||
      this.lastStatus === GameStatus.DrawRepetition ||
      this.lastStatus === GameStatus.DrawNoCapture
    );
  }

  updateViewHook() {
    if (this.testMode && typeof window !== 'undefined') {
      window.__view = {
        ply: this.viewPly,
        total: this.board.history.length,
        fen: this.board.viewFen(this.viewPly),
      };
    }
  }

  stopAutoPlay() {
    if (this.autoPlayTimer) {
      window.clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
      leakTracker.trackTimer(-1);
      if (this.sidePanel) {
        this.sidePanel.setReviewState({
          viewPly: this.viewPly,
          hasNewMoves: this.hasNewLiveMoves,
          autoPlaying: false,
          skipScroll: true,
        });
      }
    }
  }

  cancelEndFx() {
    if (this.activeEndFx) {
      this.activeEndFx.cancel();
      this.activeEndFx = null;
    }
  }

  cancelAi() {
    this.aiSearchToken++;
    if (this.pikafishClient) this.pikafishClient.cancel();
    if (this.aiClient) this.aiClient.cancel();
    if (this.sidePanel) this.sidePanel.setAiThinking(false, null);
  }

  usePikafish() {
    return (
      this.variant.supportsPikafish &&
      this.engineType === 'pikafish' &&
      this.pikafishClient &&
      this.pikafishClient.isAvailable()
    );
  }

  isLegalIccsMove(iccs) {
    if (!iccs || iccs.length !== 4) return false;
    const { from, to } = parseIccs(iccs);
    const p = this.board.at(from);
    if (!p || p.side !== this.board.sideToMove) return false;
    return this.strictRules.legalMoves(this.board, from).some((m) => m.x === to.x && m.y === to.y);
  }

  async runEngineSearch(levelId, onInfo) {
    if (this.usePikafish()) {
      const moves = this.board.history.map((m) => m.iccs);
      const res = await this.pikafishClient.search({
        fen: this.gameStartFen,
        moves,
        level: levelId,
        onInfo,
      });
      if (res && res.move && this.isLegalIccsMove(res.move)) {
        return res;
      }
      if (res && res.move) {
        console.debug('Pikafish returned illegal move, falling back to JS engine:', res.move);
      }
      if (res === null) return null;
    }
    return this.aiClient.search({
      variant: this.variant.id,
      fen: this.board.isJieqi ? this.board.publicFen() : this.board.toFen(),
      history: this.board.positionHistory,
      level: levelId,
      onInfo,
    });
  }

  goToPly(targetPly, { isScrub = false, fromAuto = false } = {}) {
    if (this.disposed) return;
    if (!fromAuto) this.stopAutoPlay();
    this.cancelEndFx();

    const total = this.board.history.length;
    const clamped = Math.max(0, Math.min(total, Math.floor(targetPly)));
    const prevPly = this.viewPly;
    const delta = clamped - prevPly;
    this.viewPly = clamped;

    if (this.viewPly === total) {
      this.hasNewLiveMoves = false;
    }

    const active = this.viewPly < total;
    this.inReviewMode = active;
    const snap = this.board.snapshotAt(this.viewPly);
    const viewBoard = active ? this._boardFromSnapshotFen(snap.fen) : null;
    const reduced = prefersReducedMotion();

    let transition = 'instant';
    let stepMove = null;
    if (delta === 1 && !isScrub) {
      transition = reduced ? 'instant' : 'forward';
      stepMove = this.board.history[clamped - 1] || null;
      if (stepMove) {
        this.sfx.play(stepMove.captured ? 'capture' : 'move', 0, {
          skipVoice: true,
          gainScale: REVIEW_STEP_GAIN,
        });
      }
    } else if (delta === -1 && !isScrub) {
      transition = reduced ? 'instant' : 'backward';
      stepMove = this.board.history[prevPly - 1] || null;
      if (stepMove) {
        this.sfx.play(stepMove.captured ? 'capture' : 'move', 0, {
          skipVoice: true,
          gainScale: REVIEW_STEP_GAIN,
        });
      }
    } else if (delta !== 0) {
      transition = reduced ? 'instant' : 'jump';
      if (!isScrub) {
        this.sfx.play('select', 0, { skipVoice: true, gainScale: 0.35 });
      }
    }

    if (this.boardView) {
      this.boardView.setReviewState({
        active,
        viewPly: this.viewPly,
        totalPlies: total,
        hasNewMoves: this.hasNewLiveMoves,
        viewBoard,
        lastMove: snap.move,
        transition,
        stepMove,
        reducedMotion: reduced,
      });
    }
    if (this.sidePanel) {
      this.sidePanel.setReviewState({
        viewPly: this.viewPly,
        hasNewMoves: this.hasNewLiveMoves,
        autoPlaying: Boolean(this.autoPlayTimer),
        skipScroll: isScrub,
      });
    }
    this.updateViewHook();
  }

  toggleAutoPlay() {
    if (this.autoPlayTimer) {
      this.stopAutoPlay();
      return;
    }
    const total = this.board.history.length;
    if (total === 0) return;
    if (this.viewPly >= total) {
      this.goToPly(0, { fromAuto: true });
    }
    leakTracker.trackTimer(1);
    this.autoPlayTimer = window.setInterval(() => {
      if (this.disposed || this.viewPly >= this.board.history.length) {
        this.stopAutoPlay();
        return;
      }
      this.goToPly(this.viewPly + 1, { fromAuto: true });
      if (this.viewPly >= this.board.history.length) {
        this.stopAutoPlay();
      }
    }, AUTO_REPLAY_MS);
    if (this.sidePanel) {
      this.sidePanel.setReviewState({
        viewPly: this.viewPly,
        hasNewMoves: this.hasNewLiveMoves,
        autoPlaying: true,
        skipScroll: true,
      });
    }
  }

  triggerEndCinematic(status, isResign = false) {
    this.cancelEndFx();
    this.stopAutoPlay();
    const vsAi = this.mode === 'ai';
    const side = this.board.sideToMove;
    const winnerSide = side === RED ? BLACK : RED;
    const resultText = formatGameOverText(status, side, {
      vsAi,
      playerSide: this.playerSide,
      resigned: isResign,
    });
    if (!resultText || !this.boardView) return;

    let kind = 'win';
    let reason = 'checkmate';
    let reasonText = `Chiếu bí sau ${this.board.history.length} nước`;
    let fxWinner = winnerSide;
    let genSide = side;

    if (isResign) {
      kind = 'resign';
      reason = 'resign';
      reasonText = 'Bạn đã đầu hàng ván đấu';
      fxWinner = this.playerSide === RED ? BLACK : RED;
      genSide = this.playerSide;
    } else if (status === GameStatus.DrawRepetition) {
      kind = 'draw';
      reason = 'repetition';
      reasonText = 'Lặp thế cờ 3 lần';
      fxWinner = null;
      genSide = null;
    } else if (status === GameStatus.DrawNoCapture) {
      kind = 'draw';
      reason = 'norule';
      reasonText = '60 nước không ăn quân';
      fxWinner = null;
      genSide = null;
    } else {
      const isHumanLoss = vsAi && winnerSide !== this.playerSide;
      kind = isHumanLoss ? 'lose' : 'win';
      reason = status === GameStatus.Stalemate ? 'stalemate' : 'checkmate';
      reasonText =
        status === GameStatus.Stalemate
          ? isHumanLoss
            ? 'Hết nước đi: bên bị bí thua (luật cờ tướng)'
            : 'Đối phương hết nước đi'
          : `Chiếu bí sau ${this.board.history.length} nước`;
    }

    let tClashOverride = null;
    if (kind === 'win' && this.sfx.isVoiceEnabled() && !this.sfx.isMuted()) {
      const mateDurMs = Math.round(this.sfx.voice.getDuration('checkmate', 0.85) * 1000);
      tClashOverride = 300 + mateDurMs;
    }

    const genPos = genSide ? this.boardView.getGeneralBoardPos(genSide) : null;
    this.boardView.setLocked(true);

    this.activeEndFx = playEndFx({
      container: this.boardView.wrapper,
      boardSvg: this.boardView.svg,
      theme: this.theme,
      kind,
      winnerSide: fxWinner,
      reason,
      generalSquare: genPos,
      vsAi,
      sfx: this.sfx,
      tClashOverride,
      reducedMotion: prefersReducedMotion(),
      testMode: this.testMode,
      onDone: () => {
        if (!this.disposed && this.sidePanel) {
          this.sidePanel.showGameOverModal(resultText, { kind, reasonText });
        }
      },
    });
  }

  evaluateStatus(evt = null) {
    const enforceRules = this.mode !== 'local' || !this.practiceMode;
    const status = enforceRules
      ? this.activeRules.status(this.board, this.board.sideToMove)
      : GameStatus.Playing;
    this.lastStatus = status;

    if (evt && evt.type === 'move' && evt.move && enforceRules) {
      const isMate = status === GameStatus.Checkmate;
      const isChk = status === GameStatus.Check || isMate;
      this.board.setLastMoveFlags({
        suffix: isMate ? '#' : status === GameStatus.Check ? '+' : '',
        gaveCheck: isChk,
        isCheckmate: isMate,
      });
    }

    if (!this.isReviewing()) {
      this.viewPly = this.board.history.length;
    }

    const resultText = formatGameOverText(status, this.board.sideToMove, {
      vsAi: this.mode === 'ai',
      playerSide: this.playerSide,
      resigned: this.resigned,
    });
    if (this.boardView) this.boardView.setLocked(Boolean(resultText));

    if (this.sidePanel) {
      this.sidePanel.viewPly = Math.min(this.viewPly, this.board.history.length);
      this.sidePanel.hasNewMoves = this.hasNewLiveMoves;
      this.sidePanel.update(status);
    }
    this.updateViewHook();

    if (evt && evt.type === 'move') {
      if (!resultText && status === GameStatus.Check && !this.sfx.isVoiceEnabled() && !this.isReviewing()) {
        this.boardView.showToast('Chiếu tướng!');
      }
    } else if (evt && evt.type === 'undo') {
      this.sfx.play('undo');
      if (this.sidePanel) this.sidePanel.closeModal();
    }
  }

  async maybeTriggerAiTurn() {
    if (this.disposed || this.mode !== 'ai' || this.isGameOver()) return;
    if (this.board.sideToMove === this.playerSide) return;

    const token = ++this.aiSearchToken;
    const startTs = performance.now();
    if (this.sidePanel) this.sidePanel.setAiThinking(true, null);

    const res = await this.runEngineSearch(this.aiLevel, (info) => {
      if (!this.disposed && token === this.aiSearchToken && this.sidePanel) {
        this.sidePanel.setAiThinking(true, info);
      }
    });

    if (this.disposed || token !== this.aiSearchToken || !res || !res.move) return;

    const elapsed = performance.now() - startTs;
    const waitMs = Math.max(0, MIN_AI_THINK_MS - elapsed);
    if (waitMs > 0) {
      await new Promise((r) => window.setTimeout(r, waitMs));
    }
    if (this.disposed || token !== this.aiSearchToken || this.isGameOver() || this.mode !== 'ai') return;

    if (this.sidePanel) {
      this.sidePanel.setAiThinking(false, {
        depth: res.depth,
        score: res.score,
        scoreObj: res.scoreObj || null,
        nps: res.nps || 0,
      });
    }
    const { from, to } = parseIccs(res.move);

    if (this.isReviewing()) {
      const move = this.board.applyMove(from, to);
      if (move) {
        this.hasNewLiveMoves = true;
        this.evaluateStatus({ type: 'move', move });
        const snap = this.board.snapshotAt(this.viewPly);
        this.boardView.setReviewState({
          active: true,
          viewPly: this.viewPly,
          totalPlies: this.board.history.length,
          hasNewMoves: true,
          viewBoard: this._boardFromSnapshotFen(snap.fen),
          lastMove: snap.move,
          transition: 'instant',
          reducedMotion: true,
        });
      }
      return;
    }

    this.boardView.playMove(from, to);
  }

  onMoveLanded(move) {
    if (this.disposed) return;
    const enforceRules = this.mode !== 'local' || !this.practiceMode;
    const isMateOrStale =
      enforceRules &&
      (this.lastStatus === GameStatus.Checkmate || this.lastStatus === GameStatus.Stalemate);
    const isDraw =
      enforceRules &&
      (this.lastStatus === GameStatus.DrawRepetition || this.lastStatus === GameStatus.DrawNoCapture);
    const isSpecial = enforceRules && (this.lastStatus === GameStatus.Check || isMateOrStale || isDraw);

    this.sfx.play(move.captured ? 'capture' : 'move', 0, { skipVoice: isSpecial });
    if (move.wasCovered && move.reveal && typeof this.sfx.playReveal === 'function') {
      this.sfx.playReveal(move.reveal.type);
    }

    if (enforceRules) {
      if (this.lastStatus === GameStatus.Check) {
        this.sfx.play('check', 0);
      } else if (isMateOrStale) {
        const winnerSide = this.board.sideToMove === RED ? BLACK : RED;
        const isHumanLoss = this.mode === 'ai' && winnerSide !== this.playerSide;
        if (!isHumanLoss) {
          this.sfx.play('checkmate', 0);
        }
        this.onPersistHook({ event: 'gameover', status: this.lastStatus, isResign: false });
        this.triggerEndCinematic(this.lastStatus, false);
      } else if (isDraw) {
        this.sfx.play('draw', 0);
        this.onPersistHook({ event: 'gameover', status: this.lastStatus, isResign: false });
        this.triggerEndCinematic(this.lastStatus, false);
      }
    }
    if (!this.isGameOver()) {
      this.onPersistHook({ event: 'move', move });
    }

    if (this.mode === 'local' && this.autoFlipLocal && !this.isGameOver() && this.boardView) {
      this.boardView.flip();
    }

    if (this.mode === 'ai' && !this.isGameOver() && this.board.sideToMove !== this.playerSide) {
      this.maybeTriggerAiTurn();
    }
  }

  onStateChange(evt) {
    if (evt.type === 'move' && !this.isReviewing()) {
      this.viewPly = this.board.history.length;
    } else if (evt.type === 'undo') {
      this.viewPly = Math.min(this.viewPly, this.board.history.length);
    }
    this.evaluateStatus(evt);
  }

  startFreshGame(playStartSfx = true) {
    this.cancelAi();
    this.cancelEndFx();
    this.stopAutoPlay();
    this.resigned = false;
    this.hintsLeft = 3;
    this.hasNewLiveMoves = false;
    this.inReviewMode = false;
    this.viewPly = 0;
    this.gameStartFen = START_FEN;
    if (this.board.isJieqi) {
      this.board.reset({});
    } else {
      this.board.loadFen(START_FEN);
    }
    if (this.usePikafish()) this.pikafishClient.newGame();
    if (this.boardView) {
      this.boardView.clearHintArrow();
      this.boardView.syncAfterReset();
      if (this.mode === 'ai') {
        this.practiceMode = false;
        this.activeRules = this.variant.createRules(false);
        this.boardView.setRules(this.activeRules, false);
        this.boardView.setHumanSide(this.playerSide);
        this.boardView.setFlipped(this.playerSide === BLACK);
      } else {
        this.boardView.setHumanSide(null);
      }
    }
    if (this.sidePanel) {
      this.sidePanel.setResigned(false);
      this.sidePanel.setHintsLeft(this.hintsLeft);
      this.sidePanel.closeModal();
      this.sidePanel.viewPly = 0;
      this.sidePanel.hasNewMoves = false;
      this.sidePanel.autoPlaying = false;
    }
    this.evaluateStatus({ type: 'reset' });
    this.onPersistHook({ event: 'reset' });
    if (playStartSfx) this.sfx.play('start');
    if (this.mode === 'ai' && this.board.sideToMove !== this.playerSide) {
      this.maybeTriggerAiTurn();
    }
  }

  handleContinueFromHere(ply) {
    if (!this.canContinue()) return;
    this.cancelAi();
    this.cancelEndFx();
    this.stopAutoPlay();
    this.resigned = false;
    this.hasNewLiveMoves = false;
    this.inReviewMode = false;
    this.board.truncateTo(ply);
    this.viewPly = this.board.history.length;
    if (this.usePikafish()) this.pikafishClient.newGame();
    if (this.boardView) {
      this.boardView.setReviewState({
        active: false,
        viewPly: this.viewPly,
        totalPlies: this.viewPly,
        hasNewMoves: false,
        viewBoard: null,
        lastMove: this.board.lastMove(),
        transition: 'instant',
        reducedMotion: true,
      });
    }
    if (this.sidePanel) {
      this.sidePanel.setResigned(false);
      this.sidePanel.closeModal();
    }
    this.evaluateStatus({ type: 'truncate' });
    if (this.mode === 'ai' && !this.isGameOver() && this.board.sideToMove !== this.playerSide) {
      this.maybeTriggerAiTurn();
    }
  }

  handleUndo() {
    if (!this.canUndo()) return;
    this.cancelEndFx();
    this.stopAutoPlay();
    if (this.boardView) this.boardView.clearHintArrow();

    if (this.isReviewing()) {
      this.goToPly(this.board.history.length, { isScrub: true });
    }

    if (this.mode === 'ai') {
      const wasThinking = this.sidePanel && this.sidePanel.aiThinking;
      this.cancelAi();
      if (this.resigned) {
        this.resigned = false;
        if (this.sidePanel) {
          this.sidePanel.setResigned(false);
          this.sidePanel.closeModal();
        }
        this.evaluateStatus({ type: 'undo' });
        return;
      }
      if (wasThinking || this.board.sideToMove !== this.playerSide) {
        if (this.board.history.length >= 1) {
          this.boardView.undo();
          this.viewPly = this.board.history.length;
          this.updateViewHook();
        }
      } else {
        if (this.board.history.length < 2) return;
        this.board.undo();
        this.boardView.renderPieces();
        this.boardView.undo();
        this.viewPly = this.board.history.length;
        this.updateViewHook();
      }
      return;
    }
    this.boardView.undo();
    this.viewPly = this.board.history.length;
    this.updateViewHook();
    this.onPersistHook({ event: 'undo' });
  }

  async handleHint() {
    if (
      this.isReviewing() ||
      this.mode !== 'ai' ||
      this.isGameOver() ||
      this.hintsLeft <= 0 ||
      this.board.sideToMove !== this.playerSide
    ) {
      return;
    }
    const token = ++this.aiSearchToken;
    if (this.sidePanel) this.sidePanel.setAiThinking(true, null);
    const res = await this.runEngineSearch('hint', null);
    if (this.disposed || token !== this.aiSearchToken) return;
    if (this.sidePanel) this.sidePanel.setAiThinking(false, null);
    if (res && res.move) {
      this.hintsLeft = Math.max(0, this.hintsLeft - 1);
      if (this.sidePanel) this.sidePanel.setHintsLeft(this.hintsLeft);
      const { from, to } = parseIccs(res.move);
      this.boardView.showHintArrow(from, to, 2500);
    }
  }

  handleResign() {
    this.cancelAi();
    this.resigned = true;
    if (this.sidePanel) this.sidePanel.setResigned(true);
    if (this.boardView) this.boardView.setLocked(true);
    if (this.sidePanel) this.sidePanel.update(this.lastStatus);
    this.onPersistHook({ event: 'gameover', status: this.lastStatus, isResign: true });
    this.triggerEndCinematic(this.lastStatus, true);
  }

  /**
   * Restore an autosave snapshot exactly (board, history, clocks, Jieqi secretLocal, AI config).
   */
  restoreAutosave(snapshot) {
    if (!snapshot || !snapshot.record) return false;
    const rec = snapshot.record;
    this.gameStartFen = rec.start.fen;
    if (this.board.isJieqi) {
      this.board.loadPublicFen(rec.start.fen);
    } else {
      this.board.loadFen(rec.start.fen);
    }
    for (const mv of rec.moves || []) {
      const { from, to } = parseIccs(mv.m);
      const ext =
        this.board.isJieqi && (mv.r || mv.cr)
          ? {
              type: mv.r ? LETTER_TO_KIND[mv.r] : undefined,
              capturedType: mv.cr ? LETTER_TO_KIND[mv.cr] : undefined,
            }
          : null;
      this.board.applyMove(from, to, ext);
    }
    if (this.board.isJieqi && snapshot.secretLocal && typeof snapshot.secretLocal === 'object') {
      this.board._secret = new Map(Object.entries(snapshot.secretLocal));
    }
    if (typeof snapshot.halfmoveClock === 'number') {
      this.board.halfmoveClock = snapshot.halfmoveClock;
    }
    if (Array.isArray(snapshot.positionHistory) && snapshot.positionHistory.length > 0) {
      this.board.positionHistory = [...snapshot.positionHistory];
    }
    if (snapshot.ai) {
      if (snapshot.ai.side) this.playerSide = snapshot.ai.side;
      if (snapshot.ai.level) this.aiLevel = snapshot.ai.level;
      if (snapshot.ai.engine) this.engineType = snapshot.ai.engine;
    }
    if (typeof snapshot.free === 'boolean' && this.mode === 'local') {
      this.practiceMode = snapshot.free;
      this.activeRules = this.variant.createRules(this.practiceMode);
    }
    this.viewPly = this.board.history.length;
    this.inReviewMode = false;
    this.hasNewLiveMoves = false;
    if (this.boardView) {
      this.boardView.setRules(this.activeRules, this.practiceMode);
      if (this.mode === 'ai') {
        this.boardView.setHumanSide(this.playerSide);
        this.boardView.setFlipped(this.playerSide === BLACK);
      }
      this.boardView.syncAfterReset();
    }
    if (this.sidePanel) {
      this.sidePanel.playerSide = this.playerSide;
      this.sidePanel.aiLevel = this.aiLevel;
    }
    this.evaluateStatus({ type: 'reset' });
    if (this.mode === 'ai' && !this.isGameOver() && this.board.sideToMove !== this.playerSide) {
      this.maybeTriggerAiTurn();
    }
    return true;
  }

  dispose() {
    this.disposed = true;
    this.cancelAi();
    this.cancelEndFx();
    this.stopAutoPlay();
    if (this.boardView) {
      this.boardView.animator.clear();
      this.boardView.clearHintArrow();
    }
    if (this.aiClient) {
      this.aiClient.terminate();
    }
  }
}
