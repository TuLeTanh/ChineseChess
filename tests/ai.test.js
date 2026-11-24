import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../js/model/board.js';
import { START_FEN } from '../js/model/fen.js';
import { RED, BLACK } from '../js/model/piece.js';
import { XiangqiRules, GameStatus, boardToCells } from '../js/rules.js';
import { perftFast } from '../js/ai/movegen.js';
import { searchBestMove, XiangqiEngine } from '../js/ai/search.js';

const rules = new XiangqiRules();
const FILES = 'abcdefghi';

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function isLegalIccs(board, iccs) {
  if (!iccs || iccs.length !== 4) return false;
  const { from, to } = parseIccs(iccs);
  const p = board.at(from);
  if (!p || p.side !== board.sideToMove) return false;
  const legal = rules.legalMoves(board, from);
  return legal.some((m) => m.x === to.x && m.y === to.y);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('1. Fast movegen matches XiangqiRules PERFT (44 / 1920 / 79666)', () => {
  const board = Board.fromFen(START_FEN);
  const cells = boardToCells(board);
  assert.equal(perftFast(cells, 1, 1), 44);
  assert.equal(perftFast(cells, 1, 2), 1920);
  assert.equal(perftFast(cells, 1, 3), 79666);
});

test('2. Engine returns only legal moves across 100 random positions (Tập sự & depth 3)', () => {
  const rand = makeRng(202604);
  for (let i = 0; i < 100; i++) {
    const board = Board.fromFen(START_FEN);
    const plies = 6 + Math.floor(rand() * 25); // 6..30 plies
    for (let p = 0; p < plies; p++) {
      const all = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 9; x++) {
          const piece = board.at({ x, y });
          if (!piece || piece.side !== board.sideToMove) continue;
          for (const to of rules.legalMoves(board, { x, y })) {
            all.push({ from: { x, y }, to });
          }
        }
      }
      if (all.length === 0) break;
      const pick = all[Math.floor(rand() * all.length)];
      board.applyMove(pick.from, pick.to);
    }

    const status = rules.status(board, board.sideToMove);
    if (status === GameStatus.Checkmate || status === GameStatus.Stalemate) continue;

    const fen = board.toFen();
    const resTapSu = searchBestMove(fen, { level: 'tap-su', seed: i + 1 });
    assert.ok(isLegalIccs(board, resTapSu.move), `Illegal Tập sự move ${resTapSu.move} in ${fen}`);

    const resD3 = searchBestMove(fen, { maxDepth: 3, timeMs: 300, level: 'cao-thu', seed: i + 1000 });
    assert.ok(isLegalIccs(board, resD3.move), `Illegal depth-3 move ${resD3.move} in ${fen}`);
  }
});

