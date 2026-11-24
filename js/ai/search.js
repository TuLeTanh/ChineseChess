/**
 * Offline Xiangqi AI search engine (pure JS, zero DOM, importable in Node and Web Worker).
 * - Negamax with alpha-beta pruning & iterative deepening
 * - 64-bit Zobrist hashing (two Uint32s, BigInt-free) + 2^20 replace-by-depth Transposition Table
 * - Move ordering: TT hash move, MVV-LVA captures, 2 killer moves/ply, history heuristic
 * - Quiescence search on captures (max 6 plies) + check extension (+1 ply)
 * - Mate/stalemate score: -30000 + ply (stalemate loses in Xiangqi)
 * - Repetition draw detection inside search + root avoidance when ahead in material
 * - Deterministic seeded RNG for lower difficulty levels
 */
import { Engine } from '../engine.js';
import { Board } from '../model/board.js';
import { RED } from '../model/piece.js';
import { moveToIccs } from '../model/moves.js';
import { boardToCells } from '../rules.js';
import { PIECE_VALUE, evaluatePosition } from './eval.js';
import { genPseudoMoves, isGeneralAttacked } from './movegen.js';
import { getAiLevel } from './levels.js';

const INF = 32000;
const MATE_SCORE = 30000;
const MAX_PLY = 40;
const MAX_QS_DEPTH = 6;

const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

// ---------------------------------------------------------------------------
// 64-bit Zobrist keys (two 32-bit unsigned ints, deterministic PRNG)
// Piece index 0..14 maps code (-7..+7) + 7
// ---------------------------------------------------------------------------
const ZOB_HI = new Uint32Array(15 * 90);
const ZOB_LO = new Uint32Array(15 * 90);
let ZOB_SIDE_HI = 0;
let ZOB_SIDE_LO = 0;

(function initZobrist() {
  let s = 0x9e3779b9;
  const nextU32 = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  for (let i = 0; i < ZOB_HI.length; i++) {
    ZOB_HI[i] = nextU32();
    ZOB_LO[i] = nextU32();
  }
  ZOB_SIDE_HI = nextU32();
  ZOB_SIDE_LO = nextU32();
})();

function hashPosition(cells, sideSign) {
  let hi = sideSign === -1 ? ZOB_SIDE_HI : 0;
  let lo = sideSign === -1 ? ZOB_SIDE_LO : 0;
  for (let sq = 0; sq < 90; sq++) {
    const p = cells[sq];
    if (p !== 0) {
      const idx = (p + 7) * 90 + sq;
      hi = (hi ^ ZOB_HI[idx]) >>> 0;
      lo = (lo ^ ZOB_LO[idx]) >>> 0;
    }
  }
  return { hi, lo };
}

function hashFenKey(fenKey) {
  const board = Board.fromFen(`${fenKey} - - 0 1`);
  const cells = boardToCells(board);
  return hashPosition(cells, board.sideToMove === RED ? 1 : -1);
}

/**
 * Create a deterministic mulberry32 RNG.
 * @param {number} seed
 * @returns {() => number}
 */
function makeSeededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert encoded 16-bit move `(from << 7) | to` to ICCS string (e.g. "h2e2").
 * @param {number} mv
 * @returns {string}
 */
export function moveToString(mv) {
  const from = mv >> 7;
  const to = mv & 127;
  const fx = from % 9;
  const fy = (from - fx) / 9;
  const tx = to % 9;
  const ty = (to - tx) / 9;
  return moveToIccs({ x: fx, y: fy }, { x: tx, y: ty });
}

// ---------------------------------------------------------------------------
// Transposition Table (2^20 entries, replace-by-depth)
// ---------------------------------------------------------------------------
class TranspositionTable {
  constructor(bits = 20) {
    this.size = 1 << bits;
    this.mask = this.size - 1;
    this.keyHi = new Uint32Array(this.size);
    this.keyLo = new Uint32Array(this.size);
    this.depth = new Int8Array(this.size);
    this.flag = new Uint8Array(this.size);
    this.score = new Int16Array(this.size);
    this.move = new Uint16Array(this.size);
  }

