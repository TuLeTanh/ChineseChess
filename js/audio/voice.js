/**
 * "Ancient General" Chinese voice engine (decisive, commanding character):
 * - Tight silence trimming (leading |x| > 0.015 - 5 ms, trailing + 50 ms w/ 30 ms fade-out, 3 ms hard attack)
 * - Transient boost envelope: 1.35x -> 1.0 over first 90 ms
 * - Web Audio DSP chain:
 *     source -> lowshelf (+6 dB @ 180 Hz) -> peaking (+4 dB @ 2.4 kHz, Q 0.9)
 *            -> WaveShaper (soft tanh drive 1.6, 2x oversample)
 *            -> compressor (-22 dB, ratio 5, attack 2 ms, release 80 ms)
 *            -> dry 0.95 + ConvolverNode (0.45 s stereo hall, pre-delay 10 ms, LP 4 kHz) wet 0.08
 * - RMS normalization to 0.11 (capped 3x), priority cancellation (60 ms fade-out),
 *   and speechSynthesis fallback if manifest/files are missing.
 */

const TARGET_RMS = 0.11;
const MAX_NORM_GAIN = 3.0;

export const VOICE_PRIORITY = {
  checkmate: 4,
  checkmate2: 4,
  check: 3,
  capture: 2,
  start: 1,
  draw: 1,
};

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a compact stereo hall impulse response:
 * length 0.45 s, pre-delay 10 ms, exponential decay, one-pole lowpass ~4 kHz.
 * @param {BaseAudioContext} ctx
 * @returns {AudioBuffer}
 */
export function createHallImpulse(ctx) {
  const sr = ctx.sampleRate;
  const duration = 0.45;
  const preDelaySamples = Math.floor(sr * 0.010);
  const length = Math.ceil(sr * duration);
  const ir = ctx.createBuffer(2, length, sr);
  const alpha = Math.exp((-2 * Math.PI * 4000) / sr);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    const rand = makeRng(2026 + ch * 97);
    let lp = 0;
    for (let i = preDelaySamples; i < length; i++) {
      const t = (i - preDelaySamples) / sr;
      const env = Math.exp(-t / 0.12);
      const raw = (rand() * 2 - 1) * env;
      lp = (1 - alpha) * raw + alpha * lp;
      data[i] = lp;
    }
  }
  return ir;
}

/**
 * Create a mild soft-tanh saturation curve (drive ~1.6) for vocal grit & presence.
 * @param {number} [drive]
 * @returns {Float32Array}
 */
function makeTanhCurve(drive = 1.6) {
  const n = 512;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

const SATURATION_CURVE = makeTanhCurve(1.6);

/**
 * Build the decisive "Ancient General" processing chain connected to `dest`.
 * Optional `eqBoostDb` adds extra lowshelf warmth at 160 Hz (used for higher-pitched voices).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {number} [eqBoostDb]
 * @returns {{ input: AudioNode }}
 */
export function createVoiceChain(ctx, dest, eqBoostDb = 0) {
  let head = null;
  const lowshelf = ctx.createBiquadFilter();
  lowshelf.type = 'lowshelf';
  lowshelf.frequency.setValueAtTime(180, 0);
  lowshelf.gain.setValueAtTime(6.0, 0);

  if (eqBoostDb && eqBoostDb !== 0) {
    const extraLow = ctx.createBiquadFilter();
    extraLow.type = 'lowshelf';
    extraLow.frequency.setValueAtTime(160, 0);
    extraLow.gain.setValueAtTime(eqBoostDb, 0);
    extraLow.connect(lowshelf);
    head = extraLow;
  } else {
    head = lowshelf;
  }

  const peaking = ctx.createBiquadFilter();
  peaking.type = 'peaking';
  peaking.frequency.setValueAtTime(2400, 0);
  peaking.Q.setValueAtTime(0.9, 0);
  peaking.gain.setValueAtTime(4.0, 0);

  const shaper = ctx.createWaveShaper();
  shaper.curve = SATURATION_CURVE;
  shaper.oversample = '2x';

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-22, 0);
  comp.knee.setValueAtTime(6, 0);
  comp.ratio.setValueAtTime(5, 0);
  comp.attack.setValueAtTime(0.002, 0);
  comp.release.setValueAtTime(0.08, 0);

  const dryGain = ctx.createGain();
  dryGain.gain.setValueAtTime(0.95, 0);

  const convolver = ctx.createConvolver();
  convolver.buffer = createHallImpulse(ctx);

  const wetGain = ctx.createGain();
  wetGain.gain.setValueAtTime(0.08, 0);

  lowshelf.connect(peaking);
  peaking.connect(shaper);
  shaper.connect(comp);
  comp.connect(dryGain);
  dryGain.connect(dest);
  comp.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(dest);

  return { input: head };
}

