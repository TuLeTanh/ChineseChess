import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createOnlineServer } from '../../server/index.js';
import { JieqiBoard, JieqiRules } from '../../js/jieqi/rules.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FILES = 'abcdefghi';
const jieqiRules = new JieqiRules();

function httpGet(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

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

test('1. HTTP info endpoint, static whitelist, and path traversal rejection', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 30 });
  const { port } = await srv.start();
  try {
    const info = await httpGet(port, '/api/online/info');
    assert.equal(info.status, 200);
    const json = JSON.parse(info.body);
    assert.equal(json.ok, true);
    assert.equal(json.protocolVersion, 1);

    const idx = await httpGet(port, '/');
    assert.equal(idx.status, 200);
    assert.ok(idx.headers['content-security-policy']);

    const bad1 = await httpGet(port, '/server/index.js');
    assert.ok(bad1.status === 403 || bad1.status === 404);

    const bad2 = await httpGet(port, '/js/..%2fserver/package.json');
    assert.ok(bad2.status === 403 || bad2.status === 404);
  } finally {
    await srv.stop();
  }
});

test('2. Quick-match Xiangqi: pairing, move validation, illegal rejection, monotonic seq, RTT', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 30 });
  const { port } = await srv.start();
  const a = await connectWs(port, { guestId: 'guest-alpha-0001', nickname: 'Alpha' });
  const b = await connectWs(port, { guestId: 'guest-beta-0002', nickname: 'Beta' });
  try {
    // RTT ping
    const t0 = Date.now();
    a.send('ping', { t: t0 });
    const pong = await a.waitFor('pong');
    assert.ok(Date.now() - pong.t < 500);

    a.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    await a.waitFor('queue.joined');
    b.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });

    const [sa, sb] = await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);
    assert.equal(sa.gameId, sb.gameId);
    assert.notEqual(sa.mySide, sb.mySide);

    const red = sa.mySide === 'red' ? a : b;
    const black = sa.mySide === 'red' ? b : a;

    // Out-of-turn rejected
    black.send('game.move', { gameId: sa.gameId, move: 'h7e7' });
    const errTurn = await black.waitFor('error');
    assert.equal(errTurn.code, 'NOT_YOUR_TURN');

    // Illegal move rejected
    red.send('game.move', { gameId: sa.gameId, move: 'a0a5' });
    const errIll = await red.waitFor('error');
    assert.equal(errIll.code, 'ILLEGAL_MOVE');

    // Valid opening move: h2e2 (Red right cannon to center)
    const redStartN = sa.mySide === 'red' ? sa.n : sb.n;
    red.send('game.move', { gameId: sa.gameId, move: 'h2e2' });
    const [m1, m2] = await Promise.all([red.waitFor('game.move'), black.waitFor('game.move')]);
    assert.equal(m1.move, 'h2e2');
    assert.equal(m2.ply, 1);
    assert.ok(m1.n > redStartN);
  } finally {
    await a.close();
    await b.close();
    await srv.stop();
  }
});

test('3. Private room: create -> join -> start -> draw agreement -> rematch swaps colors', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 30 });
  const { port } = await srv.start();
  const host = await connectWs(port, { guestId: 'room-host-0001', nickname: 'Host' });
  const guest = await connectWs(port, { guestId: 'room-guest-0002', nickname: 'Guest' });
  try {
    host.send('room.create', { variant: 'cotuong', tc: 'chop', side: 'red' });
    const created = await host.waitFor('room.created');
    assert.equal(created.code.length, 6);

    guest.send('room.join', { code: created.code });
    await Promise.all([guest.waitFor('room.joined'), host.waitFor('room.update')]);

    host.send('room.start', { code: created.code });
    const [sh, sg] = await Promise.all([host.waitFor('game.start'), guest.waitFor('game.start')]);
    assert.equal(sh.mySide, 'red');
    assert.equal(sg.mySide, 'black');

    // Draw offer & accept
    host.send('game.draw.offer', {});
    await guest.waitFor('game.draw.offered');
    guest.send('game.draw.respond', { accept: true });
    const [oh, og] = await Promise.all([host.waitFor('game.over'), guest.waitFor('game.over')]);
    assert.equal(oh.reason, 'draw_agreement');
    assert.equal(og.winner, null);

    // Rematch swaps colors
    host.send('game.rematch', {});
    await guest.waitFor('game.rematch.offered');
    guest.send('game.rematch', {});
    const [sh2, sg2] = await Promise.all([host.waitFor('game.start'), guest.waitFor('game.start')]);
    assert.equal(sh2.mySide, 'black');
    assert.equal(sg2.mySide, 'red');
  } finally {
    await host.close();
    await guest.close();
    await srv.stop();
  }
});

