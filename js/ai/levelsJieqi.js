/**
 * Cờ Úp (Jieqi) PIMC AI difficulty presets (tunable constants).
 * Pikafish does not support Jieqi reveals, so Cờ Úp uses Perfect-Information Monte Carlo
 * over the internal JS alpha-beta search.
 */

export const JIEQI_LEVELS = {
  'tap-su': {
    id: 'tap-su',
    name: 'Tập sự',
    worlds: 2,
    maxDepth: 2,
    timeMs: 150,
    randomTopK: 4,
    randomWindowCp: 120,
    blunderChance: 0.12,
  },
  'nghiep-du': {
    id: 'nghiep-du',
    name: 'Nghiệp dư',
    worlds: 4,
    maxDepth: 4,
    timeMs: 600,
    randomTopK: 4,
    randomWindowCp: 30,
    blunderChance: 0,
  },
  'cao-thu': {
    id: 'cao-thu',
    name: 'Cao thủ',
    worlds: 8,
    maxDepth: 6,
    timeMs: 3000,
    randomTopK: 1,
    randomWindowCp: 0,
    blunderChance: 0,
  },
  'dai-su': {
    id: 'dai-su',
    name: 'Đại sư',
    worlds: 12,
    maxDepth: 8,
    timeMs: 7000,
    randomTopK: 1,
    randomWindowCp: 0,
    blunderChance: 0,
  },
  hint: {
    id: 'hint',
    name: 'Gợi ý',
    worlds: 6,
    maxDepth: 6,
    timeMs: 1500,
    randomTopK: 1,
    randomWindowCp: 0,
    blunderChance: 0,
  },
};

export function getJieqiLevel(id) {
  return JIEQI_LEVELS[id] || JIEQI_LEVELS['nghiep-du'];
}
