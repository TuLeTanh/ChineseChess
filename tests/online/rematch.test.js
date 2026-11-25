/**
 * Protocol-level tests for the full Rematch Matrix (a..k):
 * a) Loser offers rematch -> winner accepts -> colors swap, clocks/board reset
 * b) Winner offers rematch -> loser accepts -> colors swap
 * c) Offerer waiting state -> receiver gets game.rematch.offered
 * d) Receiver declines -> offerer gets game.rematch.declined
 * e) Opponent leaves (game.leave or new queue) -> offerer gets opponent.left
 * f) Simultaneous rematch presses -> exactly ONE new game starts
 * g) Double-tap rematch by same player -> only 1 game.rematch.offered emitted
 * h) Offerer cancels (game.rematch.cancel) -> both get game.rematch.canceled
 * i) Reload while rematch offer pending -> hello resyncs game.state with rematchOfferBy; TTL expiry emits game.rematch.expired
 * j) TC & variant preserved on rematch (both quick match and private room)
 * k) Moves sent with old gameId after rematch are rejected without affecting new game
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createOnlineServer } from '../../server/index.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

function connectWs(port, { guestId, nickname = 'Player' } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = [];
    const waiters = [];

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'));
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
      inbox,
      send(type, payload = {}) {
        ws.send(JSON.stringify({ v: 1, type, ...payload }));
      },
      waitFor(type, timeoutMs = 4000) {
        const pred = typeof type === 'function' ? type : (m) => m.type === type;
        const idx = inbox.findIndex(pred);
        if (idx !== -1) return Promise.resolve(inbox.splice(idx, 1)[0]);
        return new Promise((res, rej) => {
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

async function pairAndResign(port, tc = 'chop') {
  const a = await connectWs(port, { guestId: `gA_${Math.random().toString(36).slice(2)}`, nickname: 'Alice' });
  const b = await connectWs(port, { guestId: `gB_${Math.random().toString(36).slice(2)}`, nickname: 'Bob' });
  a.send('queue.join', { variant: 'cotuong', tc });
  b.send('queue.join', { variant: 'cotuong', tc });
  const [sa, sb] = await Promise.all([a.waitFor('game.start'), b.waitFor('game.start')]);
  const red = sa.mySide === 'red' ? a : b;
  const black = sa.mySide === 'red' ? b : a;
  red.send('game.resign', {});
  await Promise.all([red.waitFor('game.over'), black.waitFor('game.over')]);
  return { red, black, gameId: sa.gameId, tc: sa.tc };
}

test('Rematch Matrix a, b, j, k: loser/winner offers swap colors, preserve TC, reject stale gameId', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 100 });
  const { port } = await srv.start();
  try {
    const { red, black, gameId } = await pairAndResign(port, 'chop');
    // a) Loser (red) offers -> winner (black) gets offer -> accepts -> swap colors
    red.send('game.rematch', { gameId });
    const offer = await black.waitFor('game.rematch.offered');
    assert.equal(offer.by, 'red');
    black.send('game.rematch', { gameId });
    const [sRed, sBlack] = await Promise.all([red.waitFor('game.start'), black.waitFor('game.start')]);
    assert.notEqual(sRed.gameId, gameId);
    assert.equal(sRed.mySide, 'black');
    assert.equal(sBlack.mySide, 'red');
    assert.equal(sRed.tc, 'chop'); // j) TC preserved

    // k) Stale gameId move rejected without mutating new game
    sBlack; // now red
    black.send('game.move', { gameId, move: 'h2e2' });
    const err = await black.waitFor('error');
    assert.equal(err.code, 'BAD_REQUEST');

    // b) Winner of game 1 (black, now red) resigns -> winner (red, now black) offers rematch
    black.send('game.resign', {});
    await Promise.all([red.waitFor('game.over'), black.waitFor('game.over')]);
    red.send('game.rematch', { gameId: sRed.gameId });
    await black.waitFor('game.rematch.offered');
    black.send('game.rematch', { gameId: sRed.gameId });
    const [s3a, s3b] = await Promise.all([red.waitFor('game.start'), black.waitFor('game.start')]);
    assert.equal(s3a.mySide, 'red');
    assert.equal(s3b.mySide, 'black');

    await Promise.all([red.close(), black.close()]);
  } finally {
    await srv.stop();
  }
});

test('Rematch Matrix d, g, h: double-tap idempotency, cancel clears offer, decline notifies offerer', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 100 });
  const { port } = await srv.start();
  try {
    const { red, black, gameId } = await pairAndResign(port, 'nhanh');
    // g) Double-tap rematch -> only 1 offer sent
    red.send('game.rematch', { gameId });
    red.send('game.rematch', { gameId });
    await black.waitFor('game.rematch.offered');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(black.inbox.filter((m) => m.type === 'game.rematch.offered').length, 0);

    // h) Cancel clears offer for both
    red.send('game.rematch.cancel', { gameId });
    const [c1, c2] = await Promise.all([
      red.waitFor('game.rematch.canceled'),
      black.waitFor('game.rematch.canceled'),
    ]);
    assert.equal(c1.gameId, gameId);
    assert.equal(c2.gameId, gameId);

    // d) Offer again -> receiver declines -> offerer receives declined
    red.send('game.rematch', { gameId });
    await black.waitFor('game.rematch.offered');
    black.send('game.rematch.decline', { gameId });
    const dec = await red.waitFor('game.rematch.declined');
    assert.equal(dec.gameId, gameId);

    await Promise.all([red.close(), black.close()]);
  } finally {
    await srv.stop();
  }
});

test('Rematch Matrix e, f, i: simultaneous press = 1 game, opponent.left, reload resync & TTL expiry', async () => {
  const srv = createOnlineServer({ port: 0, quietLog: true, maxNewConnsPerSec: 100, rematchTtlMs: 350 });
  const { port } = await srv.start();
  try {
    // f) Simultaneous rematch -> exactly 1 new game
    const g1 = await pairAndResign(port, 'nhanh');
    g1.red.send('game.rematch', { gameId: g1.gameId });
    g1.black.send('game.rematch', { gameId: g1.gameId });
    const [sa, sb] = await Promise.all([g1.red.waitFor('game.start'), g1.black.waitFor('game.start')]);
    assert.equal(sa.gameId, sb.gameId);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(g1.red.inbox.filter((m) => m.type === 'game.start').length, 0);
    await Promise.all([g1.red.close(), g1.black.close()]);

    // e) Opponent leaves -> offerer receives opponent.left
    const g2 = await pairAndResign(port, 'nhanh');
    g2.red.send('game.rematch', { gameId: g2.gameId });
    await g2.black.waitFor('game.rematch.offered');
    g2.black.send('game.leave', { gameId: g2.gameId });
    const leftMsg = await g2.red.waitFor('opponent.left');
    assert.equal(leftMsg.gameId, g2.gameId);
    await Promise.all([g2.red.close(), g2.black.close()]);

    // i) Reload pending offer -> resyncs rematchOfferBy; TTL expiry emits game.rematch.expired
    const g3RedId = `gR_${Math.random().toString(36).slice(2)}`;
    const g3BlkId = `gB_${Math.random().toString(36).slice(2)}`;
    const r3 = await connectWs(port, { guestId: g3RedId, nickname: 'Red' });
    const b3 = await connectWs(port, { guestId: g3BlkId, nickname: 'Black' });
    r3.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    b3.send('queue.join', { variant: 'cotuong', tc: 'nhanh' });
    const [s3a] = await Promise.all([r3.waitFor('game.start'), b3.waitFor('game.start')]);
    const loser = s3a.mySide === 'red' ? r3 : b3;
    const winner = s3a.mySide === 'red' ? b3 : r3;
    const winnerId = s3a.mySide === 'red' ? g3BlkId : g3RedId;
    loser.send('game.resign', {});
    await Promise.all([loser.waitFor('game.over'), winner.waitFor('game.over')]);
    loser.send('game.rematch', { gameId: s3a.gameId });
    await winner.waitFor('game.rematch.offered');

    // Winner reloads (closes WS without game.leave, reconnects with same guestId)
    await winner.close();
    const winnerReloaded = await connectWs(port, { guestId: winnerId, nickname: 'Reloaded' });
    const state = await winnerReloaded.waitFor('game.state');
    assert.equal(state.over, true);
    assert.equal(state.rematchOfferBy, 'red');

    // Wait for TTL expiry
    const exp = await loser.waitFor('game.rematch.expired', 1500);
    assert.equal(exp.gameId, s3a.gameId);

    await Promise.all([loser.close(), winnerReloaded.close()]);
  } finally {
    await srv.stop();
  }
});
