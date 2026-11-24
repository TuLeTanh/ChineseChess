import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JieqiBoard,
  JieqiRules,
  NON_GENERAL_KINDS,
  REVEAL_ON_CAPTURE,
  makeSeededRng,
} from '../js/jieqi/rules.js';
import { RED, BLACK } from '../js/model/piece.js';
import { GameStatus } from '../js/rules.js';

const rules = new JieqiRules();

function allLegalMoves(board, side) {
  const out = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (!p || p.side !== side) continue;
      for (const to of rules.legalMoves(board, { x, y })) {
        out.push({ from: { x, y }, to });
      }
    }
  }
  return out;
}

function countCovered(board, side) {
  let n = 0;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (p && p.side === side && p.covered) n++;
    }
  }
  return n;
}

function sumPool(poolSide) {
  return NON_GENERAL_KINDS.reduce((acc, k) => acc + (poolSide[k] || 0), 0);
}

test('1. Initial position has 44 legal moves across 200 random shuffles (and 1920 at depth 2 with standard identity)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const b = new JieqiBoard({ seed });
    const moves1 = allLegalMoves(b, RED);
    assert.equal(moves1.length, 44, `seed=${seed} expected 44 opening moves`);
  }
  // When hidden identities match starting squares, depth-2 perft equals standard Xiangqi's 1920
  const base = new JieqiBoard({ seed: 1 });
  const stdSecret = new Map();
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = base.at({ x, y });
      if (p && p.covered) stdSecret.set(`${x},${y}`, p.kind);
    }
  }
  const bStd = new JieqiBoard({ secret: stdSecret });
  let ply2 = 0;
  for (const m of allLegalMoves(bStd, RED)) {
    bStd.applyMove(m.from, m.to);
    ply2 += allLegalMoves(bStd, BLACK).length;
    bStd.undo();
  }
  assert.equal(ply2, 1920, 'expected 1920 depth-2 moves');
});

test('2. Covered piece moves by fake-type regardless of hidden identity', () => {
  // Put a hidden chariot on Red's elephant square (2,9) and hidden soldier on Red's chariot square (0,9)
  const secret = new Map();
  const base = new JieqiBoard({ seed: 7 });
  for (const [k, v] of base._secret.entries()) secret.set(k, v);
  secret.set('2,9', 'chariot');
  secret.set('0,9', 'soldier');
  const b = new JieqiBoard({ secret });

  // Covered piece at (2,9) must move as elephant (0,7) and (4,7), NOT as chariot
  const eleMoves = rules.legalMoves(b, { x: 2, y: 9 }).map((m) => `${m.x},${m.y}`).sort();
  assert.deepEqual(eleMoves, ['0,7', '4,7']);

  // Covered piece at (0,9) must move as chariot (0,8) and (0,7), NOT as soldier
  const chMoves = rules.legalMoves(b, { x: 0, y: 9 }).map((m) => `${m.x},${m.y}`).sort();
  assert.deepEqual(chMoves, ['0,7', '0,8']);
});

test('3. Reveal works for all 6 non-general piece types and updates pool', () => {
  for (const kind of NON_GENERAL_KINDS) {
    const base = new JieqiBoard({ seed: 11 });
    const secret = new Map(base._secret);
    secret.set('0,6', kind); // Red left soldier square
    const b = new JieqiBoard({ secret });
    const beforePool = b.pool[RED][kind];
    const move = b.applyMove({ x: 0, y: 6 }, { x: 0, y: 5 });
    assert.ok(move.wasCovered);
    assert.equal(move.reveal.type, kind);
    const landed = b.at({ x: 0, y: 5 });
    assert.equal(landed.covered, false);
    assert.equal(landed.kind, kind);
    assert.equal(b.pool[RED][kind], beforePool - 1);
  }
});

