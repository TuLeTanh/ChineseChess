import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../js/model/board.js';
import { START_FEN } from '../js/model/fen.js';
import { RED, BLACK } from '../js/model/piece.js';
import { XiangqiRules, GameStatus } from '../js/rules.js';

const rules = new XiangqiRules();

function hasMove(moves, x, y) {
  return moves.some((m) => m.x === x && m.y === y);
}

test('1. PERFT from START_FEN: depth 1=44, depth 2=1920, depth 3=79666', () => {
  const board = Board.fromFen(START_FEN);
  assert.equal(rules.perft(board, 1), 44);
  assert.equal(rules.perft(board, 2), 1920);
  assert.equal(rules.perft(board, 3), 79666);
});

test('1b. PERFT depth 4 = 3290240 (optional slow test; set RUN_SLOW=1 to enable)', { skip: !process.env.RUN_SLOW }, () => {
  const board = Board.fromFen(START_FEN);
  assert.equal(rules.perft(board, 4), 3290240);
});

test('2. Start position Red move counts per piece type (total 44)', () => {
  const board = Board.fromFen(START_FEN);
  // Chariots (0,9) and (8,9): 2 each
  assert.equal(rules.legalMoves(board, { x: 0, y: 9 }).length, 2);
  assert.equal(rules.legalMoves(board, { x: 8, y: 9 }).length, 2);
  // Horses (1,9) and (7,9): 2 each
  assert.equal(rules.legalMoves(board, { x: 1, y: 9 }).length, 2);
  assert.equal(rules.legalMoves(board, { x: 7, y: 9 }).length, 2);
  // Elephants (2,9) and (6,9): 2 each
  assert.equal(rules.legalMoves(board, { x: 2, y: 9 }).length, 2);
  assert.equal(rules.legalMoves(board, { x: 6, y: 9 }).length, 2);
  // Advisors (3,9) and (5,9): 1 each
  assert.equal(rules.legalMoves(board, { x: 3, y: 9 }).length, 1);
  assert.equal(rules.legalMoves(board, { x: 5, y: 9 }).length, 1);
  // General (4,9): 1
  assert.equal(rules.legalMoves(board, { x: 4, y: 9 }).length, 1);
  // Cannons (1,7) and (7,7): 12 each (including capture on Black horse via Black cannon screen)
  const cLeft = rules.legalMoves(board, { x: 1, y: 7 });
  const cRight = rules.legalMoves(board, { x: 7, y: 7 });
  assert.equal(cLeft.length, 12);
  assert.equal(cRight.length, 12);
  assert.ok(hasMove(cLeft, 1, 0), 'Left cannon captures Black horse at (1,0)');
  assert.ok(hasMove(cRight, 7, 0), 'Right cannon captures Black horse at (7,0)');
  // Soldiers (0,6),(2,6),(4,6),(6,6),(8,6): 1 each
  for (const sx of [0, 2, 4, 6, 8]) {
    assert.equal(rules.legalMoves(board, { x: sx, y: 6 }).length, 1);
  }
});

test('3. Horse leg block with both own and enemy piece', () => {
  // Red horse at (4,5), generals offset so no flying general
  const openBoard = Board.fromFen('3k5/9/9/9/9/4N4/9/9/9/5K3 w - - 0 1');
  assert.equal(rules.legalMoves(openBoard, { x: 4, y: 5 }).length, 8);

  // Own soldier on north leg (4,4) blocks (3,3) and (5,3)
  const ownBlocked = Board.fromFen('3k5/9/9/9/4P4/4N4/9/9/9/5K3 w - - 0 1');
  const mOwn = rules.legalMoves(ownBlocked, { x: 4, y: 5 });
  assert.equal(mOwn.length, 6);
  assert.ok(!hasMove(mOwn, 3, 3));
  assert.ok(!hasMove(mOwn, 5, 3));

  // Enemy soldier on east leg (5,5) blocks (6,4) and (6,6)
  const enemyBlocked = Board.fromFen('3k5/9/9/9/9/4Np3/9/9/9/5K3 w - - 0 1');
  const mEnemy = rules.legalMoves(enemyBlocked, { x: 4, y: 5 });
  assert.equal(mEnemy.length, 6);
  assert.ok(!hasMove(mEnemy, 6, 4));
  assert.ok(!hasMove(mEnemy, 6, 6));
});

