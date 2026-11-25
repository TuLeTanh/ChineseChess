/**
 * Perfect-Information Monte Carlo (PIMC) alpha-beta engine for Cờ Úp (Jieqi).
 * Pure module (zero DOM/window access; runs in Node tests and Web Worker).
 *
 * SECURITY / FAIRNESS INVARIANT:
 * Input is strictly PUBLIC state (`publicFen` + `pool`). It NEVER receives `secret`.
 * Each sampled world randomly assigns remaining pool identities to covered pieces
 * using a seeded RNG, runs alpha-beta search with Jieqi rules (including reveal-on-move),
 * and averages root move centipawn scores across K worlds.
 */
import { RED, BLACK, oppositeSide } from '../model/piece.js';
import { moveToIccs } from '../model/moves.js';
import {
  JieqiBoard,
  JieqiRules,
  NON_GENERAL_KINDS,
  poolToArray,
  makeSeededRng,
  shuffleArray,
} from '../jieqi/rules.js';
import { getJieqiLevel } from './levelsJieqi.js';

const PIECE_VALUES = {
  general: 10000,
  chariot: 900,
  cannon: 450,
  horse: 420,
  elephant: 260, // Stronger in Jieqi (can cross river)
  advisor: 240,  // Stronger in Jieqi (free diagonal anywhere)
  soldier: 140,
};

const MATE_SCORE = 29000;
const INF = 100000;

const rules = new JieqiRules();

function avgPoolValue(poolSide) {
  let sum = 0;
  let count = 0;
  for (const k of NON_GENERAL_KINDS) {
    const n = poolSide[k] || 0;
    sum += n * PIECE_VALUES[k];
    count += n;
  }
  return count > 0 ? sum / count : 240;
}

/**
 * Evaluate a JieqiBoard from `sideToMove`'s perspective.
 * Covered pieces are valued at the average remaining pool value of their side.
 */
function evaluateJieqi(board, sideToMove) {
  const redAvg = avgPoolValue(board.pool[RED]);
  const blackAvg = avgPoolValue(board.pool[BLACK]);
  let scoreRed = 0;

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.grid[y][x];
      if (!p) continue;
      let val = 0;
      if (p.covered) {
        val = p.side === RED ? redAvg : blackAvg;
      } else {
        val = PIECE_VALUES[p.kind] || 100;
        // Center/advancement bonuses
        if (p.kind === 'soldier') {
          const crossed = p.side === RED ? y <= 4 : y >= 5;
          if (crossed) val += 85;
          val += (4 - Math.abs(4 - x)) * 8;
        } else if (p.kind === 'chariot' || p.kind === 'horse' || p.kind === 'cannon') {
          val += (4 - Math.abs(4 - x)) * 6;
        } else if (p.kind === 'advisor' || p.kind === 'elephant') {
          val += (4 - Math.abs(4 - x)) * 5;
        }
      }
      if (p.side === RED) scoreRed += val;
      else scoreRed -= val;
    }
  }

  return sideToMove === RED ? Math.round(scoreRed) : Math.round(-scoreRed);
}

function listOrderedLegalMoves(board, side) {
  const moves = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.grid[y][x];
      if (!p || p.side !== side) continue;
      const from = { x, y };
      const targets = rules.legalMoves(board, from);
      for (const to of targets) {
        const cap = board.grid[to.y][to.x];
        let order = 0;
        if (cap) order += 1000 + (PIECE_VALUES[cap.kind] || 200);
        if (p.covered) order += 80; // Slight preference to reveal covered pieces
        moves.push({ from, to, iccs: moveToIccs(from, to), order });
      }
    }
  }
  moves.sort((a, b) => b.order - a.order);
  return moves;
}

/**
 * Sample a consistent deterministic world from public FEN + pool.
 */
function sampleWorld(publicFen, seed) {
  const world = JieqiBoard.fromPublicFen(publicFen);
  for (const side of [RED, BLACK]) {
    const coveredSquares = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = world.grid[y][x];
        if (p && p.side === side && p.covered) {
          coveredSquares.push(`${x},${y}`);
        }
      }
    }
    const deck = shuffleArray(poolToArray(world.pool[side]), seed + (side === RED ? 17 : 53));
    world._secret = world._secret || new Map();
    for (let i = 0; i < coveredSquares.length; i++) {
      world._secret.set(coveredSquares[i], deck[i] || 'soldier');
    }
  }
  return world;
}

/**
 * Run PIMC search for Cờ Úp using PUBLIC state only.
 * @param {string} publicFen
 * @param {{ level?: string, timeMs?: number, seed?: number, onInfo?: (info: any) => void }} [opts]
 */
