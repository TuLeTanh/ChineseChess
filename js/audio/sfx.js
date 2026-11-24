import { SOUND_EVENTS, SOUND_META, renderSoundBuffer } from './synth.js';
import { VoicePlayer } from './voice.js';

// Tunable bus gains (before master volume & limiter)
export const SFX_BUS_GAIN = 1.25;   // Wood clacks & tactile UI sounds (never ducked)
export const GONG_GAIN = 0.80;      // Bronze gongs & pentatonic arpeggios
export const VOICE_BUS_GAIN = 1.0;  // Ancient-general voice lines

const STORAGE_MUTED = 'xq_sfx_muted';
const STORAGE_VOLUME = 'xq_sfx_volume';
const STORAGE_VOICE = 'xq_voice_enabled';

const PRELOAD_SYNTH_KEYS = [
  ...SOUND_EVENTS,
  'move_classic',
  'capture_classic',
  'checkmate_gong',
  'checkmate_arp',
];

/**
 * Xiangqi sound effects + ancient-general voice manager:
 * - Separate sfxGain, gongGain, and voiceGain buses -> masterGain -> limiter (-3 dB, ratio 20)
 * - Wood clacks play immediately on currentTime (never ducked, peak capped <= 0.98)
 * - Tight, punchy voice timings + priority cancellation
 */
export class SfxManager {
  /**
   * @param {{
   *   testMode?: boolean,
   *   onCaption?: (info: { event: string, caption: string, pinyin: string, vi: string }) => void,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.testMode = Boolean(opts.testMode);
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.masterGain = null;
    /** @type {GainNode | null} */
    this.sfxGain = null;
    /** @type {GainNode | null} */
    this.gongGain = null;
    /** @type {GainNode | null} */
    this.voiceGain = null;
    /** @type {DynamicsCompressorNode | null} */
    this.limiter = null;
    /** @type {Map<string, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Promise<void> | null} */
    this._initPromise = null;
    /** @type {Set<number>} */
    this._timers = new Set();

    this.muted = false;
    this.volume = 0.7;
    this.voiceEnabled = true;
    this._loadSettings();

    if (this.testMode && typeof window !== 'undefined') {
      window.__sfxLog = [];
    }

