/**
 * Pure mobile/touch layout and interaction math (zero DOM access).
 * Phase B1 stub: returns placeholder values so tests/touch/touchMath.test.js runs RED
 * before Phase C implementation.
 */

export function computeLayoutMode(_w, _h) {
  return 'desktop';
}

export function computeBoardRect(_layoutMode, _w, _h, _chrome = {}) {
  return { x: 0, y: 0, width: 0, height: 0 };
}

export function snapToIntersection(_px, _py, _geom) {
  return { col: 0, row: 0, dist: Infinity };
}

export function pickPieceAt(_px, _py, _geom, _occupied, _pointerType = 'mouse') {
  return null;
}

export function computeLiftOffset(_fingerY, _geom, _liftCells = 0.9, _boardTopY = 0) {
  return 0;
}

export function chooseDropTarget(_centerX, _centerY, _geom, _legalTargets = [], _opts = {}) {
  return null;
}

export function classifyPointer(_events) {
  return 'tap';
}

export function hapticPattern(_eventName) {
  return null;
}

export function createHapticThrottle(_minIntervalMs = 40) {
  return () => false;
}
