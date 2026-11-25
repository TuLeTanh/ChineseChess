/**
 * Pure game-analysis mathematics & classification (zero DOM, works in Node & Browser).
 * All normalized scores & WDL are from RED's perspective (+ = Red better, - = Black better).
 */

export const WIN_K = 150;
export const MATE_CP = 10000;

export const MOVE_CLASSES = {
  best: { id: 'best', label: 'Tốt nhất', symbol: '★', color: '#4CAF50' },
  only_move: { id: 'only_move', label: 'Nước duy nhất', symbol: '!', color: '#38BDF8' },
  good: { id: 'good', label: 'Tốt', symbol: '✓', color: '#86EFAC' },
  inaccuracy: { id: 'inaccuracy', label: 'Thiếu chính xác', symbol: '?!', color: '#FACC15' },
  mistake: { id: 'mistake', label: 'Sai lầm', symbol: '?', color: '#FB923C' },
  blunder: { id: 'blunder', label: 'Sai lầm nghiêm trọng', symbol: '??', color: '#F87171' },
  missed_mate: { id: 'missed_mate', label: 'Bỏ lỡ chiếu bí', symbol: '??', color: '#EF4444' },
};

/**
 * Convert an engine score (from sideToMove's perspective) to Red's perspective.
 * @param {{ cp?: number, mate?: number } | null | undefined} score
 * @param {'red'|'black'} sideToMove
 * @returns {{ cp?: number, mate?: number }}
 */
export function normalizeToRed(score, sideToMove) {
  if (!score) return { cp: 0 };
  const sign = sideToMove === 'black' ? -1 : 1;
  if (typeof score.mate === 'number') {
    return { mate: score.mate * sign };
  }
  return { cp: Math.round((score.cp || 0) * sign) };
}

/**
 * Convert a Red-perspective score to mover's perspective.
 * @param {{ cp?: number, mate?: number }} scoreRed
 * @param {'red'|'black'} moverSide
 */
export function normalizeToMover(scoreRed, moverSide) {
  return normalizeToRed(scoreRed, moverSide);
}

/**
 * Convert engine WDL [W, D, L] (from sideToMove) to Red's perspective [W, D, L].
 * @param {number[] | null | undefined} wdl
 * @param {'red'|'black'} sideToMove
 * @returns {[number, number, number] | null}
 */
export function wdlToRed(wdl, sideToMove) {
  if (!Array.isArray(wdl) || wdl.length !== 3) return null;
  const [w, d, l] = wdl.map((x) => Math.max(0, Number(x) || 0));
  if (w + d + l <= 0) return null;
  return sideToMove === 'black' ? [l, d, w] : [w, d, l];
}

/**
 * Compute Red's win percentage in [0, 100] using WDL if available, else logistic(cp / WIN_K).
 * @param {{ cp?: number, mate?: number } | null | undefined} scoreRed
 * @param {[number, number, number] | null | undefined} [wdlRed]
 * @returns {number}
 */
export function winPercent(scoreRed, wdlRed = null) {
  if (Array.isArray(wdlRed) && wdlRed.length === 3) {
    const sum = wdlRed[0] + wdlRed[1] + wdlRed[2];
    if (sum > 0) {
      const wp = (100 * (wdlRed[0] + 0.5 * wdlRed[1])) / sum;
      return Math.max(0, Math.min(100, wp));
    }
  }
  if (!scoreRed) return 50;
  if (typeof scoreRed.mate === 'number') {
    if (scoreRed.mate > 0) return 100;
    if (scoreRed.mate < 0) return 0;
    return 50;
  }
  const cp = Math.max(-MATE_CP, Math.min(MATE_CP, Number(scoreRed.cp) || 0));
  const wp = 100 / (1 + Math.exp(-cp / WIN_K));
  return Math.max(0, Math.min(100, wp));
}

/**
 * Compute mover's win percentage in [0, 100].
 */
export function winPercentForMover(scoreRed, wdlRed, moverSide) {
  const redWp = winPercent(scoreRed, wdlRed);
  return moverSide === 'black' ? 100 - redWp : redWp;
}

