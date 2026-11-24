/**
 * Deterministic, seeded-RNG 2D Canvas particle renderer for end-of-game cinematics.
 * Pure function of time t (ms) so window.__fxSeek(ms) is 100% reproducible
 * and zero per-frame allocations occur. Max particles capped at 220.
 */

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
 * Pre-build deterministic particle tables once per cinematic run.
 * @param {'win'|'lose'|'resign'|'draw'} kind
 * @param {number} seed
 */
export function createParticlePlan(kind, seed = 20261124) {
  const rand = makeRng(seed);

  if (kind === 'win') {
    const sparks = [];
    for (let i = 0; i < 20; i++) {
      const ang = rand() * Math.PI * 2;
      const speed = 260 + rand() * 260; // 260-520 px/s (in 1050px ref space)
      sparks.push({
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 90,
        life: 600 + rand() * 300,
        size: 2.5 + rand() * 3.5,
        hueMix: rand(),
      });
    }
    const glints = [];
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + rand() * 0.6;
      const dist = 16 + rand() * 54;
      glints.push({
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        delay: rand() * 55,
        size: 16 + rand() * 18,
      });
    }
    const embers = [];
    for (let i = 0; i < 75; i++) {
      embers.push({
        xFrac: 0.06 + rand() * 0.88,
        spawnOffset: rand() * 2000,
        vy: -(55 + rand() * 95),
        driftAmp: 12 + rand() * 24,
        driftFreq: 1.5 + rand() * 2.5,
        phase: rand() * Math.PI * 2,
        life: 1400 + rand() * 1200,
        size: 1.8 + rand() * 2.8,
      });
    }
    return { sparks, glints, embers };
  }

  if (kind === 'lose' || kind === 'resign') {
    const dustPuff = [];
    for (let i = 0; i < 14; i++) {
      const ang = rand() * Math.PI * 2;
      const spd = 40 + rand() * 95;
      dustPuff.push({
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.55 - 15,
        size: 8 + rand() * 14,
        life: 450 + rand() * 250,
      });
    }
    const debris = [];
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI * (0.15 + rand() * 0.7);
      const spd = 140 + rand() * 170;
      debris.push({
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 2.2 + rand() * 2.5,
        life: 420 + rand() * 280,
      });
    }
    const ash = [];
    for (let i = 0; i < 55; i++) {
      ash.push({
        xFrac: rand(),
        yStart: -0.05 - rand() * 0.35,
        vy: 38 + rand() * 55,
        swirlAmp: 14 + rand() * 24,
        swirlFreq: 1.2 + rand() * 1.8,
        phase: rand() * Math.PI * 2,
        size: 2 + rand() * 3.5,
        isEmber: rand() < 0.22,
        spawnOffset: rand() * 1200,
      });
    }
    return { dustPuff, debris, ash };
  }

  // draw
  const motes = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + 0.4;
    motes.push({
      vx: Math.cos(ang) * (42 + rand() * 26),
      vy: Math.sin(ang) * (42 + rand() * 26),
      size: 4 + rand() * 3,
      life: 900 + rand() * 300,
    });
  }
  return { motes };
}

/**
 * Draw deterministic canvas layer for time `t` (ms).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w CSS pixel width
 * @param {number} h CSS pixel height
 * @param {'win'|'lose'|'resign'|'draw'} kind
 * @param {number} t current ms
 * @param {object} plan from createParticlePlan()
 * @param {{ tClash: number, accent: string, accent2: string, drawAccent: string, generalNorm?: {x:number,y:number} }} opts
 */
