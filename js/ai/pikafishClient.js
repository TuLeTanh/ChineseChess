/**
 * Pikafish HTTP/SSE bridge client implementing the Engine interface.
 * Talks to tools/server.py endpoints (/api/engine/info, /search, /stop, /newgame, /stream).
 */
import { Engine } from '../engine.js';
import { getPikafishLevel, scoreObjToCp, pickPikafishLine } from './levelsPikafish.js';

export class PikafishClient extends Engine {
  constructor() {
    super();
    this.info = { available: false, name: null, version: null, cpu_build: null, options: [] };
    this._nextId = 1;
    /** @type {string | null} */
    this._activeId = null;
    /** @type {AbortController | null} */
    this._abort = null;
    /** @type {EventSource | null} */
    this._es = null;
  }

  /**
   * Probe GET /api/engine/info once to check if the bridge & Pikafish are available.
   * Never throws or logs errors when plain http.server is used.
   */
  async probeInfo() {
    try {
      const resp = await fetch('/api/engine/info', { cache: 'no-store' });
      if (!resp.ok) {
        this.info = { available: false, name: null, version: null, cpu_build: null, options: [] };
        return this.info;
      }
      const data = await resp.json();
      this.info = data && data.available ? data : { available: false, options: [] };
      return this.info;
    } catch {
      this.info = { available: false, name: null, version: null, cpu_build: null, options: [] };
      return this.info;
    }
  }

  isAvailable() {
    return Boolean(this.info && this.info.available);
  }

  /** Cancel any in-flight search cleanly (AbortController + EventSource close + POST /stop). */
  cancel() {
    const id = this._activeId;
    this._activeId = null;
    if (this._es) {
      this._es.close();
      this._es = null;
    }
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    if (id && this.isAvailable()) {
      fetch('/api/engine/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    }
  }

  /** Notify Pikafish of a new game. */
  async newGame() {
    if (!this.isAvailable()) return;
    try {
      await fetch('/api/engine/newgame', { method: 'POST' });
    } catch {
      // ignore
    }
  }

  /**
   * Search for the best move via Pikafish bridge.
   * @param {{
   *   fen: string,
   *   moves?: string[],
   *   level?: string,
   *   onInfo?: (info: { depth: number, score: number, scoreObj: any, nodes: number, nps: number }) => void,
   * }} req
   */
  async search(req) {
    this.cancel();
    if (!this.isAvailable()) return null;

    const id = `pf-${Date.now()}-${this._nextId++}`;
    this._activeId = id;
    const abort = new AbortController();
    this._abort = abort;

    const lvl = getPikafishLevel(req.level || 'nghiep-du');
    const body = {
      id,
      fen: req.fen,
      moves: Array.isArray(req.moves) ? req.moves : [],
      multipv: lvl.multipv,
    };
    if (lvl.depth !== null) body.depth = lvl.depth;
    if (lvl.movetimeMs !== null) body.movetime_ms = lvl.movetimeMs;

    // Pass Threads option for Đại sư if reported by engine
    const hasThreads = (this.info.options || []).some((o) => o.name === 'Threads');
    if (hasThreads && lvl.useAllThreads && this.info.default_threads) {
      body.options = { Threads: Math.max(1, this.info.default_threads) };
    }

    // Open SSE stream for live depth/score/nps updates
    if (req.onInfo && typeof EventSource !== 'undefined') {
      try {
        const es = new EventSource(`/api/engine/stream?id=${encodeURIComponent(id)}`);
        this._es = es;
        es.onmessage = (ev) => {
          if (this._activeId !== id) return;
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'info') {
              req.onInfo({
                depth: msg.depth || 0,
                score: scoreObjToCp(msg.score),
                scoreObj: msg.score || { cp: 0 },
                nodes: msg.nodes || 0,
                nps: msg.nps || 0,
              });
            } else if (msg.type === 'done') {
              es.close();
              if (this._es === es) this._es = null;
            }
          } catch {
            // ignore parse issues
          }
        };
        es.onerror = () => {
          es.close();
          if (this._es === es) this._es = null;
        };
      } catch {
        // SSE optional
      }
    }

    try {
      const resp = await fetch('/api/engine/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (this._activeId !== id) return null;
      if (!resp.ok) return null;
      const data = await resp.json();
      if (this._activeId !== id) return null;

      let chosenMove = data.bestmove || null;
      let chosenScoreObj = data.score || { cp: 0 };
      let chosenPv = data.pv || [];

      if (lvl.multipv > 1 && Array.isArray(data.lines) && data.lines.length > 0) {
        const picked = pickPikafishLine(data.lines, lvl.randomWindowCp);
        if (picked && picked.move) {
          chosenMove = picked.move;
          chosenScoreObj = picked.score || chosenScoreObj;
          chosenPv = picked.pv || chosenPv;
        }
      }

      return {
        move: chosenMove,
        score: scoreObjToCp(chosenScoreObj),
        scoreObj: chosenScoreObj,
        depth: data.depth || 0,
        nodes: data.nodes || 0,
        nps: data.nps || 0,
        pv: chosenPv,
      };
    } catch {
      return null;
    } finally {
      if (this._activeId === id) {
        this._activeId = null;
      }
      if (this._es) {
        this._es.close();
        this._es = null;
      }
      if (this._abort === abort) {
        this._abort = null;
      }
    }
  }

  /** Engine interface implementation. */
  async bestMove(fen, optionsOrThinkMs = {}) {
    const opts =
      typeof optionsOrThinkMs === 'number'
        ? { level: 'cao-thu' }
        : optionsOrThinkMs || {};
    return this.search({ fen, ...opts });
  }
}