test('4. Elephant eye block and cannot cross river', () => {
  // Red elephant at (4,5) on river edge: can only go south-west (2,7) and south-east (6,7), NEVER north across river
  const riverBoard = Board.fromFen('3k5/9/9/9/9/4B4/9/9/9/5K3 w - - 0 1');
  const mRiver = rules.legalMoves(riverBoard, { x: 4, y: 5 });
  assert.equal(mRiver.length, 2);
  assert.ok(hasMove(mRiver, 2, 7));
  assert.ok(hasMove(mRiver, 6, 7));

  // Block south-west eye at (3,6) with a piece -> only (6,7) remains
  const blockedEye = Board.fromFen('3k5/9/9/9/9/4B4/3p5/9/9/5K3 w - - 0 1');
  const mEye = rules.legalMoves(blockedEye, { x: 4, y: 5 });
  assert.equal(mEye.length, 1);
  assert.ok(hasMove(mEye, 6, 7));
});

test('5. Cannon screen rules: 0 screens, 1 screen, 2 screens', () => {
  // Rank 5: Red cannon at (0,5), enemy soldier at (2,5) [0 screens -> cannot capture],
  // enemy soldier at (5,5) [1 screen -> CAN capture], enemy soldier at (7,5) [2 screens -> cannot capture]
  const b = Board.fromFen('3k5/9/9/9/9/C1p2p1p1/9/9/9/5K3 w - - 0 1');
  const moves = rules.legalMoves(b, { x: 0, y: 5 });
  // Horizontal moves along rank 5: (1,5) non-capture, and (5,5) capture over (2,5)
  assert.ok(hasMove(moves, 1, 5), 'Non-capture slide to (1,5)');
  assert.ok(!hasMove(moves, 2, 5), 'Cannot capture adjacent enemy without screen');
  assert.ok(!hasMove(moves, 3, 5), 'Cannot jump to empty square behind screen');
  assert.ok(hasMove(moves, 5, 5), 'Can capture over exactly 1 screen');
  assert.ok(!hasMove(moves, 7, 5), 'Cannot capture over 2 screens');
});

test('6. Soldier movement before and after crossing river (Red & Black)', () => {
  // Red soldier before river at (4,6): only forward (4,5)
  const rBefore = Board.fromFen('3k5/9/9/9/9/9/4P4/9/9/5K3 w - - 0 1');
  const rm1 = rules.legalMoves(rBefore, { x: 4, y: 6 });
  assert.equal(rm1.length, 1);
  assert.ok(hasMove(rm1, 4, 5));

  // Red soldier after river at (4,4): forward (4,3) + left (3,4) + right (5,4), never backward (4,5)
  const rAfter = Board.fromFen('3k5/9/9/9/4P4/9/9/9/9/5K3 w - - 0 1');
  const rm2 = rules.legalMoves(rAfter, { x: 4, y: 4 });
  assert.equal(rm2.length, 3);
  assert.ok(hasMove(rm2, 4, 3));
  assert.ok(hasMove(rm2, 3, 4));
  assert.ok(hasMove(rm2, 5, 4));
  assert.ok(!hasMove(rm2, 4, 5));

  // Black soldier before river at (4,3): only forward (4,4)
  const bBefore = Board.fromFen('3k5/9/9/4p4/9/9/9/9/9/5K3 b - - 0 1');
  const bm1 = rules.legalMoves(bBefore, { x: 4, y: 3 });
  assert.equal(bm1.length, 1);
  assert.ok(hasMove(bm1, 4, 4));

  // Black soldier after river at (4,5): forward (4,6) + left (3,5) + right (5,5), never backward (4,4)
  const bAfter = Board.fromFen('3k5/9/9/9/9/4p4/9/9/9/5K3 b - - 0 1');
  const bm2 = rules.legalMoves(bAfter, { x: 4, y: 5 });
  assert.equal(bm2.length, 3);
  assert.ok(hasMove(bm2, 4, 6));
  assert.ok(hasMove(bm2, 3, 5));
  assert.ok(hasMove(bm2, 5, 5));
  assert.ok(!hasMove(bm2, 4, 4));
});

