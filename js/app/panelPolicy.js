/**
 * Pure policy & helper functions for the Compact Panel and Analysis View (zero DOM).
 * Single source of truth for:
 *  - Visibility matrix: panelPolicy({ variant, mode, status, isArchive })
 *  - Verdict bands & thresholds: VERDICT_BANDS, verdictForWinPercent(winPct)
 *  - Validated PV continuation chip builder: buildValidatedPvChips(fen, pvMoves, maxPlies)
 *  - Live single-position analysis scheduler: createLiveAnalysisScheduler(...)
 */
import { Board } from '../model/board.js';
import { XiangqiRules } from '../rules.js';

const FILES = 'abcdefghi';
const xiangqiRules = new XiangqiRules();

/**
 * Verdict bands from Red's win % (0..100). Thresholds in one place.
 * Boundaries: >=75, [58,75), [42,58), [25,42), <25.
 */
export const VERDICT_BANDS = [
  { id: 'red_winning', min: 75, label: 'Đỏ lợi thế lớn', side: 'red' },
  { id: 'red_better', min: 58, label: 'Đỏ hơi hơn', side: 'red' },
  { id: 'equal', min: 42, label: 'Cân bằng', side: 'equal' },
  { id: 'black_better', min: 25, label: 'Đen hơi hơn', side: 'black' },
  { id: 'black_winning', min: -Infinity, label: 'Đen lợi thế lớn', side: 'black' },
];

/**
 * Map Red's win percentage (0..100) to its Vietnamese verdict band.
 * @param {number} winPct
 */
export function verdictForWinPercent(winPct) {
  const wp = Number.isFinite(winPct) ? winPct : 50;
  for (const band of VERDICT_BANDS) {
    if (wp >= band.min) return band;
  }
  return VERDICT_BANDS[VERDICT_BANDS.length - 1];
}

/**
 * Pure panel & analysis visibility policy.
 * @param {{
 *   game?: 'cotuong' | 'coup',
 *   variant?: 'xiangqi' | 'jieqi' | 'cotuong' | 'coup',
 *   mode?: 'local' | 'ai' | 'online' | 'pvp' | 'review',
 *   status?: 'live' | 'finished' | 'unfinished',
 *   isArchive?: boolean,
 * }} ctx
 */
export function panelPolicy(ctx = {}) {
  const rawVar = ctx.variant || ctx.game || 'xiangqi';
  const isJieqi = rawVar === 'jieqi' || rawVar === 'coup';
  const rawMode = ctx.mode === 'pvp' ? 'local' : (ctx.mode || 'local');
  const isArchive = Boolean(ctx.isArchive || rawMode === 'review');
  const isFinished = ctx.status === 'finished';
  const isLive = !isArchive && !isFinished;

  // P4 Analysis visibility matrix:
  // - Cờ Úp: NEVER visible anywhere (shows notice inside menu only in local/archive)
  // - Cờ Tướng:
  //   - local live: VISIBLE (explicit exception: both players share the machine)
  //   - ai live / online live: HIDDEN
  //   - finished game (any mode) or archive/share of finished game: VISIBLE
  //   - unfinished archive deep-link: allowed ONLY if mode === 'local', blocked for ai/online
  let showAnalysis = false;
  let allowAnalysisDeepLink = false;
  if (!isJieqi) {
    if (isArchive) {
      const allowedArchive = isFinished || (ctx.status === 'unfinished' && rawMode === 'local');
      showAnalysis = allowedArchive;
      allowAnalysisDeepLink = allowedArchive;
    } else if (isFinished) {
      showAnalysis = true;
      allowAnalysisDeepLink = true;
    } else if (rawMode === 'local') {
      showAnalysis = true;
      allowAnalysisDeepLink = true;
    }
  }

  // P3 Action row per mode:
  // - ai: [Đầu hàng] (+ Gợi ý inside menu)
  // - local: [Đi lại] [Hòa] [Đầu hàng] (Cờ Úp keeps Đi lại in local)
  // - online: [Xin hòa] [Đầu hàng]
  // - archive/review: [Về hiện tại] [Chơi tiếp từ đây]
  const showUndo = !isArchive && rawMode === 'local';
  const showDraw = !isArchive && (rawMode === 'local' || rawMode === 'online');
  const showResign = !isArchive && (rawMode === 'local' || rawMode === 'ai' || rawMode === 'online');
  const showHint = !isArchive && rawMode === 'ai' && isLive;
  const showReturnLive = isArchive;
  const showContinueFromHere = isArchive;

  // "⋯" overflow menu items
  const menuItems = [];
  if (!isArchive && rawMode === 'ai') {
    menuItems.push('hint', 'ai_config');
  }
  if (!isArchive && rawMode !== 'online') {
    menuItems.push('new_game');
  }
  menuItems.push('flip', 'theme', 'notation', 'notation_help', 'audio', 'export', 'settings');
  if (isJieqi) {
    menuItems.push('jieqi_analysis_note');
  }

  return {
    isJieqi,
    mode: rawMode,
    isArchive,
    isFinished,
    isLive,
    showAnalysis,
    allowAnalysisDeepLink,
    showHint,
    showUndo,
    showDraw,
    showResign,
    showReturnLive,
    showContinueFromHere,
    showJieqiPool: isJieqi,
    showJieqiAnalysisNotice: isJieqi,
    menuItems,
  };
}

