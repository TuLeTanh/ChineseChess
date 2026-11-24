/**
 * Pure Web Audio OfflineAudioContext synthesizers for Xiangqi tactile & Chinese sounds.
 * Includes redesigned crisp loud wood clacks (move, capture) plus classic versions
 * (move_classic, capture_classic) for A/B comparison on ?sounds.
 */

export const SOUND_EVENTS = [
  'select',
  'move',
  'capture',
  'check',
  'checkmate',
  'start',
  'illegal',
  'draw',
  'undo',
  'drum',
  'sword_clash',
  'sword_stab',
  'stamp',
  'sword_touch',
  'defeat',
  'cloth_whoosh',
  'reveal',
];

export const SOUND_META = {
  select: { label: 'Chọn quân (select)', duration: 0.045, isGong: false, isNoiseBurst: true },
  move: { label: 'Đặt quân (move)', duration: 0.14, isGong: false, isNoiseBurst: true },
  capture: { label: 'Ăn quân (capture)', duration: 0.26, isGong: false, isNoiseBurst: true },
  move_classic: { label: 'Đặt quân cũ (move_classic)', duration: 0.13, isGong: false, isNoiseBurst: true },
  capture_classic: { label: 'Ăn quân cũ (capture_classic)', duration: 0.22, isGong: false, isNoiseBurst: true },
  check: { label: 'Chiếu tướng (check)', duration: 1.9, isGong: true, isNoiseBurst: false },
  checkmate: { label: 'Chiếu bí (checkmate)', duration: 3.1, isGong: true, isNoiseBurst: false },
  start: { label: 'Ván mới (start)', duration: 2.1, isGong: true, isNoiseBurst: false },
  illegal: { label: 'Nước đi sai (illegal)', duration: 0.09, isGong: false, isNoiseBurst: false },
  draw: { label: 'Hòa cờ (draw)', duration: 2.3, isGong: true, isNoiseBurst: false },
  undo: { label: 'Đi lại (undo)', duration: 0.10, isGong: false, isNoiseBurst: true },
  drum: { label: 'Trống trận (drum)', duration: 0.48, isGong: true, isNoiseBurst: false },
  checkmate_gong: { label: 'Chiêng chiếu bí', duration: 2.9, isGong: true, isNoiseBurst: false },
  checkmate_arp: { label: 'Cổ tranh chiếu bí', duration: 2.0, isGong: true, isNoiseBurst: false },
  sword_clash: { label: 'Song kiếm giao phong (sword_clash)', duration: 1.2, isGong: true, isNoiseBurst: true },
  sword_stab: { label: 'Kiếm cắm xuống (sword_stab)', duration: 0.5, isGong: true, isNoiseBurst: true },
  stamp: { label: 'Đóng ấn (stamp)', duration: 0.25, isGong: false, isNoiseBurst: true },
  sword_touch: { label: 'Kiếm chạm hòa (sword_touch)', duration: 1.0, isGong: true, isNoiseBurst: false },
  defeat: { label: 'Bại trận (defeat)', duration: 2.5, isGong: true, isNoiseBurst: false },
  cloth_whoosh: { label: 'Cờ trắng phất (cloth_whoosh)', duration: 0.22, isGong: false, isNoiseBurst: true },
  reveal: { label: 'Lật quân Cờ Úp (reveal)', duration: 0.25, isGong: false, isNoiseBurst: true },
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

function createNoiseBuffer(ctx, durationSec, seed) {
  const len = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = makeRng(seed);
  for (let i = 0; i < len; i++) {
    data[i] = rand() * 2 - 1;
  }
  return buf;
}

function createPluckBuffer(ctx, freqHz, durationSec, decay, seed) {
  const sr = ctx.sampleRate;
  const totalSamples = Math.ceil(sr * durationSec);
  const period = Math.max(2, Math.round(sr / freqHz));
  const buf = ctx.createBuffer(1, totalSamples, sr);
  const out = buf.getChannelData(0);
  const ring = new Float32Array(period);
  const rand = makeRng(seed);

  let prev = 0;
  for (let i = 0; i < period; i++) {
    const raw = rand() * 2 - 1;
    prev = 0.55 * raw + 0.45 * prev;
    ring[i] = prev;
  }

  let idx = 0;
  const attackSamples = Math.floor(sr * 0.004);
  for (let i = 0; i < totalSamples; i++) {
    const nextIdx = (idx + 1) % period;
    const sample = ring[idx];
    ring[idx] = 0.5 * (ring[idx] + ring[nextIdx]) * decay;
    idx = nextIdx;
    const env = i < attackSamples ? i / attackSamples : 1;
    out[i] = sample * env;
  }
  return buf;
}

function scheduleClassicClack(ctx, dest, startTime, opts) {
  const {
    noiseFreq = 1120,
    noiseQ = 8,
    noiseGain = 0.55,
    noiseDecay = 0.032,
    bodyFreq = 210,
    bodyEndFreq = 140,
    bodyGain = 0.48,
    bodyDecay = 0.06,
    seed = 101,
  } = opts;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, noiseDecay + 0.02, seed);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(noiseFreq, startTime);
  bp.Q.setValueAtTime(noiseQ, startTime);
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, startTime);
  nGain.gain.linearRampToValueAtTime(noiseGain, startTime + 0.0015);
  nGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noiseDecay);
  noise.connect(bp);
  bp.connect(nGain);
  nGain.connect(dest);
  noise.start(startTime);
  noise.stop(startTime + noiseDecay + 0.01);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(bodyFreq, startTime);
  osc.frequency.exponentialRampToValueAtTime(bodyEndFreq, startTime + bodyDecay);
  const bGain = ctx.createGain();
  bGain.gain.setValueAtTime(0.0001, startTime);
  bGain.gain.linearRampToValueAtTime(bodyGain, startTime + 0.002);
  bGain.gain.exponentialRampToValueAtTime(0.0001, startTime + bodyDecay);
  osc.connect(bGain);
  bGain.connect(dest);
  osc.start(startTime);
  osc.stop(startTime + bodyDecay + 0.01);
}

