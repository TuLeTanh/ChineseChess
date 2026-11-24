/**
 * Tunable Xiangqi static evaluation (centipawns, from side-to-move's perspective).
 * Board layout: 9 files (x = 0..8), 10 ranks (y = 0..9).
 * Red starts at bottom (y = 5..9) moving up (y decreasing); Black mirrors vertically (9 - y).
 */

export const PIECE_VALUE = new Int16Array([
  0,     // 0: empty
  10000, // 1: General
  200,   // 2: Advisor
  200,   // 3: Elephant
  400,   // 4: Horse
  900,   // 5: Chariot
  450,   // 6: Cannon
  100,   // 7: Soldier (base; +100 crossing river is encoded in PST_SOLDIER)
]);

export const TEMPO_BONUS = 15;
export const DEFENSIVE_PAIR_BONUS = 25;
export const MOBILITY_WEIGHT = 2;

/**
 * Piece-square tables from Red's perspective (y = 0 is Black's back rank, y = 9 is Red's back rank).
 * All values in centipawns.
 */

// Soldier: 0 on own half, +100 upon crossing river (y <= 4), strong bonus near Black's palace
export const PST_SOLDIER = new Int16Array([
   10,  15,  25,  35,  40,  35,  25,  15,  10, // y=0 (back rank, cannot advance further)
  115, 130, 155, 185, 195, 185, 155, 130, 115, // y=1 (threatening palace)
  115, 130, 150, 175, 185, 175, 150, 130, 115, // y=2 (palace front)
  110, 120, 135, 150, 160, 150, 135, 120, 110, // y=3
  100, 108, 118, 128, 135, 128, 118, 108, 100, // y=4 (just crossed river -> total ~200-235)
    0,   0,   6,   0,  14,   0,   6,   0,   0, // y=5
    0,   0,   2,   0,   8,   0,   2,   0,   0, // y=6 (start rank)
    0,   0,   0,   0,   0,   0,   0,   0,   0, // y=7
    0,   0,   0,   0,   0,   0,   0,   0,   0, // y=8
    0,   0,   0,   0,   0,   0,   0,   0,   0, // y=9
]);

// Horse: reward central & enemy-palace outposts, penalize edges & corners
export const PST_HORSE = new Int16Array([
  -20,  -5,   5,   8,  -5,   8,   5,  -5, -20, // y=0
  -10,  10,  22,  26,  16,  26,  22,  10, -10, // y=1
   -6,  14,  30,  34,  28,  34,  30,  14,  -6, // y=2
   -6,  16,  28,  32,  30,  32,  28,  16,  -6, // y=3
   -8,  12,  22,  26,  26,  26,  22,  12,  -8, // y=4
  -10,   8,  18,  22,  22,  22,  18,   8, -10, // y=5
  -12,   4,  14,  16,  16,  16,  14,   4, -12, // y=6
  -12,   4,  12,  14,  12,  14,  12,   4, -12, // y=7
  -16,  -4,   4,   6,   2,   6,   4,  -4, -16, // y=8
  -24, -10,  -4,  -4,  -8,  -4,  -4, -10, -24, // y=9
]);

// Cannon: central file control, river bank, and behind-enemy-lines pressure
export const PST_CANNON = new Int16Array([
   10,  14,  18,  20,  24,  20,  18,  14,  10, // y=0
    8,  12,  16,  18,  22,  18,  16,  12,   8, // y=1
    6,  12,  16,  20,  28,  20,  16,  12,   6, // y=2
    4,  10,  14,  16,  22,  16,  14,  10,   4, // y=3
    4,   8,  12,  16,  22,  16,  12,   8,   4, // y=4
    2,   6,  10,  14,  18,  14,  10,   6,   2, // y=5
    0,   4,   8,  12,  18,  12,   8,   4,   0, // y=6
    0,   8,   8,  14,  26,  14,   8,   8,   0, // y=7 (home cannon rank, central cannon +26)
   -4,   2,   4,   8,  12,   8,   4,   2,  -4, // y=8
   -6,   0,   2,   4,   6,   4,   2,   0,  -6, // y=9
]);

// Chariot: open central/rib files and 7th-rank-like activity (y=1..3)
export const PST_CHARIOT = new Int16Array([
   12,  18,  20,  24,  20,  24,  20,  18,  12, // y=0
   16,  26,  26,  32,  28,  32,  26,  26,  16, // y=1
   14,  22,  24,  28,  24,  28,  24,  22,  14, // y=2
   12,  20,  22,  28,  24,  28,  22,  20,  12, // y=3 (enemy soldier rank)
   10,  18,  20,  24,  22,  24,  20,  18,  10, // y=4
    8,  16,  18,  22,  20,  22,  18,  16,   8, // y=5
    6,  14,  16,  20,  18,  20,  16,  14,   6, // y=6
    2,  10,  12,  16,  14,  16,  12,  10,   2, // y=7
    0,   8,  10,  14,  10,  14,  10,   8,   0, // y=8
   -8,   4,   6,  12,   6,  12,   6,   4,  -8, // y=9
]);

// General: stay on back rank, small bonus for centre
export const PST_GENERAL = new Int16Array([
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,  -8,  -6,  -8,   0,   0,   0, // y=7
    0,   0,   0,  -2,   2,  -2,   0,   0,   0, // y=8
    0,   0,   0,   4,  12,   4,   0,   0,   0, // y=9
]);

// Advisor: connected central palace defence
export const PST_ADVISOR = new Int16Array([
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   2,   0,   2,   0,   0,   0, // y=7
    0,   0,   0,   0,  14,   0,   0,   0,   0, // y=8 (central advisor)
    0,   0,   0,   6,   0,   6,   0,   0,   0, // y=9
]);