/**
 * Tightly trim leading & trailing silence from a decoded AudioBuffer:
 * - Leading: first sample with |x| > 0.015, minus 5 ms; 3 ms hard fade-in
 * - Trailing: last sample with |x| > 0.015, plus 50 ms tail with 30 ms fade-out
 * @param {BaseAudioContext} ctx
 * @param {AudioBuffer} buf
 * @returns {AudioBuffer}
 */
export function trimSilence(ctx, buf) {
  const sr = buf.sampleRate;
  const len = buf.length;
  const numCh = buf.numberOfChannels;
  const threshold = 0.015;

  let first = -1;
  let last = -1;
  for (let c = 0; c < numCh; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      if (Math.abs(data[i]) > threshold) {
        if (first === -1 || i < first) first = i;
        if (i > last) last = i;
      }
    }
  }

  if (first === -1 || last === -1) return buf;

  const leadPad = Math.floor(sr * 0.005);
  const tailPad = Math.floor(sr * 0.050);
  const start = Math.max(0, first - leadPad);
  const end = Math.min(len, last + 1 + tailPad);
  const outLen = Math.max(1, end - start);

  const out = ctx.createBuffer(numCh, outLen, sr);
  const fadeInSamples = Math.min(outLen, Math.floor(sr * 0.003));
  const fadeOutSamples = Math.min(outLen, Math.floor(sr * 0.030));
  const fadeOutStart = outLen - fadeOutSamples;

  for (let c = 0; c < numCh; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < outLen; i++) {
      let s = src[start + i];
      if (i < fadeInSamples && fadeInSamples > 0) {
        s *= i / fadeInSamples;
      }
      if (i >= fadeOutStart && fadeOutSamples > 0) {
        s *= Math.max(0, (outLen - 1 - i) / fadeOutSamples);
      }
      dst[i] = s;
    }
  }
  return out;
}

/**
 * Measure RMS of an AudioBuffer across all channels.
 * @param {AudioBuffer} buf
 * @returns {number}
 */
export function measureBufferRms(buf) {
  let sumSq = 0;
  let total = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      sumSq += ch[i] * ch[i];
    }
    total += ch.length;
  }
  return total > 0 ? Math.sqrt(sumSq / total) : 0;
}

/**
 * Compute normalization gain to reach TARGET_RMS (capped at 3x), scaled by manifest gain.
 * @param {AudioBuffer} buf
 * @param {number} [manifestGain]
 * @returns {number}
 */
export function computeNormalizedGain(buf, manifestGain = 1.0) {
  const rms = measureBufferRms(buf);
  const autoGain = rms > 0.0005 ? Math.min(MAX_NORM_GAIN, TARGET_RMS / rms) : 1.0;
  return autoGain * (Number.isFinite(manifestGain) ? manifestGain : 1.0);
}

/**
 * Apply the commanding transient-boost gain envelope (1.35x -> 1.0 over 90 ms).
 * @param {GainNode} gainNode
 * @param {number} baseGain
 * @param {number} startTime
 */
export function applyTransientBoost(gainNode, baseGain, startTime) {
  gainNode.gain.setValueAtTime(baseGain * 1.35, startTime);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, baseGain), startTime + 0.09);
}

