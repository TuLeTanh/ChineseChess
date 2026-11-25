/**
 * ES Module Web Worker running Xiangqi AI search off the main thread.
 * Protocol:
 *   in : { type: 'search', id, fen, history, level, seed }
 *        { type: 'stop', id }
 *   out: { type: 'info', id, depth, score, nodes, pv }
 *        { type: 'result', id, move, score, depth, nodes, nps, pv }
 */
import { searchBestMove } from './search.js';
import { searchJieqiBestMove } from './jieqiSearch.js';

let cancelledId = -1;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === 'stop') {
    cancelledId = msg.id;
    return;
  }

  if (msg.type === 'analyze_pos') {
    const { id, fen, depth = 4, timeBudgetMs = 1200 } = msg;
    const res = searchBestMove(fen, {
      depth,
      timeBudgetMs,
      noiseCp: 0,
      shouldStop: () => cancelledId === id,
    });
    if (cancelledId !== id) {
      self.postMessage({ type: 'analyze_result', id, ...res });
    }
    return;
  }

  if (msg.type === 'search') {
    const { id, variant, fen, history, level, seed } = msg;
    const commonOpts = {
      level,
      history,
      seed,
      shouldStop: () => cancelledId === id,
      onInfo: (info) => {
        if (cancelledId !== id) {
          self.postMessage({ type: 'info', id, ...info });
        }
      },
    };
    const res =
      variant === 'coup' || variant === 'jieqi'
        ? searchJieqiBestMove(fen, commonOpts)
        : searchBestMove(fen, commonOpts);
    if (cancelledId !== id) {
      self.postMessage({ type: 'result', id, ...res });
    }
  }
};