/**
 * Lichess-style per-move accuracy in [0, 100] from mover's win% drop.
 * @param {number} winDrop
 * @returns {number}
 */
export function moveAccuracy(winDrop) {
  const d = Math.max(0, Number(winDrop) || 0);
  const raw = 103.1668 * Math.exp(-0.04354 * d) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Classify a single played move (1-indexed ply).
 * @param {{
 *   ply: number,
 *   playedMove: string,
 *   bestMove?: string | null,
 *   secondBestScoreRed?: { cp?: number, mate?: number } | null,
 *   secondBestWdlRed?: [number, number, number] | null,
 *   beforeScoreRed: { cp?: number, mate?: number },
 *   beforeWdlRed?: [number, number, number] | null,
 *   afterScoreRed: { cp?: number, mate?: number },
 *   afterWdlRed?: [number, number, number] | null,
 *   moverSide: 'red' | 'black',
 * }} params
 */
export function classifyMove(params) {
  const {
    ply,
    playedMove,
    bestMove,
    secondBestScoreRed = null,
    secondBestWdlRed = null,
    beforeScoreRed,
    beforeWdlRed = null,
    afterScoreRed,
    afterWdlRed = null,
    moverSide,
  } = params;

  const beforeMover = normalizeToMover(beforeScoreRed, moverSide);
  const afterMover = normalizeToMover(afterScoreRed, moverSide);
  const winBefore = winPercentForMover(beforeScoreRed, beforeWdlRed, moverSide);
  const winAfter = winPercentForMover(afterScoreRed, afterWdlRed, moverSide);
  const winDrop = Math.max(0, winBefore - winAfter);
  const accuracy = moveAccuracy(winDrop);

  const isBestMove = Boolean(bestMove && playedMove === bestMove);

  let cls = 'good';

  // Missed forced mate
  if (typeof beforeMover.mate === 'number' && beforeMover.mate > 0 && !(typeof afterMover.mate === 'number' && afterMover.mate > 0)) {
    cls = 'missed_mate';
  } else if (isBestMove && secondBestScoreRed) {
    const winSecond = winPercentForMover(secondBestScoreRed, secondBestWdlRed, moverSide);
    if (winBefore - winSecond >= 15) {
      cls = 'only_move';
    } else {
      cls = 'best';
    }
  } else if (isBestMove) {
    cls = 'best';
  } else if (ply <= 2 && winDrop < 5) {
    cls = 'best';
  } else if (winDrop < 2) {
    cls = 'best';
  } else if (winDrop < 5) {
    cls = 'good';
  } else if (winDrop < 10) {
    cls = 'inaccuracy';
  } else if (winDrop < 20) {
    cls = 'mistake';
  } else {
    cls = 'blunder';
  }

  const meta = MOVE_CLASSES[cls];
  return {
    cls,
    label: meta.label,
    symbol: meta.symbol,
    color: meta.color,
    winBefore: Number(winBefore.toFixed(2)),
    winAfter: Number(winAfter.toFixed(2)),
    winDrop: Number(winDrop.toFixed(2)),
    accuracy: Number(accuracy.toFixed(1)),
  };
}

/**
 * Build full move classifications and summary from normalized Red-perspective positions (0..N)
 * and ICCS move strings (length N).
 * @param {Array<{ ply: number, bestmove?: string|null, scoreRed: { cp?: number, mate?: number }, wdlRed?: [number,number,number]|null, depth?: number, lines?: any[] }>} positions
 * @param {string[]} moves
 * @param {'red'|'black'} [startSide='red']
 */
export function buildAnalysisReport(positions, moves, startSide = 'red') {
  const posByPly = new Map();
  for (const p of positions) {
    if (p && typeof p.ply === 'number') posByPly.set(p.ply, p);
  }

  const moveAnnotations = [];
  const counts = {
    red: { best: 0, only_move: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed_mate: 0 },
    black: { best: 0, only_move: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed_mate: 0 },
  };
  const accList = { red: [], black: [] };
  const mistakes = [];

  for (let i = 0; i < moves.length; i++) {
    const ply = i + 1;
    const moverSide = (i % 2 === 0) ? startSide : (startSide === 'red' ? 'black' : 'red');
    const before = posByPly.get(i);
    const after = posByPly.get(ply);
    if (!before || !after) continue;

    const line2 = Array.isArray(before.lines) && before.lines.length >= 2 ? before.lines[1] : null;
    const ann = classifyMove({
      ply,
      playedMove: moves[i],
      bestMove: before.bestmove || before.lines?.[0]?.move || null,
      secondBestScoreRed: line2 ? line2.scoreRed : null,
      secondBestWdlRed: line2 ? line2.wdlRed : null,
      beforeScoreRed: before.scoreRed,
      beforeWdlRed: before.wdlRed,
      afterScoreRed: after.scoreRed,
      afterWdlRed: after.wdlRed,
      moverSide,
    });

    const entry = {
      ply,
      move: moves[i],
      side: moverSide,
      bestMove: before.bestmove || before.lines?.[0]?.move || null,
      ...ann,
    };
    moveAnnotations.push(entry);
    counts[moverSide][ann.cls] = (counts[moverSide][ann.cls] || 0) + 1;
    accList[moverSide].push(ann.accuracy);

    if (ann.cls === 'inaccuracy' || ann.cls === 'mistake' || ann.cls === 'blunder' || ann.cls === 'missed_mate') {
      mistakes.push(entry);
    }
  }

  const avg = (arr) => (arr.length === 0 ? null : Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)));
  mistakes.sort((a, b) => b.winDrop - a.winDrop);

  return {
    moveAnnotations,
    summary: {
      redAccuracy: avg(accList.red),
      blackAccuracy: avg(accList.black),
      counts,
      topMistakes: mistakes.slice(0, 3),
      analyzedPlies: posByPly.size,
      totalPlies: moves.length + 1,
      incomplete: posByPly.size < moves.length + 1,
    },
  };
}

