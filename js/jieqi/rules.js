/**
 * Pure Cờ Úp (Jieqi) rules engine & board model (zero DOM/window access; importable in Node).
 *
 * Rules reference:
 * - https://www.chessprogramming.org/Jeiqi
 * - https://www.pychess.org/variants/jieqi
 *
 * Key invariants:
 * - `grid[y][x]` stores ONLY public info: `{ side, kind, covered }` where `kind` is the
 *   square's standard Xiangqi starting "fake type" while `covered === true`.
 * - `secret` (Map<"x,y", Kind>) is held privately on JieqiBoard and ONLY consulted inside
 *   `applyMove()` to resolve reveals; it is NEVER serialized into `publicFen()`, `snapshots`,
 *   or engine inputs.
 * - Legal move generation NEVER depends on the hidden identity of the moving piece.
 */
import { RED, BLACK, oppositeSide } from '../model/piece.js';
import { isValidPos, moveToIccs } from '../model/moves.js';
import { GameStatus } from '../rules.js';

export const REVEAL_ON_CAPTURE = true;

export const NON_GENERAL_KINDS = ['chariot', 'horse', 'elephant', 'advisor', 'cannon', 'soldier'];

export const KIND_TO_LETTER = {
  general: 'K',
  chariot: 'R',
  horse: 'N',
  elephant: 'B',
  advisor: 'A',
  cannon: 'C',
  soldier: 'P',
};

export const LETTER_TO_KIND = {
  K: 'general',
  R: 'chariot',
  N: 'horse',
  B: 'elephant',
  A: 'advisor',
  C: 'cannon',
  P: 'soldier',
};

/** Standard Xiangqi fake type for each of the 15 non-general starting squares per side. */
export const STARTING_FAKE_LAYOUT = {
  [BLACK]: [
    { x: 0, y: 0, kind: 'chariot' },
    { x: 1, y: 0, kind: 'horse' },
    { x: 2, y: 0, kind: 'elephant' },
    { x: 3, y: 0, kind: 'advisor' },
    { x: 5, y: 0, kind: 'advisor' },
    { x: 6, y: 0, kind: 'elephant' },
    { x: 7, y: 0, kind: 'horse' },
    { x: 8, y: 0, kind: 'chariot' },
    { x: 1, y: 2, kind: 'cannon' },
    { x: 7, y: 2, kind: 'cannon' },
    { x: 0, y: 3, kind: 'soldier' },
    { x: 2, y: 3, kind: 'soldier' },
    { x: 4, y: 3, kind: 'soldier' },
    { x: 6, y: 3, kind: 'soldier' },
    { x: 8, y: 3, kind: 'soldier' },
  ],
  [RED]: [
    { x: 0, y: 9, kind: 'chariot' },
    { x: 1, y: 9, kind: 'horse' },
    { x: 2, y: 9, kind: 'elephant' },
    { x: 3, y: 9, kind: 'advisor' },
    { x: 5, y: 9, kind: 'advisor' },
    { x: 6, y: 9, kind: 'elephant' },
    { x: 7, y: 9, kind: 'horse' },
    { x: 8, y: 9, kind: 'chariot' },
    { x: 1, y: 7, kind: 'cannon' },
    { x: 7, y: 7, kind: 'cannon' },
    { x: 0, y: 6, kind: 'soldier' },
    { x: 2, y: 6, kind: 'soldier' },
    { x: 4, y: 6, kind: 'soldier' },
    { x: 6, y: 6, kind: 'soldier' },
    { x: 8, y: 6, kind: 'soldier' },
  ],
};

const FAKE_TYPE_LOOKUP = new Map();
for (const side of [RED, BLACK]) {
  for (const sq of STARTING_FAKE_LAYOUT[side]) {
    FAKE_TYPE_LOOKUP.set(`${side}:${sq.x},${sq.y}`, sq.kind);
  }
}

export function getFakeTypeForSquare(side, x, y) {
  return FAKE_TYPE_LOOKUP.get(`${side}:${x},${y}`) || 'soldier';
}

export function createFullPool() {
  return {
    chariot: 2,
    horse: 2,
    elephant: 2,
    advisor: 2,
    cannon: 2,
    soldier: 5,
  };
}

export function poolToArray(pool) {
  const arr = [];
  for (const kind of NON_GENERAL_KINDS) {
    const n = pool[kind] || 0;
    for (let i = 0; i < n; i++) arr.push(kind);
  }
  return arr;
}

