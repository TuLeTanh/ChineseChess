import { RED, BLACK, oppositeSide } from './piece.js';
import { isValidPos, moveToIccs } from './moves.js';
import { START_FEN, parseFen, serializeFen, serializePositionKey } from './fen.js';

/**
 * Mutable Xiangqi board state with FEN support, repetition history,
 * half-move no-capture clock, O(1) ply snapshots for review mode, and full undo stack.
 */
export class Board {
  /**
   * @param {string} [fen]
   */
  constructor(fen = START_FEN) {
    /** @type {(import('./piece.js').Piece | null)[][]} */
    this.grid = [];
    /** @type {import('./piece.js').Side} */
    this.sideToMove = RED;
    /** @type {number} */
    this.halfmoveClock = 0;
    /** @type {number} */
    this.fullmoveNumber = 1;
    /** @type {import('./moves.js').Move[]} */
    this.history = [];
    /** @type {string[]} */
    this.positionHistory = [];
    /**
     * O(1) snapshots per ply (index 0 = start position, index k = after ply k).
     * @type {Array<{
     *   fen: string,
     *   sideToMove: import('./piece.js').Side,
     *   move: import('./moves.js').Move | null,
     *   captured: import('./piece.js').Piece | null,
     *   gaveCheck: boolean,
     *   isCheckmate: boolean,
     *   capturedByRed: import('./piece.js').Piece[],
     *   capturedByBlack: import('./piece.js').Piece[],
     * }>}
     */
    this.snapshots = [];
    this.loadFen(fen);
  }

  /**
   * Construct a Board from a FEN string.
   * @param {string} fen
   * @returns {Board}
   */
  static fromFen(fen) {
    return new Board(fen);
  }

  /**
   * Reset board state from a FEN string and clear history.
   * @param {string} [fen]
   */
  loadFen(fen = START_FEN) {
    const parsed = parseFen(fen);
    this.grid = parsed.grid;
    this.sideToMove = parsed.sideToMove;
    this.halfmoveClock = parsed.halfmoveClock;
    this.fullmoveNumber = parsed.fullmoveNumber;
    this.history = [];
    this.positionHistory = [this.positionKey()];
    this.snapshots = [
      {
        fen: this.toFen(),
        sideToMove: this.sideToMove,
        move: null,
        captured: null,
        gaveCheck: false,
        isCheckmate: false,
        capturedByRed: [],
        capturedByBlack: [],
      },
    ];
  }

  /**
   * Return the FEN position key (placement + side to move, without move counters).
   * @returns {string}
   */
  positionKey() {
    return serializePositionKey(this.grid, this.sideToMove);
  }

  /**
   * Serialize current position to full FEN.
   * @returns {string}
   */
  toFen() {
    return serializeFen(this.grid, this.sideToMove, this.fullmoveNumber, this.halfmoveClock);
  }

  /**
   * Return the piece at pos (or null).
   * @param {import('./moves.js').Pos} pos
   * @returns {import('./piece.js').Piece | null}
   */
  at(pos) {
    if (!isValidPos(pos)) return null;
    return this.grid[pos.y][pos.x];
  }

  /**
   * Place or clear a piece at pos.
   * @param {import('./moves.js').Pos} pos
   * @param {import('./piece.js').Piece | null} piece
   */
  set(pos, piece) {
    if (!isValidPos(pos)) return;
    this.grid[pos.y][pos.x] = piece;
  }

  /**
   * Apply a move, pushing it onto the undo stack and recording position history + O(1) snapshot.
   * @param {import('./moves.js').Pos} from
   * @param {import('./moves.js').Pos} to
   * @returns {import('./moves.js').Move | null}
   */
  applyMove(from, to) {
    if (!isValidPos(from) || !isValidPos(to)) return null;
    if (from.x === to.x && from.y === to.y) return null;

    const moving = this.at(from);
    if (!moving) return null;

    const captured = this.at(to);
    this.set(to, { ...moving });
    this.set(from, null);

    /** @type {import('./moves.js').Move} */
    const move = {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      piece: { ...moving },
      captured: captured ? { ...captured } : null,
      side: moving.side,
      prevSideToMove: this.sideToMove,
      prevHalfmoveClock: this.halfmoveClock,
      prevFullmoveNumber: this.fullmoveNumber,
      iccs: moveToIccs(from, to),
      suffix: '',
      gaveCheck: false,
      isCheckmate: false,
    };

    this.history.push(move);
    if (this.sideToMove === BLACK) {
      this.fullmoveNumber += 1;
    }
    this.halfmoveClock = captured ? 0 : this.halfmoveClock + 1;
    this.sideToMove = oppositeSide(moving.side);
    this.positionHistory.push(this.positionKey());

    const prevSnap = this.snapshots[this.snapshots.length - 1];
    const capRed =
      move.captured && move.side === RED
        ? [...prevSnap.capturedByRed, move.captured]
        : prevSnap.capturedByRed;
    const capBlack =
      move.captured && move.side === BLACK
        ? [...prevSnap.capturedByBlack, move.captured]
        : prevSnap.capturedByBlack;

    this.snapshots.push({
      fen: this.toFen(),
      sideToMove: this.sideToMove,
      move,
      captured: move.captured,
      gaveCheck: false,
      isCheckmate: false,
      capturedByRed: capRed,
      capturedByBlack: capBlack,
    });
    return move;
  }

