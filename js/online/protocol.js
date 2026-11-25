/**
 * Shared Online Play protocol constants, time controls, and validators.
 * Pure ES module imported by both the browser client and the Node + ws server.
 */

export const PROTOCOL_VERSION = 1;

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 6;

export const TIME_CONTROLS = {
  chop: { id: 'chop', label: 'Chớp 3+2', short: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  nhanh: { id: 'nhanh', label: 'Nhanh 10+5', short: '10+5', initialMs: 600_000, incrementMs: 5_000 },
  cham: { id: 'cham', label: 'Chậm 30+10', short: '30+10', initialMs: 1_800_000, incrementMs: 10_000 },
  none: { id: 'none', label: 'Không giới hạn', short: '∞', initialMs: 0, incrementMs: 0 },
};

export const TIME_CONTROL_LIST = Object.values(TIME_CONTROLS);

const VALID_VARIANTS = new Set(['cotuong', 'coup']);
const ICCS_RE = /^[a-i][0-9][a-i][0-9]$/;
const GUEST_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const ROOM_CODE_RE = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LEN}}$`);

export function isValidVariant(v) {
  return typeof v === 'string' && VALID_VARIANTS.has(v);
}

export function isValidTimeControl(tc) {
  return typeof tc === 'string' && Object.prototype.hasOwnProperty.call(TIME_CONTROLS, tc);
}

export function isValidIccs(move) {
  return typeof move === 'string' && ICCS_RE.test(move);
}

export function isValidGuestId(id) {
  return typeof id === 'string' && GUEST_ID_RE.test(id);
}

export function normalizeRoomCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code) {
  return typeof code === 'string' && ROOM_CODE_RE.test(code);
}

/**
 * Strip control characters, collapse whitespace, enforce 2..16 chars.
 * Always render with textContent on the client (never innerHTML).
 */
export function sanitizeNickname(raw) {
  const cleaned = String(raw || '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (cleaned.length < 2) return 'Kỳ thủ';
  return cleaned;
}

export function formatClockMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '∞';
  const clamped = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatOnlineReasonVi(reason, winnerSide, mySide) {
  const won = winnerSide && mySide && winnerSide === mySide;
  const lost = winnerSide && mySide && winnerSide !== mySide;
  switch (reason) {
    case 'checkmate':
      return won ? 'Chiếu bí! Bạn thắng!' : lost ? 'Bị chiếu bí! Bạn thua.' : 'Chiếu bí!';
    case 'stalemate':
      return won ? 'Đối thủ hết nước đi! Bạn thắng!' : lost ? 'Hết nước đi! Bạn thua.' : 'Hết nước đi!';
    case 'timeout':
      return won ? 'Đối thủ hết giờ! Bạn thắng!' : lost ? 'Bạn đã hết giờ!' : 'Hết giờ!';
    case 'resign':
      return won ? 'Đối thủ đã đầu hàng! Bạn thắng!' : lost ? 'Bạn đã đầu hàng.' : 'Đầu hàng.';
    case 'abandon':
      return won ? 'Đối thủ rời trận! Bạn thắng!' : lost ? 'Mất kết nối quá thời gian cho phép.' : 'Bỏ trận.';
    case 'draw_agreement':
      return 'Hai bên đồng ý hòa.';
    case 'draw_repetition':
      return 'Hòa do lặp thế cờ 3 lần.';
    case 'draw_no_capture':
      return 'Hòa do 60 nước không ăn quân.';
    default:
      return 'Ván cờ đã kết thúc.';
  }
}
