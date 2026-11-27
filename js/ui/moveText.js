/**
 * Single centralized UI helper for formatting & rendering move text everywhere
 * (desktop move list, mobile strip, bottom sheet, timeline tooltip, analysis panel).
 */
import { moveToTraditional, formatLine } from '../notation/traditional.js';
import { PIECE_NAMES } from '../notation/names.js';

const TRAD_CACHE = new Map();
const TRAD_CACHE_MAX = 800;

function cachedMoveToTraditional(position, coord, variant) {
  if (typeof position === 'string') {
    const key = `${variant}|${position}|${coord}`;
    const hit = TRAD_CACHE.get(key);
    if (hit) return hit;
    const res = moveToTraditional(position, coord, { variant });
    if (TRAD_CACHE.size >= TRAD_CACHE_MAX) {
      TRAD_CACHE.delete(TRAD_CACHE.keys().next().value);
    }
    TRAD_CACHE.set(key, res);
    return res;
  }
  return moveToTraditional(position, coord, { variant });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compute full/short/other/title/aria display fields for a single move.
 * @param {{
 *   position: any,
 *   move: string,
 *   variant?: 'xiangqi'|'jieqi'|'cotuong'|'coup',
 *   setting?: 'traditional'|'coord',
 *   extras?: { revealKind?: string|null, qualityLabel?: string|null, suffix?: string },
 * }} opts
 */
export function formatMoveDisplay({
  position,
  move,
  variant = 'xiangqi',
  setting = 'traditional',
  extras = {},
}) {
  const coord = typeof move === 'string' ? move : '';
  const tr = cachedMoveToTraditional(position, coord, variant);
  const isCoord = setting === 'coord';

  const mainFull = isCoord ? coord : (tr.full || coord);
  const mainShort = isCoord ? coord : (tr.short || coord);
  const other = isCoord ? (tr.full || coord) : coord;

  const revealName = extras.revealKind ? (PIECE_NAMES[extras.revealKind] || extras.revealKind) : '';
  const titleParts = [];
  if (other && other !== mainFull) titleParts.push(other);
  if (revealName) titleParts.push(`lật ra ${revealName}`);
  if (extras.qualityLabel) titleParts.push(extras.qualityLabel);
  const title = titleParts.join(' · ') || coord;

  const ariaParts = [isCoord ? coord : (tr.aria || mainFull)];
  if (revealName) ariaParts.push(`lật ra ${revealName}`);
  if (extras.qualityLabel) ariaParts.push(extras.qualityLabel);
  const aria = ariaParts.join(', ');

  return {
    coord,
    full: tr.full || coord,
    short: tr.short || coord,
    mainFull,
    mainShort,
    other,
    title,
    aria,
    parts: tr.parts,
  };
}

/**
 * Build width-responsive two-span HTML (full shown at >= 112px, short below).
 */
export function buildMoveTextSpansHtml(disp, suffix = '') {
  const suf = suffix ? escapeHtml(suffix) : '';
  return (
    `<span class="move-text-full">${escapeHtml(disp.mainFull)}${suf}</span>` +
    `<span class="move-text-short" aria-hidden="true">${escapeHtml(disp.mainShort)}${suf}</span>`
  );
}

/**
 * Populate an element with data-move, title, aria-label, and width-responsive spans.
 */
export function renderMoveText(el, opts) {
  if (!el) return null;
  const disp = formatMoveDisplay(opts);
  el.dataset.move = disp.coord;
  el.title = disp.title;
  el.setAttribute('aria-label', disp.aria);
  const suffix = opts.extras?.suffix || '';
  el.innerHTML = buildMoveTextSpansHtml(disp, suffix);
  return disp;
}

/**
 * Format a move with the counterpart in small muted parentheses for the Analysis Panel (N4):
 * e.g. "Pháo 2 bình 5 (h2e2)" or "h2e2 (Pháo 2 bình 5)".
 */
export function formatMoveWithParen({
  position,
  move,
  variant = 'xiangqi',
  setting = 'traditional',
  style = 'full',
}) {
  const disp = formatMoveDisplay({ position, move, variant, setting });
  const main = style === 'short' ? disp.mainShort : disp.mainFull;
  const other = disp.other;
  const html =
    other && other !== main
      ? `<strong>${escapeHtml(main)}</strong> <span class="an-other-not">(${escapeHtml(other)})</span>`
      : `<strong>${escapeHtml(main)}</strong>`;
  const text = other && other !== main ? `${main} (${other})` : main;
  return { ...disp, main, html, text };
}

export { formatLine };
