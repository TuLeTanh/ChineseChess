import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../js/model/board.js';
import { START_FEN } from '../js/model/fen.js';
import { RED, BLACK } from '../js/model/piece.js';
import { XiangqiRules } from '../js/rules.js';

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function listAllLegalMoves(board, rules) {
  const out = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (!p || p.side !== board.sideToMove) continue;
      for (const to of rules.legalMoves(board, { x, y })) {
        out.push({ from: { x, y }, to });
      }
    }
  }
  return out;
}

test('1. 100 random legal plies: viewFen(i) and capturedByAt(side, i) match step-by-step replay', () => {
  const rules = new XiangqiRules();
  const rand = makeRng(20261124);
  const board = Board.fromFen(START_FEN);

  const expectedFens = [board.toFen()];
  const expectedCapRed = [[]];
  const expectedCapBlack = [[]];

  for (let ply = 1; ply <= 100; ply++) {
    const moves = listAllLegalMoves(board, rules);
    if (moves.length === 0) break;
    const mv = moves[Math.floor(rand() * moves.length)];
    board.applyMove(mv.from, mv.to);
    expectedFens.push(board.toFen());
    expectedCapRed.push(board.capturedBy(RED).map((p) => `${p.side}:${p.kind}`));
    expectedCapBlack.push(board.capturedBy(BLACK).map((p) => `${p.side}:${p.kind}`));
  }

  const total = board.history.length;
  assert.ok(total >= 50, `Expected at least 50 plies played, got ${total}`);
  assert.equal(board.snapshots.length, total + 1);

  for (let i = 0; i <= total; i++) {
    assert.equal(board.viewFen(i), expectedFens[i], `viewFen mismatch at ply ${i}`);
    assert.deepEqual(
      board.capturedByAt(RED, i).map((p) => `${p.side}:${p.kind}`),
      expectedCapRed[i],
      `capturedByAt(RED) mismatch at ply ${i}`
    );
    assert.deepEqual(
      board.capturedByAt(BLACK, i).map((p) => `${p.side}:${p.kind}`),
      expectedCapBlack[i],
      `capturedByAt(BLACK) mismatch at ply ${i}`
    );
  }
});

test('2. truncateTo(i) then continue is 100% consistent with undo()', () => {
  const rules = new XiangqiRules();
  const rand = makeRng(424242);
  const bTrunc = Board.fromFen(START_FEN);
  const bUndo = Board.fromFen(START_FEN);

  for (let ply = 0; ply < 30; ply++) {
    const moves = listAllLegalMoves(bTrunc, rules);
    if (moves.length === 0) break;
    const mv = moves[Math.floor(rand() * moves.length)];
    bTrunc.applyMove(mv.from, mv.to);
    bUndo.applyMove(mv.from, mv.to);
  }

  const cut = 12;
  const removed = bTrunc.truncateTo(cut);
  for (let k = 0; k < removed; k++) bUndo.undo();

  assert.equal(bTrunc.history.length, cut);
  assert.equal(bTrunc.toFen(), bUndo.toFen());
  assert.equal(bTrunc.halfmoveClock, bUndo.halfmoveClock);
  assert.equal(bTrunc.fullmoveNumber, bUndo.fullmoveNumber);
  assert.deepEqual(bTrunc.positionHistory, bUndo.positionHistory);

  // Play 6 more moves from truncated state and confirm both boards stay identical
  for (let ply = 0; ply < 6; ply++) {
    const moves = listAllLegalMoves(bTrunc, rules);
    if (moves.length === 0) break;
    const mv = moves[Math.floor(rand() * moves.length)];
    bTrunc.applyMove(mv.from, mv.to);
    bUndo.applyMove(mv.from, mv.to);
  }

  assert.equal(bTrunc.toFen(), bUndo.toFen());
  assert.equal(bTrunc.viewFen(cut), bUndo.viewFen(cut));
  assert.equal(bTrunc.snapshots.length, bTrunc.history.length + 1);
});
