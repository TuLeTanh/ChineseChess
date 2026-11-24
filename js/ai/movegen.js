/**
 * Allocation-free Xiangqi move generator for the AI search engine.
 * Operates on flat Int8Array(90) using the same piece encoding as js/rules.js.
 * Move encoding: 16-bit integer `(from << 7) | to` (from, to in 0..89).
 */
import { isGeneralAttacked } from '../rules.js';

export { isGeneralAttacked };

const ORTHO_DX = [0, 0, -1, 1];
const ORTHO_DY = [-1, 1, 0, 0];
const DIAG_DX = [-1, 1, -1, 1];
const DIAG_DY = [-1, -1, 1, 1];

const H_DX = [-1, 1, -1, 1, -2, -2, 2, 2];
const H_DY = [-2, -2, 2, 2, -1, 1, -1, 1];
const H_LDX = [0, 0, 0, 0, -1, -1, 1, 1];
const H_LDY = [-1, -1, 1, 1, 0, 0, 0, 0];

/**
 * Generate all pseudo-legal moves for `sideSign` (+1 Red, -1 Black) into `out` starting at `offset`.
 * Returns the new write index.
 * @param {Int8Array} cells
 * @param {number} sideSign
 * @param {Int32Array} out
 * @param {number} offset
 * @param {boolean} [capturesOnly]
 * @returns {number}
 */
export function genPseudoMoves(cells, sideSign, out, offset, capturesOnly = false) {
  let n = offset;
  const yPalMin = sideSign === 1 ? 7 : 0;
  const yPalMax = sideSign === 1 ? 9 : 2;
  const yEleMin = sideSign === 1 ? 5 : 0;
  const yEleMax = sideSign === 1 ? 9 : 4;

  for (let from = 0; from < 90; from++) {
    const p = cells[from];
    if (p * sideSign <= 0) continue;
    const kind = p > 0 ? p : -p;
    const x = from % 9;
    const y = (from - x) / 9;
    const fromShift = from << 7;

    if (kind === 5) {
      // Chariot
      for (let d = 0; d < 4; d++) {
        const dx = ORTHO_DX[d];
        const dy = ORTHO_DY[d];
        let nx = x + dx;
        let ny = y + dy;
        while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
          const to = ny * 9 + nx;
          const occ = cells[to];
          if (occ === 0) {
            if (!capturesOnly) out[n++] = fromShift | to;
          } else {
            if (occ * sideSign < 0) out[n++] = fromShift | to;
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
    } else if (kind === 6) {
      // Cannon
      for (let d = 0; d < 4; d++) {
        const dx = ORTHO_DX[d];
        const dy = ORTHO_DY[d];
        let nx = x + dx;
        let ny = y + dy;
        let jumped = false;
        while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
          const to = ny * 9 + nx;
          const occ = cells[to];
          if (!jumped) {
            if (occ === 0) {
              if (!capturesOnly) out[n++] = fromShift | to;
            } else {
              jumped = true;
            }
          } else if (occ !== 0) {
            if (occ * sideSign < 0) out[n++] = fromShift | to;
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
    } else if (kind === 4) {
      // Horse
      for (let i = 0; i < 8; i++) {
        const nx = x + H_DX[i];
        const ny = y + H_DY[i];
        if (nx < 0 || nx > 8 || ny < 0 || ny > 9) continue;
        if (cells[(y + H_LDY[i]) * 9 + (x + H_LDX[i])] !== 0) continue;
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
          out[n++] = fromShift | to;
        }
      }
    } else if (kind === 7) {
      // Soldier
      const ny = y - sideSign;
      if (ny >= 0 && ny < 10) {
        const to = ny * 9 + x;
        const occ = cells[to];
        if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
          out[n++] = fromShift | to;
        }
      }
      if (sideSign === 1 ? y <= 4 : y >= 5) {
        if (x > 0) {
          const to = from - 1;
          const occ = cells[to];
          if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
            out[n++] = fromShift | to;
          }
        }
        if (x < 8) {
          const to = from + 1;
          const occ = cells[to];
          if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
            out[n++] = fromShift | to;
          }
        }
      }
    } else if (kind === 3) {
      // Elephant
      for (let d = 0; d < 4; d++) {
        const dx = DIAG_DX[d];
        const dy = DIAG_DY[d];
        const nx = x + dx * 2;
        const ny = y + dy * 2;
        if (nx < 0 || nx > 8 || ny < yEleMin || ny > yEleMax) continue;
        if (cells[(y + dy) * 9 + (x + dx)] !== 0) continue;
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
          out[n++] = fromShift | to;
        }
      }
    } else if (kind === 2) {
      // Advisor
      for (let d = 0; d < 4; d++) {
        const nx = x + DIAG_DX[d];
        const ny = y + DIAG_DY[d];
        if (nx < 3 || nx > 5 || ny < yPalMin || ny > yPalMax) continue;
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
          out[n++] = fromShift | to;
        }
      }
    } else if (kind === 1) {
      // General
      for (let d = 0; d < 4; d++) {
        const nx = x + ORTHO_DX[d];
        const ny = y + ORTHO_DY[d];
        if (nx < 3 || nx > 5 || ny < yPalMin || ny > yPalMax) continue;
        const to = ny * 9 + nx;
        const occ = cells[to];
        if (capturesOnly ? occ * sideSign < 0 : occ * sideSign <= 0) {
          out[n++] = fromShift | to;
        }
      }
    }
  }
  return n;
}

const PERFT_STACK = new Int32Array(256 * 16);

/**
 * Fast PERFT using genPseudoMoves (for verifying equivalence with XiangqiRules.perft).
 * @param {Int8Array} cells
 * @param {number} sideSign
 * @param {number} depth
 * @param {number} [offset]
 * @returns {number}
 */
export function perftFast(cells, sideSign, depth, offset = 0) {
  if (depth <= 0) return 1;
  const end = genPseudoMoves(cells, sideSign, PERFT_STACK, offset, false);
  let nodes = 0;
  for (let i = offset; i < end; i++) {
    const mv = PERFT_STACK[i];
    const from = mv >> 7;
    const to = mv & 127;
    const piece = cells[from];
    const cap = cells[to];
    cells[to] = piece;
    cells[from] = 0;
    if (!isGeneralAttacked(cells, sideSign)) {
      nodes += depth === 1 ? 1 : perftFast(cells, -sideSign, depth - 1, end);
    }
    cells[from] = piece;
    cells[to] = cap;
  }
  return nodes;
}
