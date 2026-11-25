/**
 * Unified Game Analysis orchestrator supporting:
 * - Local Pikafish SSE backend (`POST /api/engine/analyze` + `GET /api/engine/stream?id=...`)
 * - Pure-JS Web Worker fallback (`js/ai/worker.js` `analyze_pos`) when Pikafish is unavailable
 * - Pluggable `customEvaluator` for deterministic Node unit testing (zero DOM required)
 */
import { Board } from '../model/board.js';
import { START_FEN } from '../model/fen.js';
import { RED, BLACK } from '../model/piece.js';
import {
  normalizeToRed,
  wdlToRed,
  buildAnalysisReport,
  analysisKey,
} from './math.js';

export const ANALYSIS_PRESETS = {
  fast: { id: 'fast', label: 'Nhanh', movetimeMs: 150, jsDepth: 4, multipv: 2 },
  standard: { id: 'standard', label: 'Chuẩn', movetimeMs: 600, jsDepth: 5, multipv: 2 },
  deep: { id: 'deep', label: 'Sâu', movetimeMs: 2000, jsDepth: 6, multipv: 2 },
};

const FILES = 'abcdefghi';

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function sideAtPly(startFen, ply) {
  const startSide = /\s+b(\s|$)/.test(startFen || '') ? BLACK : RED;
  return ply % 2 === 0 ? startSide : startSide === RED ? BLACK : RED;
}

function normalizePosEvent(raw, startFen) {
  const ply = raw.ply;
  const sideToMove = sideAtPly(startFen, ply);
  const scoreRed = normalizeToRed(raw.score, sideToMove);
  const wdlRed = wdlToRed(raw.wdl, sideToMove);
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map((ln) => ({
        move: ln.move,
        scoreRed: normalizeToRed(ln.score, sideToMove),
        wdlRed: wdlToRed(ln.wdl, sideToMove),
        depth: ln.depth || raw.depth || 0,
        pv: Array.isArray(ln.pv) ? ln.pv : ln.move ? [ln.move] : [],
      }))
    : [];
  if (lines.length === 0 && raw.bestmove) {
    lines.push({
      move: raw.bestmove,
      scoreRed,
      wdlRed,
      depth: raw.depth || 0,
      pv: Array.isArray(raw.pv) && raw.pv.length > 0 ? raw.pv : [raw.bestmove],
    });
  }
  return {
    ply,
    sideToMove,
    bestmove: raw.bestmove || lines[0]?.move || null,
    scoreRed,
    wdlRed,
    depth: raw.depth || 0,
    lines,
  };
}

let nextRunSeq = 1;

/**
 * Probe whether local Pikafish server is available.
 * @returns {Promise<{ available: boolean, name?: string }>}
 */
export async function probeAnalysisEngine() {
  if (typeof fetch !== 'function') return { available: false };
  try {
    const res = await fetch('/api/engine/info', { cache: 'no-store' });
    if (!res.ok) return { available: false };
    const data = await res.json();
    return { available: Boolean(data && data.available), name: data?.name || 'Pikafish' };
  } catch {
    return { available: false };
  }
}

/**
 * Run game analysis over positions 0..moves.length.
 * @param {{
 *   startFen?: string,
 *   moves: string[],
 *   preset?: 'fast' | 'standard' | 'deep',
 *   forceEngine?: 'pikafish' | 'js',
 *   customEvaluator?: (ctx: { ply: number, fen: string, sideToMove: 'red'|'black', signal: { cancelled: boolean } }) => Promise<{ bestmove?: string|null, score: { cp?: number, mate?: number }, wdl?: number[], depth?: number, lines?: any[] }>,
 *   onProgress?: (snap: any) => void,
 *   onDone?: (result: any) => void,
 *   onError?: (err: Error) => void,
 * }} opts
 * @returns {{ id: string, cancel: () => void, promise: Promise<any> }}
 */
