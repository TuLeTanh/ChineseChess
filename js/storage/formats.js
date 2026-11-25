/**
 * Pure serializers & parsers for JSON (.xqgame.json), PGN-like text (.pgn/.txt),
 * FEN helpers, and compressed base64url share-link payloads (#/replay?g=...).
 * Zero DOM/window access; works identically in Node and modern browsers.
 */
import { START_FEN } from '../model/fen.js';
import {
  RECORD_SCHEMA_VERSION,
  MAX_RECORD_BYTES,
  JIEQI_START_PUBLIC_FEN,
  createGameRecord,
  normalizeVariantId,
} from './gameRecord.js';
import { validateAndNormalizeRecord, validatePositionFen } from './validate.js';

export const MAX_SHARE_PAYLOAD_CHARS = 6000;

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).byteLength;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url) {
  if (typeof b64url !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b64url)) {
    throw new Error('Invalid base64url');
  }
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * a) JSON serializer & parser (.xqgame.json)
 * Strips any local-only fields (secretLocal, etc.) via createGameRecord.
 */
export function toJson(record) {
  const clean = createGameRecord(record);
  return JSON.stringify(clean, null, 2);
}

export function fromJson(text, opts = { isImport: true }) {
  if (typeof text !== 'string') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Nội dung JSON không hợp lệ.' } };
  }
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_RECORD_BYTES) {
    return { ok: false, error: { code: 'TOO_LARGE', message: 'File vượt quá giới hạn 256 KB.' } };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'JSON_PARSE_ERROR', message: 'File JSON bị lỗi cú pháp hoặc bị cắt cụt.' } };
  }
  return validateAndNormalizeRecord(parsed, { ...opts, rawBytes: bytes });
}

/**
 * b) PGN-like text serializer & parser (.pgn / .txt)
 */
function resultToPgnToken(result) {
  if (result === 'red') return '1-0';
  if (result === 'black') return '0-1';
  if (result === 'draw') return '1/2-1/2';
  return '*';
}

function pgnTokenToResult(tok) {
  if (tok === '1-0') return 'red';
  if (tok === '0-1') return 'black';
  if (tok === '1/2-1/2') return 'draw';
  if (tok === '*') return 'unfinished';
  return null;
}

