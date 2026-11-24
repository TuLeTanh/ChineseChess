import { RED, BLACK, pieceFromFenChar, pieceToFenChar } from './piece.js';

export const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

/**
 * Parse a Xiangqi FEN string into a 10×9 grid and turn/clock state.
 * @param {string} fen
 * @returns {{
 *   grid: (import('./piece.js').Piece | null)[][],
 *   sideToMove: import('./piece.js').Side,
 *   halfmoveClock: number,
 *   fullmoveNumber: number
 * }}
 */
export function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  if (!placement) {
    throw new Error('Invalid FEN: empty placement');
  }

  const ranks = placement.split('/');
  if (ranks.length !== 10) {
    throw new Error(`Invalid FEN: expected 10 ranks, got ${ranks.length}`);
  }

  const grid = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (let y = 0; y < 10; y++) {
    let x = 0;
    for (const ch of ranks[y]) {
      if (ch >= '1' && ch <= '9') {
        x += Number(ch);
      } else {
        const piece = pieceFromFenChar(ch);
        if (!piece) {
          throw new Error(`Invalid FEN piece character: ${ch}`);
        }
        if (x >= 9) {
          throw new Error(`Invalid FEN rank ${y}: exceeds 9 files`);
        }
        grid[y][x] = piece;
        x += 1;
      }
    }
    if (x !== 9) {
      throw new Error(`Invalid FEN rank ${y}: expected 9 files, got ${x}`);
    }
  }

  const sideToken = (parts[1] || 'w').toLowerCase();
  const sideToMove = sideToken === 'b' ? BLACK : RED;
  const halfmoveClock = Math.max(0, Number.parseInt(parts[4] || '0', 10) || 0);
  const fullmoveNumber = Math.max(1, Number.parseInt(parts[5] || '1', 10) || 1);
  return { grid, sideToMove, halfmoveClock, fullmoveNumber };
}

/**
 * Serialize board placement + side to move (FEN without move counters) for repetition keys.
 * @param {(import('./piece.js').Piece | null)[][]} grid
 * @param {import('./piece.js').Side} sideToMove
 * @returns {string}
 */
export function serializePositionKey(grid, sideToMove) {
  const rankStrings = [];
  for (let y = 0; y < 10; y++) {
    let empty = 0;
    let row = '';
    for (let x = 0; x < 9; x++) {
      const piece = grid[y][x];
      if (!piece) {
        empty += 1;
      } else {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        row += pieceToFenChar(piece);
      }
    }
    if (empty > 0) {
      row += String(empty);
    }
    rankStrings.push(row);
  }
  const sideToken = sideToMove === BLACK ? 'b' : 'w';
  return `${rankStrings.join('/')} ${sideToken}`;
}

/**
 * Serialize a 10×9 grid and turn/clock state to a Xiangqi FEN string.
 * @param {(import('./piece.js').Piece | null)[][]} grid
 * @param {import('./piece.js').Side} sideToMove
 * @param {number} [fullmoveNumber]
 * @param {number} [halfmoveClock]
 * @returns {string}
 */
export function serializeFen(grid, sideToMove, fullmoveNumber = 1, halfmoveClock = 0) {
  return `${serializePositionKey(grid, sideToMove)} - - ${halfmoveClock} ${fullmoveNumber}`;
}