  /**
   * Update check/checkmate metadata on the latest move & snapshot.
   * @param {{ suffix?: string, gaveCheck?: boolean, isCheckmate?: boolean }} flags
   */
  setLastMoveFlags(flags) {
    const n = this.history.length;
    if (n === 0) return;
    const move = this.history[n - 1];
    const snap = this.snapshots[n];
    if (typeof flags.suffix === 'string') move.suffix = flags.suffix;
    if (typeof flags.gaveCheck === 'boolean') {
      move.gaveCheck = flags.gaveCheck;
      if (snap) snap.gaveCheck = flags.gaveCheck;
    }
    if (typeof flags.isCheckmate === 'boolean') {
      move.isCheckmate = flags.isCheckmate;
      if (snap) snap.isCheckmate = flags.isCheckmate;
    }
  }

  /**
   * Undo the most recent move, restoring any captured piece, clocks, snapshots, and position history.
   * @returns {import('./moves.js').Move | null}
   */
  undo() {
    const move = this.history.pop();
    if (!move) return null;

    this.set(move.from, { ...move.piece });
    this.set(move.to, move.captured ? { ...move.captured } : null);
    this.sideToMove = move.prevSideToMove ?? move.side;
    this.halfmoveClock = move.prevHalfmoveClock ?? 0;
    this.fullmoveNumber = move.prevFullmoveNumber ?? Math.max(1, this.fullmoveNumber);
    if (this.positionHistory.length > 1) {
      this.positionHistory.pop();
    }
    if (this.snapshots.length > 1) {
      this.snapshots.pop();
    }
    return move;
  }

  /**
   * Truncate the game state cleanly back to `ply` (0..history.length).
   * Consistent with calling `undo()` repeatedly.
   * @param {number} ply
   * @returns {number} number of plies removed
   */
  truncateTo(ply) {
    const target = Math.max(0, Math.min(this.history.length, Math.floor(ply)));
    let removed = 0;
    while (this.history.length > target) {
      this.undo();
      removed += 1;
    }
    return removed;
  }

  /**
   * Return O(1) snapshot for the given ply (0..history.length).
   * @param {number} ply
   */
  snapshotAt(ply) {
    const idx = Math.max(0, Math.min(this.snapshots.length - 1, Math.floor(ply)));
    return this.snapshots[idx];
  }

  /**
   * Return the FEN string at ply (0..history.length) in O(1).
   * @param {number} ply
   * @returns {string}
   */
  viewFen(ply) {
    return this.snapshotAt(ply).fen;
  }

  /**
   * Return all pieces captured by `captorSide` up to `ply` (O(1)).
   * @param {import('./piece.js').Side} captorSide
   * @param {number} [ply]
   * @returns {import('./piece.js').Piece[]}
   */
  capturedByAt(captorSide, ply = this.history.length) {
    const snap = this.snapshotAt(ply);
    return captorSide === RED ? snap.capturedByRed : snap.capturedByBlack;
  }

  /**
   * Return the most recent move, or null if none.
   * @returns {import('./moves.js').Move | null}
   */
  lastMove() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /**
   * Count how many times the current position key has occurred in this game.
   * @returns {number}
   */
  repetitionCount() {
    const key = this.positionKey();
    let count = 0;
    for (let i = 0; i < this.positionHistory.length; i++) {
      if (this.positionHistory[i] === key) count += 1;
    }
    return count;
  }

  /**
   * Return all pieces captured by the given side in capture order.
   * @param {import('./piece.js').Side} captorSide
   * @returns {import('./piece.js').Piece[]}
   */
  capturedBy(captorSide) {
    return this.capturedByAt(captorSide, this.history.length);
  }
}