export function makeSeededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultRandomInt(maxExclusive) {
  if (maxExclusive <= 1) return 0;
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    while (true) {
      globalThis.crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % maxExclusive;
    }
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function shuffleArray(arr, seed = null) {
  const copy = arr.slice();
  const rng = typeof seed === 'number' && Number.isFinite(seed) ? makeSeededRng(seed) : null;
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng ? Math.floor(rng() * (i + 1)) : defaultRandomInt(i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Uniformly deal remaining unrevealed pool identities to still-covered squares of each side.
 * Used when continuing an imported or truncated Jieqi game. Does NOT change publicFen().
 * @param {JieqiBoard} board
 * @param {{ red: Record<string, number>, black: Record<string, number> }} pool
 * @param {(() => number) | number | null} [rngOrSeed]
 * @returns {Map<string, string>}
 */
export function dealRemainingPool(board, pool, rngOrSeed = null) {
  const rng =
    typeof rngOrSeed === 'function'
      ? rngOrSeed
      : typeof rngOrSeed === 'number' && Number.isFinite(rngOrSeed)
        ? makeSeededRng(rngOrSeed)
        : null;

  const secret = new Map();
  for (const side of [BLACK, RED]) {
    const coveredSquares = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = board.at({ x, y });
        if (p && p.side === side && p.covered) {
          coveredSquares.push(`${x},${y}`);
        }
      }
    }
    const deck = poolToArray(pool[side] || {});
    if (deck.length !== coveredSquares.length) {
      throw new Error(
        `Pool mismatch for ${side}: ${deck.length} pool pieces vs ${coveredSquares.length} covered squares`
      );
    }
    // Fisher-Yates shuffle with rng or crypto.getRandomValues
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng ? Math.floor(rng() * (i + 1)) : defaultRandomInt(i + 1);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    for (let i = 0; i < coveredSquares.length; i++) {
      secret.set(coveredSquares[i], deck[i]);
    }
  }
  board._secret = secret;
  return secret;
}

function serializePoolStr(pool) {
  const one = (p, upper) =>
    NON_GENERAL_KINDS.map((k) => {
      const ch = KIND_TO_LETTER[k];
      return `${upper ? ch : ch.toLowerCase()}${p[k] || 0}`;
    }).join('');
  return `${one(pool[RED], true)}/${one(pool[BLACK], false)}`;
}

function parsePoolStr(str) {
  const res = { [RED]: createFullPool(), [BLACK]: createFullPool() };
  if (!str || !str.includes('/')) return res;
  const [redPart, blackPart] = str.split('/');
  const parseSide = (part, target) => {
    for (const k of NON_GENERAL_KINDS) target[k] = 0;
    const rx = /([RNBACP])(\d+)/gi;
    let m;
    while ((m = rx.exec(part)) !== null) {
      const k = LETTER_TO_KIND[m[1].toUpperCase()];
      if (k && k !== 'general') target[k] = Number(m[2]);
    }
  };
  parseSide(redPart, res[RED]);
  parseSide(blackPart, res[BLACK]);
  return res;
}

export function serializePublicBoard(grid) {
  const ranks = [];
  for (let y = 0; y < 10; y++) {
    let row = '';
    let empty = 0;
    for (let x = 0; x < 9; x++) {
      const p = grid[y][x];
      if (!p) {
        empty++;
      } else {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        if (p.covered) {
          row += p.side === RED ? 'X' : 'x';
        } else {
          const ch = KIND_TO_LETTER[p.kind] || 'P';
          row += p.side === RED ? ch : ch.toLowerCase();
        }
      }
    }
    if (empty > 0) row += String(empty);
    ranks.push(row);
  }
  return ranks.join('/');
}

function clonePool(pool) {
  return {
    [RED]: { ...pool[RED] },
    [BLACK]: { ...pool[BLACK] },
  };
}

/**
 * Jieqi (Cờ Úp) board & game state implementing the same surface API as Board
 * so BoardView, SidePanel, and GameController work uniformly.
 */
export class JieqiBoard {
  /**
   * @param {{ seed?: number | null, secret?: Map<string, string> | null, revealOnCapture?: boolean }} [opts]
   */
  constructor(opts = {}) {
    this.isJieqi = true;
    this.revealOnCapture = opts.revealOnCapture ?? REVEAL_ON_CAPTURE;
    this.grid = [];
    this.sideToMove = RED;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = [];
    this.positionHistory = [];
    this.snapshots = [];
    this.pool = { [RED]: createFullPool(), [BLACK]: createFullPool() };
    /** @type {Map<string, string>} square "x,y" -> true piece kind (NEVER exported publicly) */
    this._secret = new Map();
    this.reset(opts);
  }

  static fromPublicFen(fenStr) {
    const b = new JieqiBoard({ seed: 1 });
    b.loadPublicFen(fenStr);
    return b;
  }

  reset(opts = {}) {
    const seed = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : null;
    this.grid = Array.from({ length: 10 }, () => Array(9).fill(null));
    this.grid[0][4] = { side: BLACK, kind: 'general', covered: false };
    this.grid[9][4] = { side: RED, kind: 'general', covered: false };

    this._secret = new Map();
    this.pool = { [RED]: createFullPool(), [BLACK]: createFullPool() };

    for (const side of [BLACK, RED]) {
      const squares = STARTING_FAKE_LAYOUT[side];
      const deck = poolToArray(createFullPool());
      const shuffled =
        opts.secret instanceof Map
          ? null
          : shuffleArray(deck, seed !== null ? seed + (side === RED ? 101 : 202) : null);

      squares.forEach((sq, idx) => {
        this.grid[sq.y][sq.x] = { side, kind: sq.kind, covered: true };
        const key = `${sq.x},${sq.y}`;
        if (opts.secret instanceof Map && opts.secret.has(key)) {
          this._secret.set(key, opts.secret.get(key));
        } else if (shuffled) {
          this._secret.set(key, shuffled[idx]);
        }
      });
    }

    this.sideToMove = RED;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = [];
    this.positionHistory = [this.positionKey()];
    this.snapshots = [
      {
        fen: this.publicFen(),
        sideToMove: this.sideToMove,
        move: null,
        captured: null,
        gaveCheck: false,
        isCheckmate: false,
        capturedByRed: [],
        capturedByBlack: [],
        pool: clonePool(this.pool),
      },
    ];
  }

  /** Alias for Board.loadFen compatibility (resets a fresh shuffled Cờ Úp game or loads public FEN). */
  loadFen(fenOrSeed = null) {
    if (typeof fenOrSeed === 'string' && fenOrSeed.includes('/') && (fenOrSeed.includes('X') || fenOrSeed.includes('x') || fenOrSeed.split(' ').length >= 7)) {
      this.loadPublicFen(fenOrSeed);
    } else {
      this.reset({});
    }
  }

  /** Load a public Jieqi FEN (without secret — used for read-only review/AI/mirror). */
  loadPublicFen(fenStr) {
    const parts = String(fenStr || '').trim().split(/\s+/);
    const ranks = (parts[0] || '').split('/');
    this.grid = Array.from({ length: 10 }, () => Array(9).fill(null));

    for (let y = 0; y < Math.min(10, ranks.length); y++) {
      let x = 0;
      for (const ch of ranks[y]) {
        if (ch >= '1' && ch <= '9') {
          x += Number(ch);
        } else if (ch === 'X' || ch === 'x') {
          const side = ch === 'X' ? RED : BLACK;
          this.grid[y][x] = {
            side,
            kind: getFakeTypeForSquare(side, x, y),
            covered: true,
          };
          x++;
        } else {
          const upper = ch.toUpperCase();
          const kind = LETTER_TO_KIND[upper];
          if (kind && x < 9) {
            this.grid[y][x] = {
              side: ch === upper ? RED : BLACK,
              kind,
              covered: false,
            };
          }
          x++;
        }
      }
    }

    this.sideToMove = (parts[1] || 'w').toLowerCase() === 'b' ? BLACK : RED;
    this.halfmoveClock = Number.parseInt(parts[4] || '0', 10) || 0;
    this.fullmoveNumber = Number.parseInt(parts[5] || '1', 10) || 1;
    this.pool = parts[6] ? parsePoolStr(parts[6]) : { [RED]: createFullPool(), [BLACK]: createFullPool() };
    this._secret = new Map();
    this.history = [];
    this.positionHistory = [this.positionKey()];
    this.snapshots = [
      {
        fen: this.publicFen(),
        sideToMove: this.sideToMove,
        move: null,
        captured: null,
        gaveCheck: false,
        isCheckmate: false,
        capturedByRed: [],
        capturedByBlack: [],
        pool: clonePool(this.pool),
      },
    ];
  }

  positionKey() {
    const sideTok = this.sideToMove === BLACK ? 'b' : 'w';
    return `${serializePublicBoard(this.grid)} ${sideTok}`;
  }

  publicFen() {
    const sideTok = this.sideToMove === BLACK ? 'b' : 'w';
    return `${serializePublicBoard(this.grid)} ${sideTok} - - ${this.halfmoveClock} ${this.fullmoveNumber} ${serializePoolStr(this.pool)}`;
  }

  toFen() {
    return this.publicFen();
  }

  at(pos) {
    if (!isValidPos(pos)) return null;
    return this.grid[pos.y][pos.x];
  }

  set(pos, piece) {
    if (!isValidPos(pos)) return;
    this.grid[pos.y][pos.x] = piece;
  }

  getPool(ply = this.history.length) {
    const snap = this.snapshotAt(ply);
    return snap.pool || this.pool;
  }

  /**
   * Apply a move, resolving any covered-piece reveal (and capture reveal if REVEAL_ON_CAPTURE).
   * In online client mirror mode, pass `externalReveal = { type?, capturedType? }` from server.
   */
  applyMove(from, to, externalReveal = null) {
    if (!isValidPos(from) || !isValidPos(to)) return null;
    if (from.x === to.x && from.y === to.y) return null;

    const moving = this.at(from);
    if (!moving) return null;

    const captured = this.at(to);
    const fromKey = `${from.x},${from.y}`;
    const toKey = `${to.x},${to.y}`;

    const wasCovered = Boolean(moving.covered);
    const fakeKind = moving.kind;
    let reveal = null;
    let placedPiece = { ...moving };

    if (wasCovered) {
      const secretKind = externalReveal?.type || this._secret.get(fromKey) || fakeKind;
      this._secret.delete(fromKey);
      placedPiece = { side: moving.side, kind: secretKind, covered: false };
      if (this.pool[moving.side][secretKind] > 0) {
        this.pool[moving.side][secretKind] -= 1;
      }
      reveal = { square: { x: to.x, y: to.y }, type: secretKind, side: moving.side };
    }

    let capturedReveal = null;
    let capturedPublic = captured ? { ...captured } : null;
    const capturedWasCovered = Boolean(captured && captured.covered);
    const capturedFakeKind = captured ? captured.kind : null;

    if (capturedWasCovered) {
      const capSecret = externalReveal?.capturedType || this._secret.get(toKey) || captured.kind;
      this._secret.delete(toKey);
      if (this.revealOnCapture) {
        if (this.pool[captured.side][capSecret] > 0) {
          this.pool[captured.side][capSecret] -= 1;
        }
        capturedPublic = { side: captured.side, kind: capSecret, covered: false };
        capturedReveal = { type: capSecret, side: captured.side };
      }
    }

    this.set(to, placedPiece);
    this.set(from, null);

    const revealSuffix = reveal ? `=${KIND_TO_LETTER[reveal.type]}` : '';
    const move = {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      piece: { ...placedPiece },
      wasCovered,
      fakeKind,
      reveal,
      captured: capturedPublic,
      capturedWasCovered,
      capturedFakeKind,
      capturedReveal,
      side: moving.side,
      prevSideToMove: this.sideToMove,
      prevHalfmoveClock: this.halfmoveClock,
      prevFullmoveNumber: this.fullmoveNumber,
      iccs: moveToIccs(from, to),
      revealSuffix,
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
      fen: this.publicFen(),
      sideToMove: this.sideToMove,
      move,
      captured: move.captured,
      gaveCheck: false,
      isCheckmate: false,
      capturedByRed: capRed,
      capturedByBlack: capBlack,
      pool: clonePool(this.pool),
    });
    return move;
  }

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

  /** Undo (local mode only): restores covered state & secret identity cleanly. */
  undo() {
    const move = this.history.pop();
    if (!move) return null;

    if (move.wasCovered && move.reveal) {
      this.set(move.from, { side: move.side, kind: move.fakeKind, covered: true });
      this._secret.set(`${move.from.x},${move.from.y}`, move.reveal.type);
      this.pool[move.side][move.reveal.type] = (this.pool[move.side][move.reveal.type] || 0) + 1;
    } else {
      this.set(move.from, { ...move.piece, covered: false });
    }

    if (move.capturedWasCovered && move.captured) {
      const capSide = move.captured.side;
      this.set(move.to, { side: capSide, kind: move.capturedFakeKind, covered: true });
      if (move.capturedReveal) {
        this._secret.set(`${move.to.x},${move.to.y}`, move.capturedReveal.type);
        this.pool[capSide][move.capturedReveal.type] =
          (this.pool[capSide][move.capturedReveal.type] || 0) + 1;
      }
    } else {
      this.set(move.to, move.captured ? { ...move.captured } : null);
    }

    this.sideToMove = move.prevSideToMove ?? move.side;
    this.halfmoveClock = move.prevHalfmoveClock ?? 0;
    this.fullmoveNumber = move.prevFullmoveNumber ?? Math.max(1, this.fullmoveNumber);
    if (this.positionHistory.length > 1) this.positionHistory.pop();
    if (this.snapshots.length > 1) this.snapshots.pop();
    return move;
  }

  truncateTo(ply) {
    const target = Math.max(0, Math.min(this.history.length, Math.floor(ply)));
    let removed = 0;
    while (this.history.length > target) {
      this.undo();
      removed += 1;
    }
    return removed;
  }

  snapshotAt(ply) {
    const idx = Math.max(0, Math.min(this.snapshots.length - 1, Math.floor(ply)));
    return this.snapshots[idx];
  }

  viewFen(ply) {
    return this.snapshotAt(ply).fen;
  }

  capturedByAt(captorSide, ply = this.history.length) {
    const snap = this.snapshotAt(ply);
    return captorSide === RED ? snap.capturedByRed : snap.capturedByBlack;
  }

  capturedBy(captorSide) {
    return this.capturedByAt(captorSide, this.history.length);
  }

  lastMove() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  repetitionCount() {
    const key = this.positionKey();
    let count = 0;
    for (let i = 0; i < this.positionHistory.length; i++) {
      if (this.positionHistory[i] === key) count += 1;
    }
    return count;
  }
}

