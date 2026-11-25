import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLayoutMode,
  computeBoardRect,
  snapToIntersection,
  pickPieceAt,
  computeLiftOffset,
  chooseDropTarget,
  classifyPointer,
  hapticPattern,
  createHapticThrottle,
} from '../../js/ui/touchMath.js';

const GEOM_STD = { cell: 40, originX: 50, originY: 50, flipped: false };
const GEOM_FLIP = { cell: 40, originX: 50, originY: 50, flipped: true };

test('1. computeLayoutMode covers all specified sizes and boundaries', () => {
  const cases = [
    [320, 568, 'stack'],
    [360, 640, 'stack'],
    [390, 844, 'stack'],
    [430, 932, 'stack'],
    [568, 320, 'side'],
    [667, 375, 'side'],
    [844, 390, 'side'],
    [915, 412, 'side'],
    [768, 1024, 'stack'],
    [820, 1180, 'stack'],
    [1024, 768, 'desktop'],
    [1180, 820, 'desktop'],
    [960, 680, 'desktop'],
    [960, 540, 'side'],
    [1600, 900, 'desktop'],
    // Exact boundaries
    [960, 600, 'desktop'],
    [959, 600, 'side'],   // 959/600 = 1.598 >= 1.2
    [960, 599, 'side'],   // h < 600, 960/599 >= 1.2
    [600, 500, 'side'],   // 600/500 = 1.2 exactly
    [599, 500, 'stack'],  // 599/500 = 1.198 < 1.2
  ];
  for (const [w, h, expected] of cases) {
    assert.equal(computeLayoutMode(w, h), expected, `size ${w}x${h}`);
  }
});

test('2. computeBoardRect fits free area, respects aspect 1050:1150, and is monotonic', () => {
  const stackChrome = {
    topBar: 44,
    oppStrip: 44,
    moveStrip: 36,
    playerStrip: 44,
    controls: 52,
    safeTop: 0,
    safeRight: 0,
    safeBottom: 0,
    safeLeft: 0,
  };

  // 360x640 stack: freeH = 640 - 220 = 420, 360 * 1150/1050 = 394.28 <= 420 => width = 360
  const r360 = computeBoardRect('stack', 360, 640, stackChrome);
  assert.equal(Math.round(r360.width), 360);
  assert.ok(r360.height <= 640 - 220 + 0.5);
  assert.ok(Math.abs(r360.width / r360.height - 1050 / 1150) < 0.01);

  // 320x568 stack: width >= 300 and never exceeds free area
  const r320 = computeBoardRect('stack', 320, 568, stackChrome);
  assert.ok(r320.width >= 300, `expected >= 300, got ${r320.width}`);
  assert.ok(r320.width <= 320);
  assert.ok(r320.height <= 568 - 220 + 0.5);

  // 844x390 side: height = viewport height minus 8
  const r844 = computeBoardRect('side', 844, 390, { safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 });
  assert.equal(Math.round(r844.height), 390 - 8);
  assert.ok(r844.width <= 844 - 280);
  assert.ok(Math.abs(r844.width / r844.height - 1050 / 1150) < 0.01);

  // Monotonicity in stack
  const widths = [320, 360, 390, 430, 768, 820];
  let prevW = 0;
  for (const w of widths) {
    const h = Math.round(w * 1.8);
    const r = computeBoardRect('stack', w, h, stackChrome);
    assert.ok(r.width >= prevW, `non-monotonic at w=${w}: ${r.width} < ${prevW}`);
    prevW = r.width;
  }

  // Desktop unchanged aspect & positive size
  const rDesk = computeBoardRect('desktop', 1180, 780, {});
  assert.ok(rDesk.width > 500 && rDesk.height > 500);
  assert.ok(Math.abs(rDesk.width / rDesk.height - 1050 / 1150) < 0.01);
});

test('3. snapToIntersection handles normal, flipped, and out-of-bounds clamping', () => {
  // Exact intersection (4, 9)
  const s1 = snapToIntersection(50 + 4 * 40, 50 + 9 * 40, GEOM_STD);
  assert.equal(s1.col, 4);
  assert.equal(s1.row, 9);
  assert.equal(s1.dist, 0);

  // Slightly offset from (2, 3)
  const s2 = snapToIntersection(50 + 2 * 40 + 6, 50 + 3 * 40 - 8, GEOM_STD);
  assert.equal(s2.col, 2);
  assert.equal(s2.row, 3);
  assert.ok(Math.abs(s2.dist - 10) < 1e-6);

  // Flipped board: visual (0, 0) corresponds to logical (8, 9)
  const sf = snapToIntersection(50, 50, GEOM_FLIP);
  assert.equal(sf.col, 8);
  assert.equal(sf.row, 9);
  assert.equal(sf.dist, 0);

  // Far outside board: clamped to (0, 0) with large dist
  const sout = snapToIntersection(-200, -150, GEOM_STD);
  assert.equal(sout.col, 0);
  assert.equal(sout.row, 0);
  assert.ok(sout.dist > 300);
});