/**
 * Schedule the redesigned crisp, loud, hollow-wood xiangqi clack:
 * - 2-3 ms sharp "crack" transient (BP 3200 Hz, Q 1.2, 8 ms decay)
 * - Main wood "clack" (BP 1120 Hz, Q 9, 48 ms decay) + crisp overtone (BP 2300 Hz, Q 5, 32 ms)
 * - Hollow-wood resonance (BP 620 Hz, Q 14, 72 ms decay)
 * - "Thock" body (sine 210 -> 150 Hz, 90 ms decay + faint 2nd harmonic)
 */
function scheduleCrispWoodHit(ctx, dest, startTime, opts) {
  const {
    crackFreq = 3200,
    crackGain = 1.35,
    clackFreq = 1120,
    clackQ = 9,
    clackDecay = 0.048,
    clackGain = 1.9,
    overtoneFreq = 2350,
    overtoneGain = 1.15,
    hollowFreq = 620,
    hollowQ = 14,
    hollowDecay = 0.072,
    hollowGain = 1.25,
    bodyFreq = 210,
    bodyEndFreq = 150,
    bodyDecay = 0.09,
    bodyGain = 0.72,
    seed = 201,
  } = opts;

  // 1. Sharp crack transient (2-3 ms punch)
  const crack = ctx.createBufferSource();
  crack.buffer = createNoiseBuffer(ctx, 0.018, seed);
  const crackBp = ctx.createBiquadFilter();
  crackBp.type = 'bandpass';
  crackBp.frequency.setValueAtTime(crackFreq, startTime);
  crackBp.Q.setValueAtTime(1.2, startTime);
  const crackG = ctx.createGain();
  crackG.gain.setValueAtTime(0.0001, startTime);
  crackG.gain.linearRampToValueAtTime(crackGain, startTime + 0.0004);
  crackG.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.008);
  crack.connect(crackBp);
  crackBp.connect(crackG);
  crackG.connect(dest);
  crack.start(startTime);
  crack.stop(startTime + 0.012);

  // 2. Main resonant clack (1100 Hz)
  const clack = ctx.createBufferSource();
  clack.buffer = createNoiseBuffer(ctx, clackDecay + 0.02, seed + 13);
  const clackBp = ctx.createBiquadFilter();
  clackBp.type = 'bandpass';
  clackBp.frequency.setValueAtTime(clackFreq, startTime);
  clackBp.Q.setValueAtTime(clackQ, startTime);
  const clackG = ctx.createGain();
  clackG.gain.setValueAtTime(0.0001, startTime);
  clackG.gain.linearRampToValueAtTime(clackGain, startTime + 0.0006);
  clackG.gain.exponentialRampToValueAtTime(0.0001, startTime + clackDecay);
  clack.connect(clackBp);
  clackBp.connect(clackG);
  clackG.connect(dest);
  clack.start(startTime);
  clack.stop(startTime + clackDecay + 0.01);

  // 2b. High-wood definition overtone (gives clear spectral centroid >= 1200 Hz)
  const hi = ctx.createBufferSource();
  hi.buffer = createNoiseBuffer(ctx, 0.045, seed + 29);
  const hiBp = ctx.createBiquadFilter();
  hiBp.type = 'bandpass';
  hiBp.frequency.setValueAtTime(overtoneFreq, startTime);
  hiBp.Q.setValueAtTime(4.5, startTime);
  const hiG = ctx.createGain();
  hiG.gain.setValueAtTime(0.0001, startTime);
  hiG.gain.linearRampToValueAtTime(overtoneGain, startTime + 0.0005);
  hiG.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.036);
  hi.connect(hiBp);
  hiBp.connect(hiG);
  hiG.connect(dest);
  hi.start(startTime);
  hi.stop(startTime + 0.04);

  // 3. Hollow-wood body resonance (620 Hz)
  const hollow = ctx.createBufferSource();
  hollow.buffer = createNoiseBuffer(ctx, hollowDecay + 0.02, seed + 47);
  const hollowBp = ctx.createBiquadFilter();
  hollowBp.type = 'bandpass';
  hollowBp.frequency.setValueAtTime(hollowFreq, startTime);
  hollowBp.Q.setValueAtTime(hollowQ, startTime);
  const hollowG = ctx.createGain();
  hollowG.gain.setValueAtTime(0.0001, startTime);
  hollowG.gain.linearRampToValueAtTime(hollowGain, startTime + 0.0008);
  hollowG.gain.exponentialRampToValueAtTime(0.0001, startTime + hollowDecay);
  hollow.connect(hollowBp);
  hollowBp.connect(hollowG);
  hollowG.connect(dest);
  hollow.start(startTime);
  hollow.stop(startTime + hollowDecay + 0.01);

  // 4. Thock sine body + faint 2nd harmonic
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(bodyFreq, startTime);
  osc1.frequency.exponentialRampToValueAtTime(bodyEndFreq, startTime + bodyDecay);
  const bG1 = ctx.createGain();
  bG1.gain.setValueAtTime(0.0001, startTime);
  bG1.gain.linearRampToValueAtTime(bodyGain, startTime + 0.001);
  bG1.gain.exponentialRampToValueAtTime(0.0001, startTime + bodyDecay);
  osc1.connect(bG1);
  bG1.connect(dest);
  osc1.start(startTime);
  osc1.stop(startTime + bodyDecay + 0.01);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(bodyFreq * 2, startTime);
  osc2.frequency.exponentialRampToValueAtTime(bodyEndFreq * 2, startTime + bodyDecay * 0.7);
  const bG2 = ctx.createGain();
  bG2.gain.setValueAtTime(0.0001, startTime);
  bG2.gain.linearRampToValueAtTime(bodyGain * 0.25, startTime + 0.0008);
  bG2.gain.exponentialRampToValueAtTime(0.0001, startTime + bodyDecay * 0.7);
  osc2.connect(bG2);
  bG2.connect(dest);
  osc2.start(startTime);
  osc2.stop(startTime + bodyDecay * 0.75);
}

