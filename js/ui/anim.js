/**
 * Demand-driven tween scheduler with easing helpers.
 * Runs requestAnimationFrame ONLY while at least one tween is active (zero idle CPU).
 */

/**
 * Ease-out cubic: fast start, calm landing.
 * @param {number} t - Progress in [0, 1]
 * @returns {number}
 */
export function easeOutCubic(t) {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/**
 * Ease-in-out cubic: smooth acceleration and deceleration.
 * @param {number} t - Progress in [0, 1]
 * @returns {number}
 */
export function easeInOutCubic(t) {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Animator {
  constructor() {
    /** @type {Set<Object>} */
    this.active = new Set();
    /** @type {number | null} */
    this.rafId = null;
    this._tick = this._tick.bind(this);
  }

  /**
   * Schedule a tween. Returns a cancel function.
   * @param {{
   *   duration: number,
   *   easing?: (t: number) => number,
   *   onUpdate: (eased: number, raw: number) => void,
   *   onComplete?: () => void
   * }} opts
   * @returns {() => void}
   */
  tween(opts) {
    const entry = {
      start: performance.now(),
      duration: Math.max(1, opts.duration),
      easing: opts.easing || easeOutCubic,
      onUpdate: opts.onUpdate,
      onComplete: opts.onComplete || null,
      cancelled: false,
    };
    this.active.add(entry);
    this._ensureRunning();
    return () => {
      entry.cancelled = true;
      this.active.delete(entry);
    };
  }

  /** Cancel all running tweens immediately. */
  clear() {
    for (const entry of this.active) {
      entry.cancelled = true;
    }
    this.active.clear();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** @returns {boolean} */
  isRunning() {
    return this.active.size > 0;
  }

  _ensureRunning() {
    if (this.rafId === null && this.active.size > 0) {
      this.rafId = requestAnimationFrame(this._tick);
    }
  }

  /** @param {number} now */
  _tick(now) {
    this.rafId = null;
    const finished = [];
    for (const entry of this.active) {
      if (entry.cancelled) {
        finished.push(entry);
        continue;
      }
      const raw = Math.min(1, (now - entry.start) / entry.duration);
      const eased = entry.easing(raw);
      entry.onUpdate(eased, raw);
      if (raw >= 1) {
        finished.push(entry);
      }
    }
    for (const entry of finished) {
      this.active.delete(entry);
      if (!entry.cancelled && entry.onComplete) {
        entry.onComplete();
      }
    }
    if (this.active.size > 0) {
      this.rafId = requestAnimationFrame(this._tick);
    }
  }
}
