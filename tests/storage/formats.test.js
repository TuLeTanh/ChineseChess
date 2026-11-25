/**
 * Phase 1 & 4 unit tests for pure storage formats, validation, rejection suite,
 * secret safety, and dealRemainingPool invariants (zero DOM required).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../../js/model/board.js';
import { START_FEN } from '../../js/model/fen.js';
import { RED, BLACK } from '../../js/model/piece.js';
import { XiangqiRules } from '../../js/rules.js';
import {
  JieqiBoard,
  JieqiRules,
  NON_GENERAL_KINDS,
  dealRemainingPool,
  makeSeededRng,
} from '../../js/jieqi/rules.js';
import { buildRecordFromBoard, createGameRecord, JIEQI_START_PUBLIC_FEN } from '../../js/storage/gameRecord.js';
import {
  toJson,
  fromJson,
  toPgn,
  fromPgn,
  positionToFen,
  fenToPosition,
  encodeSharePayload,
  decodeSharePayload,
} from '../../js/storage/formats.js';
import { validatePositionFen } from '../../js/storage/validate.js';

const xqRules = new XiangqiRules();
const jqRules = new JieqiRules();

function playRandomXiangqi(seed, maxPlies = 40) {
  const rng = makeSeededRng(seed);
  const b = new Board(START_FEN);
  for (let p = 0; p < maxPlies; p++) {
    const all = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const pc = b.at({ x, y });
        if (!pc || pc.side !== b.sideToMove) continue;
        for (const to of xqRules.legalMoves(b, { x, y })) {
          all.push({ from: { x, y }, to });
        }
      }
    }
    if (all.length === 0) break;
    const pick = all[Math.floor(rng() * all.length)];
    b.applyMove(pick.from, pick.to);
  }
  return b;
}

function playRandomJieqi(seed, maxPlies = 40, secretOverride = null) {
  const rng = makeSeededRng(seed + 777);
  const b = secretOverride ? new JieqiBoard({ secret: new Map(secretOverride) }) : new JieqiBoard({ seed });
  for (let p = 0; p < maxPlies; p++) {
    const all = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const pc = b.at({ x, y });
        if (!pc || pc.side !== b.sideToMove) continue;
        for (const to of jqRules.legalMoves(b, { x, y })) {
          all.push({ from: { x, y }, to });
        }
      }
    }
    if (all.length === 0) break;
    const pick = all[Math.floor(rng() * all.length)];
    b.applyMove(pick.from, pick.to);
  }
  return b;
}

test('1. Round trip: 100 random Xiangqi & 100 random Jieqi games through JSON, PGN, and Share Link', async () => {
  for (let i = 0; i < 100; i++) {
    // Xiangqi
    const xb = playRandomXiangqi(1000 + i, 24);
    const xRec = buildRecordFromBoard({
      board: xb,
      variant: 'xiangqi',
      mode: 'local',
      red: { name: 'Kỳ Thủ Đỏ', kind: 'human' },
      black: { name: 'Kỳ Thủ Đen', kind: 'human' },
      result: 'unfinished',
    });
    const j1 = fromJson(toJson(xRec), { isImport: false });
    assert.equal(j1.ok, true, `Xiangqi JSON fail i=${i}: ${j1.error?.message}`);
    assert.deepEqual(j1.record.moves, xRec.moves);
    assert.equal(j1.finalFen.split(' ')[0], xb.toFen().split(' ')[0]);

    const p1 = fromPgn(toPgn(xRec), { isImport: false });
    assert.equal(p1.ok, true, `Xiangqi PGN fail i=${i}: ${p1.error?.message}`);
    assert.deepEqual(p1.record.moves, xRec.moves);
    assert.equal(p1.finalFen.split(' ')[0], xb.toFen().split(' ')[0]);

    if (i < 25) {
      const enc = await encodeSharePayload(xRec);
      assert.equal(enc.ok, true);
      const dec = await decodeSharePayload(enc.payload, { isImport: false });
      assert.equal(dec.ok, true);
      assert.deepEqual(dec.record.moves, xRec.moves);
    }

    // Jieqi
    const jb = playRandomJieqi(2000 + i, 24);
    const jRec = buildRecordFromBoard({
      board: jb,
      variant: 'jieqi',
      mode: 'ai',
      red: { name: 'Bạn', kind: 'human' },
      black: { name: 'Máy', kind: 'engine', level: 'nghiep-du' },
      result: 'unfinished',
    });
    const jj1 = fromJson(toJson(jRec), { isImport: false });
    assert.equal(jj1.ok, true, `Jieqi JSON fail i=${i}: ${jj1.error?.message}`);
    assert.deepEqual(jj1.record.moves, jRec.moves);
    assert.equal(jj1.finalFen, jb.publicFen());

    const jp1 = fromPgn(toPgn(jRec), { isImport: false });
    assert.equal(jp1.ok, true, `Jieqi PGN fail i=${i}: ${jp1.error?.message}`);
    assert.deepEqual(jp1.record.moves, jRec.moves);
    assert.equal(jp1.finalFen, jb.publicFen());

    if (i < 25) {
      const encJ = await encodeSharePayload(jRec);
      assert.equal(encJ.ok, true);
      const decJ = await decodeSharePayload(encJ.payload, { isImport: false });
      assert.equal(decJ.ok, true);
      assert.deepEqual(decJ.record.moves, jRec.moves);
      assert.equal(decJ.finalFen, jb.publicFen());
    }
  }
});

test('2. FEN round trip (200 positions) and invalid FEN rejection', () => {
  for (let i = 0; i < 100; i++) {
    const xb = playRandomXiangqi(3000 + i, 12);
    const f = positionToFen(xb);
    const r = fenToPosition(f, 'xiangqi');
    assert.equal(r.ok, true);
    assert.equal(r.board.toFen().split(' ')[0], f.split(' ')[0]);

    const jb = playRandomJieqi(4000 + i, 12);
    const jf = positionToFen(jb);
    const jr = fenToPosition(jf, 'jieqi');
    assert.equal(jr.ok, true);
    assert.equal(jr.board.publicFen(), jf);
  }

  // Missing Red general -> must reject
  assert.equal(validatePositionFen('4k4/9/9/9/9/9/9/9/9/9 w - - 0 1', 'xiangqi').ok, false);
  // Only 3 rows -> must reject
  assert.equal(validatePositionFen('4k4/9/4K4 w - - 0 1', 'xiangqi').ok, false);
  // Unknown piece char 'Q' -> must reject
  assert.equal(validatePositionFen('4k4/9/9/9/4Q4/9/9/9/9/4K4 w - - 0 1', 'xiangqi').ok, false);
  // Generals facing directly -> must reject
  assert.equal(validatePositionFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'xiangqi').ok, false);
  // Waiting side (Black) already in check when it is Red's turn -> must reject
  assert.equal(validatePositionFen('3k5/3R5/9/9/9/9/9/9/9/4K4 w - - 0 1', 'xiangqi').ok, false);
  // Jieqi wrong pool sum (15 covered on board, pool says 0) -> must reject
  assert.equal(
    validatePositionFen('xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w - - 0 1 R0N0B0A0C0P0/r0n0b0a0c0p0', 'jieqi').ok,
    false
  );
});

test('3. Rejection suite: malformed JSON, illegal moves, Jieqi pool abuse, zip bomb, prototype pollution, PGN garbage', async () => {
  // Truncated JSON
  assert.equal(fromJson('{"v":1,"variant":').ok, false);
  // Wrong schema version
  assert.equal(fromJson(JSON.stringify({ v: 99, variant: 'xiangqi', start: { fen: START_FEN }, moves: [] })).ok, false);
  // Illegal move at ply 1 (a0a5 is blocked by own soldier/empty? Red chariot a0 cannot jump to a5 because Red soldier at a3 blocks it)
  const ill = fromJson(JSON.stringify({
    v: 1, variant: 'xiangqi', start: { fen: START_FEN }, moves: [{ m: 'a0a5' }], result: 'unfinished',
  }));
  assert.equal(ill.ok, false);
  assert.equal(ill.error.ply, 1);
  assert.ok(ill.error.message.includes('Nước thứ 1'));

  // Move after checkmate (back-rank mate then an extra move)
  const afterMate = fromJson(JSON.stringify({
    v: 1,
    variant: 'xiangqi',
    // Black general at (4,0) boxed by horses at (3,0),(5,0); Red chariots at (0,1) and (4,2) with soldier at (4,1) -> a8e8 is checkmate
    start: { fen: '3nkn3/R3p4/4R4/9/9/9/9/9/9/3K5 w - - 0 1' },
    moves: [{ m: 'a8e8' }, { m: 'd9d8' }],
    result: 'red',
    reason: 'checkmate',
  }));
  assert.equal(afterMate.ok, false);
  assert.equal(afterMate.error.code, 'MOVE_AFTER_GAME_OVER');

  // Claimed checkmate on non-mate position -> downgraded to unfinished with warning
  const fakeMate = fromJson(JSON.stringify({
    v: 1, variant: 'xiangqi', start: { fen: START_FEN }, moves: [{ m: 'h2e2' }], result: 'red', reason: 'checkmate',
  }));
  assert.equal(fakeMate.ok, true);
  assert.equal(fakeMate.record.result, 'unfinished');
  assert.ok(fakeMate.warnings.length >= 1);

  // Jieqi: missing reveal marker on covered piece move (a3a4 is covered Red soldier)
  const missRev = fromJson(JSON.stringify({
    v: 1, variant: 'jieqi', start: { fen: JIEQI_START_PUBLIC_FEN }, moves: [{ m: 'a3a4' }], result: 'unfinished',
  }));
  assert.equal(missRev.ok, false);
  assert.equal(missRev.error.code, 'MISSING_REVEAL');

  // Jieqi: reveal marker on already-open general move (e0e1 is open general)
  const unexpRev = fromJson(JSON.stringify({
    v: 1, variant: 'jieqi', start: { fen: JIEQI_START_PUBLIC_FEN }, moves: [{ m: 'e0e1', r: 'P' }], result: 'unfinished',
  }));
  assert.equal(unexpRev.ok, false);
  assert.equal(unexpRev.error.code, 'UNEXPECTED_REVEAL');

  // Jieqi: revealing an exhausted type (3 Red chariots when pool only has 2)
  const exh = fromJson(JSON.stringify({
    v: 1,
    variant: 'jieqi',
    start: { fen: JIEQI_START_PUBLIC_FEN },
    moves: [
      { m: 'a3a4', r: 'R' },
      { m: 'a6a5', r: 'P' },
      { m: 'c3c4', r: 'R' },
      { m: 'c6c5', r: 'P' },
      { m: 'e3e4', r: 'R' }, // 3rd R -> exhausted!
    ],
    result: 'unfinished',
  }));
  assert.equal(exh.ok, false);
  assert.equal(exh.error.code, 'EXHAUSTED_POOL');

  // Oversized text > 256 KB
  assert.equal(fromJson(' '.repeat(270_000)).ok, false);

  // Too many plies (> 1000)
  const manyMoves = Array.from({ length: 1005 }, () => ({ m: 'h2e2' }));
  assert.equal(fromJson(JSON.stringify({ v: 1, variant: 'xiangqi', start: { fen: START_FEN }, moves: manyMoves })).ok, false);

  // Prototype pollution key (__proto__ / constructor)
  const protoStr = '{"v":1,"variant":"xiangqi","start":{"fen":"' + START_FEN + '"},"moves":[],"__proto__":{"polluted":true}}';
  const protoRes = fromJson(protoStr);
  assert.equal(protoRes.ok, false);
  assert.equal(protoRes.error.code, 'FORBIDDEN_KEY');

  // HTML/script in names & notes sanitized
  const xssRes = fromJson(JSON.stringify({
    v: 1,
    variant: 'xiangqi',
    red: { name: '<script>x</script>Red', kind: 'human' },
    black: { name: '  ', kind: 'human' },
    note: 'Hi\x00\x07 there',
    start: { fen: START_FEN },
    moves: [],
    result: 'unfinished',
  }));
  assert.equal(xssRes.ok, true);
  assert.equal(xssRes.record.red.name.includes('<script>'), false);
  assert.equal(xssRes.record.note, 'Hi there');

  // Zip bomb: compress 350 KB of zeros -> decodeSharePayload must reject with ZIP_BOMB
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(new Uint8Array(350_000));
    w.close();
    const chunks = [];
    const r = cs.readable.getReader();
    while (true) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.byteLength, 0);
    const z = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { z.set(c, off); off += c.byteLength; }
    const b64url = Buffer.from(z).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const zb = await decodeSharePayload(`z.${b64url}`);
    assert.equal(zb.ok, false);
    assert.equal(zb.error.code, 'ZIP_BOMB');
  }

  // PGN with unknown header (accepted) vs garbage between moves (rejected)
  const okPgn = fromPgn('[Game "Xiangqi"]\n[CustomTag "hello"]\n[Result "*"]\n\n1. h2e2 h9g7 *\n');
  assert.equal(okPgn.ok, true);
  const badPgn = fromPgn('[Game "Xiangqi"]\n[Result "*"]\n\n1. h2e2 GARBAGE h9g7 *\n');
  assert.equal(badPgn.ok, false);
});

test('4. Secret safety: 30 Jieqi games never leak unrevealed identities; identical public history -> byte-identical exports', async () => {
  // Two games with DIFFERENT hidden secrets on untouched squares, playing the exact same 2 open/revealed moves
  const bA = new JieqiBoard({ seed: 10 });
  const bB = new JieqiBoard({ seed: 99 });
  bA._secret.set('0,6', 'chariot');
  bB._secret.set('0,6', 'chariot');
  bA._secret.set('0,3', 'horse');
  bB._secret.set('0,3', 'horse');
  assert.notDeepEqual([...bA._secret.entries()], [...bB._secret.entries()]);

  bA.applyMove({ x: 0, y: 6 }, { x: 0, y: 5 });
  bB.applyMove({ x: 0, y: 6 }, { x: 0, y: 5 });
  bA.applyMove({ x: 0, y: 3 }, { x: 0, y: 4 });
  bB.applyMove({ x: 0, y: 3 }, { x: 0, y: 4 });

  const fixedTime = '2026-11-25T00:00:00.000Z';
  const recA = buildRecordFromBoard({ board: bA, variant: 'jieqi', id: '00000000-0000-4000-a000-000000000001', createdAt: fixedTime });
  const recB = buildRecordFromBoard({ board: bB, variant: 'jieqi', id: '00000000-0000-4000-a000-000000000001', createdAt: fixedTime });
  recA.updatedAt = fixedTime;
  recB.updatedAt = fixedTime;

  assert.equal(toJson(recA), toJson(recB));
  assert.equal(toPgn(recA), toPgn(recB));
  const pA = await encodeSharePayload(recA);
  const pB = await encodeSharePayload(recB);
  assert.equal(pA.payload, pB.payload);

  // Scan 30 games with secretLocal attached -> must NEVER appear in JSON, PGN, or share payload
  for (let i = 0; i < 30; i++) {
    const jb = playRandomJieqi(5000 + i, 14);
    const rec = buildRecordFromBoard({ board: jb, variant: 'jieqi' });
    const withSecret = { ...rec, secretLocal: Object.fromEntries(jb._secret.entries()), guestId: 'secret-guest-1234' };
    const js = toJson(withSecret);
    const pg = toPgn(withSecret);
    const sh = await encodeSharePayload(withSecret);
    for (const txt of [js, pg, sh.payload]) {
      assert.equal(txt.includes('secretLocal'), false);
      assert.equal(txt.includes('_secret'), false);
      assert.equal(txt.includes('guestId'), false);
    }
  }
});

test('5. dealRemainingPool preserves pool counts, differs across seeds, and leaves publicFen unchanged', () => {
  const jb = playRandomJieqi(6001, 16);
  const pubBefore = jb.publicFen();
  const pool = jb.getPool();

  const s1 = dealRemainingPool(jb, pool, 111);
  assert.equal(jb.publicFen(), pubBefore);
  const s2 = dealRemainingPool(jb, pool, 222);
  assert.equal(jb.publicFen(), pubBefore);

  // Verify dealt counts per side match pool exactly
  for (const [label, secret] of [['s1', s1], ['s2', s2]]) {
    const counts = { [RED]: {}, [BLACK]: {} };
    for (const [sq, kind] of secret.entries()) {
      const [x, y] = sq.split(',').map(Number);
      const p = jb.at({ x, y });
      assert.ok(p && p.covered, `${label}: dealt to non-covered square ${sq}`);
      counts[p.side][kind] = (counts[p.side][kind] || 0) + 1;
    }
    for (const side of [RED, BLACK]) {
      for (const k of NON_GENERAL_KINDS) {
        assert.equal(counts[side][k] || 0, pool[side][k] || 0, `${label} ${side} ${k} mismatch`);
      }
    }
  }
  assert.notDeepEqual([...s1.entries()], [...s2.entries()]);
});