function escapeHeaderVal(val) {
  return String(val ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function toPgn(record) {
  const rec = createGameRecord(record);
  const dateStr = (rec.createdAt || new Date().toISOString()).slice(0, 10).replace(/-/g, '.');
  const resTok = resultToPgnToken(rec.result);
  const lines = [
    `[Game "${rec.variant === 'jieqi' ? 'Jieqi' : 'Xiangqi'}"]`,
    `[Red "${escapeHeaderVal(rec.red.name)}"]`,
    `[Black "${escapeHeaderVal(rec.black.name)}"]`,
    `[Date "${dateStr}"]`,
    `[Result "${resTok}"]`,
  ];
  if (rec.reason) lines.push(`[Termination "${escapeHeaderVal(rec.reason)}"]`);
  if (rec.tc) lines.push(`[TimeControl "${escapeHeaderVal(rec.tc)}"]`);
  const defaultFen = rec.variant === 'jieqi' ? JIEQI_START_PUBLIC_FEN : START_FEN;
  if (rec.start.fen !== defaultFen) {
    lines.push(`[FEN "${escapeHeaderVal(rec.start.fen)}"]`);
  }

  const moveTokens = [];
  for (let i = 0; i < rec.moves.length; i++) {
    const mv = rec.moves[i];
    if (i % 2 === 0) moveTokens.push(`${Math.floor(i / 2) + 1}.`);
    let tok = mv.m;
    if (rec.variant === 'jieqi') {
      if (mv.r) tok += `=${mv.r}`;
      if (mv.cr) tok += `x=${mv.cr}`;
    }
    moveTokens.push(tok);
  }
  moveTokens.push(resTok);

  // Wrap move text neatly around 80 chars
  const wrapped = [];
  let line = '';
  for (const tok of moveTokens) {
    if (line && line.length + tok.length + 1 > 80) {
      wrapped.push(line);
      line = tok;
    } else {
      line = line ? `${line} ${tok}` : tok;
    }
  }
  if (line) wrapped.push(line);

  return `${lines.join('\n')}\n\n${wrapped.join('\n')}\n`;
}

export function fromPgn(text, opts = { isImport: true }) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: { code: 'EMPTY_PGN', message: 'Nội dung PGN trống.' } };
  }
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_RECORD_BYTES) {
    return { ok: false, error: { code: 'TOO_LARGE', message: 'Văn bản PGN vượt quá giới hạn 256 KB.' } };
  }

  const headers = Object.create(null);
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const bodyLines = [];
  let inHeaders = true;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (Object.keys(headers).length > 0) inHeaders = false;
      continue;
    }
    const hm = trimmed.match(/^\[([A-Za-z][A-Za-z0-9_-]*)\s+"((?:\\.|[^"\\])*)"\]$/);
    if (inHeaders && hm) {
      headers[hm[1]] = hm[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      inHeaders = false;
      bodyLines.push(trimmed);
    }
  }

  const gameHdr = (headers.Game || 'Xiangqi').trim().toLowerCase();
  const variant = normalizeVariantId(gameHdr);
  if (!variant) {
    return { ok: false, error: { code: 'INVALID_VARIANT', message: `Tiêu đề [Game "${headers.Game}"] không hợp lệ.` } };
  }

  const body = bodyLines.join(' ').trim();
  const tokens = body ? body.split(/\s+/) : [];
  const moves = [];
  let bodyResult = null;
  const moveRx = /^([a-i][0-9][a-i][0-9])(?:=([RNBACP]))?(?:x=([RNBACP]))?$/;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d+\.+$/.test(tok)) continue; // move number like "1." or "12..."
    const resMatch = pgnTokenToResult(tok);
    if (resMatch !== null) {
      bodyResult = resMatch;
      if (i !== tokens.length - 1) {
        return {
          ok: false,
          error: { code: 'TRAILING_TOKENS', message: `Ký tự thừa sau kết quả "${tok}" trong PGN.` },
        };
      }
      break;
    }
    const m = tok.match(moveRx);
    if (!m) {
      return {
        ok: false,
        error: { code: 'INVALID_PGN_TOKEN', ply: moves.length + 1, message: `Nước đi không hợp lệ trong PGN: "${tok}".` },
      };
    }
    const mv = { m: m[1] };
    if (m[2]) mv.r = m[2];
    if (m[3]) mv.cr = m[3];
    moves.push(mv);
  }

  const headerRes = headers.Result ? pgnTokenToResult(headers.Result) : null;
  const result = headerRes || bodyResult || 'unfinished';
  const defaultFen = variant === 'jieqi' ? JIEQI_START_PUBLIC_FEN : START_FEN;
  const dateIso =
    headers.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(headers.Date)
      ? `${headers.Date.replace(/\./g, '-')}T00:00:00.000Z`
      : new Date().toISOString();

  const rawRec = {
    v: RECORD_SCHEMA_VERSION,
    variant,
    mode: 'imported',
    createdAt: dateIso,
    updatedAt: dateIso,
    red: { name: headers.Red || 'Đỏ', kind: 'human' },
    black: { name: headers.Black || 'Đen', kind: 'human' },
    tc: headers.TimeControl || undefined,
    start: { fen: headers.FEN || defaultFen },
    moves,
    result,
    reason: headers.Termination || null,
    source: 'import',
  };

  return validateAndNormalizeRecord(rawRec, { ...opts, rawBytes: bytes });
}

/**
 * c) FEN helpers (reusing validatePositionFen)
 */
export function positionToFen(board) {
  return board.isJieqi ? board.publicFen() : board.toFen();
}

export function fenToPosition(fenStr, variant = null) {
  const inferred =
    variant || (typeof fenStr === 'string' && (/[Xx]/.test(fenStr.split(/\s+/)[0] || '') || fenStr.trim().split(/\s+/).length >= 7) ? 'jieqi' : 'xiangqi');
  return validatePositionFen(fenStr, inferred);
}

/**
 * d) Share-link payload encoder & decoder (#/replay?g=<payload>)
 * Uses CompressionStream('deflate-raw') when available, with hard 256 KB decompression cap.
 */
