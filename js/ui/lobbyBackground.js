/**
 * Animated "Đêm hội đèn lồng bên sông" background for Lobby & Mode Select screens.
 * - Night sky gradient, twinkling stars, softly pulsing moon
 * - 3 seamless ink-wash SVG mountain layers with gentle horizontal drift + desktop pointer parallax
 * - 2 counter-drifting mist bands
 * - Single DPR-capped (<= 1.5) <canvas>: paper lanterns, fireflies/gold dust, falling petals,
 *   periodic shooting star, faint floating calligraphy ink stamps
 * - Mood crossfade (default / cotuong warm red-gold / coup violet-indigo + face-down tile glints)
 * - Adaptive quality (auto-downgrades if avg frame time > 22 ms), bgQuality high/low/off,
 *   document.hidden pause, prefers-reduced-motion static render, and strict unmount cleanup (0 rAF).
 */
import { leakTracker } from '../app/router.js';

const STAMP_GLYPHS = ['勝', '將', '帥', '兵', '炮', '馬', '車', '象', '士'];

function makeRng(seed) {
  let s = (seed >>> 0) || 20261124;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  );
}

export class LobbyBackground {
  /**
   * @param {{
   *   container: HTMLElement,
   *   theme: import('../theme.js').Theme,
   *   quality?: 'high' | 'low' | 'off',
   *   seed?: number,
   * }} opts
   */
  constructor(opts) {
    this.container = opts.container;
    this.theme = opts.theme;
    const requested = opts.quality || 'high';
    this.quality = requested === 'high' && isTouchDevice() ? 'low' : requested;
    this.reduced = prefersReducedMotion();
    this.seed = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : 20261124;
    this.rand = makeRng(this.seed);

    this.mood = 'default'; // 'default' | 'cotuong' | 'coup'
    this.moodBlend = { cotuong: 0, coup: 0 };
    this.targetBlend = { cotuong: 0, coup: 0 };

    this.rafId = 0;
    this.destroyed = false;
    this.elapsed = 0;
    this.lastNow = 0;
    this.frameSum = 0;
    this.frameCount = 0;
    this.parallaxTarget = { x: 0, y: 0 };
    this.parallaxCurr = { x: 0, y: 0 };

    this.canvas = null;
    this.ctx = null;
    this.cssW = 1180;
    this.cssH = 780;
    this.entities = null;

    this._onResize = this._onResize.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onVisChange = this._onVisChange.bind(this);

    this._mount();
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.root) {
      this.root.dataset.theme = theme.id;
    }
    if (this.reduced || this.quality === 'off') {
      this._renderCanvas(this.elapsed);
    }
  }

  setQuality(quality) {
    const next = quality === 'high' && isTouchDevice() ? 'low' : quality;
    if (next === this.quality) return;
    this.quality = next;
    this._teardownCanvas();
    if (this.quality !== 'off') {
      this._initCanvas();
      this._startLoop();
    }
  }

  setMood(mood) {
    this.mood = mood || 'default';
    this.targetBlend.cotuong = this.mood === 'cotuong' ? 1 : 0;
    this.targetBlend.coup = this.mood === 'coup' ? 1 : 0;
    if (this.root) {
      this.root.dataset.mood = this.mood;
    }
  }

  _mount() {
    this.root = document.createElement('div');
    this.root.className = 'lobby-bg';
    this.root.dataset.theme = this.theme.id;
    this.root.dataset.mood = 'default';
    this.root.setAttribute('aria-hidden', 'true');

    // Stars (lightweight CSS twinkle)
    const starsHtml = Array.from({ length: 28 }, () => {
      const x = (this.rand() * 98 + 1).toFixed(1);
      const y = (this.rand() * 44 + 2).toFixed(1);
      const sz = (1.2 + this.rand() * 1.8).toFixed(1);
      const dur = (3.5 + this.rand() * 4.5).toFixed(1);
      const del = (this.rand() * 4).toFixed(1);
      return `<span class="bg-star" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:-${del}s"></span>`;
    }).join('');

    this.root.innerHTML = `
      <div class="bg-sky"></div>
      <div class="bg-stars">${starsHtml}</div>
      <div class="bg-moon"></div>
      <div class="bg-mood-tint"></div>
      <div class="bg-mountains">
        <div class="bg-mountain-layer bg-m-far">
          <svg viewBox="0 0 1600 320" preserveAspectRatio="none"><path d="M0,320 L0,190 Q180,105 360,165 T760,140 T1180,170 T1600,190 L1600,320 Z"/></svg>
          <svg viewBox="0 0 1600 320" preserveAspectRatio="none"><path d="M0,320 L0,190 Q180,105 360,165 T760,140 T1180,170 T1600,190 L1600,320 Z"/></svg>
        </div>
        <div class="bg-mountain-layer bg-m-mid">
          <svg viewBox="0 0 1600 300" preserveAspectRatio="none"><path d="M0,300 L0,200 Q240,115 480,185 T980,155 T1360,195 T1600,200 L1600,300 Z"/></svg>
          <svg viewBox="0 0 1600 300" preserveAspectRatio="none"><path d="M0,300 L0,200 Q240,115 480,185 T980,155 T1360,195 T1600,200 L1600,300 Z"/></svg>
        </div>
        <div class="bg-mountain-layer bg-m-near">
          <svg viewBox="0 0 1600 260" preserveAspectRatio="none"><path d="M0,260 L0,185 Q200,130 420,185 T880,175 T1280,190 T1600,185 L1600,260 Z"/></svg>
          <svg viewBox="0 0 1600 260" preserveAspectRatio="none"><path d="M0,260 L0,185 Q200,130 420,185 T880,175 T1280,190 T1600,185 L1600,260 Z"/></svg>
        </div>
      </div>
      <div class="bg-mist bg-mist-1"></div>
      <div class="bg-mist bg-mist-2"></div>
      <div class="bg-canvas-host"></div>
      <div class="bg-vignette"></div>
    `;

    this.mountainsEl = this.root.querySelector('.bg-mountains');
    this.canvasHost = this.root.querySelector('.bg-canvas-host');
    this.container.prepend(this.root);

    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisChange);
    leakTracker.trackListener(2);

    if (!this.reduced && !isTouchDevice()) {
      window.addEventListener('pointermove', this._onPointerMove, { passive: true });
      leakTracker.trackListener(1);
      this._hasPointerListener = true;
    }

    if (this.quality !== 'off') {
      this._initCanvas();
      if (this.reduced) {
        this._renderCanvas(2400);
      } else {
        this._startLoop();
      }
    }
  }

  _initCanvas() {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bg-canvas';
    this.canvasHost.appendChild(this.canvas);
    leakTracker.trackCanvas(1);
    this.ctx = this.canvas.getContext('2d');
    this._buildEntities();
    this._onResize();
  }

  _teardownCanvas() {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
      leakTracker.trackCanvas(-1);
    }
  }

  _buildEntities() {
    const isLow = this.quality === 'low';
    const lanternCount = isLow ? 7 : 12;
    const fireflyCount = isLow ? 30 : 60;
    const petalCount = isLow ? 8 : 16;

    const r = makeRng(this.seed + 77);
    const lanterns = Array.from({ length: lanternCount }, (_, i) => ({
      x: 0.06 + r() * 0.88,
      y: r(),
      vy: 0.012 + r() * 0.016,
      size: 11 + r() * 14,
      swayAmp: 12 + r() * 18,
      swayFreq: 0.35 + r() * 0.45,
      phase: r() * Math.PI * 2,
      flickerFreq: 3.2 + r() * 3.0,
      isTileVariant: i % 3 === 0,
    }));

    const fireflies = Array.from({ length: fireflyCount }, () => ({
      x: r(),
      y: 0.12 + r() * 0.85,
      vx: (r() - 0.5) * 0.008,
      vy: -(0.003 + r() * 0.008),
      size: 1.2 + r() * 2.1,
      phase: r() * Math.PI * 2,
      twinkleFreq: 1.2 + r() * 2.2,
    }));

    const petals = Array.from({ length: petalCount }, () => ({
      x: r(),
      y: r(),
      vx: 0.008 + r() * 0.015,
      vy: 0.014 + r() * 0.018,
      size: 4 + r() * 4.5,
      rot: r() * Math.PI * 2,
      rotSpeed: (r() - 0.5) * 2.4,
      phase: r() * Math.PI * 2,
    }));

    this.entities = { lanterns, fireflies, petals };
  }

  _onResize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.root.getBoundingClientRect();
    this.cssW = Math.max(320, Math.round(rect.width || window.innerWidth));
    this.cssH = Math.max(480, Math.round(rect.height || window.innerHeight));
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _onPointerMove(ev) {
    const nx = ev.clientX / Math.max(1, window.innerWidth) - 0.5;
    const ny = ev.clientY / Math.max(1, window.innerHeight) - 0.5;
    this.parallaxTarget.x = nx * -12;
    this.parallaxTarget.y = ny * -8;
  }

  _onVisChange() {
    if (!document.hidden) {
      this.lastNow = performance.now();
    }
  }

  _startLoop() {
    if (this.rafId || this.destroyed || this.reduced || this.quality === 'off') return;
    this.lastNow = performance.now();
    const tick = (now) => {
      if (this.destroyed || this.quality === 'off') {
        this.rafId = 0;
        return;
      }
      if (!document.hidden) {
        const dt = Math.min(60, Math.max(0, now - this.lastNow));
        this.elapsed += dt;

        // Adaptive quality check over 2 s window
        if (this.quality === 'high') {
          this.frameSum += dt;
          this.frameCount++;
          if (this.frameSum >= 2000) {
            const avg = this.frameSum / Math.max(1, this.frameCount);
            if (avg > 22) {
              this.quality = 'low';
              this._buildEntities();
            }
            this.frameSum = 0;
            this.frameCount = 0;
          }
        }

        // Smooth mood blend (600 ms)
        const step = Math.min(1, dt / 600);
        this.moodBlend.cotuong += (this.targetBlend.cotuong - this.moodBlend.cotuong) * step;
        this.moodBlend.coup += (this.targetBlend.coup - this.moodBlend.coup) * step;

        // Eased parallax on mountains
        this.parallaxCurr.x += (this.parallaxTarget.x - this.parallaxCurr.x) * 0.08;
        this.parallaxCurr.y += (this.parallaxTarget.y - this.parallaxCurr.y) * 0.08;
        if (this.mountainsEl) {
          this.mountainsEl.style.transform = `translate3d(${this.parallaxCurr.x.toFixed(1)}px, ${this.parallaxCurr.y.toFixed(1)}px, 0)`;
        }

        this._renderCanvas(this.elapsed);
      }
      this.lastNow = now;
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  _renderCanvas(tMs) {
    const ctx = this.ctx;
    if (!ctx || !this.entities) return;
    const w = this.cssW;
    const h = this.cssH;
    const sec = tMs / 1000;
    const isJade = this.theme.id === 'ngoc-bich';
    const coupMix = this.moodBlend.coup;
    const xqMix = this.moodBlend.cotuong;

    ctx.clearRect(0, 0, w, h);

    // 1. Faint floating calligraphy ink stamp (one at a time, 3-5% opacity)
    const stampPeriod = 9.0;
    const stampIdx = Math.floor(sec / stampPeriod) % STAMP_GLYPHS.length;
    const stampLocal = (sec % stampPeriod) / stampPeriod;
    const stampAlpha = Math.sin(stampLocal * Math.PI) * 0.045;
    if (stampAlpha > 0.002) {
      const gx = w * (0.2 + ((stampIdx * 0.37) % 0.6));
      const gy = h * (0.26 + ((stampIdx * 0.23) % 0.42));
      ctx.save();
      ctx.font = `${Math.round(Math.min(w, h) * 0.26)}px XiangqiCalligraphy, KaiTi, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isJade
        ? `rgba(140, 232, 210, ${stampAlpha.toFixed(4)})`
        : `rgba(242, 198, 120, ${stampAlpha.toFixed(4)})`;
      ctx.fillText(STAMP_GLYPHS[stampIdx], gx, gy);
      ctx.restore();
    }

    // 2. Shooting star (every 22 s, 1 s duration)
    const starCycle = sec % 22;
    if (starCycle >= 4.0 && starCycle <= 5.0) {
      const p = starCycle - 4.0;
      const sx = w * (0.78 - p * 0.32);
      const sy = h * (0.10 + p * 0.14);
      const alpha = Math.sin(p * Math.PI) * 0.85;
      const grad = ctx.createLinearGradient(sx, sy, sx + 75, sy - 32);
      grad.addColorStop(0, `rgba(255, 250, 232, ${alpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 250, 232, 0)');
      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 75, sy - 32);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Paper lanterns (or violet face-down tile glints when hovering Cờ Úp)
    for (const l of this.entities.lanterns) {
      const yNorm = ((l.y - sec * l.vy) % 1.2 + 1.2) % 1.2 - 0.1;
      const ly = yNorm * h;
      const lx = l.x * w + Math.sin(sec * l.swayFreq + l.phase) * l.swayAmp;
      const edgeFade = Math.min(1, Math.min(yNorm + 0.1, 1.1 - yNorm) * 4.5);
      if (edgeFade <= 0.01) continue;
      const flicker = 0.88 + 0.12 * Math.sin(sec * l.flickerFreq + l.phase);
      const alpha = edgeFade * flicker;

      if (l.isTileVariant && coupMix > 0.35) {
        // Mysterious violet-indigo face-down tile glint
        ctx.save();
        ctx.globalAlpha = alpha * coupMix * 0.78;
        const r = l.size * 0.72;
        const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, r * 2.1);
        g.addColorStop(0, 'rgba(176, 146, 255, 0.55)');
        g.addColorStop(1, 'rgba(110, 80, 210, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, r * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2B1F4A';
        ctx.strokeStyle = '#C9B2FF';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(lx, ly, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        const glowColor = isJade
          ? 'rgba(110, 232, 200, 0.35)'
          : xqMix > 0.3
            ? 'rgba(246, 130, 72, 0.42)'
            : 'rgba(246, 186, 86, 0.36)';
        const bodyTop = isJade ? '#B7F4E2' : '#FFE7A8';
        const bodyBot = isJade ? '#369982' : xqMix > 0.3 ? '#C83B28' : '#D46B2E';

        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        const gr = l.size * 2.3;
        const glow = ctx.createRadialGradient(lx, ly, 1, lx, ly, gr);
        glow.addColorStop(0, glowColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, gr, 0, Math.PI * 2);
        ctx.fill();

        // Paper lantern body
        const bw = l.size * 0.65;
        const bh = l.size * 0.85;
        const lg = ctx.createLinearGradient(lx, ly - bh, lx, ly + bh);
        lg.addColorStop(0, bodyTop);
        lg.addColorStop(1, bodyBot);
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.ellipse(lx, ly, bw, bh, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 4. Fireflies / gold dust motes
    ctx.save();
    for (const f of this.entities.fireflies) {
      const fx = (((f.x + sec * f.vx + Math.sin(sec * 0.6 + f.phase) * 0.015) % 1) + 1) % 1 * w;
      const fy = (((f.y + sec * f.vy) % 1) + 1) % 1 * h;
      const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(sec * f.twinkleFreq + f.phase));
      ctx.fillStyle = isJade
        ? `rgba(155, 245, 224, ${(tw * 0.55).toFixed(3)})`
        : coupMix > 0.4
          ? `rgba(196, 174, 255, ${(tw * 0.55).toFixed(3)})`
          : `rgba(248, 214, 126, ${(tw * 0.58).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(fx, fy, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Cherry petals / leaves with wind gusts
    ctx.save();
    const gust = Math.sin(sec * 0.45) * 0.008;
    for (const pt of this.entities.petals) {
      const px = (((pt.x + sec * (pt.vx + gust)) % 1.1) + 1.1) % 1.1 * w - w * 0.05;
      const py = (((pt.y + sec * pt.vy) % 1.1) + 1.1) % 1.1 * h - h * 0.05;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(pt.rot + sec * pt.rotSpeed);
      ctx.fillStyle = isJade ? 'rgba(182, 236, 220, 0.36)' : 'rgba(248, 186, 174, 0.42)';
      ctx.beginPath();
      ctx.ellipse(0, 0, pt.size, pt.size * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._teardownCanvas();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisChange);
    leakTracker.trackListener(-2);
    if (this._hasPointerListener) {
      window.removeEventListener('pointermove', this._onPointerMove);
      leakTracker.trackListener(-1);
      this._hasPointerListener = false;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
