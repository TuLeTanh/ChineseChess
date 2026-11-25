/**
 * Authoritative Node + ws server for Cờ Tướng (Xiangqi) & Cờ Úp (Jieqi) online play.
 * Serves the static front-end (strict whitelist) + GET /api/online/info + WS /ws on one port.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Board } from '../js/model/board.js';
import { START_FEN } from '../js/model/fen.js';
import { RED, BLACK, oppositeSide } from '../js/model/piece.js';
import { XiangqiRules, GameStatus } from '../js/rules.js';
import { JieqiBoard, JieqiRules, REVEAL_ON_CAPTURE } from '../js/jieqi/rules.js';
import {
  PROTOCOL_VERSION,
  ROOM_ALPHABET,
  ROOM_CODE_LEN,
  TIME_CONTROLS,
  isValidVariant,
  isValidTimeControl,
  isValidIccs,
  isValidGuestId,
  normalizeRoomCode,
  isValidRoomCode,
  sanitizeNickname,
} from '../js/online/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'online.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const FILES = 'abcdefghi';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function nowMonoMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function randomRoomCode(existing) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = crypto.randomBytes(ROOM_CODE_LEN);
    let code = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    }
    if (!existing.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function appendLog(line, quiet = false) {
  if (quiet) return;
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const rotated = `${LOG_FILE}.1`;
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(LOG_FILE, rotated);
    }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // ignore logging failure
  }
}

function parseTestTc(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d+)\+(\d+)$/);
  if (!m) return null;
  return { initialMs: Number(m[1]), incrementMs: Number(m[2]) };
}

/**
 * Create an authoritative online server instance.
 */