function insidePalace(side, x, y) {
  if (x < 3 || x > 5) return false;
  return side === RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

function crossedRiver(side, y) {
  return side === RED ? y <= 4 : y >= 5;
}

/**
 * Generate pseudo-legal moves for a piece in Cờ Úp:
 * - Covered piece: standard Xiangqi rules for its `fakeType` (`piece.kind`)
 * - Revealed piece: advisors move diagonally anywhere; elephants move 2 diagonally anywhere
 *   (may cross river, still eye-blocked); soldiers forward + sideways past river (never backward).
 */
export function generateJieqiPseudoMoves(board, from) {
  const piece = board.at(from);
  if (!piece) return [];

  const { x, y } = from;
  const { side, kind, covered } = piece;
  const targets = [];

  const pushIfValid = (tx, ty) => {
    if (tx < 0 || tx > 8 || ty < 0 || ty > 9) return;
    const occ = board.at({ x: tx, y: ty });
    if (!occ || occ.side !== side) {
      targets.push({ x: tx, y: ty });
    }
  };

  if (kind === 'general') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (insidePalace(side, tx, ty)) pushIfValid(tx, ty);
    }
    return targets;
  }

  if (kind === 'advisor') {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (covered) {
        if (insidePalace(side, tx, ty)) pushIfValid(tx, ty);
      } else {
        pushIfValid(tx, ty);
      }
    }
    return targets;
  }

  if (kind === 'elephant') {
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx > 8 || ty < 0 || ty > 9) continue;
      if (covered) {
        // Fake elephant cannot cross the river on its first move
        if (side === RED && ty < 5) continue;
        if (side === BLACK && ty > 4) continue;
      }
      // Elephant eye must be empty
      if (board.at({ x: x + dx / 2, y: y + dy / 2 })) continue;
      pushIfValid(tx, ty);
    }
    return targets;
  }

  if (kind === 'horse') {
    const steps = [
      [1, 0, 2, 1], [1, 0, 2, -1],
      [-1, 0, -2, 1], [-1, 0, -2, -1],
      [0, 1, 1, 2], [0, 1, -1, 2],
      [0, -1, 1, -2], [0, -1, -1, -2],
    ];
    for (const [lx, ly, dx, dy] of steps) {
      const legX = x + lx;
      const legY = y + ly;
      if (legX < 0 || legX > 8 || legY < 0 || legY > 9) continue;
      if (board.at({ x: legX, y: legY })) continue;
      pushIfValid(x + dx, y + dy);
    }
    return targets;
  }

  if (kind === 'chariot') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let tx = x + dx;
      let ty = y + dy;
      while (tx >= 0 && tx <= 8 && ty >= 0 && ty <= 9) {
        const occ = board.at({ x: tx, y: ty });
        if (!occ) {
          targets.push({ x: tx, y: ty });
        } else {
          if (occ.side !== side) targets.push({ x: tx, y: ty });
          break;
        }
        tx += dx;
        ty += dy;
      }
    }
    return targets;
  }

  if (kind === 'cannon') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let tx = x + dx;
      let ty = y + dy;
      let screen = false;
      while (tx >= 0 && tx <= 8 && ty >= 0 && ty <= 9) {
        const occ = board.at({ x: tx, y: ty });
        if (!screen) {
          if (!occ) {
            targets.push({ x: tx, y: ty });
          } else {
            screen = true;
          }
        } else if (occ) {
          if (occ.side !== side) targets.push({ x: tx, y: ty });
          break;
        }
        tx += dx;
        ty += dy;
      }
    }
    return targets;
  }

  if (kind === 'soldier') {
    const fwd = side === RED ? -1 : 1;
    pushIfValid(x, y + fwd);
    if (!covered && crossedRiver(side, y)) {
      pushIfValid(x - 1, y);
      pushIfValid(x + 1, y);
    }
    return targets;
  }

  return targets;
}

