/**
 * Unified versioned settings store under localStorage key `xq_settings_v1`.
 * Migrates legacy `xq_*` keys once, validates schema, persists theme, and
 * gracefully falls back to defaults on corrupt JSON or unavailable storage.
 */

import { generateUuidV4 } from './uuid.js';

export const SETTINGS_KEY = 'xq_settings_v1';

const LEGACY_KEYS = {
  mode: 'xq_game_mode',
  side: 'xq_player_side',
  level: 'xq_ai_level',
  engine: 'xq_ai_engine',
  muted: 'xq_sfx_muted',
  volume: 'xq_sfx_volume',
  voice: 'xq_voice_enabled',
};

function generateGuestId() {
  return generateUuidV4();
}

function defaultNickname() {
  const num = String(1000 + Math.floor(Math.random() * 9000));
  return `Khách ${num}`;
}

export function isValidNickname(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 16) return false;
  return /^[\p{L}\p{N} _-]+$/u.test(trimmed);
}

export function sanitizeNickname(name, fallback = null) {
  if (typeof name === 'string') {
    const cleaned = name.trim().replace(/\s+/g, ' ');
    if (isValidNickname(cleaned)) return cleaned;
  }
  return fallback || defaultNickname();
}

export function isValidServerUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '') return true; // empty = auto
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:';
  } catch {
    return false;
  }
}

export function createDefaultSettings() {
  return {
    v: 2,
    nickname: defaultNickname(),
    guestId: generateGuestId(),
    theme: 'go-lim',
    notation: 'traditional', // 'traditional' | 'coord'
    bgQuality: 'high', // 'high' | 'low' | 'off'
    haptics: true,
    touchLift: true,
    keepAwake: true,
    audio: {
      volume: 0.7,
      muted: false,
      voice: true,
    },
    jieqi: {
      showPool: true,
      confirmResign: true,
    },
    storage: {
      saveFinishedGames: true,
      autosaveInProgress: true,
    },
    online: {
      serverUrl: '',
    },
    last: {
      game: 'cotuong',
      mode: 'ai',
      side: 'red',
      level: 'nghiep-du',
      engine: 'pikafish',
      tc: 'nhanh',
      freeMove: false,
      autoFlip: false,
    },
    ratings: {
      xiangqi: { elo: null, games: 0 },
      jieqi: { elo: null, games: 0 },
    },
  };
}

function safeGet(key) {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore storage errors
  }
}

