/**
 * Screen Wake Lock helper (C7).
 * Requests a wake lock during active local/ai/online games when settings.keepAwake is on;
 * releases on unmount or game over; re-requests on visibilitychange to visible;
 * silently skipped in insecure contexts or unsupported browsers (zero console output).
 */

export class WakeLockController {
  /**
   * @param {{ shouldHold: () => boolean }} opts
   */
  constructor(opts) {
    this.shouldHold = opts.shouldHold || (() => false);
    this._sentinel = null;
    this._disposed = false;
    this._onVisChange = () => {
      if (this._disposed) return;
      if (document.visibilityState === 'visible') {
        this.sync();
      } else {
        this.release();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisChange);
    }
  }

  _supported() {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext === true &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.wakeLock) &&
      typeof navigator.wakeLock.request === 'function'
    );
  }

  async sync() {
    if (this._disposed) return;
    if (!this.shouldHold()) {
      await this.release();
      return;
    }
    if (this._sentinel || !this._supported()) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (this._disposed || !this.shouldHold()) {
        sentinel.release().catch(() => {});
        return;
      }
      this._sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this._sentinel === sentinel) this._sentinel = null;
      });
    } catch {
      // Silently ignore denied/unsupported wake lock
    }
  }

  async release() {
    const s = this._sentinel;
    this._sentinel = null;
    if (s) {
      try {
        await s.release();
      } catch {
        // ignore
      }
    }
  }

  dispose() {
    this._disposed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisChange);
    }
    this.release();
  }
}