function findGeneral(board, side) {
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (p && p.side === side && p.kind === 'general') {
        return { x, y };
      }
    }
  }
  return null;
}

function generalsFacing(board) {
  const rk = findGeneral(board, RED);
  const bk = findGeneral(board, BLACK);
  if (!rk || !bk || rk.x !== bk.x) return false;
  const minY = Math.min(rk.y, bk.y);
  const maxY = Math.max(rk.y, bk.y);
  for (let y = minY + 1; y < maxY; y++) {
    if (board.at({ x: rk.x, y })) return false;
  }
  return true;
}

/**
 * JieqiRules implements the RulesProvider interface:
 * legalMoves(board, from), isInCheck(board, side), status(board, sideToMove).
 */
export class JieqiRules {
  isInCheck(board, side) {
    const king = findGeneral(board, side);
    if (!king) return false;
    if (generalsFacing(board)) return true;

    const enemy = oppositeSide(side);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = board.at({ x, y });
        if (!p || p.side !== enemy) continue;
        const moves = generateJieqiPseudoMoves(board, { x, y });
        for (const m of moves) {
          if (m.x === king.x && m.y === king.y) return true;
        }
      }
    }
    return false;
  }

  legalMoves(board, from) {
    const piece = board.at(from);
    if (!piece) return [];
    const pseudo = generateJieqiPseudoMoves(board, from);
    const legal = [];

    // Legality depends ONLY on occupancy (mover's hidden identity never attacks own general).
    for (const to of pseudo) {
      const savedFrom = board.grid[from.y][from.x];
      const savedTo = board.grid[to.y][to.x];
      board.grid[to.y][to.x] = savedFrom;
      board.grid[from.y][from.x] = null;

      const safe = !this.isInCheck(board, piece.side);

      board.grid[from.y][from.x] = savedFrom;
      board.grid[to.y][to.x] = savedTo;

      if (safe) legal.push(to);
    }
    return legal;
  }

  hasAnyLegalMove(board, side) {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = board.at({ x, y });
        if (!p || p.side !== side) continue;
        if (this.legalMoves(board, { x, y }).length > 0) return true;
      }
    }
    return false;
  }

  status(board, sideToMove = board.sideToMove) {
    const inCheck = this.isInCheck(board, sideToMove);
    const hasMoves = this.hasAnyLegalMove(board, sideToMove);
    if (!hasMoves) {
      return inCheck ? GameStatus.Checkmate : GameStatus.Stalemate;
    }
    if (typeof board.repetitionCount === 'function' && board.repetitionCount() >= 3) {
      return GameStatus.DrawRepetition;
    }
    if ((board.halfmoveClock || 0) >= 120) {
      return GameStatus.DrawNoCapture;
    }
    return inCheck ? GameStatus.Check : GameStatus.Playing;
  }
}
