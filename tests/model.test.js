import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../js/model/board.js';
import { START_FEN } from '../js/model/fen.js';
import { RED, BLACK } from '../js/model/piece.js';
import { PermissiveRules } from '../js/rules.js';

test('START_FEN round-trip and key starting coordinates', () => {
  const board = Board.fromFen(START_FEN);
  assert.equal(board.toFen(), START_FEN);

  // Red General on file 五 (x=4, y=9), Black General at (x=4, y=0)
  assert.deepEqual(board.at({ x: 4, y: 9 }), { kind: 'general', side: RED });
  assert.deepEqual(board.at({ x: 4, y: 0 }), { kind: 'general', side: BLACK });

  // Red Cannons at (1,7) and (7,7)
  assert.deepEqual(board.at({ x: 1, y: 7 }), { kind: 'cannon', side: RED });
  assert.deepEqual(board.at({ x: 7, y: 7 }), { kind: 'cannon', side: RED });
});

test('applyMove + undo restores exact board including captures', () => {
  const board = Board.fromFen(START_FEN);
  const initialFen = board.toFen();

  // Move Red Cannon h2 -> e2 (x=7,y=7 -> x=4,y=7)
  const m1 = board.applyMove({ x: 7, y: 7 }, { x: 4, y: 7 });
  assert.ok(m1);
  assert.equal(m1.iccs, 'h2e2');
  assert.equal(m1.captured, null);
  assert.equal(board.sideToMove, BLACK);

  // Capture Black Soldier at (4,3) using Red Cannon at (4,7)
  const m2 = board.applyMove({ x: 4, y: 7 }, { x: 4, y: 3 });
  assert.ok(m2);
  assert.deepEqual(m2.captured, { kind: 'soldier', side: BLACK });
  assert.equal(board.capturedBy(RED).length, 1);

  // Undo capture
  const u2 = board.undo();
  assert.ok(u2);
  assert.deepEqual(board.at({ x: 4, y: 3 }), { kind: 'soldier', side: BLACK });
  assert.deepEqual(board.at({ x: 4, y: 7 }), { kind: 'cannon', side: RED });
  assert.equal(board.capturedBy(RED).length, 0);

  // Undo first move
  const u1 = board.undo();
  assert.ok(u1);
  assert.equal(board.toFen(), initialFen);
  assert.equal(board.history.length, 0);
});

test('PermissiveRules allows all squares not occupied by own side', () => {
  const board = Board.fromFen(START_FEN);
  const rules = new PermissiveRules();
  const targets = rules.legalMoves(board, { x: 4, y: 9 });
  // 90 total squares - 16 Red pieces = 74 targets
  assert.equal(targets.length, 74);
});
