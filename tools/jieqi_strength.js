/**
 * Step 4: Cờ Úp (Jieqi) AI Strength & Speed Benchmark (tools/jieqi_strength.js).
 * Runs 6 seeded games per pairing (colors swapped, 200-ply cap, 40% time budget)
 * plus legality, no-peeking, and move-time budget sanity checks.
 */
import { JieqiBoard, JieqiRules } from '../js/jieqi/rules.js';
import { searchJieqiBestMove } from '../js/ai/jieqiSearch.js';
import { getJieqiLevel } from '../js/ai/levelsJieqi.js';
import { RED, BLACK } from '../js/model/piece.js';
import { GameStatus } from '../js/rules.js';

const TIME_SCALE = 0.4;
const MAX_PLIES = 200;
const FILES = 'abcdefghi';
const rules = new JieqiRules();

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function isLegal(board, iccs) {
  if (!iccs || iccs.length !== 4) return false;
  const { from, to } = parseIccs(iccs);
  const p = board.at(from);
  if (!p || p.side !== board.sideToMove) return false;
  return rules.legalMoves(board, from).some((m) => m.x === to.x && m.y === to.y);
}

function scaledLevel(levelId) {
  const base = getJieqiLevel(levelId);
  return {
    ...base,
    timeMs: Math.max(40, Math.round(base.timeMs * TIME_SCALE)),
  };
}

const statsByLevel = {};
function recordTime(levelId, ms, budgetMs) {
  if (!statsByLevel[levelId]) {
    statsByLevel[levelId] = { moves: 0, totalMs: 0, maxMs: 0, budgetMs };
  }
  const s = statsByLevel[levelId];
  s.moves++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
}

let illegalCount = 0;
let selfCheckCount = 0;

function playMatch(redLevelId, blackLevelId, seed) {
  const board = new JieqiBoard({ seed });
  const redCfg = scaledLevel(redLevelId);
  const blackCfg = scaledLevel(blackLevelId);

  let plies = 0;
  while (plies < MAX_PLIES) {
    const st = rules.status(board, board.sideToMove);
    if (st === GameStatus.Checkmate || st === GameStatus.Stalemate) {
      return { winner: board.sideToMove === RED ? BLACK : RED, plies, reason: st };
    }
    if (st === GameStatus.DrawRepetition || st === GameStatus.DrawNoCapture) {
      return { winner: null, plies, reason: st };
    }

    const side = board.sideToMove;
    const lvlId = side === RED ? redLevelId : blackLevelId;
    const cfg = side === RED ? redCfg : blackCfg;

    const t0 = performance.now();
    const res = searchJieqiBestMove(board.publicFen(), {
      level: lvlId,
      timeMs: cfg.timeMs,
      seed: seed * 1000 + plies,
    });
    const elapsed = performance.now() - t0;
    recordTime(lvlId, elapsed, cfg.timeMs);

    if (!res || !res.move || !isLegal(board, res.move)) {
      illegalCount++;
      return { winner: side === RED ? BLACK : RED, plies, reason: 'illegal' };
    }
    const { from, to } = parseIccs(res.move);
    board.applyMove(from, to);
    if (rules.isInCheck(board, side)) {
      selfCheckCount++;
    }
    plies++;
  }
  return { winner: null, plies, reason: 'cap' };
}

// 1. No-peeking sanity check
const b1 = new JieqiBoard({ seed: 111 });
const b2 = new JieqiBoard({ seed: 999 });
const r1 = searchJieqiBestMove(b1.publicFen(), { level: 'nghiep-du', timeMs: 240, seed: 4242 });
const r2 = searchJieqiBestMove(b2.publicFen(), { level: 'nghiep-du', timeMs: 240, seed: 4242 });
const noPeekOk = r1.move === r2.move && r1.score === r2.score;

// 2. Pairings (6 seeded games each, colors swapped)
const pairings = [
  ['nghiep-du', 'tap-su'],
  ['cao-thu', 'nghiep-du'],
  ['dai-su', 'cao-thu'],
];

console.log(`Cờ Úp AI Benchmark (timeScale=${TIME_SCALE}, 6 games/pairing, cap=${MAX_PLIES} plies)\n`);
console.log('| Pairing (Strong vs Weak) | Strong W | Draw | Weak W | Avg Plies |');
console.log('|---|---:|---:|---:|---:|');

for (const [strong, weak] of pairings) {
  let wStrong = 0;
  let wWeak = 0;
  let draws = 0;
  let totalPlies = 0;

  for (let g = 0; g < 6; g++) {
    const strongIsRed = g % 2 === 0;
    const res = playMatch(strongIsRed ? strong : weak, strongIsRed ? weak : strong, 300 + g * 17);
    totalPlies += res.plies;
    if (!res.winner) {
      draws++;
    } else if ((res.winner === RED && strongIsRed) || (res.winner === BLACK && !strongIsRed)) {
      wStrong++;
    } else {
      wWeak++;
    }
  }
  console.log(`| ${strong} vs ${weak} | ${wStrong} | ${draws} | ${wWeak} | ${(totalPlies / 6).toFixed(1)} |`);
}

console.log('\n| Level | Moves | Budget (40%) | Avg ms | Max ms | Max/Budget |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [lvl, s] of Object.entries(statsByLevel)) {
  const avg = s.totalMs / Math.max(1, s.moves);
  console.log(
    `| ${lvl} | ${s.moves} | ${s.budgetMs} ms | ${avg.toFixed(1)} | ${s.maxMs.toFixed(1)} | ${(s.maxMs / s.budgetMs).toFixed(2)}x |`
  );
}

console.log(`\nSanity: illegal=${illegalCount}, selfCheck=${selfCheckCount}, noPeek=${noPeekOk}`);
if (illegalCount > 0 || selfCheckCount > 0 || !noPeekOk) {
  process.exit(1);
}