export function createOnlineServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || 8787);
  const lanMode = Boolean(opts.lan || process.argv.includes('--lan'));
  const host = opts.host ?? process.env.HOST ?? (lanMode ? '0.0.0.0' : '127.0.0.1');
  const maxConnections = opts.maxConnections ?? Number(process.env.MAX_CONNECTIONS || 500);
  const maxRooms = opts.maxRooms ?? Number(process.env.MAX_ROOMS || 200);
  const trustProxy = Boolean(opts.trustProxy ?? process.env.TRUST_PROXY === '1');
  const roomTtlMs = opts.roomTtlMs ?? Number(process.env.ROOM_TTL_MS || 600_000);
  const reconnectGraceMs = opts.reconnectGraceMs ?? Number(process.env.RECONNECT_GRACE_MS || 90_000);
  const queueTimeoutMs = opts.queueTimeoutMs ?? Number(process.env.QUEUE_TIMEOUT_MS || 120_000);
  const maxNewConnsPerSec = opts.maxNewConnsPerSec ?? Number(process.env.MAX_NEW_CONNS_PER_SEC || 3);
  const testTcOverride = opts.testTc ?? parseTestTc(process.env.TEST_TC);
  const quietLog = Boolean(opts.quietLog);
  const allowedOriginsEnv = (opts.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const gameResultEmitter = new EventEmitter();
  const startedAtMs = Date.now();

  const xiangqiRules = new XiangqiRules();
  const jieqiRules = new JieqiRules();

  /** @type {Set<any>} */
  const clients = new Set();
  /** @type {Map<string, any>} guestId -> client session */
  const guestToClient = new Map();
  /** @type {Map<string, any[]>} key "variant:tc" -> queued entries */
  const queues = new Map();
  /** @type {Map<string, any>} code -> room */
  const rooms = new Map();
  /** @type {Map<string, any>} gameId -> game */
  const games = new Map();
  /** @type {Map<string, string>} guestId -> active gameId */
  const guestToGame = new Map();
  /** @type {Map<string, number[]>} ip -> recent connection timestamps */
  const ipConnTimestamps = new Map();

  function getClientIp(req) {
    if (trustProxy && req.headers['x-forwarded-for']) {
      return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function isOriginAllowed(origin, reqHost) {
    if (!origin) return true; // non-browser clients (curl/ws test clients)
    if (allowedOriginsEnv.length > 0) {
      return allowedOriginsEnv.includes(origin);
    }
    try {
      const u = new URL(origin);
      const h = u.hostname.toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
      if (reqHost && u.host.toLowerCase() === String(reqHost).toLowerCase()) return true;
      if (lanMode && (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h))) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function send(client, type, payload = {}) {
    if (!client || !client.ws || client.ws.readyState !== 1) return;
    client.seq = (client.seq || 0) + 1;
    const msg = JSON.stringify({ v: PROTOCOL_VERSION, n: client.seq, type, ...payload });
    try {
      client.ws.send(msg);
    } catch {
      // ignore closed socket
    }
  }

  function recordViolation(client, reason) {
    const now = Date.now();
    client.violations = (client.violations || []).filter((t) => now - t < 10_000);
    client.violations.push(now);
    send(client, 'error', { code: 'BAD_REQUEST', message: reason });
    if (client.violations.length >= 5) {
      appendLog(`VIOLATION_CLOSE ip=${client.ip} guest=${client.guestId || '-'} reason=${reason}`, quietLog);
      try {
        client.ws.close(1008, 'Too many protocol violations');
      } catch {
        // ignore
      }
    }
  }

  function getOnlineStats() {
    const queueCounts = {};
    for (const [k, arr] of queues.entries()) {
      if (arr.length > 0) queueCounts[k] = arr.length;
    }
    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      onlineCount: clients.size,
      activeGames: games.size,
      queueCounts,
      uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
    };
  }

  function removeFromAllQueues(client) {
    for (const [k, arr] of queues.entries()) {
      const idx = arr.findIndex((e) => e.client === client || (client.guestId && e.guestId === client.guestId));
      if (idx !== -1) {
        clearTimeout(arr[idx].timer);
        arr.splice(idx, 1);
      }
      if (arr.length === 0) queues.delete(k);
    }
  }

  function leaveOwnedRoom(client) {
    for (const [code, room] of rooms.entries()) {
      if (room.host.guestId === client.guestId) {
        clearTimeout(room.ttlTimer);
        if (room.guest) {
          const gClient = guestToClient.get(room.guest.guestId);
          send(gClient, 'room.closed', { code, reason: 'host_left' });
        }
        rooms.delete(code);
      } else if (room.guest && room.guest.guestId === client.guestId) {
        room.guest = null;
        const hClient = guestToClient.get(room.host.guestId);
        send(hClient, 'room.update', serializeRoom(room));
      }
    }
  }

  function serializeRoom(room) {
    return {
      code: room.code,
      variant: room.variant,
      tc: room.tc,
      hostSide: room.hostSide,
      host: { nickname: room.host.nickname, ready: true },
      guest: room.guest ? { nickname: room.guest.nickname, ready: true } : null,
    };
  }

  function computeLiveClocks(game) {
    if (game.tc === 'none') return { red: null, black: null };
    const red = game.clocks.red;
    const black = game.clocks.black;
    if (game.over) return { red: Math.max(0, red), black: Math.max(0, black) };
    const elapsed = Math.max(0, nowMonoMs() - game.lastTurnMonoMs);
    if (game.board.sideToMove === RED) {
      return { red: Math.max(0, red - elapsed), black: Math.max(0, black) };
    }
    return { red: Math.max(0, red), black: Math.max(0, black - elapsed) };
  }

  function buildPublicGameState(game, forSide) {
    const clocks = computeLiveClocks(game);
    const opponentSide = oppositeSide(forSide);
    return {
      gameId: game.id,
      variant: game.variant,
      tc: game.tc,
      mySide: forSide,
      sideToMove: game.board.sideToMove,
      fen: game.variant === 'coup' ? game.board.publicFen() : game.board.toFen(),
      pool: game.variant === 'coup' ? game.board.getPool() : null,
      ply: game.board.history.length,
      moves: game.publicMoves,
      clocks,
      players: {
        red: { nickname: game.players.red.nickname, connected: game.players.red.connected },
        black: { nickname: game.players.black.nickname, connected: game.players.black.connected },
      },
      opponentConnected: game.players[opponentSide].connected,
      over: game.over,
      result: game.result || null,
    };
  }

  function startGame({ variant, tc, redPlayer, blackPlayer }) {
    const gameId = crypto.randomBytes(8).toString('hex');
    const tcPreset = TIME_CONTROLS[tc] || TIME_CONTROLS.nhanh;
    const initMs = tc === 'none' ? 0 : (testTcOverride ? testTcOverride.initialMs : tcPreset.initialMs);
    const incMs = tc === 'none' ? 0 : (testTcOverride ? testTcOverride.incrementMs : tcPreset.incrementMs);

    const board =
      variant === 'coup'
        ? new JieqiBoard({ revealOnCapture: REVEAL_ON_CAPTURE })
        : new Board(START_FEN);

    const game = {
      id: gameId,
      variant,
      tc,
      incrementMs: incMs,
      board,
      rules: variant === 'coup' ? jieqiRules : xiangqiRules,
      players: {
        red: { guestId: redPlayer.guestId, nickname: redPlayer.nickname, connected: true, graceTimer: null },
        black: { guestId: blackPlayer.guestId, nickname: blackPlayer.nickname, connected: true, graceTimer: null },
      },
      clocks: { red: initMs, black: initMs },
      lastTurnMonoMs: nowMonoMs(),
      publicMoves: [],
      drawOfferBy: null,
      lastDrawOfferPly: { red: -99, black: -99 },
      rematchRequested: { red: false, black: false },
      over: false,
      result: null,
      cleanupTimer: null,
    };

    games.set(gameId, game);
    guestToGame.set(redPlayer.guestId, gameId);
    guestToGame.set(blackPlayer.guestId, gameId);

    const redClient = guestToClient.get(redPlayer.guestId);
    const blackClient = guestToClient.get(blackPlayer.guestId);
    send(redClient, 'game.start', buildPublicGameState(game, RED));
    send(blackClient, 'game.start', buildPublicGameState(game, BLACK));
    appendLog(`GAME_START id=${gameId} variant=${variant} tc=${tc}`, quietLog);
    return game;
  }

  function finishGame(game, { winner, reason }) {
    if (game.over) return;
    game.over = true;
    const finalClocks = computeLiveClocks(game);
    game.clocks = finalClocks;
    game.result = { winner: winner || null, reason };

    for (const s of [RED, BLACK]) {
      if (game.players[s].graceTimer) {
        clearTimeout(game.players[s].graceTimer);
        game.players[s].graceTimer = null;
      }
    }

    const payload = {
      gameId: game.id,
      winner: winner || null,
      reason,
      clocks: finalClocks,
      ply: game.board.history.length,
    };
    send(guestToClient.get(game.players.red.guestId), 'game.over', payload);
    send(guestToClient.get(game.players.black.guestId), 'game.over', payload);

    gameResultEmitter.emit('game.result', {
      gameId: game.id,
      variant: game.variant,
      tc: game.tc,
      winner: winner || null,
      reason,
      plies: game.board.history.length,
    });
    appendLog(`GAME_OVER id=${game.id} winner=${winner || 'draw'} reason=${reason} plies=${game.board.history.length}`, quietLog);

    // Keep finished game in map briefly for rematch requests, then clean up
    game.cleanupTimer = setTimeout(() => {
      if (guestToGame.get(game.players.red.guestId) === game.id) {
        guestToGame.delete(game.players.red.guestId);
      }
      if (guestToGame.get(game.players.black.guestId) === game.id) {
        guestToGame.delete(game.players.black.guestId);
      }
      games.delete(game.id);
    }, 120_000);
  }

  function handleMove(client, msg) {
    const gameId = guestToGame.get(client.guestId);
    const game = gameId ? games.get(gameId) : null;
    if (!game || game.over) {
      return send(client, 'error', { code: 'NO_ACTIVE_GAME', message: 'Không có ván đấu đang diễn ra.' });
    }
    if (msg.gameId && msg.gameId !== game.id) {
      return recordViolation(client, 'Sai mã ván đấu.');
    }
    const mySide =
      game.players.red.guestId === client.guestId
        ? RED
        : game.players.black.guestId === client.guestId
          ? BLACK
          : null;
    if (!mySide) return recordViolation(client, 'Bạn không thuộc ván đấu này.');
    if (game.board.sideToMove !== mySide) {
      return send(client, 'error', { code: 'NOT_YOUR_TURN', message: 'Chưa đến lượt của bạn.' });
    }
    if (!isValidIccs(msg.move)) {
      return recordViolation(client, 'Định dạng nước đi không hợp lệ.');
    }

    // Check clock before applying move
    if (game.tc !== 'none') {
      const live = computeLiveClocks(game);
      if (live[mySide] <= 0) {
        return finishGame(game, { winner: oppositeSide(mySide), reason: 'timeout' });
      }
      game.clocks[mySide] = live[mySide] + game.incrementMs;
      game.lastTurnMonoMs = nowMonoMs();
    }

    const { from, to } = parseIccs(msg.move);
    const piece = game.board.at(from);
    if (!piece || piece.side !== mySide) {
      return send(client, 'error', { code: 'ILLEGAL_MOVE', message: 'Nước đi không hợp lệ.' });
    }
    const legal = game.rules.legalMoves(game.board, from);
    if (!legal.some((m) => m.x === to.x && m.y === to.y)) {
      return send(client, 'error', { code: 'ILLEGAL_MOVE', message: 'Nước đi phạm luật.' });
    }

    // Auto-decline any pending draw offer when a move is played
    if (game.drawOfferBy) {
      const offerer = game.drawOfferBy;
      game.drawOfferBy = null;
      send(guestToClient.get(game.players[offerer].guestId), 'game.draw.declined', { gameId: game.id });
    }

    const moveRec = game.board.applyMove(from, to);
    const nextSide = game.board.sideToMove;
    const status = game.rules.status(game.board, nextSide);
    const isMate = status === GameStatus.Checkmate;
    const isChk = status === GameStatus.Check || isMate;
    const suffix = isMate ? '#' : status === GameStatus.Check ? '+' : '';
    game.board.setLastMoveFlags({ suffix, gaveCheck: isChk, isCheckmate: isMate });

    const pubMove = {
      iccs: moveRec.iccs,
      side: moveRec.side,
      suffix,
      gaveCheck: isChk,
      isCheckmate: isMate,
      reveal: moveRec.reveal ? { type: moveRec.reveal.type, side: moveRec.reveal.side } : null,
      capturedReveal: moveRec.capturedReveal
        ? { type: moveRec.capturedReveal.type, side: moveRec.capturedReveal.side }
        : null,
    };
    game.publicMoves.push(pubMove);

    const clocks = computeLiveClocks(game);
    const movePayload = {
      gameId: game.id,
      ply: game.board.history.length,
      move: pubMove.iccs,
      side: pubMove.side,
      fen: game.variant === 'coup' ? game.board.publicFen() : game.board.toFen(),
      pool: game.variant === 'coup' ? game.board.getPool() : null,
      reveal: pubMove.reveal,
      capturedReveal: pubMove.capturedReveal,
      suffix,
      gaveCheck: isChk,
      isCheckmate: isMate,
      sideToMove: nextSide,
      clocks,
    };

    send(guestToClient.get(game.players.red.guestId), 'game.move', movePayload);
    send(guestToClient.get(game.players.black.guestId), 'game.move', movePayload);

    if (status === GameStatus.Checkmate) {
      finishGame(game, { winner: mySide, reason: 'checkmate' });
    } else if (status === GameStatus.Stalemate) {
      finishGame(game, { winner: mySide, reason: 'stalemate' });
    } else if (status === GameStatus.DrawRepetition) {
      finishGame(game, { winner: null, reason: 'draw_repetition' });
    } else if (status === GameStatus.DrawNoCapture) {
      finishGame(game, { winner: null, reason: 'draw_no_capture' });
    }
  }

  function handleMessage(client, raw) {
    const now = Date.now();
    client.msgWindow = (client.msgWindow || []).filter((t) => now - t < 1000);
    client.msgWindow.push(now);
    if (client.msgWindow.length > 20) {
      return recordViolation(client, 'Gửi tin nhắn quá nhanh (rate limit).');
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return recordViolation(client, 'JSON không hợp lệ.');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return recordViolation(client, 'Thiếu trường type.');
    }

    if (msg.type === 'ping') {
      return send(client, 'pong', { t: msg.t || Date.now(), onlineCount: clients.size });
    }

    if (msg.type === 'hello') {
      if (!isValidGuestId(msg.guestId)) {
        return recordViolation(client, 'guestId không hợp lệ.');
      }
      client.guestId = msg.guestId;
      client.nickname = sanitizeNickname(msg.nickname);

      const prev = guestToClient.get(client.guestId);
      if (prev && prev !== client) {
        try {
          prev.ws.close(1000, 'Replaced by new session');
        } catch {
          // ignore
        }
      }
      guestToClient.set(client.guestId, client);

      send(client, 'welcome', {
        guestId: client.guestId,
        nickname: client.nickname,
        onlineCount: clients.size,
      });

      // Resync active game if reconnecting
      const activeGameId = guestToGame.get(client.guestId);
      const game = activeGameId ? games.get(activeGameId) : null;
      if (game && !game.over) {
        const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
        const pInfo = game.players[mySide];
        pInfo.connected = true;
        if (pInfo.graceTimer) {
          clearTimeout(pInfo.graceTimer);
          pInfo.graceTimer = null;
        }
        send(client, 'game.state', buildPublicGameState(game, mySide));
        const oppSide = oppositeSide(mySide);
        send(guestToClient.get(game.players[oppSide].guestId), 'opponent.reconnected', {
          gameId: game.id,
        });
      }
      return;
    }

    if (!client.guestId) {
      return recordViolation(client, 'Cần gửi hello trước.');
    }

    if (msg.type === 'queue.join') {
      if (!isValidVariant(msg.variant) || !isValidTimeControl(msg.tc)) {
        return recordViolation(client, 'Tham số tìm trận không hợp lệ.');
      }
      const existingGameId = guestToGame.get(client.guestId);
      if (existingGameId && games.has(existingGameId) && !games.get(existingGameId).over) {
        return send(client, 'error', { code: 'IN_GAME', message: 'Bạn đang trong một ván đấu.' });
      }
      removeFromAllQueues(client);
      leaveOwnedRoom(client);

      const key = `${msg.variant}:${msg.tc}`;
      if (!queues.has(key)) queues.set(key, []);
      const q = queues.get(key);

      // Find first waiting opponent with different guestId
      const oppIdx = q.findIndex((e) => e.guestId !== client.guestId && e.client.ws.readyState === 1);
      if (oppIdx !== -1) {
        const opp = q.splice(oppIdx, 1)[0];
        clearTimeout(opp.timer);
        if (q.length === 0) queues.delete(key);

        const flip = crypto.randomBytes(1)[0] % 2 === 0;
        const redP = flip
          ? { guestId: client.guestId, nickname: client.nickname }
          : { guestId: opp.guestId, nickname: opp.nickname };
        const blackP = flip
          ? { guestId: opp.guestId, nickname: opp.nickname }
          : { guestId: client.guestId, nickname: client.nickname };

        startGame({ variant: msg.variant, tc: msg.tc, redPlayer: redP, blackPlayer: blackP });
      } else {
        const entry = {
          client,
          guestId: client.guestId,
          nickname: client.nickname,
          timer: setTimeout(() => {
            removeFromAllQueues(client);
            send(client, 'queue.timeout', { variant: msg.variant, tc: msg.tc });
          }, queueTimeoutMs),
        };
        q.push(entry);
        send(client, 'queue.joined', {
          variant: msg.variant,
          tc: msg.tc,
          onlineCount: clients.size,
        });
      }
      return;
    }

    if (msg.type === 'queue.leave') {
      removeFromAllQueues(client);
      send(client, 'queue.left', {});
      return;
    }

    if (msg.type === 'room.create') {
      if (!isValidVariant(msg.variant) || !isValidTimeControl(msg.tc)) {
        return recordViolation(client, 'Tham số tạo phòng không hợp lệ.');
      }
      if (rooms.size >= maxRooms) {
        return send(client, 'error', { code: 'ROOMS_FULL', message: 'Máy chủ đã đạt giới hạn số phòng.' });
      }
      removeFromAllQueues(client);
      leaveOwnedRoom(client);

      const code = randomRoomCode(rooms);
      const hostSide = msg.side === RED || msg.side === BLACK ? msg.side : 'random';
      const room = {
        code,
        variant: msg.variant,
        tc: msg.tc,
        hostSide,
        host: { guestId: client.guestId, nickname: client.nickname },
        guest: null,
        ttlTimer: setTimeout(() => {
          const r = rooms.get(code);
          if (!r) return;
          rooms.delete(code);
          send(guestToClient.get(r.host.guestId), 'room.closed', { code, reason: 'expired' });
          if (r.guest) send(guestToClient.get(r.guest.guestId), 'room.closed', { code, reason: 'expired' });
        }, roomTtlMs),
      };
      rooms.set(code, room);
      send(client, 'room.created', serializeRoom(room));
      return;
    }

    if (msg.type === 'room.join') {
      const code = normalizeRoomCode(msg.code);
      if (!isValidRoomCode(code)) {
        return send(client, 'error', { code: 'INVALID_CODE', message: 'Mã phòng không hợp lệ.' });
      }
      const room = rooms.get(code);
      if (!room) {
        return send(client, 'error', { code: 'ROOM_NOT_FOUND', message: 'Không tìm thấy phòng hoặc phòng đã hết hạn.' });
      }
      if (room.host.guestId === client.guestId) {
        return send(client, 'room.update', serializeRoom(room));
      }
      if (room.guest && room.guest.guestId !== client.guestId) {
        return send(client, 'error', { code: 'ROOM_FULL', message: 'Phòng đã đủ 2 người chơi.' });
      }
      removeFromAllQueues(client);
      room.guest = { guestId: client.guestId, nickname: client.nickname };
      const snap = serializeRoom(room);
      send(client, 'room.joined', snap);
      send(guestToClient.get(room.host.guestId), 'room.update', snap);
      return;
    }

    if (msg.type === 'room.leave') {
      leaveOwnedRoom(client);
      send(client, 'room.left', {});
      return;
    }

    if (msg.type === 'room.start') {
      const code = normalizeRoomCode(msg.code);
      const room = rooms.get(code);
      if (!room || room.host.guestId !== client.guestId) {
        return send(client, 'error', { code: 'NOT_HOST', message: 'Chỉ chủ phòng mới có thể bắt đầu.' });
      }
      if (!room.guest) {
        return send(client, 'error', { code: 'WAITING_GUEST', message: 'Chưa có đối thủ vào phòng.' });
      }
      clearTimeout(room.ttlTimer);
      rooms.delete(code);

      let hostIsRed = room.hostSide === RED;
      if (room.hostSide === 'random') {
        hostIsRed = crypto.randomBytes(1)[0] % 2 === 0;
      }
      const redPlayer = hostIsRed ? room.host : room.guest;
      const blackPlayer = hostIsRed ? room.guest : room.host;
      startGame({ variant: room.variant, tc: room.tc, redPlayer, blackPlayer });
      return;
    }

    if (msg.type === 'game.move') {
      return handleMove(client, msg);
    }

    if (msg.type === 'game.resign') {
      const gameId = guestToGame.get(client.guestId);
      const game = gameId ? games.get(gameId) : null;
      if (!game || game.over) return;
      const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
      finishGame(game, { winner: oppositeSide(mySide), reason: 'resign' });
      return;
    }

    if (msg.type === 'game.draw.offer') {
      const gameId = guestToGame.get(client.guestId);
      const game = gameId ? games.get(gameId) : null;
      if (!game || game.over) return;
      const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
      const ply = game.board.history.length;
      if (ply - game.lastDrawOfferPly[mySide] < 10) {
        return send(client, 'error', { code: 'DRAW_COOLDOWN', message: 'Vui lòng chờ thêm nước đi trước khi xin hòa lại.' });
      }
      game.lastDrawOfferPly[mySide] = ply;
      game.drawOfferBy = mySide;
      const oppSide = oppositeSide(mySide);
      send(guestToClient.get(game.players[oppSide].guestId), 'game.draw.offered', {
        gameId: game.id,
        by: mySide,
      });
      return;
    }

    if (msg.type === 'game.draw.respond') {
      const gameId = guestToGame.get(client.guestId);
      const game = gameId ? games.get(gameId) : null;
      if (!game || game.over || !game.drawOfferBy) return;
      const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
      if (game.drawOfferBy === mySide) return;
      const offerer = game.drawOfferBy;
      game.drawOfferBy = null;
      if (msg.accept) {
        finishGame(game, { winner: null, reason: 'draw_agreement' });
      } else {
        send(guestToClient.get(game.players[offerer].guestId), 'game.draw.declined', { gameId: game.id });
      }
      return;
    }

    if (msg.type === 'game.rematch') {
      const gameId = guestToGame.get(client.guestId);
      const game = gameId ? games.get(gameId) : null;
      if (!game || !game.over) return;
      const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
      game.rematchRequested[mySide] = true;
      const oppSide = oppositeSide(mySide);
      if (game.rematchRequested.red && game.rematchRequested.black) {
        if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
        games.delete(game.id);
        // Swap colors for rematch
        startGame({
          variant: game.variant,
          tc: game.tc,
          redPlayer: { guestId: game.players.black.guestId, nickname: game.players.black.nickname },
          blackPlayer: { guestId: game.players.red.guestId, nickname: game.players.red.nickname },
        });
      } else {
        send(guestToClient.get(game.players[oppSide].guestId), 'game.rematch.offered', {
          gameId: game.id,
        });
      }
      return;
    }

    recordViolation(client, `Không hỗ trợ loại tin nhắn: ${msg.type}`);
  }

  function handleDisconnect(client) {
    clients.delete(client);
    removeFromAllQueues(client);
    if (!client.guestId) return;

    if (guestToClient.get(client.guestId) === client) {
      guestToClient.delete(client.guestId);
    } else {
      return; // superseded by newer connection
    }

    leaveOwnedRoom(client);

    const gameId = guestToGame.get(client.guestId);
    const game = gameId ? games.get(gameId) : null;
    if (!game || game.over) return;

    const mySide = game.players.red.guestId === client.guestId ? RED : BLACK;
    const oppSide = oppositeSide(mySide);
    const pInfo = game.players[mySide];
    pInfo.connected = false;
    const grace = game.tc === 'none' ? Math.max(reconnectGraceMs, 180_000) : reconnectGraceMs;

    send(guestToClient.get(game.players[oppSide].guestId), 'opponent.disconnected', {
      gameId: game.id,
      graceMs: grace,
    });

    pInfo.graceTimer = setTimeout(() => {
      if (!game.over && !pInfo.connected) {
        finishGame(game, { winner: oppSide, reason: 'abandon' });
      }
    }, grace);
  }

  // Clock timeout ticker (250 ms)
  const clockInterval = setInterval(() => {
    for (const game of games.values()) {
      if (game.over || game.tc === 'none') continue;
      const live = computeLiveClocks(game);
      const side = game.board.sideToMove;
      if (live[side] <= 0) {
        finishGame(game, { winner: oppositeSide(side), reason: 'timeout' });
      }
    }
  }, 250);

  // Strict static file whitelist
  function serveStatic(req, res, urlPath) {
    if (urlPath.includes('\0') || urlPath.includes('..') || urlPath.toLowerCase().includes('%2e')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
    const allowed =
      cleanPath === '/index.html' ||
      cleanPath === '/favicon.ico' ||
      cleanPath === '/favicon.svg' ||
      cleanPath.startsWith('/css/') ||
      cleanPath.startsWith('/js/') ||
      cleanPath.startsWith('/assets/');
    if (!allowed) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const fullPath = path.resolve(PROJECT_ROOT, '.' + cleanPath);
    if (!fullPath.startsWith(PROJECT_ROOT + path.sep) && fullPath !== path.join(PROJECT_ROOT, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (cleanPath === '/assets/voice/manifest.json' && !fs.existsSync(fullPath)) {
      const body = JSON.stringify({ empty: true, files: {} });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }

    if (cleanPath === '/assets/sounds/' || cleanPath === '/assets/sounds') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body></body></html>');
      return;
    }

    if (cleanPath === '/favicon.ico' && !fs.existsSync(fullPath)) {
      res.writeHead(204);
      res.end();
      return;
    }

    fs.stat(fullPath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': st.size,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self'; frame-ancestors 'none';",
      });
      fs.createReadStream(fullPath).pipe(res);
    });
  }

  const httpServer = http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const origin = req.headers.origin;

    if (urlObj.pathname === '/api/online/info') {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      };
      if (origin && isOriginAllowed(origin, req.headers.host)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(getOnlineStats()));
      return;
    }

    if (urlObj.pathname === '/api/engine/info') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ available: false }));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    serveStatic(req, res, urlObj.pathname);
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (clients.size >= maxConnections) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    const ip = getClientIp(req);
    const now = Date.now();
    const arr = (ipConnTimestamps.get(ip) || []).filter((t) => now - t < 1000);
    if (arr.length >= maxNewConnsPerSec) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    arr.push(now);
    ipConnTimestamps.set(ip, arr);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const client = {
      ws,
      ip: getClientIp(req),
      guestId: null,
      nickname: 'Kỳ thủ',
      seq: 0,
      msgWindow: [],
      violations: [],
    };
    clients.add(client);

    ws.on('message', (data) => {
      const str = typeof data === 'string' ? data : data.toString('utf8');
      handleMessage(client, str);
    });
    ws.on('close', () => handleDisconnect(client));
    ws.on('error', () => handleDisconnect(client));
  });

  async function start() {
    await new Promise((resolve) => httpServer.listen(port, host, resolve));
    const addr = httpServer.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    appendLog(`SERVER_START host=${host} port=${actualPort} lan=${lanMode}`, quietLog);
    return { host, port: actualPort };
  }

  async function stop() {
    clearInterval(clockInterval);
    for (const q of queues.values()) {
      for (const e of q) clearTimeout(e.timer);
    }
    queues.clear();
    for (const r of rooms.values()) clearTimeout(r.ttlTimer);
    rooms.clear();
    for (const g of games.values()) {
      if (g.cleanupTimer) clearTimeout(g.cleanupTimer);
      for (const s of [RED, BLACK]) {
        if (g.players[s].graceTimer) clearTimeout(g.players[s].graceTimer);
      }
    }
    games.clear();
    for (const c of clients) {
      try {
        c.ws.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    clients.clear();
    await new Promise((resolve) => httpServer.close(() => resolve()));
  }

  return {
    httpServer,
    wss,
    gameResultEmitter,
    start,
    stop,
    getStats: getOnlineStats,
  };
}

// Direct CLI invocation: `node server/index.js [--lan]`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const srv = createOnlineServer({});
  srv.start().then(({ host, port }) => {
    console.log(`[online-server] Listening on http://${host}:${port} (WS /ws)`);
  });
  const shutdown = () => {
    console.log('\n[online-server] Shutting down gracefully...');
    srv.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