test('4. Co Up online: 24 plies with reveals and strict NO-LEAK wire scan', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 30 });
  const { port } = await srv.start();
  const a = await connectWs(port, { guestId: 'jieqi-p1-0001', nickname: 'P1' });
  const b = await connectWs(port, { guestId: 'jieqi-p2-0002', nickname: 'P2' });
  try {
    a.send('queue.join', { variant: 'coup', tc: 'none' });
    await a.waitFor('queue.joined');
    b.send('queue.join', { variant: 'coup', tc: 'none' });

    const [sa, sb] = await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);
    const players = sa.mySide === 'red' ? { red: a, black: b } : { red: b, black: a };
    const mirror = JieqiBoard.fromPublicFen(sa.fen);

    let revealsSeen = 0;
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let ply = 0; ply < 24; ply++) {
      const side = mirror.sideToMove;
      const all = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 9; x++) {
          const p = mirror.at({ x, y });
          if (!p || p.side !== side) continue;
          for (const to of jieqiRules.legalMoves(mirror, { x, y })) {
            all.push({ covered: p.covered, iccs: `${FILES[x]}${9 - y}${FILES[to.x]}${9 - to.y}` });
          }
        }
      }
      if (all.length === 0) break;
      // Prefer covered-piece moves early so plenty of reveals occur without repeating
      const coveredMoves = all.filter((m) => m.covered);
      const pool = coveredMoves.length > 0 ? coveredMoves : all;
      const chosen = pool[Math.floor(nextRand() * pool.length)].iccs;
      players[side].send('game.move', { gameId: sa.gameId, move: chosen });
      const [ma, mb] = await Promise.all([a.waitFor('game.move'), b.waitFor('game.move')]);
      assert.equal(ma.fen, mb.fen);
      if (ma.reveal) revealsSeen++;
      mirror.loadPublicFen(ma.fen);
      if (ma.isCheckmate) break;
    }
    assert.ok(revealsSeen >= 4, `expected reveals, saw ${revealsSeen}`);

    // Scan every raw WebSocket frame for any secret leak
    for (const raw of [...a.rawFrames, ...b.rawFrames]) {
      assert.equal(raw.includes('_secret'), false, 'Frame leaked _secret!');
      assert.equal(raw.includes('secret'), false, 'Frame leaked secret!');
    }
  } finally {
    await a.close();
    await b.close();
    await srv.stop();
  }
});

test('5. Clock timeout ends game automatically with reason=timeout', async () => {
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    maxNewConnsPerSec: 30,
    testTc: { initialMs: 350, incrementMs: 0 },
  });
  const { port } = await srv.start();
  const a = await connectWs(port, { guestId: 'clock-p1-0001' });
  const b = await connectWs(port, { guestId: 'clock-p2-0002' });
  try {
    a.send('queue.join', { variant: 'cotuong', tc: 'chop' });
    await a.waitFor('queue.joined');
    b.send('queue.join', { variant: 'cotuong', tc: 'chop' });
    await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);

    const [oa, ob] = await Promise.all([a.waitFor('game.over', 3000), b.waitFor('game.over', 3000)]);
    assert.equal(oa.reason, 'timeout');
    assert.equal(oa.winner, 'black');
    assert.equal(ob.winner, 'black');
  } finally {
    await a.close();
    await b.close();
    await srv.stop();
  }
});

test('6. Reconnect resyncs game.state; abandon grace timeout forfeits game', async () => {
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    maxNewConnsPerSec: 30,
    reconnectGraceMs: 400,
  });
  const { port } = await srv.start();
  const a = await connectWs(port, { guestId: 'reconn-p1-0001', nickname: 'One' });
  const b = await connectWs(port, { guestId: 'reconn-p2-0002', nickname: 'Two' });
  try {
    a.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    await a.waitFor('queue.joined');
    b.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    const [sa] = await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);

    // Disconnect A and reconnect immediately
    await a.close();
    await b.waitFor('opponent.disconnected');

    const a2 = await connectWs(port, { guestId: 'reconn-p1-0001', nickname: 'One' });
    const [state, reconnEvt] = await Promise.all([a2.waitFor('game.state'), b.waitFor('opponent.reconnected')]);
    assert.equal(state.gameId, sa.gameId);
    assert.equal(reconnEvt.gameId, sa.gameId);

    // Now disconnect A permanently -> abandon after 400 ms
    await a2.close();
    const over = await b.waitFor('game.over', 2000);
    assert.equal(over.reason, 'abandon');
    assert.equal(over.winner, sa.mySide === 'red' ? 'black' : 'red');
  } finally {
    await b.close();
    await srv.stop();
  }
});

test('7. Security: disallowed Origin rejected (403) and 5 protocol violations close with 1008', async () => {
  const srv = createOnlineServer({
    port: 0,
    quietLog: true,
    allowedOrigins: 'http://allowed.example',
    maxNewConnsPerSec: 30,
  });
  const { port } = await srv.start();
  try {
    // Disallowed origin rejected at upgrade
    await assert.rejects(
      () => connectWs(port, { headers: { Origin: 'http://evil.example' } }),
      /403|Unexpected server response/
    );

    // 5 bad JSON messages -> close 1008
    const c = await connectWs(port, { headers: { Origin: 'http://allowed.example' } });
    const closePromise = new Promise((res) => c.ws.once('close', (code) => res(code)));
    for (let i = 0; i < 6; i++) {
      c.ws.send('not-json-{{{');
    }
    const closeCode = await closePromise;
    assert.equal(closeCode, 1008);
  } finally {
    await srv.stop();
  }
});
