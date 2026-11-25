/**
 * Tactile haptics wrapper using navigator.vibrate with 40 ms throttle (C4).
 * Feature-detected, try/catch guarded, respects settings.haptics, silent in review mode.
 */
import { hapticPattern, createHapticThrottle } from './touchMath.js';

export class HapticsManager {
  /**
   * @param {{ isEnabled?: () => boolean }} [opts]
   */
  constructor(opts = {}) {
    this.isEnabled = opts.isEnabled || (() => true);
    this._allow = createHapticThrottle(40);
  }

  trigger(eventName, { inReview = false } = {}) {
    if (inReview) return false;
    if (!this.isEnabled()) return false;
    const pattern = hapticPattern(eventName);
    if (pattern === null) return false;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return false;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this._allow(now)) return false;
    try {
      return Boolean(navigator.vibrate(pattern));
    } catch {
      return false;
    }
  }
}