test('3. Mate-in-1 puzzles (Double Chariot, Horse + Chariot, Chariot + Cannon)', () => {
  // Puzzle A (Double Chariot ladder mate):
  // Black General at (4,0), Red Chariot at (0,1) cuts off rank 1.
  // Red Chariot at (1,2) slides to (1,0) delivering mate on rank 0.
  const fenA = '4k4/R8/1R7/9/9/9/9/9/9/3K5 w - - 0 1';

  // Puzzle B (Horse + Chariot mate / 臥槽馬):
  // Black General at (4,0), Black Advisors at (3,0) and (4,1) block (3,0) and (4,1).
  // Red Chariot at (5,5) controls all of file 5 (so (5,0) is attacked).
  // Red Horse at (7,3) jumps to (6,1) [leg (6,2) empty], checking (4,0) [leg (5,1) empty]!
  // Neither advisor can capture (6,1) or block (5,1) -> Checkmate!
  const fenB = '3ak4/4a4/9/7N1/9/5R3/9/9/9/3K5 w - - 0 1';

  // Puzzle C (Chariot + Cannon mate):
  // Black General at (4,0), Black Advisor at (4,1) is pinned by Red Cannon on file 4?
  // Even cleaner: Red Cannon at (4,4) already aims at (4,0) using Black's Advisor at (4,1) as screen?
  // Wait: if Cannon is ALREADY at (4,4) then Black would already be in check on Red's turn!
  // Instead, Red Cannon is at (2,4) and slides to (4,4) (c5e5#) to check (4,0) over Black's Advisor at (4,1),
  // while Red Chariot at (3,5) covers file 3 and Red Chariot at (5,5) covers file 5?
  // Even cleaner (1 Chariot + 1 Cannon): Black General at (4,0), Black Advisors at (3,0) and (5,0) block sideways escape.
  // Red Chariot at (0,1) covers (4,1), and Red Cannon at (2,4) slides to (4,4) to check (4,0) over Red Chariot?
  // Wait: Chariot at (0,1) is on file 0, not file 4. Put Red Chariot at (4,1) [protected by Red General at (4,9) via flying general? No, Cannon is on file 4 too].
  // Cleanest Chariot + Cannon mate-in-1 (重炮 / 天地炮 style):
  // Black General at (4,0), Black Advisor at (3,0) and Black Advisor at (5,0) block (3,0) and (5,0).
  // Red Chariot at (4,2) is NOT yet checking because Black Soldier? No, put Red Chariot at (0,1) covering rank 1 (including (4,1))
  // and Black Cannon at (4,1)? No, put Red Soldier at (4,1) (protected by Red General at (4,9) -> Kx(4,1) illegal? No, Cannon blocks flying general).
  // Put Red Chariot at (3,1) covering rank 1 (so (4,1) is attacked), Red Advisor? No:
  // Black General at (4,0), Red Chariot at (4,1) [Wait: if Red Chariot is at (4,1), Black is already in check].
  // Therefore the MOVING piece must deliver check!
  // Black General at (4,0), Black Advisors at (3,0) and (5,0), Black Elephant at (4,2) [cannot move to (4,1), only diagonals].
  // Red Chariot at (0,1) covers rank 1 (so Black General cannot step to (4,1)).
  // Red Cannon at (2,5) moves to (4,5) -> checks (4,0) over Black Elephant at (4,2)!
  // Can Black Elephant at (4,2) move away? Yes, (4,2) could move to (2,0) or (6,0) to remove the screen!
  // To prevent the screen from moving, make the screen a RED Chariot at (4,1)?? No, then Chariot already checks.
  // Make the screen a BLACK Advisor at (4,1) when Black General is at (4,0) AND Red Chariot at (3,5) covers file 3 AND Red Chariot? No, 1 Chariot + 1 Cannon:
  // Put Black General at (3,0) (corner of palace), Red General at (4,9) (controls file 4 so General cannot move to (4,0)),
  // Black Advisor at (3,1) is NOT a valid advisor square! Valid Black advisor squares are (3,0),(5,0),(4,1),(3,2),(5,2).
  // Put Black General at (4,0), Black Advisors at (3,0) and (5,0), Red Cannon at (4,5) [NOT checking yet because NO screen on file 4!],
  // Red Chariot at (0,1) slides to (4,1) -> Chariot checks (4,0) AND creates a Cannon battery (double check)!
  // Black General cannot take (4,1) (protected by Cannon? No, Cannon doesn't protect without screen; wait: if Red General is at (4,9), Red Chariot at (4,1) IS protected by Red General? No, Cannon at (4,5) is in between!).
  // Ah! Put Red Cannon at (0,0) [aiming along rank 0], Black Advisor at (3,0) [screen!], Red Chariot at (0,1) covers rank 1!
  // Before Red's move: Red Cannon is at (0,2), slides to (0,0) -> checks (4,0) over Black's own Advisor at (3,0)!
  // Black General at (4,0) has:
  //   - (3,0) occupied by Black Advisor (pinned? If Advisor at (3,0) moves to (4,1), Cannon at (0,0) no longer has a screen! Wait: (4,1) IS attacked by Red Chariot at (0,1), so Advisor moving to (4,1) is legal and blocks? No, it removes the screen so it would resolve check!).
  // How to stop Advisor at (3,0) from moving to (4,1)? Put Red Chariot AT (4,1)?? No, then Chariot already checks.
  // Put a Black piece at (4,1) that cannot move off (4,1) — wait: Red Chariot at (4,5) pins Black Advisor at (4,1) to (4,0)!!
  // YES!! CHECK THIS BEAUTY:
  // - Black General at (4,0)
  // - Black Advisors at (3,0) and (4,1)
  // - Red Chariot at (4,5) pins Black Advisor at (4,1) along file 4 (Advisor at (4,1) CANNOT move off file 4 or Chariot attacks General!)
  // - Red General at (5,9) controls file 5 (so Black General CANNOT step to (5,0) due to flying general!)
  // - Red Cannon at (0,2) slides to (0,0) (a7a9#): checks (4,0) along rank 0 using Black's Advisor at (3,0) as screen!
  //   - Can (3,0) move to (4,1)? Occupied by Black Advisor at (4,1)!
  //   - Can (4,1) move? Pinned to file 4 by Red Chariot at (4,5)!
  //   - Can Black General move to (3,0)? Occupied. (4,1)? Occupied. (5,0)? Flying general with Red General at (5,9)!
  //   -> 100% PURE CHARIOT + CANNON MATE IN 1!
  // Add a Black Soldier at (8,3) so Black is not already stalemated — a7a9 is the UNIQUE mate-in-1!
  const fenC = '3ak4/4a4/C8/8p/9/4R4/9/9/9/5K3 w - - 0 1';

  for (const [label, fen] of [
    ['Double Chariot', fenA],
    ['Horse + Chariot', fenB],
    ['Chariot + Cannon', fenC],
  ]) {
    const board = Board.fromFen(fen);
    const res = searchBestMove(fen, { maxDepth: 3, timeMs: 1500, level: 'cao-thu' });
    assert.ok(res.move, `${label}: engine must return a move`);
    const { from, to } = parseIccs(res.move);
    board.applyMove(from, to);
    assert.equal(
      rules.status(board, BLACK),
      GameStatus.Checkmate,
      `${label}: move ${res.move} must deliver checkmate`
    );
  }
});

