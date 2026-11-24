/**
 * Position and move helpers, including ICCS-like notation (e.g. "h2e2").
 * Board coordinates: x = 0..8 (left to right from Red's view), y = 0..9 (top to bottom).
 */

/** @typedef {{ x: number, y: number }} Pos */
/**
 * @typedef {Object} Move
 * @property {Pos} from
 * @property {Pos} to
 * @property {import('./piece.js').Piece} piece
 * @property {import('./piece.js').Piece | null} captured
 * @property {import('./piece.js').Side} side
 * @property {string} iccs
 */

const FILES = 'abcdefghi';

/**
 * Check whether (x, y) lies inside the 9×10 Xiangqi board.
 * @param {Pos} pos
 * @returns {boolean}
 */
export function isValidPos(pos) {
  return (
    Number.isInteger(pos.x) &&
    Number.isInteger(pos.y) &&
    pos.x >= 0 &&
    pos.x <= 8 &&
    pos.y >= 0 &&
    pos.y <= 9
  );
}

/**
 * Compare two board positions for equality.
 * @param {Pos | null} a
 * @param {Pos | null} b
 * @returns {boolean}
 */
export function samePos(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

/**
 * Format a position in ICCS coordinates (a-i left->right, 0-9 bottom->top from Red's view).
 * @param {Pos} pos
 * @returns {string}
 */
export function posToIccs(pos) {
  const file = FILES[pos.x] ?? '?';
  const rank = 9 - pos.y;
  return `${file}${rank}`;
}

/**
 * Format a move in ICCS notation (e.g. "h2e2").
 * @param {Pos} from
 * @param {Pos} to
 * @returns {string}
 */
export function moveToIccs(from, to) {
  return `${posToIccs(from)}${posToIccs(to)}`;
}
