/**
 * Application bootstrap (< 140 lines):
 * - Loads versioned settings (including persisted theme)
 * - Routes standalone utility pages (?effects ?voices ?sounds ?gallery ?preview)
 * - Mounts the hash router for Lobby, Mode Select, Room/Online, and Game screens
 */
import { getTheme, nextTheme } from './theme.js';
import { SfxManager } from './audio/sfx.js';
import { settingsStore } from './app/settings.js';
import { Router, buildHash } from './app/router.js';
import { createGameScreen } from './screens/gameScreen.js';
import {
  mountEffectsPage,
  mountVoicesPage,
  mountSoundsPage,
  mountGalleryOrPreview,
} from './pages/utilityPages.js';

export function applyUiThemeVars(theme) {
  const root = document.documentElement.style;
  const u = theme.ui;
  root.setProperty('--bg-center', u.bgCenter);
  root.setProperty('--bg-edge', u.bgEdge);
  root.setProperty('--panel-bg', u.panelBg);
  root.setProperty('--panel-border', u.panelBorder);
  root.setProperty('--text-primary', u.textPrimary);
  root.setProperty('--text-muted', u.textMuted);
  root.setProperty('--accent-gold', u.accentGold);
  root.setProperty('--danger', u.danger);
  root.setProperty('--btn-bg', u.btnBg);
  root.setProperty('--btn-hover', u.btnHover);
  root.setProperty('--fx-accent', u.fxAccent || u.accentGold);
  root.setProperty('--fx-accent-2', u.fxAccent2 || '#E07A3F');
}

async function init() {
  await document.fonts.ready;

  const params = new URLSearchParams(window.location.search);
  const isTestMode = params.has('test');

  const initialSettings = settingsStore.get();
  let theme = getTheme(params.get('theme') || initialSettings.theme);
  applyUiThemeVars(theme);

  const appRoot = document.getElementById('app');
  const stage = document.getElementById('board-stage');
  const modalRoot = document.getElementById('modal-root');
  if (!appRoot || !stage) return;

  const sfx = new SfxManager({ testMode: isTestMode });
  sfx.setVolume(initialSettings.audio.volume);
  sfx.setMuted(initialSettings.audio.muted);
  sfx.setVoiceEnabled(initialSettings.audio.voice);
  if (isTestMode) window.__sfx = sfx;

  // Bypass router for standalone utility/preview pages
  if (params.has('effects')) {
    mountEffectsPage(stage, sfx, theme, params, applyUiThemeVars);
    return;
  }
  if (params.has('voices')) {
    await mountVoicesPage(stage, sfx);
    return;
  }
  if (params.has('sounds')) {
    mountSoundsPage(stage, sfx);
    return;
  }
  if (mountGalleryOrPreview(stage, theme, params)) {
    return;
  }

  const ctx = {
    testMode: isTestMode,
    modalRoot,
    sfx,
    settingsStore,
    getTheme: () => theme,
    setThemeById(id) {
      theme = getTheme(id);
      applyUiThemeVars(theme);
      settingsStore.update((s) => {
        s.theme = theme.id;
      });
      return theme;
    },
    cycleTheme() {
      return this.setThemeById(nextTheme(theme.id).id);
    },
    toggleMute() {
      const muted = sfx.toggleMute();
      settingsStore.update((s) => {
        s.audio.muted = muted;
      });
      return muted;
    },
    toggleVoice() {
      const enabled = sfx.toggleVoice();
      settingsStore.update((s) => {
        s.audio.voice = enabled;
      });
      return enabled;
    },
    setVolume(vol) {
      sfx.setVolume(vol);
      settingsStore.update((s) => {
        s.audio.volume = sfx.getVolume();
      });
    },
  };

  // Legacy query-param compatibility (?mode=pvp|ai or ?fen=... without a hash)
  if (!window.location.hash && (params.has('mode') || params.has('fen'))) {
    const legacyMode = params.get('mode') === 'ai' ? 'ai' : 'local';
    const q = {};
    for (const k of ['side', 'level', 'engine', 'fen']) {
      if (params.has(k)) q[k] = params.get(k);
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${buildHash(`/play/cotuong/${legacyMode}`, q)}`);
  }

  // Phase 0 router (Phase 1 adds Lobby, Mode Select, and Settings screens)
  const router = new Router({
    container: appRoot,
    testMode: isTestMode,
    screens: {
      lobby: () => createGameScreen(ctx),
      mode: () => createGameScreen(ctx),
      online: () => createGameScreen(ctx),
      room: () => createGameScreen(ctx),
      join: () => createGameScreen(ctx),
      play: () => createGameScreen(ctx),
    },
  });
  ctx.router = router;
  router.start();
}

init();
