/**
 * Unit tests for Part B3: pure analysis math, move classification, accuracy,
 * fake-engine 12-ply analysis with planted blunder + cancel/stale-id safety,
 * and GameStore analysis persistence & cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIN_K,
  normalizeToRed,
  wdlToRed,
  winPercent,
  moveAccuracy,
  classifyMove,
  buildAnalysisReport,
  analysisKey,
  formatEvalScore,
  selectAnalysisPositionData,
} from '../../js/analysis/math.js';
import { Board } from '../../js/model/board.js';
import { runGameAnalysis } from '../../js/analysis/analyzer.js';
import { GameStore, MAX_SAVED_ANALYSES } from '../../js/storage/gameStore.js';
import { START_FEN } from '../../js/model/fen.js';

test('1. winPercent: logistic symmetry, WDL preference, mate bounds, perspective normalization', () => {
  assert.equal(WIN_K, 150);
  assert.equal(Math.round(winPercent({ cp: 0 })), 50);
  assert.ok(winPercent({ cp: 150 }) > 70 && winPercent({ cp: 150 }) < 76);
  assert.ok(Math.abs(winPercent({ cp: 200 }) + winPercent({ cp: -200 }) - 100) < 0.01);
  assert.equal(winPercent({ mate: 3 }), 100);
  assert.equal(winPercent({ mate: -2 }), 0);

  // WDL overrides cp when valid
  assert.equal(winPercent({ cp: -500 }, [800, 100, 100]), 85);
  assert.deepEqual(wdlToRed([700, 200, 100], 'black'), [100, 200, 700]);
  assert.deepEqual(normalizeToRed({ cp: 120 }, 'black'), { cp: -120 });
  assert.deepEqual(normalizeToRed({ mate: 2 }, 'black'), { mate: -2 });
  assert.equal(formatEvalScore({ cp: 150 }), '+1.5');
  assert.equal(formatEvalScore({ mate: -3 }), '-M3');
});

test('2. classifyMove: best, good, inaccuracy, mistake, blunder, missed_mate, only_move, opening grace', () => {
  // Exact best move
  const cBest = classifyMove({
    ply: 5,
    playedMove: 'h2e2',
    bestMove: 'h2e2',
    beforeScoreRed: { cp: 30 },
    afterScoreRed: { cp: 30 },
    moverSide: 'red',
  });
  assert.equal(cBest.cls, 'best');

  // Opening grace (ply <= 2 with winDrop < 5 -> best)
  const cGrace = classifyMove({
    ply: 2,
    playedMove: 'h7e7',
    bestMove: 'b7e7',
    beforeScoreRed: { cp: 0 },
    afterScoreRed: { cp: 20 }, // small ~3.3% drop for Black
    moverSide: 'black',
  });
  assert.equal(cGrace.cls, 'best');

  // Only move (second best drops >= 15%)
  const cOnly = classifyMove({
    ply: 10,
    playedMove: 'a0a1',
    bestMove: 'a0a1',
    secondBestScoreRed: { cp: -250 },
    beforeScoreRed: { cp: 50 },
    afterScoreRed: { cp: 50 },
    moverSide: 'red',
  });
  assert.equal(cOnly.cls, 'only_move');

  // Blunder (winDrop >= 20%)
  const cBlunder = classifyMove({
    ply: 9,
    playedMove: 'a0a4',
    bestMove: 'h0g2',
    beforeScoreRed: { cp: 60 },
    afterScoreRed: { cp: -450 },
    moverSide: 'red',
  });
  assert.equal(cBlunder.cls, 'blunder');
  assert.equal(cBlunder.symbol, '??');
  assert.ok(cBlunder.winDrop >= 20);

  // Missed mate
  const cMiss = classifyMove({
    ply: 15,
    playedMove: 'e0e1',
    bestMove: 'a8e8',
    beforeScoreRed: { mate: 2 },
    afterScoreRed: { cp: 100 },
    moverSide: 'red',
  });
  assert.equal(cMiss.cls, 'missed_mate');
});

test('3. moveAccuracy & buildAnalysisReport: monotonic accuracy, top-3 mistakes sorted', () => {
  assert.equal(Math.round(moveAccuracy(0)), 100);
  assert.ok(moveAccuracy(5) > moveAccuracy(15));
  assert.ok(moveAccuracy(15) > moveAccuracy(35));
  assert.ok(moveAccuracy(100) >= 0 && moveAccuracy(100) < 10);

  const positions = [
    { ply: 0, bestmove: 'h2e2', scoreRed: { cp: 20 } },
    { ply: 1, bestmove: 'h9g7', scoreRed: { cp: 20 } },
    { ply: 2, bestmove: 'h0g2', scoreRed: { cp: 20 } },
    { ply: 3, bestmove: 'i9h9', scoreRed: { cp: -400 } }, // Red blundered at ply 3
    { ply: 4, bestmove: 'i0h0', scoreRed: { cp: -400 } },
  ];
  const report = buildAnalysisReport(positions, ['h2e2', 'h9g7', 'b0c2', 'i9h9']);
  assert.equal(report.moveAnnotations.length, 4);
  assert.equal(report.moveAnnotations[2].cls, 'blunder');
  assert.equal(report.summary.topMistakes[0].ply, 3);
  assert.ok(report.summary.blackAccuracy > report.summary.redAccuracy);
  assert.equal(report.summary.incomplete, false);
});

test('4. runGameAnalysis with fake engine: 12-ply planted blunder at ply 7 + cancel/stale-id safety', async () => {
  const moves = [
    'h2e2', 'h9g7', 'h0g2', 'i9h9',
    'i0h0', 'b7e7', 'b0c2', 'b9c7',
    'a0b0', 'a9b9', 'c3c4', 'c6c5',
  ];
  // Fake engine scores from sideToMove perspective; plants a massive blunder at ply 7 (Red's 4th move)
  const cpRedByPly = [20, 20, 20, 20, 25, 25, 30, -520, -510, -500, -500, -490, -490];
  let progressCalls = 0;

  const handle = runGameAnalysis({
    startFen: START_FEN,
    moves,
    preset: 'fast',
    customEvaluator: async ({ ply, sideToMove }) => {
      const cpRed = cpRedByPly[ply];
      const cpSide = sideToMove === 'black' ? -cpRed : cpRed;
      return {
        bestmove: ply === 6 ? 'h0h6' : moves[ply] || 'e0e1',
        score: { cp: cpSide },
        depth: 10,
      };
    },
    onProgress: () => {
      progressCalls++;
    },
  });

  const result = await handle.promise;
  assert.equal(result.analyzed, 13);
  assert.equal(progressCalls, 13);
  assert.equal(result.summary.incomplete, false);
  const ply7 = result.moveAnnotations.find((m) => m.ply === 7);
  assert.equal(ply7.cls, 'blunder');
  assert.equal(result.summary.topMistakes[0].ply, 7);

  // Cancel halfway -> stops cleanly and marks incomplete
  let cancelProgress = 0;
  const h2 = runGameAnalysis({
    startFen: START_FEN,
    moves,
    customEvaluator: async ({ ply }) => {
      await new Promise((r) => setTimeout(r, 15));
      return { bestmove: moves[ply] || 'e0e1', score: { cp: 0 }, depth: 6 };
    },
    onProgress: (snap) => {
      cancelProgress++;
      if (snap.analyzed === 4) h2.cancel();
    },
  });
  const res2 = await h2.promise;
  assert.equal(res2.cancelled, true);
  assert.equal(res2.summary.incomplete, true);
  assert.ok(res2.analyzed <= 5 && cancelProgress <= 5);
});

test('5. GameStore analysis persistence, deterministic key, cap enforcement, and clearAll', async () => {
  const store = new GameStore({ memoryOnly: true, maxAnalyses: 3 });
  assert.equal(MAX_SAVED_ANALYSES, 100);

  const k1 = analysisKey(START_FEN, ['h2e2', 'h9g7']);
  const k1b = analysisKey(START_FEN, ['h2e2', 'h9g7']);
  const k2 = analysisKey(START_FEN, ['b2e2', 'h9g7']);
  assert.equal(k1, k1b);
  assert.notEqual(k1, k2);

  await store.putAnalysis({ key: 'k1', updatedAt: '2026-01-01T00:00:01Z', summary: { redAccuracy: 90 } });
  await store.putAnalysis({ key: 'k2', updatedAt: '2026-01-01T00:00:02Z', summary: { redAccuracy: 85 } });
  await store.putAnalysis({ key: 'k3', updatedAt: '2026-01-01T00:00:03Z', summary: { redAccuracy: 80 } });

  // At cap with pruneOldest=false -> CAP_REACHED
  const capped = await store.putAnalysis({ key: 'k4', updatedAt: '2026-01-01T00:00:04Z' }, { pruneOldest: false });
  assert.equal(capped.ok, false);
  assert.equal(capped.error, 'CAP_REACHED');

  // With pruneOldest=true -> evicts oldest (k1)
  const ok = await store.putAnalysis({ key: 'k4', updatedAt: '2026-01-01T00:00:04Z' }, { pruneOldest: true });
  assert.equal(ok.ok, true);
  assert.equal(await store.getAnalysis('k1'), null);
  assert.ok(await store.getAnalysis('k4'));

  await store.clearAll();
  assert.equal((await store.listAnalyses()).length, 0);
});

test('6. Item 1: selectAnalysisPositionData arrows always originate from occupied sideToMove piece for every ply', () => {
  const moves = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b7e7', 'b0c2', 'b9c7', 'h0h7', 'h9h7'];
  const bestByPly = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b7e7', 'b0c2', 'b9c7', 'h0h6', 'h9h7', 'a0a1'];
  const cpRedByPly = [20, 20, 20, 20, 20, 20, 20, 20, 25, -480, -480];
  const positions = cpRedByPly.map((cp, ply) => ({
    ply,
    bestmove: bestByPly[ply],
    scoreRed: { cp },
    lines: [{ move: bestByPly[ply], scoreRed: { cp }, pv: [bestByPly[ply]] }],
  }));
  const report = buildAnalysisReport(positions, moves);
  const result = { positions, moveAnnotations: report.moveAnnotations };

  // Build board at every ply 0..10 and verify normal stepping arrows
  const b = Board.fromFen(START_FEN);
  const FILES = 'abcdefghi';
  for (let ply = 0; ply <= moves.length; ply++) {
    const data = selectAnalysisPositionData(result, ply, null);
    assert.ok(data && data.boardPly === ply);
    for (const a of data.arrows) {
      const pc = b.at(a.from);
      assert.ok(pc, `Ply ${ply}: arrow ${a.move} starts on empty square`);
      assert.equal(pc.side, b.sideToMove, `Ply ${ply}: arrow ${a.move} starts on wrong side`);
    }
    if (ply < moves.length) {
      const m = moves[ply];
      b.applyMove({ x: FILES.indexOf(m[0]), y: 9 - Number(m[1]) }, { x: FILES.indexOf(m[2]), y: 9 - Number(m[3]) });
    }
  }

  // Selecting blunder ply 9 displays ply 8 (before h0h7) with blue (h0h6) + red (h0h7), both on Red Chariot at h0
  const b8 = Board.fromFen(START_FEN);
  for (let i = 0; i < 8; i++) {
    const m = moves[i];
    b8.applyMove({ x: FILES.indexOf(m[0]), y: 9 - Number(m[1]) }, { x: FILES.indexOf(m[2]), y: 9 - Number(m[3]) });
  }
  const focus = selectAnalysisPositionData(result, 8, 9);
  assert.equal(focus.isMistakeFocus, true);
  assert.equal(focus.arrows.length, 2);
  assert.equal(focus.arrows[0].kind, 'best');
  assert.equal(focus.arrows[0].move, 'h0h6');
  assert.equal(focus.arrows[1].kind, 'played');
  assert.equal(focus.arrows[1].move, 'h0h7');
  for (const a of focus.arrows) {
    const pc = b8.at(a.from);
    assert.ok(pc && pc.side === 'red' && pc.kind === 'chariot');
  }
});

test('7. Item 2: collinear overlapping arrows (h0h6 vs h0h7) get perpendicular offset and dashed played arrow', () => {
  const positions = [
    { ply: 0, bestmove: 'h0h6', scoreRed: { cp: 25 }, lines: [{ move: 'h0h6', scoreRed: { cp: 25 }, pv: ['h0h6'] }] },
    { ply: 1, bestmove: 'h9h7', scoreRed: { cp: -480 }, lines: [{ move: 'h9h7', scoreRed: { cp: -480 }, pv: ['h9h7'] }] },
  ];
  const report = buildAnalysisReport(positions, ['h0h7']);
  const focus = selectAnalysisPositionData({ positions, moveAnnotations: report.moveAnnotations }, 0, 1);
  assert.equal(focus.arrows.length, 2);
  assert.notEqual(focus.arrows[0].offset, focus.arrows[1].offset);
  assert.equal(Math.abs(focus.arrows[0].offset), 10);
  assert.equal(Math.abs(focus.arrows[1].offset), 10);
  assert.equal(focus.arrows[0].dashed, false);
  assert.equal(focus.arrows[1].dashed, true);
});

test('8. Item 3: best-move card lines match the arrow position and include playedNext with after-score', () => {
  const positions = [
    {
      ply: 0,
      bestmove: 'h0h6',
      scoreRed: { cp: 25 },
      lines: [
        { move: 'h0h6', scoreRed: { cp: 25 }, pv: ['h0h6', 'c6c5'] },
        { move: 'a0a1', scoreRed: { cp: 10 }, pv: ['a0a1', 'a9a8'] },
      ],
    },
    {
      ply: 1,
      bestmove: 'h9h7',
      scoreRed: { cp: -480 },
      lines: [{ move: 'h9h7', scoreRed: { cp: -480 }, pv: ['h9h7', 'a0a1'] }],
    },
  ];
  const report = buildAnalysisReport(positions, ['h0h7']);
  const data = selectAnalysisPositionData({ positions, moveAnnotations: report.moveAnnotations }, 0, 1);
  assert.equal(data.boardPly, 0);
  assert.equal(data.bestMove, 'h0h6');
  assert.equal(data.lines[0].move, data.bestMove);
  assert.equal(data.lines[0].pv[0], 'h0h6');
  assert.equal(data.playedNext.move, 'h0h7');
  assert.equal(formatEvalScore(data.playedNext.scoreRed), '-4.8');
});

test('9. Item 6b/e/g/h: terminal checkmate mate:0, custom FEN, ply range, and full cache key isolation', async () => {
  // 6b: terminal checkmate (mate: 0) when Black is mated -> Red wins (100%, +#)
  const redWins = normalizeToRed({ mate: 0 }, 'black');
  assert.equal(winPercent(redWins), 100);
  assert.equal(formatEvalScore(redWins), '+#');
  const blackWins = normalizeToRed({ mate: 0 }, 'red');
  assert.equal(winPercent(blackWins), 0);
  assert.equal(formatEvalScore(blackWins), '-#');

  // 6g: custom non-START_FEN endgame analysis (Double Chariot mate-in-1)
  const customFen = '4k4/R8/1R7/9/9/9/9/9/9/3K5 w - - 0 1';
  const hCustom = runGameAnalysis({
    startFen: customFen,
    moves: ['b7b9'],
    preset: 'fast',
    customEvaluator: async ({ ply }) =>
      ply === 0 ? { bestmove: 'b7b9', score: { mate: 1 }, depth: 6 } : { bestmove: null, score: { mate: 0 }, depth: 0 },
  });
  const resCustom = await hCustom.promise;
  assert.equal(resCustom.analyzed, 2);
  assert.equal(resCustom.positions[1].scoreRed.winner, 'red');
  assert.equal(resCustom.moveAnnotations[0].cls, 'best');

  // 6e: ply range (fromPly..toPly) analyzes only requested slice
  const moves6 = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b7e7'];
  const hRange = runGameAnalysis({
    startFen: START_FEN,
    moves: moves6,
    fromPly: 2,
    toPly: 4,
    customEvaluator: async ({ ply }) => ({ bestmove: moves6[ply] || 'e0e1', score: { cp: 10 }, depth: 4 }),
  });
  const resRange = await hRange.promise;
  assert.equal(resRange.analyzed, 3);
  assert.deepEqual(resRange.positions.map((p) => p.ply), [2, 3, 4]);

  // 6h: analysisKey differs when moves, startFen, preset, or engineKind differ
  const kBase = analysisKey(START_FEN, ['h2e2', 'h9g7'], 'fast', 'pikafish');
  assert.notEqual(kBase, analysisKey(START_FEN, ['h2e2', 'b9c7'], 'fast', 'pikafish'));
  assert.notEqual(kBase, analysisKey(customFen, ['h2e2', 'h9g7'], 'fast', 'pikafish'));
  assert.notEqual(kBase, analysisKey(START_FEN, ['h2e2', 'h9g7'], 'standard', 'pikafish'));
  assert.notEqual(kBase, analysisKey(START_FEN, ['h2e2', 'h9g7'], 'fast', 'js'));
});