test('4. Revealed Advisor moves diagonally anywhere; revealed Elephant crosses river with eye block', () => {
  const b = JieqiBoard.fromPublicFen('3k5/9/9/9/4A4/9/9/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  const advMoves = rules.legalMoves(b, { x: 4, y: 4 }).map((m) => `${m.x},${m.y}`).sort();
  assert.deepEqual(advMoves, ['3,3', '3,5', '5,3', '5,5']);

  // Revealed Red Elephant at (2,5) can cross river to (0,3) and (4,3), unless eye is blocked
  const b2 = JieqiBoard.fromPublicFen('3k5/9/9/9/3p5/2B6/9/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  const eleMoves = rules.legalMoves(b2, { x: 2, y: 5 }).map((m) => `${m.x},${m.y}`).sort();
  // (4,3) is blocked by black soldier at eye (3,4); (0,3), (0,7), (4,7) are open
  assert.deepEqual(eleMoves, ['0,3', '0,7', '4,7']);
});

test('5. Revealed Soldier moves forward only on own side, forward + sideways past river, never backward', () => {
  const ownSide = JieqiBoard.fromPublicFen('3k5/9/9/9/9/9/2P6/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  assert.deepEqual(
    rules.legalMoves(ownSide, { x: 2, y: 6 }).map((m) => `${m.x},${m.y}`),
    ['2,5']
  );

  const crossed = JieqiBoard.fromPublicFen('3k5/9/9/9/2P6/9/9/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  assert.deepEqual(
    rules.legalMoves(crossed, { x: 2, y: 4 }).map((m) => `${m.x},${m.y}`).sort(),
    ['1,4', '2,3', '3,4']
  );
});

test('6. General stays in palace, flying general forbidden, check & checkmate detected', () => {
  // Flying general: Red advisor at (4,5) cannot move away exposing facing generals
  const b = JieqiBoard.fromPublicFen('4k4/9/9/9/9/4A4/9/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  assert.equal(rules.legalMoves(b, { x: 4, y: 5 }).length, 0);

  // Checkmate: Black general at (4,0), Red chariots at (3,0) and (3,1), Red general at (4,9)
  const mate = JieqiBoard.fromPublicFen('3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0');
  assert.equal(rules.isInCheck(mate, BLACK), true);
  assert.equal(rules.status(mate, BLACK), GameStatus.Checkmate);
});

test('7. Legality is independent of hidden identity across 300 positions x 5 secrets', () => {
  const rng = makeSeededRng(4242);
  let checkedPositions = 0;

  for (let game = 0; game < 30 && checkedPositions < 300; game++) {
    const b = new JieqiBoard({ seed: 100 + game });
    for (let ply = 0; ply < 12 && checkedPositions < 300; ply++) {
      const pubFen = b.publicFen();
      const baseMoves = allLegalMoves(b, b.sideToMove)
        .map((m) => `${m.from.x},${m.from.y}-${m.to.x},${m.to.y}`)
        .sort();
      if (baseMoves.length === 0) break;

      // Test 5 different secret assignments on the same public position
      for (let s = 0; s < 5; s++) {
        const clone = JieqiBoard.fromPublicFen(pubFen);
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 9; x++) {
            const p = clone.at({ x, y });
            if (p && p.covered) {
              clone._secret.set(`${x},${y}`, NON_GENERAL_KINDS[(x + y + s) % NON_GENERAL_KINDS.length]);
            }
          }
        }
        const m2 = allLegalMoves(clone, clone.sideToMove)
          .map((m) => `${m.from.x},${m.from.y}-${m.to.x},${m.to.y}`)
          .sort();
        assert.deepEqual(m2, baseMoves);
      }

      checkedPositions++;
      const pick = allLegalMoves(b, b.sideToMove)[Math.floor(rng() * baseMoves.length)];
      b.applyMove(pick.from, pick.to);
    }
  }
  assert.equal(checkedPositions, 300);
});

test('8. Capture reveal & pool conservation invariant throughout random play', () => {
  assert.equal(REVEAL_ON_CAPTURE, true);
  const rng = makeSeededRng(999);
  const b = new JieqiBoard({ seed: 77 });

  for (let ply = 0; ply < 80; ply++) {
    assert.equal(sumPool(b.pool[RED]), countCovered(b, RED));
    assert.equal(sumPool(b.pool[BLACK]), countCovered(b, BLACK));

    const moves = allLegalMoves(b, b.sideToMove);
    if (moves.length === 0) break;
    const pick = moves[Math.floor(rng() * moves.length)];
    const targetBefore = b.at(pick.to);
    const mv = b.applyMove(pick.from, pick.to);

    if (targetBefore && targetBefore.covered) {
      assert.ok(mv.capturedWasCovered);
      assert.ok(mv.capturedReveal);
      assert.equal(mv.captured.covered, false);
    }
    assert.equal(sumPool(b.pool[RED]), countCovered(b, RED));
    assert.equal(sumPool(b.pool[BLACK]), countCovered(b, BLACK));
  }
});

test('9. 300-ply undo round-trip restores publicFen, pool, and secret map identically', () => {
  const rng = makeSeededRng(12345);
  const b = new JieqiBoard({ seed: 300 });
  const initialFen = b.publicFen();
  const initialSecret = new Map(b._secret);

  let plies = 0;
  for (let i = 0; i < 300; i++) {
    const moves = allLegalMoves(b, b.sideToMove);
    if (moves.length === 0) break;
    const pick = moves[Math.floor(rng() * moves.length)];
    b.applyMove(pick.from, pick.to);
    plies++;
  }
  assert.ok(plies > 20, `expected >20 plies played, got ${plies}`);

  while (b.history.length > 0) {
    b.undo();
  }
  assert.equal(b.publicFen(), initialFen);
  assert.deepEqual([...b._secret.entries()].sort(), [...initialSecret.entries()].sort());
});

test('10. NO-PEEKING: publicFen() and snapshots never contain secret map entries', () => {
  const b1 = new JieqiBoard({ seed: 1 });
  const b2 = new JieqiBoard({ seed: 99999 });
  assert.notDeepEqual([...b1._secret.entries()], [...b2._secret.entries()]);
  assert.equal(b1.publicFen(), b2.publicFen());
  assert.equal(JSON.stringify(b1.snapshots), JSON.stringify(b2.snapshots));
});
