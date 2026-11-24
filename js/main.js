import { THEME_GO_LIM, THEME_NGOC_BICH, getTheme, nextTheme } from './theme.js';
import { renderBoardSvg } from './render/boardSvg.js';
import { renderPiecesSheetSvg, renderGalleryHtml } from './render/pieceSvg.js';
import { Board } from './model/board.js';
import { START_FEN } from './model/fen.js';
import { RED, BLACK } from './model/piece.js';
import { XiangqiRules, PermissiveRules, GameStatus } from './rules.js';
import { BoardView, renderStaticBoardWithPieces } from './ui/boardView.js';
import { SidePanel, formatGameOverText } from './ui/sidePanel.js';
import { SfxManager } from './audio/sfx.js';
import { SOUND_EVENTS, SOUND_META } from './audio/synth.js';
import {
  createVoiceChain,
  computeNormalizedGain,
  trimSilence,
  applyTransientBoost,
} from './audio/voice.js';
import { AiClient } from './ai/client.js';
import { PikafishClient } from './ai/pikafishClient.js';
import { playEndFx } from './fx/endFx.js';

const STORAGE_MODE = 'xq_game_mode';
const STORAGE_PSIDE = 'xq_player_side';
const STORAGE_LEVEL = 'xq_ai_level';
const STORAGE_ENGINE = 'xq_ai_engine';
const MIN_AI_THINK_MS = 450;
const AUTO_REPLAY_MS = 800;
const REVIEW_STEP_GAIN = 0.355; // -9 dB quiet clack while stepping in review
const FILES = 'abcdefghi';

function parseIccs(str) {
  return {
    from: { x: FILES.indexOf(str[0]), y: 9 - Number(str[1]) },
    to: { x: FILES.indexOf(str[2]), y: 9 - Number(str[3]) },
  };
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadPref(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function applyUiThemeVars(theme) {
  const root = document.documentElement.style;
  const u = theme.ui;
  root.setProperty('--bg-center', u.bgCenter);
  root.setProperty('--bg-edge', u.bgEdge);
  root.setProperty('--panel-bg', u.panelBg);
  root.setProperty('--panel-border', u.panelBorder);
  root.setProperty('--text-primary', u.textPrimary);
  root.setProperty('--text-muted', u.textMuted);
  root.setProperty('--accent-gold', u.accentGold);
  root.setProperty('--danger', u.danger);
  root.setProperty('--btn-bg', u.btnBg);
  root.setProperty('--btn-hover', u.btnHover);
  root.setProperty('--fx-accent', u.fxAccent || u.accentGold);
  root.setProperty('--fx-accent-2', u.fxAccent2 || '#E07A3F');
}

function mountEffectsPage(stage, sfx, initialTheme, params) {
  document.body.classList.add('mode-effects');
  let theme = initialTheme;
  applyUiThemeVars(theme);

  const board = Board.fromFen(START_FEN);
  const rules = new XiangqiRules();
  let activeFx = null;

  stage.innerHTML = `
    <div class="effects-page">
      <div class="effects-toolbar">
        <button type="button" class="pill-btn pill-btn-gold" data-fx="win-red">Thắng (Đỏ)</button>
        <button type="button" class="pill-btn" data-fx="win-black">Thắng (Đen)</button>
        <button type="button" class="pill-btn pill-btn-danger" data-fx="lose">Thua</button>
        <button type="button" class="pill-btn" data-fx="resign">Đầu hàng</button>
        <button type="button" class="pill-btn" data-fx="draw">Hòa</button>
        <button type="button" class="pill-btn" data-fx="skip">Bỏ qua</button>
        <select class="ai-level-select effects-theme-select" aria-label="Giao diện">
          <option value="${THEME_GO_LIM.id}" ${theme.id === THEME_GO_LIM.id ? 'selected' : ''}>Gỗ Lim</option>
          <option value="${THEME_NGOC_BICH.id}" ${theme.id === THEME_NGOC_BICH.id ? 'selected' : ''}>Ngọc Bích</option>
        </select>
        <label class="effects-speed-wrap">
          <span>Tốc độ: <strong class="effects-speed-val">1.00x</strong></span>
          <input type="range" class="effects-speed" min="0.25" max="2" step="0.05" value="1">
        </label>
        <label class="free-move-toggle">
          <input type="checkbox" class="effects-sound-cb">
          <span>Âm thanh</span>
        </label>
      </div>
      <div class="effects-board-host"></div>
    </div>
  `;

  const host = stage.querySelector('.effects-board-host');
  const boardView = new BoardView({ container: host, board, rules, theme });
  boardView.setLocked(true);

  const speedInput = stage.querySelector('.effects-speed');
  const speedVal = stage.querySelector('.effects-speed-val');
  const soundCb = stage.querySelector('.effects-sound-cb');
  const themeSel = stage.querySelector('.effects-theme-select');

  speedInput.addEventListener('input', () => {
    speedVal.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  });

  themeSel.addEventListener('change', () => {
    if (activeFx) {
      activeFx.cancel();
      activeFx = null;
    }
    theme = getTheme(themeSel.value);
    applyUiThemeVars(theme);
    boardView.setTheme(theme);
  });

  const triggerFx = (preset) => {
    if (activeFx) {
      activeFx.cancel();
      activeFx = null;
    }
    const useSfx = soundCb.checked ? sfx : null;
    const speed = Number(speedInput.value) || 1;
    let kind = 'win';
    let winnerSide = 'red';
    let reason = 'checkmate';
    let genSide = BLACK;
    if (preset === 'win-black') {
      kind = 'win';
      winnerSide = 'black';
      genSide = RED;
    } else if (preset === 'lose') {
      kind = 'lose';
      winnerSide = 'black';
      genSide = RED;
    } else if (preset === 'resign') {
      kind = 'resign';
      winnerSide = 'black';
      reason = 'resign';
      genSide = RED;
    } else if (preset === 'draw') {
      kind = 'draw';
      winnerSide = null;
      reason = 'repetition';
      genSide = null;
    }

    const gPos = genSide ? boardView.getGeneralBoardPos(genSide) : null;
    activeFx = playEndFx({
      container: boardView.wrapper,
      boardSvg: boardView.svg,
      theme,
      kind,
      winnerSide,
      reason,
      generalSquare: gPos,
      vsAi: kind === 'lose' || kind === 'resign',
      sfx: useSfx,
      speed,
      reducedMotion: prefersReducedMotion(),
      testMode: params.has('test'),
    });
  };

  stage.querySelectorAll('[data-fx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fx = btn.dataset.fx;
      if (fx === 'skip') {
        if (activeFx) activeFx.skip();
      } else {
        triggerFx(fx);
      }
    });
  });

  const initialPreset = params.get('fx');
  if (initialPreset) {
    triggerFx(initialPreset);
  }
}

