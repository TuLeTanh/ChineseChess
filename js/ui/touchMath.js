/**
 * Pure mobile/touch layout and interaction math (zero DOM access).
 * Tested by tests/touch/touchMath.test.js.
 */

export const BOARD_ASPECT_W = 1050;
export const BOARD_ASPECT_H = 1150;
export const BOARD_ASPECT = BOARD_ASPECT_W / BOARD_ASPECT_H;

export const HAPTIC_PATTERNS = {
  pick: 8,
  drop: 12,
  capture: 20,
  illegal: [10, 30, 10],
  check: [30, 40, 30],
  gameover: [60, 60, 60, 60, 120],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function getOrigin(geom) {
  const ox = typeof geom?.originX === 'number' ? geom.originX : (geom?.origin?.x ?? 0);
  const oy = typeof geom?.originY === 'number' ? geom.originY : (geom?.origin?.y ?? 0);
  return { ox, oy };
}

/**
 * Determine layout mode from viewport dimensions (never from pointer type).
 * @param {number} w
 * @param {number} h
 * @returns {'desktop' | 'side' | 'stack'}
 */
export function computeLayoutMode(w, h) {
  if (w >= 960 && h >= 600) return 'desktop';
  if (h > 0 && w / h >= 1.2) return 'side';
  return 'stack';
}

/**
 * Compute largest board rectangle with aspect 1050:1150 fitting the free area.
 * @param {'desktop' | 'side' | 'stack'} layoutMode
 * @param {number} w
 * @param {number} h
 * @param {object} [chrome]
 * @returns {{ x: number, y: number, width: number, height: number, panelWidth?: number }}
 */
export function computeBoardRect(layoutMode, w, h, chrome = {}) {
  const safeTop = chrome.safeTop ?? 0;
  const safeRight = chrome.safeRight ?? 0;
  const safeBottom = chrome.safeBottom ?? 0;
  const safeLeft = chrome.safeLeft ?? 0;
  const aspect = chrome.aspect ?? BOARD_ASPECT;

  if (layoutMode === 'stack') {
    const topBar = chrome.topBar ?? 44;
    const oppStrip = chrome.oppStrip ?? 44;
    const moveStrip = chrome.moveStrip ?? 36;
    const playerStrip = chrome.playerStrip ?? 44;
    const controls = chrome.controls ?? 52;
    const availW = Math.max(80, w - safeLeft - safeRight);
    const chromeH = topBar + oppStrip + moveStrip + playerStrip + controls + safeTop + safeBottom;
    const availH = Math.max(80, h - chromeH);
    const width = Math.min(availW, availH * aspect);
    const height = width / aspect;
    const x = safeLeft + (availW - width) / 2;
    const y = safeTop + topBar + oppStrip + (availH - height) / 2;
    return { x, y, width, height };
  }

  if (layoutMode === 'side') {
    const padV = chrome.sidePadV ?? 8;
    const panelMin = chrome.panelMin ?? 280;
    const panelMax = chrome.panelMax ?? 340;
    const totalW = Math.max(320, w - safeLeft - safeRight);
    const availH = Math.max(80, h - padV - safeTop - safeBottom);
    const maxBoardW = Math.max(80, totalW - panelMin);
    const width = Math.min(maxBoardW, availH * aspect);
    const height = width / aspect;
    const panelWidth = clamp(totalW - width, panelMin, panelMax);
    const leftAreaW = Math.max(width, totalW - panelWidth);
    const x = safeLeft + (leftAreaW - width) / 2;
    const y = safeTop + (h - safeTop - safeBottom - height) / 2;
    return { x, y, width, height, panelWidth };
  }

  // desktop (unchanged: 320px side panel + 24px margins)
  const availW = Math.max(120, w - 320 - 24 - 48);
  const availH = Math.max(120, h - 48);
  const width = Math.min(availW, availH * aspect);
  const height = width / aspect;
  const x = 24 + (availW - width) / 2;
  const y = 24 + (availH - height) / 2;
  return { x, y, width, height, panelWidth: 320 };
}

/**
 * Snap board/screen coordinates to the nearest intersection (0..8 x 0..9).
 * @param {number} px
 * @param {number} py
 * @param {{ cell: number, originX?: number, originY?: number, origin?: {x:number,y:number}, flipped?: boolean }} geom
 * @returns {{ col: number, row: number, dist: number }}
 */
export function snapToIntersection(px, py, geom) {
  const cell = geom.cell;
  const { ox, oy } = getOrigin(geom);
  const rawCol = clamp(Math.round((px - ox) / cell), 0, 8);
  const rawRow = clamp(Math.round((py - oy) / cell), 0, 9);
  const ix = ox + rawCol * cell;
  const iy = oy + rawRow * cell;
  const dist = Math.hypot(px - ix, py - iy);
  const col = geom.flipped ? 8 - rawCol : rawCol;
  const row = geom.flipped ? 9 - rawRow : rawRow;
  return { col, row, dist };
}

function squareCenter(sq, geom) {
  const { ox, oy } = getOrigin(geom);
  const vc = geom.flipped ? 8 - sq.x : sq.x;
  const vr = geom.flipped ? 9 - sq.y : sq.y;
  return { x: ox + vc * geom.cell, y: oy + vr * geom.cell };
}

/**
 * Pick the nearest occupied square within 0.48 cell (mouse) or 0.55 cell (touch/pen).
 * @param {number} px
 * @param {number} py
 * @param {object} geom
 * @param {Array<{x: number, y: number}>} occupied
 * @param {string} [pointerType]
 * @returns {{ x: number, y: number } | null}
 */
export function pickPieceAt(px, py, geom, occupied, pointerType = 'mouse') {
  if (!Array.isArray(occupied) || occupied.length === 0) return null;
  const isTouch = pointerType === 'touch' || pointerType === 'pen';
  const maxDist = (isTouch ? 0.55 : 0.48) * geom.cell;

  let best = null;
  let bestDist = Infinity;
  let bestIdx = Infinity;

  for (const sq of occupied) {
    const c = squareCenter(sq, geom);
    const d = Math.hypot(px - c.x, py - c.y);
    if (d <= maxDist) {
      const idx = sq.y * 9 + sq.x;
      if (d < bestDist - 1e-6 || (Math.abs(d - bestDist) <= 1e-6 && idx < bestIdx)) {
        best = { x: sq.x, y: sq.y };
        bestDist = d;
        bestIdx = idx;
      }
    }
  }
  return best;
}

/**
 * Pixels to shift a dragged piece UP above the finger (0 at board top, full below 1.5 cells).
 * @param {number} fingerY
 * @param {{ cell: number }} geom
 * @param {number} [liftCells]
 * @param {number} [boardTopY]
 * @returns {number}
 */
export function computeLiftOffset(fingerY, geom, liftCells = 0.9, boardTopY = 0) {
  if (!liftCells || liftCells <= 0 || !geom || !geom.cell) return 0;
  const ratio = clamp((fingerY - boardTopY) / (1.5 * geom.cell), 0, 1);
  return liftCells * geom.cell * ratio;
}

/**
 * Choose drop target from piece center:
 * - nearest legal target within 0.75 cell (deterministic tie-break: lower y*9+x)
 * - else nearest intersection within 0.5 cell with legal: false
 * - else null (spring back)
 * @param {number} centerX
 * @param {number} centerY
 * @param {object} geom
 * @param {Array<{x: number, y: number}>} [legalTargets]
 * @param {{ legalRadiusCells?: number, illegalRadiusCells?: number }} [opts]
 * @returns {{ square: { x: number, y: number }, legal: boolean } | null}
 */
export function chooseDropTarget(centerX, centerY, geom, legalTargets = [], opts = {}) {
  const cell = geom.cell;
  const legalMax = (opts.legalRadiusCells ?? 0.75) * cell;
  const illegalMax = (opts.illegalRadiusCells ?? 0.5) * cell;

  let best = null;
  let bestDist = Infinity;
  let bestIdx = Infinity;

  if (Array.isArray(legalTargets)) {
    for (const sq of legalTargets) {
      const c = squareCenter(sq, geom);
      const d = Math.hypot(centerX - c.x, centerY - c.y);
      if (d <= legalMax) {
        const idx = sq.y * 9 + sq.x;
        if (d < bestDist - 1e-6 || (Math.abs(d - bestDist) <= 1e-6 && idx < bestIdx)) {
          best = { x: sq.x, y: sq.y };
          bestDist = d;
          bestIdx = idx;
        }
      }
    }
  }
  if (best) {
    return { square: best, legal: true };
  }

  const snapped = snapToIntersection(centerX, centerY, geom);
  if (snapped.dist <= illegalMax) {
    return { square: { x: snapped.col, y: snapped.row }, legal: false };
  }
  return null;
}

/**
 * Classify a pointer gesture sequence as 'tap' or 'drag'.
 * Touch: tap if total movement < 10 CSS px; drag starts after 6 CSS px.
 * Mouse: tap if movement <= 4 CSS px; drag starts after 4 CSS px.
 * @param {Array<{ pointerType?: string, clientX: number, clientY: number }>} events
 * @returns {'tap' | 'drag'}
 */
export function classifyPointer(events) {
  if (!Array.isArray(events) || events.length < 2) return 'tap';
  const pt = events[0].pointerType || 'mouse';
  const isTouch = pt === 'touch' || pt === 'pen';
  const x0 = events[0].clientX;
  const y0 = events[0].clientY;
  let total = 0;
  let maxDisp = 0;
  for (let i = 1; i < events.length; i++) {
    const seg = Math.hypot(events[i].clientX - events[i - 1].clientX, events[i].clientY - events[i - 1].clientY);
    total += seg;
    const disp = Math.hypot(events[i].clientX - x0, events[i].clientY - y0);
    if (disp > maxDisp) maxDisp = disp;
  }
  if (isTouch) {
    return total < 10 ? 'tap' : (maxDisp > 6 ? 'drag' : 'tap');
  }
  return maxDisp > 4 ? 'drag' : 'tap';
}

/**
 * Return vibration pattern for a named game event.
 * @param {string} eventName
 * @returns {number | number[] | null}
 */
export function hapticPattern(eventName) {
  return Object.prototype.hasOwnProperty.call(HAPTIC_PATTERNS, eventName)
    ? HAPTIC_PATTERNS[eventName]
    : null;
}

/**
 * Pure throttle predicate suppressing calls closer than `minIntervalMs`.
 * @param {number} [minIntervalMs]
 * @returns {(nowMs: number) => boolean}
 */
export function createHapticThrottle(minIntervalMs = 40) {
  let lastMs = -Infinity;
  return (nowMs) => {
    if (nowMs - lastMs < minIntervalMs) return false;
    lastMs = nowMs;
    return true;
  };
}
