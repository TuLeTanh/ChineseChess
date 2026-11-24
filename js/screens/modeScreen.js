/**
 * Mode Select (#/g/cotuong, #/g/coup), Quick-Match (#/g/<game>/online),
 * Private Room (#/g/<game>/room), and Join Link (#/join/<CODE>) screen.
 */
import { LobbyBackground } from '../ui/lobbyBackground.js';
import { openSettingsModal } from '../ui/settingsModal.js';
import { PikafishClient } from '../ai/pikafishClient.js';
import { AI_LEVELS } from '../ai/levels.js';
import { leakTracker } from '../app/router.js';

const GAME_META = {
  cotuong: {
    id: 'cotuong',
    title: 'Cờ Tướng',
    desc: 'Cờ tướng truyền thống đầy đủ luật, hỗ trợ máy JS & Pikafish',
  },
  coup: {
    id: 'coup',
    title: 'Cờ Úp',
    desc: 'Úp 15 quân ban đầu, lật quân bất ngờ sau mỗi nước đi',
  },
};

const TIME_CONTROLS = [
  { id: 'chop', name: 'Cờ chớp', sub: '3+2 (3 phút + 2 giây)' },
  { id: 'nhanh', name: 'Cờ nhanh', sub: '10+5 (10 phút + 5 giây)' },
  { id: 'cham', name: 'Cờ chậm', sub: '30+10 (30 phút + 10 giây)' },
];