export class VoicePlayer {
  /**
   * @param {{
   *   getAudioContext: () => AudioContext | null,
   *   getVoiceBusNode: () => AudioNode | null,
   *   onCaption?: (info: { event: string, caption: string, pinyin: string, vi: string }) => void,
   *   onVoiceLog?: (eventName: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.getAudioContext = opts.getAudioContext;
    this.getVoiceBusNode = opts.getVoiceBusNode;
    this.onCaption = opts.onCaption || (() => {});
    this.onVoiceLog = opts.onVoiceLog || (() => {});

    this.manifest = null;
    this.decoded = new Map();
    /** @type {Map<number, { input: AudioNode }>} */
    this.chains = new Map();
    this._loadPromise = null;
    this.current = null;
  }

  /** Return trimmed duration in seconds for a voice event. */
  getDuration(eventKey, fallbackSec = 0.65) {
    const entry = this._pickEntry(eventKey, 0);
    return entry && entry.buffer ? entry.buffer.duration : fallbackSec;
  }

  ensureLoaded() {
    if (!this._loadPromise) {
      this._loadPromise = this._loadAll();
    }
    return this._loadPromise;
  }

  stopCurrent() {
    if (!this.current) return;
    const { source, gain } = this.current;
    this.current = null;
    const ctx = this.getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.06);
        source.stop(now + 0.065);
      } catch {
        // already stopped
      }
    }
  }

  play(eventKey, opts = {}) {
    const priority = VOICE_PRIORITY[eventKey] || 1;
    if (this.current && priority < this.current.priority) return;
    if (this.current && priority >= this.current.priority) this.stopCurrent();

    this.onVoiceLog(`voice:${eventKey}`);

    this.ensureLoaded().then(() => {
      const entry = this._pickEntry(eventKey, opts.variantIndex);
      if (!entry) {
        this._fallbackSpeech(eventKey);
        return;
      }

      this.onCaption({
        event: eventKey,
        caption: entry.meta.caption || '',
        pinyin: entry.meta.pinyin || '',
        vi: entry.meta.vi || '',
      });

      const ctx = this.getAudioContext();
      const bus = this.getVoiceBusNode();
      if (!ctx || !bus) return;

      const eqBoost = Number(entry.meta.eqBoost || 0);
      let chain = this.chains.get(eqBoost);
      if (!chain) {
        chain = createVoiceChain(ctx, bus, eqBoost);
        this.chains.set(eqBoost, chain);
      }

      if (this.current && priority < this.current.priority) return;
      if (this.current && priority >= this.current.priority) this.stopCurrent();

      const src = ctx.createBufferSource();
      src.buffer = entry.buffer;

      const rate = 0.97 + Math.random() * 0.06;
      const gainJitter = 0.95 + Math.random() * 0.10;
      src.playbackRate.setValueAtTime(rate, ctx.currentTime);

      const g = ctx.createGain();
      const baseGain = entry.gain * gainJitter;
      if (opts.processed === false) {
        g.gain.setValueAtTime(baseGain, ctx.currentTime);
        src.connect(g);
        g.connect(bus);
      } else {
        applyTransientBoost(g, baseGain, ctx.currentTime);
        src.connect(g);
        g.connect(chain.input);
      }

      const token = { source: src, gain: g, priority };
      this.current = token;
      src.onended = () => {
        if (this.current === token) this.current = null;
      };
      src.start(ctx.currentTime);
    });
  }

  _pickEntry(eventKey, variantIndex) {
    if (!this.manifest || !this.manifest.files) return null;
    if (eventKey === 'checkmate2') {
      const list = this.manifest.files.checkmate || [];
      return list[1] ? this.decoded.get(list[1].file) || null : null;
    }
    if (eventKey === 'checkmate') {
      const list = this.manifest.files.checkmate || [];
      return list[0] ? this.decoded.get(list[0].file) || null : null;
    }
    const list = this.manifest.files[eventKey] || [];
    if (list.length === 0) return null;
    const idx =
      typeof variantIndex === 'number'
        ? Math.max(0, Math.min(list.length - 1, variantIndex))
        : Math.floor(Math.random() * list.length);
    return list[idx] ? this.decoded.get(list[idx].file) || null : null;
  }

  async _loadAll() {
    try {
      const resp = await fetch(`assets/voice/manifest.json?v=${Date.now()}`);
      if (!resp.ok) return;
      const parsed = await resp.json();
      if (!parsed || parsed.empty || !parsed.files) return;
      this.manifest = parsed;
    } catch {
      return;
    }

    const ctx = this.getAudioContext();
    if (!ctx || !this.manifest || !this.manifest.files) return;

    const ver = encodeURIComponent(this.manifest.version || String(Date.now()));
    const allMetas = Object.values(this.manifest.files).flat();
    await Promise.all(
      allMetas.map(async (meta) => {
        if (!meta || !meta.file || this.decoded.has(meta.file)) return;
        try {
          const r = await fetch(`assets/voice/${meta.file}?v=${ver}`);
          if (!r.ok) return;
          const arr = await r.arrayBuffer();
          const rawBuf = await ctx.decodeAudioData(arr);
          const buf = trimSilence(ctx, rawBuf);
          const gain = computeNormalizedGain(buf, meta.gain ?? 1.0);
          this.decoded.set(meta.file, { buffer: buf, rawDuration: rawBuf.duration, gain, meta });
        } catch {
          // silently skip unreadable files
        }
      })
    );
  }

  _fallbackSpeech(eventKey) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const map = {
      start: '请！',
      capture: '吃！',
      check: '将军！',
      checkmate: '将死！',
      checkmate2: '承让。',
      draw: '和棋。',
    };
    const text = map[eventKey];
    if (!text) return;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => (v.lang || '').toLowerCase().startsWith('zh'));
    if (!zh) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = zh;
    utter.lang = zh.lang;
    utter.pitch = 0.4;
    utter.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }
}