test('4. Material win: captures hanging Black Chariot', () => {
  // Red Chariot at (4,6) can immediately capture undefended Black Chariot at (4,3)
  const fen = '3k5/9/9/4r4/9/9/4R4/9/9/5K3 w - - 0 1';
  const res = searchBestMove(fen, { maxDepth: 3, timeMs: 1000, level: 'cao-thu' });
  assert.equal(res.move, 'e3e6', `Expected capture e3e6, got ${res.move}`);
});

test('5. Search speed at depth 5 from START_FEN (> 30k nps)', async () => {
  const engine = new XiangqiEngine();
  const res = await engine.bestMove(START_FEN, { maxDepth: 5, timeMs: 15000, level: 'cao-thu' });
  console.log(`  [Depth 5 START_FEN] move=${res.move} depth=${res.depth} score=${res.score} nodes=${res.nodes} nps=${res.nps}`);
  assert.ok(res.depth >= 5, `Expected depth 5, got ${res.depth}`);
  assert.ok(res.nps > 30000, `Expected > 30,000 nps, got ${res.nps}`);
});

test('6. Self-play smoke test: Nghiệp dư vs Tập sự (4 seeded games, max 150 plies)', () => {
  const results = [];
  for (let g = 0; g < 4; g++) {
    const board = Board.fromFen(START_FEN);
    const nghiepDuSide = g % 2 === 0 ? RED : BLACK;
    let outcome = 'MaxPlies';
    let plies = 0;

    for (let ply = 0; ply < 150; ply++) {
      const st = rules.status(board, board.sideToMove);
      if (st === GameStatus.Checkmate || st === GameStatus.Stalemate) {
        const winner = board.sideToMove === RED ? 'Black' : 'Red';
        outcome = `${winner} (${st})`;
        break;
      }
      if (st === GameStatus.DrawRepetition || st === GameStatus.DrawNoCapture) {
        outcome = `Draw (${st})`;
        break;
      }

      const levelId = board.sideToMove === nghiepDuSide ? 'nghiep-du' : 'tap-su';
      const res = searchBestMove(board.toFen(), {
        level: levelId,
        timeMs: levelId === 'nghiep-du' ? 120 : 60,
        history: board.positionHistory,
        seed: 700 + g * 1000 + ply,
      });
      assert.ok(isLegalIccs(board, res.move), `Illegal self-play move ${res.move} at game ${g + 1} ply ${ply}`);
      const { from, to } = parseIccs(res.move);
      board.applyMove(from, to);
      plies++;
    }
    results.push({
      game: g + 1,
      red: nghiepDuSide === RED ? 'Nghiệp dư' : 'Tập sự',
      black: nghiepDuSide === BLACK ? 'Nghiệp dư' : 'Tập sự',
      plies,
      outcome,
    });
  }

  console.log('  | Game | Red | Black | Plies | Result |');
  console.log('  |---|---|---|---:|---|');
  for (const r of results) {
    console.log(`  | ${r.game} | ${r.red} | ${r.black} | ${r.plies} | ${r.outcome} |`);
  }
  assert.equal(results.length, 4);
});

test('7. Edge cases: < 4 legal moves never throws; 1 legal move returns instantly', () => {
  // Only 2 legal moves for Red General at (4,9) facing Black General at (4,0): (3,9) and (5,9)
  const twoMovesFen = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
  const r2 = searchBestMove(twoMovesFen, { level: 'tap-su', seed: 42 });
  assert.ok(['e0d0', 'e0f0'].includes(r2.move));

  // Exactly 1 legal move: Red General at (3,9), Black Chariot at (0,8) cuts off rank 8,
  // Black General at (4,0) cuts off file 4 -> wait: if Red General is at (3,9), only (4,9) is in palace on rank 9,
  // and (3,8) is attacked by Chariot at (0,8). Instead put Black General at (5,0) and Red General at (3,9) -> only (4,9) is legal!
  const oneMoveFen = '5k3/9/9/9/9/9/9/9/r8/3K5 w - - 0 1';
  const r1 = searchBestMove(oneMoveFen, { level: 'dai-su', seed: 1 });
  assert.equal(r1.move, 'd0e0');
  assert.equal(r1.nodes, 1, 'Single legal move must return immediately without searching');
});
