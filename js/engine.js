/**
 * Engine interface stub (for future UCI / Pikafish / PikaRust integration).
 * Not implemented in v1.
 */
export class Engine {
  /**
   * Compute best move in ICCS/UCI notation for a given FEN.
   * @param {string} _fen
   * @param {number} _thinkMs
   * @returns {Promise<string | null>}
   */
  async bestMove(_fen, _thinkMs) {
    return null;
  }
}
