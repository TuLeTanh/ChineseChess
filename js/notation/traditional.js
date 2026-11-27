/**
 * Pure Vietnamese Traditional Xiangqi Notation engine (zero DOM, Node-importable).
 * Single source of truth for converting ICCS moves <-> Vietnamese traditional notation
 * for both Cờ Tướng (Xiangqi) and Cờ Úp (Jieqi, strictly public data only).
 */
import { RED, BLACK } from '../model/piece.js';
import { Board } from '../model/board.js';
import { moveToIccs } from '../model/moves.js';
import { XiangqiRules } from '../rules.js';
import { JieqiBoard, JieqiRules } from '../jieqi/rules.js';
import {
  PIECE_NAMES,
  DIRECTION_WORDS,
  DIRECTION_SYMBOLS,
  POSITION_WORDS,
} from './names.js';

const FILES = 'abcdefghi';
const STRAIGHT_KINDS = new Set(['general', 'chariot', 'cannon', 'soldier']);
const xiangqiRules = new XiangqiRules();
const jieqiRules = new JieqiRules();

export const TRADITIONAL_FULL_RE =
  /^(Tướng|Sĩ|Tượng|Xe|Pháo|Mã|Tốt) ([1-9]|(?:[1-9] )?(?:trước|sau|giữa|thứ hai|thứ ba|thứ tư)) (tiến|thoái|bình) [1-9]$/;

function parseIccsMove(move) {
  if (!move) return null;
  if (typeof move === 'string') {
    if (move.length < 4) return null;
    const fx = FILES.indexOf(move[0]);
    const fy = 9 - Number(move[1]);
    const tx = FILES.indexOf(move[2]);
    const ty = 9 - Number(move[3]);
    if (fx < 0 || tx < 0 || Number.isNaN(fy) || Number.isNaN(ty)) return null;
    return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
  }
  if (move.from && move.to) {
    return { from: { x: move.from.x, y: move.from.y }, to: { x: move.to.x, y: move.to.y } };
  }
  return null;
}

function resolveBoard(position, variant) {
  if (!position) return null;
  if (typeof position === 'string') {
    const isJq = variant === 'jieqi' || variant === 'coup' || /[Xx]/.test(position.split(' ')[0] || '');
    return isJq ? JieqiBoard.fromPublicFen(position) : Board.fromFen(position);
  }
  return position;
}

function moverFileNumber(side, x) {
  return side === RED ? 9 - x : x + 1;
}

function positionWordFor(count, idx) {
  const table = POSITION_WORDS[count];
  if (table && table[idx]) return table[idx];
  if (idx === 0) return 'trước';
  if (idx === count - 1) return 'sau';
  return `thứ ${idx + 1}`;
}

function normalizeForMatch(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/\u2212/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([+\-=])\s*/g, '$1')
    .trim();
}

/**
 * Convert a single move (in the position BEFORE the move) to Vietnamese traditional notation.
 * Never depends on board flip and never reads Jieqi `_secret`.
 *
 * @param {any} position - Board, JieqiBoard, or FEN string BEFORE the move
 * @param {string | { from: {x:number,y:number}, to: {x:number,y:number} }} move
 * @param {{ variant?: 'xiangqi'|'jieqi'|'cotuong'|'coup' }} [opts]
 */
