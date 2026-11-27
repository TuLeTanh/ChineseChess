import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../../js/model/board.js';
import { START_FEN } from '../../js/model/fen.js';
import { XiangqiRules } from '../../js/rules.js';
import { JieqiBoard, JieqiRules, makeSeededRng } from '../../js/jieqi/rules.js';
import { moveToIccs } from '../../js/model/moves.js';
import {
  moveToTraditional,
  parseTraditional,
  formatLine,
  TRADITIONAL_FULL_RE,
} from '../../js/notation/traditional.js';

const FILES = 'abcdefghi';
const rules = new XiangqiRules();
const jqRules = new JieqiRules();

function allLegalIccs(board, ruleSet) {
  const out = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board.at({ x, y });
      if (!p || p.side !== board.sideToMove) continue;
      for (const to of ruleSet.legalMoves(board, { x, y })) {
        out.push(moveToIccs({ x, y }, to));
      }
    }
  }
  return out;
}

function applyIccs(board, iccs) {
  const from = { x: FILES.indexOf(iccs[0]), y: 9 - Number(iccs[1]) };
  const to = { x: FILES.indexOf(iccs[2]), y: 9 - Number(iccs[3]) };
  return board.applyMove(from, to);
}

function rotateFen180SwapColors(fen) {
  const parts = fen.split(' ');
  const rows = parts[0].split('/').reverse().map((row) =>
    row
      .split('')
      .reverse()
      .map((ch) => {
        if (ch >= 'A' && ch <= 'Z') return ch.toLowerCase();
        if (ch >= 'a' && ch <= 'z') return ch.toUpperCase();
        return ch;
      })
      .join('')
  );
  const side = parts[1] === 'w' ? 'b' : 'w';
  return `${rows.join('/')} ${side} - - 0 1`;
}

function rotateIccs180(iccs) {
  const fx = 8 - FILES.indexOf(iccs[0]);
  const fy = 9 - Number(iccs[1]);
  const tx = 8 - FILES.indexOf(iccs[2]);
  const ty = 9 - Number(iccs[3]);
  // After 180 deg rotation: new (x, y) = (8 - oldX, 9 - oldY), rank = 9 - newY = oldRank?
  // Wait: old rank r = Number(iccs[1]) = 9 - oldY. New rank = 9 - (9 - oldY) = oldY = 9 - r!
  return `${FILES[fx]}${9 - Number(iccs[1])}${FILES[tx]}${9 - Number(iccs[3])}`;
}

test('1. Golden table from standard start position (Red & Black, full + short)', () => {
  const startRed = Board.fromFen(START_FEN);
  const redGolden = [
    ['h2e2', 'Pháo 2 bình 5', 'Pháo 2=5'],
    ['b2e2', 'Pháo 8 bình 5', 'Pháo 8=5'],
    ['b0c2', 'Mã 8 tiến 7', 'Mã 8+7'],
    ['h0g2', 'Mã 2 tiến 3', 'Mã 2+3'],
    ['h0i2', 'Mã 2 tiến 1', 'Mã 2+1'],
    ['c0e2', 'Tượng 7 tiến 5', 'Tượng 7+5'],
    ['g0e2', 'Tượng 3 tiến 5', 'Tượng 3+5'],
    ['d0e1', 'Sĩ 6 tiến 5', 'Sĩ 6+5'],
    ['f0e1', 'Sĩ 4 tiến 5', 'Sĩ 4+5'],
    ['e0e1', 'Tướng 5 tiến 1', 'Tướng 5+1'],
    ['a0a1', 'Xe 9 tiến 1', 'Xe 9+1'],
    ['i0i2', 'Xe 1 tiến 2', 'Xe 1+2'],
    ['e3e4', 'Tốt 5 tiến 1', 'Tốt 5+1'],
    ['a3a4', 'Tốt 9 tiến 1', 'Tốt 9+1'],
    ['i3i4', 'Tốt 1 tiến 1', 'Tốt 1+1'],
    ['h2h9', 'Pháo 2 tiến 7', 'Pháo 2+7'],
  ];
  for (const [mv, expFull, expShort] of redGolden) {
    const got = moveToTraditional(startRed, mv, { variant: 'xiangqi' });
    assert.equal(got.full, expFull, `Red ${mv} full`);
    assert.equal(got.short, expShort, `Red ${mv} short`);
    assert.equal(parseTraditional(startRed, expFull), mv, `parse full ${expFull}`);
    assert.equal(parseTraditional(startRed, expShort), mv, `parse short ${expShort}`);
  }

  const startBlack = Board.fromFen(START_FEN.replace(' w ', ' b '));
  const blackGolden = [
    ['h7e7', 'Pháo 8 bình 5', 'Pháo 8=5'],
    ['b7e7', 'Pháo 2 bình 5', 'Pháo 2=5'],
    ['h9g7', 'Mã 8 tiến 7', 'Mã 8+7'],
    ['b9c7', 'Mã 2 tiến 3', 'Mã 2+3'],
    ['e9e8', 'Tướng 5 tiến 1', 'Tướng 5+1'],
    ['a6a5', 'Tốt 1 tiến 1', 'Tốt 1+1'],
    ['i9i7', 'Xe 9 tiến 2', 'Xe 9+2'],
    ['b7b0', 'Pháo 2 tiến 7', 'Pháo 2+7'],
  ];
  for (const [mv, expFull, expShort] of blackGolden) {
    const got = moveToTraditional(startBlack, mv, { variant: 'xiangqi' });
    assert.equal(got.full, expFull, `Black ${mv} full`);
    assert.equal(got.short, expShort, `Black ${mv} short`);
    assert.equal(parseTraditional(startBlack, expFull), mv, `parse full ${expFull}`);
    assert.equal(parseTraditional(startBlack, expShort), mv, `parse short ${expShort}`);
  }
});

