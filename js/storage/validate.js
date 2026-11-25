/**
 * Strict validation & full-rules replay for imported/loaded Xiangqi & Jieqi records and FENs.
 * Pure ES module (zero DOM/window access; importable in Node).
 */
import { Board } from '../model/board.js';
import { RED, BLACK, oppositeSide } from '../model/piece.js';
import { XiangqiRules, GameStatus } from '../rules.js';
import {
  JieqiBoard,
  JieqiRules,
  LETTER_TO_KIND,
  NON_GENERAL_KINDS,
} from '../jieqi/rules.js';
import { isValidIccs } from '../online/protocol.js';
import {
  RECORD_SCHEMA_VERSION,
  MAX_RECORD_BYTES,
  MAX_PLIES,
  VALID_MODES,
  VALID_RESULTS,
  VALID_REASONS,
  VALID_TC,
  VALID_REVEAL_LETTERS,
  normalizeVariantId,
  createGameRecord,
  generateRecordId,
} from './gameRecord.js';

const FILES = 'abcdefghi';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PER_KIND = {
  general: 1,
  chariot: 2,
  horse: 2,
  elephant: 2,
  advisor: 2,
  cannon: 2,
  soldier: 5,
};

const xiangqiRules = new XiangqiRules();
const jieqiRules = new JieqiRules();

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function insidePalace(side, x, y) {
  if (x < 3 || x > 5) return false;
  return side === RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

/** Recursively check for prototype-pollution keys in parsed JSON objects. */
export function hasForbiddenKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return false;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (hasForbiddenKeys(obj[i], depth + 1)) return true;
    }
    return false;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeys(obj[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Strictly validate a Xiangqi or Jieqi public FEN.
 * Returns { ok: true, board } or { ok: false, error: { code, message } }.
 */
export function validatePositionFen(fenStr, variant = 'xiangqi') {
  const normVar = normalizeVariantId(variant);
  if (!normVar) {
    return { ok: false, error: { code: 'INVALID_VARIANT', message: 'Biến thể cờ không hợp lệ.' } };
  }
  if (typeof fenStr !== 'string' || !fenStr.trim() || fenStr.length > 512) {
    return { ok: false, error: { code: 'INVALID_FEN', message: 'Chuỗi FEN không hợp lệ.' } };
  }

  const parts = fenStr.trim().split(/\s+/);
  const ranks = parts[0].split('/');
  if (ranks.length !== 10) {
    return {
      ok: false,
      error: { code: 'INVALID_FEN_RANKS', message: `FEN phải có đúng 10 hàng (nhận được ${ranks.length}).` },
    };
  }

  const counts = {
    [RED]: { general: 0, chariot: 0, horse: 0, elephant: 0, advisor: 0, cannon: 0, soldier: 0, covered: 0 },
    [BLACK]: { general: 0, chariot: 0, horse: 0, elephant: 0, advisor: 0, cannon: 0, soldier: 0, covered: 0 },
  };
  const generals = { [RED]: null, [BLACK]: null };

  for (let y = 0; y < 10; y++) {
    let x = 0;
    for (const ch of ranks[y]) {
      if (ch >= '1' && ch <= '9') {
        x += Number(ch);
      } else if (ch === 'X' || ch === 'x') {
        if (normVar !== 'jieqi') {
          return {
            ok: false,
            error: { code: 'INVALID_FEN_CHAR', message: `Ký tự quân úp '${ch}' không hợp lệ trong Cờ Tướng.` },
          };
        }
        const side = ch === 'X' ? RED : BLACK;
        counts[side].covered += 1;
        x += 1;
      } else {
        const upper = ch.toUpperCase();
        const kind = LETTER_TO_KIND[upper];
        if (!kind) {
          return {
            ok: false,
            error: { code: 'INVALID_FEN_CHAR', message: `Ký tự không hợp lệ '${ch}' ở hàng ${y + 1}.` },
          };
        }
        const side = ch === upper ? RED : BLACK;
        counts[side][kind] += 1;
        if (kind === 'general') {
          if (!insidePalace(side, x, y)) {
            return {
              ok: false,
              error: { code: 'GENERAL_OUTSIDE_PALACE', message: 'Quân Tướng phải nằm trong cung.' },
            };
          }
          generals[side] = { x, y };
        }
        x += 1;
      }
      if (x > 9) {
        return {
          ok: false,
          error: { code: 'INVALID_FEN_COLS', message: `Hàng ${y + 1} vượt quá 9 cột.` },
        };
      }
    }
    if (x !== 9) {
      return {
        ok: false,
        error: { code: 'INVALID_FEN_COLS', message: `Hàng ${y + 1} phải có đúng 9 cột (nhận được ${x}).` },
      };
    }
  }

  for (const side of [RED, BLACK]) {
    if (counts[side].general !== 1) {
      return {
        ok: false,
        error: { code: 'MISSING_GENERAL', message: 'Mỗi bên phải có đúng 1 quân Tướng.' },
      };
    }
    for (const [k, max] of Object.entries(MAX_PER_KIND)) {
      if (counts[side][k] > max) {
        return {
          ok: false,
          error: { code: 'TOO_MANY_PIECES', message: `Số lượng quân ${k} vượt quá giới hạn.` },
        };
      }
    }
  }

  const sideToken = (parts[1] || 'w').toLowerCase();
  if (sideToken !== 'w' && sideToken !== 'r' && sideToken !== 'b') {
    return {
      ok: false,
      error: { code: 'INVALID_SIDE', message: `Lượt đi không hợp lệ trong FEN: '${parts[1]}'.` },
    };
  }

  let board;
  if (normVar === 'jieqi') {
    // Validate pool field if present (required when covered > 0)
    if (parts[6]) {
      const poolRx = /^[RNBACP0-9]+\/[rnbacp0-9]+$/;
      if (!poolRx.test(parts[6])) {
        return { ok: false, error: { code: 'INVALID_POOL', message: 'Định dạng bảng quân úp (pool) không hợp lệ.' } };
      }
    }
    board = JieqiBoard.fromPublicFen(fenStr.trim());
    for (const side of [RED, BLACK]) {
      const poolSide = board.pool[side];
      let poolSum = 0;
      for (const k of NON_GENERAL_KINDS) {
        const n = poolSide[k] || 0;
        if (n < 0 || counts[side][k] + n > MAX_PER_KIND[k]) {
          return {
            ok: false,
            error: { code: 'INCONSISTENT_POOL', message: 'Số quân úp còn lại (pool) không khớp với bàn cờ.' },
          };
        }
        poolSum += n;
      }
      if (poolSum !== counts[side].covered) {
        return {
          ok: false,
          error: {
            code: 'POOL_COUNT_MISMATCH',
            message: `Số quân trong pool (${poolSum}) không khớp số quân úp trên bàn (${counts[side].covered}).`,
          },
        };
      }
    }
  } else {
    board = Board.fromFen(fenStr.trim());
  }

  // Generals must not face each other directly
  const rk = generals[RED];
  const bk = generals[BLACK];
  if (rk.x === bk.x) {
    let blocked = false;
    for (let y = Math.min(rk.y, bk.y) + 1; y < Math.max(rk.y, bk.y); y++) {
      if (board.at({ x: rk.x, y })) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      return {
        ok: false,
        error: { code: 'GENERALS_FACING', message: 'Hai quân Tướng không được đối mặt trực tiếp.' },
      };
    }
  }

  // Side NOT to move cannot already be in check
  const rules = normVar === 'jieqi' ? jieqiRules : xiangqiRules;
  const waitingSide = oppositeSide(board.sideToMove);
  if (rules.isInCheck(board, waitingSide)) {
    return {
      ok: false,
      error: { code: 'WAITING_SIDE_IN_CHECK', message: 'Bên không đến lượt đang bị chiếu (thế cờ không hợp lệ).' },
    };
  }

  return { ok: true, board };
}

/**
 * Validate and replay a canonical record object through XiangqiRules / JieqiRules.
 * @param {any} raw
 * @param {{ isImport?: boolean, rawBytes?: number }} [opts]
 */
export function validateAndNormalizeRecord(raw, opts = {}) {
  if (typeof opts.rawBytes === 'number' && opts.rawBytes > MAX_RECORD_BYTES) {
    return {
      ok: false,
      error: { code: 'TOO_LARGE', message: 'Dữ liệu ván cờ vượt quá giới hạn 256 KB.' },
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: { code: 'INVALID_OBJECT', message: 'Dữ liệu ván cờ không phải đối tượng hợp lệ.' } };
  }
  if (hasForbiddenKeys(raw)) {
    return { ok: false, error: { code: 'FORBIDDEN_KEY', message: 'Dữ liệu chứa khóa không được phép.' } };
  }
  if (raw.v !== RECORD_SCHEMA_VERSION) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_VERSION', message: `Phiên bản định dạng không được hỗ trợ (v=${raw.v}).` },
    };
  }

  const variant = normalizeVariantId(raw.variant);
  if (!variant) {
    return { ok: false, error: { code: 'INVALID_VARIANT', message: 'Biến thể cờ không hợp lệ.' } };
  }
  if (raw.mode !== undefined && !VALID_MODES.has(raw.mode)) {
    return { ok: false, error: { code: 'INVALID_MODE', message: 'Chế độ chơi không hợp lệ.' } };
  }
  if (raw.result !== undefined && !VALID_RESULTS.has(raw.result)) {
    return { ok: false, error: { code: 'INVALID_RESULT', message: 'Kết quả ván cờ không hợp lệ.' } };
  }
  if (raw.reason !== undefined && !VALID_REASONS.has(raw.reason)) {
    return { ok: false, error: { code: 'INVALID_REASON', message: 'Lý do kết thúc không hợp lệ.' } };
  }
  if (raw.tc !== undefined && raw.tc !== null && !VALID_TC.has(raw.tc)) {
    return { ok: false, error: { code: 'INVALID_TC', message: 'Thiết lập thời gian không hợp lệ.' } };
  }
  if (!Array.isArray(raw.moves)) {
    return { ok: false, error: { code: 'INVALID_MOVES', message: 'Thiếu danh sách nước đi.' } };
  }
  if (raw.moves.length > MAX_PLIES) {
    return {
      ok: false,
      error: { code: 'TOO_MANY_PLIES', message: `Số nước đi (${raw.moves.length}) vượt quá giới hạn ${MAX_PLIES}.` },
    };
  }

  const startFen = raw.start?.fen;
  const fenCheck = validatePositionFen(startFen, variant);
  if (!fenCheck.ok) return fenCheck;

  const board = fenCheck.board;
  const rules = variant === 'jieqi' ? jieqiRules : xiangqiRules;
  const warnings = [];
  const normalizedMoves = [];

  for (let i = 0; i < raw.moves.length; i++) {
    const ply = i + 1;
    const mv = raw.moves[i];
    if (!mv || typeof mv !== 'object' || !isValidIccs(mv.m)) {
      return {
        ok: false,
        error: { code: 'INVALID_MOVE_FORMAT', ply, message: `Nước thứ ${ply} có định dạng không hợp lệ.` },
      };
    }

    // Cannot play moves after game already ended in checkmate or stalemate
    const preStatus = rules.status(board, board.sideToMove);
    if (preStatus === GameStatus.Checkmate || preStatus === GameStatus.Stalemate) {
      return {
        ok: false,
        error: { code: 'MOVE_AFTER_GAME_OVER', ply, message: `Nước thứ ${ply} (${mv.m}) xuất hiện sau khi ván đã kết thúc.` },
      };
    }

    const { from, to } = parseIccs(mv.m);
    const moving = board.at(from);
    if (!moving || moving.side !== board.sideToMove) {
      return {
        ok: false,
        error: { code: 'ILLEGAL_MOVE', ply, message: `Nước thứ ${ply} (${mv.m}) không hợp lệ.` },
      };
    }
    const legal = rules.legalMoves(board, from);
    if (!legal.some((t) => t.x === to.x && t.y === to.y)) {
      return {
        ok: false,
        error: { code: 'ILLEGAL_MOVE', ply, message: `Nước thứ ${ply} (${mv.m}) không hợp lệ.` },
      };
    }

    let externalReveal = null;
    const cleanMv = { m: mv.m };

    if (variant === 'jieqi') {
      const target = board.at(to);
      if (moving.covered) {
        if (!mv.r || !VALID_REVEAL_LETTERS.has(mv.r)) {
          return {
            ok: false,
            error: { code: 'MISSING_REVEAL', ply, message: `Nước thứ ${ply} (${mv.m}) thiếu ký hiệu lật quân úp.` },
          };
        }
        const revKind = LETTER_TO_KIND[mv.r];
        if ((board.pool[moving.side][revKind] || 0) <= 0) {
          return {
            ok: false,
            error: { code: 'EXHAUSTED_POOL', ply, message: `Nước thứ ${ply} (${mv.m}) lật quân ${mv.r} đã hết trong pool.` },
          };
        }
        cleanMv.r = mv.r;
        externalReveal = { type: revKind };
      } else if (mv.r !== undefined && mv.r !== null) {
        return {
          ok: false,
          error: { code: 'UNEXPECTED_REVEAL', ply, message: `Nước thứ ${ply} (${mv.m}) có ký hiệu lật trên quân đã mở.` },
        };
      }

      if (target && target.covered) {
        if (mv.cr !== undefined && mv.cr !== null) {
          if (!VALID_REVEAL_LETTERS.has(mv.cr)) {
            return {
              ok: false,
              error: { code: 'INVALID_CAPTURED_REVEAL', ply, message: `Nước thứ ${ply} (${mv.m}) có ký hiệu quân bị ăn không hợp lệ.` },
            };
          }
          const capKind = LETTER_TO_KIND[mv.cr];
          if ((board.pool[target.side][capKind] || 0) <= 0) {
            return {
              ok: false,
              error: { code: 'EXHAUSTED_POOL', ply, message: `Nước thứ ${ply} (${mv.m}) quân úp bị ăn ${mv.cr} đã hết trong pool.` },
            };
          }
          cleanMv.cr = mv.cr;
          externalReveal = { ...(externalReveal || {}), capturedType: capKind };
        }
      } else if (mv.cr !== undefined && mv.cr !== null) {
        return {
          ok: false,
          error: { code: 'UNEXPECTED_CAPTURED_REVEAL', ply, message: `Nước thứ ${ply} (${mv.m}) có ký hiệu lật quân ăn trên ô không có quân úp.` },
        };
      }
    }

    board.applyMove(from, to, externalReveal);
    normalizedMoves.push(cleanMv);
  }

  // Verify claimed result vs replayed end status
  let finalResult = raw.result || 'unfinished';
  let finalReason = raw.reason ?? null;
  const endStatus = rules.status(board, board.sideToMove);
  const expectedWinner = oppositeSide(board.sideToMove);

  if (finalReason === 'checkmate') {
    if (endStatus !== GameStatus.Checkmate || finalResult !== expectedWinner) {
      warnings.push('Kết quả chiếu bí trong file không khớp thế cờ cuối; đã chuyển về "Chưa xong".');
      finalResult = 'unfinished';
      finalReason = null;
    }
  } else if (finalReason === 'stalemate') {
    if (endStatus !== GameStatus.Stalemate || finalResult !== expectedWinner) {
      warnings.push('Kết quả hết nước đi trong file không khớp thế cờ cuối; đã chuyển về "Chưa xong".');
      finalResult = 'unfinished';
      finalReason = null;
    }
  } else if (finalReason === 'repetition' && endStatus !== GameStatus.DrawRepetition) {
    warnings.push('Lý do hòa lặp thế không khớp thế cờ cuối; đã chuyển về "Chưa xong".');
    finalResult = 'unfinished';
    finalReason = null;
  } else if (finalReason === 'noCapture' && endStatus !== GameStatus.DrawNoCapture) {
    warnings.push('Lý do hòa 60 nước không khớp thế cờ cuối; đã chuyển về "Chưa xong".');
    finalResult = 'unfinished';
    finalReason = null;
  }

  const record = createGameRecord({
    id: opts.isImport ? generateRecordId() : raw.id,
    variant,
    mode: opts.isImport ? (raw.mode || 'imported') : raw.mode,
    createdAt: raw.createdAt,
    updatedAt: opts.isImport ? new Date().toISOString() : raw.updatedAt,
    red: raw.red,
    black: raw.black,
    tc: raw.tc,
    start: { fen: startFen.trim() },
    moves: normalizedMoves,
    result: finalResult,
    reason: finalReason,
    note: raw.note,
    source: opts.isImport ? 'import' : raw.source,
  });

  return {
    ok: true,
    record,
    warnings,
    finalFen: variant === 'jieqi' ? board.publicFen() : board.toFen(),
    finalPool: variant === 'jieqi' ? board.getPool() : null,
  };
}
