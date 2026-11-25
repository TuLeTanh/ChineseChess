/**
 * Interactive Bottom Sheet controller for `stack` layout (C3).
 * States: 'closed' | 'half' (60 dvh) | 'full' (92 dvh minus top bar).
 * Uses transform-only animations (200 ms, none under reduced motion), pointer capture
 * on the 44 px handle, velocity flick snap, 40% dim backdrop, Esc close, focus return,
 * and tabs ("Nước đi | Quân úp | Tùy chọn") reusing the existing DOM nodes.
 */

export class BottomSheet {
  /**
   * @param {{
   *   sheetEl: HTMLElement,
   *   hostContainer: HTMLElement,
   *   onStateChange?: (state: 'closed'|'half'|'full') => void,
   * }} opts
   */
  constructor(opts) {
    this.sheetEl = opts.sheetEl;
    this.hostContainer = opts.hostContainer;
    this.onStateChange = opts.onStateChange || (() => {});

    this.state = 'closed';
    this.enabled = false;
    this._opener = null;
    this._drag = null;

    this.handleEl = this.sheetEl.querySelector('[data-testid="sheet-handle"]');
    this.tabsEl = this.sheetEl.querySelector('[data-testid="sheet-tabs"]');
    this.scrollBody = this.sheetEl.querySelector('.sheet-scroll-body');

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'sheet-backdrop';
    this.backdropEl.dataset.testid = 'sheet-backdrop';
    this.backdropEl.hidden = true;
    this.hostContainer.appendChild(this.backdropEl);

    this._onBackdropClick = () => this.close();
    this._onTabClick = (ev) => {
      const btn = ev.target.closest('button[data-stab]');
      if (!btn) return;
      this.selectTab(btn.dataset.stab);
    };
    this._onKeyDown = (ev) => {
      if (!this.enabled || this.state === 'closed') return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
      }
    };
    this._onHandleDown = this._onHandleDown.bind(this);
    this._onHandleMove = this._onHandleMove.bind(this);
    this._onHandleUp = this._onHandleUp.bind(this);

    this.backdropEl.addEventListener('click', this._onBackdropClick);
    if (this.tabsEl) this.tabsEl.addEventListener('click', this._onTabClick);
    if (this.handleEl) {
      this.handleEl.addEventListener('pointerdown', this._onHandleDown);
      this.handleEl.addEventListener('pointermove', this._onHandleMove);
      this.handleEl.addEventListener('pointerup', this._onHandleUp);
      this.handleEl.addEventListener('pointercancel', this._onHandleUp);
    }
    window.addEventListener('keydown', this._onKeyDown, true);
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.enabled === next) return;
    this.enabled = next;
    if (!next) {
      this.state = 'closed';
      this._applyState(false);
    }
  }

  selectTab(tabId) {
    if (!this.sheetEl) return;
    for (const btn of this.sheetEl.querySelectorAll('.sheet-tab')) {
      const active = btn.dataset.stab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    for (const pane of this.sheetEl.querySelectorAll('.sheet-pane')) {
      pane.classList.toggle('is-active', pane.dataset.spane === tabId);
    }
  }

  open(targetState = 'half', opener = null) {
    if (!this.enabled) return;
    this._opener = opener || document.activeElement;
    this.state = targetState === 'full' ? 'full' : 'half';
    this._applyState(true);
    if (this.handleEl && typeof this.handleEl.focus === 'function') {
      try {
        this.handleEl.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this._applyState(true);
    if (this._opener && typeof this._opener.focus === 'function') {
      try {
        this._opener.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
    this._opener = null;
  }

  toggle(opener = null) {
    if (this.state === 'closed') this.open('half', opener);
    else this.close();
  }

  _getHeights() {
    const vh = Math.max(320, window.innerHeight || 640);
    const fullH = Math.round(vh * 0.92 - 44);
    const halfH = Math.round(vh * 0.60);
    return { vh, fullH, halfH };
  }

  _translateForState(st) {
    const { fullH, halfH } = this._getHeights();
    if (st === 'full') return 0;
    if (st === 'half') return Math.max(0, fullH - halfH);
    return fullH + 40;
  }

  _applyState(notify = true) {
    if (!this.sheetEl) return;
    this.sheetEl.dataset.state = this.state;
    this.sheetEl.classList.remove('is-dragging');
    if (!this.enabled) {
      this.sheetEl.style.transform = '';
      this.backdropEl.hidden = true;
      if (notify) this.onStateChange(this.state);
      return;
    }
    const ty = this._translateForState(this.state);
    this.sheetEl.style.transform = `translate3d(0, ${ty}px, 0)`;
    this.backdropEl.hidden = this.state === 'closed';
    if (notify) this.onStateChange(this.state);
  }

  _onHandleDown(ev) {
    if (!this.enabled) return;
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    ev.preventDefault();
    this.handleEl.setPointerCapture(ev.pointerId);
    const baseTy = this._translateForState(this.state);
    this._drag = {
      pointerId: ev.pointerId,
      startY: ev.clientY,
      lastY: ev.clientY,
      lastTs: performance.now(),
      velY: 0,
      baseTy,
      curTy: baseTy,
    };
    this.sheetEl.classList.add('is-dragging');
  }

  _onHandleMove(ev) {
    if (!this._drag || ev.pointerId !== this._drag.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - this._drag.lastTs);
    const dy = ev.clientY - this._drag.lastY;
    this._drag.velY = dy / dt; // px/ms (+ down, - up)
    this._drag.lastY = ev.clientY;
    this._drag.lastTs = now;

    const { fullH } = this._getHeights();
    const ty = Math.max(0, Math.min(fullH + 40, this._drag.baseTy + (ev.clientY - this._drag.startY)));
    this._drag.curTy = ty;
    this.sheetEl.style.transform = `translate3d(0, ${ty.toFixed(1)}px, 0)`;
  }

  _onHandleUp(ev) {
    if (!this._drag || ev.pointerId !== this._drag.pointerId) return;
    const d = this._drag;
    this._drag = null;
    if (this.handleEl.hasPointerCapture(ev.pointerId)) {
      this.handleEl.releasePointerCapture(ev.pointerId);
    }
    this.sheetEl.classList.remove('is-dragging');

    const { fullH, halfH } = this._getHeights();
    const halfTy = Math.max(0, fullH - halfH);
    const closedTy = fullH + 40;

    // Velocity flick snap (> 0.45 px/ms)
    if (d.velY > 0.45) {
      this.state = this.state === 'full' ? 'half' : 'closed';
    } else if (d.velY < -0.45) {
      this.state = this.state === 'closed' ? 'half' : 'full';
    } else {
      // Nearest snap point
      const dists = [
        ['full', Math.abs(d.curTy - 0)],
        ['half', Math.abs(d.curTy - halfTy)],
        ['closed', Math.abs(d.curTy - closedTy)],
      ];
      dists.sort((a, b) => a[1] - b[1]);
      this.state = dists[0][0];
    }
    this._applyState(true);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    this.backdropEl.removeEventListener('click', this._onBackdropClick);
    if (this.tabsEl) this.tabsEl.removeEventListener('click', this._onTabClick);
    if (this.handleEl) {
      this.handleEl.removeEventListener('pointerdown', this._onHandleDown);
      this.handleEl.removeEventListener('pointermove', this._onHandleMove);
      this.handleEl.removeEventListener('pointerup', this._onHandleUp);
      this.handleEl.removeEventListener('pointercancel', this._onHandleUp);
    }
    this.backdropEl.remove();
  }
}