test('2. Thoái & Bình positions across all 7 piece types', () => {
  // Red Chariot at d5 (file 6), Red King d0, Black King e9
  const bRook = Board.fromFen('4k4/9/9/9/3R5/9/9/9/9/3K5 w - - 0 1');
  assert.equal(moveToTraditional(bRook, 'd5d2').full, 'Xe 6 thoái 3');
  assert.equal(moveToTraditional(bRook, 'd5d2').short, 'Xe 6\u22123');
  assert.equal(moveToTraditional(bRook, 'd5d8').full, 'Xe 6 tiến 3');
  assert.equal(moveToTraditional(bRook, 'd5a5').full, 'Xe 6 bình 9');
  assert.equal(moveToTraditional(bRook, 'd5e5').full, 'Xe 6 bình 5');

  // Red King at e1 (file 5): retreat to e0, traverse to d1/f1
  const bKing = Board.fromFen('3k5/9/9/9/9/9/9/9/4K4/9 w - - 0 1');
  assert.equal(moveToTraditional(bKing, 'e1e0').full, 'Tướng 5 thoái 1');
  assert.equal(moveToTraditional(bKing, 'e1d1').full, 'Tướng 5 bình 6');
  assert.equal(moveToTraditional(bKing, 'e1f1').full, 'Tướng 5 bình 4');

  // Red Cannon at c4 (file 7): retreat to c1, traverse to f4
  const bCannon = Board.fromFen('4k4/9/9/9/9/2C6/9/9/9/3K5 w - - 0 1');
  assert.equal(moveToTraditional(bCannon, 'c4c1').full, 'Pháo 7 thoái 3');
  assert.equal(moveToTraditional(bCannon, 'c4f4').full, 'Pháo 7 bình 4');

  // Red Horse at e4 (file 5): all 4 forward jumps + all 4 backward jumps -> destination file number
  const bHorse = Board.fromFen('3k5/9/9/9/9/4N4/9/9/9/5K3 w - - 0 1');
  const horseCases = [
    ['e4d6', 'Mã 5 tiến 6'],
    ['e4f6', 'Mã 5 tiến 4'],
    ['e4c5', 'Mã 5 tiến 7'],
    ['e4g5', 'Mã 5 tiến 3'],
    ['e4d2', 'Mã 5 thoái 6'],
    ['e4f2', 'Mã 5 thoái 4'],
    ['e4c3', 'Mã 5 thoái 7'],
    ['e4g3', 'Mã 5 thoái 3'],
  ];
  for (const [mv, exp] of horseCases) {
    assert.equal(moveToTraditional(bHorse, mv).full, exp, mv);
  }

  // Red Elephant at e2 (file 5): retreat to c0 (file 7) & g0 (file 3)
  const bEle = Board.fromFen('3k5/9/9/9/9/9/9/4B4/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(bEle, 'e2c0').full, 'Tượng 5 thoái 7');
  assert.equal(moveToTraditional(bEle, 'e2g0').full, 'Tượng 5 thoái 3');

  // Red Advisor at e1 (file 5): retreat to d0 (file 6) & f0 (file 4)
  const bAdv = Board.fromFen('3k5/9/9/9/9/9/9/9/4A4/4K4 w - - 0 1');
  assert.equal(moveToTraditional(bAdv, 'e1d0').full, 'Sĩ 5 thoái 6');
  assert.equal(moveToTraditional(bAdv, 'e1f0').full, 'Sĩ 5 thoái 4');

  // Red & Black crossed-river Soldiers: traverse sideways (bình), never thoái
  const bPawnR = Board.fromFen('3k5/9/9/4P4/9/9/9/9/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(bPawnR, 'e6d6').full, 'Tốt 5 bình 6');
  assert.equal(moveToTraditional(bPawnR, 'e6f6').full, 'Tốt 5 bình 4');
  assert.equal(moveToTraditional(bPawnR, 'e6e7').full, 'Tốt 5 tiến 1');

  const bPawnB = Board.fromFen('3k5/9/9/9/9/9/4p4/9/9/5K3 b - - 0 1');
  assert.equal(moveToTraditional(bPawnB, 'e3d3').full, 'Tốt 5 bình 4');
  assert.equal(moveToTraditional(bPawnB, 'e3f3').full, 'Tốt 5 bình 6');
  assert.equal(moveToTraditional(bPawnB, 'e3e2').full, 'Tốt 5 tiến 1');
});

test('3. Disambiguation: 2, 3, 4, 5 same-name pieces on one file + multi-file duplicates', () => {
  // Two Red Chariots on file d (ranks 5 and 3)
  const b2 = Board.fromFen('4k4/9/9/9/3R5/9/3R5/9/9/3K5 w - - 0 1');
  assert.equal(moveToTraditional(b2, 'd5d8').full, 'Xe trước tiến 3');
  assert.equal(moveToTraditional(b2, 'd5d8').short, 'Xe trước+3');
  assert.equal(moveToTraditional(b2, 'd3d1').full, 'Xe sau thoái 2');
  assert.equal(moveToTraditional(b2, 'd3d1').short, 'Xe sau\u22122');
  assert.equal(moveToTraditional(b2, 'd3d4').full, 'Xe sau tiến 1');
  assert.equal(moveToTraditional(b2, 'd5a5').full, 'Xe trước bình 9');

  // Black mirror gives identical strings
  const b2Blk = Board.fromFen(rotateFen180SwapColors('4k4/9/9/9/3R5/9/3R5/9/9/3K5 w - - 0 1'));
  assert.equal(moveToTraditional(b2Blk, rotateIccs180('d5d8')).full, 'Xe trước tiến 3');
  assert.equal(moveToTraditional(b2Blk, rotateIccs180('d3d1')).full, 'Xe sau thoái 2');

  // Three Red Soldiers on file e (ranks 7, 6, 5)
  const b3 = Board.fromFen('3k5/9/4P4/4P4/4P4/9/9/9/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(b3, 'e7d7').full, 'Tốt trước bình 6');
  assert.equal(moveToTraditional(b3, 'e6d6').full, 'Tốt giữa bình 6');
  assert.equal(moveToTraditional(b3, 'e5d5').full, 'Tốt sau bình 6');

  // Four Red Soldiers on file e (ranks 8, 7, 6, 5)
  const b4 = Board.fromFen('3k5/4P4/4P4/4P4/4P4/9/9/9/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(b4, 'e8d8').full, 'Tốt trước bình 6');
  assert.equal(moveToTraditional(b4, 'e7d7').full, 'Tốt thứ hai bình 6');
  assert.equal(moveToTraditional(b4, 'e6d6').full, 'Tốt thứ ba bình 6');
  assert.equal(moveToTraditional(b4, 'e5d5').full, 'Tốt sau bình 6');

  // Five Red Soldiers on file e (ranks 8, 7, 6, 5, 4)
  const b5 = Board.fromFen('3k5/4P4/4P4/4P4/4P4/4P4/9/9/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(b5, 'e8d8').full, 'Tốt trước bình 6');
  assert.equal(moveToTraditional(b5, 'e7d7').full, 'Tốt thứ hai bình 6');
  assert.equal(moveToTraditional(b5, 'e6d6').full, 'Tốt giữa bình 6');
  assert.equal(moveToTraditional(b5, 'e5d5').full, 'Tốt thứ tư bình 6');
  assert.equal(moveToTraditional(b5, 'e4e5').full, 'Tốt sau tiến 1');

  // Two different files (g=file 3 and c=file 7) each having 2 Red Soldiers -> file number + position word
  const bMulti = Board.fromFen('3k5/9/2P3P2/2P3P2/9/9/9/9/9/5K3 w - - 0 1');
  assert.equal(moveToTraditional(bMulti, 'g7g8').full, 'Tốt 3 trước tiến 1');
  assert.equal(moveToTraditional(bMulti, 'g7g8').short, 'Tốt 3 trước+1');
  assert.equal(moveToTraditional(bMulti, 'g6h6').full, 'Tốt 3 sau bình 2');
  assert.equal(moveToTraditional(bMulti, 'c7c8').full, 'Tốt 7 trước tiến 1');
  assert.equal(moveToTraditional(bMulti, 'c6b6').full, 'Tốt 7 sau bình 8');
  const leg = allLegalIccs(bMulti, rules);
  const fulls = new Set(leg.map((m) => moveToTraditional(bMulti, m).full));
  assert.equal(fulls.size, leg.length, 'Multi-file duplicates must remain unique');
});

test('4. Symmetry property over 200 seeded random positions (180° + colour swap)', () => {
  const rng = makeSeededRng(20261127);
  let checkedPositions = 0;
  let checkedMoves = 0;
  for (let g = 0; g < 10 && checkedPositions < 200; g++) {
    const b = Board.fromFen(START_FEN);
    for (let ply = 0; ply < 80 && checkedPositions < 200; ply++) {
      const leg = allLegalIccs(b, rules);
      if (leg.length === 0) break;
      const fen = b.toFen();
      const rotB = Board.fromFen(rotateFen180SwapColors(fen));
      for (const mv of leg) {
        const a = moveToTraditional(b, mv);
        const c = moveToTraditional(rotB, rotateIccs180(mv));
        assert.equal(a.full, c.full, `Symmetry mismatch at fen=${fen} mv=${mv}`);
        assert.equal(a.short, c.short, `Short symmetry mismatch at fen=${fen} mv=${mv}`);
        checkedMoves++;
      }
      checkedPositions++;
      applyIccs(b, leg[Math.floor(rng() * leg.length)]);
    }
  }
  assert.equal(checkedPositions, 200);
  assert.ok(checkedMoves > 2000);
});

test('5. Injectivity, round-trip & garbage fuzz over 300 Xiangqi + 300 Jieqi positions', () => {
  const rng = makeSeededRng(998877);
  let xqPositions = 0;
  let xqMoves = 0;
  for (let g = 0; g < 15 && xqPositions < 300; g++) {
    const b = Board.fromFen(START_FEN);
    for (let ply = 0; ply < 80 && xqPositions < 300; ply++) {
      const leg = allLegalIccs(b, rules);
      if (leg.length === 0) break;
      const fullSet = new Set();
      const shortSet = new Set();
      for (const mv of leg) {
        const res = moveToTraditional(b, mv, { variant: 'xiangqi' });
        assert.ok(!fullSet.has(res.full), `Duplicate full "${res.full}" at ${b.toFen()}`);
        assert.ok(!shortSet.has(res.short), `Duplicate short "${res.short}" at ${b.toFen()}`);
        fullSet.add(res.full);
        shortSet.add(res.short);
        assert.equal(parseTraditional(b, res.full, { variant: 'xiangqi' }), mv);
        assert.equal(parseTraditional(b, res.short, { variant: 'xiangqi' }), mv);
        // ASCII minus & diacritics-insensitive check
        const ascii = res.short.replace(/\u2212/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        assert.equal(parseTraditional(b, `  ${ascii}  `, { variant: 'xiangqi' }), mv);
        xqMoves++;
      }
      xqPositions++;
      applyIccs(b, leg[Math.floor(rng() * leg.length)]);
    }
  }
  assert.equal(xqPositions, 300);

  // Jieqi (Cờ Úp) 300 positions
  let jqPositions = 0;
  let jqMoves = 0;
  for (let g = 0; g < 15 && jqPositions < 300; g++) {
    const b = new JieqiBoard({ seed: 100 + g });
    for (let ply = 0; ply < 80 && jqPositions < 300; ply++) {
      const leg = allLegalIccs(b, jqRules);
      if (leg.length === 0) break;
      const fullSet = new Set();
      const shortSet = new Set();
      for (const mv of leg) {
        const res = moveToTraditional(b, mv, { variant: 'jieqi' });
        assert.ok(!fullSet.has(res.full), `Jieqi dup full "${res.full}"`);
        assert.ok(!shortSet.has(res.short), `Jieqi dup short "${res.short}"`);
        fullSet.add(res.full);
        shortSet.add(res.short);
        assert.equal(parseTraditional(b, res.full, { variant: 'jieqi' }), mv);
        assert.equal(parseTraditional(b, res.short, { variant: 'jieqi' }), mv);
        jqMoves++;
      }
      jqPositions++;
      applyIccs(b, leg[Math.floor(rng() * leg.length)]);
    }
  }
  assert.equal(jqPositions, 300);
  assert.ok(xqMoves > 3000 && jqMoves > 3000);

  // Garbage fuzz: never throws, returns null
  const start = Board.fromFen(START_FEN);
  const garbage = ['', '   ', 'x'.repeat(5000), '\x00\x01\n\t', '__proto__', 'constructor', '🎉🔥', 'Xe 9 tiến 9', 'Pháo 2 bình 2'];
  for (const g of garbage) {
    assert.equal(parseTraditional(start, g), null);
  }
});

test('6. Format regex grammar and natural Vietnamese aria sentence', () => {
  const b = Board.fromFen(START_FEN);
  const r = moveToTraditional(b, 'b2e2');
  assert.match(r.full, TRADITIONAL_FULL_RE);
  assert.equal(r.aria, 'Pháo, cột 8, bình 5');

  const b2 = Board.fromFen('4k4/9/9/9/3R5/9/3R5/9/9/3K5 w - - 0 1');
  const r2 = moveToTraditional(b2, 'd5d8');
  assert.match(r2.full, TRADITIONAL_FULL_RE);
  assert.equal(r2.aria, 'Xe trước, tiến 3');
});

test('7. formatLine replays 6-ply PV and truncates at first illegal move', () => {
  const b = Board.fromFen(START_FEN);
  const pv = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b7e7'];
  const fullLine = formatLine(b, pv, { variant: 'xiangqi', style: 'full' });
  assert.deepEqual(fullLine, [
    'Pháo 2 bình 5',
    'Mã 8 tiến 7',
    'Mã 2 tiến 3',
    'Xe 9 bình 8',
    'Xe 1 bình 2',
    'Pháo 2 bình 5',
  ]);
  const shortLine = formatLine(b, pv, { variant: 'xiangqi', style: 'short' });
  assert.deepEqual(shortLine, ['Pháo 2=5', 'Mã 8+7', 'Mã 2+3', 'Xe 9=8', 'Xe 1=2', 'Pháo 2=5']);

  // Truncates at illegal move
  const bad = ['h2e2', 'h9g7', 'a0a9', 'i9h9'];
  assert.deepEqual(formatLine(b, bad, { variant: 'xiangqi', style: 'full' }), [
    'Pháo 2 bình 5',
    'Mã 8 tiến 7',
  ]);
});

test('8. Cờ Úp NO-PEEKING: byte-identical output across 20 secret assignments', () => {
  const outputs = [];
  for (let seed = 1; seed <= 20; seed++) {
    const b = new JieqiBoard({ seed });
    const leg = allLegalIccs(b, jqRules).sort();
    const str = leg.map((mv) => {
      const r = moveToTraditional(b, mv, { variant: 'jieqi' });
      return `${mv}:${r.full}|${r.short}|${r.aria}`;
    }).join('\n');
    outputs.push(str);
  }
  for (let i = 1; i < outputs.length; i++) {
    assert.equal(outputs[i], outputs[0], `Secret seed ${i + 1} leaked into notation!`);
  }
});