function scheduleGong(ctx, dest, startTime, opts) {
  const {
    fundamental = 220,
    decay = 1.8,
    gain = 0.36,
    lowpassHz = 2600,
  } = opts;

  const partials = [
    { ratio: 1.0, amp: 1.0, d: decay },
    { ratio: 2.76, amp: 0.48, d: decay * 0.72 },
    { ratio: 5.4, amp: 0.22, d: decay * 0.45 },
    { ratio: 8.93, amp: 0.1, d: decay * 0.25 },
  ];

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(lowpassHz, startTime);
  lp.frequency.exponentialRampToValueAtTime(Math.max(420, lowpassHz * 0.35), startTime + decay);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, startTime);
  master.gain.linearRampToValueAtTime(gain, startTime + 0.006);
  master.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);

  lp.connect(master);
  master.connect(dest);

  for (const part of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fundamental * part.ratio, startTime);
    const pGain = ctx.createGain();
    pGain.gain.setValueAtTime(part.amp * 0.55, startTime);
    pGain.gain.exponentialRampToValueAtTime(0.0001, startTime + part.d);
    osc.connect(pGain);
    pGain.connect(lp);
    osc.start(startTime);
    osc.stop(startTime + part.d + 0.02);
  }
}

/**
 * Soft-saturate and peak-normalize an AudioBuffer in place for punchy RMS without harsh clipping.
 * @param {AudioBuffer} buf
 * @param {number} targetPeak
 * @param {number} [drive]
 */
