/**
 * Online Quick-Match and Private Room modals (theme-aware, keyboard accessible,
 * zero innerHTML injection of user-provided strings).
 */
import { OnlineConnection } from './connection.js';
import { TIME_CONTROL_LIST, normalizeRoomCode, isValidRoomCode } from './protocol.js';
import { leakTracker } from '../app/router.js';

const GAME_LABELS = {
  cotuong: 'Cờ Tướng',
  coup: 'Cờ Úp',
};

function createConnection(ctx) {
  const s = ctx.settingsStore.get();
  return new OnlineConnection({
    nickname: s.nickname || s.online?.nickname || 'Kỳ thủ',
    serverUrl: s.online?.serverUrl || '',
  });
}

export function openQuickMatchModal(ctx, game, onlineInfo) {
  const st = ctx.settingsStore.get();
  let chosenTc = st.last.tc || 'nhanh';
  let conn = null;
  let elapsedTimer = null;
  let elapsedSec = 0;
  let closed = false;

  const cleanup = (keepConn = false) => {
    closed = true;
    if (elapsedTimer) {
      window.clearInterval(elapsedTimer);
      elapsedTimer = null;
      leakTracker.trackTimer(-1);
    }
    if (conn && !keepConn) {
      conn.send('queue.leave');
      conn.close();
      conn = null;
    }
    ctx.modalRoot.hidden = true;
    ctx.modalRoot.innerHTML = '';
  };

  const renderSetup = (errMsg = '') => {
    ctx.modalRoot.hidden = false;
    ctx.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="online-setup-title">
        <div class="modal-card setup-modal">
          <h3 id="online-setup-title">${GAME_LABELS[game] || 'Cờ Tướng'} · Đấu online</h3>
          <div class="tc-grid">
            ${TIME_CONTROL_LIST.map(
              (tc) => `<button type="button" class="tc-card${tc.id === chosenTc ? ' is-selected' : ''}" data-tc="${tc.id}"><strong>${tc.label}</strong><span>${tc.short}</span></button>`
            ).join('')}
          </div>
          <div class="online-err-msg" ${errMsg ? '' : 'hidden'}></div>
          <div class="modal-actions" style="margin-top:16px">
            <button type="button" class="pill-btn modal-cancel">Hủy</button>
            <button type="button" class="pill-btn pill-btn-gold modal-find" ${!onlineInfo.ok ? 'disabled' : ''}>Tìm đối thủ</button>
          </div>
        </div>
      </div>
    `;
    const errEl = ctx.modalRoot.querySelector('.online-err-msg');
    if (errEl && errMsg) errEl.textContent = errMsg;

    ctx.modalRoot.querySelectorAll('[data-tc]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenTc = b.dataset.tc;
        ctx.modalRoot.querySelectorAll('[data-tc]').forEach((x) => x.classList.toggle('is-selected', x === b));
      });
    });
    ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', () => cleanup(false));
    ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) cleanup(false);
    });
    ctx.modalRoot.querySelector('.modal-find').addEventListener('click', () => startSearch());
  };

  const renderSearching = (onlineCount) => {
    ctx.modalRoot.hidden = false;
    ctx.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="online-search-title">
        <div class="modal-card setup-modal online-searching-card">
          <div class="search-ring" aria-hidden="true"></div>
          <h3 id="online-search-title">Đang tìm đối thủ…</h3>
          <p class="search-meta">${GAME_LABELS[game] || 'Cờ Tướng'} · <span class="search-tc"></span></p>
          <p class="search-timer">00:00 · Đang online: <strong class="search-online-count">0</strong></p>
          <div class="modal-actions" style="margin-top:14px">
            <button type="button" class="pill-btn modal-cancel-search">Hủy tìm</button>
          </div>
        </div>
      </div>
    `;
    const tcObj = TIME_CONTROL_LIST.find((t) => t.id === chosenTc);
    ctx.modalRoot.querySelector('.search-tc').textContent = tcObj ? tcObj.label : chosenTc;
    ctx.modalRoot.querySelector('.search-online-count').textContent = String(onlineCount || 1);
    ctx.modalRoot.querySelector('.modal-cancel-search').addEventListener('click', () => cleanup(false));
  };

  const startSearch = async () => {
    ctx.settingsStore.update((s) => {
      s.last.game = game;
      s.last.mode = 'online';
      s.last.tc = chosenTc;
    });
    conn = createConnection(ctx);
    renderSearching(onlineInfo.onlineCount || onlineInfo.players || 1);

    elapsedSec = 0;
    leakTracker.trackTimer(1);
    elapsedTimer = window.setInterval(() => {
      if (closed) return;
      elapsedSec++;
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(elapsedSec % 60).padStart(2, '0');
      const el = ctx.modalRoot.querySelector('.search-timer');
      if (el) {
        el.innerHTML = `${mm}:${ss} · Đang online: <strong class="search-online-count">${conn?.onlineCount || 1}</strong>`;
      }
    }, 1000);

    conn.on('welcome', (msg) => {
      if (closed) return;
      const cEl = ctx.modalRoot.querySelector('.search-online-count');
      if (cEl) cEl.textContent = String(msg.onlineCount || 1);
      conn.send('queue.join', { variant: game, tc: chosenTc });
    });

    conn.on('queue.timeout', () => {
      if (closed) return;
      if (elapsedTimer) {
        window.clearInterval(elapsedTimer);
        elapsedTimer = null;
        leakTracker.trackTimer(-1);
      }
      if (conn) {
        conn.close();
        conn = null;
      }
      renderSetup('Hết thời gian chờ (2 phút). Vui lòng thử lại.');
    });

    conn.on('error', (msg) => {
      if (closed) return;
      if (elapsedTimer) {
        window.clearInterval(elapsedTimer);
        elapsedTimer = null;
        leakTracker.trackTimer(-1);
      }
      if (conn) {
        conn.close();
        conn = null;
      }
      renderSetup(msg.message || 'Không thể tìm trận.');
    });

    conn.on('game.start', (gameState) => {
      if (closed) return;
      ctx.onlineSession = { conn, gameState };
      cleanup(true);
      ctx.router.navigate(`/play/${gameState.variant}/online`);
    });

    const ok = await conn.connect();
    if (!ok && !closed) {
      cleanup(false);
      renderSetup('Không thể kết nối máy chủ online.');
    }
  };

  renderSetup();
}