async function deflateRaw(bytes) {
  if (typeof globalThis.CompressionStream !== 'function') return null;
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function inflateRawWithCap(bytes, maxBytes = MAX_RECORD_BYTES) {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('DecompressionStream unavailable');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      const err = new Error('Decompressed payload exceeds 256 KB');
      err.code = 'ZIP_BOMB';
      throw err;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function encodeSharePayload(record) {
  const clean = createGameRecord(record);
  const minObj = {
    v: clean.v,
    va: clean.variant === 'jieqi' ? 'j' : 'x',
    r: clean.red.name,
    b: clean.black.name,
    s: clean.start.fen,
    m: clean.moves,
    rs: clean.result,
    rn: clean.reason,
  };
  if (clean.tc) minObj.tc = clean.tc;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(minObj));
  let payload;
  try {
    const compressed = await deflateRaw(jsonBytes);
    if (compressed && compressed.byteLength < jsonBytes.byteLength) {
      payload = `z.${bytesToBase64Url(compressed)}`;
    } else {
      payload = `r.${bytesToBase64Url(jsonBytes)}`;
    }
  } catch {
    payload = `r.${bytesToBase64Url(jsonBytes)}`;
  }

  if (payload.length > MAX_SHARE_PAYLOAD_CHARS) {
    return {
      ok: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Ván cờ quá dài để tạo liên kết chia sẻ (> 6000 ký tự). Vui lòng tải file .json thay thế.',
      },
    };
  }
  return { ok: true, payload };
}

export async function decodeSharePayload(payload, opts = { isImport: true }) {
  if (typeof payload !== 'string' || payload.length < 3 || payload.length > MAX_SHARE_PAYLOAD_CHARS + 64) {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Liên kết chia sẻ không hợp lệ.' } };
  }
  const mode = payload.slice(0, 2);
  const body = payload.slice(2);
  if (mode !== 'z.' && mode !== 'r.') {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Liên kết chia sẻ sai định dạng.' } };
  }

  let jsonBytes;
  try {
    const rawBytes = base64UrlToBytes(body);
    if (mode === 'z.') {
      jsonBytes = await inflateRawWithCap(rawBytes, MAX_RECORD_BYTES);
    } else {
      if (rawBytes.byteLength > MAX_RECORD_BYTES) {
        return { ok: false, error: { code: 'TOO_LARGE', message: 'Dữ liệu liên kết vượt quá 256 KB.' } };
      }
      jsonBytes = rawBytes;
    }
  } catch (err) {
    if (err && err.code === 'ZIP_BOMB') {
      return { ok: false, error: { code: 'ZIP_BOMB', message: 'Dữ liệu giải nén vượt quá giới hạn 256 KB.' } };
    }
    return { ok: false, error: { code: 'DECODE_ERROR', message: 'Không thể giải mã liên kết chia sẻ.' } };
  }

  let minObj;
  try {
    minObj = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return { ok: false, error: { code: 'JSON_PARSE_ERROR', message: 'Dữ liệu liên kết bị hỏng.' } };
  }
  if (!minObj || typeof minObj !== 'object') {
    return { ok: false, error: { code: 'INVALID_OBJECT', message: 'Dữ liệu liên kết không hợp lệ.' } };
  }

  const expanded = {
    v: minObj.v,
    variant: minObj.va === 'j' ? 'jieqi' : minObj.va === 'x' ? 'xiangqi' : minObj.va,
    mode: 'imported',
    red: { name: minObj.r || 'Đỏ', kind: 'human' },
    black: { name: minObj.b || 'Đen', kind: 'human' },
    tc: minObj.tc,
    start: { fen: minObj.s },
    moves: minObj.m,
    result: minObj.rs,
    reason: minObj.rn ?? null,
    source: 'import',
  };
  return validateAndNormalizeRecord(expanded, { ...opts, rawBytes: jsonBytes.byteLength });
}

/**
 * Generate an ASCII-only download filename, e.g. `cotuong_2026-11-25_NghiepDu_vs_Ban.xqgame.json`.
 */
export function makeExportFilename(record, ext = 'xqgame.json') {
  const cleanAscii = (s) =>
    String(s || 'KyThu')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9]+/g, '')
      .slice(0, 14) || 'KyThu';
  const v = record?.variant === 'jieqi' || record?.variant === 'coup' ? 'coup' : 'cotuong';
  const date = (record?.createdAt || new Date().toISOString()).slice(0, 10);
  const r = cleanAscii(record?.red?.name || 'Do');
  const b = cleanAscii(record?.black?.name || 'Den');
  return `${v}_${date}_${r}_vs_${b}.${ext}`;
}
