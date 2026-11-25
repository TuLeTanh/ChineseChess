/**
 * Shared Settings modal opened from Lobby gear, Guest chip, or In-Game gear.
 * Supports keyboard focus trap, Esc close, live persistence via settingsStore,
 * nickname/URL validation, theme preview, background quality, audio, Cờ Úp toggles,
 * online connection check, data reset, and About/Licenses.
 */
import { isValidNickname, isValidServerUrl } from '../app/settings.js';

const APP_VERSION = '1.0.0';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openSettingsModal(ctx, initialTab = 'account', returnFocusEl = null) {
  const modalRoot = ctx.modalRoot;
  if (!modalRoot) return;

  let activeTab = initialTab || 'account';
  const prevFocus = returnFocusEl || document.activeElement;

  const close = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try {
        prevFocus.focus();
      } catch {
        // ignore
      }
    }
  };

  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key === 'Tab') {
      const focusables = modalRoot.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };

  const render = () => {
    const s = ctx.settingsStore.get();
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tabs = [
      { id: 'account', label: 'Tài khoản' },
      { id: 'appearance', label: 'Giao diện' },
      { id: 'audio', label: 'Âm thanh' },
      { id: 'game', label: 'Trò chơi' },
      { id: 'online', label: 'Online' },
      { id: 'data', label: 'Dữ liệu' },
      { id: 'about', label: 'Giới thiệu' },
    ];

    let bodyHtml = '';
    if (activeTab === 'account') {
      const shortGuest = s.guestId.slice(0, 8).toUpperCase();
      bodyHtml = `
        <div class="set-field">
          <label for="set-nickname">Tên hiển thị (2–16 ký tự)</label>
          <input id="set-nickname" type="text" class="set-input" maxlength="16" value="${escapeHtml(s.nickname)}" autocomplete="off">
          <div class="set-msg" id="set-nick-msg"></div>
        </div>
        <div class="set-field">
          <label>Mã khách</label>
          <div class="set-inline">
            <input type="text" class="set-input" value="${shortGuest}" readonly aria-label="Mã khách">
            <button type="button" class="pill-btn set-btn-sm" data-act="copy-guest">Sao chép</button>
          </div>
          <div class="set-hint">Dùng để nhận diện phiên chơi online và kết nối lại trận đấu.</div>
        </div>
      `;
    } else if (activeTab === 'appearance') {
      bodyHtml = `
        <div class="set-field">
          <label>Chủ đề bàn cờ</label>
          <div class="set-theme-grid">
            <button type="button" class="set-theme-card${s.theme === 'go-lim' ? ' is-selected' : ''}" data-set-theme="go-lim">
              <span class="set-swatch swatch-golim"></span>
              <span><strong>Gỗ Lim</strong><small>Gỗ ấm, quân ngà</small></span>
            </button>
            <button type="button" class="set-theme-card${s.theme === 'ngoc-bich' ? ' is-selected' : ''}" data-set-theme="ngoc-bich">
              <span class="set-swatch swatch-ngocbich"></span>
              <span><strong>Ngọc Bích</strong><small>Đá xanh, sơn mài</small></span>
            </button>
          </div>
        </div>
        <div class="set-field">
          <label>Hiệu ứng nền (Sảnh)</label>
          <div class="set-seg-3">
            <button type="button" class="mini-seg-btn${s.bgQuality === 'high' ? ' is-selected' : ''}" data-bgq="high">Cao</button>
            <button type="button" class="mini-seg-btn${s.bgQuality === 'low' ? ' is-selected' : ''}" data-bgq="low">Thấp</button>
            <button type="button" class="mini-seg-btn${s.bgQuality === 'off' ? ' is-selected' : ''}" data-bgq="off">Tắt</button>
          </div>
          ${reduced ? '<div class="set-hint">Hệ thống đang bật giảm chuyển động (prefers-reduced-motion); nền được hiển thị tĩnh.</div>' : ''}
        </div>
      `;
    } else if (activeTab === 'audio') {
      const pct = Math.round(s.audio.volume * 100);
      bodyHtml = `
        <div class="set-field">
          <label for="set-vol">Âm lượng tổng (<span id="set-vol-val">${pct}%</span>)</label>
          <input id="set-vol" type="range" class="volume-slider" min="0" max="100" value="${pct}">
        </div>
        <label class="set-toggle">
          <input type="checkbox" id="set-sfx-on" ${!s.audio.muted ? 'checked' : ''}>
          <span>Bật âm thanh (phím tắt M)</span>
        </label>
        <label class="set-toggle">
          <input type="checkbox" id="set-voice-on" ${s.audio.voice ? 'checked' : ''}>
          <span>Bật giọng hô tiếng Trung (phím tắt V)</span>
        </label>
      `;
    } else if (activeTab === 'game') {
      bodyHtml = `
        <div class="set-group-title">Cờ Úp (Jieqi)</div>
        <label class="set-toggle">
          <input type="checkbox" id="set-jq-pool" ${s.jieqi.showPool ? 'checked' : ''}>
          <span>Hiện bảng quân úp còn lại</span>
        </label>
        <label class="set-toggle">
          <input type="checkbox" id="set-jq-resign" ${s.jieqi.confirmResign ? 'checked' : ''}>
          <span>Xác nhận khi đầu hàng</span>
        </label>
      `;
    } else if (activeTab === 'online') {
      bodyHtml = `
        <div class="set-field">
          <label>Máy chủ online</label>
          <div class="set-hint">${s.online.serverUrl ? escapeHtml(s.online.serverUrl) : 'Tự động (cùng máy chủ hoặc cổng 8787 nội bộ)'}</div>
        </div>
        <details class="set-details"${s.online.serverUrl ? ' open' : ''}>
          <summary>Nâng cao</summary>
          <div class="set-field" style="margin-top:8px">
            <label for="set-srv-url">Địa chỉ máy chủ tùy chỉnh (http/https/ws/wss)</label>
            <input id="set-srv-url" type="url" class="set-input" placeholder="Để trống = Tự động" value="${escapeHtml(s.online.serverUrl)}">
            <div class="set-msg" id="set-url-msg"></div>
          </div>
        </details>
        <div class="set-field" style="margin-top:10px">
          <button type="button" class="pill-btn set-btn-sm" data-act="test-online">Kiểm tra kết nối</button>
          <div class="set-hint" id="set-online-status"></div>
        </div>
      `;
    } else if (activeTab === 'data') {
      bodyHtml = `
        <div class="set-field">
          <p class="set-hint">Xóa toàn bộ cài đặt đã lưu trong trình duyệt (tên hiển thị, giao diện, âm lượng, tùy chọn gần nhất).</p>
          <button type="button" class="pill-btn pill-btn-danger set-btn-sm" data-act="reset-data">Xóa dữ liệu đã lưu</button>
        </div>
      `;
    } else if (activeTab === 'about') {
      bodyHtml = `
        <div class="set-about">
          <p><strong>象棋 · Cờ Tướng &amp; Cờ Úp</strong> — phiên bản ${APP_VERSION}</p>
          <p class="set-hint">Giao diện SVG thuần không cần build, hỗ trợ đánh nội bộ, đấu máy (JS &amp; Pikafish) và đấu online.</p>
          <p class="set-hint">
            <a href="https://github.com/TuLeTanh/ChineseChess#gi%E1%BA%A5y-ph%C3%A9p-v%C3%A0-ghi-c%C3%B4ng" target="_blank" rel="noopener noreferrer">Giấy phép &amp; Ghi công (README)</a>
          </p>
        </div>
      `;
    }

    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-card settings-modal">
          <div class="settings-header">
            <h3 id="settings-title">Cài đặt</h3>
            <button type="button" class="icon-btn settings-close" aria-label="Đóng cài đặt">✕</button>
          </div>
          <div class="settings-layout">
            <nav class="settings-tabs" role="tablist" aria-label="Nhóm cài đặt">
              ${tabs
                .map(
                  (t) =>
                    `<button type="button" role="tab" class="settings-tab${t.id === activeTab ? ' is-active' : ''}" aria-selected="${t.id === activeTab}" data-tab="${t.id}">${t.label}</button>`
                )
                .join('')}
            </nav>
            <div class="settings-body" role="tabpanel">${bodyHtml}</div>
          </div>
        </div>
      </div>
    `;

    modalRoot.querySelector('.settings-close').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
    modalRoot.querySelectorAll('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });

    // Wire tab-specific controls
    if (activeTab === 'account') {
      const nickInput = modalRoot.querySelector('#set-nickname');
      const nickMsg = modalRoot.querySelector('#set-nick-msg');
      nickInput.addEventListener('input', () => {
        const val = nickInput.value;
        if (isValidNickname(val)) {
          nickMsg.textContent = 'Đã lưu';
          nickMsg.className = 'set-msg is-ok';
          ctx.settingsStore.update((st) => {
            st.nickname = val.trim().replace(/\s+/g, ' ');
          });
        } else {
          nickMsg.textContent = 'Tên cần 2–16 ký tự (chữ, số, khoảng trắng, _ hoặc -)';
          nickMsg.className = 'set-msg is-err';
        }
      });
      modalRoot.querySelector('[data-act="copy-guest"]').addEventListener('click', async (ev) => {
        try {
          await navigator.clipboard.writeText(s.guestId);
          ev.currentTarget.textContent = 'Đã chép!';
          window.setTimeout(() => {
            if (ev.currentTarget) ev.currentTarget.textContent = 'Sao chép';
          }, 1200);
        } catch {
          // ignore clipboard errors
        }
      });
    } else if (activeTab === 'appearance') {
      modalRoot.querySelectorAll('[data-set-theme]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ctx.setThemeById(btn.dataset.setTheme);
          render();
        });
      });
      modalRoot.querySelectorAll('[data-bgq]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ctx.settingsStore.update((st) => {
            st.bgQuality = btn.dataset.bgq;
          });
          render();
        });
      });
    } else if (activeTab === 'audio') {
      const volEl = modalRoot.querySelector('#set-vol');
      const volVal = modalRoot.querySelector('#set-vol-val');
      volEl.addEventListener('input', () => {
        volVal.textContent = `${volEl.value}%`;
        ctx.setVolume(Number(volEl.value) / 100);
      });
      modalRoot.querySelector('#set-sfx-on').addEventListener('change', (ev) => {
        const wantOn = ev.target.checked;
        if (ctx.sfx.isMuted() === wantOn) ctx.toggleMute();
      });
      modalRoot.querySelector('#set-voice-on').addEventListener('change', (ev) => {
        const wantOn = ev.target.checked;
        if (ctx.sfx.isVoiceEnabled() !== wantOn) ctx.toggleVoice();
      });
    } else if (activeTab === 'game') {
      modalRoot.querySelector('#set-jq-pool').addEventListener('change', (ev) => {
        ctx.settingsStore.update((st) => {
          st.jieqi.showPool = ev.target.checked;
        });
      });
      modalRoot.querySelector('#set-jq-resign').addEventListener('change', (ev) => {
        ctx.settingsStore.update((st) => {
          st.jieqi.confirmResign = ev.target.checked;
        });
      });
    } else if (activeTab === 'online') {
      const urlIn = modalRoot.querySelector('#set-srv-url');
      const urlMsg = modalRoot.querySelector('#set-url-msg');
      urlIn.addEventListener('input', () => {
        if (isValidServerUrl(urlIn.value)) {
          urlMsg.textContent = 'Hợp lệ';
          urlMsg.className = 'set-msg is-ok';
          ctx.settingsStore.update((st) => {
            st.online.serverUrl = urlIn.value.trim();
          });
        } else {
          urlMsg.textContent = 'URL phải bắt đầu bằng http://, https://, ws:// hoặc wss://';
          urlMsg.className = 'set-msg is-err';
        }
      });
      modalRoot.querySelector('[data-act="test-online"]').addEventListener('click', async () => {
        const statusEl = modalRoot.querySelector('#set-online-status');
        statusEl.textContent = 'Đang kiểm tra…';
        const res = ctx.probeOnline ? await ctx.probeOnline() : { ok: false };
        if (res.ok) {
          statusEl.textContent = `Kết nối thành công · ${res.latencyMs} ms · v${res.version || '1.0'} · ${res.players ?? 0} người online`;
        } else {
          statusEl.textContent = 'Chưa kết nối được máy chủ online.';
        }
      });
    } else if (activeTab === 'data') {
      modalRoot.querySelector('[data-act="reset-data"]').addEventListener('click', () => {
        if (window.confirm('Bạn có chắc muốn xóa toàn bộ dữ liệu cài đặt đã lưu?')) {
          ctx.settingsStore.resetAll();
          const st = ctx.settingsStore.get();
          ctx.setThemeById(st.theme);
          ctx.setVolume(st.audio.volume);
          render();
        }
      });
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  render();
  const closeBtn = modalRoot.querySelector('.settings-close');
  if (closeBtn) closeBtn.focus();
}