export function createModeScreen(ctx) {
  let bg = null;
  let probeTimer = null;
  let unsubSettings = null;
  let onKeyDown = null;
  let destroyed = false;
  let onlineInfo = { ok: false, players: 0 };
  let pfAvailable = false;

  return {
    async mount(container, route) {
      destroyed = false;
      const game = route.game === 'coup' ? 'coup' : 'cotuong';
      const meta = GAME_META[game];
      const s = ctx.settingsStore.get();
      const theme = ctx.getTheme();

      const pfClient = new PikafishClient();
      const pf = await pfClient.probeInfo();
      if (destroyed) return;
      pfAvailable = Boolean(pf.available);

      container.className = 'lobby-shell mode-shell';
      container.innerHTML = `
        <div class="lobby-content mode-content">
          <header class="lobby-topbar">
            <button type="button" class="pill-btn mode-back-btn" data-act="back" title="Về sảnh (Esc)">← Sảnh</button>
            <div class="mode-head-title">
              <h1>${meta.title}</h1>
              <p>${meta.desc}</p>
            </div>
            <button type="button" class="pill-btn lobby-gear-btn" data-act="settings" aria-label="Cài đặt">⚙ Cài đặt</button>
          </header>

          <main class="mode-grid-wrap">
            <div class="mode-grid">
              <div class="mode-tile" data-tile="online" tabindex="0" role="button" aria-label="Đấu online — Tìm đối thủ ngẫu nhiên">
                <div class="mode-tile-icon" aria-hidden="true">🌐</div>
                <div class="mode-tile-title">Đấu online</div>
                <div class="mode-tile-sub">Tìm đối thủ ngẫu nhiên</div>
                <div class="mode-tile-badge" data-badge="online">Đang kiểm tra…</div>
                <div class="mode-offline-actions" hidden>
                  <button type="button" class="mini-seg-btn" data-act="retry-online">Thử lại</button>
                  <button type="button" class="mini-seg-btn" data-act="open-online-settings">Cài đặt</button>
                </div>
              </div>

              <div class="mode-tile" data-tile="room" tabindex="0" role="button" aria-label="Phòng riêng — Tạo phòng hoặc nhập mã">
                <div class="mode-tile-icon" aria-hidden="true">🔑</div>
                <div class="mode-tile-title">Phòng riêng</div>
                <div class="mode-tile-sub">Tạo phòng hoặc nhập mã</div>
                <div class="mode-tile-badge" data-badge="room">Đang kiểm tra…</div>
                <div class="mode-offline-actions" hidden>
                  <button type="button" class="mini-seg-btn" data-act="retry-online">Thử lại</button>
                  <button type="button" class="mini-seg-btn" data-act="open-online-settings">Cài đặt</button>
                </div>
              </div>

              <button type="button" class="mode-tile" data-tile="local">
                <div class="mode-tile-icon" aria-hidden="true">👥</div>
                <div class="mode-tile-title">Hai người</div>
                <div class="mode-tile-sub">Chơi chung một máy</div>
                <div class="mode-tile-badge is-ready">Sẵn sàng</div>
              </button>

              <button type="button" class="mode-tile" data-tile="ai">
                <div class="mode-tile-icon" aria-hidden="true">🤖</div>
                <div class="mode-tile-title">Đấu máy</div>
                <div class="mode-tile-sub">Thử sức với máy</div>
                <div class="mode-tile-badge is-ready">Sẵn sàng</div>
              </button>
            </div>
          </main>
        </div>
      `;

      const urlParams = new URLSearchParams(window.location.search);
      const seedParam = Number(urlParams.get('seed'));
      bg = new LobbyBackground({
        container,
        theme,
        quality: s.bgQuality,
        seed: Number.isFinite(seedParam) && urlParams.has('seed') ? seedParam : 20261124,
      });
      bg.setMood(game);

      const syncOnlineTiles = () => {
        const onlineTile = container.querySelector('[data-tile="online"]');
        const roomTile = container.querySelector('[data-tile="room"]');
        for (const tile of [onlineTile, roomTile]) {
          tile.classList.toggle('is-disabled', !onlineInfo.ok);
          tile.setAttribute('aria-disabled', String(!onlineInfo.ok));
          const offRow = tile.querySelector('.mode-offline-actions');
          if (offRow) offRow.hidden = onlineInfo.ok;
        }
        const b1 = container.querySelector('[data-badge="online"]');
        const b2 = container.querySelector('[data-badge="room"]');
        if (onlineInfo.ok) {
          b1.textContent = `Đang online: ${onlineInfo.players ?? 0}`;
          b1.className = 'mode-tile-badge is-ready';
          b2.textContent = 'Sẵn sàng';
          b2.className = 'mode-tile-badge is-ready';
        } else {
          b1.textContent = 'Chưa kết nối máy chủ online';
          b1.className = 'mode-tile-badge is-off';
          b2.textContent = 'Chưa kết nối máy chủ online';
          b2.className = 'mode-tile-badge is-off';
        }
      };

      const checkOnline = async () => {
        if (destroyed) return;
        onlineInfo = await ctx.probeOnline();
        if (!destroyed) syncOnlineTiles();
      };
      checkOnline();
      leakTracker.trackTimer(1);
      probeTimer = window.setInterval(checkOnline, 20000);

      const closeModal = () => {
        ctx.modalRoot.hidden = true;
        ctx.modalRoot.innerHTML = '';
      };

      const openAiSetup = () => {
        const st = ctx.settingsStore.get();
        let chosenSide = st.last.side || 'red';
        let chosenLevel = st.last.level || 'nghiep-du';
        let chosenEngine = game === 'cotuong' && pfAvailable && st.last.engine === 'pikafish' ? 'pikafish' : 'js';

        ctx.modalRoot.hidden = false;
        ctx.modalRoot.innerHTML = `
          <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ai-setup-title">
            <div class="modal-card setup-modal">
              <h3 id="ai-setup-title">${meta.title} · Đấu máy</h3>
              <div class="set-field">
                <label>Bạn cầm</label>
                <div class="set-seg-3">
                  <button type="button" class="mini-seg-btn${chosenSide === 'red' ? ' is-selected' : ''}" data-pick-side="red">Đỏ</button>
                  <button type="button" class="mini-seg-btn${chosenSide === 'black' ? ' is-selected' : ''}" data-pick-side="black">Đen</button>
                  <button type="button" class="mini-seg-btn${chosenSide === 'random' ? ' is-selected' : ''}" data-pick-side="random">Ngẫu nhiên</button>
                </div>
              </div>
              <div class="set-field">
                <label for="setup-level">Cấp độ</label>
                <select id="setup-level" class="ai-level-select" style="width:100%">
                  ${AI_LEVELS.map((l) => `<option value="${l.id}" ${l.id === chosenLevel ? 'selected' : ''}>${l.name}</option>`).join('')}
                </select>
              </div>
              ${
                game === 'cotuong' && pfAvailable
                  ? `<div class="set-field">
                      <label>Máy</label>
                      <div class="set-seg-2">
                        <button type="button" class="mini-seg-btn${chosenEngine === 'pikafish' ? ' is-selected' : ''}" data-pick-eng="pikafish">Pikafish</button>
                        <button type="button" class="mini-seg-btn${chosenEngine === 'js' ? ' is-selected' : ''}" data-pick-eng="js">Nội bộ (JS)</button>
                      </div>
                    </div>`
                  : `<div class="set-hint">${game === 'coup' ? 'Cờ Úp dùng máy nội bộ (JS PIMC).' : 'Đang dùng máy nội bộ (JS).'}</div>`
              }
              <div class="modal-actions" style="margin-top:16px">
                <button type="button" class="pill-btn modal-cancel">Hủy</button>
                <button type="button" class="pill-btn pill-btn-gold modal-start">Bắt đầu</button>
              </div>
            </div>
          </div>
        `;

        ctx.modalRoot.querySelectorAll('[data-pick-side]').forEach((b) => {
          b.addEventListener('click', () => {
            chosenSide = b.dataset.pickSide;
            ctx.modalRoot.querySelectorAll('[data-pick-side]').forEach((x) => x.classList.toggle('is-selected', x === b));
          });
        });
        ctx.modalRoot.querySelectorAll('[data-pick-eng]').forEach((b) => {
          b.addEventListener('click', () => {
            chosenEngine = b.dataset.pickEng;
            ctx.modalRoot.querySelectorAll('[data-pick-eng]').forEach((x) => x.classList.toggle('is-selected', x === b));
          });
        });
        ctx.modalRoot.querySelector('#setup-level').addEventListener('change', (ev) => {
          chosenLevel = ev.target.value;
        });
        ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', closeModal);
        ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
          if (ev.target === ev.currentTarget) closeModal();
        });
        ctx.modalRoot.querySelector('.modal-start').addEventListener('click', () => {
          ctx.settingsStore.update((st2) => {
            st2.last.game = game;
            st2.last.mode = 'ai';
            st2.last.side = chosenSide;
            st2.last.level = chosenLevel;
            st2.last.engine = chosenEngine;
          });
          closeModal();
          ctx.router.navigate(`/play/${game}/ai`, {
            side: chosenSide,
            level: chosenLevel,
            engine: chosenEngine,
          });
        });
      };

      const openLocalSetup = () => {
        const st = ctx.settingsStore.get();
        ctx.modalRoot.hidden = false;
        ctx.modalRoot.innerHTML = `
          <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="local-setup-title">
            <div class="modal-card setup-modal">
              <h3 id="local-setup-title">${meta.title} · Hai người</h3>
              ${
                game === 'cotuong'
                  ? `<label class="set-toggle">
                      <input type="checkbox" id="setup-free" ${st.last.freeMove ? 'checked' : ''}>
                      <span>Đi tự do (luyện tập)</span>
                    </label>`
                  : ''
              }
              <label class="set-toggle">
                <input type="checkbox" id="setup-autoflip" ${st.last.autoFlip ? 'checked' : ''}>
                <span>Xoay bàn sau mỗi nước</span>
              </label>
              <div class="modal-actions" style="margin-top:16px">
                <button type="button" class="pill-btn modal-cancel">Hủy</button>
                <button type="button" class="pill-btn pill-btn-gold modal-start">Bắt đầu</button>
              </div>
            </div>
          </div>
        `;
        ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', closeModal);
        ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
          if (ev.target === ev.currentTarget) closeModal();
        });
        ctx.modalRoot.querySelector('.modal-start').addEventListener('click', () => {
          const free = Boolean(ctx.modalRoot.querySelector('#setup-free')?.checked);
          const autoflip = Boolean(ctx.modalRoot.querySelector('#setup-autoflip')?.checked);
          ctx.settingsStore.update((st2) => {
            st2.last.game = game;
            st2.last.mode = 'local';
            st2.last.freeMove = free;
            st2.last.autoFlip = autoflip;
          });
          closeModal();
          ctx.router.navigate(`/play/${game}/local`, {
            free: free ? '1' : undefined,
            autoflip: autoflip ? '1' : undefined,
          });
        });
      };

      const openOnlineSetup = () => {
        if (ctx.openQuickMatchModal) {
          ctx.openQuickMatchModal(game, onlineInfo);
          return;
        }
        const st = ctx.settingsStore.get();
        let chosenTc = st.last.tc || 'nhanh';
        ctx.modalRoot.hidden = false;
        ctx.modalRoot.innerHTML = `
          <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="online-setup-title">
            <div class="modal-card setup-modal">
              <h3 id="online-setup-title">${meta.title} · Đấu online</h3>
              <div class="tc-grid">
                ${TIME_CONTROLS.map(
                  (tc) => `<button type="button" class="tc-card${tc.id === chosenTc ? ' is-selected' : ''}" data-tc="${tc.id}"><strong>${tc.name}</strong><span>${tc.sub}</span></button>`
                ).join('')}
              </div>
              <div class="modal-actions" style="margin-top:16px">
                <button type="button" class="pill-btn modal-cancel">Hủy</button>
                <button type="button" class="pill-btn pill-btn-gold modal-find" ${!onlineInfo.ok ? 'disabled' : ''}>Tìm đối thủ</button>
              </div>
            </div>
          </div>
        `;
        ctx.modalRoot.querySelectorAll('[data-tc]').forEach((b) => {
          b.addEventListener('click', () => {
            chosenTc = b.dataset.tc;
            ctx.modalRoot.querySelectorAll('[data-tc]').forEach((x) => x.classList.toggle('is-selected', x === b));
          });
        });
        ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', closeModal);
        ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
          if (ev.target === ev.currentTarget) closeModal();
        });
      };

      const openRoomSetup = (prefillCode = '') => {
        if (ctx.openRoomModal) {
          ctx.openRoomModal(game, prefillCode, onlineInfo);
          return;
        }
        let tab = prefillCode ? 'join' : 'create';
        const codeChars = prefillCode.toUpperCase().padEnd(6, ' ').slice(0, 6).split('');
        ctx.modalRoot.hidden = false;
        const renderRoomModal = () => {
          ctx.modalRoot.innerHTML = `
            <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="room-setup-title">
              <div class="modal-card setup-modal">
                <h3 id="room-setup-title">${meta.title} · Phòng riêng</h3>
                <div class="set-seg-2" style="margin-bottom:12px">
                  <button type="button" class="mini-seg-btn${tab === 'create' ? ' is-selected' : ''}" data-rtab="create">Tạo phòng</button>
                  <button type="button" class="mini-seg-btn${tab === 'join' ? ' is-selected' : ''}" data-rtab="join">Nhập mã</button>
                </div>
                ${
                  tab === 'create'
                    ? `<div class="set-hint">Kết nối máy chủ online để tạo phòng riêng và chia sẻ mã 6 ký tự.</div>`
                    : `<div class="code-boxes" aria-label="Nhập mã phòng 6 ký tự">
                        ${codeChars
                          .map(
                            (ch, idx) =>
                              `<input type="text" class="code-box" maxlength="1" data-cidx="${idx}" value="${ch.trim()}" aria-label="Ký tự ${idx + 1}">`
                          )
                          .join('')}
                      </div>`
                }
                <div class="modal-actions" style="margin-top:16px">
                  <button type="button" class="pill-btn modal-cancel">Đóng</button>
                </div>
              </div>
            </div>
          `;
          ctx.modalRoot.querySelectorAll('[data-rtab]').forEach((b) => {
            b.addEventListener('click', () => {
              tab = b.dataset.rtab;
              renderRoomModal();
            });
          });
          ctx.modalRoot.querySelector('.modal-cancel').addEventListener('click', closeModal);
          ctx.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
            if (ev.target === ev.currentTarget) closeModal();
          });
        };
        renderRoomModal();
      };

      // Wire mode tiles & buttons
      container.querySelector('[data-act="back"]').addEventListener('click', () => ctx.router.navigate('/'));
      container.querySelector('[data-act="settings"]').addEventListener('click', (ev) => {
        openSettingsModal(ctx, 'appearance', ev.currentTarget);
      });
      container.querySelectorAll('[data-act="retry-online"]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          checkOnline();
        });
      });
      container.querySelectorAll('[data-act="open-online-settings"]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openSettingsModal(ctx, 'online', ev.currentTarget);
        });
      });

      const wireTileClick = (sel, fn) => {
        const el = container.querySelector(sel);
        el.addEventListener('click', fn);
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            fn();
          }
        });
      };
      wireTileClick('[data-tile="ai"]', openAiSetup);
      wireTileClick('[data-tile="local"]', openLocalSetup);
      wireTileClick('[data-tile="online"]', () => {
        if (onlineInfo.ok) openOnlineSetup();
      });
      wireTileClick('[data-tile="room"]', () => {
        if (onlineInfo.ok) openRoomSetup('');
      });

      // Deep links (#/g/<game>/online, #/g/<game>/room, #/join/<CODE>)
      if (route.name === 'online') openOnlineSetup();
      else if (route.name === 'room') openRoomSetup('');
      else if (route.name === 'join') openRoomSetup(route.code || '');

      unsubSettings = ctx.settingsStore.subscribe((st) => {
        if (destroyed) return;
        if (bg) {
          bg.setTheme(ctx.getTheme());
          bg.setQuality(st.bgQuality);
        }
      });

      onKeyDown = (ev) => {
        if (ev.key === 'Escape') {
          if (ctx.modalRoot && !ctx.modalRoot.hidden) {
            closeModal();
          } else {
            ctx.router.navigate('/');
          }
        }
      };
      window.addEventListener('keydown', onKeyDown);
      leakTracker.trackListener(1);
    },

    unmount() {
      destroyed = true;
      if (probeTimer) {
        window.clearInterval(probeTimer);
        probeTimer = null;
        leakTracker.trackTimer(-1);
      }
      if (unsubSettings) {
        unsubSettings();
        unsubSettings = null;
      }
      if (onKeyDown) {
        window.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
        leakTracker.trackListener(-1);
      }
      if (bg) {
        bg.destroy();
        bg = null;
      }
      if (ctx.modalRoot) {
        ctx.modalRoot.hidden = true;
        ctx.modalRoot.innerHTML = '';
      }
    },
  };
}
