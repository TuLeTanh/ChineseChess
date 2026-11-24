/**
 * Board SVG generator following DESIGN.md section 5.
 * ViewBox: 0 0 1050 1150, grid origin (125, 125), cell = 100.
 */

export const BOARD_WIDTH = 1050;
export const BOARD_HEIGHT = 1150;
export const GRID_ORIGIN_X = 125;
export const GRID_ORIGIN_Y = 125;
export const CELL_SIZE = 100;

const RED_FILE_LABELS = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
const BLACK_FILE_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const MARK_POINTS = [
  // Cannons
  [1, 2], [7, 2], [1, 7], [7, 7],
  // Soldiers
  [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
  [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
];

/**
 * Build L-shaped corner ticks around a cannon/soldier intersection.
 * @param {number} i - File 0..8
 * @param {number} j - Rank 0..9
 * @returns {string}
 */
function buildPositionMark(i, j) {
  const cx = GRID_ORIGIN_X + i * CELL_SIZE;
  const cy = GRID_ORIGIN_Y + j * CELL_SIZE;
  const gap = 9;
  const arm = 20;
  const paths = [];

  const drawLeft = i > 0;
  const drawRight = i < 8;

  if (drawLeft) {
    // Top-left
    paths.push(`M ${cx - gap - arm} ${cy - gap} H ${cx - gap} V ${cy - gap - arm}`);
    // Bottom-left
    paths.push(`M ${cx - gap - arm} ${cy + gap} H ${cx - gap} V ${cy + gap + arm}`);
  }
  if (drawRight) {
    // Top-right
    paths.push(`M ${cx + gap + arm} ${cy - gap} H ${cx + gap} V ${cy - gap - arm}`);
    // Bottom-right
    paths.push(`M ${cx + gap + arm} ${cy + gap} H ${cx + gap} V ${cy + gap + arm}`);
  }
  return paths.join(' ');
}

/**
 * Generate the inner SVG markup (<defs> + 6 board layers) for the given theme.
 * @param {import('../theme.js').Theme} theme
 * @param {string} [idPrefix]
 * @returns {string}
 */
export function buildBoardInnerSvg(theme, idPrefix = 'board') {
  const b = theme.board;
  const p = `${idPrefix}-${theme.id}`;

  const defs = `
    <defs>
      <linearGradient id="${p}-frame-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${b.frameTop}"/>
        <stop offset="100%" stop-color="${b.frameBottom}"/>
      </linearGradient>

      <linearGradient id="${p}-surface-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${b.surfaceTop}"/>
        <stop offset="50%" stop-color="${b.surfaceMid}"/>
        <stop offset="100%" stop-color="${b.surfaceBottom}"/>
      </linearGradient>

      <radialGradient id="${p}-vignette" cx="50%" cy="42%" r="72%">
        <stop offset="45%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="${b.vignetteOpacity}"/>
      </radialGradient>

      <radialGradient id="${p}-lamp" cx="50%" cy="42%" r="70%">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="${b.lampLightOpacity || 0}"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>

      <filter id="${p}-wood-grain" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="${b.grainFreqX} ${b.grainFreqY}"
          numOctaves="3"
          seed="${b.grainSeed}"
          result="noise"/>
        <feColorMatrix
          type="matrix"
          values="${b.grainMatrix}"
          in="noise"
          result="colored"/>
      </filter>

      <filter id="${p}-plank-grain" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="${b.plankFreqX || 0.004} ${b.plankFreqY || 0.05}"
          numOctaves="2"
          seed="${b.plankSeed || 19}"
          result="pnoise"/>
        <feColorMatrix
          type="matrix"
          values="${b.grainMatrix}"
          in="pnoise"
          result="pcolored"/>
      </filter>

      <clipPath id="${p}-surface-clip">
        <rect x="35" y="35" width="980" height="1080" rx="14" ry="14"/>
      </clipPath>

      <clipPath id="${p}-frame-clip">
        <rect x="0" y="0" width="1050" height="1150" rx="28" ry="28"/>
      </clipPath>
    </defs>
  `;

  // Layer 1: Table-edge / frame with inner top-left light bevel and bottom-right dark bevel
  const layer1Frame = `
    <g class="board-layer-frame">
      <rect x="0" y="0" width="1050" height="1150" rx="28" ry="28" fill="url(#${p}-frame-grad)"/>
      <path d="M 1.5 1122 V 28 A 26.5 26.5 0 0 1 28 1.5 H 1022"
            fill="none" stroke="${b.bevelLight}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M 1048.5 28 V 1122 A 26.5 26.5 0 0 1 1022 1148.5 H 28"
            fill="none" stroke="${b.bevelDark}" stroke-width="1.5" stroke-linecap="round"/>
    </g>
  `;

  // Layer 2: Playing surface (base gradient, wood grain, plank variation, lamp falloff, vignette, inner stroke)
  const plankRect = b.plankOpacity > 0
    ? `<rect x="35" y="35" width="980" height="1080"
              filter="url(#${p}-plank-grain)"
              opacity="${b.plankOpacity}"
              style="mix-blend-mode: multiply;"/>`
    : '';
  const lampRect = b.lampLightOpacity > 0
    ? `<rect x="35" y="35" width="980" height="1080" fill="url(#${p}-lamp)"/>`
    : '';

  const layer2Surface = `
    <g class="board-layer-surface">
      <rect x="35" y="35" width="980" height="1080" rx="14" ry="14" fill="url(#${p}-surface-grad)"/>
      <g clip-path="url(#${p}-surface-clip)">
        <rect x="35" y="35" width="980" height="1080"
              filter="url(#${p}-wood-grain)"
              opacity="${b.grainOpacity}"
              style="mix-blend-mode: multiply;"/>
        ${plankRect}
        ${lampRect}
        <rect x="35" y="35" width="980" height="1080" fill="url(#${p}-vignette)"/>
      </g>
      <rect x="35.5" y="35.5" width="979" height="1079" rx="13.5" ry="13.5"
            fill="none" stroke="${b.surfaceInnerStroke}" stroke-width="1" stroke-opacity="${b.surfaceInnerStrokeOpacity}"/>
    </g>
  `;

  // Layer 3: Grid lines
  const hLines = [];
  for (let j = 0; j < 10; j++) {
    const y = GRID_ORIGIN_Y + j * CELL_SIZE;
    hLines.push(`<line x1="125" y1="${y}" x2="925" y2="${y}"/>`);
  }

  const vLines = [];
  for (let i = 1; i <= 7; i++) {
    const x = GRID_ORIGIN_X + i * CELL_SIZE;
    vLines.push(`<line x1="${x}" y1="125" x2="${x}" y2="525"/>`);
    vLines.push(`<line x1="${x}" y1="625" x2="${x}" y2="1025"/>`);
  }

  const palaceLines = [
    [3, 0, 5, 2],
    [5, 0, 3, 2],
    [3, 7, 5, 9],
    [5, 7, 3, 9],
  ].map(([x1, y1, x2, y2]) => {
    const px1 = GRID_ORIGIN_X + x1 * CELL_SIZE;
    const py1 = GRID_ORIGIN_Y + y1 * CELL_SIZE;
    const px2 = GRID_ORIGIN_X + x2 * CELL_SIZE;
    const py2 = GRID_ORIGIN_Y + y2 * CELL_SIZE;
    return `<line x1="${px1}" y1="${py1}" x2="${px2}" y2="${py2}"/>`;
  });

  const layer3Grid = `
    <g class="board-layer-grid" stroke="${b.lineColor}" fill="none" stroke-linecap="round">
      <rect x="113" y="113" width="824" height="924" stroke-width="1.6"/>
      <rect x="125" y="125" width="800" height="900" stroke-width="4.5"/>
      <g stroke-width="2.2">
        ${hLines.join('\n        ')}
        ${vLines.join('\n        ')}
        ${palaceLines.join('\n        ')}
      </g>
    </g>
  `;

  // Layer 4: Position marks (cannon & soldier ticks)
  const markPathData = MARK_POINTS.map(([i, j]) => buildPositionMark(i, j)).join(' ');
  const layer4Marks = `
    <g class="board-layer-marks">
      <path d="${markPathData}" fill="none" stroke="${b.lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  `;

  // Layer 5: River text (楚河 at x=325, 漢界 at x=725 rotated 180°, y=575)
  // Place characters with exact ±41 spacing (54px font + 28px letter-spacing => 82px center-to-center)
  // so centering is pixel-exact across browsers.
  const riverY = 575;
  const layer5River = `
    <g class="board-layer-river"
       font-family="var(--font-board)"
       font-size="54"
       font-weight="400"
       text-anchor="middle"
       dominant-baseline="central">
      <g>
        <text x="284.8" y="${riverY + 0.8}" fill="${b.riverShadowFill}" opacity="${b.riverShadowOpacity}">楚</text>
        <text x="366.8" y="${riverY + 0.8}" fill="${b.riverShadowFill}" opacity="${b.riverShadowOpacity}">河</text>
        <text x="284" y="${riverY}" fill="${b.riverTextFill}" opacity="${b.riverTextOpacity}">楚</text>
        <text x="366" y="${riverY}" fill="${b.riverTextFill}" opacity="${b.riverTextOpacity}">河</text>
      </g>
      <g transform="rotate(180 725 575)">
        <text x="684.8" y="${riverY + 0.8}" fill="${b.riverShadowFill}" opacity="${b.riverShadowOpacity}">漢</text>
        <text x="766.8" y="${riverY + 0.8}" fill="${b.riverShadowFill}" opacity="${b.riverShadowOpacity}">界</text>
        <text x="684" y="${riverY}" fill="${b.riverTextFill}" opacity="${b.riverTextOpacity}">漢</text>
        <text x="766" y="${riverY}" fill="${b.riverTextFill}" opacity="${b.riverTextOpacity}">界</text>
      </g>
    </g>
  `;

  // Layer 6: File labels (positioned at y=60 and y=1093, font-size 26 so back-rank r=44 pieces never overlap them)
  const bottomLabels = RED_FILE_LABELS.map((ch, i) => {
    const x = GRID_ORIGIN_X + i * CELL_SIZE;
    return `<text x="${x}" y="1093">${ch}</text>`;
  }).join('\n      ');

  const topLabels = BLACK_FILE_LABELS.map((ch, i) => {
    const x = GRID_ORIGIN_X + i * CELL_SIZE;
    return `<text x="${x}" y="60" transform="rotate(180 ${x} 60)">${ch}</text>`;
  }).join('\n      ');

  const layer6Labels = `
    <g class="board-layer-labels"
       font-family="var(--font-board)"
       font-size="26"
       font-weight="400"
       fill="${b.labelFill}"
       opacity="${b.labelOpacity}"
       text-anchor="middle"
       dominant-baseline="central">
      ${bottomLabels}
      ${topLabels}
    </g>
  `;

  return `${defs}${layer1Frame}${layer2Surface}${layer3Grid}${layer4Marks}${layer5River}${layer6Labels}`;
}

/**
 * Generate a complete standalone board SVG string.
 * @param {import('../theme.js').Theme} theme
 * @param {string} [idPrefix]
 * @returns {string}
 */
export function renderBoardSvg(theme, idPrefix = 'board') {
  return `<svg class="board-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" role="img" aria-label="Bàn cờ tướng">
    ${buildBoardInnerSvg(theme, idPrefix)}
  </svg>`;
}