/**
 * Deterministic 64-bit FNV-1a hex key for caching analysis results by (startFen, moves).
 * @param {string} startFen
 * @param {string[]} moves
 */
export function analysisKey(startFen, moves) {
  const str = `${(startFen || '').trim()}|${(moves || []).join(',')}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `an_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Format Red-perspective score for display in eval bar / graph / best-move card.
 * @param {{ cp?: number, mate?: number } | null | undefined} scoreRed
 */
export function formatEvalScore(scoreRed) {
  if (!scoreRed) return '0.0';
  if (typeof scoreRed.mate === 'number') {
    if (scoreRed.mate > 0) return `+M${scoreRed.mate}`;
    if (scoreRed.mate < 0) return `-M${Math.abs(scoreRed.mate)}`;
    return '0.0';
  }
  const pawns = (Number(scoreRed.cp) || 0) / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

const ICCS_FILES = 'abcdefghi';

export function parseIccsMove(str) {
  if (!str || typeof str !== 'string' || str.length !== 4) return null;
  const fx = ICCS_FILES.indexOf(str[0]);
  const fy = 9 - Number(str[1]);
  const tx = ICCS_FILES.indexOf(str[2]);
  const ty = 9 - Number(str[3]);
  if (fx < 0 || tx < 0 || Number.isNaN(fy) || Number.isNaN(ty)) return null;
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

export function isMistakeClass(cls) {
  return cls === 'mistake' || cls === 'blunder' || cls === 'missed_mate';
}

/**
 * Select consistent arrow + best-move card data for the currently displayed board position.
 * Invariant: EVERY returned arrow and line belongs to `boardPly` (the position currently shown on the board).
 * - When `focusedMistakePly` is set (and `viewPly === focusedMistakePly - 1`), arrows show:
 *     blue = engine best move at `viewPly`, red = played mistake move `moves[viewPly]`.
 * - Otherwise (normal stepping at `viewPly`), arrows show:
 *     blue = engine best move at `viewPly`, grey = 2nd best move at `viewPly`.
 */
/**
 * Detect collinear overlapping arrows (same file, same rank, or collinear path)
 * and offset them perpendicular by ±10 board SVG units (~6 CSS px), plus mark
 * played-mistake arrows dashed so both stay clearly visible.
 */
export function applyArrowOverlapOffsets(arrows) {
  if (!Array.isArray(arrows) || arrows.length === 0) return [];
  const out = arrows.map((a) => ({
    ...a,
    offset: 0,
    dashed: a.kind === 'played',
  }));
  if (out.length < 2) return out;

  const isCollinearOverlap = (a, b) => {
    const ax1 = a.from.x, ay1 = a.from.y, ax2 = a.to.x, ay2 = a.to.y;
    const bx1 = b.from.x, by1 = b.from.y, bx2 = b.to.x, by2 = b.to.y;
    const dx = ax2 - ax1;
    const dy = ay2 - ay1;
    const cross1 = dx * (by1 - ay1) - dy * (bx1 - ax1);
    const cross2 = dx * (by2 - ay1) - dy * (bx2 - ax1);
    if (cross1 !== 0 || cross2 !== 0) return false;
    // Check 1D bounding-box overlap on X and Y
    const overlapX = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2)) <= Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
    const overlapY = Math.max(Math.min(ay1, ay2), Math.min(by1, by2)) <= Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
    return overlapX && overlapY;
  };

  if (isCollinearOverlap(out[0], out[1])) {
    out[0].offset = -10;
    out[1].offset = 10;
  }
  return out;
}

export function selectAnalysisPositionData(result, viewPly, focusedMistakePly = null) {
  if (!result || !Array.isArray(result.positions)) return null;
  const pos = result.positions.find((p) => p.ply === viewPly) || null;
  if (!pos) return null;

  const isMistakeFocus =
    typeof focusedMistakePly === 'number' &&
    focusedMistakePly > 0 &&
    viewPly === focusedMistakePly - 1;

  const nextAnn = Array.isArray(result.moveAnnotations)
    ? result.moveAnnotations.find((a) => a.ply === viewPly + 1) || null
    : null;
  const posAfterNext = result.positions.find((p) => p.ply === viewPly + 1) || null;

  const bestMove = pos.bestmove || pos.lines?.[0]?.move || null;
  const lines = Array.isArray(pos.lines) ? pos.lines.slice(0, 3) : [];
  const rawArrows = [];

  if (isMistakeFocus && nextAnn) {
    const bestCoords = parseIccsMove(bestMove);
    if (bestCoords) {
      rawArrows.push({
        ...bestCoords,
        move: bestMove,
        kind: 'best',
        color: '#38BDF8',
        opacity: 0.92,
      });
    }
    const playedCoords = parseIccsMove(nextAnn.move);
    if (playedCoords && nextAnn.move !== bestMove) {
      rawArrows.push({
        ...playedCoords,
        move: nextAnn.move,
        kind: 'played',
        color: '#EF4444',
        opacity: 0.88,
      });
    }
  } else {
    if (bestMove) {
      const m1 = parseIccsMove(bestMove);
      if (m1) {
        rawArrows.push({
          ...m1,
          move: bestMove,
          kind: 'best',
          color: '#38BDF8',
          opacity: 0.9,
        });
      }
    }
    if (lines[1]?.move && lines[1].move !== bestMove) {
      const m2 = parseIccsMove(lines[1].move);
      if (m2) {
        rawArrows.push({
          ...m2,
          move: lines[1].move,
          kind: 'second',
          color: '#94A3B8',
          opacity: 0.65,
        });
      }
    }
  }

  return {
    boardPly: viewPly,
    pos,
    bestMove,
    lines,
    isMistakeFocus,
    focusedAnn: isMistakeFocus ? nextAnn : null,
    playedNext: nextAnn
      ? {
          ply: nextAnn.ply,
          move: nextAnn.move,
          cls: nextAnn.cls,
          label: nextAnn.label,
          symbol: nextAnn.symbol,
          color: nextAnn.color,
          scoreRed: posAfterNext ? posAfterNext.scoreRed : null,
        }
      : null,
    arrows: applyArrowOverlapOffsets(rawArrows),
  };
}
