/**
 * Lazy Web Worker client for Xiangqi AI with automatic main-thread fallback.
 */
import { searchBestMove } from './search.js';
import { searchJieqiBestMove } from './jieqiSearch.js';
import { getAiLevel } from './levels.js';

export class AiClient {
  constructor() {
    /** @type {Worker | null} */
    this.worker = null;
    this.workerFailed = false;
    this.loggedFallback = false;
    this.nextId = 1;
    /** @type {number | null} */
    this.activeId = null;
    /** @type {((res: any) => void) | null} */
    this._resolve = null;
    /** @type {((info: any) => void) | null} */
    this._onInfo = null;
  }

  /** Lazily create the module worker if supported. */
  _ensureWorker() {
    if (this.worker || this.workerFailed) return;
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.id !== this.activeId) return;
        if (msg.type === 'info') {
          if (this._onInfo) this._onInfo(msg);
        } else if (msg.type === 'result') {
          const resolve = this._resolve;
          this.activeId = null;
          this._resolve = null;
          this._onInfo = null;
          if (resolve) resolve(msg);
        }
      };
      w.onerror = () => {
        this.workerFailed = true;
        this.terminate();
      };
      this.worker = w;
    } catch {
      this.workerFailed = true;
    }
  }

  /** Cancel any in-flight search. */
  cancel() {
    if (this.activeId !== null && this.worker) {
      this.worker.postMessage({ type: 'stop', id: this.activeId });
    }
    this.activeId = null;
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      this._onInfo = null;
      resolve(null);
    }
  }

  /** Terminate the worker completely (call when leaving AI mode or on beforeunload). */
  terminate() {
    this.cancel();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Run a search asynchronously. Resolves with search result or null if cancelled.
   * @param {{
   *   fen: string,
   *   history?: string[],
   *   level: string,
   *   seed?: number,
   *   onInfo?: (info: { depth: number, score: number, nodes: number }) => void,
   * }} req
   * @returns {Promise<{ move: string | null, score: number, depth: number, nodes: number, nps: number, pv: string[] } | null>}
   */
  search(req) {
    this.cancel();
    this._ensureWorker();

    const id = this.nextId++;
    this.activeId = id;
    this._onInfo = req.onInfo || null;

    if (this.worker && !this.workerFailed) {
      return new Promise((resolve) => {
        this._resolve = resolve;
        this.worker.postMessage({
          type: 'search',
          id,
          variant: req.variant || 'cotuong',
          fen: req.fen,
          history: req.history || [],
          level: req.level,
          seed: req.seed,
        });
      });
    }

    // Fallback: chunked search on main thread with setTimeout yielding
    if (!this.loggedFallback) {
      this.loggedFallback = true;
      console.info('Web Worker unavailable; falling back to chunked main-thread AI search.');
    }
    if (req.variant === 'coup' || req.variant === 'jieqi') {
      return new Promise((resolve) => {
        this._resolve = resolve;
        window.setTimeout(() => {
          if (this.activeId !== id) return;
          const res = searchJieqiBestMove(req.fen, {
            level: req.level,
            seed: req.seed,
            onInfo: (info) => {
              if (this._onInfo) this._onInfo(info);
            },
          });
          if (this.activeId === id) {
            this.activeId = null;
            this._resolve = null;
            this._onInfo = null;
            resolve(res);
          }
        }, 0);
      });
    }
    const cfg = getAiLevel(req.level);
    return new Promise((resolve) => {
      this._resolve = resolve;
      let depth = 1;
      let lastRes = null;
      const deadline = performance.now() + cfg.timeMs;

      const step = () => {
        if (this.activeId !== id) return;
        const remaining = Math.max(20, deadline - performance.now());
        lastRes = searchBestMove(req.fen, {
          level: cfg,
          maxDepth: depth,
          timeMs: Math.min(remaining, 120),
          history: req.history,
          seed: req.seed,
        });
        if (this._onInfo) {
          this._onInfo({ depth: lastRes.depth, score: lastRes.score, nodes: lastRes.nodes });
        }
        depth += 1;
        if (depth <= cfg.maxDepth && performance.now() < deadline && lastRes.score < 29000) {
          window.setTimeout(step, 0);
        } else if (this.activeId === id) {
          this.activeId = null;
          this._resolve = null;
          this._onInfo = null;
          resolve(lastRes);
        }
      };
      window.setTimeout(step, 0);
    });
  }
}
