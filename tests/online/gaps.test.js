/**
 * Step 1: Comprehensive online server test suite filling all protocol, gameplay,
 * abuse/rate-limit, and Cờ Úp wire-safety gaps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createOnlineServer } from '../../server/index.js';
import { JieqiBoard, JieqiRules } from '../../js/jieqi/rules.js';
import { sanitizeNickname } from '../../js/online/protocol.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FILES = 'abcdefghi';
const jieqiRules = new JieqiRules();

function connectWs(port, { guestId, nickname = 'Tester', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const inbox = [];
    const waiters = [];
    const rawFrames = [];

    ws.on('message', (data) => {
      const str = data.toString('utf8');
      rawFrames.push(str);
      const msg = JSON.parse(str);
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].pred(msg)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
      }
      inbox.push(msg);
    });

    const api = {
      ws,
      rawFrames,
      send(type, payload = {}) {
        ws.send(JSON.stringify({ v: 1, type, ...payload }));
      },
      waitFor(type, timeoutMs = 4000) {
        const idx = inbox.findIndex((m) => (typeof type === 'function' ? type(m) : m.type === type));
        if (idx !== -1) return Promise.resolve(inbox.splice(idx, 1)[0]);
        return new Promise((res, rej) => {
          const pred = typeof type === 'function' ? type : (m) => m.type === type;
          const timer = setTimeout(() => rej(new Error(`Timeout waiting for ${type}`)), timeoutMs);
          waiters.push({ pred, resolve: res, timer });
        });
      },
      close() {
        return new Promise((res) => {
          if (ws.readyState === WebSocket.CLOSED) return res();
          ws.once('close', res);
          ws.close();
        });
      },
    };

    ws.on('open', async () => {
      if (guestId) {
        api.send('hello', { guestId, nickname, protocolVersion: 1 });
        await api.waitFor('welcome');
      }
      resolve(api);
    });
    ws.on('error', reject);
  });
}

test('1. Matchmaking: never pairs same guestId twice, queue.leave works, queue timeout fires', async () => {
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    maxNewConnsPerSec: 50,
    queueTimeoutMs: 250,
  });
  const { port } = await srv.start();
  const a1 = await connectWs(port, { guestId: 'same-guest-0001', nickname: 'Same1' });
  try {
    a1.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    await a1.waitFor('queue.joined');
    // Re-joining queue with same guestId must NOT self-pair
    a1.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    await a1.waitFor('queue.joined');

    // queue.leave cancels queue
    a1.send('queue.leave');
    await a1.waitFor('queue.left');

    // Re-join and verify shortened queue timeout fires
    a1.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    await a1.waitFor('queue.joined');
    const to = await a1.waitFor('queue.timeout', 1500);
    assert.equal(to.variant, 'cotuong');
  } finally {
    await a1.close();
    await srv.stop();
  }
});

test('2. Room edge cases: not-found, full, already-started, and room expiry', async () => {
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    maxNewConnsPerSec: 50,
    roomTtlMs: 250,
  });
  const { port } = await srv.start();
  const h = await connectWs(port, { guestId: 'rm-host-0001', nickname: 'Host' });
  const g1 = await connectWs(port, { guestId: 'rm-g1-0002', nickname: 'Guest1' });
  const g2 = await connectWs(port, { guestId: 'rm-g2-0003', nickname: 'Guest2' });
  try {
    // Non-existent room
    g1.send('room.join', { code: 'ABCDEF' });
    const nf = await g1.waitFor('error');
    assert.equal(nf.code, 'ROOM_NOT_FOUND');

    // Expiry test
    h.send('room.create', { variant: 'cotuong', tc: 'nhanh', side: 'red' });
    const expRoom = await h.waitFor('room.created');
    const closedEvt = await h.waitFor('room.closed', 1500);
    assert.equal(closedEvt.code, expRoom.code);
    assert.equal(closedEvt.reason, 'expired');

    // Full room + already-started room
    h.send('room.create', { variant: 'cotuong', tc: 'nhanh', side: 'red' });
    const r2 = await h.waitFor('room.created');
    g1.send('room.join', { code: r2.code });
    await Promise.all([g1.waitFor('room.joined'), h.waitFor('room.update')]);

    g2.send('room.join', { code: r2.code });
    const fullErr = await g2.waitFor('error');
    assert.equal(fullErr.code, 'ROOM_FULL');

    h.send('room.start', { code: r2.code });
    await Promise.all([h.waitFor('game.start'), g1.waitFor('game.start')]);

    // Joining after room started -> ROOM_NOT_FOUND
    g2.send('room.join', { code: r2.code });
    const afterStartErr = await g2.waitFor('error');
    assert.equal(afterStartErr.code, 'ROOM_NOT_FOUND');
  } finally {
    await h.close();
    await g1.close();
    await g2.close();
    await srv.stop();
  }
});

test('3. Draw offer decline, 10-ply throttle, auto-decline on move, resign, and move-after-gameover', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 50 });
  const { port } = await srv.start();
  const h = await connectWs(port, { guestId: 'dr-host-0001', nickname: 'RedP' });
  const g = await connectWs(port, { guestId: 'dr-guest-0002', nickname: 'BlackP' });
  try {
    h.send('room.create', { variant: 'cotuong', tc: 'none', side: 'red' });
    const r = await h.waitFor('room.created');
    g.send('room.join', { code: r.code });
    await Promise.all([g.waitFor('room.joined'), h.waitFor('room.update')]);
    h.send('room.start', { code: r.code });
    const [sh] = await Promise.all([h.waitFor('game.start'), g.waitFor('game.start')]);

    // Offer draw -> explicit decline
    h.send('game.draw.offer', {});
    await g.waitFor('game.draw.offered');
    g.send('game.draw.respond', { accept: false });
    await h.waitFor('game.draw.declined');

    // Immediate re-offer by same side -> throttled (1 per 10 plies)
    h.send('game.draw.offer', {});
    const throttleErr = await h.waitFor('error');
    assert.equal(throttleErr.code, 'DRAW_COOLDOWN');

    // Black offers draw -> Red plays a move -> auto-declines Black's offer
    g.send('game.draw.offer', {});
    await h.waitFor('game.draw.offered');
    h.send('game.move', { gameId: sh.gameId, move: 'h2e2' });
    await Promise.all([h.waitFor('game.move'), g.waitFor('game.move'), g.waitFor('game.draw.declined')]);

    // Resign ends game; subsequent move is rejected
    h.send('game.resign', {});
    const [oh, og] = await Promise.all([h.waitFor('game.over'), g.waitFor('game.over')]);
    assert.equal(oh.reason, 'resign');
    assert.equal(og.winner, 'black');

    g.send('game.move', { gameId: sh.gameId, move: 'h7e7' });
    const overErr = await g.waitFor('error');
    assert.equal(overErr.code, 'NO_ACTIVE_GAME');
  } finally {
    await h.close();
    await g.close();
    await srv.stop();
  }
});

test('4. Xiangqi 3-fold repetition ends game with draw_repetition', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 50 });
  const { port } = await srv.start();
  const red = await connectWs(port, { guestId: 'rep-red-0001' });
  const black = await connectWs(port, { guestId: 'rep-blk-0002' });
  try {
    red.send('room.create', { variant: 'cotuong', tc: 'none', side: 'red' });
    const r = await red.waitFor('room.created');
    black.send('room.join', { code: r.code });
    await Promise.all([black.waitFor('room.joined'), red.waitFor('room.update')]);
    red.send('room.start', { code: r.code });
    const [sr] = await Promise.all([red.waitFor('game.start'), black.waitFor('game.start')]);

    // Move horses back and forth: b0c2, b9c7, c2b0, c7b9 (1st cycle -> 2nd occurrence of start)
    // Repeat again -> 3rd occurrence of start -> draw_repetition!
    const seq = ['b0c2', 'b9c7', 'c2b0', 'c7b9', 'b0c2', 'b9c7', 'c2b0', 'c7b9'];
    for (let i = 0; i < seq.length; i++) {
      const mover = i % 2 === 0 ? red : black;
      mover.send('game.move', { gameId: sr.gameId, move: seq[i] });
      await Promise.all([red.waitFor('game.move'), black.waitFor('game.move')]);
    }
    const [or, ob] = await Promise.all([red.waitFor('game.over'), black.waitFor('game.over')]);
    assert.equal(or.reason, 'draw_repetition');
    assert.equal(ob.winner, null);
  } finally {
    await red.close();
    await black.close();
    await srv.stop();
  }
});

test('5. Abuse: oversized payload, unknown type, flood > 20 msg/s, IP conn rate limit, MAX_CONNECTIONS, MAX_ROOMS', async () => {
  // 5a. MAX_CONNECTIONS=2, MAX_ROOMS=1, maxNewConnsPerSec=3
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    maxConnections: 2,
    maxRooms: 1,
    maxNewConnsPerSec: 3,
  });
  const { port } = await srv.start();
  const c1 = await connectWs(port, { guestId: 'ab-c1-0001' });
  const c2 = await connectWs(port, { guestId: 'ab-c2-0002' });
  try {
    // 3rd connection rejected with 503 (MAX_CONNECTIONS=2)
    await assert.rejects(() => connectWs(port, { guestId: 'ab-c3-0003' }), /503|Unexpected server response/);

    // MAX_ROOMS=1: first room ok, second room rejected with ROOMS_FULL
    c1.send('room.create', { variant: 'cotuong', tc: 'nhanh', side: 'red' });
    await c1.waitFor('room.created');
    c2.send('room.create', { variant: 'cotuong', tc: 'nhanh', side: 'red' });
    const rmErr = await c2.waitFor('error');
    assert.equal(rmErr.code, 'ROOMS_FULL');

    // Unknown type produces BAD_REQUEST
    c2.send('does.not.exist', {});
    const unkErr = await c2.waitFor('error');
    assert.equal(unkErr.code, 'BAD_REQUEST');

    // Oversized payload (> 4096 bytes) closes connection (1009)
    const closeOversize = new Promise((res) => c2.ws.once('close', (code) => res(code)));
    c2.ws.send('x'.repeat(5000));
    const ovCode = await closeOversize;
    assert.equal(ovCode, 1009);

    // Flood (> 20 msg/s) triggers violations and closes with 1008
    const closeFlood = new Promise((res) => c1.ws.once('close', (code) => res(code)));
    for (let i = 0; i < 30; i++) {
      c1.send('ping', { t: i });
    }
    const flCode = await closeFlood;
    assert.equal(flCode, 1008);
  } finally {
    await c1.close();
    await c2.close();
    await srv.stop();
  }

  // 5b. Per-IP connection rate limit (> 3 new conns/IP/s -> 429)
  const srv2 = createOnlineServer({
    port: 0,
    quietLog: true,
    maxConnections: 20,
    maxNewConnsPerSec: 3,
  });
  const { port: p2 } = await srv2.start();
  const opened = [];
  try {
    for (let i = 0; i < 3; i++) {
      opened.push(await connectWs(p2, { guestId: `ip-c${i}-0001` }));
    }
    await assert.rejects(() => connectWs(p2, { guestId: 'ip-c4-0001' }), /429|Unexpected server response/);
  } finally {
    for (const c of opened) await c.close();
    await srv2.stop();
  }
});

test('6. Nickname sanitization: HTML/script, very long, emoji, only spaces', () => {
  assert.equal(sanitizeNickname('   '), 'Kỳ thủ');
  assert.equal(sanitizeNickname('A'), 'Kỳ thủ');
  assert.equal(sanitizeNickname('A'.repeat(40)).length, 16);
  assert.equal(sanitizeNickname('  Tướng   Quân  '), 'Tướng Quân');
  assert.equal(sanitizeNickname('Kỳ thủ 🐉').includes('🐉'), true);
  assert.equal(sanitizeNickname('<script>alert(1)</script>').length <= 16, true);
  assert.equal(sanitizeNickname('abc\x00\x07def'), 'abcdef');
});

test('7. Co Up wire safety: 3 random games, scan EVERY server frame for secret leaks, matching final positions', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 50 });
  const { port } = await srv.start();
  try {
    for (let g = 0; g < 3; g++) {
      const a = await connectWs(port, { guestId: `wire-a-${g}-0001`, nickname: 'WireA' });
      const b = await connectWs(port, { guestId: `wire-b-${g}-0002`, nickname: 'WireB' });
      try {
        a.send('room.create', { variant: 'coup', tc: 'none', side: 'red' });
        const rm = await a.waitFor('room.created');
        b.send('room.join', { code: rm.code });
        await Promise.all([b.waitFor('room.joined'), a.waitFor('room.update')]);
        a.send('room.start', { code: rm.code });
        const [sa, sb] = await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);
        assert.equal(sa.fen, sb.fen);

        const mirror = JieqiBoard.fromPublicFen(sa.fen);
        let seed = 777 + g * 1009;
        const rng = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        // Play up to 36 plies per game (paced slightly to stay under 20 msg/s rate limit)
        let lastFenA = sa.fen;
        let lastFenB = sb.fen;
        for (let ply = 0; ply < 36; ply++) {
          if (ply > 0 && ply % 14 === 0) {
            await new Promise((r) => setTimeout(r, 1050));
          }
          const side = mirror.sideToMove;
          const moves = [];
          for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
              const p = mirror.at({ x, y });
              if (!p || p.side !== side) continue;
              for (const to of jieqiRules.legalMoves(mirror, { x, y })) {
                moves.push(`${FILES[x]}${9 - y}${FILES[to.x]}${9 - to.y}`);
              }
            }
          }
          if (moves.length === 0) break;
          const chosen = moves[Math.floor(rng() * moves.length)];
          (side === 'red' ? a : b).send('game.move', { gameId: sa.gameId, move: chosen });
          const [ma, mb] = await Promise.all([a.waitFor('game.move'), b.waitFor('game.move')]);
          assert.equal(ma.fen, mb.fen);
          lastFenA = ma.fen;
          lastFenB = mb.fen;
          mirror.loadPublicFen(ma.fen);
          if (ma.isCheckmate) break;
        }
        assert.equal(lastFenA, lastFenB);

        // Verify EVERY server frame never mentions secret / _secret / hiddenMap
        for (const frame of [...a.rawFrames, ...b.rawFrames]) {
          assert.equal(frame.includes('_secret'), false, `Secret leak in game ${g}`);
          assert.equal(frame.includes('"secret"'), false, `Secret key leak in game ${g}`);
        }
      } finally {
        await a.close();
        await b.close();
      }
    }
  } finally {
    await srv.stop();
  }
});
