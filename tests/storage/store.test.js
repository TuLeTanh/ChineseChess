/**
 * Phase 2 & 4 unit tests for GameStore (save/list/get/delete, filters, pagination,
 * 200-game prune signal, corrupted entry skip, quota error handling) and autosave
 * snapshot round trips for both Xiangqi and Jieqi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../../js/storage/gameStore.js';
import { createGameRecord, buildRecordFromBoard, JIEQI_START_PUBLIC_FEN } from '../../js/storage/gameRecord.js';
import { START_FEN } from '../../js/model/fen.js';
import { Board } from '../../js/model/board.js';
import { XiangqiRules } from '../../js/rules.js';
import { JieqiBoard, JieqiRules, makeSeededRng } from '../../js/jieqi/rules.js';

const xqRules = new XiangqiRules();
const jqRules = new JieqiRules();

test('1. GameStore CRUD, filters, search, pagination, updateNote, exportAll/importBundle', async () => {
  const store = new GameStore({ memoryOnly: true, maxGames: 200 });

  const r1 = createGameRecord({
    variant: 'xiangqi',
    red: { name: 'An', kind: 'human' },
    black: { name: 'Binh', kind: 'human' },
    result: 'red',
    reason: 'resign',
    note: 'Ván mở màn',
    updatedAt: '2026-11-20T10:00:00.000Z',
    start: { fen: START_FEN },
    moves: [{ m: 'h2e2' }],
  });
  const r2 = createGameRecord({
    variant: 'jieqi',
    red: { name: 'Chi', kind: 'human' },
    black: { name: 'May', kind: 'engine', level: 'tap-su' },
    result: 'draw',
    reason: 'drawAgreed',
    note: 'Cờ Úp hay',
    updatedAt: '2026-11-25T10:00:00.000Z',
    start: { fen: JIEQI_START_PUBLIC_FEN },
    moves: [{ m: 'a3a4', r: 'P' }],
  });

  assert.equal((await store.saveGame(r1)).ok, true);
  assert.equal((await store.saveGame(r2)).ok, true);

  // Newest-first ordering
  const all = await store.listGames();
  assert.equal(all.total, 2);
  assert.equal(all.items[0].id, r2.id);

  // Filters & search
  assert.equal((await store.listGames({ variant: 'jieqi' })).total, 1);
  assert.equal((await store.listGames({ result: 'red' })).total, 1);
  assert.equal((await store.listGames({ query: 'mở màn' })).total, 1);

  // Pagination
  const p1 = await store.listGames({ limit: 1, cursor: 0 });
  assert.equal(p1.items.length, 1);
  assert.equal(p1.nextCursor, 1);
  const p2 = await store.listGames({ limit: 1, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 1);
  assert.equal(p2.nextCursor, null);

  // updateNote
  await store.updateNote(r1.id, 'Ghi chú mới');
  assert.equal((await store.getGame(r1.id)).note, 'Ghi chú mới');

  // exportAll & importBundle into fresh store
  const bundle = await store.exportAll();
  assert.equal(bundle.games.length, 2);
  const store2 = new GameStore({ memoryOnly: true });
  const imp = await store2.importBundle(bundle);
  assert.equal(imp.imported, 2);
  assert.equal(imp.failed, 0);

  // delete
  await store.deleteGame(r1.id);
  assert.equal((await store.listGames()).total, 1);
});

test('2. Library cap (200) returns needsPrune, forcePruneOldest deletes oldest, corrupt entries skipped, quota error never throws', async () => {
  const errors = [];
  const store = new GameStore({ memoryOnly: true, maxGames: 5, onError: (e) => errors.push(e) });

  for (let i = 0; i < 5; i++) {
    const rec = createGameRecord({
      variant: 'xiangqi',
      start: { fen: START_FEN },
      moves: [],
      updatedAt: `2026-11-2${i}T10:00:00.000Z`,
    });
    assert.equal((await store.saveGame(rec)).ok, true);
  }

  // 6th game triggers needsPrune
  const extra = createGameRecord({ variant: 'xiangqi', start: { fen: START_FEN }, moves: [] });
  const res1 = await store.saveGame(extra);
  assert.equal(res1.ok, false);
  assert.equal(res1.needsPrune, true);

  // forcePruneOldest succeeds and keeps count at cap
  const res2 = await store.saveGame(extra, { forcePruneOldest: true });
  assert.equal(res2.ok, true);
  assert.equal((await store.listGames()).total, 5);

  // Inject a corrupted record directly into memory map -> listGames skips it cleanly
  store._memGames.set('bad-1', { id: 'bad-1', broken: true });
  const listed = await store.listGames();
  assert.equal(listed.skippedCorrupt, 1);
  assert.equal(listed.total, 5);

  // QuotaExceededError surfaces via onError and never throws
  const qErrors = [];
  const qStore = new GameStore({ memoryOnly: true, simulateQuotaError: true, onError: (e) => qErrors.push(e) });
  const qRes = await qStore.saveGame(extra);
  assert.equal(qRes.ok, false);
  assert.equal(qRes.error.code, 'QUOTA_EXCEEDED');
  assert.equal(qErrors.length, 1);
});

test('3. Autosave snapshot round trip preserves full state + Jieqi secretLocal + undo equivalence', async () => {
  const store = new GameStore({ memoryOnly: true });

  // Xiangqi 12-ply autosave round trip
  const xb = new Board(START_FEN);
  const rng1 = makeSeededRng(701);
  for (let i = 0; i < 12; i++) {
    const moves = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = xb.at({ x, y });
        if (p && p.side === xb.sideToMove) {
          for (const to of xqRules.legalMoves(xb, { x, y })) moves.push({ from: { x, y }, to });
        }
      }
    }
    const pick = moves[Math.floor(rng1() * moves.length)];
    xb.applyMove(pick.from, pick.to);
  }
  const xSnap = {
    record: buildRecordFromBoard({ board: xb, variant: 'xiangqi', mode: 'local' }),
    halfmoveClock: xb.halfmoveClock,
    positionHistory: [...xb.positionHistory],
    free: false,
  };
  await store.putAutosave('xiangqi:local', xSnap);
  const loadedX = await store.getAutosave('xiangqi:local');
  assert.deepEqual(loadedX.record.moves, xSnap.record.moves);
  assert.equal(loadedX.halfmoveClock, xb.halfmoveClock);

  // Jieqi 12-ply autosave round trip including secretLocal & undo equivalence
  const jb = new JieqiBoard({ seed: 808 });
  const rng2 = makeSeededRng(809);
  for (let i = 0; i < 12; i++) {
    const moves = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const p = jb.at({ x, y });
        if (p && p.side === jb.sideToMove) {
          for (const to of jqRules.legalMoves(jb, { x, y })) moves.push({ from: { x, y }, to });
        }
      }
    }
    const pick = moves[Math.floor(rng2() * moves.length)];
    jb.applyMove(pick.from, pick.to);
  }
  const jSnap = {
    record: buildRecordFromBoard({ board: jb, variant: 'jieqi', mode: 'local' }),
    secretLocal: Object.fromEntries(jb._secret.entries()),
    halfmoveClock: jb.halfmoveClock,
    positionHistory: [...jb.positionHistory],
  };
  await store.putAutosave('jieqi:local', jSnap);
  const loadedJ = await store.getAutosave('jieqi:local');
  assert.deepEqual(loadedJ.secretLocal, jSnap.secretLocal);
  assert.equal((await store.listAutosaves()).length, 2);

  await store.clearAutosave('jieqi:local');
  assert.equal(await store.getAutosave('jieqi:local'), null);
});
