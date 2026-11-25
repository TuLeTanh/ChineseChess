/**
 * Responsive layout manager for the Game & Replay screens (C2).
 * Uses ResizeObserver + visualViewport + orientationchange, debounced to 1 rAF,
 * sets `data-layout="desktop|side|stack"` and CSS custom properties without
 * ever re-parenting DOM nodes or recreating the board.
 */
import { computeLayoutMode, computeBoardRect } from './touchMath.js';

function parseSafeOverride() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('safe');
    if (!raw) return null;
    const parts = raw.split(',').map((n) => Math.max(0, Number.parseFloat(n) || 0));
    if (parts.length !== 4) return null;
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  } catch {
    return null;
  }
}

export class LayoutManager {
  /**
   * @param {{
   *   rootEl: HTMLElement,
   *   testMode?: boolean,
   *   onChange?: (state: { mode: string, boardRect: any, compactBoard: boolean, safe: any }) => void,
   * }} opts
   */
  constructor(opts) {
    this.rootEl = opts.rootEl;
    this.testMode = Boolean(opts.testMode);
    this.onChange = opts.onChange || (() => {});

    this._rafId = 0;
    this._lastKey = '';
    this._sheetState = 'closed';
    this._disposed = false;
    this._safeOverride = parseSafeOverride();

    this._applySafeOverride();

    this._schedule = this._schedule.bind(this);
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this._schedule) : null;
    if (this._ro) this._ro.observe(document.documentElement);

    window.addEventListener('resize', this._schedule);
    window.addEventListener('orientationchange', this._schedule);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._schedule);
      window.visualViewport.addEventListener('scroll', this._schedule);
    }

    this.updateNow();
  }

  _applySafeOverride() {
    if (!this._safeOverride) return;
    const st = document.documentElement.style;
    st.setProperty('--sat', `${this._safeOverride.top}px`);
    st.setProperty('--sar', `${this._safeOverride.right}px`);
    st.setProperty('--sab', `${this._safeOverride.bottom}px`);
    st.setProperty('--sal', `${this._safeOverride.left}px`);
  }

  _readSafeInsets() {
    if (this._safeOverride) return { ...this._safeOverride };
    const cs = getComputedStyle(document.documentElement);
    const px = (v) => Math.max(0, Number.parseFloat(cs.getPropertyValue(v)) || 0);
    return {
      top: px('--sat'),
      right: px('--sar'),
      bottom: px('--sab'),
      left: px('--sal'),
    };
  }

  setSheetState(state) {
    this._sheetState = state;
    if (this.testMode && window.__layout) {
      window.__layout.sheetState = state;
    }
  }

  _schedule() {
    if (this._disposed || this._rafId) return;
    this._rafId = window.requestAnimationFrame(() => {
      this._rafId = 0;
      if (!this._disposed) this.updateNow();
    });
  }

  updateNow() {
    if (this._disposed || !this.rootEl) return;
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    const vvh = window.visualViewport ? Math.round(window.visualViewport.height) : h;
    const safe = this._readSafeInsets();

    const docStyle = document.documentElement.style;
    docStyle.setProperty('--app-h', `${h}px`);
    docStyle.setProperty('--vvh', `${vvh}px`);

    const mode = computeLayoutMode(w, h);
    const shortStack = mode === 'stack' && h <= 600;
    const chrome = shortStack
      ? {
          topBar: 44,
          oppStrip: 40,
          moveStrip: 32,
          playerStrip: 40,
          controls: 48,
          safeTop: safe.top,
          safeRight: safe.right,
          safeBottom: safe.bottom,
          safeLeft: safe.left,
        }
      : {
          topBar: 44,
          oppStrip: 44,
          moveStrip: 36,
          playerStrip: 44,
          controls: 52,
          safeTop: safe.top,
          safeRight: safe.right,
          safeBottom: safe.bottom,
          safeLeft: safe.left,
        };

    // Use compact aspect (904/1004) when board is narrow (< 480px)
    const preliminary = computeBoardRect(mode, w, h, chrome);
    const compactBoard = mode !== 'desktop' && preliminary.width < 480;
    const boardRect = computeBoardRect(mode, w, h, {
      ...chrome,
      aspect: compactBoard ? 904 / 1004 : 1050 / 1150,
    });

    const key = `${mode}|${w}x${h}|${vvh}|${compactBoard}|${safe.top},${safe.right},${safe.bottom},${safe.left}`;
    if (key === this._lastKey) return;
    this._lastKey = key;

    this.rootEl.dataset.layout = mode;
    if (shortStack) {
      this.rootEl.dataset.compactChrome = '1';
    } else {
      delete this.rootEl.dataset.compactChrome;
    }

    this.rootEl.style.setProperty('--board-w', `${Math.floor(boardRect.width)}px`);
    this.rootEl.style.setProperty('--board-h', `${Math.floor(boardRect.height)}px`);
    if (boardRect.panelWidth) {
      this.rootEl.style.setProperty('--panel-w', `${Math.round(boardRect.panelWidth)}px`);
    }
    this.rootEl.style.setProperty('--controls-h', `${chrome.controls}px`);

    this.current = { mode, boardRect, compactBoard, safe };

    if (this.testMode && typeof window !== 'undefined') {
      window.__layout = {
        mode,
        boardRect,
        sheetState: this._sheetState,
        safe,
      };
    }

    this.onChange(this.current);
  }

  dispose() {
    this._disposed = true;
    if (this._rafId) {
      window.cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    window.removeEventListener('resize', this._schedule);
    window.removeEventListener('orientationchange', this._schedule);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._schedule);
      window.visualViewport.removeEventListener('scroll', this._schedule);
    }
    if (this.testMode && typeof window !== 'undefined' && window.__layout) {
      delete window.__layout;
    }
  }
}
