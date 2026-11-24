/**
 * Piece SVG generator following DESIGN.md section 6.
 * ViewBox: 0 0 120 120, disc centre (60, 56), radius 44.
 * Generates reusable <defs> + <symbol> elements for fast <use> instancing.
 */

export const PIECE_KINDS = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
];

export const PIECE_SIDES = ['red', 'black'];

/** Exact traditional characters from DESIGN.md section 6. */
export const PIECE_GLYPHS = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

/**
 * Return the symbol ID for a given piece and theme.
 * @param {string} themeId
 * @param {'red'|'black'} side
 * @param {string} kind
 * @param {string} [prefix]
 * @returns {string}
 */
export function pieceSymbolId(themeId, side, kind, prefix = 'xq') {
  return `${prefix}-${themeId}-${side}-${kind}`;
}

/**
 * Build shared gradient/filter <defs> for a theme's pieces.
 * @param {import('../theme.js').Theme} theme
 * @param {string} [prefix]
 * @returns {string}
 */
export function buildPieceSharedDefs(theme, prefix = 'xq') {
  const p = `${prefix}-${theme.id}`;
  const pc = theme.piece;

  const sideDefs = PIECE_SIDES.map((side) => {
    const s = pc[side];
    const stops = s.faceStops
      .map((st) => `<stop offset="${st.offset}" stop-color="${st.color}"/>`)
      .join('\n        ');
    return `
      <linearGradient id="${p}-${side}-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.sideTop}"/>
        <stop offset="100%" stop-color="${s.sideBottom}"/>
      </linearGradient>
      <radialGradient id="${p}-${side}-face" cx="50%" cy="50%" fx="42%" fy="32%" r="75%">
        ${stops}
      </radialGradient>
      <linearGradient id="${p}-${side}-bevel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${s.bevelLight}" stop-opacity="${s.bevelLightOpacity}"/>
        <stop offset="50%" stop-color="${s.bevelLight}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${s.bevelDark}" stop-opacity="${s.bevelDarkOpacity}"/>
      </linearGradient>
      <linearGradient id="${p}-${side}-gloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="${s.glossOpacity}"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    `;
  }).join('');

  return `
    <filter id="${p}-piece-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${pc.shadowBlur}"/>
    </filter>
    <filter id="${p}-piece-shadow-lifted" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${(pc.shadowBlur * 1.4).toFixed(2)}"/>
    </filter>
    ${sideDefs}
  `;
}

/**
 * Build the 7 layers of a single piece inside a <g> or <symbol>.
 * @param {'red'|'black'} side
 * @param {string} kind
 * @param {import('../theme.js').Theme} theme
 * @param {string} [prefix]
 * @param {boolean} [includeShadow]
 * @returns {string}
 */
export function buildPieceLayers(side, kind, theme, prefix = 'xq', includeShadow = true) {
  const p = `${prefix}-${theme.id}`;
  const s = theme.piece[side];
  const glyph = PIECE_GLYPHS[side][kind];

  const shadowY = 66.8 + (theme.piece.shadowOffsetY || 0);
  const ringStroke = theme.piece.ringStrokeWidth || 3;
  const shadowLayer = includeShadow
    ? `<ellipse cx="61.2" cy="${shadowY}" rx="42" ry="40" fill="#000000" opacity="${theme.piece.shadowOpacity}" filter="url(#${p}-piece-shadow)"/>`
    : '';

  return `
    ${shadowLayer}
    <!-- Layer 2: Thickness (turned side wall) -->
    <circle cx="60" cy="61" r="44" fill="url(#${p}-${side}-wall)"/>
    <!-- Layer 3: Face -->
    <circle cx="60" cy="56" r="44" fill="url(#${p}-${side}-face)" stroke="${s.rimStroke}" stroke-width="1.4"/>
    <!-- Layer 4: Bevel -->
    <circle cx="60" cy="56" r="42.2" fill="none" stroke="url(#${p}-${side}-bevel)" stroke-width="2.2"/>
    <!-- Layer 5: Engraved rings -->
    <circle cx="60.3" cy="57.1" r="35" fill="none" stroke="${s.ringHighlight}" stroke-opacity="${s.ringHighlightOpacity}" stroke-width="1.2"/>
    <circle cx="60" cy="56" r="35" fill="none" stroke="${s.ringColor}" stroke-width="${ringStroke}"/>
    <circle cx="60" cy="56" r="31.5" fill="none" stroke="${s.ringColor}" stroke-opacity="0.72" stroke-width="1"/>
    <!-- Layer 6: Engraved character -->
    <text x="60.5" y="56.3"
          font-family="var(--font-board)"
          font-size="46"
          font-weight="400"
          text-anchor="middle"
          dominant-baseline="central"
          fill="${s.glyphHighlight}"
          stroke="${s.glyphHighlight}"
          stroke-width="0.75"
          stroke-linejoin="round"
          paint-order="stroke fill"
          opacity="${s.glyphHighlightOpacity}">${glyph}</text>
    <text x="60" y="55.4"
          font-family="var(--font-board)"
          font-size="46"
          font-weight="400"
          text-anchor="middle"
          dominant-baseline="central"
          fill="${s.glyphColor}"
          stroke="${s.glyphColor}"
          stroke-width="0.75"
          stroke-linejoin="round"
          paint-order="stroke fill">${glyph}</text>
    <!-- Layer 7: Gloss -->
    <ellipse cx="49" cy="35.5" rx="23" ry="12.5"
             transform="rotate(-25 49 35.5)"
             fill="url(#${p}-${side}-gloss)"
             pointer-events="none"/>
  `;
}

