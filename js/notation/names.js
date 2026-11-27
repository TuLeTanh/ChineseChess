/**
 * Vietnamese traditional Xiangqi notation constants (single place to customize).
 */
export const PIECE_NAMES = {
  general: 'Tướng',
  advisor: 'Sĩ',
  elephant: 'Tượng',
  chariot: 'Xe',
  cannon: 'Pháo',
  horse: 'Mã',
  soldier: 'Tốt',
};

export const DIRECTION_WORDS = {
  advance: 'tiến',
  retreat: 'thoái',
  traverse: 'bình',
};

export const DIRECTION_SYMBOLS = {
  advance: '+',
  retreat: '\u2212', // real minus sign U+2212
  traverse: '=',
};

export const POSITION_WORDS = {
  2: ['trước', 'sau'],
  3: ['trước', 'giữa', 'sau'],
  4: ['trước', 'thứ hai', 'thứ ba', 'sau'],
  5: ['trước', 'thứ hai', 'giữa', 'thứ tư', 'sau'],
};
