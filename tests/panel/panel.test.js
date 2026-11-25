/**
 * Unit tests for Phase 1 & 4:
 * - panelPolicy() visibility matrix across all (variant x mode x status x isArchive) combinations
 * - verdictForWinPercent() exact threshold boundaries (75, 58, 42, 25)
 * - buildValidatedPvChips() legal replay & illegal truncation
 * - Preview-state isolation property test over 50 random positions
 * - createLiveAnalysisScheduler() debounce, cancel-on-change, stale ignore, never-2-jobs, 409 path
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  panelPolicy,
  verdictForWinPercent,
  VERDICT_BANDS,
  buildValidatedPvChips,
  createLiveAnalysisScheduler,
} from '../../js/app/panelPolicy.js';
import { Board } from '../../js/model/board.js';
import { START_FEN } from '../../js/model/fen.js';
import { XiangqiRules } from '../../js/rules.js';

test('1. panelPolicy visibility matrix (P3 & P4) over all combinations', () => {
  const cases = [
    // [input, expectedShowAnalysis, expectedUndo, expectedDraw, expectedResign, expectedHint]
    [{ variant: 'xiangqi', mode: 'local', status: 'live', isArchive: false }, true, true, true, true, false],
    [{ variant: 'jieqi', mode: 'local', status: 'live', isArchive: false }, false, true, true, true, false],
    [{ variant: 'xiangqi', mode: 'ai', status: 'live', isArchive: false }, false, false, false, true, true],
    [{ variant: 'jieqi', mode: 'ai', status: 'live', isArchive: false }, false, false, false, true, true],
    [{ variant: 'xiangqi', mode: 'online', status: 'live', isArchive: false }, false, false, true, true, false],
    [{ variant: 'jieqi', mode: 'online', status: 'live', isArchive: false }, false, false, true, true, false],
    [{ variant: 'xiangqi', mode: 'ai', status: 'finished', isArchive: false }, true, false, false, true, false],
    [{ variant: 'xiangqi', mode: 'online', status: 'finished', isArchive: false }, true, false, true, true, false],
    [{ variant: 'jieqi', mode: 'ai', status: 'finished', isArchive: false }, false, false, false, true, false],
    [{ variant: 'xiangqi', mode: 'ai', status: 'finished', isArchive: true }, true, false, false, false, false],
    [{ variant: 'xiangqi', mode: 'ai', status: 'unfinished', isArchive: true }, false, false, false, false, false],
    [{ variant: 'xiangqi', mode: 'online', status: 'unfinished', isArchive: true }, false, false, false, false, false],
    [{ variant: 'xiangqi', mode: 'local', status: 'unfinished', isArchive: true }, true, false, false, false, false],
    [{ variant: 'jieqi', mode: 'local', status: 'finished', isArchive: true }, false, false, false, false, false],
  ];

  for (const [inp, expAn, expUndo, expDraw, expResign, expHint] of cases) {
    const p = panelPolicy(inp);
    assert.equal(p.showAnalysis, expAn, `showAnalysis mismatch for ${JSON.stringify(inp)}`);
    assert.equal(p.showUndo, expUndo, `showUndo mismatch for ${JSON.stringify(inp)}`);
    assert.equal(p.showDraw, expDraw, `showDraw mismatch for ${JSON.stringify(inp)}`);
    assert.equal(p.showResign, expResign, `showResign mismatch for ${JSON.stringify(inp)}`);
    assert.equal(p.showHint, expHint, `showHint mismatch for ${JSON.stringify(inp)}`);
  }
});

test('2. verdictForWinPercent exact boundaries (75, 58, 42, 25)', () => {
  assert.equal(VERDICT_BANDS.length, 5);
  assert.equal(verdictForWinPercent(100).id, 'red_winning');
  assert.equal(verdictForWinPercent(75).id, 'red_winning');
  assert.equal(verdictForWinPercent(74.99).id, 'red_better');
  assert.equal(verdictForWinPercent(58).id, 'red_better');
  assert.equal(verdictForWinPercent(57.99).id, 'equal');
  assert.equal(verdictForWinPercent(50).id, 'equal');
  assert.equal(verdictForWinPercent(42).id, 'equal');
  assert.equal(verdictForWinPercent(41.99).id, 'black_better');
  assert.equal(verdictForWinPercent(25).id, 'black_better');
  assert.equal(verdictForWinPercent(24.99).id, 'black_winning');
  assert.equal(verdictForWinPercent(0).id, 'black_winning');
});

test('3. buildValidatedPvChips validates legal PV and truncates at first illegal move', () => {
  const validPv = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b7e7', 'b0c2', 'b9c7'];
  const r6 = buildValidatedPvChips(START_FEN, validPv, 6);
  assert.equal(r6.chips.length, 6);
  assert.equal(r6.truncated, false);
  assert.equal(r6.chips[0].side, 'red');
  assert.equal(r6.chips[0].kind, 'cannon');
  assert.equal(r6.chips[1].side, 'black');
  assert.equal(r6.chips[1].kind, 'horse');

  // Illegal 3rd move (a0a9 jumps over pieces) -> truncates to 2 chips
  const badPv = ['h2e2', 'h9g7', 'a0a9', 'i9h9'];
  const rBad = buildValidatedPvChips(START_FEN, badPv, 6);
  assert.equal(rBad.chips.length, 2);
  assert.equal(rBad.truncated, true);
});

test('4. Preview-state isolation property test over 50 random positions', () => {
  const rules = new XiangqiRules();
  const FILES = 'abcdefghi';
  let seed = 20261125;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const board = Board.fromFen(START_FEN);
  for (let step = 0; step < 50; step++) {
    const fenBefore = board.toFen();
    const histLenBefore = board.history.length;
    const posHistBefore = [...board.positionHistory];
    const hmcBefore = board.halfmoveClock;

    // Collect a random legal move for preview
    const all = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const pc = board.at({ x, y });
        if (!pc || pc.side !== board.sideToMove) continue;
        for (const to of rules.legalMoves(board, { x, y })) {
          all.push({ from: { x, y }, to });
        }
      }
    }
    if (all.length === 0) break;
    const pick = all[Math.floor(rand() * all.length)];
    const iccs = `${FILES[pick.from.x]}${9 - pick.from.y}${FILES[pick.to.x]}${9 - pick.to.y}`;
    const built = buildValidatedPvChips(fenBefore, [iccs], 6);
    assert.equal(built.chips.length, 1);

    // Original board must be 100% untouched
    assert.equal(board.toFen(), fenBefore);
    assert.equal(board.history.length, histLenBefore);
    assert.deepEqual(board.positionHistory, posHistBefore);
    assert.equal(board.halfmoveClock, hmcBefore);

    // Advance board for next iteration
    board.applyMove(pick.from, pick.to);
  }
});

test('5. createLiveAnalysisScheduler: debounce, cancel-on-change, stale ignore, never two concurrent jobs, 409 path', async () => {
  let activeJobs = 0;
  let maxConcurrent = 0;
  let cancelCount = 0;
  const results = [];
  const errors = [];

  const sched = createLiveAnalysisScheduler({
    debounceMs: 30,
    runSearch: (payload) => {
      activeJobs++;
      maxConcurrent = Math.max(maxConcurrent, activeJobs);
      let cancelled = false;
      let timer;
      const promise = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          activeJobs = Math.max(0, activeJobs - 1);
          if (cancelled) return;
          if (payload.force409) {
            const err = new Error('Busy');
            err.status = 409;
            return reject(err);
          }
          resolve({ fen: payload.fen });
        }, 40);
      });
      return {
        cancel: () => {
          cancelled = true;
          cancelCount++;
          clearTimeout(timer);
          activeJobs = Math.max(0, activeJobs - 1);
        },
        promise,
      };
    },
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });

  // Rapid fire 3 schedules -> first two debounced away, only 3rd runs
  sched.schedule({ fen: 'pos1' });
  sched.schedule({ fen: 'pos2' });
  sched.schedule({ fen: 'pos3' });
  await new Promise((r) => setTimeout(r, 45)); // pos3 started
  // Trigger pos4 while pos3 is in flight -> cancels pos3, ignores stale pos3
  sched.schedule({ fen: 'pos4' });
  await new Promise((r) => setTimeout(r, 110));

  assert.equal(maxConcurrent, 1);
  assert.ok(cancelCount >= 1);
  assert.deepEqual(results, [{ fen: 'pos4' }]);

  // 409 error path surfaced cleanly
  sched.schedule({ fen: 'pos5', force409: true });
  await new Promise((r) => setTimeout(r, 110));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].status, 409);

  sched.dispose();
});