export function renderParticles(ctx, w, h, kind, t, plan, opts) {
  ctx.clearRect(0, 0, w, h);
  if (w <= 0 || h <= 0) return;

  const scale = w / 1050;
  const cx = w * 0.5;
  const cy = h * 0.5;

  if (kind === 'win') {
    const tClash = opts.tClash ?? 1150;
    const dt = t - tClash;

    // 1. White-gold radial flash (0..220 ms after clash)
    if (dt >= 0 && dt <= 240) {
      const p = dt / 220;
      const alpha = Math.max(0, 0.9 * (1 - p));
      const r = w * (0.14 + 0.36 * p);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(255, 250, 224, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(242, 193, 78, ${(alpha * 0.55).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(242, 193, 78, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 2. Expanding shockwave ring (0..500 ms, 0 -> 0.42 * w)
    if (dt >= 0 && dt <= 500) {
      const p = dt / 500;
      const eased = 1 - (1 - p) * (1 - p);
      const r = w * 0.42 * eased;
      const alpha = Math.max(0, 0.78 * (1 - p));
      ctx.save();
      ctx.strokeStyle = opts.accent || '#F2C14E';
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1.5, (7 - 5 * p) * scale);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 14-22 additive sparks with gravity
    if (dt >= 0 && dt <= 950) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gAcc = 600 * scale;
      for (const sp of plan.sparks) {
        if (dt > sp.life) continue;
        const sec = (dt + 28) / 1000;
        const sx = cx + sp.vx * scale * sec;
        const sy = cy + sp.vy * scale * sec + 0.5 * gAcc * sec * sec;
        const prevSec = Math.max(0, sec - 0.032);
        const px = cx + sp.vx * scale * prevSec;
        const py = cy + sp.vy * scale * prevSec + 0.5 * gAcc * prevSec * prevSec;
        const alpha = Math.max(0, 1 - dt / sp.life);
        ctx.strokeStyle = sp.hueMix > 0.45
          ? `rgba(255, 248, 205, ${alpha.toFixed(3)})`
          : `rgba(255, 164, 62, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1.5, sp.size * scale);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. 5 metallic 4-point star glints (160 ms)
    if (dt >= 0 && dt <= 240) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const gl of plan.glints) {
        const gt = dt - gl.delay;
        if (gt < 0 || gt > 160) continue;
        const p = gt / 160;
        const env = Math.sin(p * Math.PI);
        const gx = cx + gl.dx * scale;
        const gy = cy + gl.dy * scale;
        const sz = gl.size * scale * (0.6 + 0.6 * env);
        ctx.fillStyle = `rgba(255, 252, 232, ${(env * 0.95).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(gx, gy - sz);
        ctx.lineTo(gx + sz * 0.18, gy - sz * 0.18);
        ctx.lineTo(gx + sz, gy);
        ctx.lineTo(gx + sz * 0.18, gy + sz * 0.18);
        ctx.lineTo(gx, gy + sz);
        ctx.lineTo(gx - sz * 0.18, gy + sz * 0.18);
        ctx.lineTo(gx - sz, gy);
        ctx.lineTo(gx - sz * 0.18, gy - sz * 0.18);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Rising gold embers (tClash + 50 onward, fade out by t = 4000)
    const emberStart = tClash + 50;
    if (t >= emberStart && t <= 4050) {
      const globalFade = t > 3400 ? Math.max(0, 1 - (t - 3400) / 600) : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const em of plan.embers) {
        const age = t - (emberStart + em.spawnOffset);
        if (age < 0 || age > em.life) continue;
        const p = age / em.life;
        const sec = age / 1000;
        const ex = em.xFrac * w + Math.sin(sec * em.driftFreq + em.phase) * em.driftAmp * scale;
        const ey = h * 0.98 + em.vy * scale * sec;
        const alpha = Math.sin(p * Math.PI) * 0.72 * globalFade;
        ctx.fillStyle = `rgba(246, 200, 92, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(1, em.size * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    return;
  }

  if (kind === 'lose' || kind === 'resign') {
    // Dust puff at losing general contact point (lose: t=720) or flag pole plant (resign: t=1180)
    const puffStart = kind === 'lose' ? 720 : 1180;
    const puffX = kind === 'lose' && opts.generalNorm ? opts.generalNorm.x * w : cx;
    const puffY = kind === 'lose' && opts.generalNorm ? opts.generalNorm.y * h : cy + 95 * scale;
    const pdt = t - puffStart;
    if (pdt >= 0 && pdt <= 700) {
      ctx.save();
      for (const dp of plan.dustPuff) {
        if (pdt > dp.life) continue;
        const p = pdt / dp.life;
        const sec = pdt / 1000;
        const dx = puffX + dp.vx * scale * sec;
        const dy = puffY + dp.vy * scale * sec;
        const alpha = 0.28 * (1 - p);
        ctx.fillStyle = `rgba(175, 165, 155, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(dx, dy, dp.size * scale * (0.6 + 0.7 * p), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sword stab impact (lose only, t = 1400)
    if (kind === 'lose') {
      const sdt = t - 1400;
      if (sdt >= 0 && sdt <= 480) {
        const p = sdt / 480;
        const r = w * 0.2 * (1 - (1 - p) * (1 - p));
        ctx.save();
        ctx.strokeStyle = `rgba(180, 155, 138, ${(0.55 * (1 - p)).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.2, (4.5 - 3 * p) * scale);
        ctx.beginPath();
        ctx.arc(cx, cy + 40 * scale, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (sdt >= 0 && sdt <= 720) {
        const gAcc = 520 * scale;
        ctx.save();
        for (const db of plan.debris) {
          if (sdt > db.life) continue;
          const sec = sdt / 1000;
          const bx = cx + db.vx * scale * sec;
          const by = cy + 40 * scale + db.vy * scale * sec + 0.5 * gAcc * sec * sec;
          const alpha = 0.8 * (1 - sdt / db.life);
          ctx.fillStyle = `rgba(205, 102, 58, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(bx, by, Math.max(1.2, db.size * scale), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Drifting ash flakes & dim embers (t >= 1200)
    if (t >= 1200) {
      const fadeIn = Math.min(1, (t - 1200) / 500);
      ctx.save();
      for (const a of plan.ash) {
        const age = t - (1200 + a.spawnOffset);
        if (age < 0) continue;
        const sec = age / 1000;
        const ax = ((a.xFrac * w + Math.sin(sec * a.swirlFreq + a.phase) * a.swirlAmp * scale) % w + w) % w;
        const ay = (a.yStart * h + a.vy * scale * sec);
        if (ay < -10 || ay > h + 10) continue;
        const alpha = (a.isEmber ? 0.52 : 0.36) * fadeIn;
        ctx.fillStyle = a.isEmber
          ? `rgba(210, 96, 56, ${alpha.toFixed(3)})`
          : `rgba(182, 180, 178, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ax, ay, Math.max(1, a.size * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    return;
  }

  // DRAW: calm drifting light fog + gentle touch ring + 4 soft light motes
  if (t >= 0) {
    const fogAlpha = Math.min(0.12, (t / 600) * 0.12);
    const fogDefs = [
      { y: 0.32, r: 0.42, spd: 0.018, off: 0.2 },
      { y: 0.54, r: 0.48, spd: -0.014, off: 0.72 },
      { y: 0.72, r: 0.38, spd: 0.011, off: 0.45 },
    ];
    ctx.save();
    for (const fg of fogDefs) {
      const fx = ((fg.off + (t / 1000) * fg.spd) % 1.4 + 1.4) % 1.4 - 0.2;
      const gx = fx * w;
      const gy = fg.y * h;
      const gr = fg.r * w;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grad.addColorStop(0, `rgba(215, 236, 240, ${fogAlpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(215, 236, 240, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  const tdt = t - 1200;
  if (tdt >= 0 && tdt <= 750) {
    const p = tdt / 700;
    const eased = 1 - (1 - p) * (1 - p);
    const r = w * 0.25 * eased;
    const alpha = Math.max(0, 0.5 * (1 - p));
    ctx.save();
    ctx.strokeStyle = opts.drawAccent || '#D8EEF2';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.2, (3.2 - 1.8 * p) * scale);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Soft contact glow
    if (tdt <= 360) {
      const ga = 0.65 * (1 - tdt / 360);
      const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 42 * scale);
      gg.addColorStop(0, `rgba(255, 255, 255, ${ga.toFixed(3)})`);
      gg.addColorStop(1, 'rgba(200, 235, 240, 0)');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - 50 * scale, cy - 50 * scale, 100 * scale, 100 * scale);
    }
    ctx.restore();
  }

  if (tdt >= 0 && tdt <= 1250) {
    ctx.save();
    for (const m of plan.motes) {
      if (tdt > m.life) continue;
      const p = tdt / m.life;
      const sec = tdt / 1000;
      const mx = cx + m.vx * scale * sec;
      const my = cy + m.vy * scale * sec;
      const alpha = Math.sin(p * Math.PI) * 0.7;
      ctx.fillStyle = `rgba(232, 246, 250, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(1.2, m.size * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
