/**
 * Reusable Elo bar placeholder component (Phase 1).
 * Data shape stored in settings.ratings = { xiangqi: { elo: null, games: 0 }, jieqi: { elo: null, games: 0 } }.
 * Ready to display real numbers when a rating system is added later.
 */

/**
 * Render an Elo bar HTML string.
 * @param {{ elo: number | null, games: number }} props
 * @returns {string}
 */
export function renderEloBar({ elo = null, games = 0 } = {}) {
  const isUnranked = typeof elo !== 'number' || !Number.isFinite(elo);
  const pct = isUnranked ? 0 : Math.max(4, Math.min(100, ((elo - 800) / 1600) * 100));
  const label = isUnranked ? 'ELO: chưa xếp hạng' : `ELO: ${Math.round(elo)} (${games} ván)`;
  const tip = isUnranked ? 'Sắp ra mắt' : `Đã đấu ${games} ván xếp hạng`;

  return `
    <div class="elo-bar${isUnranked ? ' is-unranked' : ''}" title="${tip}" aria-label="${label}">
      <div class="elo-bar-head">
        <span class="elo-lock" aria-hidden="true">${
          isUnranked
            ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
            : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9 9 9"/></svg>'
        }</span>
        <span class="elo-label">${label}</span>
      </div>
      <div class="elo-track">
        <div class="elo-fill" style="width:${pct.toFixed(1)}%"></div>
        <span class="elo-tick" style="left:25%"></span>
        <span class="elo-tick" style="left:50%"></span>
        <span class="elo-tick" style="left:75%"></span>
      </div>
    </div>
  `;
}
