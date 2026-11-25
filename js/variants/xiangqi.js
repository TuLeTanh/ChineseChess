/**
 * Xiangqi (Cờ Tướng) variant descriptor implementing the shared Variant interface.
 * Pure module (zero DOM/window access at import time) so Node/server can import it.
 */
import { Board } from '../model/board.js';
import { START_FEN } from '../model/fen.js';
import { XiangqiRules, PermissiveRules } from '../rules.js';

export const xiangqiVariant = {
  id: 'cotuong',
  internalId: 'xiangqi',
  label: 'Cờ Tướng',
  subtitle: 'Cờ tướng truyền thống',
  supportsPikafish: true,
  supportsPracticeMode: true,
  allowUndoInAi: true,
  allowContinueInAi: true,
  createInitialState(opts = {}) {
    const fen = opts.fen || START_FEN;
    return Board.fromFen(fen);
  },
  createRules(practiceMode = false) {
    return practiceMode ? new PermissiveRules() : new XiangqiRules();
  },
  enginesAvailable(mode) {
    if (mode !== 'ai') return [];
    return ['pikafish', 'js'];
  },
  serializePublic(board) {
    return {
      variant: 'cotuong',
      fen: board.toFen(),
      ply: board.history.length,
    };
  },
};
