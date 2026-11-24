/**
 * ES Module Web Worker running Xiangqi AI search off the main thread.
 * Protocol:
 *   in : { type: 'search', id, fen, history, level, seed }
 *        { type: 'stop', id }
 *   out: { type: 'info', id, depth, score, nodes, pv }
 *        { type: 'result', id, move, score, depth, nodes, nps, pv }
 */
import { searchBestMove } from './search.js';

let cancelledId = -1;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === 'stop') {
    cancelledId = msg.id;
    return;
  }

  if (msg.type === 'search') {
    const { id, fen, history, level, seed } = msg;
    const res = searchBestMove(fen, {
      level,
      history,
      seed,
      shouldStop: () => cancelledId === id,
      onInfo: (info) => {
        if (cancelledId !== id) {
          self.postMessage({ type: 'info', id, ...info });
        }
      },
    });
    if (cancelledId !== id) {
      self.postMessage({ type: 'result', id, ...res });
    }
  }
};