    this.voice = new VoicePlayer({
      getAudioContext: () => this.ctx,
      getVoiceBusNode: () => this.voiceGain,
      onCaption: opts.onCaption,
      onVoiceLog: (ev) => this._logEvent(ev),
    });
  }

  isMuted() {
    return this.muted;
  }

  isVoiceEnabled() {
    return this.voiceEnabled;
  }

  getVolume() {
    return this.volume;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._saveSettings();
    if (this.muted) {
      this._cancelPending();
      this.voice.stopCurrent();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    this._saveSettings();
    if (!this.voiceEnabled) {
      this.voice.stopCurrent();
    }
  }

  toggleVoice() {
    this.setVoiceEnabled(!this.voiceEnabled);
    return this.voiceEnabled;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0));
    this._saveSettings();
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  ensureReady() {
    if (this.muted) return Promise.resolve();
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        const now = this.ctx.currentTime;

        // Limiter-style compressor on master: -3 dB, knee 0, ratio 20, attack 1 ms, release 60 ms
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.setValueAtTime(-3, now);
        this.limiter.knee.setValueAtTime(0, now);
        this.limiter.ratio.setValueAtTime(20, now);
        this.limiter.attack.setValueAtTime(0.001, now);
        this.limiter.release.setValueAtTime(0.06, now);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, now);
        this.masterGain.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(SFX_BUS_GAIN, now);
        this.sfxGain.connect(this.masterGain);

        this.gongGain = this.ctx.createGain();
        this.gongGain.gain.setValueAtTime(GONG_GAIN, now);
        this.gongGain.connect(this.masterGain);

        this.voiceGain = this.ctx.createGain();
        this.voiceGain.gain.setValueAtTime(VOICE_BUS_GAIN, now);
        this.voiceGain.connect(this.masterGain);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this._initPromise) {
      this._initPromise = this._preloadAll();
    }
    if (this.voiceEnabled) {
      this.voice.ensureLoaded();
    }
    return this._initPromise;
  }

  /**
   * Play a named sound event with tight, punchy voice & drum scheduling.
   * @param {string} eventName
   * @param {number} [delayMs]
   * @param {{ rawSynthOnly?: boolean, skipVoice?: boolean }} [opts]
   */
  play(eventName, delayMs = 0, opts = {}) {
    if (!SOUND_META[eventName]) return;
    if (this.muted) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (delayMs > 0) {
      this._schedule(delayMs, () => this.play(eventName, 0, opts));
      return;
    }

    const withVoice = this.voiceEnabled && !opts.rawSynthOnly && !opts.skipVoice;
    const gainScale = typeof opts.gainScale === 'number' ? opts.gainScale : 1.0;

    if (eventName === 'capture') {
      this._playBuffer('capture', gainScale, true, 'sfx');
      if (withVoice) {
        this._schedule(20, () => this._triggerVoice('capture'));
      }
      return;
    }

    if (eventName === 'check') {
      // Called at landing (0 ms): drum leads at +40 ms, voice "將軍" rides at +70 ms,
      // gong ducked -7 dB (0.447) under voice so speech stays clearly in front.
      if (withVoice) {
        this._schedule(40, () => {
          this._logEvent('check');
          this._playBuffer('drum', 0.85, false, 'gong');
        });
        this._schedule(70, () => this._triggerVoice('check'));
        this._schedule(80, () => this._playBuffer('check', 0.447, false, 'gong'));
      } else {
        this._schedule(120, () => {
          this._logEvent('check');
          this._playBuffer('check', 1.0, false, 'gong');
        });
      }
      return;
    }

    if (eventName === 'checkmate') {
      if (withVoice) {
        // Bigger gong (ducked -3 dB = 0.708), drums at 80 ms & 220 ms, voice "將死" at 300 ms,
        // arpeggio when "將死" ends, voice "承讓" 220 ms after "將死" ends.
        this._logEvent('checkmate');
        this._playBuffer('checkmate_gong', 0.708, false, 'gong');
        this._schedule(80, () => this._playBuffer('drum', 0.9, false, 'gong'));
        this._schedule(220, () => this._playBuffer('drum', 0.95, false, 'gong'));
        this._schedule(300, () => {
          this._triggerVoice('checkmate');
          const mateDurMs = Math.round(this.voice.getDuration('checkmate', 0.7) * 1000);
          this._schedule(mateDurMs, () => this._playBuffer('checkmate_arp', 0.85, false, 'gong'));
          this._schedule(mateDurMs + 220, () => this._triggerVoice('checkmate2'));
        });
      } else {
        this._playBuffer('checkmate', 1.0, true, 'gong');
      }
      return;
    }

    if (eventName === 'start') {
      this._playBuffer('start', withVoice ? 0.708 : 1.0, true, 'gong');
      if (withVoice) {
        this._schedule(40, () => this._playBuffer('drum', 0.45, false, 'gong'));
        this._schedule(250, () => this._triggerVoice('start'));
      }
      return;
    }

    if (eventName === 'draw') {
      this._playBuffer('draw', withVoice ? 0.708 : 1.0, true, 'gong');
      if (withVoice) {
        this._schedule(300, () => this._triggerVoice('draw'));
      }
      return;
    }

    const bus = SOUND_META[eventName].isGong ? 'gong' : 'sfx';
    this._playBuffer(eventName, gainScale, true, bus);
  }

  /**
   * Play the Cờ Úp reveal chime pitched by piece kind on a D-major pentatonic scale:
   * chariot D5, cannon E5, horse F#5, elephant A5, advisor B5, soldier D6 (softer).
   * @param {string} kind
   */
  playReveal(kind) {
    if (this.muted) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this._logEvent('reveal');

    const rates = {
      chariot: 1.0,
      cannon: 1.1225,
      horse: 1.2599,
      elephant: 1.4983,
      advisor: 1.6818,
      soldier: 2.0,
    };
    const rate = rates[kind] || 1.0;
    const gainScale = kind === 'soldier' ? 0.68 : 0.92;

    const scheduleNow = () => {
      if (this.muted || !this.ctx || !this.masterGain) return;
      const buf = this.buffers.get('reveal');
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(gainScale, this.ctx.currentTime);
      src.connect(gainNode);
      gainNode.connect(this.sfxGain || this.masterGain);
      src.start(this.ctx.currentTime);
    };

    if (this.ctx && this.buffers.has('reveal')) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      scheduleNow();
    } else {
      this.ensureReady().then(scheduleNow);
    }
  }

  /**
   * Play a voice line directly (used by ?sounds demo page).
   */
  playVoiceDirect(voiceKey, opts = {}) {
    if (this.muted) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.ensureReady().then(() => {
      if (this.muted) return;
      this.voice.play(voiceKey, opts);
    });
  }

  _triggerVoice(voiceKey) {
    if (this.muted || !this.voiceEnabled) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.ensureReady();
    this.voice.play(voiceKey, { processed: true });
  }

  _playBuffer(eventName, gainScale = 1.0, recordLog = true, bus = 'sfx') {
    if (this.muted) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (recordLog) this._logEvent(eventName);

    const scheduleNow = () => {
      if (this.muted) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!this.ctx || !this.masterGain) return;

      const buf = this.buffers.get(eventName);
      if (!buf) return;

      const src = this.ctx.createBufferSource();
      src.buffer = buf;

      const meta = SOUND_META[eventName];
      const gainNode = this.ctx.createGain();
      if (!meta.isGong) {
        const rateJitter = 0.95 + Math.random() * 0.10; // ±5%
        const gainJitter = 0.92 + Math.random() * 0.16; // ±8%
        // Cap gain so peak never exceeds 0.98 after variation
        const capped = Math.min(1.02, gainJitter * gainScale);
        src.playbackRate.setValueAtTime(rateJitter, this.ctx.currentTime);
        gainNode.gain.setValueAtTime(capped, this.ctx.currentTime);
      } else {
        gainNode.gain.setValueAtTime(gainScale, this.ctx.currentTime);
      }

      const targetBus = bus === 'gong' ? this.gongGain : this.sfxGain;
      src.connect(gainNode);
      gainNode.connect(targetBus || this.masterGain);
      src.start(this.ctx.currentTime);
    };

    // Zero-latency synchronous path when buffers are already preloaded
    if (this.ctx && this.buffers.has(eventName)) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      scheduleNow();
    } else {
      this.ensureReady().then(scheduleNow);
    }
  }

  _schedule(delayMs, fn) {
    const id = window.setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, delayMs);
    this._timers.add(id);
  }

  _logEvent(name) {
    if (this.testMode && typeof window !== 'undefined' && Array.isArray(window.__sfxLog)) {
      window.__sfxLog.push({ event: name, time: performance.now() });
    }
  }

  _cancelPending() {
    for (const id of this._timers) window.clearTimeout(id);
    this._timers.clear();
  }

  async _preloadAll() {
    const overrides = await this._discoverOverrides();
    await Promise.all(
      PRELOAD_SYNTH_KEYS.map(async (eventName) => {
        const overrideFile = overrides.get(eventName);
        if (overrideFile && this.ctx) {
          try {
            const resp = await fetch(`assets/sounds/${overrideFile}`);
            if (resp.ok) {
              const arr = await resp.arrayBuffer();
              const decoded = await this.ctx.decodeAudioData(arr);
              this.buffers.set(eventName, decoded);
              return;
            }
          } catch {
            // fallback to synth
          }
        }
        try {
          const sr = this.ctx ? this.ctx.sampleRate : 44100;
          const buf = await renderSoundBuffer(eventName, sr);
          this.buffers.set(eventName, buf);
        } catch {
          // ignore
        }
      })
    );
  }

  async _discoverOverrides() {
    const found = new Map();
    try {
      const resp = await fetch('assets/sounds/');
      if (!resp.ok) return found;
      const html = await resp.text();
      const regex = /href="([^"]+\.(?:ogg|mp3|wav))"/gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        const filename = m[1].split('/').pop() || '';
        const stem = filename.replace(/\.(ogg|mp3|wav)$/i, '').toLowerCase();
        if (SOUND_META[stem] && !found.has(stem)) {
          found.set(stem, filename);
        }
      }
    } catch {
      // ignore
    }
    return found;
  }

  _loadSettings() {
    try {
      const m = window.localStorage.getItem(STORAGE_MUTED);
      if (m !== null) this.muted = m === '1';
      const v = window.localStorage.getItem(STORAGE_VOLUME);
      if (v !== null) {
        const parsed = Number.parseFloat(v);
        if (Number.isFinite(parsed)) this.volume = Math.max(0, Math.min(1, parsed));
      }
      const ve = window.localStorage.getItem(STORAGE_VOICE);
      if (ve !== null) this.voiceEnabled = ve !== '0';
    } catch {
      // ignore
    }
  }

  _saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_MUTED, this.muted ? '1' : '0');
      window.localStorage.setItem(STORAGE_VOLUME, String(this.volume));
      window.localStorage.setItem(STORAGE_VOICE, this.voiceEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }
}
