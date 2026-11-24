/**
 * AI difficulty level presets (tunable constants).
 */

/**
 * @typedef {Object} AiLevel
 * @property {string} id
 * @property {string} name
 * @property {number} maxDepth
 * @property {number} timeMs
 * @property {number} randomTopK
 * @property {number} randomWindowCp
 * @property {number} blunderChance
 * @property {boolean} useFullTT
 */

/** @type {AiLevel[]} */
export const AI_LEVELS = [
  {
    id: 'tap-su',
    name: 'Tập sự',
    maxDepth: 2,
    timeMs: 150,
    randomTopK: 4,
    randomWindowCp: 120,
    blunderChance: 0.12,
    useFullTT: false,
  },
  {
    id: 'nghiep-du',
    name: 'Nghiệp dư',
    maxDepth: 4,
    timeMs: 500,
    randomTopK: 8,
    randomWindowCp: 30,
    blunderChance: 0,
    useFullTT: false,
  },
  {
    id: 'cao-thu',
    name: 'Cao thủ',
    maxDepth: 8,
    timeMs: 2500,
    randomTopK: 1,
    randomWindowCp: 0,
    blunderChance: 0,
    useFullTT: true,
  },
  {
    id: 'dai-su',
    name: 'Đại sư',
    maxDepth: 12,
    timeMs: 6000,
    randomTopK: 1,
    randomWindowCp: 0,
    blunderChance: 0,
    useFullTT: true,
  },
];

/** Dedicated preset for the "Gợi ý" (Hint) button. */
export const HINT_LEVEL = {
  id: 'hint',
  name: 'Gợi ý',
  maxDepth: 8,
  timeMs: 1200,
  randomTopK: 1,
  randomWindowCp: 0,
  blunderChance: 0,
  useFullTT: true,
};

/**
 * Look up an AI level by id, defaulting to "Nghiệp dư".
 * @param {string} id
 * @returns {AiLevel}
 */
export function getAiLevel(id) {
  if (id === 'hint') return HINT_LEVEL;
  return AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[1];
}
