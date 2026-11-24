/**
 * RulesProvider interface, PermissiveRules (practice mode), and full XiangqiRules.
 * Compact Int8Array(90) scratch representation for fast legal-move generation and PERFT.
 */
import { RED, BLACK } from './model/piece.js';

export const GameStatus = Object.freeze({
  Playing: 'playing',
  Check: 'check',
  Checkmate: 'checkmate',
  Stalemate: 'stalemate',
  DrawRepetition: 'draw-repetition',
  DrawNoCapture: 'draw-no-capture',
});

// Compact piece codes: positive = Red, negative = Black, 0 = empty
const K_GEN = 1;
const K_ADV = 2;
const K_ELE = 3;
const K_HOR = 4;
const K_CHA = 5;
const K_CAN = 6;
const K_SOL = 7;

const KIND_TO_CODE = {
  general: K_GEN,
  advisor: K_ADV,
  elephant: K_ELE,
  horse: K_HOR,
  chariot: K_CHA,
  cannon: K_CAN,
  soldier: K_SOL,
};

const ORTHO = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const DIAG = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

// [dx, dy, legDx, legDy]
const HORSE_MOVES = [
  [-1, -2, 0, -1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [1, 2, 0, 1],
  [-2, -1, -1, 0],
  [-2, 1, -1, 0],
  [2, -1, 1, 0],
  [2, 1, 1, 0],
];

// Reverse horse check from target square: [horseDx, horseDy, legDx, legDy]
const HORSE_ATTACKS = [
  [-2, -1, -1, -1],
  [-2, 1, -1, 1],
  [2, -1, 1, -1],
  [2, 1, 1, 1],
  [-1, -2, -1, -1],
  [1, -2, 1, -1],
  [-1, 2, -1, 1],
  [1, 2, 1, 1],
];

/**
 * Convert a Board instance into a flat Int8Array(90).
 * @param {import('./model/board.js').Board} board
 * @returns {Int8Array}
 */
export function boardToCells(board) {
  const cells = new Int8Array(90);
  for (let y = 0; y < 10; y++) {
    const row = board.grid[y];
    const base = y * 9;
    for (let x = 0; x < 9; x++) {
      const p = row[x];
      if (p) {
        const code = KIND_TO_CODE[p.kind];
        cells[base + x] = p.side === RED ? code : -code;
      }
    }
  }
  return cells;
}

/**
 * Find the square index (0..89) of the General for `sideSign` (+1 Red, -1 Black), or -1.
 * @param {Int8Array} cells
 * @param {number} sideSign
 * @returns {number}
 */
function findGeneral(cells, sideSign) {
  const target = sideSign * K_GEN;
  const yStart = sideSign === 1 ? 7 : 0;
  const yEnd = sideSign === 1 ? 9 : 2;
  for (let y = yStart; y <= yEnd; y++) {
    const base = y * 9;
    for (let x = 3; x <= 5; x++) {
      if (cells[base + x] === target) return base + x;
    }
  }
  // Fallback full scan (in case of custom/practice board positions)
  for (let i = 0; i < 90; i++) {
    if (cells[i] === target) return i;
  }
  return -1;
}

/**
 * Return true if `sideSign`'s General is attacked by any enemy piece (including flying general).
 * Allocation-free hot path.
 * @param {Int8Array} cells
 * @param {number} sideSign - +1 for Red, -1 for Black
 * @returns {boolean}
 */
export function isGeneralAttacked(cells, sideSign) {
  const kIdx = findGeneral(cells, sideSign);
  if (kIdx < 0) return false;
  const kx = kIdx % 9;
  const ky = (kIdx - kx) / 9;
  const enemy = -sideSign;
  const enemyGen = enemy * K_GEN;
  const enemyCha = enemy * K_CHA;
  const enemyCan = enemy * K_CAN;
  const enemyHor = enemy * K_HOR;
  const enemySol = enemy * K_SOL;

  // 1. Orthogonal rays: Chariot, Flying General (first piece), Cannon (second piece)
  for (let d = 0; d < 4; d++) {
    const dx = ORTHO[d][0];
    const dy = ORTHO[d][1];
    let x = kx + dx;
    let y = ky + dy;
    let screenSeen = false;
    while (x >= 0 && x < 9 && y >= 0 && y < 10) {
      const p = cells[y * 9 + x];
      if (p !== 0) {
        if (!screenSeen) {
          if (p === enemyCha || p === enemyGen) return true;
          screenSeen = true;
        } else {
          if (p === enemyCan) return true;
          break;
        }
      }
      x += dx;
      y += dy;
    }
  }

  // 2. Horse attacks (reverse L-jump with unblocked leg)
  for (let i = 0; i < 8; i++) {
    const hx = kx + HORSE_ATTACKS[i][0];
    const hy = ky + HORSE_ATTACKS[i][1];
    if (hx < 0 || hx >= 9 || hy < 0 || hy >= 10) continue;
    if (cells[hy * 9 + hx] === enemyHor) {
      const lx = kx + HORSE_ATTACKS[i][2];
      const ly = ky + HORSE_ATTACKS[i][3];
      if (cells[ly * 9 + lx] === 0) return true;
    }
  }

  // 3. Soldier attacks (forward into palace or sideways)
  const frontY = ky - sideSign; // Red general (sideSign=+1) attacked from y-1; Black from y+1
  if (frontY >= 0 && frontY < 10 && cells[frontY * 9 + kx] === enemySol) return true;
  if (kx > 0 && cells[ky * 9 + (kx - 1)] === enemySol) return true;
  if (kx < 8 && cells[ky * 9 + (kx + 1)] === enemySol) return true;

  return false;
}

/**
 * Generate pseudo-legal destination indices for the piece at `fromIdx` into `out` array.
 * Returns the new length of `out`.
 * @param {Int8Array} cells
 * @param {number} fromIdx
 * @param {Int32Array} out
 * @param {number} count
 * @returns {number}
 */
function genPseudoForSquare(cells, fromIdx, out, count) {
  const p = cells[fromIdx];
  if (p === 0) return count;
  const side = p > 0 ? 1 : -1;
  const kind = p > 0 ? p : -p;
  const x = fromIdx % 9;
  const y = (fromIdx - x) / 9;

  if (kind === K_GEN) {
    const yMin = side === 1 ? 7 : 0;
    const yMax = side === 1 ? 9 : 2;
    for (let d = 0; d < 4; d++) {
      const nx = x + ORTHO[d][0];
      const ny = y + ORTHO[d][1];
      if (nx < 3 || nx > 5 || ny < yMin || ny > yMax) continue;
      const to = ny * 9 + nx;
      if (cells[to] * side <= 0) out[count++] = to;
    }
    return count;
  }

  if (kind === K_ADV) {
    const yMin = side === 1 ? 7 : 0;
    const yMax = side === 1 ? 9 : 2;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIAG[d][0];
      const ny = y + DIAG[d][1];
      if (nx < 3 || nx > 5 || ny < yMin || ny > yMax) continue;
      const to = ny * 9 + nx;
      if (cells[to] * side <= 0) out[count++] = to;
    }
    return count;
  }

  if (kind === K_ELE) {
    const yMin = side === 1 ? 5 : 0;
    const yMax = side === 1 ? 9 : 4;
    for (let d = 0; d < 4; d++) {
      const dx = DIAG[d][0];
      const dy = DIAG[d][1];
      const nx = x + dx * 2;
      const ny = y + dy * 2;
      if (nx < 0 || nx > 8 || ny < yMin || ny > yMax) continue;
      if (cells[(y + dy) * 9 + (x + dx)] !== 0) continue; // elephant eye blocked
      const to = ny * 9 + nx;
      if (cells[to] * side <= 0) out[count++] = to;
    }
    return count;
  }

  if (kind === K_HOR) {
    for (let i = 0; i < 8; i++) {
      const nx = x + HORSE_MOVES[i][0];
      const ny = y + HORSE_MOVES[i][1];
      if (nx < 0 || nx > 8 || ny < 0 || ny > 9) continue;
      const lx = x + HORSE_MOVES[i][2];
      const ly = y + HORSE_MOVES[i][3];
      if (cells[ly * 9 + lx] !== 0) continue; // horse leg blocked
      const to = ny * 9 + nx;
      if (cells[to] * side <= 0) out[count++] = to;
    }
    return count;
  }

  if (kind === K_CHA) {
    for (let d = 0; d < 4; d++) {
      const dx = ORTHO[d][0];
      const dy = ORTHO[d][1];
      let nx = x + dx;
      let ny = y + dy;
      while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (occ === 0) {
          out[count++] = to;
        } else {
          if (occ * side < 0) out[count++] = to;
          break;
        }
        nx += dx;
        ny += dy;
      }
    }
    return count;
  }

  if (kind === K_CAN) {
    for (let d = 0; d < 4; d++) {
      const dx = ORTHO[d][0];
      const dy = ORTHO[d][1];
      let nx = x + dx;
      let ny = y + dy;
      let jumped = false;
      while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (!jumped) {
          if (occ === 0) {
            out[count++] = to;
          } else {
            jumped = true;
          }
        } else if (occ !== 0) {
          if (occ * side < 0) out[count++] = to;
          break;
        }
        nx += dx;
        ny += dy;
      }
    }
    return count;
  }

  if (kind === K_SOL) {
    const ny = y - side; // Red (-1), Black (+1)
    if (ny >= 0 && ny < 10) {
      const to = ny * 9 + x;
      if (cells[to] * side <= 0) out[count++] = to;
    }
    const crossedRiver = side === 1 ? y <= 4 : y >= 5;
    if (crossedRiver) {
      if (x > 0 && cells[y * 9 + (x - 1)] * side <= 0) out[count++] = y * 9 + (x - 1);
      if (x < 8 && cells[y * 9 + (x + 1)] * side <= 0) out[count++] = y * 9 + (x + 1);
    }
    return count;
  }

  return count;
}