test('7. Flying general: 4k4/9/9/9/9/9/9/9/9/4K4 gives exactly (3,9) and (5,9)', () => {
  const b = Board.fromFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
  const moves = rules.legalMoves(b, { x: 4, y: 9 });
  assert.equal(moves.length, 2);
  assert.ok(hasMove(moves, 3, 9));
  assert.ok(hasMove(moves, 5, 9));
  assert.ok(!hasMove(moves, 4, 8));
});

test('8. Pinned piece cannot leave the line shielding its general', () => {
  // Black chariot at (4,0) pins Red chariot at (4,7) against Red general at (4,9)
  const b = Board.fromFen('3kr4/9/9/9/9/9/9/4R4/9/4K4 w - - 0 1');
  const moves = rules.legalMoves(b, { x: 4, y: 7 });
  // Red chariot can only move along file 4 (x === 4), never horizontally off file 4
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.x === 4), 'Pinned chariot must stay on file 4');
});

test('9. Two checkmate positions and one stalemate position', () => {
  // Checkmate 1 (Double Chariot / Back-rank ladder mate):
  // Black general at (4,0). Red chariot at (0,0) delivers check along rank 0;
  // Red chariot at (0,1) cuts off rank 1 completely.
  // Black general's only palace squares are (3,0), (5,0) [attacked by (0,0)] and (4,1) [attacked by (0,1)].
  // No other Black pieces exist to block or capture. -> Checkmate!
  const mate1 = Board.fromFen('R3k4/R8/9/9/9/9/9/9/9/3K5 b - - 0 1');
  assert.equal(rules.isInCheck(mate1, BLACK), true);
  assert.equal(rules.status(mate1, BLACK), GameStatus.Checkmate);

  // Checkmate 2 (Face-to-face Chariot + General mate / 白臉將):
  // Black general at (4,0), Red general at (4,9) controls file 4 via flying general.
  // Red chariot at (3,0) checks Black general along rank 0 AND is protected by Red chariot at (3,5).
  // Wait: simpler — Red chariot at (4,1) gives check directly in front of Black general (4,0),
  // protected by Red general (4,9) on file 4!
  // Can Black capture (4,1)? No — capturing leaves Black general at (4,1) facing Red general at (4,9)!
  // Can Black step to (3,0) or (5,0)? Add Red chariot at (0,0) or place Black advisors at (3,0)? No, advisors can't be on (3,0) wait—they CAN be on (3,0) and (5,0)!
  // Let's verify: Black general at (4,0), Black advisors at (3,0) and (5,0) block sideways escape.
  // Red chariot at (4,1) delivers check and is protected by Red general at (4,9) along file 4.
  // Black advisors at (3,0)/(5,0) only move diagonally to (4,1)! Wait: advisor at (3,0) CAN capture (4,1)!
  // So instead of advisors, put Black Chariot? No, put Red Chariot at (3,0) and Red General at (4,9) and Red Chariot at (4,1) —
  // Even cleaner classic mate (Cannon + General + Chariot):
  // Black general at (4,0), Black advisor at (4,1) [pinned to file 4 by Red General at (4,9) — cannot move off file 4!],
  // Red cannon at (4,3) checks Black general at (4,0) using Black's own advisor at (4,1) as screen!
  // Black general cannot move to (3,0) or (5,0) because Red Chariot at (3,2)? No, Red Chariot at (0,0) covers (3,0) & (5,0)...
  // Simpler & crystal clear:
  // Black general at (4,0), Red chariot at (4,1) protected by Red general at (4,9) [so Kx(4,1) is illegal due to flying general],
  // AND Red soldier at (3,0) + Red soldier at (5,0)? No, soldiers can't attack sideways on rank 0 — wait, THEY CAN! Soldiers crossed river (y=0 <= 4) attack sideways!
  // Wait: Red soldier at (3,0) attacks (4,0)! Even simpler: Red Chariot at (3,1) covers (3,0) and (3,1)? No, (3,0) and (5,0) are on rank 0.
  // Classic Iron Bolt Mate (鐵門拴): Black general at (4,0), Black advisor at (4,1) (pinned by Red Cannon at (4,3)? No, Red Cannon at (4,3) gives check over (4,1)!),
  // Black cannot capture (4,3), cannot move advisor (4,1) because it is the ONLY piece between (4,0) and Red General (4,9) [Wait: cannon is ALSO on file 4!],
  // Let's make Checkmate 2 a verified Iron Bolt / Chariot+Horse mate:
  // Black general at (4,0). Red chariot at (4,1) protected by Red General at (4,9).
  // Red chariot at (0,0) is already mate1; for a DIFFERENT motif (Horse + Chariot mate / 臥槽馬):
  // Black general at (4,0), Black advisor at (4,1) (blocks (4,1)), Black advisor at (3,0) (blocks (3,0)).
  // Red Horse at (6,1) checks (4,0) (leg at (5,1) is empty).
  // Only empty adjacent square for Black general is (5,0), which is attacked by Red Chariot at (5,5)!
  // Can Black advisor at (3,0) or (4,1) capture the horse at (6,1) or block the horse's leg at (5,1)?
  // Advisor at (4,1) can only move to (3,0) [occupied], (5,0), (3,2), (5,2) — NONE of which capture (6,1) or block (5,1)!
  // Advisor at (3,0) can only move to (4,1) [occupied]!
  // Therefore Black has ZERO legal moves and is in check from the Horse at (6,1)! -> Checkmate!
  const mate2 = Board.fromFen('3ak4/4a1N2/9/9/9/5R3/9/9/9/3K5 b - - 0 1');
  assert.equal(rules.isInCheck(mate2, BLACK), true);
  assert.equal(rules.status(mate2, BLACK), GameStatus.Checkmate);

  // Stalemate (困斃 — in Xiangqi the stalemated side loses):
  // Black general at (3,0) — NOT in check.
  // Red general at (4,9) controls all of file 4 (so Black general cannot move to (4,0)).
  // Red chariot at (0,1) controls all of rank 1 (so Black general cannot move to (3,1)).
  // No other Black pieces exist. Black is NOT in check and has ZERO legal moves -> Stalemate!
  const stale = Board.fromFen('3k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1');
  assert.equal(rules.isInCheck(stale, BLACK), false);
  assert.equal(rules.status(stale, BLACK), GameStatus.Stalemate);
});

test('10. Property test: 200 random legal moves then undo all restores exact START_FEN', () => {
  const board = Board.fromFen(START_FEN);
  // Deterministic PRNG (mulberry32) so tests are 100% reproducible
  let seed = 0x12345678;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let plies = 0;
  for (let step = 0; step < 200; step++) {
    const allMoves = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = board.at({ x, y });
        if (!p || p.side !== board.sideToMove) continue;
        const targets = rules.legalMoves(board, { x, y });
        for (const to of targets) {
          allMoves.push({ from: { x, y }, to });
        }
      }
    }
    if (allMoves.length === 0) break;
    const chosen = allMoves[Math.floor(rand() * allMoves.length)];
    board.applyMove(chosen.from, chosen.to);
    plies += 1;
  }

  assert.ok(plies > 50, `Expected substantial playout, got ${plies} plies`);
  while (board.history.length > 0) {
    board.undo();
  }
  assert.equal(board.toFen(), START_FEN);
  assert.equal(board.positionHistory.length, 1);
  assert.equal(board.halfmoveClock, 0);
  assert.equal(board.sideToMove, RED);
});