  clear() {
    this.flag.fill(0);
    this.depth.fill(0);
  }

  store(hi, lo, depth, flag, score, bestMove, ply) {
    const idx = lo & this.mask;
    if (this.flag[idx] !== 0 && this.depth[idx] > depth && (this.keyHi[idx] !== hi || this.keyLo[idx] !== lo)) {
      return; // replace-by-depth
    }
    let storedScore = score;
    if (storedScore > MATE_SCORE - 100) storedScore += ply;
    else if (storedScore < -MATE_SCORE + 100) storedScore -= ply;

    this.keyHi[idx] = hi;
    this.keyLo[idx] = lo;
    this.depth[idx] = depth;
    this.flag[idx] = flag;
    this.score[idx] = storedScore;
    if (bestMove) this.move[idx] = bestMove;
  }

  probe(hi, lo) {
    const idx = lo & this.mask;
    if (this.flag[idx] !== 0 && this.keyHi[idx] === hi && this.keyLo[idx] === lo) {
      return idx;
    }
    return -1;
  }
}

// Reusable search workspace so repeated searches allocate almost nothing
const FULL_TT = new TranspositionTable(20);
const SMALL_TT = new TranspositionTable(14);
const MOVE_STACK = new Int32Array(MAX_PLY * 140);
const SCORE_STACK = new Int32Array(MAX_PLY * 140);
const KILLER1 = new Int32Array(MAX_PLY);
const KILLER2 = new Int32Array(MAX_PLY);
const HISTORY_RED = new Int32Array(90 * 90);
const HISTORY_BLK = new Int32Array(90 * 90);
const PATH_HI = new Uint32Array(256);
const PATH_LO = new Uint32Array(256);

/**
 * Core synchronous/iterative-deepening search runner.
 * @param {string} fen
 * @param {{
 *   level?: string | import('./levels.js').AiLevel,
 *   maxDepth?: number,
 *   timeMs?: number,
 *   history?: string[],
 *   seed?: number,
 *   shouldStop?: () => boolean,
 *   onInfo?: (info: { depth: number, score: number, nodes: number, pv: string[] }) => void,
 * }} [options]
 * @returns {{ move: string | null, score: number, depth: number, nodes: number, nps: number, pv: string[] }}
 */