// Reusable scratch buffer for single-square move gen
const SQUARE_BUF = new Int32Array(32);

/**
 * Fast PERFT node counter on a flat Int8Array(90) using make/unmake.
 * @param {Int8Array} cells
 * @param {number} sideSign - +1 Red, -1 Black
 * @param {number} depth
 * @returns {number}
 */
export function perftCells(cells, sideSign, depth) {
  if (depth <= 0) return 1;
  const buf = new Int32Array(32);
  let nodes = 0;

  for (let from = 0; from < 90; from++) {
    const piece = cells[from];
    if (piece * sideSign <= 0) continue;
    const n = genPseudoForSquare(cells, from, buf, 0);
    for (let i = 0; i < n; i++) {
      const to = buf[i];
      const captured = cells[to];
      cells[to] = piece;
      cells[from] = 0;
      if (!isGeneralAttacked(cells, sideSign)) {
        nodes += depth === 1 ? 1 : perftCells(cells, -sideSign, depth - 1);
      }
      cells[from] = piece;
      cells[to] = captured;
    }
  }
  return nodes;
}

/**
 * Base interface for Xiangqi rules engines.
 */
export class RulesProvider {
  /**
   * Return legal destination squares for the piece at `from`.
   * @param {import('./model/board.js').Board} _board
   * @param {import('./model/moves.js').Pos} _from
   * @returns {import('./model/moves.js').Pos[]}
   */
  legalMoves(_board, _from) {
    return [];
  }