// Elephant: home stability + central link
export const PST_ELEPHANT = new Int16Array([
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   4,   0,   0,   0,   4,   0,   0, // y=5
    0,   0,   0,   0,   0,   0,   0,   0,   0,
   -2,   0,   0,   0,  14,   0,   0,   0,  -2, // y=7 (centre eye)
    0,   0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   8,   0,   0,   0,   8,   0,   0, // y=9
]);

const PST_BY_KIND = [
  null,
  PST_GENERAL,
  PST_ADVISOR,
  PST_ELEPHANT,
  PST_HORSE,
  PST_CHARIOT,
  PST_CANNON,
  PST_SOLDIER,
];

/**
 * Evaluate `cells` (Int8Array(90)) from `sideSign`'s perspective (+1 Red, -1 Black).
 * Includes material, PSTs, defensive pair bonus, lightweight mobility, and tempo.
 * @param {Int8Array} cells
 * @param {number} sideSign
 * @returns {number} Score in centipawns
 */
export function evaluatePosition(cells, sideSign) {
  let scoreRed = 0;
  let redAdv = 0;
  let redEle = 0;
  let redAtk = 0;
  let blackAdv = 0;
  let blackEle = 0;
  let blackAtk = 0;
  let redMob = 0;
  let blackMob = 0;

  for (let i = 0; i < 90; i++) {
    const p = cells[i];
    if (p === 0) continue;
    const x = i % 9;
    const y = (i - x) / 9;

    if (p > 0) {
      scoreRed += PIECE_VALUE[p] + PST_BY_KIND[p][i];
      if (p === 2) redAdv++;
      else if (p === 3) redEle++;
      else if (p === 4) {
        redAtk++;
        // Quick horse leg-free mobility count
        if (y > 1 && cells[i - 9] === 0) redMob += 2;
        if (y < 8 && cells[i + 9] === 0) redMob += 2;
        if (x > 1 && cells[i - 1] === 0) redMob += 2;
        if (x < 7 && cells[i + 1] === 0) redMob += 2;
      } else if (p === 5) {
        redAtk++;
        // Chariot open-line mobility
        for (let nx = x + 1; nx < 9; nx++) { redMob++; if (cells[y * 9 + nx] !== 0) break; }
        for (let nx = x - 1; nx >= 0; nx--) { redMob++; if (cells[y * 9 + nx] !== 0) break; }
        for (let ny = y - 1; ny >= 0; ny--) { redMob++; if (cells[ny * 9 + x] !== 0) break; }
        for (let ny = y + 1; ny < 10; ny++) { redMob++; if (cells[ny * 9 + x] !== 0) break; }
      } else if (p === 6) {
        redAtk++;
        for (let nx = x + 1; nx < 9 && cells[y * 9 + nx] === 0; nx++) redMob++;
        for (let nx = x - 1; nx >= 0 && cells[y * 9 + nx] === 0; nx--) redMob++;
        for (let ny = y - 1; ny >= 0 && cells[ny * 9 + x] === 0; ny--) redMob++;
        for (let ny = y + 1; ny < 10 && cells[ny * 9 + x] === 0; ny++) redMob++;
      }
    } else {
      const kind = -p;
      const mirrorIdx = (9 - y) * 9 + x;
      scoreRed -= PIECE_VALUE[kind] + PST_BY_KIND[kind][mirrorIdx];
      if (kind === 2) blackAdv++;
      else if (kind === 3) blackEle++;
      else if (kind === 4) {
        blackAtk++;
        if (y > 1 && cells[i - 9] === 0) blackMob += 2;
        if (y < 8 && cells[i + 9] === 0) blackMob += 2;
        if (x > 1 && cells[i - 1] === 0) blackMob += 2;
        if (x < 7 && cells[i + 1] === 0) blackMob += 2;
      } else if (kind === 5) {
        blackAtk++;
        for (let nx = x + 1; nx < 9; nx++) { blackMob++; if (cells[y * 9 + nx] !== 0) break; }
        for (let nx = x - 1; nx >= 0; nx--) { blackMob++; if (cells[y * 9 + nx] !== 0) break; }
        for (let ny = y - 1; ny >= 0; ny--) { blackMob++; if (cells[ny * 9 + x] !== 0) break; }
        for (let ny = y + 1; ny < 10; ny++) { blackMob++; if (cells[ny * 9 + x] !== 0) break; }
      } else if (kind === 6) {
        blackAtk++;
        for (let nx = x + 1; nx < 9 && cells[y * 9 + nx] === 0; nx++) blackMob++;
        for (let nx = x - 1; nx >= 0 && cells[y * 9 + nx] === 0; nx--) blackMob++;
        for (let ny = y - 1; ny >= 0 && cells[ny * 9 + x] === 0; ny--) blackMob++;
        for (let ny = y + 1; ny < 10 && cells[ny * 9 + x] === 0; ny++) blackMob++;
      }
    }
  }

  // Defensive pair bonuses when opponent has attacking cannons/horses/chariots
  if (blackAtk > 0) {
    if (redAdv === 2) scoreRed += DEFENSIVE_PAIR_BONUS;
    if (redEle === 2) scoreRed += DEFENSIVE_PAIR_BONUS;
  }
  if (redAtk > 0) {
    if (blackAdv === 2) scoreRed -= DEFENSIVE_PAIR_BONUS;
    if (blackEle === 2) scoreRed -= DEFENSIVE_PAIR_BONUS;
  }

  scoreRed += (redMob - blackMob) * MOBILITY_WEIGHT;

  return scoreRed * sideSign + TEMPO_BONUS;
}