export function moveToTraditional(position, move, opts = {}) {
  const board = resolveBoard(position, opts.variant);
  const parsed = parseIccsMove(move);
  if (!board || !parsed) {
    const fallback = typeof move === 'string' ? move : '';
    return {
      full: fallback,
      short: fallback,
      aria: fallback,
      parts: { name: '', filePart: '', dir: '', arg: 0 },
    };
  }

  const { from, to } = parsed;
  const piece = board.at(from);
  if (!piece) {
    const fallback = typeof move === 'string' ? move : moveToIccs(from, to);
    return {
      full: fallback,
      short: fallback,
      aria: fallback,
      parts: { name: '', filePart: '', dir: '', arg: 0 },
    };
  }

  const side = piece.side;
  // For covered Cờ Úp pieces, `piece.kind` is strictly the public square fake-type (never `_secret`)
  const kind = piece.kind;
  const name = PIECE_NAMES[kind] || kind;

  // Group all same-side, same-kind pieces by file (x)
  const byFile = new Map();
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (p && p.side === side && p.kind === kind) {
        if (!byFile.has(x)) byFile.set(x, []);
        byFile.get(x).push({ x, y });
      }
    }
  }

  const fromFile = moverFileNumber(side, from.x);
  const toFile = moverFileNumber(side, to.x);
  const sameFile = byFile.get(from.x) || [{ x: from.x, y: from.y }];

  let filePart = String(fromFile);
  let qualifier;
  let multiFileDup = false;
  if (sameFile.length >= 2) {
    // Sort closest to enemy first (Red: smaller y; Black: larger y)
    sameFile.sort((a, b) => (side === RED ? a.y - b.y : b.y - a.y));
    const idx = Math.max(0, sameFile.findIndex((sq) => sq.y === from.y));
    qualifier = positionWordFor(sameFile.length, idx);
    let dupFileCount = 0;
    for (const arr of byFile.values()) {
      if (arr.length >= 2) dupFileCount++;
    }
    multiFileDup = dupFileCount > 1;
    filePart = multiFileDup ? `${fromFile} ${qualifier}` : qualifier;
  }

  const dy = to.y - from.y;
  let dirKey = 'traverse';
  if (dy !== 0) {
    const advancing = side === RED ? dy < 0 : dy > 0;
    dirKey = advancing ? 'advance' : 'retreat';
  }

  const dirWord = DIRECTION_WORDS[dirKey];
  const dirSym = DIRECTION_SYMBOLS[dirKey];

  let arg;
  if (STRAIGHT_KINDS.has(kind)) {
    arg = dirKey === 'traverse' ? toFile : Math.abs(dy);
  } else {
    arg = toFile;
  }

  const full = `${name} ${filePart} ${dirWord} ${arg}`;
  const short = `${name} ${filePart}${dirSym}${arg}`;
  const aria = qualifier
    ? multiFileDup
      ? `${name}, cột ${fromFile}, ${qualifier}, ${dirWord} ${arg}`
      : `${name} ${qualifier}, ${dirWord} ${arg}`
    : `${name}, cột ${fromFile}, ${dirWord} ${arg}`;

  const parts = qualifier
    ? { name, filePart, dir: dirWord, arg, qualifier }
    : { name, filePart, dir: dirWord, arg };

  return { full, short, aria, parts };
}

/**
 * Parse a Vietnamese traditional move string (full or short, case/diacritics-insensitive,
 * ASCII '-' or U+2212 '−') against all legal moves of `position`, returning ICCS or null.
 * Never throws on arbitrary input.
 *
 * @param {any} position
 * @param {string} text
 * @param {{ variant?: 'xiangqi'|'jieqi'|'cotuong'|'coup' }} [opts]
 * @returns {string | null}
 */
export function parseTraditional(position, text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 120) return null;
  const target = normalizeForMatch(text);
  if (!target) return null;

  let board;
  try {
    board = resolveBoard(position, opts.variant);
  } catch {
    return null;
  }
  if (!board) return null;

  const isJq = Boolean(board.isJieqi || opts.variant === 'jieqi' || opts.variant === 'coup');
  const ruleSet = isJq ? jieqiRules : xiangqiRules;

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (!p || p.side !== board.sideToMove) continue;
      const legal = ruleSet.legalMoves(board, { x, y });
      for (const to of legal) {
        const iccs = moveToIccs({ x, y }, to);
        const tr = moveToTraditional(board, iccs, opts);
        if (normalizeForMatch(tr.full) === target || normalizeForMatch(tr.short) === target) {
          return iccs;
        }
      }
    }
  }
  return null;
}

/**
 * Format a sequence of ICCS moves starting from `position` by replaying them legally.
 * Stops at the first illegal move without mutating any caller board.
 *
 * @param {any} position - Board, JieqiBoard, or FEN string
 * @param {string[]} moves
 * @param {{ variant?: 'xiangqi'|'jieqi'|'cotuong'|'coup', style?: 'full'|'short' }} [opts]
 * @returns {string[]}
 */
export function formatLine(position, moves, opts = {}) {
  if (!Array.isArray(moves) || moves.length === 0) return [];
  const style = opts.style === 'short' ? 'short' : 'full';
  const isJq = Boolean(
    opts.variant === 'jieqi' ||
    opts.variant === 'coup' ||
    (typeof position === 'object' && position?.isJieqi)
  );
  const startFen =
    typeof position === 'string'
      ? position
      : isJq
        ? position.publicFen()
        : position.toFen();

  let board;
  try {
    board = isJq ? JieqiBoard.fromPublicFen(startFen) : Board.fromFen(startFen);
  } catch {
    return [];
  }
  const ruleSet = isJq ? jieqiRules : xiangqiRules;
  const out = [];

  for (const mv of moves) {
    const parsed = parseIccsMove(mv);
    if (!parsed) break;
    const p = board.at(parsed.from);
    if (!p || p.side !== board.sideToMove) break;
    const legal = ruleSet.legalMoves(board, parsed.from);
    if (!legal.some((sq) => sq.x === parsed.to.x && sq.y === parsed.to.y)) break;

    const tr = moveToTraditional(board, mv, opts);
    out.push(style === 'short' ? tr.short : tr.full);
    board.applyMove(parsed.from, parsed.to);
  }
  return out;
}