/**
 * Build a <defs> block containing shared gradients/filters plus all 14 piece <symbol>s.
 * @param {import('../theme.js').Theme} theme
 * @param {string} [prefix]
 * @returns {string}
 */
export function buildPieceSymbolsDefs(theme, prefix = 'xq') {
  const symbols = [];
  for (const side of PIECE_SIDES) {
    for (const kind of PIECE_KINDS) {
      const id = pieceSymbolId(theme.id, side, kind, prefix);
      symbols.push(`
        <symbol id="${id}" viewBox="0 0 120 120" overflow="visible">
          ${buildPieceLayers(side, kind, theme, prefix, true)}
        </symbol>
      `);
    }
  }
  return `
    <defs>
      ${buildPieceSharedDefs(theme, prefix)}
      ${symbols.join('')}
    </defs>
  `;
}

/**
 * Render a standalone SVG string for one piece (useful for gallery/icons).
 * @param {string} kind
 * @param {'red'|'black'} side
 * @param {import('../theme.js').Theme} theme
 * @param {number} [sizePx]
 * @param {string} [prefix]
 * @returns {string}
 */
export function pieceSvg(kind, side, theme, sizePx = 120, prefix = 'solo') {
  const unique = `${prefix}-${side}-${kind}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 120 120" overflow="visible" role="img" aria-label="${PIECE_GLYPHS[side][kind]}">
    <defs>${buildPieceSharedDefs(theme, unique)}</defs>
    ${buildPieceLayers(side, kind, theme, unique, true)}
  </svg>`;
}

/**
 * Render a 7x2 sheet of all 14 pieces on a neutral #CFC7BA background.
 * @param {import('../theme.js').Theme} theme
 * @param {number} cellPx
 * @param {string} [className]
 * @returns {string}
 */
export function renderPiecesSheetSvg(theme, cellPx = 240, className = 'preview-pieces-sheet') {
  const cols = 7;
  const rows = 2;
  const pad = Math.round(cellPx * 0.12);
  const w = cols * cellPx + pad * 2;
  const h = rows * cellPx + pad * 2;
  const prefix = `sheet-${cellPx}`;

  const uses = [];
  PIECE_SIDES.forEach((side, r) => {
    PIECE_KINDS.forEach((kind, c) => {
      const x = pad + c * cellPx;
      const y = pad + r * cellPx;
      const id = pieceSymbolId(theme.id, side, kind, prefix);
      uses.push(`<use href="#${id}" x="${x}" y="${y}" width="${cellPx}" height="${cellPx}"/>`);
    });
  });

  return `<div class="${className}" style="width:${w}px;height:${h}px;background:#CFC7BA;">
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${buildPieceSymbolsDefs(theme, prefix)}
      <rect x="0" y="0" width="${w}" height="${h}" fill="#CFC7BA"/>
      ${uses.join('\n      ')}
    </svg>
  </div>`;
}

/**
 * Render the ?gallery view showing all 14 pieces at 64, 88, 140 px
 * on board-wood colour and on neutral grey.
 * @param {import('../theme.js').Theme} theme
 * @returns {string}
 */
export function renderGalleryHtml(theme) {
  const sizes = [64, 88, 140];
  const swatches = [
    { label: 'Mặt gỗ bàn cờ (#CE9650)', bg: theme.board.surfaceMid },
    { label: 'Nền xám trung tính (#CFC7BA)', bg: '#CFC7BA' },
  ];
  const prefix = 'gallery';

  const hiddenDefs = `<svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
    ${buildPieceSymbolsDefs(theme, prefix)}
  </svg>`;

  const sections = swatches.map((sw) => {
    const rows = sizes.map((sz) => {
      const items = [];
      for (const side of PIECE_SIDES) {
        for (const kind of PIECE_KINDS) {
          const id = pieceSymbolId(theme.id, side, kind, prefix);
          items.push(`<svg width="${sz}" height="${sz}" viewBox="0 0 120 120" overflow="visible"><use href="#${id}" width="120" height="120"/></svg>`);
        }
      }
      return `
        <div class="gallery-size-block">
          <div class="gallery-size-label">${sz} px</div>
          <div class="gallery-grid" style="background:${sw.bg};">
            ${items.join('')}
          </div>
        </div>
      `;
    }).join('');
    return `
      <section class="gallery-section">
        <h2>${sw.label}</h2>
        ${rows}
      </section>
    `;
  }).join('');

  return `${hiddenDefs}<div class="gallery-root"><h1>Thư viện 14 quân cờ — ${theme.name}</h1>${sections}</div>`;
}
