import test from 'node:test';
import assert from 'node:assert/strict';
import { JieqiBoard, JieqiRules, makeSeededRng } from '../js/jieqi/rules.js';
import { searchJieqiBestMove } from '../js/ai/jieqiSearch.js';
import { RED, BLACK } from '../js/model/piece.js';

const rules = new JieqiRules();
const FILES = 'abcdefghi';

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function allLegalIccs(board) {
  const out = new Set();
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (!p || p.side !== board.sideToMove) continue;
      for (const to of rules.legalMoves(board, { x, y })) {
        out.add(`${FILES[x]}${9 - y}${FILES[to.x]}${9 - to.y}`);
      }
    }
  }
  return out;
}

test('1. AI returns a legal move on 100 random Jieqi positions', () => {
  const rng = makeSeededRng(2026);
  let tested = 0;
  for (let g = 0; g < 15 && tested < 100; g++) {
    const b = new JieqiBoard({ seed: 500 + g });
    for (let ply = 0; ply < 8 && tested < 100; ply++) {
      const legal = allLegalIccs(b);
      if (legal.size === 0) break;
      const res = searchJieqiBestMove(b.publicFen(), {
        level: { samples: 2, depth: 1, timeMs: 30, noiseCp: 0 },
        seed: 1000 + tested,
      });
      assert.ok(res.move && legal.has(res.move), `illegal move ${res.move} on pos ${tested}`);
      tested++;

      const arr = [...legal];
      const pick = parseIccs(arr[Math.floor(rng() * arr.length)]);
      b.applyMove(pick.from, pick.to);
    }
  }
  assert.equal(tested, 100);
});

test('2. AI finds mate-in-1 on 3 Jieqi puzzles', () => {
  const validPuzzles = [
    // Puzzle A: Double chariot capture mate (R at 0,1 x 4,1 supported by R at 4,2)
    {
      name: 'Back-rank double chariot mate',
      fen: '3nkn3/R3n4/4R4/9/9/9/9/9/9/3K5 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0',
    },
    // Puzzle B: Chariot captures blocking advisor on (4,1) supported by Red general at (4,9)
    {
      name: 'Chariot capture mate',
      fen: '3nkn3/4n4/4R4/9/9/9/9/9/9/4K4 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0',
    },
    // Puzzle C: Chariot supported by free-roaming revealed Advisor at (3,2)
    {
      name: 'Chariot supported by revealed Advisor mate',
      fen: '3nkn3/R8/3A5/9/9/9/9/9/9/3K5 w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0',
    },
  ];

  for (const pz of validPuzzles) {
    const b = JieqiBoard.fromPublicFen(pz.fen);
    const res = searchJieqiBestMove(b.publicFen(), {
      level: { samples: 2, depth: 2, timeMs: 300, noiseCp: 0 },
      seed: 42,
    });
    assert.ok(res.move, `${pz.name}: expected a move`);
    const { from, to } = parseIccs(res.move);
    b.applyMove(from, to);
    const st = rules.status(b, b.sideToMove);
    assert.equal(st, 'checkmate', `${pz.name}: move ${res.move} should be checkmate, got ${st}`);
  }
});

test('3. 4-game self-play smoke test (Nghiệp dư vs Tập sự)', () => {
  for (let g = 0; g < 4; g++) {
    const b = new JieqiBoard({ seed: 700 + g });
    let plies = 0;
    while (plies < 20) {
      const st = rules.status(b, b.sideToMove);
      if (st === 'checkmate' || st === 'stalemate') break;
      const lvl =
        b.sideToMove === RED
          ? { samples: 2, depth: 2, timeMs: 120, noiseCp: 10 }
          : { samples: 1, depth: 1, timeMs: 60, noiseCp: 40 };
      const res = searchJieqiBestMove(b.publicFen(), { level: lvl, seed: 800 + g * 100 + plies });
      assert.ok(res.move, `game ${g} ply ${plies}: AI returned null`);
      const { from, to } = parseIccs(res.move);
      const mv = b.applyMove(from, to);
      assert.ok(mv);
      plies++;
    }
    assert.ok(plies >= 10);
  }
});

test('4. NO-PEEKING: identical publicFen + identical seed => identical AI move despite different secrets', () => {
  const b1 = new JieqiBoard({ seed: 101 });
  const b2 = new JieqiBoard({ seed: 909 });
  assert.notDeepEqual([...b1._secret.entries()], [...b2._secret.entries()]);
  assert.equal(b1.publicFen(), b2.publicFen());

  const r1 = searchJieqiBestMove(b1.publicFen(), { level: 'tap-su', seed: 5555 });
  const r2 = searchJieqiBestMove(b2.publicFen(), { level: 'tap-su', seed: 5555 });
  assert.equal(r1.move, r2.move);
  assert.equal(r1.score, r2.score);
});