  /**
   * Return true if `side`'s General is currently in check.
   * @param {import('./model/board.js').Board} _board
   * @param {import('./model/piece.js').Side} _side
   * @returns {boolean}
   */
  isInCheck(_board, _side) {
    return false;
  }

  /**
   * Return current game status.
   * @param {import('./model/board.js').Board} _board
   * @param {import('./model/piece.js').Side} _sideToMove
   * @returns {string}
   */
  status(_board, _sideToMove) {
    return GameStatus.Playing;
  }
}

/**
 * Practice mode rules: every square not occupied by a friendly piece is legal.
 */
export class PermissiveRules extends RulesProvider {
  /**
   * @param {import('./model/board.js').Board} board
   * @param {import('./model/moves.js').Pos} from
   * @returns {import('./model/moves.js').Pos[]}
   */
  legalMoves(board, from) {
    const moving = board.at(from);
    if (!moving) return [];
    const targets = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        if (x === from.x && y === from.y) continue;
        const occupant = board.at({ x, y });
        if (!occupant || occupant.side !== moving.side) {
          targets.push({ x, y });
        }
      }
    }
    return targets;
  }
}

/**
 * Full Xiangqi rules implementation (pseudo-legal + king safety + flying general + status).
 */
export class XiangqiRules extends RulesProvider {
  /**
   * @param {import('./model/board.js').Board} board
   * @param {import('./model/moves.js').Pos} from
   * @returns {import('./model/moves.js').Pos[]}
   */
  legalMoves(board, from) {
    const moving = board.at(from);
    if (!moving) return [];
    const cells = boardToCells(board);
    const fromIdx = from.y * 9 + from.x;
    const piece = cells[fromIdx];
    const sideSign = piece > 0 ? 1 : -1;

    const count = genPseudoForSquare(cells, fromIdx, SQUARE_BUF, 0);
    const result = [];
    for (let i = 0; i < count; i++) {
      const to = SQUARE_BUF[i];
      const captured = cells[to];
      cells[to] = piece;
      cells[fromIdx] = 0;
      if (!isGeneralAttacked(cells, sideSign)) {
        const tx = to % 9;
        const ty = (to - tx) / 9;
        result.push({ x: tx, y: ty });
      }
      cells[fromIdx] = piece;
      cells[to] = captured;
    }
    return result;
  }