async function mountVoicesPage(stage, sfx) {
  document.body.classList.add('mode-gallery');
  let manifest = null;
  let ver = String(Date.now());
  try {
    const mResp = await fetch(`assets/voice/manifest.json?v=${ver}`);
    if (mResp.ok) {
      manifest = await mResp.json();
      ver = encodeURIComponent(manifest.version || ver);
    }
  } catch {
    manifest = null;
  }

  const allEntries = [];
  for (const [dir, jsonName] of [
    ['preview/voices/audition3', 'audition3.json'],
    ['preview/voices/audition2', 'audition2.json'],
  ]) {
    try {
      const resp = await fetch(`${dir}/${jsonName}?v=${ver}`);
      if (resp.ok) {
        const data = await resp.json();
        for (const e of data.entries || []) {
          allEntries.push({ ...e, _url: `${dir}/${e.file}?v=${ver}` });
        }
      }
    } catch {
      // ignore missing audition folder
    }
  }

  const defaultSummary = manifest
    ? `Mặc định hiện tại: <code>${manifest.voice}</code> (${manifest.pitch}, ${manifest.rate}); riêng <strong>check &amp; capture</strong>: <code>${manifest.voiceMap?.check?.name || manifest.voice}</code> (${manifest.voiceMap?.check?.pitch || manifest.pitch}, ${manifest.voiceMap?.check?.rate || manifest.rate}).`
    : 'Chưa đọc được assets/voice/manifest.json.';

  const groups = new Map();
  allEntries.forEach((e, i) => {
    const g = e.group || e.rate || 'Khác';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ ...e, _idx: i });
  });

  const sectionsHtml = [...groups.entries()].map(([gName, list]) => {
    const cards = list.map((e) => `
      <button type="button" class="pill-btn voice-audition-btn" data-idx="${e._idx}">
        <span class="voice-audition-glyph">${e.caption}</span>
        <span class="voice-audition-meta">
          <strong>rate ${e.rate} · pitch ${e.pitch}</strong>
          <span>${e.tts || '将军！'} (${e.voice})</span>
        </span>
      </button>
    `).join('');
    return `<h2 class="sounds-heading">${gName}</h2><div class="audition-grid">${cards}</div>`;
  }).join('');

  stage.innerHTML = `
    <div class="sounds-root">
      <h1>Nghe thử giọng Tướng Quân (?voices)</h1>
      <p class="sounds-sub">${defaultSummary}</p>
      <div class="sounds-toolbar">
        <label class="free-move-toggle">
          <input type="checkbox" class="audition-processed-cb" checked>
          <span>Áp dụng hiệu ứng Tướng Quân (EQ + bão hòa + nén nhanh + vang ngắn)</span>
        </label>
      </div>
      ${sectionsHtml || '<p>Chưa có file audition. Chạy <code>python tools/gen_voice.py</code>.</p>'}
    </div>
  `;

  const processedCb = stage.querySelector('.audition-processed-cb');
  const cache = new Map();
  let chain = null;

  stage.querySelectorAll('.voice-audition-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = allEntries[Number(btn.dataset.idx)];
      if (!entry) return;
      await sfx.ensureReady();
      if (!sfx.ctx || !sfx.voiceGain) return;
      if (!chain) chain = createVoiceChain(sfx.ctx, sfx.voiceGain);

      let decoded = cache.get(entry._url);
      if (!decoded) {
        const r = await fetch(entry._url);
        const arr = await r.arrayBuffer();
        const rawBuf = await sfx.ctx.decodeAudioData(arr);
        const buf = trimSilence(sfx.ctx, rawBuf);
        decoded = { buf, gain: computeNormalizedGain(buf, 1.0) };
        cache.set(entry._url, decoded);
      }
      const src = sfx.ctx.createBufferSource();
      src.buffer = decoded.buf;
      const g = sfx.ctx.createGain();
      if (processedCb.checked) {
        applyTransientBoost(g, decoded.gain, sfx.ctx.currentTime);
        src.connect(g);
        g.connect(chain.input);
      } else {
        g.gain.setValueAtTime(decoded.gain, sfx.ctx.currentTime);
        src.connect(g);
        g.connect(sfx.voiceGain);
      }
      src.start(sfx.ctx.currentTime);
    });
  });
}