export function searchBestMove(fen, options = {}) {
  const levelCfg =
    typeof options.level === 'string'
      ? getAiLevel(options.level)
      : options.level || getAiLevel('nghiep-du');

  const maxDepth = options.maxDepth ?? levelCfg.maxDepth;
  const timeMs = options.timeMs ?? levelCfg.timeMs;
  const shouldStop = options.shouldStop || (() => false);
  const onInfo = options.onInfo || null;
  const rng = options.seed !== undefined ? makeSeededRng(options.seed) : Math.random;

  const board = Board.fromFen(fen);
  const cells = boardToCells(board);
  const rootSide = board.sideToMove === RED ? 1 : -1;
  const rootHash = hashPosition(cells, rootSide);

  const tt = levelCfg.useFullTT ? FULL_TT : SMALL_TT;
  if (!levelCfg.useFullTT) tt.clear();
  KILLER1.fill(0);
  KILLER2.fill(0);
  HISTORY_RED.fill(0);
  HISTORY_BLK.fill(0);

  // Build game repetition map from positionHistory (array of FEN position keys)
  const historyCounts = new Map();
  if (Array.isArray(options.history)) {
    for (const key of options.history) {
      const h = hashFenKey(key);
      const tag = `${h.hi}:${h.lo}`;
      historyCounts.set(tag, (historyCounts.get(tag) || 0) + 1);
    }
  }

  // Generate legal root moves
  const rootPseudoEnd = genPseudoMoves(cells, rootSide, MOVE_STACK, 0, false);
  const rootMoves = [];
  for (let i = 0; i < rootPseudoEnd; i++) {
    const mv = MOVE_STACK[i];
    const from = mv >> 7;
    const to = mv & 127;
    const piece = cells[from];
    const cap = cells[to];
    cells[to] = piece;
    cells[from] = 0;
    if (!isGeneralAttacked(cells, rootSide)) {
      rootMoves.push(mv);
    }
    cells[from] = piece;
    cells[to] = cap;
  }

  if (rootMoves.length === 0) {
    return { move: null, score: -MATE_SCORE, depth: 0, nodes: 0, nps: 0, pv: [] };
  }
  if (rootMoves.length === 1) {
    return {
      move: moveToString(rootMoves[0]),
      score: evaluatePosition(cells, rootSide),
      depth: 1,
      nodes: 1,
      nps: 1000,
      pv: [moveToString(rootMoves[0])],
    };
  }

  const startTime = performance.now();
  const deadline = startTime + Math.max(10, timeMs);
  let nodes = 0;
  let aborted = false;

  const checkAbort = () => {
    if ((nodes & 2047) === 0) {
      if (shouldStop() || performance.now() >= deadline) {
        aborted = true;
      }
    }
    return aborted;
  };

  function scoreMove(mv, ttMove, ply, sideSign) {
    if (mv === ttMove) return 1000000;
    const to = mv & 127;
    const victim = cells[to];
    if (victim !== 0) {
      const from = mv >> 7;
      const attacker = cells[from];
      const vVal = PIECE_VALUE[victim > 0 ? victim : -victim];
      const aVal = PIECE_VALUE[attacker > 0 ? attacker : -attacker];
      return 100000 + vVal * 16 - aVal;
    }
    if (mv === KILLER1[ply]) return 80000;
    if (mv === KILLER2[ply]) return 70000;
    const hist = sideSign === 1 ? HISTORY_RED : HISTORY_BLK;
    return hist[(mv >> 7) * 90 + to];
  }

  function pickNextMove(start, end) {
    let bestIdx = start;
    let bestScore = SCORE_STACK[start];
    for (let i = start + 1; i < end; i++) {
      if (SCORE_STACK[i] > bestScore) {
        bestScore = SCORE_STACK[i];
        bestIdx = i;
      }
    }
    if (bestIdx !== start) {
      const tm = MOVE_STACK[start];
      MOVE_STACK[start] = MOVE_STACK[bestIdx];
      MOVE_STACK[bestIdx] = tm;
      const ts = SCORE_STACK[start];
      SCORE_STACK[start] = SCORE_STACK[bestIdx];
      SCORE_STACK[bestIdx] = ts;
    }
    return MOVE_STACK[start];
  }

  function quiesce(alpha, beta, sideSign, ply, qDepth, stackOffset) {
    nodes++;
    if (checkAbort()) return 0;

    const standPat = evaluatePosition(cells, sideSign);
    if (qDepth <= 0 || ply >= MAX_PLY - 1) return standPat;
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const end = genPseudoMoves(cells, sideSign, MOVE_STACK, stackOffset, true);
    for (let i = stackOffset; i < end; i++) {
      SCORE_STACK[i] = scoreMove(MOVE_STACK[i], 0, ply, sideSign);
    }

    for (let i = stackOffset; i < end; i++) {
      const mv = pickNextMove(i, end);
      const from = mv >> 7;
      const to = mv & 127;
      const piece = cells[from];
      const cap = cells[to];

      cells[to] = piece;
      cells[from] = 0;
      if (isGeneralAttacked(cells, sideSign)) {
        cells[from] = piece;
        cells[to] = cap;
        continue;
      }

      const score = -quiesce(-beta, -alpha, -sideSign, ply + 1, qDepth - 1, end);
      cells[from] = piece;
      cells[to] = cap;

      if (aborted) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, sideSign, ply, hashHi, hashLo, stackOffset) {
    nodes++;
    if (checkAbort()) return 0;

    // Repetition detection against search path
    if (ply > 0) {
      for (let i = ply - 2; i >= 0; i -= 2) {
        if (PATH_HI[i] === hashHi && PATH_LO[i] === hashLo) {
          return 0;
        }
      }
    }

    const inCheck = isGeneralAttacked(cells, sideSign);
    if (inCheck && ply < MAX_PLY - 4) {
      depth += 1; // Check extension
    }

    if (depth <= 0 || ply >= MAX_PLY - 1) {
      return quiesce(alpha, beta, sideSign, ply, MAX_QS_DEPTH, stackOffset);
    }

    const origAlpha = alpha;
    let ttMove = 0;
    const ttIdx = tt.probe(hashHi, hashLo);
    if (ttIdx !== -1) {
      ttMove = tt.move[ttIdx];
      if (tt.depth[ttIdx] >= depth && ply > 0) {
        let ttScore = tt.score[ttIdx];
        if (ttScore > MATE_SCORE - 100) ttScore -= ply;
        else if (ttScore < -MATE_SCORE + 100) ttScore += ply;
        const flag = tt.flag[ttIdx];
        if (flag === TT_EXACT) return ttScore;
        if (flag === TT_LOWER && ttScore > alpha) alpha = ttScore;
        else if (flag === TT_UPPER && ttScore < beta) beta = ttScore;
        if (alpha >= beta) return ttScore;
      }
    }

    PATH_HI[ply] = hashHi;
    PATH_LO[ply] = hashLo;

    const end = genPseudoMoves(cells, sideSign, MOVE_STACK, stackOffset, false);
    for (let i = stackOffset; i < end; i++) {
      SCORE_STACK[i] = scoreMove(MOVE_STACK[i], ttMove, ply, sideSign);
    }

    let bestScore = -INF;
    let bestMove = 0;
    let legalCount = 0;

    for (let i = stackOffset; i < end; i++) {
      const mv = pickNextMove(i, end);
      const from = mv >> 7;
      const to = mv & 127;
      const piece = cells[from];
      const cap = cells[to];

      cells[to] = piece;
      cells[from] = 0;
      if (isGeneralAttacked(cells, sideSign)) {
        cells[from] = piece;
        cells[to] = cap;
        continue;
      }
      legalCount++;

      // Incremental Zobrist update
      const pIdxFrom = (piece + 7) * 90 + from;
      const pIdxTo = (piece + 7) * 90 + to;
      let nextHi = (hashHi ^ ZOB_HI[pIdxFrom] ^ ZOB_HI[pIdxTo] ^ ZOB_SIDE_HI) >>> 0;
      let nextLo = (hashLo ^ ZOB_LO[pIdxFrom] ^ ZOB_LO[pIdxTo] ^ ZOB_SIDE_LO) >>> 0;
      if (cap !== 0) {
        const cIdx = (cap + 7) * 90 + to;
        nextHi = (nextHi ^ ZOB_HI[cIdx]) >>> 0;
        nextLo = (nextLo ^ ZOB_LO[cIdx]) >>> 0;
      }

      const score = -negamax(depth - 1, -beta, -alpha, -sideSign, ply + 1, nextHi, nextLo, end);
      cells[from] = piece;
      cells[to] = cap;

      if (aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = mv;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (cap === 0) {
              if (KILLER1[ply] !== mv) {
                KILLER2[ply] = KILLER1[ply];
                KILLER1[ply] = mv;
              }
              const hist = sideSign === 1 ? HISTORY_RED : HISTORY_BLK;
              hist[from * 90 + to] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legalCount === 0) {
      // Both checkmate and stalemate lose in Xiangqi
      return -MATE_SCORE + ply;
    }

    let flag = TT_EXACT;
    if (bestScore <= origAlpha) flag = TT_UPPER;
    else if (bestScore >= beta) flag = TT_LOWER;
    tt.store(hashHi, hashLo, depth, flag, bestScore, bestMove, ply);

    return bestScore;
  }

  function extractPv(maxLen) {
    const pv = [];
    const seen = new Set();
    let curHi = rootHash.hi;
    let curLo = rootHash.lo;
    let side = rootSide;
    const undoList = [];

    for (let step = 0; step < maxLen; step++) {
      const tag = `${curHi}:${curLo}`;
      if (seen.has(tag)) break;
      seen.add(tag);
      const idx = tt.probe(curHi, curLo);
      if (idx === -1 || !tt.move[idx]) break;
      const mv = tt.move[idx];
      const from = mv >> 7;
      const to = mv & 127;
      const piece = cells[from];
      if (piece * side <= 0) break;
      const cap = cells[to];
      cells[to] = piece;
      cells[from] = 0;
      if (isGeneralAttacked(cells, side)) {
        cells[from] = piece;
        cells[to] = cap;
        break;
      }
      undoList.push([from, to, piece, cap]);
      pv.push(moveToString(mv));
      const pIdxFrom = (piece + 7) * 90 + from;
      const pIdxTo = (piece + 7) * 90 + to;
      curHi = (curHi ^ ZOB_HI[pIdxFrom] ^ ZOB_HI[pIdxTo] ^ ZOB_SIDE_HI) >>> 0;
      curLo = (curLo ^ ZOB_LO[pIdxFrom] ^ ZOB_LO[pIdxTo] ^ ZOB_SIDE_LO) >>> 0;
      if (cap !== 0) {
        const cIdx = (cap + 7) * 90 + to;
        curHi = (curHi ^ ZOB_HI[cIdx]) >>> 0;
        curLo = (curLo ^ ZOB_LO[cIdx]) >>> 0;
      }
      side = -side;
    }

    for (let i = undoList.length - 1; i >= 0; i--) {
      const [from, to, piece, cap] = undoList[i];
      cells[from] = piece;
      cells[to] = cap;
    }
    return pv;
  }

  // Iterative deepening at root
  const rootEval = evaluatePosition(cells, rootSide);
  let completedDepth = 0;
  let bestMove = rootMoves[0];
  let bestScore = -INF;
  /** @type {{ mv: number, score: number }[]} */
  let lastRootScored = rootMoves.map((mv) => ({ mv, score: 0 }));

  PATH_HI[0] = rootHash.hi;
  PATH_LO[0] = rootHash.lo;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    const beta = INF;
    let iterBestMove = 0;
    let iterBestScore = -INF;
    const iterScored = [];

    // Order root moves by previous iteration's scores
    lastRootScored.sort((a, b) => b.score - a.score);

    for (let i = 0; i < lastRootScored.length; i++) {
      const mv = lastRootScored[i].mv;
      const from = mv >> 7;
      const to = mv & 127;
      const piece = cells[from];
      const cap = cells[to];

      cells[to] = piece;
      cells[from] = 0;

      const pIdxFrom = (piece + 7) * 90 + from;
      const pIdxTo = (piece + 7) * 90 + to;
      let nextHi = (rootHash.hi ^ ZOB_HI[pIdxFrom] ^ ZOB_HI[pIdxTo] ^ ZOB_SIDE_HI) >>> 0;
      let nextLo = (rootHash.lo ^ ZOB_LO[pIdxFrom] ^ ZOB_LO[pIdxTo] ^ ZOB_SIDE_LO) >>> 0;
      if (cap !== 0) {
        const cIdx = (cap + 7) * 90 + to;
        nextHi = (nextHi ^ ZOB_HI[cIdx]) >>> 0;
        nextLo = (nextLo ^ ZOB_LO[cIdx]) >>> 0;
      }

      let score;
      const repTag = `${nextHi}:${nextLo}`;
      const priorCount = historyCounts.get(repTag) || 0;
      if (priorCount >= 2 && rootEval > 50) {
        // Avoid 3rd repetition when ahead in material
        score = -250;
      } else {
        score = -negamax(depth - 1, -beta, -alpha, -rootSide, 1, nextHi, nextLo, rootPseudoEnd);
      }

      cells[from] = piece;
      cells[to] = cap;

      if (aborted) break;

      iterScored.push({ mv, score });
      if (score > iterBestScore) {
        iterBestScore = score;
        iterBestMove = mv;
        if (score > alpha) alpha = score;
      }
    }

    if (aborted) {
      if (iterBestMove && completedDepth === 0) {
        bestMove = iterBestMove;
        bestScore = iterBestScore;
        completedDepth = 1;
      }
      break;
    }

    completedDepth = depth;
    bestMove = iterBestMove;
    bestScore = iterBestScore;
    lastRootScored = iterScored;
    tt.store(rootHash.hi, rootHash.lo, depth, TT_EXACT, bestScore, bestMove, 0);

    if (onInfo) {
      onInfo({
        depth,
        score: bestScore,
        nodes,
        pv: extractPv(Math.min(8, depth)),
      });
    }

    if (bestScore > MATE_SCORE - 100) break; // Found forced mate
    if (performance.now() >= deadline) break;
  }

  // Difficulty-based move selection (never chooses an illegal move; never throws if < 4 moves)
  let chosenMove = bestMove;
  let chosenScore = bestScore;
  if (lastRootScored.length > 1 && (levelCfg.randomWindowCp > 0 || levelCfg.blunderChance > 0)) {
    lastRootScored.sort((a, b) => b.score - a.score);
    const topScore = lastRootScored[0].score;

    if (levelCfg.blunderChance > 0 && rng() < levelCfg.blunderChance) {
      // Deliberate weaker move (skip top move, pick from next non-mated moves)
      const safeWeaker = lastRootScored.slice(1).filter((m) => m.score > -MATE_SCORE + 500);
      const pool = safeWeaker.length > 0 ? safeWeaker : lastRootScored.slice(1);
      const pick = pool[Math.floor(rng() * Math.min(pool.length, 6))];
      if (pick) {
        chosenMove = pick.mv;
        chosenScore = pick.score;
      }
    } else if (levelCfg.randomWindowCp > 0 && topScore < MATE_SCORE - 500) {
      const within = lastRootScored
        .filter((m) => topScore - m.score <= levelCfg.randomWindowCp)
        .slice(0, Math.max(1, levelCfg.randomTopK));
      if (within.length > 0) {
        const pick = within[Math.floor(rng() * within.length)];
        chosenMove = pick.mv;
        chosenScore = pick.score;
      }
    }
  }

  const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
  const pv = extractPv(Math.min(8, Math.max(1, completedDepth)));
  const moveStr = moveToString(chosenMove);
  if (pv.length === 0 || pv[0] !== moveStr) {
    pv.unshift(moveStr);
  }

  return {
    move: moveStr,
    score: chosenScore,
    depth: completedDepth,
    nodes,
    nps: Math.round(nodes / elapsedSec),
    pv,
  };
}

/**
 * Engine implementation backed by searchBestMove.
 */
export class XiangqiEngine extends Engine {
  /**
   * @param {string} fen
   * @param {number | Object} [optionsOrThinkMs]
   * @returns {Promise<{ move: string | null, score: number, depth: number, nodes: number, nps: number, pv: string[] }>}
   */
  async bestMove(fen, optionsOrThinkMs = {}) {
    const opts =
      typeof optionsOrThinkMs === 'number'
        ? { timeMs: optionsOrThinkMs }
        : optionsOrThinkMs || {};
    return searchBestMove(fen, opts);
  }
}
