/**
 * Reusable Vietnamese, theme-aware, Esc-closable modals for Save / Export / Import,
 * Share links, Clipboard fallback, and Continue-from-position.
 */
import {
  toJson,
  fromJson,
  toPgn,
  fromPgn,
  fenToPosition,
  encodeSharePayload,
  makeExportFilename,
} from '../storage/formats.js';
import { variantToRouteGame } from '../storage/gameRecord.js';
import { AI_LEVELS } from '../ai/levels.js';
import { analysisKey } from '../analysis/math.js';

export function formatRelativeDateVi(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const isToday = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return `hôm nay ${hh}:${mm}`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 1) return `hôm qua ${hh}:${mm}`;
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const REASON_VI = {
  checkmate: 'Chiếu bí',
  stalemate: 'Hết nước đi',
  resign: 'Đầu hàng',
  timeout: 'Hết giờ',
  abandon: 'Rời trận',
  drawAgreed: 'Thỏa thuận hòa',
  repetition: 'Lặp thế 3 lần',
  noCapture: '60 nước không ăn',
  aborted: 'Đã hủy',
};

export function formatResultVi(record) {
  const res = record?.result || 'unfinished';
  const main =
    res === 'red'
      ? 'Đỏ thắng'
      : res === 'black'
        ? 'Đen thắng'
        : res === 'draw'
          ? 'Hòa'
          : 'Chưa xong';
  const r = record?.reason ? REASON_VI[record.reason] : '';
  return r ? `${main} · ${r}` : main;
}

export function triggerDownload(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyTextWithFallback(ctx, text, label = 'Nội dung') {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to selectable box
  }
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return false;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="copy-fb-title">
      <div class="modal-card setup-modal">
        <h3 id="copy-fb-title">Sao chép thủ công</h3>
        <p class="set-hint">Trình duyệt chặn quyền sao chép tự động. Chọn và nhấn Ctrl+C:</p>
        <textarea class="set-textarea copy-fb-area" rows="4" readonly></textarea>
        <div class="modal-actions" style="margin-top:12px">
          <button type="button" class="pill-btn pill-btn-gold modal-close">Đóng</button>
        </div>
      </div>
    </div>
  `;
  const ta = modalRoot.querySelector('.copy-fb-area');
  ta.value = text;
  ta.select();
  const close = () => {
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  };
  modalRoot.querySelector('.modal-close').addEventListener('click', close);
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) close();
  });
  return false;
}

/**
 * Save a record to gameStore, prompting the user if library cap (200) is reached.
 */
export async function saveRecordWithPrunePrompt(ctx, record) {
  const res = await ctx.gameStore.saveGame(record);
  if (res.ok) return res;
  if (res.needsPrune) {
    const ok = window.confirm(
      `Thư viện đã đạt giới hạn ${res.cap} ván. Xóa ván cũ nhất để lưu ván này?`
    );
    if (ok) {
      return ctx.gameStore.saveGame(record, { forcePruneOldest: true });
    }
  }
  return res;
}

export function openExportModal(ctx, { record, currentFen, allowSaveToLibrary = false, onSaved = null }) {
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return;
  const prevFocus = document.activeElement;

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch {}
    }
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);

  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="modal-card setup-modal">
        <h3 id="export-title">Lưu &amp; Xuất ván cờ</h3>
        <div class="export-menu-list">
          ${
            allowSaveToLibrary
              ? `<button type="button" class="pill-btn pill-btn-gold" data-exp="save">💾 Lưu vào thư viện</button>`
              : ''
          }
          <button type="button" class="pill-btn" data-exp="fen">📋 Sao chép FEN thế cờ hiện tại</button>
          <button type="button" class="pill-btn" data-exp="link">🔗 Sao chép liên kết ván</button>
          <button type="button" class="pill-btn" data-exp="json">⬇ Tải file .xqgame.json</button>
          <label class="export-an-opt" hidden>
            <input type="checkbox" data-exp-include-an>
            <span>Kèm phân tích đã lưu (chỉ áp dụng cho .xqgame.json)</span>
          </label>
          <button type="button" class="pill-btn" data-exp="pgn">⬇ Tải văn bản PGN (.pgn)</button>
        </div>
        <div class="set-msg export-status" aria-live="polite" style="margin-top:10px"></div>
        <div class="modal-actions" style="margin-top:14px">
          <button type="button" class="pill-btn modal-close">Đóng</button>
        </div>
      </div>
    </div>
  `;

  const statusEl = modalRoot.querySelector('.export-status');
  const setStatus = (msg, ok = true) => {
    statusEl.textContent = msg;
    statusEl.className = `set-msg export-status ${ok ? 'is-ok' : 'is-err'}`;
  };

  modalRoot.querySelector('.modal-close').addEventListener('click', close);
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) close();
  });

  const saveBtn = modalRoot.querySelector('[data-exp="save"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const r = await saveRecordWithPrunePrompt(ctx, { ...record, source: 'manual' });
      if (r.ok) {
        setStatus('Đã lưu vào Thư viện ván ✓');
        if (onSaved) onSaved(r.record);
      } else {
        setStatus(r.error?.message || 'Chưa lưu được ván cờ.', false);
      }
    });
  }

  modalRoot.querySelector('[data-exp="fen"]').addEventListener('click', async () => {
    const ok = await copyTextWithFallback(ctx, currentFen || record.start.fen, 'FEN');
    if (ok) setStatus('Đã sao chép FEN vào bộ nhớ tạm ✓');
  });

  modalRoot.querySelector('[data-exp="link"]').addEventListener('click', async () => {
    const enc = await encodeSharePayload(record);
    if (!enc.ok) {
      setStatus(enc.error.message, false);
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}#/replay?g=${enc.payload}`;
    const ok = await copyTextWithFallback(ctx, url, 'Liên kết ván');
    if (ok) setStatus(`Đã sao chép liên kết (${enc.payload.length} ký tự) ✓`);
  });

  let cachedAnalysis = null;
  const anOptWrap = modalRoot.querySelector('.export-an-opt');
  const anOptChk = modalRoot.querySelector('[data-exp-include-an]');
  if (ctx.gameStore && record && record.variant === 'xiangqi' && Array.isArray(record.moves)) {
    const aKey = analysisKey(record.start?.fen || '', record.moves.map((m) => m.m));
    ctx.gameStore.getAnalysis(aKey).then((an) => {
      if (an && anOptWrap && anOptWrap.isConnected) {
        cachedAnalysis = an;
        anOptWrap.hidden = false;
      }
    });
  }

  modalRoot.querySelector('[data-exp="json"]').addEventListener('click', () => {
    const payload = cachedAnalysis && anOptChk?.checked ? { ...record, analysis: cachedAnalysis } : record;
    triggerDownload(makeExportFilename(record, 'xqgame.json'), toJson(payload), 'application/json;charset=utf-8');
    setStatus('Đã tải xuống file .xqgame.json ✓');
  });

  modalRoot.querySelector('[data-exp="pgn"]').addEventListener('click', () => {
    triggerDownload(makeExportFilename(record, 'pgn'), toPgn(record), 'text/plain;charset=utf-8');
    setStatus('Đã tải xuống file .pgn ✓');
  });
}