test('4. pickPieceAt uses 0.48 cell radius for mouse and 0.55 for touch, nearest wins', () => {
  const occupied = [
    { x: 4, y: 7 },
    { x: 5, y: 7 },
  ];
  const cx = 50 + 4 * 40;
  const cy = 50 + 7 * 40;

  // At 0.51 * cell (= 20.4 px): mouse (0.48 = 19.2 px) misses, touch (0.55 = 22 px) hits
  assert.equal(pickPieceAt(cx, cy + 20.4, GEOM_STD, occupied, 'mouse'), null);
  assert.deepEqual(pickPieceAt(cx, cy + 20.4, GEOM_STD, occupied, 'touch'), { x: 4, y: 7 });

  // Between (4,7) and (5,7), closer to (5,7)
  assert.deepEqual(pickPieceAt(cx + 23, cy, GEOM_STD, occupied, 'touch'), { x: 5, y: 7 });

  // Outside 0.55 * cell (= 22 px)
  assert.equal(pickPieceAt(cx, cy + 24, GEOM_STD, occupied, 'touch'), null);
});

test('5. computeLiftOffset is 0 at top edge, full below 1.5 cells, never negative', () => {
  const topY = 100;
  // At or above board top -> 0
  assert.equal(computeLiftOffset(topY, GEOM_STD, 0.9, topY), 0);
  assert.equal(computeLiftOffset(topY - 30, GEOM_STD, 0.9, topY), 0);

  // Halfway down the 1.5-cell ramp (0.75 cell = 30 px) -> 0.5 * 0.9 * 40 = 18 px
  assert.ok(Math.abs(computeLiftOffset(topY + 30, GEOM_STD, 0.9, topY) - 18) < 1e-6);

  // At or below 1.5 cells (60 px) -> full 0.9 * 40 = 36 px
  assert.ok(Math.abs(computeLiftOffset(topY + 60, GEOM_STD, 0.9, topY) - 36) < 1e-6);
  assert.ok(Math.abs(computeLiftOffset(topY + 250, GEOM_STD, 0.9, topY) - 36) < 1e-6);

  // Disabled (liftCells = 0) -> 0
  assert.equal(computeLiftOffset(topY + 200, GEOM_STD, 0, topY), 0);
});

test('6. chooseDropTarget picks nearest legal within 0.75 cell, deterministic tie-break, illegal fallback, and 20+ targets', () => {
  const legal = [
    { x: 4, y: 5 },
    { x: 5, y: 5 },
  ];
  const p45x = 50 + 4 * 40;
  const p45y = 50 + 5 * 40;

  // Offset 0.65 cell (26 px) from (4,5) -> still snaps to legal (4,5)
  const r1 = chooseDropTarget(p45x - 26, p45y, GEOM_STD, legal);
  assert.deepEqual(r1, { square: { x: 4, y: 5 }, legal: true });

  // Exact midpoint between (4,5) and (5,5) -> deterministic lower index (4,5)
  const rTie = chooseDropTarget(p45x + 20, p45y, GEOM_STD, [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
  ]);
  assert.deepEqual(rTie, { square: { x: 4, y: 5 }, legal: true });

  // Slightly closer to (5,5)
  const rNear5 = chooseDropTarget(p45x + 22, p45y, GEOM_STD, legal);
  assert.deepEqual(rNear5, { square: { x: 5, y: 5 }, legal: true });

  // No legal targets -> nearest intersection within 0.5 cell with legal: false
  const rIll = chooseDropTarget(50 + 1 * 40 + 5, 50 + 1 * 40, GEOM_STD, []);
  assert.deepEqual(rIll, { square: { x: 1, y: 1 }, legal: false });

  // Outside board (> 0.5 cell away from any intersection) -> null
  assert.equal(chooseDropTarget(-100, -100, GEOM_STD, legal), null);

  // 25 legal targets (free mode)
  const many = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) many.push({ x, y });
  }
  const rMany = chooseDropTarget(50 + 3 * 40 + 10, 50 + 2 * 40 - 9, GEOM_STD, many);
  assert.deepEqual(rMany, { square: { x: 3, y: 2 }, legal: true });
});

test('7. classifyPointer distinguishes tap vs drag for touch and mouse', () => {
  // Touch tap: < 10 px total movement
  assert.equal(
    classifyPointer([
      { pointerType: 'touch', clientX: 100, clientY: 100 },
      { pointerType: 'touch', clientX: 104, clientY: 103 },
    ]),
    'tap'
  );
  // Touch drag: > 6 px threshold (and >= 10 px total)
  assert.equal(
    classifyPointer([
      { pointerType: 'touch', clientX: 100, clientY: 100 },
      { pointerType: 'touch', clientX: 108, clientY: 106 },
    ]),
    'drag'
  );
  // Mouse tap (< 4 px) vs drag (> 4 px)
  assert.equal(
    classifyPointer([
      { pointerType: 'mouse', clientX: 50, clientY: 50 },
      { pointerType: 'mouse', clientX: 52, clientY: 51 },
    ]),
    'tap'
  );
  assert.equal(
    classifyPointer([
      { pointerType: 'mouse', clientX: 50, clientY: 50 },
      { pointerType: 'mouse', clientX: 56, clientY: 50 },
    ]),
    'drag'
  );
});

test('8. hapticPattern and 40 ms throttle helper', () => {
  assert.equal(hapticPattern('pick'), 8);
  assert.equal(hapticPattern('drop'), 12);
  assert.equal(hapticPattern('capture'), 20);
  assert.deepEqual(hapticPattern('illegal'), [10, 30, 10]);
  assert.deepEqual(hapticPattern('check'), [30, 40, 30]);
  assert.deepEqual(hapticPattern('gameover'), [60, 60, 60, 60, 120]);
  assert.equal(hapticPattern('unknown'), null);

  const allow = createHapticThrottle(40);
  assert.equal(allow(100), true);
  assert.equal(allow(120), false);
  assert.equal(allow(139), false);
  assert.equal(allow(140), true);
  assert.equal(allow(160), false);
  assert.equal(allow(200), true);
});