  /**
   * @param {import('./model/board.js').Board} board
   * @param {import('./model/piece.js').Side} side
   * @returns {boolean}
   */
  isInCheck(board, side) {
    const cells = boardToCells(board);
    return isGeneralAttacked(cells, side === RED ? 1 : -1);
  }

  /**
   * Return true if `side` has at least one legal move.
   * @param {import('./model/board.js').Board} board
   * @param {import('./model/piece.js').Side} side
   * @returns {boolean}
   */
  hasAnyLegalMove(board, side) {
    const cells = boardToCells(board);
    const sideSign = side === RED ? 1 : -1;
    for (let from = 0; from < 90; from++) {
      const piece = cells[from];
      if (piece * sideSign <= 0) continue;
      const count = genPseudoForSquare(cells, from, SQUARE_BUF, 0);
      for (let i = 0; i < count; i++) {
        const to = SQUARE_BUF[i];
        const captured = cells[to];
        cells[to] = piece;
        cells[from] = 0;
        const safe = !isGeneralAttacked(cells, sideSign);
        cells[from] = piece;
        cells[to] = captured;
        if (safe) return true;
      }
    }
    return false;
  }

  /**
   * Compute full Xiangqi game status for `sideToMove`.
   * @param {import('./model/board.js').Board} board
   * @param {import('./model/piece.js').Side} sideToMove
   * @returns {string}
   */
  status(board, sideToMove) {
    const inCheck = this.isInCheck(board, sideToMove);
    const hasMove = this.hasAnyLegalMove(board, sideToMove);

    if (!hasMove) {
      return inCheck ? GameStatus.Checkmate : GameStatus.Stalemate;
    }
    if (board.repetitionCount() >= 3) {
      return GameStatus.DrawRepetition;
    }
    if (board.halfmoveClock >= 120) {
      return GameStatus.DrawNoCapture;
    }
    return inCheck ? GameStatus.Check : GameStatus.Playing;
  }

  /**
   * Convenience wrapper to run PERFT from a Board.
   * @param {import('./model/board.js').Board} board
   * @param {number} depth
   * @returns {number}
   */
  perft(board, depth) {
    const cells = boardToCells(board);
    const sideSign = board.sideToMove === RED ? 1 : -1;
    return perftCells(cells, sideSign, depth);
  }
}
