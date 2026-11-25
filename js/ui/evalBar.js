/**
 * Responsive Evaluation Bar for Game Analysis:
 * - Desktop / Side layout: 18 px vertical bar to the left of the board (Red fill grows from bottom, or top if flipped)
 * - Mobile Stack layout: 10 px horizontal bar above the board (Red fill grows from left, or right if flipped)
 * - Smooth CSS transitions (disabled under prefers-reduced-motion)
 */
import { winPercent, formatEvalScore } from '../analysis/math.js';

export class EvalBar {
  /**
   * @param {{ container: HTMLElement }} opts
   */
  constructor({ container }) {
    this.container = container;
    this.flipped = false;
    this.visible = false;
    this.scoreRed = { cp: 0 };
    this.wdlRed = null;

    this.el = document.createElement('div');
    this.el.className = 'eval-bar';
    this.el.dataset.testid = 'eval-bar';
    this.el.hidden = true;
    this.el.setAttribute('role', 'meter');
    this.el.setAttribute('aria-label', 'Đánh giá thế cờ');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.setAttribute('aria-valuenow', '50');
    this.el.innerHTML = `
      <div class="eval-bar-track">
        <div class="eval-bar-fill-red"></div>
      </div>
      <span class="eval-bar-score" data-nowrap="1">0.0</span>
    `;
    this.fillEl = this.el.querySelector('.eval-bar-fill-red');
    this.scoreEl = this.el.querySelector('.eval-bar-score');
    this.container.appendChild(this.el);
  }

  setVisible(vis) {
    this.visible = Boolean(vis);
    this.el.hidden = !this.visible;
    this.container.classList.toggle('has-eval-bar', this.visible);
  }

  setFlipped(flipped) {
    this.flipped = Boolean(flipped);
    this.el.classList.toggle('is-flipped', this.flipped);
    this._render();
  }

  setScore(scoreRed, wdlRed = null) {
    this.scoreRed = scoreRed || { cp: 0 };
    this.wdlRed = wdlRed || null;
    this._render();
  }

  _render() {
    const wp = winPercent(this.scoreRed, this.wdlRed);
    const pct = Math.max(4, Math.min(96, wp));
    this.el.style.setProperty('--eval-red-pct', `${pct.toFixed(1)}%`);
    this.el.setAttribute('aria-valuenow', String(Math.round(wp)));
    this.scoreEl.textContent = formatEvalScore(this.scoreRed);
    const redAdv = wp >= 50;
    this.el.classList.toggle('is-red-adv', redAdv);
    this.el.classList.toggle('is-black-adv', !redAdv);
    // Flip chip to opposite end when near extreme edge so it stays >= 4px inside bar
    const nearEdge = wp >= 92 || wp <= 8;
    this.el.classList.toggle('is-chip-flipped', nearEdge);
  }

  dispose() {
    this.container.classList.remove('has-eval-bar');
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
