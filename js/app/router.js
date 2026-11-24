/**
 * Lightweight dependency-free hash router + screen lifecycle & leak tracker.
 *
 * Supported routes:
 *   #/                             -> { name: 'lobby' }
 *   #/g/cotuong | #/g/coup         -> { name: 'mode', game }
 *   #/g/<game>/online              -> { name: 'online', game }
 *   #/g/<game>/room                -> { name: 'room', game }
 *   #/join/<CODE>                  -> { name: 'join', code }
 *   #/play/<game>/<mode>?...       -> { name: 'play', game, mode, query }
 */

/**
 * Parse a location.hash string into a structured route object.
 * @param {string} hashStr
 */
export function parseHash(hashStr) {
  const cleaned = String(hashStr || '').replace(/^#/, '');
  const qIdx = cleaned.indexOf('?');
  const rawPath = (qIdx >= 0 ? cleaned.slice(0, qIdx) : cleaned) || '/';
  const rawQuery = qIdx >= 0 ? cleaned.slice(qIdx + 1) : '';
  const query = Object.fromEntries(new URLSearchParams(rawQuery).entries());

  const parts = rawPath.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { name: 'lobby', path: '/', query };
  }
  if (parts[0] === 'g' && (parts[1] === 'cotuong' || parts[1] === 'coup')) {
    const game = parts[1];
    if (parts.length === 2) {
      return { name: 'mode', game, path: `/g/${game}`, query };
    }
    if (parts[2] === 'online') {
      return { name: 'online', game, path: `/g/${game}/online`, query };
    }
    if (parts[2] === 'room') {
      return { name: 'room', game, path: `/g/${game}/room`, query };
    }
  }
  if (parts[0] === 'join' && parts[1]) {
    const code = parts[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return { name: 'join', code, path: `/join/${code}`, query };
  }
  if (
    parts[0] === 'play' &&
    (parts[1] === 'cotuong' || parts[1] === 'coup') &&
    ['local', 'ai', 'online'].includes(parts[2])
  ) {
    return {
      name: 'play',
      game: parts[1],
      mode: parts[2],
      path: `/play/${parts[1]}/${parts[2]}`,
      query,
    };
  }
  return { name: 'lobby', path: '/', query };
}

/**
 * Build a hash string from path + optional query object.
 * @param {string} path
 * @param {Record<string, string | number | boolean | null | undefined>} [query]
 */
export function buildHash(path, query = null) {
  const base = path.startsWith('/') ? `#${path}` : `#/${path}`;
  if (!query) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Dev/test leak tracker exposed on window.__leaks when ?test is set.
 */
export const leakTracker = {
  listeners: 0,
  canvases: 0,
  workers: 0,
  sockets: 0,
  timers: 0,
  trackListener(delta) {
    this.listeners = Math.max(0, this.listeners + delta);
  },
  trackCanvas(delta) {
    this.canvases = Math.max(0, this.canvases + delta);
  },
  trackWorker(delta) {
    this.workers = Math.max(0, this.workers + delta);
  },
  trackSocket(delta) {
    this.sockets = Math.max(0, this.sockets + delta);
  },
  trackTimer(delta) {
    this.timers = Math.max(0, this.timers + delta);
  },
  snapshot() {
    return {
      listeners: this.listeners,
      canvases: this.canvases,
      workers: this.workers,
      sockets: this.sockets,
      timers: this.timers,
    };
  },
};

export class Router {
  /**
   * @param {{
   *   container: HTMLElement,
   *   screens: Record<string, (route: any) => { mount: (el: HTMLElement, route: any) => any, unmount: () => void }>,
   *   testMode?: boolean,
   *   beforeLeave?: (from: any, to: any) => Promise<boolean> | boolean,
   * }} opts
   */
  constructor(opts) {
    this.container = opts.container;
    this.screens = opts.screens;
    this.testMode = Boolean(opts.testMode);
    this.beforeLeave = opts.beforeLeave || null;
    this.currentRoute = null;
    this.currentScreen = null;
    this._navToken = 0;
    this._ignoreHashOnce = false;

    this._onHashChange = this._onHashChange.bind(this);
  }

  start() {
    if (this.testMode && typeof window !== 'undefined') {
      window.__leaks = leakTracker;
    }
    window.addEventListener('hashchange', this._onHashChange);
    this._renderHash(window.location.hash || '#/');
  }

  stop() {
    window.removeEventListener('hashchange', this._onHashChange);
    this._unmountCurrent();
  }

  navigate(hashOrPath, query = null) {
    const targetHash = hashOrPath.startsWith('#') ? hashOrPath : buildHash(hashOrPath, query);
    if (window.location.hash === targetHash) {
      this._renderHash(targetHash);
      return;
    }
    window.location.hash = targetHash;
  }

  replace(hashOrPath, query = null) {
    const targetHash = hashOrPath.startsWith('#') ? hashOrPath : buildHash(hashOrPath, query);
    const url = `${window.location.pathname}${window.location.search}${targetHash}`;
    window.history.replaceState(null, '', url);
    this._renderHash(targetHash);
  }

  async _onHashChange() {
    if (this._ignoreHashOnce) {
      this._ignoreHashOnce = false;
      return;
    }
    const nextRoute = parseHash(window.location.hash);
    if (this.currentRoute && this.beforeLeave) {
      const ok = await this.beforeLeave(this.currentRoute, nextRoute);
      if (!ok) {
        this._ignoreHashOnce = true;
        window.location.hash = buildHash(this.currentRoute.path, this.currentRoute.query);
        return;
      }
    }
    await this._renderRoute(nextRoute);
  }

  async _renderHash(hashStr) {
    const nextRoute = parseHash(hashStr);
    await this._renderRoute(nextRoute);
  }

  _unmountCurrent() {
    if (this.currentScreen && typeof this.currentScreen.unmount === 'function') {
      try {
        this.currentScreen.unmount();
      } catch (err) {
        console.error('Screen unmount error:', err);
      }
    }
    this.currentScreen = null;
    this.container.innerHTML = '';
  }

  async _renderRoute(route) {
    const token = ++this._navToken;
    this._unmountCurrent();
    this.currentRoute = route;

    if (this.testMode && typeof window !== 'undefined') {
      window.__router = { route: route.name, params: route };
    }

    const factory = this.screens[route.name] || this.screens.lobby;
    if (!factory) return;
    const screen = factory(route);
    this.currentScreen = screen;
    await screen.mount(this.container, route);
    if (token !== this._navToken) {
      // Superseded while mounting
      if (typeof screen.unmount === 'function') screen.unmount();
    }
  }
}
