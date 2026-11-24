/**
 * Pikafish difficulty level presets (tunable constants).
 * Pikafish 2026-09-06 does not expose Skill Level / UCI_Elo, so strength is
 * controlled via depth, movetime_ms, MultiPV, and safe score-window selection.
 */

export const PIKAFISH_LEVELS = {
  'tap-su': {
    id: 'tap-su',
    name: 'Tập sự',
    depth: 2,
    movetimeMs: null,
    multipv: 6,
    randomWindowCp: 200,
    useAllThreads: false,
  },
  'nghiep-du': {
    id: 'nghiep-du',
    name: 'Nghiệp dư',
    depth: 6,
    movetimeMs: null,
    multipv: 4,
    randomWindowCp: 50,
    useAllThreads: false,
  },
  'cao-thu': {
    id: 'cao-thu',
    name: 'Cao thủ',
    depth: null,
    movetimeMs: 1500,
    multipv: 1,
    randomWindowCp: 0,
    useAllThreads: false,
  },
  'dai-su': {
    id: 'dai-su',
    name: 'Đại sư',
    depth: null,
    movetimeMs: 6000,
    multipv: 1,
    randomWindowCp: 0,
    useAllThreads: true,
  },
  hint: {
    id: 'hint',
    name: 'Gợi ý',
    depth: null,
    movetimeMs: 1000,
    multipv: 1,
    randomWindowCp: 0,
    useAllThreads: false,
  },
};

/**
 * Look up Pikafish level config by id.
 * @param {string} id
 */
export function getPikafishLevel(id) {
  return PIKAFISH_LEVELS[id] || PIKAFISH_LEVELS['nghiep-du'];
}

/**
 * Convert UCI score object `{ cp?, mate? }` into a comparable centipawn number.
 * @param {{ cp?: number, mate?: number } | null | undefined} scoreObj
 * @returns {number}
 */
export function scoreObjToCp(scoreObj) {
  if (!scoreObj) return 0;
  if (typeof scoreObj.mate === 'number') {
    return scoreObj.mate > 0 ? 30000 - scoreObj.mate : -30000 - scoreObj.mate;
  }
  return typeof scoreObj.cp === 'number' ? scoreObj.cp : 0;
}

/**
 * Pick a move from MultiPV lines according to the level's randomWindowCp.
 * Never picks a line whose score is a mate against the engine's side (mate < 0)
 * unless every available line is a mate against it.
 * @param {{ move: string, score: { cp?: number, mate?: number }, depth: number, pv: string[] }[]} lines
 * @param {number} randomWindowCp
 * @param {() => number} [rng]
 */
export function pickPikafishLine(lines, randomWindowCp, rng = Math.random) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  if (randomWindowCp <= 0 || lines.length === 1) return lines[0];

  const nonMated = lines.filter((l) => !(l.score && typeof l.score.mate === 'number' && l.score.mate < 0));
  const pool = nonMated.length > 0 ? nonMated : lines;
  const bestCp = scoreObjToCp(pool[0].score);
  if (bestCp >= 29000) return pool[0]; // Always play a forced mate

  const within = pool.filter((l) => bestCp - scoreObjToCp(l.score) <= randomWindowCp);
  const candidates = within.length > 0 ? within : [pool[0]];
  return candidates[Math.floor(rng() * candidates.length)];
}