function safeRemove(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function normalizeSettings(raw) {
  const def = createDefaultSettings();
  if (!raw || typeof raw !== 'object') return def;

  const out = {
    v: 2,
    nickname: sanitizeNickname(raw.nickname, def.nickname),
    guestId:
      typeof raw.guestId === 'string' && /^[0-9a-f-]{36}$/i.test(raw.guestId)
        ? raw.guestId.toLowerCase()
        : def.guestId,
    theme: raw.theme === 'ngoc-bich' ? 'ngoc-bich' : 'go-lim',
    notation: raw.notation === 'coord' ? 'coord' : 'traditional',
    bgQuality: ['high', 'low', 'off'].includes(raw.bgQuality) ? raw.bgQuality : def.bgQuality,
    haptics: typeof raw.haptics === 'boolean' ? raw.haptics : true,
    touchLift: typeof raw.touchLift === 'boolean' ? raw.touchLift : true,
    keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : true,
    audio: {
      volume:
        typeof raw.audio?.volume === 'number' && Number.isFinite(raw.audio.volume)
          ? Math.max(0, Math.min(1, raw.audio.volume))
          : def.audio.volume,
      muted: typeof raw.audio?.muted === 'boolean' ? raw.audio.muted : def.audio.muted,
      voice: typeof raw.audio?.voice === 'boolean' ? raw.audio.voice : def.audio.voice,
    },
    jieqi: {
      showPool: typeof raw.jieqi?.showPool === 'boolean' ? raw.jieqi.showPool : true,
      confirmResign: typeof raw.jieqi?.confirmResign === 'boolean' ? raw.jieqi.confirmResign : true,
    },
    storage: {
      saveFinishedGames:
        typeof raw.storage?.saveFinishedGames === 'boolean' ? raw.storage.saveFinishedGames : true,
      autosaveInProgress:
        typeof raw.storage?.autosaveInProgress === 'boolean' ? raw.storage.autosaveInProgress : true,
    },
    online: {
      serverUrl: isValidServerUrl(raw.online?.serverUrl) ? String(raw.online.serverUrl).trim() : '',
    },
    last: {
      game: raw.last?.game === 'coup' ? 'coup' : 'cotuong',
      mode: ['local', 'ai', 'online'].includes(raw.last?.mode) ? raw.last.mode : 'ai',
      side: ['red', 'black', 'random'].includes(raw.last?.side) ? raw.last.side : 'red',
      level: ['tap-su', 'nghiep-du', 'cao-thu', 'dai-su'].includes(raw.last?.level)
        ? raw.last.level
        : 'nghiep-du',
      engine: raw.last?.engine === 'js' ? 'js' : 'pikafish',
      tc: ['chop', 'nhanh', 'cham', 'none'].includes(raw.last?.tc) ? raw.last.tc : 'nhanh',
      freeMove: Boolean(raw.last?.freeMove),
      autoFlip: Boolean(raw.last?.autoFlip),
    },
    ratings: {
      xiangqi: {
        elo: typeof raw.ratings?.xiangqi?.elo === 'number' ? raw.ratings.xiangqi.elo : null,
        games: typeof raw.ratings?.xiangqi?.games === 'number' ? raw.ratings.xiangqi.games : 0,
      },
      jieqi: {
        elo: typeof raw.ratings?.jieqi?.elo === 'number' ? raw.ratings.jieqi.elo : null,
        games: typeof raw.ratings?.jieqi?.games === 'number' ? raw.ratings.jieqi.games : 0,
      },
    },
  };
  return out;
}

class SettingsStore {
  constructor() {
    this._listeners = new Set();
    this._data = this._load();
  }

  _load() {
    const rawStr = safeGet(SETTINGS_KEY);
    if (rawStr) {
      try {
        return normalizeSettings(JSON.parse(rawStr));
      } catch {
        // corrupt JSON -> fall through to defaults
      }
    }

    // One-time migration from legacy xq_* keys
    const def = createDefaultSettings();
    const legMode = safeGet(LEGACY_KEYS.mode);
    const legSide = safeGet(LEGACY_KEYS.side);
    const legLevel = safeGet(LEGACY_KEYS.level);
    const legEngine = safeGet(LEGACY_KEYS.engine);
    const legMuted = safeGet(LEGACY_KEYS.muted);
    const legVol = safeGet(LEGACY_KEYS.volume);
    const legVoice = safeGet(LEGACY_KEYS.voice);

    if (legMode === 'pvp') def.last.mode = 'local';
    else if (legMode === 'ai') def.last.mode = 'ai';
    if (legSide === 'red' || legSide === 'black') def.last.side = legSide;
    if (['tap-su', 'nghiep-du', 'cao-thu', 'dai-su'].includes(legLevel)) def.last.level = legLevel;
    if (legEngine === 'js' || legEngine === 'pikafish') def.last.engine = legEngine;
    if (legMuted !== null) def.audio.muted = legMuted === '1';
    if (legVol !== null) {
      const v = Number.parseFloat(legVol);
      if (Number.isFinite(v)) def.audio.volume = Math.max(0, Math.min(1, v));
    }
    if (legVoice !== null) def.audio.voice = legVoice !== '0';

    this._save(def);
    return def;
  }

  _save(data) {
    safeSet(SETTINGS_KEY, JSON.stringify(data));
    // Mirror key audio prefs to legacy keys for full backward compatibility
    safeSet(LEGACY_KEYS.muted, data.audio.muted ? '1' : '0');
    safeSet(LEGACY_KEYS.volume, String(data.audio.volume));
    safeSet(LEGACY_KEYS.voice, data.audio.voice ? '1' : '0');
  }

  get() {
    return this._data;
  }

  update(mutator) {
    const draft = structuredClone(this._data);
    mutator(draft);
    this._data = normalizeSettings(draft);
    this._save(this._data);
    for (const fn of this._listeners) {
      try {
        fn(this._data);
      } catch {
        // ignore listener errors
      }
    }
    return this._data;
  }

  resetAll() {
    safeRemove(SETTINGS_KEY);
    for (const k of Object.values(LEGACY_KEYS)) safeRemove(k);
    this._data = createDefaultSettings();
    this._save(this._data);
    for (const fn of this._listeners) {
      try {
        fn(this._data);
      } catch {
        // ignore
      }
    }
    return this._data;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

export const settingsStore = new SettingsStore();
