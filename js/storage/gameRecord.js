/**
 * Canonical saved-game record schema (v1) for Cờ Tướng (xiangqi) & Cờ Úp (jieqi).
 * Pure ES module (zero DOM/window access; importable in Node).
 *
 * SECURITY INVARIANT:
 * - Never stores guestId, IPs, secrets, or unrevealed Jieqi piece identities.
 * - Names are sanitized (max 16 chars); notes max 200 chars.
 */
import { START_FEN } from '../model/fen.js';
import { KIND_TO_LETTER, JieqiBoard } from '../jieqi/rules.js';
import { sanitizeNickname } from '../online/protocol.js';

export const RECORD_SCHEMA_VERSION = 1;
export const MAX_RECORD_BYTES = 256 * 1024;
export const MAX_PLIES = 1000;
export const MAX_NOTE_LEN = 200;

export const VALID_VARIANTS = new Set(['xiangqi', 'jieqi']);
export const VALID_MODES = new Set(['local', 'ai', 'online', 'imported']);
export const VALID_RESULTS = new Set(['red', 'black', 'draw', 'unfinished']);
export const VALID_REASONS = new Set([
  'checkmate',
  'stalemate',
  'resign',
  'timeout',
  'abandon',
  'drawAgreed',
  'repetition',
  'noCapture',
  'aborted',
  null,
]);
export const VALID_TC = new Set(['chop', 'nhanh', 'cham', 'none']);
export const VALID_SOURCES = new Set(['autosave', 'manual', 'import']);
export const VALID_REVEAL_LETTERS = new Set(['R', 'N', 'B', 'A', 'C', 'P']);

export const JIEQI_START_PUBLIC_FEN = new JieqiBoard({ seed: 1 }).publicFen();

export function normalizeVariantId(v) {
  if (v === 'coup' || v === 'jieqi') return 'jieqi';
  if (v === 'cotuong' || v === 'xiangqi') return 'xiangqi';
  return null;
}

export function variantToRouteGame(variant) {
  return variant === 'jieqi' || variant === 'coup' ? 'coup' : 'cotuong';
}

export function generateRecordId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export function sanitizePlayerName(raw, fallback = 'Kỳ thủ') {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (cleaned.length < 2) return sanitizeNickname(fallback);
  return cleaned;
}

export function sanitizeNote(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, MAX_NOTE_LEN);
}

/**
 * Construct a clean whitelisted canonical record (strips secrets & unknown fields).
 */
export function createGameRecord(opts = {}) {
  const nowIso = new Date().toISOString();
  const variant = normalizeVariantId(opts.variant) || 'xiangqi';
  const mode = VALID_MODES.has(opts.mode) ? opts.mode : 'local';
  const defaultFen = variant === 'jieqi' ? JIEQI_START_PUBLIC_FEN : START_FEN;

  const cleanPlayer = (p, fallback) => {
    const out = {
      name: sanitizePlayerName(p?.name, fallback),
      kind: p?.kind === 'engine' ? 'engine' : 'human',
    };
    if (out.kind === 'engine' && typeof p?.level === 'string' && p.level.trim()) {
      out.level = p.level.trim().slice(0, 24);
    }
    return out;
  };

  const moves = Array.isArray(opts.moves)
    ? opts.moves.map((mv) => {
        const entry = { m: String(mv.m || mv.iccs || '') };
        if (variant === 'jieqi') {
          if (mv.r && VALID_REVEAL_LETTERS.has(mv.r)) entry.r = mv.r;
          if (mv.cr && VALID_REVEAL_LETTERS.has(mv.cr)) entry.cr = mv.cr;
        }
        return entry;
      })
    : [];

  const record = {
    v: RECORD_SCHEMA_VERSION,
    id: typeof opts.id === 'string' && opts.id.length >= 8 ? opts.id.slice(0, 64) : generateRecordId(),
    variant,
    mode,
    createdAt: typeof opts.createdAt === 'string' ? opts.createdAt : nowIso,
    updatedAt: typeof opts.updatedAt === 'string' ? opts.updatedAt : nowIso,
    red: cleanPlayer(opts.red, 'Đỏ'),
    black: cleanPlayer(opts.black, 'Đen'),
    start: { fen: typeof opts.start?.fen === 'string' && opts.start.fen.trim() ? opts.start.fen.trim() : defaultFen },
    moves,
    result: VALID_RESULTS.has(opts.result) ? opts.result : 'unfinished',
    reason: VALID_REASONS.has(opts.reason ?? null) ? (opts.reason ?? null) : null,
  };

  if (opts.tc && VALID_TC.has(opts.tc)) {
    record.tc = opts.tc;
  }
  const note = sanitizeNote(opts.note);
  if (note) {
    record.note = note;
  }
  if (opts.source && VALID_SOURCES.has(opts.source)) {
    record.source = opts.source;
  }
  return record;
}

/**
 * Extract a strictly public canonical record from a live Board or JieqiBoard.
 */
export function buildRecordFromBoard({
  board,
  variant,
  mode = 'local',
  red,
  black,
  tc = null,
  result = 'unfinished',
  reason = null,
  startFen = null,
  note = '',
  source = 'manual',
  id = null,
  createdAt = null,
}) {
  const normVar = normalizeVariantId(variant || (board?.isJieqi ? 'jieqi' : 'xiangqi')) || 'xiangqi';
  const initialFen =
    startFen ||
    (board?.snapshots?.[0]?.fen) ||
    (normVar === 'jieqi' ? JIEQI_START_PUBLIC_FEN : START_FEN);

  const moves = (board?.history || []).map((mv) => {
    const entry = { m: mv.iccs };
    if (normVar === 'jieqi') {
      if (mv.wasCovered && mv.reveal?.type && KIND_TO_LETTER[mv.reveal.type]) {
        entry.r = KIND_TO_LETTER[mv.reveal.type];
      }
      if (mv.capturedWasCovered && mv.capturedReveal?.type && KIND_TO_LETTER[mv.capturedReveal.type]) {
        entry.cr = KIND_TO_LETTER[mv.capturedReveal.type];
      }
    }
    return entry;
  });

  return createGameRecord({
    id,
    variant: normVar,
    mode,
    createdAt,
    updatedAt: new Date().toISOString(),
    red,
    black,
    tc,
    start: { fen: initialFen },
    moves,
    result,
    reason,
    note,
    source,
  });
}