export function openRoomModal(ctx, game, prefillCode = '', onlineInfo = { ok: true }) {
  const st = ctx.settingsStore.get();
  let tab = prefillCode ? 'join' : 'create';
  let chosenTc = st.last.tc || 'nhanh';
  let chosenSide = 'random';
  let codeChars = normalizeRoomCode(prefillCode).padEnd(6, ' ').slice(0, 6).split('');
  let conn = null;
  let roomState = null;
  let errText = '';
  let closed = false;

  const cleanup = (keepConn = false) => {
    closed = true;
    if (conn && !keepConn) {
      conn.send('room.leave');
      conn.close();
      conn = null;
    }
    ctx.modalRoot.hidden = true;
    ctx.modalRoot.innerHTML = '';
  };

  const ensureConn = async () => {
    if (conn && conn.status === 'open') return true;
    conn = createConnection(ctx);
    conn.on('room.created', (r) => {
      if (closed) return;
      roomState = { ...r, isHost: true };
      errText = '';
      render();
    });
    conn.on('room.joined', (r) => {
      if (closed) return;
      roomState = { ...r, isHost: false };
      errText = '';
      render();
    });
    conn.on('room.update', (r) => {
      if (closed || !roomState) return;
      roomState = { ...roomState, ...r };
      render();
    });
    conn.on('room.closed', () => {
      if (closed) return;
      roomState = null;
      errText = 'Phòng đã đóng hoặc hết hạn.';
      render();
    });
    conn.on('error', (msg) => {
      if (closed) return;
      errText = msg.message || 'Có lỗi xảy ra.';
      render();
    });
    conn.on('game.start', (gameState) => {
      if (closed) return;
      ctx.onlineSession = { conn, gameState };
      cleanup(true);
      ctx.router.navigate(`/play/${gameState.variant}/online`);
    });

    const welcomePromise = new Promise((resolve) => {
      const off = conn.on('welcome', () => {
        off();
        resolve(true);
      });
      window.setTimeout(() => {
        off();
        resolve(false);
      }, 3000);
    });
    const ok = await conn.connect();
    if (!ok) return false;
    return welcomePromise;
  };

  const render = () => {
    ctx.modalRoot.hidden = false;

    if (roomState) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}#/join/${roomState.code}`;
      const tcObj = TIME_CONTROL_LIST.find((t) => t.id === roomState.tc);
      ctx.modalRoot.innerHTML = `
        <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="room-wait-title">
          <div class="modal-card setup-modal">
            <h3 id="room-wait-title">${GAME_LABELS[roomState.variant] || 'Cờ Tướng'} · Phòng riêng</h3>
            <div class="room-code-tiles" aria-label="Mã phòng">
              ${roomState.code.split('').map((ch) => `<span class="room-code-tile">${ch}</span>`).join('')}
            </div>
            <div class="room-copy-row">
              <button type="button" class="mini-seg-btn" data-copy="code">Sao chép mã</button>
              <button type="button" class="mini-seg-btn" data-copy="link">Sao chép link mời</button>
            </div>
            <div class="room-players-box">
              <div class="room-player-row"><span>Chủ phòng:</span><strong class="rp-host"></strong></div>
              <div class="room-player-row"><span>Đối thủ:</span><strong class="rp-guest"></strong></div>
              <div class="room-player-row"><span>Thời gian:</span><strong class="rp-tc"></strong></div>
            </div>
            <div class="online-err-msg" ${errText ? '' : 'hidden'}></div>
            <div class="modal-actions" style="margin-top:14px">
              <button type="button" class="pill-btn modal-leave-room">Rời phòng</button>
              ${
                roomState.isHost
                  ? `<button type="button" class="pill-btn pill-btn-gold modal-start-room" ${roomState.guest ? '' : 'disabled'}>Bắt đầu</button>`
                  : `<span class="set-hint">Đang chờ chủ phòng bắt đầu…</span>`
              }
            </div>
          </div>
        </div>
      `;
      ctx.modalRoot.querySelector('.rp-host').textContent = roomState.host?.nickname || 'Chủ phòng';
      ctx.modalRoot.querySelector('.rp-guest').textContent = roomState.guest ? roomState.guest.nickname : 'Đang chờ đối thủ…';
      ctx.modalRoot.querySelector('.rp-tc').textContent = tcObj ? tcObj.label : roomState.tc;
      if (errText) ctx.modalRoot.querySelector('.online-err-msg').textContent = errText;

      ctx.modalRoot.querySelector('[data-copy="code"]').addEventListener('click', (ev) => {
        navigator.clipboard?.writeText(roomState.code).catch(() => {});
        ev.currentTarget.textContent = 'Đã chép mã ✓';
      });
      ctx.modalRoot.querySelector('[data-copy="link"]').addEventListener('click', (ev) => {
        navigator.clipboard?.writeText(inviteUrl).catch(() => {});
        ev.currentTarget.textContent = 'Đã chép link ✓';
      });
      ctx.modalRoot.querySelector('.modal-leave-room').addEventListener('click', () => cleanup(false));
      const startBtn = ctx.modalRoot.querySelector('.modal-start-room');
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          conn?.send('room.start', { code: roomState.code });
        });
      }
      return;
    }

    ctx.modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="room-setup-title">
        <div class="modal-card setup-modal">
          <h3 id="room-setup-title">${GAME_LABELS[game] || 'Cờ Tướng'} · Phòng riêng</h3>
          <div class="set-seg-2" style="margin-bottom:12px">
            <button type="button" class="mini-seg-btn${tab === 'create' ? ' is-selected' : ''}" data-rtab="create">Tạo phòng</button>
            <button type="button" class="mini-seg-btn${tab === 'join' ? ' is-selected' : ''}" data-rtab="join">Nhập mã</button>
          </div>
          ${
            tab === 'create'
              ? `
                <div class="tc-grid">
                  ${TIME_CONTROL_LIST.map(
                    (tc) => `<button type="button" class="tc-card${tc.id === chosenTc ? ' is-selected' : ''}" data-tc="${tc.id}"><strong>${tc.label}</strong><span>${tc.short}</span></button>`
                  ).join('')}
                </div>
                <div class="set-field" style="margin-top:10px">
                  <label>Chủ phòng cầm</label>
                  <div class="set-seg-3">
                    <button type="button" class="mini-seg-btn${chosenSide === 'red' ? ' is-selected' : ''}" data-rside="red">Đỏ</button>
                    <button type="button" class="mini-seg-btn${chosenSide === 'black' ? ' is-selected' : ''}" data-rside="black">Đen</button>
                    <button type="button" class="mini-seg-btn${chosenSide === 'random' ? ' is-selected' : ''}" data-rside="random">Ngẫu nhiên</button>
                  </div>
                </div>
              `
              : `
                <div class="code-boxes" aria-label="Nhập mã phòng 6 ký tự">
                  ${codeChars
                    .map(
                      (ch, idx) =>
                        `<input type="text" class="code-box" maxlength="1" data-cidx="${idx}" value="${ch.trim()}" aria-label="Ký tự ${idx + 1}">`
                    )
                    .join('')}
                </div>
              `
          }
          <div class="online-err-msg" ${errText ? '' : 'hidden'}></div>
          <div class="modal-actions" style="margin-top:16px">
            <button type="button" class="pill-btn modal-cancel">Đóng</button>
            ${
              tab === 'create'
                ? `<button type="button" class="pill-btn pill-btn-gold modal-create-room" ${!onlineInfo.ok ? 'disabled' : ''}>Tạo phòng</button>`
                : `<button type="button" class="pill-btn pill-btn-gold modal-join-room">Vào phòng</button>`
            }
          </div>
        </div>
      </div>
    `;
    if (errText) ctx.modalRoot.querySelector('.online-err-msg').textContent = errText;

    ctx.modalRoot.querySelectorAll('[data-rtab]').forEach((b) => {
      b.addEventListener('click', () => {
        tab = b.dataset.rtab;
        errText = '';
        render();
      });
    });
    ctx.modalRoot.querySelectorAll('[data-tc]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenTc = b.dataset.tc;
        ctx.modalRoot.querySelectorAll('[data-tc]').forEach((x) => x.classList.toggle('is-selected', x === b));
      });
    });
    ctx.modalRoot.querySelectorAll('[data-rside]').forEach((b) => {
      b.addEventListener('click', () => {
        chosenSide = b.dataset.rside;
        ctx.modalRoot.querySelectorAll('[data-rside]').forEach((x) => x.classList.toggle('is-selected', x === b));
      });
    });

    const boxes = [...ctx.modalRoot.querySelectorAll('.code-box')];
    boxes.forEach((box, idx) => {
      box.addEventListener('input', () => {
        const val = normalizeRoomCode(box.value).slice(0, 1);
        box.value = val;
        codeChars[idx] = val || ' ';
        if (val && idx < boxes.length - 1) boxes[idx + 1].focus();
      });
      box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !box.value && idx > 0) {
          boxes[idx - 1].focus();
        }
      });
      box.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const pasted = normalizeRoomCode(ev.clipboardData?.getData('text') || '').slice(0, 6);
        for (let i = 0; i < 6; i++) {
          codeChars[i] = pasted[i] || ' ';
          if (boxes[i]) boxes[i].value = pasted[i] || '';
        }
        boxes[Math.min(5, pasted.length)]?.focus();
      });
    });

    ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', () => cleanup(false));
    ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) cleanup(false);
    });

    const createBtn = ctx.modalRoot.querySelector('.modal-create-room');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        const ok = await ensureConn();
        if (!ok) {
          errText = 'Không thể kết nối máy chủ online.';
          render();
          return;
        }
        conn.send('room.create', { variant: game, tc: chosenTc, side: chosenSide });
      });
    }

    const joinBtn = ctx.modalRoot.querySelector('.modal-join-room');
    if (joinBtn) {
      joinBtn.addEventListener('click', async () => {
        const code = normalizeRoomCode(codeChars.join(''));
        if (!isValidRoomCode(code)) {
          errText = 'Mã phòng gồm 6 ký tự hợp lệ.';
          render();
          return;
        }
        joinBtn.disabled = true;
        const ok = await ensureConn();
        if (!ok) {
          errText = 'Không thể kết nối máy chủ online.';
          render();
          return;
        }
        conn.send('room.join', { code });
      });
    }
  };

  render();
}
