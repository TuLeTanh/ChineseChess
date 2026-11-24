/**
 * End-of-game cinematic overlay controller ("Song kiếm giao phong", "Bại trận",
 * "Đầu hàng", "Hạ kiếm").
 *
 * All animation is a deterministic pure function `render(t)` of elapsed ms `t`,
 * driven by requestAnimationFrame ONLY while playing (max ~3.8 s), then stopped
 * completely. Supports window.__fxSeek(ms) in ?test mode, document.hidden pause,
 * prefers-reduced-motion fallback, theme-aware accents, and instant skip/cancel.
 */
import { buildFxSvgDefs, buildFlagClothPath } from './swords.js';
import { createParticlePlan, renderParticles } from './particles.js';

export const FX_TIMINGS = {
  win: {
    clashDefault: 1150,
    preludeEnd: 600,
    swordsEnter: 500,
    hitStop: 60,
    titleStart: 1350,
    titleEnd: 2300,
    sealStart: 2300,
    sealEnd: 2700,
    end: 3600,
  },
  lose: {
    dimEnd: 900,
    toppleStart: 300,
    toppleEnd: 900,
    stabStart: 900,
    stabImpact: 1400,
    titleStart: 1400,
    titleEnd: 2600,
    end: 3800,
  },
  resign: {
    dimEnd: 900,
    flagStart: 700,
    flagPlant: 1200,
    titleStart: 1400,
    titleEnd: 2600,
    end: 3800,
  },
  draw: {
    dimEnd: 500,
    swordsStart: 400,
    touch: 1200,
    crossStart: 1300,
    crossEnd: 2000,
    titleStart: 1700,
    titleEnd: 2300,
    end: 3200,
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInPower = (t) => Math.pow(clamp01(t), 2.4);

/**
 * Play an end-of-game cinematic over the board wrapper.
 * @param {{
 *   container: HTMLElement,
 *   boardSvg: SVGSVGElement,
 *   theme: import('../theme.js').Theme,
 *   kind: 'win' | 'lose' | 'draw' | 'resign',
 *   winnerSide?: 'red' | 'black' | null,
 *   reason?: 'checkmate' | 'stalemate' | 'repetition' | 'norule' | 'resign',
 *   generalSquare?: { x: number, y: number } | null,
 *   vsAi?: boolean,
 *   sfx?: any,
 *   tClashOverride?: number | null,
 *   speed?: number,
 *   reducedMotion?: boolean,
 *   testMode?: boolean,
 *   onDone?: () => void,
 * }} opts
 */
export function playEndFx(opts) {
  const {
    container,
    boardSvg,
    theme,
    kind,
    winnerSide = 'red',
    reason = 'checkmate',
    generalSquare = null,
    vsAi = false,
    sfx = null,
    tClashOverride = null,
    speed = 1,
    reducedMotion = false,
    testMode = false,
    onDone = () => {},
  } = opts;

  const baseT = FX_TIMINGS[kind] || FX_TIMINGS.win;
  const shift =
    kind === 'win' && typeof tClashOverride === 'number' && Number.isFinite(tClashOverride)
      ? tClashOverride - baseT.clashDefault
      : 0;
  const tEnd = reducedMotion ? 400 : Math.max(800, baseT.end + shift);
  const tClash = baseT.clashDefault ? baseT.clashDefault + shift : 1150;
  const tSeal = baseT.sealStart ? baseT.sealStart + shift : 2300;

  const accent = theme?.ui?.fxAccent || theme?.ui?.accentGold || '#F2C14E';
  const accent2 = theme?.ui?.fxAccent2 || '#E07A3F';
  const drawAccent = theme?.ui?.fxDrawAccent || '#C9D8DE';
  const plan = createParticlePlan(kind, 20261124);

  // Caption & glyph text
  let glyph = '勝';
  let caption = winnerSide === 'black' ? 'ĐEN THẮNG' : 'ĐỎ THẮNG';
  let subReason = '';
  if (kind === 'win') {
    glyph = '勝';
    caption = vsAi ? 'BẠN THẮNG' : winnerSide === 'black' ? 'ĐEN THẮNG' : 'ĐỎ THẮNG';
    subReason = reason === 'stalemate' ? 'Đối phương hết nước đi' : 'Chiếu bí';
  } else if (kind === 'lose') {
    glyph = '敗';
    caption = vsAi ? 'BẠN ĐÃ THUA' : winnerSide === 'black' ? 'ĐEN THẮNG' : 'ĐỎ THẮNG';
    subReason = reason === 'stalemate' ? 'Hết nước đi: bên bị bí thua (luật cờ tướng)' : 'Chiếu bí';
  } else if (kind === 'resign') {
    glyph = '投降';
    caption = 'ĐẦU HÀNG';
    subReason = 'Bạn đã đầu hàng';
  } else if (kind === 'draw') {
    glyph = '和';
    caption = 'HÒA';
    subReason = reason === 'norule' ? '60 nước không ăn quân' : 'Lặp thế cờ 3 lần';
  }

  // Mount overlay layers inside container (.board-wrapper)
  const root = document.createElement('div');
  root.className = `fx-overlay fx-kind-${kind}`;
  root.dataset.fxKind = kind;

  const vignette = document.createElement('div');
  vignette.className = 'fx-vignette';

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'fx-svg');
  svg.setAttribute('viewBox', '0 0 1050 1150');
  svg.setAttribute('aria-hidden', 'true');

  const gPos = generalSquare || { x: 525, y: 125 };
  const generalNorm = { x: gPos.x / 1050, y: gPos.y / 1150 };

  const titleFill =
    kind === 'win'
      ? winnerSide === 'black'
        ? 'url(#fx-win-black-grad)'
        : 'url(#fx-win-red-grad)'
      : kind === 'draw'
        ? 'url(#fx-draw-grad)'
        : 'url(#fx-lose-grad)';
  const titleStroke =
    kind === 'win'
      ? winnerSide === 'black'
        ? accent
        : '#FFE6A8'
      : kind === 'draw'
        ? 'rgba(15, 32, 34, 0.72)'
        : 'rgba(20, 8, 8, 0.8)';
  const glyphSize = kind === 'resign' ? 250 : 390; // ~36% of 1150 board height

  svg.innerHTML = `
    <defs>
      ${buildFxSvgDefs()}
      <clipPath id="fx-ink-wipe">
        <rect class="fx-wipe-rect" x="0" y="0" width="0" height="1150"/>
      </clipPath>
    </defs>

    <!-- Crack overlay on checkmated general (win) -->
    <g class="fx-crack" opacity="0" transform="translate(${gPos.x.toFixed(1)} ${gPos.y.toFixed(1)})">
      <path class="fx-crack-path" d="M 0,0 L -18,-26 L -34,-18 M 0,0 L 22,-22 L 36,-32 M 0,0 L 24,18 L 12,35 M 0,0 L -24,20 L -36,30"
        fill="none" stroke="#1E100A" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"
        stroke-dasharray="220" stroke-dashoffset="220"/>
    </g>

    <!-- Taiji rotating ring behind draw truce -->
    <g class="fx-taiji-wrap" transform="translate(525 575)" opacity="0">
      <g class="fx-taiji-spin">
        <circle cx="0" cy="0" r="190" fill="none" stroke="${drawAccent}" stroke-width="2.6" opacity="0.65"/>
        <path d="M 0,-190 A 95,95 0 0,1 0,0 A 95,95 0 0,0 0,190" fill="none" stroke="${drawAccent}" stroke-width="2.2" opacity="0.55"/>
        <circle cx="0" cy="-95" r="16" fill="none" stroke="${drawAccent}" stroke-width="2" opacity="0.6"/>
        <circle cx="0" cy="95" r="16" fill="${drawAccent}" opacity="0.45"/>
      </g>
    </g>

    <!-- Motion-streak ghosts for swords -->
    <g class="fx-ghosts" opacity="0">
      <use class="fx-sword-l-g2" href="#fx-jian-gold" width="180" height="680" x="-90" y="-340" opacity="0.16"/>
      <use class="fx-sword-l-g1" href="#fx-jian-gold" width="180" height="680" x="-90" y="-340" opacity="0.30"/>
      <use class="fx-sword-r-g2" href="#fx-jian-jade" width="180" height="680" x="-90" y="-340" opacity="0.16"/>
      <use class="fx-sword-r-g1" href="#fx-jian-jade" width="180" height="680" x="-90" y="-340" opacity="0.30"/>
    </g>

    <!-- Main swords -->
    <g class="fx-swords" filter="url(#fx-sword-shadow)" opacity="0">
      <g class="fx-sword-left"><use href="#fx-jian-gold" width="180" height="680" x="-90" y="-340"/></g>
      <g class="fx-sword-right"><use href="#fx-jian-jade" width="180" height="680" x="-90" y="-340"/></g>
    </g>

    <!-- Resign white flag -->
    <g class="fx-flag" opacity="0" filter="url(#fx-sword-shadow)">
      <line x1="485" y1="340" x2="485" y2="730" stroke="#C8B9A6" stroke-width="9" stroke-linecap="round"/>
      <circle cx="485" cy="336" r="10" fill="#E6D6C0" stroke="#6E6254" stroke-width="2"/>
      <path class="fx-flag-cloth" transform="translate(490 352)" d="${buildFlagClothPath(0)}"
        fill="#F4F1EA" stroke="#BFB7AB" stroke-width="2"/>
    </g>

    <!-- Calligraphy title & Vietnamese caption -->
    <g class="fx-title-group" opacity="0">
      <g class="fx-glyph-clip">
        <text class="fx-glyph-text" x="525" y="${kind === 'resign' ? 600 : 625}" text-anchor="middle"
          font-family="XiangqiCalligraphy, KaiTi, serif" font-size="${glyphSize}"
          fill="${titleFill}" stroke="${titleStroke}" stroke-width="${kind === 'win' ? 4.5 : 2.5}"
          paint-order="stroke" filter="url(#fx-tear-filter)">${glyph}</text>
      </g>
      <text class="fx-caption-text" x="525" y="758" text-anchor="middle"
        font-family="Segoe UI, system-ui, sans-serif" font-size="44" font-weight="800"
        fill="${kind === 'lose' || kind === 'resign' ? '#E8D5D0' : '#FFF4DC'}"
        stroke="rgba(14, 9, 6, 0.85)" stroke-width="5" paint-order="stroke"
        letter-spacing="12" opacity="0">${caption}</text>
      <text class="fx-sub-text" x="525" y="806" text-anchor="middle"
        font-family="Segoe UI, system-ui, sans-serif" font-size="24" font-weight="600"
        fill="${kind === 'draw' ? drawAccent : '#E4D0B2'}"
        stroke="rgba(14, 9, 6, 0.82)" stroke-width="3.5" paint-order="stroke"
        opacity="0">${subReason}</text>
    </g>

    <!-- Red square seal 印章 (win only) -->
    <g class="fx-seal" transform="translate(745 640) rotate(-6) scale(1.6)" opacity="0" filter="url(#fx-seal-rough)">
      <rect x="-54" y="-54" width="108" height="108" rx="10" fill="#B8231A" stroke="#F4DFC0" stroke-width="3.5"/>
      <rect x="-46" y="-46" width="92" height="92" rx="6" fill="none" stroke="#F4DFC0" stroke-width="1.6" opacity="0.75"/>
      <text x="0" y="25" text-anchor="middle" font-family="XiangqiCalligraphy, KaiTi, serif"
        font-size="68" fill="#FBEFD2">將</text>
    </g>
  `;

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'fx-skip-btn';
  skipBtn.textContent = 'Bỏ qua';
  skipBtn.setAttribute('aria-label', 'Bỏ qua hiệu ứng');

  root.append(vignette, svg, canvas, skipBtn);
  container.appendChild(root);

  // Cache SVG refs (zero querySelector in rAF!)
  const crackG = svg.querySelector('.fx-crack');
  const crackPath = svg.querySelector('.fx-crack-path');
  const taijiWrap = svg.querySelector('.fx-taiji-wrap');
  const ghostsG = svg.querySelector('.fx-ghosts');
  const gL1 = svg.querySelector('.fx-sword-l-g1');
  const gL2 = svg.querySelector('.fx-sword-l-g2');
  const gR1 = svg.querySelector('.fx-sword-r-g1');
  const gR2 = svg.querySelector('.fx-sword-r-g2');
  const swordsG = svg.querySelector('.fx-swords');
  const swordL = svg.querySelector('.fx-sword-left');
  const swordR = svg.querySelector('.fx-sword-right');
  const flagG = svg.querySelector('.fx-flag');
  const flagCloth = svg.querySelector('.fx-flag-cloth');
  const titleG = svg.querySelector('.fx-title-group');
  const glyphClip = svg.querySelector('.fx-glyph-clip');
  const wipeRect = svg.querySelector('.fx-wipe-rect');
  const tearDisp = svg.querySelector('.fx-tear-disp');
  const captionText = svg.querySelector('.fx-caption-text');
  const subText = svg.querySelector('.fx-sub-text');
  const sealG = svg.querySelector('.fx-seal');

  // Losing general piece element (for subtle tilt/desaturate or topple)
  const losingSide =
    kind === 'win'
      ? winnerSide === 'red'
        ? 'black'
        : 'red'
      : winnerSide === 'red'
        ? 'black'
        : winnerSide === 'black'
          ? 'red'
          : null;
  const generalEl =
    boardSvg && losingSide
      ? boardSvg.querySelector(`g.layer-pieces > g[data-kind="general"][data-side="${losingSide}"]`)
      : null;
  const origGeneralTransform = generalEl ? generalEl.getAttribute('transform') || '' : '';

  // DPR-aware canvas sizing
  let cssW = 0;
  let cssH = 0;
  const ctx = canvas.getContext('2d');
  const resizeCanvas = () => {
    const rect = container.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resizeCanvas();

  // Sound trigger guards (so each fires at most once during playback, never during seek)
  const firedSounds = new Set();
  const triggerSfxOnce = (key, evName) => {
    if (!sfx || firedSounds.has(key)) return;
    firedSounds.add(key);
    sfx.play(evName, 0);
  };

  let finished = false;
  let cancelled = false;
  let rafId = 0;
  let elapsed = 0;
  let lastWall = performance.now();
  let resolvePromise;
  const promise = new Promise((r) => {
    resolvePromise = r;
  });

  function setSwordTransform(el, x, y, deg, sc = 1.12) {
    el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(2)}) scale(${sc.toFixed(3)})`);
  }

  function render(tRaw, isSeek = false) {
    const t = Math.max(0, tRaw);

    if (reducedMotion) {
      const p = clamp01(t / 400);
      if (boardSvg) {
        boardSvg.style.filter = `brightness(${lerp(1, 0.65, p).toFixed(3)})`;
        boardSvg.style.transform = '';
      }
      vignette.style.opacity = (p * 0.7).toFixed(3);
      if (ctx) ctx.clearRect(0, 0, cssW, cssH);
      swordsG.setAttribute('opacity', '0');
      ghostsG.setAttribute('opacity', '0');
      flagG.setAttribute('opacity', '0');
      titleG.setAttribute('opacity', p.toFixed(3));
      glyphClip.removeAttribute('clip-path');
      captionText.setAttribute('opacity', p.toFixed(3));
      captionText.setAttribute('letter-spacing', '5');
      subText.setAttribute('opacity', p.toFixed(3));
      if (kind === 'win') {
        sealG.setAttribute('opacity', p.toFixed(3));
        sealG.setAttribute('transform', 'translate(745 640) rotate(-6) scale(1)');
      }
      return;
    }

    // ---- WIN: "Song kiếm giao phong" ----
    if (kind === 'win') {
      const tl = t - shift; // normalized timeline where clash = 1150
      const dimP = clamp01(t / 600);
      const pushScale = lerp(1.0, 1.025, clamp01(t / tEnd));

      // Hit-stop freeze 60 ms at clash (1150..1210)
      const inHitStop = tl >= 1150 && tl < 1210;
      const shakeT = tl >= 1210 ? tl - 1210 : -1;
      let shakeX = 0;
      let shakeY = 0;
      if (shakeT >= 0 && shakeT <= 220) {
        const amp = 6 * (1 - shakeT / 220);
        shakeX = Math.sin(shakeT * 0.085) * amp;
        shakeY = Math.cos(shakeT * 0.11) * amp;
      }
      const sealShakeT = tl - 2520;
      if (sealShakeT >= 0 && sealShakeT <= 140) {
        const amp = 3 * (1 - sealShakeT / 140);
        shakeX += Math.sin(sealShakeT * 0.12) * amp;
        shakeY += Math.cos(sealShakeT * 0.14) * amp;
      }

      if (boardSvg) {
        boardSvg.style.filter = `brightness(${lerp(1, 0.60, dimP).toFixed(3)})`;
        boardSvg.style.transform = `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) scale(${pushScale.toFixed(4)})`;
      }
      vignette.style.opacity = (dimP * 0.85).toFixed(3);

      // General crack (0..250 ms) + slight tilt/desat (250..600 ms)
      if (t > 40) {
        const cp = clamp01((t - 40) / 250);
        crackG.setAttribute('opacity', '1');
        crackPath.setAttribute('stroke-dashoffset', (220 * (1 - cp)).toFixed(1));
        if (generalEl && t > 250) {
          const tp = clamp01((t - 250) / 260);
          generalEl.style.filter = `saturate(${lerp(1, 0.2, tp).toFixed(2)})`;
          generalEl.setAttribute(
            'transform',
            `${origGeneralTransform} translate(0 ${(3 * tp).toFixed(2)}) rotate(${(6 * tp).toFixed(2)})`
          );
        }
      }

      // Swords enter (500..1150) & stay crossed with idle sway
      if (tl >= 500) {
        swordsG.setAttribute('opacity', '1');
        const enterP = clamp01((tl - 500) / 650);
        const e = easeInPower(enterP);
        if (tl < 1150) {
          const lx = lerp(70, 525, e);
          const ly = lerp(1140, 575, e) - Math.sin(e * Math.PI) * 75;
          const lDeg = lerp(24, 42, e);
          const rx = lerp(980, 525, e);
          const ry = lerp(1140, 575, e) - Math.sin(e * Math.PI) * 75;
          const rDeg = lerp(-24, -42, e);
          setSwordTransform(swordL, lx, ly, lDeg);
          setSwordTransform(swordR, rx, ry, rDeg);

          // 3-frame motion-streak ghosts
          ghostsG.setAttribute('opacity', '1');
          const e1 = easeInPower(Math.max(0, enterP - 0.05));
          const e2 = easeInPower(Math.max(0, enterP - 0.11));
          setSwordTransform(gL1, lerp(70, 525, e1), lerp(1140, 575, e1) - Math.sin(e1 * Math.PI) * 75, lerp(24, 42, e1));
          setSwordTransform(gL2, lerp(70, 525, e2), lerp(1140, 575, e2) - Math.sin(e2 * Math.PI) * 75, lerp(24, 42, e2));
          setSwordTransform(gR1, lerp(980, 525, e1), lerp(1140, 575, e1) - Math.sin(e1 * Math.PI) * 75, lerp(-24, -42, e1));
          setSwordTransform(gR2, lerp(980, 525, e2), lerp(1140, 575, e2) - Math.sin(e2 * Math.PI) * 75, lerp(-24, -42, e2));
        } else {
          ghostsG.setAttribute('opacity', '0');
          const sway = inHitStop ? 0 : Math.sin(((tl - 1210) / 1000) * 2.1) * 1.2;
          setSwordTransform(swordL, 525, 575, 42 + sway);
          setSwordTransform(swordR, 525, 575, -42 - sway);
        }
      }

      if (!isSeek && t >= tClash) triggerSfxOnce('clash', 'sword_clash');

      // Title ink-wipe reveal (1350..1800) + caption (1600..2100)
      if (tl >= 1350) {
        const wp = easeOutCubic((tl - 1350) / 450);
        titleG.setAttribute('opacity', '1');
        glyphClip.setAttribute('clip-path', 'url(#fx-ink-wipe)');
        wipeRect.setAttribute('width', (1050 * wp).toFixed(1));

        const capP = easeOutCubic((tl - 1600) / 360);
        captionText.setAttribute('opacity', capP.toFixed(3));
        captionText.setAttribute('letter-spacing', lerp(18, 5, capP).toFixed(2));
        captionText.setAttribute('y', lerp(774, 758, capP).toFixed(1));
        subText.setAttribute('opacity', clamp01((tl - 1750) / 350).toFixed(3));
      }

      // Red square seal slam (2300..2700)
      if (tl >= 2300) {
        if (!isSeek && t >= tSeal) triggerSfxOnce('stamp', 'stamp');
        const sp = clamp01((tl - 2300) / 260);
        const sc = sp < 0.85 ? lerp(1.6, 0.94, easeInPower(sp / 0.85)) : lerp(0.94, 1.0, (sp - 0.85) / 0.15);
        sealG.setAttribute('opacity', Math.min(1, sp * 2.2).toFixed(3));
        sealG.setAttribute('transform', `translate(745 640) rotate(-6) scale(${sc.toFixed(3)})`);
      }

      if (ctx) renderParticles(ctx, cssW, cssH, 'win', t, plan, { tClash, accent, accent2, drawAccent });
      return;
    }

    // ---- LOSE: "Bại trận" ----
    if (kind === 'lose') {
      if (!isSeek && t >= 40) triggerSfxOnce('defeat', 'defeat');
      const dimP = clamp01(t / 900);
      const stabT = t - 1400;
      let shakeX = 0;
      let shakeY = 0;
      if (stabT >= 0 && stabT <= 160) {
        const amp = 4 * (1 - stabT / 160);
        shakeX = Math.sin(stabT * 0.11) * amp;
        shakeY = Math.cos(stabT * 0.13) * amp;
      }
      if (boardSvg) {
        boardSvg.style.filter = `saturate(${lerp(1, 0.25, dimP).toFixed(3)}) brightness(${lerp(1, 0.56, dimP).toFixed(3)})`;
        boardSvg.style.transform = `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`;
      }
      vignette.style.opacity = (dimP * 0.9).toFixed(3);

      // General piece topple (300..800 ms)
      if (generalEl && t >= 300) {
        const tp = clamp01((t - 300) / 500);
        const bounce = tp > 0.78 ? Math.sin(((tp - 0.78) / 0.22) * Math.PI) * -6 : 0;
        const rot = 78 * easeInPower(tp) + bounce;
        generalEl.style.filter = `saturate(${lerp(1, 0.08, tp).toFixed(2)}) brightness(${lerp(1, 0.75, tp).toFixed(2)})`;
        generalEl.setAttribute('transform', `${origGeneralTransform} translate(0 ${(14 * tp).toFixed(1)}) rotate(${rot.toFixed(1)})`);
      }

      // Single sword drops (900..1400) & sticks in vibrating (1400..1750)
      if (t >= 900) {
        swordsG.setAttribute('opacity', '1');
        swordR.setAttribute('opacity', '0');
        swordL.setAttribute('opacity', '1');
        if (t < 1400) {
          const dp = easeInPower((t - 900) / 500);
          const sy = lerp(-260, 560, dp);
          setSwordTransform(swordL, 525, sy, 188, 1.15);
          ghostsG.setAttribute('opacity', '1');
          gR1.setAttribute('opacity', '0');
          gR2.setAttribute('opacity', '0');
          setSwordTransform(gL1, 525, lerp(-260, 560, Math.max(0, dp - 0.09)), 188, 1.15);
          setSwordTransform(gL2, 525, lerp(-260, 560, Math.max(0, dp - 0.18)), 188, 1.15);
        } else {
          ghostsG.setAttribute('opacity', '0');
          if (!isSeek) triggerSfxOnce('stab', 'sword_stab');
          const vt = t - 1400;
          const vib = vt <= 350 ? Math.sin((vt / 350) * Math.PI * 8) * 3.5 * (1 - vt / 350) : 0;
          setSwordTransform(swordL, 525, 560, 188 + vib, 1.15);
        }
      }

      // Title 敗 slow fade + 4 px drift + 200 ms tear distortion
      if (t >= 1400) {
        const tp = easeOutCubic((t - 1400) / 600);
        titleG.setAttribute('opacity', tp.toFixed(3));
        glyphClip.removeAttribute('clip-path');
        titleG.setAttribute('transform', `translate(0 ${lerp(12, 0, tp).toFixed(1)})`);
        const tearScale = t < 1620 ? 12 * (1 - (t - 1400) / 220) : 0;
        tearDisp.setAttribute('scale', tearScale.toFixed(2));
        const cp = clamp01((t - 1700) / 450);
        captionText.setAttribute('opacity', cp.toFixed(3));
        captionText.setAttribute('letter-spacing', '6');
        subText.setAttribute('opacity', clamp01((t - 1900) / 400).toFixed(3));
      }

      if (ctx) renderParticles(ctx, cssW, cssH, 'lose', t, plan, { tClash, accent, accent2, drawAccent, generalNorm });
      return;
    }

    // ---- RESIGN: white flag planted & waving ----
    if (kind === 'resign') {
      if (!isSeek && t >= 40) triggerSfxOnce('defeat', 'defeat');
      const dimP = clamp01(t / 900);
      if (boardSvg) {
        boardSvg.style.filter = `saturate(${lerp(1, 0.28, dimP).toFixed(3)}) brightness(${lerp(1, 0.58, dimP).toFixed(3)})`;
        boardSvg.style.transform = '';
      }
      vignette.style.opacity = (dimP * 0.85).toFixed(3);

      if (t >= 700) {
        const fp = easeOutCubic((t - 700) / 500);
        if (!isSeek && t >= 1150) triggerSfxOnce('whoosh', 'cloth_whoosh');
        flagG.setAttribute('opacity', fp.toFixed(3));
        flagG.setAttribute('transform', `translate(0 ${lerp(-180, 0, fp).toFixed(1)})`);
        flagCloth.setAttribute('d', buildFlagClothPath((t / 1000) * 4.5));
      }

      if (t >= 1400) {
        const tp = easeOutCubic((t - 1400) / 600);
        titleG.setAttribute('opacity', tp.toFixed(3));
        glyphClip.removeAttribute('clip-path');
        captionText.setAttribute('opacity', clamp01((t - 1650) / 420).toFixed(3));
        captionText.setAttribute('letter-spacing', '6');
        subText.setAttribute('opacity', clamp01((t - 1850) / 400).toFixed(3));
      }

      if (ctx) renderParticles(ctx, cssW, cssH, 'resign', t, plan, { tClash, accent, accent2, drawAccent });
      return;
    }

    // ---- DRAW: "Hạ kiếm" ----
    const dimP = clamp01(t / 500);
    if (boardSvg) {
      boardSvg.style.filter = `brightness(${lerp(1, 0.80, dimP).toFixed(3)})`;
      boardSvg.style.transform = '';
    }
    vignette.style.opacity = (dimP * 0.55).toFixed(3);

    if (t >= 400) {
      swordsG.setAttribute('opacity', '1');
      if (t < 1200) {
        const ep = easeOutCubic((t - 400) / 800);
        setSwordTransform(swordL, lerp(-120, 215, ep), 575, 90, 0.96);
        setSwordTransform(swordR, lerp(1170, 835, ep), 575, -90, 0.96);
      } else {
        if (!isSeek) triggerSfxOnce('touch', 'sword_touch');
        const cp = easeOutCubic((t - 1300) / 700);
        setSwordTransform(swordL, lerp(215, 525, cp), lerp(575, 595, cp), lerp(90, 56, cp), 0.96);
        setSwordTransform(swordR, lerp(835, 525, cp), lerp(575, 595, cp), lerp(-90, -56, cp), 0.96);
      }
    }

    if (t >= 1300) {
      const tp = easeOutCubic((t - 1300) / 700);
      taijiWrap.setAttribute('opacity', (tp * 0.72).toFixed(3));
    }

    if (t >= 1700) {
      const tp = easeOutCubic((t - 1700) / 550);
      titleG.setAttribute('opacity', tp.toFixed(3));
      glyphClip.removeAttribute('clip-path');
      captionText.setAttribute('opacity', clamp01((t - 1850) / 400).toFixed(3));
      captionText.setAttribute('letter-spacing', '8');
      subText.setAttribute('opacity', clamp01((t - 2000) / 380).toFixed(3));
    }

    if (ctx) renderParticles(ctx, cssW, cssH, 'draw', t, plan, { tClash, accent, accent2, drawAccent });
  }

  function finish() {
    if (finished || cancelled) return;
    finished = true;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    render(tEnd, true);
    root.classList.add('is-settled');
    skipBtn.hidden = true;
    detachListeners();
    onDone();
    resolvePromise();
  }

  function skip() {
    if (finished || cancelled) return;
    elapsed = tEnd;
    finish();
  }

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    finished = true;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    detachListeners();
    if (boardSvg) {
      boardSvg.style.filter = '';
      boardSvg.style.transform = '';
    }
    if (generalEl) {
      generalEl.style.filter = '';
      generalEl.setAttribute('transform', origGeneralTransform);
    }
    root.remove();
    if (testMode && window.__fxSeek === seekFn) {
      delete window.__fxSeek;
    }
    resolvePromise();
  }

  const seekFn = (ms) => {
    if (cancelled) return;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    elapsed = Math.max(0, Number(ms) || 0);
    resizeCanvas();
    render(elapsed, true);
  };

  if (testMode && typeof window !== 'undefined') {
    window.__fxSeek = seekFn;
  }

  const onVisChange = () => {
    if (!document.hidden) {
      lastWall = performance.now();
    }
  };
  const onSkipClick = (ev) => {
    ev.stopPropagation();
    skip();
  };
  const onRootClick = () => skip();
  const onKeyDown = (ev) => {
    if (finished || cancelled) return;
    ev.preventDefault();
    ev.stopPropagation();
    skip();
  };

  function detachListeners() {
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('keydown', onKeyDown, true);
    skipBtn.removeEventListener('click', onSkipClick);
    root.removeEventListener('click', onRootClick);
  }

  document.addEventListener('visibilitychange', onVisChange);
  window.addEventListener('keydown', onKeyDown, true);
  skipBtn.addEventListener('click', onSkipClick);
  root.addEventListener('click', onRootClick);

  // Initial render at t=0
  render(0, false);

  const tick = (now) => {
    if (finished || cancelled) return;
    if (!document.hidden) {
      const dt = Math.min(80, Math.max(0, now - lastWall)) * speed;
      elapsed += dt;
      render(elapsed, false);
    }
    lastWall = now;
    if (elapsed >= tEnd) {
      finish();
    } else {
      rafId = window.requestAnimationFrame(tick);
    }
  };
  rafId = window.requestAnimationFrame(tick);

  return { skip, cancel, seek: seekFn, promise };
}