export function openContinueFromPositionModal(ctx, { variant, fen, pool = null }) {
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return;
  const routeGame = variantToRouteGame(variant);
  let chosenMode = 'local';
  let chosenSide = 'red';
  let chosenLevel = ctx.settingsStore.get().last.level || 'nghiep-du';

  const close = () => {
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  };

  const render = () => {
    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cont-pos-title">
        <div class="modal-card setup-modal">
          <h3 id="cont-pos-title">Chơi tiếp từ thế cờ này</h3>
          <p class="set-hint">Sẽ tạo một ván mới từ thế cờ hiện tại (không ghi đè ván đã lưu).${
            routeGame === 'coup' ? ' Các quân còn úp sẽ được chia ngẫu nhiên theo pool còn lại.' : ''
          }</p>
          <div class="set-field" style="margin-top:10px">
            <label>Chế độ</label>
            <div class="set-seg-2">
              <button type="button" class="mini-seg-btn${chosenMode === 'local' ? ' is-selected' : ''}" data-cmode="local">Hai người</button>
              <button type="button" class="mini-seg-btn${chosenMode === 'ai' ? ' is-selected' : ''}" data-cmode="ai">Đấu máy</button>
            </div>
          </div>
          ${
            chosenMode === 'ai'
              ? `
                <div class="set-field">
                  <label>Bạn cầm</label>
                  <div class="set-seg-2">
                    <button type="button" class="mini-seg-btn${chosenSide === 'red' ? ' is-selected' : ''}" data-cside="red">Đỏ</button>
                    <button type="button" class="mini-seg-btn${chosenSide === 'black' ? ' is-selected' : ''}" data-cside="black">Đen</button>
                  </div>
                </div>
                <div class="set-field">
                  <label for="cont-lvl">Cấp độ máy</label>
                  <select id="cont-lvl" class="ai-level-select" style="width:100%">
                    ${AI_LEVELS.map((l) => `<option value="${l.id}" ${l.id === chosenLevel ? 'selected' : ''}>${l.name}</option>`).join('')}
                  </select>
                </div>
              `
              : ''
          }
          <div class="modal-actions" style="margin-top:14px">
            <button type="button" class="pill-btn modal-cancel">Hủy</button>
            <button type="button" class="pill-btn pill-btn-gold modal-go">Bắt đầu</button>
          </div>
        </div>
      </div>
    `;
    modalRoot.querySelectorAll('[data-cmode]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenMode = b.dataset.cmode;
        render();
      });
    });
    modalRoot.querySelectorAll('[data-cside]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenSide = b.dataset.cside;
        render();
      });
    });
    const lvlSel = modalRoot.querySelector('#cont-lvl');
    if (lvlSel) lvlSel.addEventListener('change', (ev) => { chosenLevel = ev.target.value; });
    modalRoot.querySelector('.modal-cancel').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
    modalRoot.querySelector('.modal-go').addEventListener('click', () => {
      ctx.pendingCustomStart = { game: routeGame, fen, pool };
      close();
      if (chosenMode === 'ai') {
        ctx.router.navigate(`/play/${routeGame}/ai`, { side: chosenSide, level: chosenLevel, custom: '1' });
      } else {
        ctx.router.navigate(`/play/${routeGame}/local`, { custom: '1' });
      }
    });
  };
  render();
}

/**
 * Parse one text payload (auto-detecting bundle JSON, single game JSON, or PGN).
 */
async function importTextIntoStore(ctx, text, label = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { imported: 0, failed: 1, errors: [`${label ? label + ': ' : ''}Nội dung trống.`] };
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Array.isArray(parsed.games)) {
        const res = await ctx.gameStore.importBundle(parsed, { forcePruneOldest: false });
        return { imported: res.imported, failed: res.failed, errors: res.errors };
      }
    } catch {
      // let fromJson report exact error
    }
    const res = fromJson(trimmed, { isImport: true });
    if (!res.ok) {
      return { imported: 0, failed: 1, errors: [`${label ? label + ': ' : ''}${res.error.message}`] };
    }
    const saved = await saveRecordWithPrunePrompt(ctx, res.record);
    if (!saved.ok) {
      return { imported: 0, failed: 1, errors: [saved.error?.message || 'Không thể lưu ván cờ.'] };
    }
    return { imported: 1, failed: 0, errors: [] };
  }

  const res = fromPgn(trimmed, { isImport: true });
  if (!res.ok) {
    return { imported: 0, failed: 1, errors: [`${label ? label + ': ' : ''}${res.error.message}`] };
  }
  const saved = await saveRecordWithPrunePrompt(ctx, res.record);
  if (!saved.ok) {
    return { imported: 0, failed: 1, errors: [saved.error?.message || 'Không thể lưu ván cờ.'] };
  }
  return { imported: 1, failed: 0, errors: [] };
}

export function openImportModal(ctx, { initialFiles = null, onImported = null } = {}) {
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return;
  const prevFocus = document.activeElement;
  let tab = 'file';
  let summary = '';
  let errLines = [];
  let fenParsed = null;

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch {}
    }
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const handleFiles = async (fileList) => {
    let imp = 0;
    let fail = 0;
    const errs = [];
    for (const file of fileList) {
      try {
        const text = await file.text();
        const r = await importTextIntoStore(ctx, text, file.name);
        imp += r.imported;
        fail += r.failed;
        errs.push(...r.errors);
      } catch {
        fail++;
        errs.push(`${file.name}: Không thể đọc file.`);
      }
    }
    summary = `Đã nhập ${imp} ván${fail > 0 ? `, ${fail} lỗi` : ''}.`;
    errLines = errs;
    render();
    if (imp > 0 && onImported) onImported(imp);
  };

  const render = () => {
    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div class="modal-card setup-modal import-modal">
          <h3 id="import-title">Nhập ván cờ</h3>
          <div class="set-seg-3" style="margin-bottom:12px">
            <button type="button" class="mini-seg-btn${tab === 'file' ? ' is-selected' : ''}" data-itab="file">Chọn file</button>
            <button type="button" class="mini-seg-btn${tab === 'text' ? ' is-selected' : ''}" data-itab="text">Dán JSON/PGN</button>
            <button type="button" class="mini-seg-btn${tab === 'fen' ? ' is-selected' : ''}" data-itab="fen">Dán FEN</button>
          </div>
          ${
            tab === 'file'
              ? `
                <div class="import-file-box">
                  <input type="file" id="imp-file-input" accept=".json,.pgn,.txt" multiple>
                  <p class="set-hint">Hỗ trợ .xqgame.json, .pgn, .txt và file gói sao lưu (nhiều ván).</p>
                </div>
              `
              : tab === 'text'
                ? `
                  <textarea id="imp-text-area" class="set-textarea" rows="6" placeholder="Dán nội dung JSON hoặc PGN vào đây..."></textarea>
                  <div class="modal-actions" style="margin-top:8px">
                    <button type="button" class="pill-btn pill-btn-gold" data-imp="paste">Nhập văn bản</button>
                  </div>
                `
                : `
                  <input id="imp-fen-input" type="text" class="set-input" placeholder="Dán chuỗi FEN Cờ Tướng hoặc Cờ Úp...">
                  <div class="modal-actions" style="margin-top:10px">
                    <button type="button" class="pill-btn" data-imp="fen-check">Kiểm tra FEN</button>
                    <button type="button" class="pill-btn pill-btn-gold" data-imp="fen-play" ${fenParsed ? '' : 'disabled'}>Chơi từ thế cờ này</button>
                  </div>
                `
          }
          <div class="import-summary" ${summary ? '' : 'hidden'}></div>
          <ul class="import-err-list" ${errLines.length ? '' : 'hidden'}></ul>
          <div class="modal-actions" style="margin-top:14px">
            <button type="button" class="pill-btn modal-close">Đóng</button>
          </div>
        </div>
      </div>
    `;

    if (summary) {
      const sEl = modalRoot.querySelector('.import-summary');
      sEl.textContent = summary;
      sEl.className = `import-summary ${errLines.length ? 'has-err' : 'is-ok'}`;
    }
    if (errLines.length) {
      const ul = modalRoot.querySelector('.import-err-list');
      for (const e of errLines.slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = e;
        ul.appendChild(li);
      }
    }

    modalRoot.querySelectorAll('[data-itab]').forEach((b) => {
      b.addEventListener('click', () => {
        tab = b.dataset.itab;
        summary = '';
        errLines = [];
        fenParsed = null;
        render();
      });
    });

    const fileInput = modalRoot.querySelector('#imp-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) handleFiles(fileInput.files);
      });
    }

    const pasteBtn = modalRoot.querySelector('[data-imp="paste"]');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', async () => {
        const text = modalRoot.querySelector('#imp-text-area').value;
        const r = await importTextIntoStore(ctx, text);
        summary = `Đã nhập ${r.imported} ván${r.failed > 0 ? `, ${r.failed} lỗi` : ''}.`;
        errLines = r.errors;
        render();
        if (r.imported > 0 && onImported) onImported(r.imported);
      });
    }

    const fenCheckBtn = modalRoot.querySelector('[data-imp="fen-check"]');
    if (fenCheckBtn) {
      fenCheckBtn.addEventListener('click', () => {
        const val = modalRoot.querySelector('#imp-fen-input').value.trim();
        const res = fenToPosition(val);
        if (res.ok) {
          fenParsed = {
            variant: res.board.isJieqi ? 'jieqi' : 'xiangqi',
            fen: res.board.isJieqi ? res.board.publicFen() : res.board.toFen(),
            pool: res.board.isJieqi ? res.board.getPool() : null,
          };
          summary = `FEN hợp lệ (${fenParsed.variant === 'jieqi' ? 'Cờ Úp' : 'Cờ Tướng'}).`;
          errLines = [];
        } else {
          fenParsed = null;
          summary = 'FEN không hợp lệ.';
          errLines = [res.error.message];
        }
        render();
        const inp = modalRoot.querySelector('#imp-fen-input');
        if (inp) inp.value = val;
      });
    }

    const fenPlayBtn = modalRoot.querySelector('[data-imp="fen-play"]');
    if (fenPlayBtn) {
      fenPlayBtn.addEventListener('click', () => {
        if (!fenParsed) return;
        const p = fenParsed;
        close();
        openContinueFromPositionModal(ctx, p);
      });
    }

    modalRoot.querySelector('.modal-close').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
  };

  render();
  if (initialFiles && initialFiles.length > 0) {
    handleFiles(initialFiles);
  }
}