function mountSoundsPage(stage, sfx) {
  document.body.classList.add('mode-gallery');
  const buttons = SOUND_EVENTS.map((ev) => {
    const meta = SOUND_META[ev];
    return `<button type="button" class="pill-btn sound-demo-btn" data-sound="${ev}">
      <span class="sound-demo-name">${meta.label}</span>
      <span class="sound-demo-dur">${Math.round(meta.duration * 1000)} ms</span>
    </button>`;
  }).join('');

  const voiceItems = [
    { key: 'start', glyph: '請', label: 'Bắt đầu (qǐng)' },
    { key: 'capture', variant: 0, glyph: '吃', label: 'Ăn quân 1 (chī)' },
    { key: 'capture', variant: 1, glyph: '殺', label: 'Ăn quân 2 (shā)' },
    { key: 'check', glyph: '將軍', label: 'Chiếu tướng (jiāng jūn)' },
    { key: 'checkmate', glyph: '將死', label: 'Chiếu bí (jiāng sǐ)' },
    { key: 'checkmate2', glyph: '承讓', label: 'Đa tạ (chéng ràng)' },
    { key: 'draw', glyph: '和棋', label: 'Hòa cờ (hé qí)' },
  ];

  const voiceBtns = voiceItems.map((v, idx) => `
    <button type="button" class="pill-btn voice-demo-btn" data-vidx="${idx}">
      <span class="voice-demo-glyph">${v.glyph}</span>
      <span class="sound-demo-name">${v.label}</span>
    </button>
  `).join('');

  stage.innerHTML = `
    <div class="sounds-root">
      <h1>Thử âm thanh & Giọng nói Cờ Tướng</h1>
      <p class="sounds-sub">Hiệu ứng gỗ/chiêng/cổ tranh/kiếm tổng hợp bằng Web Audio API + giọng tướng quân xử lý EQ & vang sảnh.</p>
      <div class="sounds-toolbar">
        <button type="button" class="pill-btn pill-btn-gold" data-action="play-all">Phát tất cả SFX (Play all)</button>
        <label class="free-move-toggle">
          <input type="checkbox" class="wood-ab-cb" checked>
          <span>Âm gỗ: mới (tắt = cũ)</span>
        </label>
        <label class="sounds-vol">
          <span>Âm lượng:</span>
          <input type="range" class="volume-slider" min="0" max="100" value="${Math.round(sfx.getVolume() * 100)}">
          <span class="volume-value">${Math.round(sfx.getVolume() * 100)}%</span>
        </label>
      </div>
      <h2 class="sounds-heading">Hiệu ứng (SFX)</h2>
      <div class="sounds-grid">${buttons}</div>

      <h2 class="sounds-heading">Giọng nói Tướng Quân (Voice)</h2>
      <div class="sounds-toolbar">
        <label class="free-move-toggle">
          <input type="checkbox" class="voice-processed-cb" checked>
          <span>Play processed (EQ + bão hòa + nén + vang)</span>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="pill-btn pill-btn-gold" data-action="play-cap-chk">Play seq: capture + check</button>
          <button type="button" class="pill-btn pill-btn-gold" data-action="play-mate-seq">Play seq: checkmate</button>
        </div>
      </div>
      <div class="sounds-grid">${voiceBtns}</div>
    </div>
  `;

  const woodNewCb = stage.querySelector('.wood-ab-cb');
  stage.querySelectorAll('[data-sound]').forEach((btn) => {
    btn.addEventListener('click', () => {
      let ev = btn.dataset.sound;
      if (!woodNewCb.checked && (ev === 'move' || ev === 'capture')) {
        ev = `${ev}_classic`;
      }
      sfx.play(ev, 0, { rawSynthOnly: true });
    });
  });

  const processedCb = stage.querySelector('.voice-processed-cb');
  stage.querySelectorAll('[data-vidx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = voiceItems[Number(btn.dataset.vidx)];
      sfx.playVoiceDirect(item.key, {
        processed: processedCb.checked,
        variantIndex: item.variant,
      });
    });
  });

  stage.querySelector('[data-action="play-cap-chk"]').addEventListener('click', () => {
    sfx.setVoiceEnabled(true);
    sfx.play('capture', 0, { skipVoice: true });
    sfx.play('check', 0);
  });

  stage.querySelector('[data-action="play-mate-seq"]').addEventListener('click', () => {
    sfx.setVoiceEnabled(true);
    sfx.play('capture', 0, { skipVoice: true });
    sfx.play('checkmate', 0);
  });

  const slider = stage.querySelector('.volume-slider');
  const valEl = stage.querySelector('.volume-value');
  slider.addEventListener('input', (ev) => {
    sfx.setVolume(Number(ev.target.value) / 100);
    valEl.textContent = `${ev.target.value}%`;
  });

  stage.querySelector('[data-action="play-all"]').addEventListener('click', () => {
    let offset = 0;
    for (const ev of SOUND_EVENTS) {
      sfx.play(ev, offset, { rawSynthOnly: true });
      offset += Math.round(SOUND_META[ev].duration * 1000) + 260;
    }
  });
}

