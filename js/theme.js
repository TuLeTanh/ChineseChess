/**
 * @typedef {Object} Theme
 * @property {string} id
 * @property {string} name
 * @property {Object} board
 * @property {Object} piece
 * @property {Object} ui
 */

/** @type {Theme} */
export const THEME_GO_LIM = {
  id: 'go-lim',
  name: 'Gỗ Lim',
  board: {
    frameTop: '#6B4226',
    frameBottom: '#4A2B17',
    bevelLight: '#8A5A35',
    bevelDark: '#2F1A0D',
    surfaceTop: '#D9A55F',
    surfaceMid: '#C4883F',
    surfaceBottom: '#D19A52',
    grainOpacity: 0.28,
    grainFreqX: 0.010,
    grainFreqY: 0.22,
    grainSeed: 7,
    grainMatrix: '0 0 0 0 0.353  0 0 0 0 0.208  0 0 0 0 0.071  0 0 0 1 0',
    plankOpacity: 0.14,
    plankFreqX: 0.004,
    plankFreqY: 0.05,
    plankSeed: 19,
    lampLightOpacity: 0.10,
    vignetteOpacity: 0.14,
    surfaceInnerStroke: '#B07A3C',
    surfaceInnerStrokeOpacity: 0.6,
    lineColor: '#3B2314',
    riverTextFill: '#3B2314',
    riverTextOpacity: 0.85,
    riverShadowFill: '#F3D9A4',
    riverShadowOpacity: 0.6,
    labelFill: '#5A3A1E',
    labelOpacity: 0.8,
  },
  piece: {
    shadowOpacity: 0.50,
    shadowBlur: 3.9,
    shadowOffsetY: 1.0,
    ringStrokeWidth: 3.4,
    red: {
      sideTop: '#B58446',
      sideBottom: '#8A5C2B',
      faceStops: [
        { offset: '0%', color: '#FBEFD2' },
        { offset: '55%', color: '#EFD6A3' },
        { offset: '85%', color: '#D8B57A' },
        { offset: '100%', color: '#C99E5B' },
      ],
      rimStroke: '#7A4E22',
      bevelLight: '#FFF8E6',
      bevelLightOpacity: 0.9,
      bevelDark: '#9B6B34',
      bevelDarkOpacity: 0.85,
      ringColor: '#B3261E',
      ringHighlight: '#FFF3D6',
      ringHighlightOpacity: 0.85,
      glyphColor: '#B3261E',
      glyphHighlight: '#FFF6DF',
      glyphHighlightOpacity: 0.85,
      glossOpacity: 0.28,
    },
    black: {
      sideTop: '#B58446',
      sideBottom: '#8A5C2B',
      faceStops: [
        { offset: '0%', color: '#FBEFD2' },
        { offset: '55%', color: '#EFD6A3' },
        { offset: '85%', color: '#D8B57A' },
        { offset: '100%', color: '#C99E5B' },
      ],
      rimStroke: '#7A4E22',
      bevelLight: '#FFF8E6',
      bevelLightOpacity: 0.9,
      bevelDark: '#9B6B34',
      bevelDarkOpacity: 0.85,
      ringColor: '#1B1A19',
      ringHighlight: '#FFF3D6',
      ringHighlightOpacity: 0.85,
      glyphColor: '#1B1A19',
      glyphHighlight: '#FFF6DF',
      glyphHighlightOpacity: 0.85,
      glossOpacity: 0.28,
    },
  },
  ui: {
    bgCenter: '#2A211B',
    bgEdge: '#14100D',
    panelBg: '#231C17',
    panelBorder: '#3A2D24',
    textPrimary: '#EADBC4',
    textMuted: '#9C8A74',
    accentGold: '#D9A441',
    danger: '#C0392B',
    btnBg: '#3A2D24',
    btnHover: '#4A382C',
    fxAccent: '#F2C14E',
    fxAccent2: '#E07A3F',
    fxDim: 'rgba(18, 11, 6, 0.58)',
    fxDrawAccent: '#C9D8DE',
  },
};

