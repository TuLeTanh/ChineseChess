/**
 * Cờ Úp (Jieqi) variant descriptor implementing the shared Variant interface.
 * Pure module (zero DOM/window access at import time).
 */
import { JieqiBoard, JieqiRules, REVEAL_ON_CAPTURE } from '../jieqi/rules.js';

export const jieqiVariant = {
  id: 'coup',
  internalId: 'jieqi',
  label: 'Cờ Úp',
  subtitle: 'Úp quân, mở bất ngờ',
  revealOnCapture: REVEAL_ON_CAPTURE,
  supportsPikafish: false,
  supportsPracticeMode: false,
  allowUndoInAi: false,
  allowContinueInAi: false,
  createInitialState(opts = {}) {
    if (opts.fen && typeof opts.fen === 'string' && opts.fen.includes('/')) {
      return JieqiBoard.fromPublicFen(opts.fen);
    }
    return new JieqiBoard({
      seed: opts.seed ?? null,
      secret: opts.secret ?? null,
      revealOnCapture: REVEAL_ON_CAPTURE,
    });
  },
  createRules() {
    return new JieqiRules();
  },
  enginesAvailable(mode) {
    if (mode !== 'ai') return [];
    return ['js'];
  },
  serializePublic(board) {
    return {
      variant: 'coup',
      fen: board.publicFen(),
      pool: board.getPool(),
      ply: board.history.length,
    };
  },
};
