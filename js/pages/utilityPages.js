/**
 * Standalone utility/preview pages (?effects, ?voices, ?sounds, ?gallery, ?preview)
 * extracted out of js/main.js so they bypass the lobby router cleanly.
 */
import { THEME_GO_LIM, THEME_NGOC_BICH, getTheme } from '../theme.js';
import { renderBoardSvg } from '../render/boardSvg.js';
import { renderPiecesSheetSvg, renderGalleryHtml } from '../render/pieceSvg.js';
import { Board } from '../model/board.js';
import { START_FEN } from '../model/fen.js';
import { RED, BLACK } from '../model/piece.js';
import { XiangqiRules } from '../rules.js';
import { BoardView, renderStaticBoardWithPieces } from '../ui/boardView.js';
import { SOUND_EVENTS, SOUND_META } from '../audio/synth.js';
import {
  createVoiceChain,
  computeNormalizedGain,
  trimSilence,
  applyTransientBoost,
} from '../audio/voice.js';
import { playEndFx } from '../fx/endFx.js';

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function mountEffectsPage(stage, sfx, initialTheme, params, applyUiThemeVars) {
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

export async function mountVoicesPage(stage, sfx) {
  document.body.classList.add('mode-gallery');
  let manifest = null;
  let ver = String(Date.now());
  try {
    const mResp = await fetch(`assets/voice/manifest.json?v=${ver}`);
    if (mResp.ok) {
      const parsed = await mResp.json();
      if (!parsed.empty) {
        manifest = parsed;
        ver = encodeURIComponent(manifest.version || ver);
      }
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
    : 'Chưa có file giọng trong assets/voice/manifest.json.';

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

export function mountSoundsPage(stage, sfx) {
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

export function mountGalleryOrPreview(stage, theme, params) {
  if (params.has('gallery')) {
    document.body.classList.add('mode-gallery');
    stage.innerHTML = renderGalleryHtml(theme);
    return true;
  }
  if (params.has('preview')) {
    document.body.classList.add('mode-preview');
    const previewType = params.get('preview') || 'board';
    if (previewType === 'board') {
      stage.innerHTML = `<div class="preview-board-container">${renderBoardSvg(theme, 'preview-board')}</div>`;
      return true;
    }
    if (previewType === 'pieces') {
      stage.innerHTML = renderPiecesSheetSvg(theme, 240, 'preview-pieces-sheet');
      return true;
    }
    if (previewType === 'pieces_small') {
      stage.innerHTML = renderPiecesSheetSvg(theme, 88, 'preview-pieces-small');
      return true;
    }
    if (previewType === 'start') {
      stage.innerHTML = renderStaticBoardWithPieces(Board.fromFen(START_FEN), theme);
      return true;
    }
  }
  return false;
}