/**
 * Replay an engine PV from `fen` through XiangqiRules, returning validated chip objects
 * up to `maxPlies` (default 6). Truncates immediately at the first illegal move.
 * Never mutates any external Board instance.
 *
 * @param {string} fen
 * @param {string[]} pvMoves
 * @param {number} [maxPlies=6]
 * @returns {{ chips: Array<{ plyOffset: number, iccs: string, side: 'red'|'black', kind: string, fenAfter: string, from: {x:number,y:number}, to: {x:number,y:number} }>, truncated: boolean }}
 */
export function buildValidatedPvChips(fen, pvMoves, maxPlies = 6) {
  const chips = [];
  let truncated = false;
  if (!fen || !Array.isArray(pvMoves) || pvMoves.length === 0) {
    return { chips, truncated };
  }
  let board;
  try {
    board = Board.fromFen(fen);
  } catch {
    return { chips, truncated: true };
  }

  const limit = Math.min(maxPlies, pvMoves.length);
  for (let i = 0; i < limit; i++) {
    const iccs = pvMoves[i];
    if (typeof iccs !== 'string' || iccs.length !== 4) {
      truncated = true;
      break;
    }
    const from = { x: FILES.indexOf(iccs[0]), y: 9 - Number(iccs[1]) };
    const to = { x: FILES.indexOf(iccs[2]), y: 9 - Number(iccs[3]) };
    if (from.x < 0 || to.x < 0 || Number.isNaN(from.y) || Number.isNaN(to.y)) {
      truncated = true;
      break;
    }
    const piece = board.at(from);
    if (!piece || piece.side !== board.sideToMove) {
      truncated = true;
      break;
    }
    const legal = xiangqiRules.legalMoves(board, from);
    if (!legal.some((m) => m.x === to.x && m.y === to.y)) {
      truncated = true;
      break;
    }
    board.applyMove(from, to);
    chips.push({
      plyOffset: i + 1,
      iccs,
      side: piece.side,
      kind: piece.kind,
      from,
      to,
      fenAfter: board.toFen(),
    });
  }
  return { chips, truncated };
}

/**
 * Pure debounced single-position live analysis scheduler.
 * Guarantees: debounceMs delay, immediate cancel on new trigger, stale results ignored,
 * never two concurrent jobs, 409 error surfaced cleanly.
 */
export function createLiveAnalysisScheduler({
  debounceMs = 250,
  runSearch,
  onStart = () => {},
  onResult = () => {},
  onError = () => {},
}) {
  let seq = 0;
  let timer = null;
  let activeCancel = null;
  let disposed = false;

  const cancelCurrent = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (activeCancel) {
      try {
        activeCancel();
      } catch {
        // ignore
      }
      activeCancel = null;
    }
  };

  const schedule = (payload) => {
    if (disposed) return -1;
    cancelCurrent();
    const mySeq = ++seq;
    timer = setTimeout(() => {
      timer = null;
      if (disposed || mySeq !== seq) return;
      onStart(payload, mySeq);
      let handle;
      try {
        handle = runSearch(payload, mySeq);
      } catch (err) {
        if (!disposed && mySeq === seq) onError(err, mySeq);
        return;
      }
      activeCancel = handle?.cancel || null;
      Promise.resolve(handle?.promise ?? handle)
        .then((res) => {
          if (disposed || mySeq !== seq) return;
          activeCancel = null;
          onResult(res, mySeq);
        })
        .catch((err) => {
          if (disposed || mySeq !== seq) return;
          activeCancel = null;
          onError(err, mySeq);
        });
    }, debounceMs);
    return mySeq;
  };

  const dispose = () => {
    disposed = true;
    seq++;
    cancelCurrent();
  };

  return { schedule, cancel: cancelCurrent, dispose };
}
