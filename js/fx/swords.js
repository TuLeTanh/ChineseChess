/**
 * Inline SVG vector Jian (straight double-edged Chinese sword) symbols
 * and waving white flag for end-of-game cinematics.
 * Built once inside <defs> as <symbol> and reused via <use>.
 */

function buildSingleSwordSymbol(id, variant) {
  const isGold = variant === 'gold';
  const bladeTop = isGold ? '#F4F2EC' : '#E8EEF2';
  const bladeMid = isGold ? '#BCC2C7' : '#9FB0BD';
  const bladeBot = isGold ? '#6E747A' : '#5D6E7A';
  const ridgeColor = isGold ? '#FFFDF5' : '#F2FAFF';
  const guardTop = isGold ? '#F3CE72' : '#B7DED5';
  const guardBot = isGold ? '#9A6C21' : '#3E7B6E';
  const guardStroke = isGold ? '#5D3C0E' : '#1E453D';
  const cordA = isGold ? '#7C1A15' : '#5C1818';
  const cordB = isGold ? '#A8261E' : '#852424';
  const tasselColor = isGold ? '#C72C22' : '#B82C26';

  // Local coordinates: tip at (0, -320), guard at (0, 120), pommel at (0, 240)
  // Total blade+hilt length ~ 560 units (62% of 1050 board width ~ 650 units at scale 1.15)
  return `
    <linearGradient id="${id}-blade" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${bladeBot}"/>
      <stop offset="32%" stop-color="${bladeMid}"/>
      <stop offset="50%" stop-color="${bladeTop}"/>
      <stop offset="68%" stop-color="${bladeMid}"/>
      <stop offset="100%" stop-color="${bladeBot}"/>
    </linearGradient>
    <linearGradient id="${id}-guard" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${guardTop}"/>
      <stop offset="100%" stop-color="${guardBot}"/>
    </linearGradient>
    <symbol id="${id}" viewBox="-90 -340 180 680" overflow="visible">
      <!-- Tapered double-edged blade -->
      <polygon points="0,-325 18,-260 24,115 -24,115 -18,-260"
        fill="url(#${id}-blade)" stroke="${bladeBot}" stroke-width="1.5" stroke-linejoin="round"/>
      <!-- Central ridge highlight -->
      <line x1="0" y1="-320" x2="0" y2="112" stroke="${ridgeColor}" stroke-width="2.4" opacity="0.88"/>
      <!-- Fuller groove -->
      <line x1="0" y1="-220" x2="0" y2="95" stroke="${bladeBot}" stroke-width="1.1" opacity="0.45"/>
      <!-- Edge bevels -->
      <polyline points="-17,-255 -22,112" fill="none" stroke="${ridgeColor}" stroke-width="1" opacity="0.45"/>
      <polyline points="17,-255 22,112" fill="none" stroke="${ridgeColor}" stroke-width="1" opacity="0.35"/>

      <!-- Crossguard (rounded diamond) -->
      <path d="M -56,118 Q -28,100 0,94 Q 28,100 56,118 Q 28,136 0,140 Q -28,136 -56,118 Z"
        fill="url(#${id}-guard)" stroke="${guardStroke}" stroke-width="2"/>
      <path d="M -38,118 Q 0,108 38,118" fill="none" stroke="${ridgeColor}" stroke-width="1.4" opacity="0.6"/>
      <circle cx="0" cy="118" r="5" fill="${guardStroke}" opacity="0.55"/>

      <!-- Grip with dark-red cord wrapping -->
      <rect x="-11" y="138" width="22" height="96" rx="4" fill="${cordA}" stroke="#2B0B08" stroke-width="1.5"/>
      <g stroke="${cordB}" stroke-width="3.2" stroke-linecap="round">
        <line x1="-10" y1="148" x2="10" y2="156"/>
        <line x1="-10" y1="162" x2="10" y2="170"/>
        <line x1="-10" y1="176" x2="10" y2="184"/>
        <line x1="-10" y1="190" x2="10" y2="198"/>
        <line x1="-10" y1="204" x2="10" y2="212"/>
        <line x1="-10" y1="218" x2="10" y2="226"/>
      </g>

      <!-- Pommel disc -->
      <circle cx="0" cy="244" r="16" fill="url(#${id}-guard)" stroke="${guardStroke}" stroke-width="2"/>
      <circle cx="0" cy="244" r="7" fill="none" stroke="${ridgeColor}" stroke-width="1.2" opacity="0.65"/>

      <!-- Two-strand red tassel -->
      <g class="sword-tassel" transform="translate(0 260)">
        <circle cx="0" cy="3" r="4.5" fill="${tasselColor}"/>
        <path d="M -1,6 Q -10,34 -5,64" fill="none" stroke="${tasselColor}" stroke-width="4" stroke-linecap="round"/>
        <path d="M 2,6 Q 11,36 7,68" fill="none" stroke="${cordA}" stroke-width="3.2" stroke-linecap="round"/>
      </g>
    </symbol>
  `;
}

/**
 * Build shared <defs> for end-of-game SVG overlays:
 * - #fx-jian-gold (warm gold-bronze fittings)
 * - #fx-jian-jade (cooler silver-jade fittings)
 * - #fx-sword-shadow (soft drop shadow)
 * - #fx-seal-rough (rough ink stamp displacement)
 * - #fx-tear-filter (subtle vertical tear distortion for defeat glyph)
 */
export function buildFxSvgDefs() {
  return `
    ${buildSingleSwordSymbol('fx-jian-gold', 'gold')}
    ${buildSingleSwordSymbol('fx-jian-jade', 'jade')}
    <filter id="fx-sword-shadow" x="-30%" y="-20%" width="160%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="7" flood-color="#000000" flood-opacity="0.52"/>
    </filter>
    <filter id="fx-seal-rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="11" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.8" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="fx-tear-filter" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="turbulence" baseFrequency="0.015 0.08" numOctaves="2" seed="5" result="tnoise"/>
      <feDisplacementMap class="fx-tear-disp" in="SourceGraphic" in2="tnoise" scale="0" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <linearGradient id="fx-win-red-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFE7A0"/>
      <stop offset="48%" stop-color="#E85A3A"/>
      <stop offset="100%" stop-color="#A61C16"/>
    </linearGradient>
    <linearGradient id="fx-win-black-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4A4A48"/>
      <stop offset="55%" stop-color="#1E1E1D"/>
      <stop offset="100%" stop-color="#0D0D0C"/>
    </linearGradient>
    <linearGradient id="fx-lose-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#C8B9B2"/>
      <stop offset="55%" stop-color="#8B403A"/>
      <stop offset="100%" stop-color="#4E1D1B"/>
    </linearGradient>
    <linearGradient id="fx-draw-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#B9D2D8"/>
    </linearGradient>
  `;
}

/**
 * Compute a deterministic waving white flag SVG path for resign cinematic.
 * @param {number} phase radians
 * @returns {string}
 */
export function buildFlagClothPath(phase) {
  const w1 = Math.sin(phase) * 14;
  const w2 = Math.cos(phase + 0.9) * 18;
  const w3 = Math.sin(phase + 1.8) * 12;
  return `M 0,0 C 75,${(-18 + w1).toFixed(1)} 145,${(22 + w2).toFixed(1)} 230,${(-8 + w3).toFixed(1)} ` +
    `L 222,${(122 + w3).toFixed(1)} ` +
    `C 145,${(152 + w2).toFixed(1)} 75,${(110 + w1).toFixed(1)} 0,132 Z`;
}