/** @type {Theme} */
export const THEME_NGOC_BICH = {
  id: 'ngoc-bich',
  name: 'Ngọc Bích',
  board: {
    frameTop: '#19302A',
    frameBottom: '#12231F',
    bevelLight: '#2E564C',
    bevelDark: '#0A1512',
    surfaceTop: '#1F3B36',
    surfaceMid: '#264840',
    surfaceBottom: '#2B5148',
    grainOpacity: 0.12,
    grainFreqX: 0.015,
    grainFreqY: 0.18,
    grainSeed: 11,
    grainMatrix: '0 0 0 0 0.07  0 0 0 0 0.16  0 0 0 0 0.14  0 0 0 1 0',
    plankOpacity: 0,
    lampLightOpacity: 0,
    vignetteOpacity: 0.18,
    surfaceInnerStroke: '#4D7D6F',
    surfaceInnerStrokeOpacity: 0.5,
    lineColor: '#A9C8BC',
    riverTextFill: '#C9E0D6',
    riverTextOpacity: 1.0,
    riverShadowFill: '#0D1C19',
    riverShadowOpacity: 0.55,
    labelFill: '#A9C8BC',
    labelOpacity: 0.78,
  },
  piece: {
    shadowOpacity: 0.48,
    shadowBlur: 3.9,
    shadowOffsetY: 0,
    ringStrokeWidth: 3,
    red: {
      sideTop: '#6E1610',
      sideBottom: '#470D09',
      faceStops: [
        { offset: '0%', color: '#C7352B' },
        { offset: '45%', color: '#B3261E' },
        { offset: '82%', color: '#911D16' },
        { offset: '100%', color: '#7D1812' },
      ],
      rimStroke: '#4A0E0A',
      bevelLight: '#F6D88B',
      bevelLightOpacity: 0.55,
      bevelDark: '#3D0A07',
      bevelDarkOpacity: 0.8,
      ringColor: '#F6D88B',
      ringHighlight: '#5A100B',
      ringHighlightOpacity: 0.55,
      glyphColor: '#F6D88B',
      glyphHighlight: '#5A100B',
      glyphHighlightOpacity: 0.55,
      glossOpacity: 0.24,
    },
    black: {
      sideTop: '#1D2225',
      sideBottom: '#0C0F11',
      faceStops: [
        { offset: '0%', color: '#394145' },
        { offset: '48%', color: '#2A3033' },
        { offset: '84%', color: '#1B2023' },
        { offset: '100%', color: '#14191B' },
      ],
      rimStroke: '#090C0D',
      bevelLight: '#EDEBE4',
      bevelLightOpacity: 0.42,
      bevelDark: '#07090A',
      bevelDarkOpacity: 0.85,
      ringColor: '#EDEBE4',
      ringHighlight: '#0A0D0E',
      ringHighlightOpacity: 0.65,
      glyphColor: '#EDEBE4',
      glyphHighlight: '#0A0D0E',
      glyphHighlightOpacity: 0.65,
      glossOpacity: 0.22,
    },
  },
  ui: {
    bgCenter: '#182422',
    bgEdge: '#0D1413',
    panelBg: '#162220',
    panelBorder: '#283D39',
    textPrimary: '#EADBC4',
    textMuted: '#93ABA3',
    accentGold: '#D9A441',
    danger: '#C0392B',
    btnBg: '#233632',
    btnHover: '#2E4742',
    fxAccent: '#5EEAD4',
    fxAccent2: '#D9A441',
    fxDim: 'rgba(7, 16, 14, 0.62)',
    fxDrawAccent: '#99F6E4',
  },
};

/** @type {Theme[]} */
export const THEMES = [THEME_GO_LIM, THEME_NGOC_BICH];

/**
 * Look up a theme by id, defaulting to Gỗ Lim.
 * @param {string} id
 * @returns {Theme}
 */
export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEME_GO_LIM;
}

/**
 * Return the next theme in the preset cycle.
 * @param {string} currentId
 * @returns {Theme}
 */
export function nextTheme(currentId) {
  const idx = THEMES.findIndex((t) => t.id === currentId);
  return THEMES[(idx + 1) % THEMES.length];
}
