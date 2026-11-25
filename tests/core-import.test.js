import test from 'node:test';
import assert from 'node:assert/strict';

test('Pure core modules import cleanly in Node with zero DOM/window access', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');

  const piece = await import('../js/model/piece.js');
  const moves = await import('../js/model/moves.js');
  const fen = await import('../js/model/fen.js');
  const board = await import('../js/model/board.js');
  const rules = await import('../js/rules.js');
  const movegen = await import('../js/ai/movegen.js');
  const evalMod = await import('../js/ai/eval.js');
  const search = await import('../js/ai/search.js');
  const levels = await import('../js/ai/levels.js');
  const levelsPf = await import('../js/ai/levelsPikafish.js');
  const variantXq = await import('../js/variants/xiangqi.js');

  assert.ok(piece.RED && piece.BLACK);
  assert.ok(typeof moves.moveToIccs === 'function');
  assert.ok(typeof fen.START_FEN === 'string');
  assert.ok(typeof board.Board === 'function');
  assert.ok(typeof rules.XiangqiRules === 'function');
  assert.ok(typeof movegen.generateMoves === 'function' || typeof movegen.generatePseudoLegal === 'function' || Object.keys(movegen).length > 0);
  assert.ok(Object.keys(evalMod).length > 0);
  assert.ok(typeof search.searchBestMove === 'function');
  assert.ok(Array.isArray(levels.AI_LEVELS));
  assert.ok(typeof levelsPf.getPikafishLevel === 'function');
  assert.equal(variantXq.xiangqiVariant.id, 'cotuong');
});
