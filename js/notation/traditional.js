/**
 * Phase B stub — pure Vietnamese traditional Xiangqi notation (no DOM).
 * Replaced with full implementation in Phase C1.
 */
export const TRADITIONAL_FULL_RE = /^(Tướng|Sĩ|Tượng|Xe|Pháo|Mã|Tốt) /;

export function moveToTraditional(_position, _move, _opts = {}) {
  return { full: '', short: '', aria: '', parts: { name: '', filePart: '', dir: '', arg: 0 } };
}

export function parseTraditional(_position, _text, _opts = {}) {
  return null;
}

export function formatLine(_position, _moves, _opts = {}) {
  return [];
}