function saturateAndNormalize(buf, targetPeak, drive = 1.0) {
  const ch = buf.getChannelData(0);
  if (drive > 1.0) {
    const norm = Math.tanh(drive);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = Math.tanh(ch[i] * drive) / norm;
    }
  }
  let peak = 0;
  for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.0001) {
    const scale = targetPeak / peak;
    for (let i = 0; i < ch.length; i++) {
      ch[i] *= scale;
    }
  }
}

/**
 * Render one synthesized sound event into an AudioBuffer using OfflineAudioContext.
 * @param {string} eventName
 * @param {number} [sampleRate]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSoundBuffer(eventName, sampleRate = 44100) {
  const meta = SOUND_META[eventName];
  if (!meta) throw new Error(`Unknown sound event: ${eventName}`);

  const length = Math.ceil(meta.duration * sampleRate);
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const dest = ctx.destination;

  switch (eventName) {
    case 'select': {
      scheduleClassicClack(ctx, dest, 0, {
        noiseFreq: 1650,
        noiseQ: 6,
        noiseGain: 0.45,
        noiseDecay: 0.024,
        bodyFreq: 340,
        bodyEndFreq: 240,
        bodyGain: 0.28,
        bodyDecay: 0.026,
        seed: 11,
      });
      break;
    }

    case 'move': {
      scheduleCrispWoodHit(ctx, dest, 0, { seed: 201 });
      break;
    }

    case 'capture': {
      // Primary crisp hit at 0 ms
      scheduleCrispWoodHit(ctx, dest, 0, { seed: 301 });
      // Tiny dry "slide" noise (60 ms, BP 1800 Hz, low level) between the two hits
      const slide = ctx.createBufferSource();
      slide.buffer = createNoiseBuffer(ctx, 0.065, 317);
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.setValueAtTime(1800, 0.006);
      sBp.Q.setValueAtTime(2.0, 0.006);
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(0.0001, 0.006);
      sG.gain.linearRampToValueAtTime(0.28, 0.016);
      sG.gain.exponentialRampToValueAtTime(0.0001, 0.066);
      slide.connect(sBp);
      sBp.connect(sG);
      sG.connect(dest);
      slide.start(0.006);
      slide.stop(0.068);
      // Heavier second hit 38 ms later (lower resonances 800/420 Hz, body 130 Hz, 130 ms decay)
      scheduleCrispWoodHit(ctx, dest, 0.038, {
        crackFreq: 2700,
        crackGain: 1.25,
        clackFreq: 800,
        clackQ: 8,
        clackDecay: 0.075,
        clackGain: 1.85,
        overtoneFreq: 1950,
        overtoneGain: 0.95,
        hollowFreq: 420,
        hollowQ: 11,
        hollowDecay: 0.115,
        hollowGain: 1.4,
        bodyFreq: 130,
        bodyEndFreq: 92,
        bodyDecay: 0.135,
        bodyGain: 0.95,
        seed: 359,
      });
      break;
    }

    case 'move_classic': {
      scheduleClassicClack(ctx, dest, 0, {
        noiseFreq: 1140,
        noiseQ: 8,
        noiseGain: 0.62,
        noiseDecay: 0.036,
        bodyFreq: 215,
        bodyEndFreq: 135,
        bodyGain: 0.52,
        bodyDecay: 0.065,
        seed: 23,
      });
      break;
    }

    case 'capture_classic': {
      scheduleClassicClack(ctx, dest, 0, {
        noiseFreq: 1080,
        noiseQ: 7.5,
        noiseGain: 0.66,
        noiseDecay: 0.04,
        bodyFreq: 195,
        bodyEndFreq: 115,
        bodyGain: 0.56,
        bodyDecay: 0.08,
        seed: 31,
      });
      scheduleClassicClack(ctx, dest, 0.035, {
        noiseFreq: 960,
        noiseQ: 6.5,
        noiseGain: 0.52,
        noiseDecay: 0.045,
        bodyFreq: 122,
        bodyEndFreq: 86,
        bodyGain: 0.62,
        bodyDecay: 0.115,
        seed: 37,
      });
      break;
    }

    case 'check': {
      scheduleGong(ctx, dest, 0, { fundamental: 220, decay: 1.8, gain: 0.44, lowpassHz: 2600 });
      break;
    }

    case 'checkmate': {
      scheduleGong(ctx, dest, 0, { fundamental: 165, decay: 2.95, gain: 0.44, lowpassHz: 2200 });
      const notes = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33];
      notes.forEach((freq, i) => {
        const start = 0.3 + i * 0.11;
        const pluck = ctx.createBufferSource();
        pluck.buffer = createPluckBuffer(ctx, freq, 1.25, 0.9962, 50 + i * 7);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.32, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 1.22);
        pluck.connect(g);
        g.connect(dest);
        pluck.start(start);
      });
      break;
    }

    case 'start': {
      scheduleGong(ctx, dest, 0, { fundamental: 196, decay: 1.98, gain: 0.34, lowpassHz: 2000 });
      const motif = [293.66, 440.0, 493.88];
      motif.forEach((freq, i) => {
        const start = 0.22 + i * 0.16;
        const pluck = ctx.createBufferSource();
        pluck.buffer = createPluckBuffer(ctx, freq, 1.15, 0.9958, 90 + i * 11);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.28, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 1.12);
        pluck.connect(g);
        g.connect(dest);
        pluck.start(start);
      });
      break;
    }

    case 'illegal': {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(165, 0);
      osc.frequency.exponentialRampToValueAtTime(108, 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(340, 0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(0.45, 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, 0.082);
      osc.connect(lp);
      lp.connect(g);
      g.connect(dest);
      osc.start(0);
      osc.stop(0.085);
      break;
    }

    case 'draw': {
      scheduleGong(ctx, dest, 0, { fundamental: 196, decay: 1.55, gain: 0.32, lowpassHz: 2000 });
      scheduleGong(ctx, dest, 0.5, { fundamental: 261.63, decay: 1.7, gain: 0.34, lowpassHz: 2200 });
      break;
    }

    case 'undo': {
      scheduleClassicClack(ctx, dest, 0.004, {
        noiseFreq: 1320,
        noiseQ: 8,
        noiseGain: 0.48,
        noiseDecay: 0.032,
        bodyFreq: 248,
        bodyEndFreq: 180,
        bodyGain: 0.42,
        bodyDecay: 0.055,
        seed: 73,
      });
      break;
    }

    case 'drum': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, 0);
      osc.frequency.exponentialRampToValueAtTime(48, 0.18);
      const bGain = ctx.createGain();
      bGain.gain.setValueAtTime(0.0001, 0);
      bGain.gain.linearRampToValueAtTime(0.46, 0.005);
      bGain.gain.exponentialRampToValueAtTime(0.0001, 0.45);
      osc.connect(bGain);
      bGain.connect(dest);
      osc.start(0);
      osc.stop(0.46);

      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.14, 131);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(220, 0);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.0001, 0);
      nGain.gain.linearRampToValueAtTime(0.24, 0.004);
      nGain.gain.exponentialRampToValueAtTime(0.0001, 0.12);
      noise.connect(lp);
      lp.connect(nGain);
      nGain.connect(dest);
      noise.start(0);
      noise.stop(0.13);
      break;
    }

    case 'checkmate_gong': {
      scheduleGong(ctx, dest, 0, { fundamental: 165, decay: 2.85, gain: 0.42, lowpassHz: 2200 });
      break;
    }

    case 'checkmate_arp': {
      const notes = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33];
      notes.forEach((freq, i) => {
        const start = i * 0.11;
        const pluck = ctx.createBufferSource();
        pluck.buffer = createPluckBuffer(ctx, freq, 1.25, 0.9962, 50 + i * 7);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.32, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 1.22);
        pluck.connect(g);
        g.connect(dest);
        pluck.start(start);
      });
      break;
    }

    case 'sword_clash': {
      // War drum hit underneath at t=0
      const dOsc = ctx.createOscillator();
      dOsc.type = 'sine';
      dOsc.frequency.setValueAtTime(95, 0);
      dOsc.frequency.exponentialRampToValueAtTime(48, 0.18);
      const dGain = ctx.createGain();
      dGain.gain.setValueAtTime(0.0001, 0);
      dGain.gain.linearRampToValueAtTime(0.38, 0.005);
      dGain.gain.exponentialRampToValueAtTime(0.0001, 0.42);
      dOsc.connect(dGain);
      dGain.connect(dest);
      dOsc.start(0);
      dOsc.stop(0.45);

      // 12 ms band-passed noise burst at 5 kHz for the "shing" transient
      const shing = ctx.createBufferSource();
      shing.buffer = createNoiseBuffer(ctx, 0.025, 501);
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.setValueAtTime(5000, 0);
      sBp.Q.setValueAtTime(2.2, 0);
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(0.0001, 0);
      sG.gain.linearRampToValueAtTime(0.95, 0.001);
      sG.gain.exponentialRampToValueAtTime(0.0001, 0.015);
      shing.connect(sBp);
      sBp.connect(sG);
      sG.connect(dest);
      shing.start(0);
      shing.stop(0.02);

      // 8 inharmonic sine partials around 1800 Hz with varying decays + 6 Hz shimmer on top 2
      const baseHz = 1800;
      const partials = [
        { r: 1.0, amp: 0.34, d: 0.90, trem: false },
        { r: 1.24, amp: 0.22, d: 0.55, trem: false },
        { r: 1.52, amp: 0.28, d: 0.78, trem: false },
        { r: 2.03, amp: 0.22, d: 0.62, trem: false },
        { r: 2.78, amp: 0.16, d: 0.42, trem: false },
        { r: 3.41, amp: 0.14, d: 0.34, trem: false },
        { r: 3.92, amp: 0.11, d: 0.82, trem: true },
        { r: 4.70, amp: 0.09, d: 0.70, trem: true },
      ];
      for (const p of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseHz * p.r, 0);
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, 0);
        pg.gain.linearRampToValueAtTime(p.amp, 0.0012);
        pg.gain.exponentialRampToValueAtTime(0.0001, p.d);
        if (p.trem) {
          const lfo = ctx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.setValueAtTime(6.0, 0);
          const lfoGain = ctx.createGain();
          lfoGain.gain.setValueAtTime(p.amp * 0.28, 0);
          lfo.connect(lfoGain);
          lfoGain.connect(pg.gain);
          lfo.start(0);
          lfo.stop(p.d + 0.02);
        }
        osc.connect(pg);
        pg.connect(dest);
        osc.start(0);
        osc.stop(p.d + 0.03);
      }
      break;
    }

    case 'sword_stab': {
      // Low thud (90 -> 55 Hz, 200 ms decay)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, 0);
      osc.frequency.exponentialRampToValueAtTime(55, 0.20);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, 0);
      tg.gain.linearRampToValueAtTime(0.65, 0.003);
      tg.gain.exponentialRampToValueAtTime(0.0001, 0.28);
      osc.connect(tg);
      tg.connect(dest);
      osc.start(0);
      osc.stop(0.32);

      // 40 ms metallic scrape (BP sweeping 3 kHz -> 1.2 kHz)
      const scrape = ctx.createBufferSource();
      scrape.buffer = createNoiseBuffer(ctx, 0.06, 613);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(3000, 0);
      bp.frequency.exponentialRampToValueAtTime(1200, 0.045);
      bp.Q.setValueAtTime(4.0, 0);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, 0);
      sg.gain.linearRampToValueAtTime(0.55, 0.002);
      sg.gain.exponentialRampToValueAtTime(0.0001, 0.048);
      scrape.connect(bp);
      bp.connect(sg);
      sg.connect(dest);
      scrape.start(0);
      scrape.stop(0.055);

      // Short wooden crack (-6 dB)
      const woodBus = ctx.createGain();
      woodBus.gain.setValueAtTime(0.5, 0);
      woodBus.connect(dest);
      scheduleCrispWoodHit(ctx, woodBus, 0.004, { seed: 617 });
      break;
    }

    case 'stamp': {
      // Heavy body 110 Hz (120 ms decay) + crisp wooden clack (-3 dB = 0.708)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, 0);
      osc.frequency.exponentialRampToValueAtTime(68, 0.12);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, 0);
      bg.gain.linearRampToValueAtTime(0.62, 0.002);
      bg.gain.exponentialRampToValueAtTime(0.0001, 0.14);
      osc.connect(bg);
      bg.connect(dest);
      osc.start(0);
      osc.stop(0.16);

      const woodBus = ctx.createGain();
      woodBus.gain.setValueAtTime(0.708, 0);
      woodBus.connect(dest);
      scheduleCrispWoodHit(ctx, woodBus, 0.002, { seed: 709 });
      break;
    }

    case 'sword_touch': {
      // Soft single bell-like "ting" (partials 1 / 2.7 / 5.2 of 1500 Hz, decay 700 ms)
      const base = 1500;
      const parts = [
        { r: 1.0, amp: 0.24, d: 0.75 },
        { r: 2.7, amp: 0.11, d: 0.48 },
        { r: 5.2, amp: 0.05, d: 0.25 },
      ];
      for (const p of parts) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base * p.r, 0);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0);
        g.gain.linearRampToValueAtTime(p.amp, 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, p.d);
        osc.connect(g);
        g.connect(dest);
        osc.start(0);
        osc.stop(p.d + 0.03);
      }
      break;
    }

    case 'defeat': {
      // One low drum hit at 0.01 s
      const dOsc = ctx.createOscillator();
      dOsc.type = 'sine';
      dOsc.frequency.setValueAtTime(88, 0.01);
      dOsc.frequency.exponentialRampToValueAtTime(44, 0.24);
      const dG = ctx.createGain();
      dG.gain.setValueAtTime(0.0001, 0);
      dG.gain.linearRampToValueAtTime(0.42, 0.016);
      dG.gain.exponentialRampToValueAtTime(0.0001, 0.55);
      dOsc.connect(dG);
      dG.connect(dest);
      dOsc.start(0);
      dOsc.stop(0.6);

      // Low gong at -4 dB (0.63)
      scheduleGong(ctx, dest, 0.05, { fundamental: 130.81, decay: 2.35, gain: 0.28, lowpassHz: 1400 });

      // Slow descending pentatonic pluck phrase (A4, E4, D4, A3 — 450 ms apart)
      const phrase = [440.0, 329.63, 293.66, 220.0];
      phrase.forEach((freq, i) => {
        const start = 0.22 + i * 0.45;
        const pluck = ctx.createBufferSource();
        pluck.buffer = createPluckBuffer(ctx, freq, 1.1, 0.9945, 811 + i * 19);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.30 * (1 - i * 0.1), start);
        g.gain.exponentialRampToValueAtTime(0.0001, Math.min(2.48, start + 1.05));
        pluck.connect(g);
        g.connect(dest);
        pluck.start(start);
      });
      break;
    }

    case 'cloth_whoosh': {
      // Soft cloth whoosh (band-passed noise, 200 ms)
      const n = ctx.createBufferSource();
      n.buffer = createNoiseBuffer(ctx, 0.22, 919);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(420, 0);
      bp.frequency.exponentialRampToValueAtTime(980, 0.09);
      bp.frequency.exponentialRampToValueAtTime(340, 0.21);
      bp.Q.setValueAtTime(1.4, 0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(0.42, 0.045);
      g.gain.exponentialRampToValueAtTime(0.0001, 0.21);
      n.connect(bp);
      bp.connect(g);
      g.connect(dest);
      n.start(0);
      n.stop(0.22);
      break;
    }

    case 'reveal': {
      // Short light wood flip clack + soft bright pentatonic "ting" (D5 587.33 Hz base)
      scheduleClassicClack(ctx, dest, 0, {
        noiseFreq: 1480,
        noiseQ: 7,
        noiseGain: 0.42,
        noiseDecay: 0.026,
        bodyFreq: 260,
        bodyEndFreq: 190,
        bodyGain: 0.26,
        bodyDecay: 0.04,
        seed: 977,
      });

      const base = 587.33; // D5
      const partials = [
        { r: 1.0, amp: 0.30, d: 0.21 },
        { r: 2.0, amp: 0.14, d: 0.15 },
        { r: 3.01, amp: 0.07, d: 0.10 },
      ];
      for (const p of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base * p.r, 0.015);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0.015);
        g.gain.linearRampToValueAtTime(p.amp, 0.022);
        g.gain.exponentialRampToValueAtTime(0.0001, Math.min(0.245, 0.022 + p.d));
        osc.connect(g);
        g.connect(dest);
        osc.start(0.015);
        osc.stop(Math.min(0.25, 0.025 + p.d));
      }
      break;
    }
  }

  const rendered = await ctx.startRendering();

  // Generator-side normalization to exact target peaks
  if (eventName === 'move') {
    saturateAndNormalize(rendered, 0.90, 2.4);
  } else if (eventName === 'capture') {
    saturateAndNormalize(rendered, 0.94, 2.8);
  } else if (eventName === 'select') {
    saturateAndNormalize(rendered, 0.35, 1.0);
  } else if (eventName === 'illegal' || eventName === 'undo') {
    saturateAndNormalize(rendered, 0.40, 1.0);
  } else if (eventName === 'sword_clash') {
    saturateAndNormalize(rendered, 0.80, 1.4);
  } else if (eventName === 'sword_stab') {
    saturateAndNormalize(rendered, 0.75, 1.3);
  } else if (eventName === 'stamp') {
    saturateAndNormalize(rendered, 0.70, 1.2);
  } else if (eventName === 'sword_touch') {
    saturateAndNormalize(rendered, 0.35, 1.0);
  } else if (eventName === 'defeat') {
    saturateAndNormalize(rendered, 0.65, 1.0);
  } else if (eventName === 'cloth_whoosh') {
    saturateAndNormalize(rendered, 0.38, 1.0);
  } else if (eventName === 'reveal') {
    saturateAndNormalize(rendered, 0.54, 1.0);
  } else {
    const ch = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const maxPeak = eventName === 'drum' ? 0.58 : 0.88;
    if (peak > maxPeak) {
      const scale = (maxPeak - 0.02) / peak;
      for (let i = 0; i < ch.length; i++) ch[i] *= scale;
    }
  }

  return rendered;
}