async function init() {
  await document.fonts.ready;

  const params = new URLSearchParams(window.location.search);
  const isTestMode = params.has('test');
  let theme = getTheme(params.get('theme') || THEME_GO_LIM.id);
  applyUiThemeVars(theme);

  const stage = document.getElementById('board-stage');
  const sidePanelEl = document.getElementById('side-panel');
  const modalRoot = document.getElementById('modal-root');
  if (!stage) return;

  let boardView = null;
  const sfx = new SfxManager({
    testMode: isTestMode,
    onCaption: (info) => {
      if (boardView) boardView.showVoiceCaption(info);
    },
  });

  if (params.has('effects')) {
    mountEffectsPage(stage, sfx, theme, params);
    return;
  }
  if (params.has('voices')) {
    await mountVoicesPage(stage, sfx);
    return;
  }
  if (params.has('sounds')) {
    mountSoundsPage(stage, sfx);
    return;
  }
  if (params.has('gallery')) {
    document.body.classList.add('mode-gallery');
    stage.innerHTML = renderGalleryHtml(theme);
    return;
  }
  if (params.has('preview')) {
    document.body.classList.add('mode-preview');
    const previewType = params.get('preview') || 'board';
    if (previewType === 'board') {
      stage.innerHTML = `<div class="preview-board-container">${renderBoardSvg(theme, 'preview-board')}</div>`;
      return;
    }
    if (previewType === 'pieces') {
      stage.innerHTML = renderPiecesSheetSvg(theme, 240, 'preview-pieces-sheet');
      return;
    }
    if (previewType === 'pieces_small') {
      stage.innerHTML = renderPiecesSheetSvg(theme, 88, 'preview-pieces-small');
      return;
    }
    if (previewType === 'start') {
      stage.innerHTML = renderStaticBoardWithPieces(Board.fromFen(START_FEN), theme);
      return;
    }
  }

  // Persisted mode preferences
  let gameMode = params.get('mode') || loadPref(STORAGE_MODE, 'pvp');
  if (gameMode !== 'ai') gameMode = 'pvp';
  const sideParam = params.get('side');
  let playerSide =
    sideParam === 'black'
      ? BLACK
      : sideParam === 'red'
        ? RED
        : loadPref(STORAGE_PSIDE, RED) === BLACK
          ? BLACK
          : RED;
  let aiLevel = params.get('level') || loadPref(STORAGE_LEVEL, 'nghiep-du');
  let hintsLeft = 3;
  let resigned = false;
  let aiSearchToken = 0;

  const aiClient = new AiClient();
  const pikafishClient = new PikafishClient();
  const pfInfo = await pikafishClient.probeInfo();
  const savedEngine = params.get('engine') || loadPref(STORAGE_ENGINE, pfInfo.available ? 'pikafish' : 'js');
  let engineType = pfInfo.available && savedEngine === 'pikafish' ? 'pikafish' : 'js';

  window.addEventListener('beforeunload', () => {
    pikafishClient.cancel();
    aiClient.terminate();
  });

  const initialFen = params.get('fen') || START_FEN;
  let gameStartFen = initialFen;
  const board = Board.fromFen(initialFen);
  const xiangqiRules = new XiangqiRules();
  const permissiveRules = new PermissiveRules();
  let practiceMode = false;
  let activeRules = xiangqiRules;
  let lastStatus = GameStatus.Playing;
  let sidePanel = null;

  // Part 1: Review state (separate from real game board)
  let viewPly = 0;
  let inReviewMode = false;
  let hasNewLiveMoves = false;
  let autoPlayTimer = null;
  let activeEndFx = null;

  const isReviewing = () => inReviewMode && viewPly < board.history.length;

  const updateViewHook = () => {
    if (isTestMode) {
      window.__view = {
        ply: viewPly,
        total: board.history.length,
        fen: board.viewFen(viewPly),
      };
    }
  };

  const stopAutoPlay = () => {
    if (autoPlayTimer) {
      window.clearInterval(autoPlayTimer);
      autoPlayTimer = null;
      if (sidePanel) {
        sidePanel.setReviewState({
          viewPly,
          hasNewMoves: hasNewLiveMoves,
          autoPlaying: false,
          skipScroll: true,
        });
      }
    }
  };

  const cancelEndFx = () => {
    if (activeEndFx) {
      activeEndFx.cancel();
      activeEndFx = null;
    }
  };

  const isGameOver = () =>
    resigned ||
    lastStatus === GameStatus.Checkmate ||
    lastStatus === GameStatus.Stalemate ||
    lastStatus === GameStatus.DrawRepetition ||
    lastStatus === GameStatus.DrawNoCapture;

  const cancelAi = () => {
    aiSearchToken++;
    pikafishClient.cancel();
    aiClient.cancel();
    if (sidePanel) sidePanel.setAiThinking(false, null);
  };

  const isLegalIccsMove = (iccs) => {
    if (!iccs || iccs.length !== 4) return false;
    const { from, to } = parseIccs(iccs);
    const p = board.at(from);
    if (!p || p.side !== board.sideToMove) return false;
    return xiangqiRules.legalMoves(board, from).some((m) => m.x === to.x && m.y === to.y);
  };

  const usePikafish = () => engineType === 'pikafish' && pikafishClient.isAvailable();

  const runEngineSearch = async (levelId, onInfo) => {
    if (usePikafish()) {
      const moves = board.history.map((m) => m.iccs);
      const res = await pikafishClient.search({
        fen: gameStartFen,
        moves,
        level: levelId,
        onInfo,
      });
      if (res && res.move && isLegalIccsMove(res.move)) {
        return res;
      }
      if (res && res.move) {
        console.debug('Pikafish returned illegal move, falling back to JS engine:', res.move);
      }
      if (res === null) return null;
    }
    return aiClient.search({
      fen: board.toFen(),
      history: board.positionHistory,
      level: levelId,
      onInfo,
    });
  };

  /** Navigate viewPly (0..N) without mutating the real game board. */
  const goToPly = (targetPly, { isScrub = false, fromAuto = false } = {}) => {
    if (!fromAuto) stopAutoPlay();
    cancelEndFx();

    const total = board.history.length;
    const clamped = Math.max(0, Math.min(total, Math.floor(targetPly)));
    const prevPly = viewPly;
    const delta = clamped - prevPly;
    viewPly = clamped;

    if (viewPly === total) {
      hasNewLiveMoves = false;
    }

    const active = viewPly < total;
    inReviewMode = active;
    const snap = board.snapshotAt(viewPly);
    const viewBoard = active ? Board.fromFen(snap.fen) : null;
    const reduced = prefersReducedMotion();

    let transition = 'instant';
    let stepMove = null;
    if (delta === 1 && !isScrub) {
      transition = reduced ? 'instant' : 'forward';
      stepMove = board.history[clamped - 1] || null;
      if (stepMove) {
        sfx.play(stepMove.captured ? 'capture' : 'move', 0, {
          skipVoice: true,
          gainScale: REVIEW_STEP_GAIN,
        });
      }
    } else if (delta === -1 && !isScrub) {
      transition = reduced ? 'instant' : 'backward';
      stepMove = board.history[prevPly - 1] || null;
      if (stepMove) {
        sfx.play(stepMove.captured ? 'capture' : 'move', 0, {
          skipVoice: true,
          gainScale: REVIEW_STEP_GAIN,
        });
      }
    } else if (delta !== 0) {
      transition = reduced ? 'instant' : 'jump';
      if (!isScrub) {
        sfx.play('select', 0, { skipVoice: true, gainScale: 0.35 });
      }
    }

    boardView.setReviewState({
      active,
      viewPly,
      totalPlies: total,
      hasNewMoves: hasNewLiveMoves,
      viewBoard,
      lastMove: snap.move,
      transition,
      stepMove,
      reducedMotion: reduced,
    });

    if (sidePanel) {
      sidePanel.setReviewState({
        viewPly,
        hasNewMoves: hasNewLiveMoves,
        autoPlaying: Boolean(autoPlayTimer),
        skipScroll: isScrub,
      });
    }
    updateViewHook();
  };

  const toggleAutoPlay = () => {
    if (autoPlayTimer) {
      stopAutoPlay();
      return;
    }
    const total = board.history.length;
    if (total === 0) return;
    if (viewPly >= total) {
      goToPly(0, { fromAuto: true });
    }
    autoPlayTimer = window.setInterval(() => {
      if (viewPly >= board.history.length) {
        stopAutoPlay();
        return;
      }
      goToPly(viewPly + 1, { fromAuto: true });
      if (viewPly >= board.history.length) {
        stopAutoPlay();
      }
    }, AUTO_REPLAY_MS);
    if (sidePanel) {
      sidePanel.setReviewState({
        viewPly,
        hasNewMoves: hasNewLiveMoves,
        autoPlaying: true,
        skipScroll: true,
      });
    }
  };

  /** Trigger Part 3 end-of-game cinematic and open the styled result card when done. */
  const triggerEndCinematic = (status, isResign = false) => {
    cancelEndFx();
    stopAutoPlay();
    const vsAi = gameMode === 'ai';
    const side = board.sideToMove;
    const winnerSide = side === RED ? BLACK : RED;
    const resultText = formatGameOverText(status, side, {
      vsAi,
      playerSide,
      resigned: isResign,
    });
    if (!resultText) return;

    let kind = 'win';
    let reason = 'checkmate';
    let reasonText = `Chiếu bí sau ${board.history.length} nước`;
    let fxWinner = winnerSide;
    let genSide = side;

    if (isResign) {
      kind = 'resign';
      reason = 'resign';
      reasonText = 'Bạn đã đầu hàng ván đấu';
      fxWinner = playerSide === RED ? BLACK : RED;
      genSide = playerSide;
    } else if (status === GameStatus.DrawRepetition) {
      kind = 'draw';
      reason = 'repetition';
      reasonText = 'Lặp thế cờ 3 lần';
      fxWinner = null;
      genSide = null;
    } else if (status === GameStatus.DrawNoCapture) {
      kind = 'draw';
      reason = 'norule';
      reasonText = '60 nước không ăn quân';
      fxWinner = null;
      genSide = null;
    } else {
      const isHumanLoss = vsAi && winnerSide !== playerSide;
      kind = isHumanLoss ? 'lose' : 'win';
      reason = status === GameStatus.Stalemate ? 'stalemate' : 'checkmate';
      reasonText =
        status === GameStatus.Stalemate
          ? isHumanLoss
            ? 'Hết nước đi: bên bị bí thua (luật cờ tướng)'
            : 'Đối phương hết nước đi'
          : `Chiếu bí sau ${board.history.length} nước`;
    }

    // Audio sync for checkmate: align clash with arpeggio start (300 + trimmedDuration(將死))
    let tClashOverride = null;
    if (kind === 'win' && sfx.isVoiceEnabled() && !sfx.isMuted()) {
      const mateDurMs = Math.round(sfx.voice.getDuration('checkmate', 0.85) * 1000);
      tClashOverride = 300 + mateDurMs;
    }

    const genPos = genSide ? boardView.getGeneralBoardPos(genSide) : null;
    boardView.setLocked(true);

    activeEndFx = playEndFx({
      container: boardView.wrapper,
      boardSvg: boardView.svg,
      theme,
      kind,
      winnerSide: fxWinner,
      reason,
      generalSquare: genPos,
      vsAi,
      sfx,
      tClashOverride,
      reducedMotion: prefersReducedMotion(),
      testMode: isTestMode,
      onDone: () => {
        if (sidePanel) {
          sidePanel.showGameOverModal(resultText, { kind, reasonText });
        }
      },
    });
  };

  const evaluateStatus = (evt = null) => {
    const enforceRules = gameMode === 'ai' || !practiceMode;
    const status = enforceRules ? activeRules.status(board, board.sideToMove) : GameStatus.Playing;
    lastStatus = status;

    if (evt && evt.type === 'move' && evt.move && enforceRules) {
      const isMate = status === GameStatus.Checkmate;
      const isChk = status === GameStatus.Check || isMate;
      board.setLastMoveFlags({
        suffix: isMate ? '#' : status === GameStatus.Check ? '+' : '',
        gaveCheck: isChk,
        isCheckmate: isMate,
      });
    }

    if (!isReviewing()) {
      viewPly = board.history.length;
    }

    const resultText = formatGameOverText(status, board.sideToMove, {
      vsAi: gameMode === 'ai',
      playerSide,
      resigned,
    });
    boardView.setLocked(Boolean(resultText));

    if (sidePanel) {
      sidePanel.viewPly = Math.min(viewPly, board.history.length);
      sidePanel.hasNewMoves = hasNewLiveMoves;
      sidePanel.update(status);
    }
    updateViewHook();

    if (evt && evt.type === 'move') {
      if (!resultText && status === GameStatus.Check && !sfx.isVoiceEnabled() && !isReviewing()) {
        boardView.showToast('Chiếu tướng!');
      }
    } else if (evt && evt.type === 'undo') {
      sfx.play('undo');
      if (sidePanel) sidePanel.closeModal();
    }
  };

  const maybeTriggerAiTurn = async () => {
    if (gameMode !== 'ai' || isGameOver()) return;
    if (board.sideToMove === playerSide) return;

    const token = ++aiSearchToken;
    const startTs = performance.now();
    if (sidePanel) sidePanel.setAiThinking(true, null);

    const res = await runEngineSearch(aiLevel, (info) => {
      if (token === aiSearchToken && sidePanel) {
        sidePanel.setAiThinking(true, info);
      }
    });

    if (token !== aiSearchToken || !res || !res.move) return;

    const elapsed = performance.now() - startTs;
    const waitMs = Math.max(0, MIN_AI_THINK_MS - elapsed);
    if (waitMs > 0) {
      await new Promise((r) => window.setTimeout(r, waitMs));
    }
    if (token !== aiSearchToken || isGameOver() || gameMode !== 'ai') return;

    if (sidePanel) {
      sidePanel.setAiThinking(false, {
        depth: res.depth,
        score: res.score,
        scoreObj: res.scoreObj || null,
        nps: res.nps || 0,
      });
    }
    const { from, to } = parseIccs(res.move);

    // If user is currently in review mode, apply AI move in background without jumping viewPly!
    if (isReviewing()) {
      const move = board.applyMove(from, to);
      if (move) {
        hasNewLiveMoves = true;
        evaluateStatus({ type: 'move', move });
        const snap = board.snapshotAt(viewPly);
        boardView.setReviewState({
          active: true,
          viewPly,
          totalPlies: board.history.length,
          hasNewMoves: true,
          viewBoard: Board.fromFen(snap.fen),
          lastMove: snap.move,
          transition: 'instant',
          reducedMotion: true,
        });
      }
      return;
    }

    boardView.playMove(from, to);
  };

  const startFreshGame = (playStartSfx = true) => {
    cancelAi();
    cancelEndFx();
    stopAutoPlay();
    resigned = false;
    hintsLeft = 3;
    hasNewLiveMoves = false;
    inReviewMode = false;
    viewPly = 0;
    gameStartFen = START_FEN;
    board.loadFen(START_FEN);
    if (usePikafish()) pikafishClient.newGame();
    boardView.clearHintArrow();
    boardView.syncAfterReset();
    if (gameMode === 'ai') {
      practiceMode = false;
      activeRules = xiangqiRules;
      boardView.setRules(xiangqiRules, false);
      boardView.setHumanSide(playerSide);
      boardView.setFlipped(playerSide === BLACK);
    } else {
      boardView.setHumanSide(null);
    }
    if (sidePanel) {
      sidePanel.setResigned(false);
      sidePanel.setHintsLeft(hintsLeft);
      sidePanel.closeModal();
      sidePanel.viewPly = 0;
      sidePanel.hasNewMoves = false;
      sidePanel.autoPlaying = false;
    }
    evaluateStatus({ type: 'reset' });
    if (playStartSfx) sfx.play('start');
    if (gameMode === 'ai' && board.sideToMove !== playerSide) {
      maybeTriggerAiTurn();
    }
  };

  const handleContinueFromHere = (ply) => {
    cancelAi();
    cancelEndFx();
    stopAutoPlay();
    resigned = false;
    hasNewLiveMoves = false;
    inReviewMode = false;
    board.truncateTo(ply);
    viewPly = board.history.length;
    if (usePikafish()) pikafishClient.newGame();
    boardView.setReviewState({
      active: false,
      viewPly,
      totalPlies: viewPly,
      hasNewMoves: false,
      viewBoard: null,
      lastMove: board.lastMove(),
      transition: 'instant',
      reducedMotion: true,
    });
    if (sidePanel) {
      sidePanel.setResigned(false);
      sidePanel.closeModal();
    }
    evaluateStatus({ type: 'truncate' });
    if (gameMode === 'ai' && !isGameOver() && board.sideToMove !== playerSide) {
      maybeTriggerAiTurn();
    }
  };

  const handleUndo = () => {
    cancelEndFx();
    stopAutoPlay();
    boardView.clearHintArrow();

    // If reviewing, leave review (go live) first, then undo
    if (isReviewing()) {
      goToPly(board.history.length, { isScrub: true });
    }

    if (gameMode === 'ai') {
      const wasThinking = sidePanel && sidePanel.aiThinking;
      cancelAi();
      if (resigned) {
        resigned = false;
        if (sidePanel) {
          sidePanel.setResigned(false);
          sidePanel.closeModal();
        }
        evaluateStatus({ type: 'undo' });
        return;
      }
      if (wasThinking || board.sideToMove !== playerSide) {
        if (board.history.length >= 1) {
          boardView.undo();
          viewPly = board.history.length;
          updateViewHook();
        }
      } else {
        if (board.history.length < 2) return;
        board.undo();
        boardView.renderPieces();
        boardView.undo();
        viewPly = board.history.length;
        updateViewHook();
      }
      return;
    }
    boardView.undo();
    viewPly = board.history.length;
    updateViewHook();
  };

  const handleHint = async () => {
    if (isReviewing() || gameMode !== 'ai' || isGameOver() || hintsLeft <= 0 || board.sideToMove !== playerSide) return;
    const token = ++aiSearchToken;
    if (sidePanel) sidePanel.setAiThinking(true, null);
    const res = await runEngineSearch('hint', null);
    if (token !== aiSearchToken) return;
    if (sidePanel) sidePanel.setAiThinking(false, null);
    if (res && res.move) {
      hintsLeft = Math.max(0, hintsLeft - 1);
      if (sidePanel) sidePanel.setHintsLeft(hintsLeft);
      const { from, to } = parseIccs(res.move);
      boardView.showHintArrow(from, to, 2500);
    }
  };

  boardView = new BoardView({
    container: stage,
    board,
    rules: activeRules,
    theme,
    practiceMode,
    onSelectPiece: () => {
      boardView.clearHintArrow();
      sfx.play('select');
    },
    onMoveLanded: (move) => {
      const enforceRules = gameMode === 'ai' || !practiceMode;
      const isMateOrStale =
        enforceRules && (lastStatus === GameStatus.Checkmate || lastStatus === GameStatus.Stalemate);
      const isDraw =
        enforceRules && (lastStatus === GameStatus.DrawRepetition || lastStatus === GameStatus.DrawNoCapture);
      const isSpecial = enforceRules && (lastStatus === GameStatus.Check || isMateOrStale || isDraw);

      sfx.play(move.captured ? 'capture' : 'move', 0, { skipVoice: isSpecial });

      if (enforceRules) {
        if (lastStatus === GameStatus.Check) {
          sfx.play('check', 0);
        } else if (isMateOrStale) {
          const winnerSide = board.sideToMove === RED ? BLACK : RED;
          const isHumanLoss = gameMode === 'ai' && winnerSide !== playerSide;
          if (!isHumanLoss) {
            sfx.play('checkmate', 0);
          }
          triggerEndCinematic(lastStatus, false);
        } else if (isDraw) {
          sfx.play('draw', 0);
          triggerEndCinematic(lastStatus, false);
        }
      }

      if (gameMode === 'ai' && !isGameOver() && board.sideToMove !== playerSide) {
        maybeTriggerAiTurn();
      }
    },
    onIllegalMove: () => sfx.play('illegal'),
    onStateChange: (evt) => {
      if (evt.type === 'move' && !isReviewing()) {
        viewPly = board.history.length;
      } else if (evt.type === 'undo') {
        viewPly = Math.min(viewPly, board.history.length);
      }
      evaluateStatus(evt);
    },
    onReturnToLive: () => goToPly(board.history.length),
    onContinueFromHere: () => {
      if (sidePanel && isReviewing()) {
        sidePanel.requestTruncate(viewPly);
      }
    },
  });

  if (gameMode === 'ai') {
    boardView.setHumanSide(playerSide);
    boardView.setFlipped(playerSide === BLACK);
  }

  const switchTheme = () => {
    theme = nextTheme(theme.id);
    stage.classList.add('is-theme-fading');
    window.setTimeout(() => {
      applyUiThemeVars(theme);
      boardView.setTheme(theme);
      if (sidePanel) sidePanel.setTheme(theme);
      stage.classList.remove('is-theme-fading');
    }, 100);
  };

  const toggleMute = () => {
    sfx.toggleMute();
    if (sidePanel) sidePanel.syncAudio(sfx.isMuted(), sfx.getVolume(), sfx.isVoiceEnabled());
  };

  const toggleVoice = () => {
    sfx.toggleVoice();
    if (sidePanel) sidePanel.syncAudio(sfx.isMuted(), sfx.getVolume(), sfx.isVoiceEnabled());
  };

  if (sidePanelEl && modalRoot) {
    sidePanel = new SidePanel({
      container: sidePanelEl,
      modalRoot,
      board,
      theme,
      practiceMode,
      mode: gameMode,
      playerSide,
      aiLevel,
      engineType,
      pikafishInfo: pfInfo,
      hintsLeft,
      muted: sfx.isMuted(),
      volume: sfx.getVolume(),
      voiceEnabled: sfx.isVoiceEnabled(),
      onNewGame: () => startFreshGame(true),
      onUndo: handleUndo,
      onFlip: () => boardView.flip(),
      onToggleTheme: switchTheme,
      onTogglePractice: (enabled) => {
        practiceMode = enabled;
        activeRules = enabled ? permissiveRules : xiangqiRules;
        boardView.setRules(activeRules, practiceMode);
        evaluateStatus({ type: 'mode' });
      },
      onModeChange: (newMode) => {
        gameMode = newMode;
        savePref(STORAGE_MODE, newMode);
        if (newMode === 'pvp') {
          pikafishClient.cancel();
          aiClient.terminate();
          boardView.setHumanSide(null);
          boardView.setFlipped(false);
          startFreshGame(false);
        } else {
          startFreshGame(false);
        }
      },
      onPlayerSideChange: (side) => {
        playerSide = side;
        savePref(STORAGE_PSIDE, side);
        startFreshGame(false);
      },
      onAiLevelChange: (lvl) => {
        aiLevel = lvl;
        savePref(STORAGE_LEVEL, lvl);
        if (sidePanel) sidePanel.update(lastStatus);
      },
      onEngineChange: (eng) => {
        engineType = eng;
        savePref(STORAGE_ENGINE, eng);
        cancelAi();
        if (eng === 'pikafish') aiClient.terminate();
        if (sidePanel) sidePanel.setEngineState(engineType, pfInfo);
        if (gameMode === 'ai' && !isGameOver() && board.sideToMove !== playerSide) {
          maybeTriggerAiTurn();
        }
      },
      onHint: handleHint,
      onResign: () => {
        cancelAi();
        resigned = true;
        if (sidePanel) sidePanel.setResigned(true);
        boardView.setLocked(true);
        if (sidePanel) sidePanel.update(lastStatus);
        triggerEndCinematic(lastStatus, true);
      },
      onReviewGameOver: () => {
        cancelEndFx();
        viewPly = board.history.length;
        if (sidePanel) sidePanel.update(lastStatus);
        updateViewHook();
      },
      onSelectPly: (ply, opts) => goToPly(ply, opts),
      onStepPly: (delta) => goToPly(viewPly + delta),
      onToggleAutoPlay: toggleAutoPlay,
      onConfirmTruncate: (ply) => handleContinueFromHere(ply),
      onToggleMute: toggleMute,
      onToggleVoice: toggleVoice,
      onVolumeChange: (vol) => sfx.setVolume(vol),
    });
  }

  evaluateStatus();
  const initialStatus = activeRules.status(board, board.sideToMove);
  const initialResult = formatGameOverText(initialStatus, board.sideToMove, {
    vsAi: gameMode === 'ai',
    playerSide,
  });
  if (initialResult && sidePanel) {
    sidePanel.showGameOverModal(initialResult);
  } else if (initialStatus === GameStatus.Check) {
    boardView.showVoiceCaption({
      event: 'check',
      caption: '將軍',
      pinyin: 'jiāng jūn',
      vi: 'Chiếu tướng!',
    });
  } else if (gameMode === 'ai' && board.sideToMove !== playerSide) {
    maybeTriggerAiTurn();
  }

  if (isTestMode) {
    window.__sfx = sfx;
    window.__board = board;
    updateViewHook();
  }

  window.addEventListener('keydown', (ev) => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (modalRoot && !modalRoot.hidden) {
      if (ev.key === 'Escape' && sidePanel) sidePanel.closeModal();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      handleUndo();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      goToPly(viewPly - 1);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      goToPly(viewPly + 1);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      goToPly(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      goToPly(board.history.length);
    } else if (ev.key === ' ') {
      ev.preventDefault();
      toggleAutoPlay();
    } else if (ev.key === 'Escape') {
      if (isReviewing()) {
        goToPly(board.history.length);
      } else {
        boardView.clearSelection();
      }
    } else {
      const key = ev.key.toLowerCase();
      if (key === 'f') boardView.flip();
      else if (key === 'm') toggleMute();
      else if (key === 'v') toggleVoice();
      else if (key === 'n') {
        if (sidePanel) sidePanel.requestNewGame();
        else startFreshGame(true);
      }
    }
  });
}

init();