export function searchJieqiBestMove(publicFen, opts = {}) {
  const lvl = getJieqiLevel(opts.level || 'nghiep-du');
  const maxTimeMs = typeof opts.timeMs === 'number' ? opts.timeMs : lvl.timeMs;
  const seed = typeof opts.seed === 'number' ? opts.seed : 20261124;
  const rand = makeSeededRng(seed);
  const startTs = Date.now();

  const rootBoard = JieqiBoard.fromPublicFen(publicFen);
  const rootMoves = listOrderedLegalMoves(rootBoard, rootBoard.sideToMove);
  if (rootMoves.length === 0) {
    return { move: null, score: -MATE_SCORE, depth: 0, nodes: 0, pv: [] };
  }
  if (rootMoves.length === 1) {
    return { move: rootMoves[0].iccs, score: 0, depth: 1, nodes: 1, pv: [rootMoves[0].iccs] };
  }

  const numWorlds = Math.max(1, lvl.worlds);
  const perWorldBudget = Math.max(30, Math.floor(maxTimeMs / numWorlds));
  const moveScoreSums = new Map();
  const moveCounts = new Map();
  for (const m of rootMoves) {
    moveScoreSums.set(m.iccs, 0);
    moveCounts.set(m.iccs, 0);
  }

  let totalNodes = 0;
  let maxDepthReached = 1;

  for (let w = 0; w < numWorlds; w++) {
    if (Date.now() - startTs >= maxTimeMs && w > 0) break;
    const world = sampleWorld(publicFen, seed + w * 997);
    const worldDeadline = Date.now() + perWorldBudget;
    const checkMask = maxTimeMs < 300 ? 31 : 255;
    let aborted = false;

    const alphaBeta = (depth, alpha, beta, ply) => {
      totalNodes++;
      if ((totalNodes & checkMask) === 0 && Date.now() >= worldDeadline) {
        aborted = true;
        return 0;
      }

      const moves = listOrderedLegalMoves(world, world.sideToMove);
      if (moves.length === 0) {
        // Both checkmate and stalemate lose in Xiangqi/Jieqi
        return -MATE_SCORE + ply;
      }
      if (depth <= 0) {
        return evaluateJieqi(world, world.sideToMove);
      }

      let best = -INF;
      for (const mv of moves) {
        world.applyMove(mv.from, mv.to);
        const sc = -alphaBeta(depth - 1, -beta, -alpha, ply + 1);
        world.undo();
        if (aborted) return 0;
        if (sc > best) best = sc;
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) break;
      }
      return best;
    };

    // Iterative deepening per world
    let worldBestMap = new Map();
    const depthLimit = Math.min(lvl.maxDepth, 4); // Keep PIMC responsive in pure JS
    for (let d = 1; d <= depthLimit; d++) {
      aborted = false;
      const iterMap = new Map();
      for (const mv of rootMoves) {
        world.applyMove(mv.from, mv.to);
        const sc = -alphaBeta(d - 1, -INF, INF, 1);
        world.undo();
        if (aborted) break;
        iterMap.set(mv.iccs, sc);
      }
      if (!aborted && iterMap.size === rootMoves.length) {
        worldBestMap = iterMap;
        if (d > maxDepthReached) maxDepthReached = d;
      } else {
        break;
      }
    }

    if (worldBestMap.size === 0) {
      // Depth-1 fallback if time expired immediately
      for (const mv of rootMoves) {
        world.applyMove(mv.from, mv.to);
        const oppMoves = listOrderedLegalMoves(world, world.sideToMove);
        const sc = oppMoves.length === 0 ? MATE_SCORE - 1 : -evaluateJieqi(world, world.sideToMove);
        world.undo();
        worldBestMap.set(mv.iccs, sc);
      }
    }

    for (const [iccs, sc] of worldBestMap.entries()) {
      moveScoreSums.set(iccs, (moveScoreSums.get(iccs) || 0) + sc);
      moveCounts.set(iccs, (moveCounts.get(iccs) || 0) + 1);
    }

    if (opts.onInfo) {
      let bestMove = rootMoves[0].iccs;
      let bestAvg = -INF;
      for (const m of rootMoves) {
        const cnt = moveCounts.get(m.iccs) || 1;
        const avg = (moveScoreSums.get(m.iccs) || 0) / cnt;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestMove = m.iccs;
        }
      }
      opts.onInfo({
        depth: maxDepthReached,
        score: Math.round(bestAvg),
        nodes: totalNodes,
        pv: [bestMove],
      });
    }
  }

  // Aggregate & rank
  const ranked = rootMoves
    .map((m) => {
      const cnt = moveCounts.get(m.iccs) || 1;
      return {
        iccs: m.iccs,
        score: Math.round((moveScoreSums.get(m.iccs) || 0) / cnt),
      };
    })
    .sort((a, b) => b.score - a.score);

  let chosen = ranked[0];
  if (lvl.blunderChance > 0 && rand() < lvl.blunderChance && ranked.length > 1) {
    const cap = Math.min(ranked.length, 6);
    chosen = ranked[1 + Math.floor(rand() * (cap - 1))];
  } else if (lvl.randomTopK > 1 && lvl.randomWindowCp > 0 && chosen.score < MATE_SCORE - 100) {
    const pool = ranked
      .slice(0, lvl.randomTopK)
      .filter((r) => chosen.score - r.score <= lvl.randomWindowCp);
    if (pool.length > 0) {
      chosen = pool[Math.floor(rand() * pool.length)];
    }
  }

  return {
    move: chosen.iccs,
    score: chosen.score,
    depth: maxDepthReached,
    nodes: totalNodes,
    pv: [chosen.iccs],
  };
}
