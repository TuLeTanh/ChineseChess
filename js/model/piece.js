/**
 * Xiangqi piece definitions and FEN symbol mappings.
 */

/** @typedef {'red' | 'black'} Side */
/** @typedef {'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier'} Kind */
/** @typedef {{ kind: Kind, side: Side }} Piece */

export const RED = 'red';
export const BLACK = 'black';

const FEN_TO_KIND = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};

const KIND_TO_FEN = {
  general: 'k',
  advisor: 'a',
  elephant: 'b',
  horse: 'n',
  chariot: 'r',
  cannon: 'c',
  soldier: 'p',
};

/**
 * Return the opposing side.
 * @param {Side} side
 * @returns {Side}
 */
export function oppositeSide(side) {
  return side === RED ? BLACK : RED;
}

/**
 * Convert a single FEN character to a Piece (or null if invalid).
 * Red is uppercase, Black is lowercase.
 * @param {string} ch
 * @returns {Piece | null}
 */
export function pieceFromFenChar(ch) {
  const lower = ch.toLowerCase();
  const kind = FEN_TO_KIND[lower];
  if (!kind) return null;
  const side = ch === ch.toUpperCase() ? RED : BLACK;
  return { kind, side };
}

/**
 * Convert a Piece to its FEN character.
 * @param {Piece} piece
 * @returns {string}
 */
export function pieceToFenChar(piece) {
  const ch = KIND_TO_FEN[piece.kind];
  return piece.side === RED ? ch.toUpperCase() : ch;
}