export function runGameAnalysis(opts) {
  const startFen = (opts.startFen || START_FEN).trim();
  const moves = Array.isArray(opts.moves) ? [...opts.moves] : [];
  const presetCfg = ANALYSIS_PRESETS[opts.preset] || ANALYSIS_PRESETS.fast;
  const runId = `an_${Date.now()}_${nextRunSeq++}`;
  const key = analysisKey(startFen, moves);
  const startSide = sideAtPly(startFen, 0);
  const total = moves.length + 1;

  const state = {
    cancelled: false,
    es: null,
    worker: null,
    engineName: 'Nội bộ (JS)',
    positions: [],
    doneFired: false,
  };

  const buildSnapshot = (incomplete) => {
    const report = buildAnalysisReport(state.positions, moves, startSide);
    return {
      key,
      runId,
      startFen,
      moves,
      preset: presetCfg.id,
      engineName: state.engineName,
      positions: [...state.positions],
      moveAnnotations: report.moveAnnotations,
      summary: { ...report.summary, incomplete: Boolean(incomplete || report.summary.incomplete) },
      analyzed: state.positions.length,
      total,
      cancelled: state.cancelled,
      updatedAt: new Date().toISOString(),
    };
  };

  const cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    if (state.es) {
      try {
        state.es.close();
      } catch {
        // ignore
      }
      state.es = null;
    }
    if (state.worker) {
      try {
        state.worker.postMessage({ type: 'stop', id: -1 });
        state.worker.terminate();
      } catch {
        // ignore
      }
      state.worker = null;
    }
    if (typeof fetch === 'function' && state.engineName !== 'Nội bộ (JS)' && !opts.customEvaluator) {
      fetch('/api/engine/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: runId }),
      }).catch(() => {});
    }
  };

  const runViaCustom = async () => {
    state.engineName = 'FakeEngine';
    const board = new Board(startFen);
    for (let ply = 0; ply < total; ply++) {
      if (state.cancelled) break;
      const fen = board.toFen();
      const raw = await opts.customEvaluator({
        ply,
        fen,
        sideToMove: board.sideToMove,
        signal: state,
      });
      if (state.cancelled) break;
      state.positions.push(normalizePosEvent({ ...raw, ply }, startFen));
      if (opts.onProgress) opts.onProgress(buildSnapshot(true));
      if (ply < moves.length) {
        const { from, to } = parseIccs(moves[ply]);
        board.applyMove(from, to);
      }
    }
    const finalRes = buildSnapshot(state.cancelled);
    state.doneFired = true;
    if (opts.onDone) opts.onDone(finalRes);
    return finalRes;
  };

  const runViaJsWorker = async () => {
    state.engineName = 'Nội bộ (JS)';
    const board = new Board(startFen);
    const worker = new Worker(new URL('../ai/worker.js', import.meta.url), { type: 'module' });
    state.worker = worker;

    const evalOne = (fen, id) =>
      new Promise((resolve, reject) => {
        const onMsg = (ev) => {
          const d = ev.data;
          if (!d || d.id !== id) return;
          if (d.type === 'analyze_result') {
            worker.removeEventListener('message', onMsg);
            worker.removeEventListener('error', onErr);
            resolve(d);
          }
        };
        const onErr = (err) => {
          worker.removeEventListener('message', onMsg);
          worker.removeEventListener('error', onErr);
          reject(err);
        };
        worker.addEventListener('message', onMsg);
        worker.addEventListener('error', onErr);
        worker.postMessage({
          type: 'analyze_pos',
          id,
          fen,
          depth: presetCfg.jsDepth,
          timeBudgetMs: presetCfg.id === 'deep' ? 2500 : presetCfg.id === 'standard' ? 1400 : 700,
        });
      });

    try {
      for (let ply = 0; ply < total; ply++) {
        if (state.cancelled) break;
        const fen = board.toFen();
        const res = await evalOne(fen, ply + 1);
        if (state.cancelled) break;
        const rawScore =
          typeof res.score === 'number'
            ? Math.abs(res.score) >= 29000
              ? { mate: res.score > 0 ? 1 : -1 }
              : { cp: res.score }
            : { cp: 0 };
        const bestMoveIccs = typeof res.move === 'string'
          ? res.move
          : res.move && res.move.from
            ? `${FILES[res.move.from.x]}${9 - res.move.from.y}${FILES[res.move.to.x]}${9 - res.move.to.y}`
            : null;
        state.positions.push(
          normalizePosEvent(
            {
              ply,
              bestmove: bestMoveIccs,
              score: rawScore,
              depth: res.depth || presetCfg.jsDepth,
              pv: res.pv || (bestMoveIccs ? [bestMoveIccs] : []),
            },
            startFen
          )
        );
        if (opts.onProgress) opts.onProgress(buildSnapshot(true));
        if (ply < moves.length) {
          const { from, to } = parseIccs(moves[ply]);
          board.applyMove(from, to);
        }
      }
    } finally {
      if (state.worker) {
        try {
          state.worker.terminate();
        } catch {
          // ignore
        }
        state.worker = null;
      }
    }

    const finalRes = buildSnapshot(state.cancelled);
    state.doneFired = true;
    if (opts.onDone) opts.onDone(finalRes);
    return finalRes;
  };

  const runViaPikafish = async (engineName) => {
    state.engineName = engineName || 'Pikafish';
    return new Promise((resolve, reject) => {
      const es = new EventSource(`/api/engine/stream?id=${encodeURIComponent(runId)}`);
      state.es = es;

      const finish = (cancelledFlag) => {
        if (state.doneFired) return;
        state.doneFired = true;
        if (state.es) {
          try {
            state.es.close();
          } catch {
            // ignore
          }
          state.es = null;
        }
        const finalRes = buildSnapshot(cancelledFlag || state.cancelled);
        if (opts.onDone) opts.onDone(finalRes);
        resolve(finalRes);
      };

      es.onmessage = (ev) => {
        if (state.cancelled) return finish(true);
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id !== runId) return;
        if (msg.type === 'pos') {
          state.positions.push(normalizePosEvent(msg, startFen));
          if (opts.onProgress) opts.onProgress(buildSnapshot(true));
        } else if (msg.type === 'done') {
          finish(Boolean(msg.cancelled));
        } else if (msg.type === 'error') {
          es.close();
          state.es = null;
          const err = new Error(msg.error || 'Lỗi phân tích Pikafish');
          if (opts.onError) opts.onError(err);
          reject(err);
        }
      };

      es.onerror = () => {
        if (state.doneFired) return;
        if (state.cancelled) return finish(true);
      };

      fetch('/api/engine/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: runId,
          startFen,
          moves,
          movetime_ms: presetCfg.movetimeMs,
          multipv: presetCfg.multipv,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${res.status}`);
          }
        })
        .catch((err) => {
          if (state.es) {
            try {
              state.es.close();
            } catch {
              // ignore
            }
            state.es = null;
          }
          if (!state.doneFired) {
            state.doneFired = true;
            if (opts.onError) opts.onError(err);
            reject(err);
          }
        });
    });
  };

  const promise = (async () => {
    if (opts.customEvaluator) {
      return runViaCustom();
    }
    if (opts.forceEngine === 'js') {
      return runViaJsWorker();
    }
    const info = await probeAnalysisEngine();
    if (info.available && typeof EventSource !== 'undefined') {
      return runViaPikafish(info.name);
    }
    return runViaJsWorker();
  })();

  return { id: runId, key, cancel, promise };
}
