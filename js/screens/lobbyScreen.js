/**
 * Lobby Screen (#/):
 * - Animated "Đêm hội đèn lồng bên sông" background
 * - Top bar: 象棋 wordmark, online status pill, guest chip (-> Settings > Tài khoản), gear button
 * - Two glassy game cards (Cờ Tướng with real 帥 SVG; Cờ Úp with covered piece that flips on hover/focus)
 * - Elo placeholder bar on each card
 * - Footer: version, GitHub link, quick sound toggle
 * - Responsive down to 360 px with zero horizontal scroll
 */
import { buildPieceSymbolsDefs, pieceSymbolId } from '../render/pieceSvg.js';
import { LobbyBackground } from '../ui/lobbyBackground.js';
import { renderEloBar } from '../ui/eloBar.js';
import { openSettingsModal } from '../ui/settingsModal.js';
import { openImportModal, formatRelativeDateVi } from '../ui/saveModals.js';
import { variantToRouteGame } from '../storage/gameRecord.js';
import { leakTracker } from '../app/router.js';

const APP_VERSION = 'v1.0.0';
const FLIP_POOL = ['chariot', 'horse', 'cannon', 'elephant', 'advisor', 'soldier'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildCoveredBackSvg(theme) {
  const isJade = theme.id === 'ngoc-bich';
  const fillA = isJade ? '#8F1E17' : '#9B241C';
  const fillB = isJade ? '#4A0D09' : '#58120D';
  const ring = '#F3CE72';
  return `
    <svg class="lobby-piece-svg" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
      <defs>
        <radialGradient id="lb-back-red" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stop-color="${fillA}"/>
          <stop offset="100%" stop-color="${fillB}"/>
        </radialGradient>
      </defs>
      <circle cx="60" cy="64" r="46" fill="rgba(0,0,0,0.42)"/>
      <circle cx="60" cy="58" r="46" fill="#3B0B08" stroke="#240604" stroke-width="2"/>
      <circle cx="60" cy="56" r="44" fill="url(#lb-back-red)" stroke="${ring}" stroke-width="2.2"/>
      <circle cx="60" cy="56" r="36" fill="none" stroke="${ring}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.82"/>
      <circle cx="60" cy="56" r="26" fill="none" stroke="${ring}" stroke-width="1.3" opacity="0.68"/>
      <path d="M 60 34 C 66 44, 74 48, 82 56 C 74 64, 66 68, 60 78 C 54 68, 46 64, 38 56 C 46 48, 54 44, 60 34 Z"
        fill="none" stroke="${ring}" stroke-width="2" opacity="0.9"/>
      <circle cx="60" cy="56" r="7" fill="${ring}" opacity="0.88"/>
    </svg>
  `;
}

export function createLobbyScreen(ctx) {
  let bg = null;
  let unsubSettings = null;
  let probeTimer = null;
  let destroyed = false;
  let onlineState = { ok: false, latencyMs: null, players: 0 };

  return {
    async mount(container) {
      destroyed = false;
      const urlParams = new URLSearchParams(window.location.search);
      const seedParam = Number(urlParams.get('seed'));
      const seed = Number.isFinite(seedParam) && urlParams.has('seed') ? seedParam : 20261124;

      const s = ctx.settingsStore.get();
      const theme = ctx.getTheme();

      container.className = 'lobby-shell';
      container.innerHTML = `
        <div class="lobby-content">
          <header class="lobby-topbar">
            <div class="lobby-brand">
              <span class="lobby-wordmark">象棋</span>
              <span class="lobby-brand-sub">Cờ Tướng · Cờ Úp</span>
            </div>
            <div class="lobby-top-actions">
              <div class="online-pill is-offline" title="Trạng thái máy chủ online">
                <span class="online-dot"></span>
                <span class="online-pill-text">Ngoại tuyến</span>
              </div>
              <button type="button" class="pill-btn lobby-lib-btn" data-act="library" title="Thư viện ván đã lưu">
                <span aria-hidden="true">📚</span> <span>Thư viện</span>
              </button>
              <button type="button" class="guest-chip" data-act="profile" title="Đổi tên hiển thị">
                <span class="guest-avatar">${escapeHtml((s.nickname || 'K').trim().charAt(0).toUpperCase())}</span>
                <span class="guest-name">${escapeHtml(s.nickname)}</span>
              </button>
              <button type="button" class="pill-btn lobby-gear-btn" data-act="settings" aria-label="Cài đặt">
                <span aria-hidden="true">⚙</span> <span>Cài đặt</span>
              </button>
            </div>
          </header>

          <main class="lobby-main">
            <div class="lobby-hero-title">
              <h1>Chọn bàn cờ</h1>
              <p>Chơi nội bộ, đấu máy thông minh hoặc thi đấu trực tuyến</p>
            </div>
            <svg class="lobby-defs-svg" width="0" height="0" aria-hidden="true">
              ${buildPieceSymbolsDefs(theme, 'lobby')}
            </svg>
            <div class="lobby-cards">
              <button type="button" class="game-card" data-game="cotuong" aria-label="Cờ Tướng — Cờ tướng truyền thống">
                <div class="game-card-art xq-art">
                  <svg class="lobby-piece-svg" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
                    <use href="#${pieceSymbolId(theme.id, 'red', 'general', 'lobby')}" width="120" height="120"/>
                  </svg>
                </div>
                <div class="game-card-body">
                  <div class="game-card-title">CỜ TƯỚNG</div>
                  <div class="game-card-sub">Cờ tướng truyền thống</div>
                  ${renderEloBar(s.ratings.xiangqi)}
                </div>
              </button>

              <button type="button" class="game-card" data-game="coup" aria-label="Cờ Úp — Úp quân, mở bất ngờ">
                <div class="game-card-art coup-art">
                  <div class="coup-flip-stage">
                    <div class="coup-face-back">${buildCoveredBackSvg(theme)}</div>
                    <div class="coup-face-front" hidden>
                      <svg class="lobby-piece-svg" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
                        <use class="coup-reveal-use" href="#${pieceSymbolId(theme.id, 'red', 'chariot', 'lobby')}" width="120" height="120"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div class="game-card-body">
                  <div class="game-card-title">CỜ ÚP</div>
                  <div class="game-card-sub">Úp quân, mở bất ngờ</div>
                  ${renderEloBar(s.ratings.jieqi)}
                </div>
              </button>
            </div>
            <div class="resume-strip" hidden></div>
          </main>

          <div class="lobby-drop-overlay" hidden>
            <div class="lobby-drop-box">Thả file để nhập ván (.xqgame.json, .pgn, .txt)</div>
          </div>

          <footer class="lobby-footer">
            <span class="lobby-version">${APP_VERSION}</span>
            <a class="lobby-link" href="https://github.com/TuLeTanh/ChineseChess" target="_blank" rel="noopener noreferrer">GitHub</a>
            <button type="button" class="icon-btn lobby-mute-btn" data-act="mute" aria-label="Tắt hoặc bật âm thanh"></button>
          </footer>
        </div>
      `;

      bg = new LobbyBackground({
        container,
        theme,
        quality: s.bgQuality,
        seed,
      });

      const muteBtn = container.querySelector('.lobby-mute-btn');
      const syncMuteIcon = () => {
        const muted = ctx.sfx.isMuted();
        muteBtn.classList.toggle('is-muted', muted);
        muteBtn.title = muted ? 'Bật âm thanh (M)' : 'Tắt âm thanh (M)';
        muteBtn.innerHTML = muted
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
      };
      syncMuteIcon();

      container.querySelector('[data-act="library"]').addEventListener('click', () => {
        ctx.router.navigate('/library');
      });

      // Resume strip (autosave in progress)
      const resumeStrip = container.querySelector('.resume-strip');
      const loadResumeStrip = async () => {
        if (destroyed || !ctx.gameStore) return;
        const saves = await ctx.gameStore.listAutosaves();
        if (destroyed) return;
        if (!saves.length) {
          resumeStrip.hidden = true;
          resumeStrip.innerHTML = '';
          return;
        }
        const top = saves[0];
        const vLabel = top.record.variant === 'jieqi' ? 'Cờ Úp' : 'Cờ Tướng';
        const mLabel = top.record.mode === 'ai' ? 'Đấu máy' : 'Hai người';
        const plies = top.record.moves.length;
        const ago = formatRelativeDateVi(top.savedAt);
        resumeStrip.hidden = false;
        resumeStrip.innerHTML = `
          <span class="resume-text"></span>
          <div class="resume-actions">
            <button type="button" class="mini-seg-btn is-selected" data-res="go">Tiếp tục</button>
            <button type="button" class="mini-seg-btn" data-res="discard">Bỏ ván</button>
          </div>
        `;
        resumeStrip.querySelector('.resume-text').textContent =
          `Tiếp tục ván đang chơi · ${vLabel} · ${mLabel} · ${plies} nước · ${ago}`;
        resumeStrip.querySelector('[data-res="go"]').addEventListener('click', () => {
          ctx.pendingResume = top;
          const rGame = variantToRouteGame(top.record.variant);
          const rMode = top.record.mode === 'ai' ? 'ai' : 'local';
          ctx.router.navigate(`/play/${rGame}/${rMode}`, { resume: '1' });
        });
        resumeStrip.querySelector('[data-res="discard"]').addEventListener('click', async () => {
          await ctx.gameStore.clearAutosave(top.slot);
          loadResumeStrip();
        });
      };
      loadResumeStrip();

      // Drag-and-drop file import onto lobby
      const dropOverlay = container.querySelector('.lobby-drop-overlay');
      let dragDepth = 0;
      container.addEventListener('dragenter', (ev) => {
        if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
          ev.preventDefault();
          dragDepth++;
          dropOverlay.hidden = false;
        }
      });
      container.addEventListener('dragover', (ev) => {
        if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) {
          ev.preventDefault();
        }
      });
      container.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropOverlay.hidden = true;
      });
      container.addEventListener('drop', (ev) => {
        ev.preventDefault();
        dragDepth = 0;
        dropOverlay.hidden = true;
        if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length > 0) {
          openImportModal(ctx, { initialFiles: ev.dataTransfer.files });
        }
      });

      // Online status pill probe
      const pill = container.querySelector('.online-pill');
      const pillText = container.querySelector('.online-pill-text');
      const updateOnlinePill = async () => {
        if (destroyed) return;
        onlineState = await ctx.probeOnline();
        if (destroyed) return;
        pill.classList.toggle('is-online', onlineState.ok);
        pill.classList.toggle('is-offline', !onlineState.ok);
        pillText.textContent = onlineState.ok
          ? `Online${onlineState.latencyMs != null ? ` · ${onlineState.latencyMs} ms` : ''}`
          : 'Ngoại tuyến';
      };
      updateOnlinePill();
      leakTracker.trackTimer(1);
      probeTimer = window.setInterval(updateOnlinePill, 20000);

      // Card hover/focus mood + Cờ Úp flip preview
      const xqCard = container.querySelector('[data-game="cotuong"]');
      const coupCard = container.querySelector('[data-game="coup"]');
      const coupStage = container.querySelector('.coup-flip-stage');
      const coupBack = container.querySelector('.coup-face-back');
      const coupFront = container.querySelector('.coup-face-front');
      const coupUse = container.querySelector('.coup-reveal-use');
      let flipIdx = 0;

      const setCoupFlipped = (flipped) => {
        if (!coupStage) return;
        coupStage.classList.add('is-squashing');
        window.setTimeout(() => {
          if (destroyed) return;
          if (flipped) {
            const kind = FLIP_POOL[flipIdx % FLIP_POOL.length];
            flipIdx++;
            coupUse.setAttribute('href', `#${pieceSymbolId(ctx.getTheme().id, 'red', kind, 'lobby')}`);
            coupBack.hidden = true;
            coupFront.hidden = false;
          } else {
            coupBack.hidden = false;
            coupFront.hidden = true;
          }
          coupStage.classList.remove('is-squashing');
        }, 140);
      };

      xqCard.addEventListener('pointerenter', () => bg && bg.setMood('cotuong'));
      xqCard.addEventListener('focus', () => bg && bg.setMood('cotuong'));
      xqCard.addEventListener('pointerleave', () => bg && bg.setMood('default'));
      xqCard.addEventListener('blur', () => bg && bg.setMood('default'));

      coupCard.addEventListener('pointerenter', () => {
        if (bg) bg.setMood('coup');
        setCoupFlipped(true);
      });
      coupCard.addEventListener('focus', () => {
        if (bg) bg.setMood('coup');
        setCoupFlipped(true);
      });
      coupCard.addEventListener('pointerleave', () => {
        if (bg) bg.setMood('default');
        setCoupFlipped(false);
      });
      coupCard.addEventListener('blur', () => {
        if (bg) bg.setMood('default');
        setCoupFlipped(false);
      });

      xqCard.addEventListener('click', () => ctx.router.navigate('/g/cotuong'));
      coupCard.addEventListener('click', () => ctx.router.navigate('/g/coup'));

      container.querySelector('[data-act="profile"]').addEventListener('click', (ev) => {
        openSettingsModal(ctx, 'account', ev.currentTarget);
      });
      container.querySelector('[data-act="settings"]').addEventListener('click', (ev) => {
        openSettingsModal(ctx, 'appearance', ev.currentTarget);
      });
      muteBtn.addEventListener('click', () => {
        ctx.toggleMute();
        syncMuteIcon();
      });

      unsubSettings = ctx.settingsStore.subscribe((st) => {
        if (destroyed) return;
        const th = ctx.getTheme();
        if (bg) {
          bg.setTheme(th);
          bg.setQuality(st.bgQuality);
        }
        const avatarEl = container.querySelector('.guest-avatar');
        const nameEl = container.querySelector('.guest-name');
        if (avatarEl) avatarEl.textContent = (st.nickname || 'K').trim().charAt(0).toUpperCase();
        if (nameEl) nameEl.textContent = st.nickname;
        const defsSvg = container.querySelector('.lobby-defs-svg');
        if (defsSvg) defsSvg.innerHTML = buildPieceSymbolsDefs(th, 'lobby');
        const xqUse = xqCard.querySelector('use');
        if (xqUse) xqUse.setAttribute('href', `#${pieceSymbolId(th.id, 'red', 'general', 'lobby')}`);
        syncMuteIcon();
      });
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
      if (bg) {
        bg.destroy();
        bg = null;
      }
    },
  };
}
