/**
 * Browser WebSocket client for Online Play:
 * - URL resolution: custom serverUrl -> same origin (/api/online/info) -> :8787 on localhost/LAN
 * - Persistent guestId (UUID) in localStorage
 * - Exponential backoff reconnect (0.5 s .. 8 s) + 15 s heartbeat ping & RTT measurement
 * - Automatic hello handshake & active game resync
 */
import { PROTOCOL_VERSION, sanitizeNickname } from './protocol.js';
import { leakTracker } from '../app/router.js';
import { generateUuidV4 } from '../app/uuid.js';

const GUEST_ID_KEY = 'xq_guest_id_v1';

export function getOrCreateGuestId() {
  try {
    const existing = window.localStorage.getItem(GUEST_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = generateUuidV4();
    window.localStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return generateUuidV4();
  }
}

function toWsUrl(httpOrWsUrl) {
  const raw = String(httpOrWsUrl || '').trim();
  if (!raw) return '';
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    return raw.endsWith('/ws') ? raw : `${raw.replace(/\/+$/, '')}/ws`;
  }
  const wsProto = raw.startsWith('https://') ? 'wss://' : 'ws://';
  const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return stripped.endsWith('/ws') ? `${wsProto}${stripped}` : `${wsProto}${stripped}/ws`;
}

/**
 * Resolve the online WebSocket endpoint.
 * @param {string} [customUrl]
 * @returns {Promise<{ wsUrl: string, info: any } | null>}
 */
export async function resolveOnlineEndpoint(customUrl = '') {
  const candidates = [];
  if (customUrl && customUrl.trim()) {
    const base = customUrl.trim().replace(/\/+$/, '').replace(/^ws/i, 'http').replace(/\/ws$/i, '');
    candidates.push({ http: `${base}/api/online/info`, ws: toWsUrl(customUrl) });
  } else {
    const loc = window.location;
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    candidates.push({
      http: `${loc.origin}/api/online/info`,
      ws: `${wsProto}//${loc.host}/ws`,
    });
    const h = loc.hostname;
    if (
      loc.port !== '8787' &&
      (h === 'localhost' || h === '127.0.0.1' || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(h))
    ) {
      candidates.push({
        http: `http://${h}:8787/api/online/info`,
        ws: `ws://${h}:8787/ws`,
      });
    }
  }

  for (const c of candidates) {
    try {
      const ctrl = new AbortController();
      const tid = window.setTimeout(() => ctrl.abort(), 1800);
      const resp = await fetch(c.http, { signal: ctrl.signal });
      window.clearTimeout(tid);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) {
          return { wsUrl: c.ws, info: data };
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export class OnlineConnection {
  /**
   * @param {{ nickname?: string, serverUrl?: string }} [opts]
   */
  constructor(opts = {}) {
    this.guestId = getOrCreateGuestId();
    this.nickname = sanitizeNickname(opts.nickname || 'Kỳ thủ');
    this.serverUrl = opts.serverUrl || '';
    this.wsUrl = '';
    /** @type {WebSocket | null} */
    this.ws = null;
    this.status = 'idle'; // idle | connecting | open | reconnecting | closed
    this.onlineCount = 0;
    this.rttMs = null;
    this._backoffMs = 500;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._manualClose = false;
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    };
  }

  _emit(type, data) {
    const set = this._listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(data);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  setNickname(name) {
    this.nickname = sanitizeNickname(name);
  }

  async connect() {
    this._manualClose = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return true;
    this.status = 'connecting';
    this._emit('status', { status: this.status });

    const resolved = await resolveOnlineEndpoint(this.serverUrl);
    if (!resolved) {
      this.status = 'offline';
      this._emit('status', { status: 'offline' });
      return false;
    }
    this.wsUrl = resolved.wsUrl;
    this.onlineCount = resolved.info.onlineCount || 0;
    return this._openSocket();
  }

  _openSocket() {
    return new Promise((resolve) => {
      if (this._manualClose) return resolve(false);
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this._backoffMs = 500;
        this.status = 'open';
        this._emit('status', { status: 'open' });
        this.send('hello', {
          guestId: this.guestId,
          nickname: this.nickname,
          protocolVersion: PROTOCOL_VERSION,
        });
        this._startHeartbeat();
        done(true);
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'pong') {
          if (typeof msg.t === 'number') {
            this.rttMs = Math.max(0, Date.now() - msg.t);
          }
          if (typeof msg.onlineCount === 'number') this.onlineCount = msg.onlineCount;
        } else if (msg.type === 'welcome' && typeof msg.onlineCount === 'number') {
          this.onlineCount = msg.onlineCount;
        }
        this._emit(msg.type, msg);
        this._emit('*', msg);
      };

      ws.onerror = () => {
        done(false);
      };

      ws.onclose = (ev) => {
        this._stopHeartbeat();
        if (this.ws === ws) this.ws = null;
        done(false);
        if (this._manualClose) {
          this.status = 'closed';
          this._emit('status', { status: 'closed' });
          return;
        }
        this.status = 'reconnecting';
        this._emit('status', { status: 'reconnecting', code: ev.code });
        this._scheduleReconnect();
      };
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    leakTracker.trackTimer(1);
    this._pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', { t: Date.now() });
      }
    }, 15_000);
  }

  _stopHeartbeat() {
    if (this._pingTimer) {
      window.clearInterval(this._pingTimer);
      this._pingTimer = null;
      leakTracker.trackTimer(-1);
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || this._manualClose) return;
    const delay = this._backoffMs;
    this._backoffMs = Math.min(8000, this._backoffMs * 2);
    leakTracker.trackTimer(1);
    this._reconnectTimer = window.setTimeout(() => {
      this._reconnectTimer = null;
      leakTracker.trackTimer(-1);
      if (!this._manualClose) this._openSocket();
    }, delay);
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type, ...payload }));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this._manualClose = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      window.clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
      leakTracker.trackTimer(-1);
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client closed');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.status = 'closed';
  }
}
