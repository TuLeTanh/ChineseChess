/**
 * Read-only Archive Review (#/play/<game>/review?id=<uuid>) & Share-Link Replay (#/replay?g=<payload>).
 * Reuses BoardView + SidePanel with stepping (⏮ ◀ ▶ ⏭ ⏯, timeline, chips, Jieqi pool panel),
 * no engine, no voice, no clocks, plus "Chơi tiếp từ đây", "Lưu vào thư viện", and "Xuất".
 */
import { Board } from '../model/board.js';
import { JieqiBoard, LETTER_TO_KIND } from '../jieqi/rules.js';
import { XiangqiRules, GameStatus } from '../rules.js';
import { JieqiRules } from '../jieqi/rules.js';
import { BoardView } from '../ui/boardView.js';
import { SidePanel } from '../ui/sidePanel.js';
import { decodeSharePayload } from '../storage/formats.js';
import {
  formatResultVi,
  openExportModal,
  openContinueFromPositionModal,
  saveRecordWithPrunePrompt,
} from '../ui/saveModals.js';
import { openSettingsModal } from '../ui/settingsModal.js';
import { openNotationHelpModal } from '../ui/notationHelpModal.js';
import { leakTracker } from '../app/router.js';
import { LayoutManager } from '../ui/layoutManager.js';
import { MoveStrip } from '../ui/moveStrip.js';
import { BottomSheet } from '../ui/bottomSheet.js';
import { EvalBar } from '../ui/evalBar.js';
import { AnalysisPanel } from '../ui/analysisView.js';

const FILES = 'abcdefghi';

function rebuildBoardFromRecord(record) {
  const isJieqi = record.variant === 'jieqi';
  const board = isJieqi ? JieqiBoard.fromPublicFen(record.start.fen) : Board.fromFen(record.start.fen);
  const rules = isJieqi ? new JieqiRules() : new XiangqiRules();

  for (const mv of record.moves || []) {
    const from = { x: FILES.indexOf(mv.m[0]), y: 9 - Number(mv.m[1]) };
    const to = { x: FILES.indexOf(mv.m[2]), y: 9 - Number(mv.m[3]) };
    const ext =
      isJieqi && (mv.r || mv.cr)
        ? {
            type: mv.r ? LETTER_TO_KIND[mv.r] : undefined,
            capturedType: mv.cr ? LETTER_TO_KIND[mv.cr] : undefined,
          }
        : null;
    board.applyMove(from, to, ext);
    const st = rules.status(board, board.sideToMove);
    const isMate = st === GameStatus.Checkmate;
    const isChk = st === GameStatus.Check || isMate;
    board.setLastMoveFlags({
      suffix: isMate ? '#' : st === GameStatus.Check ? '+' : '',
      gaveCheck: isChk,
      isCheckmate: isMate,
    });
  }
  return { board, rules };
}

export function createReplayScreen(ctx) {
  let boardView = null;
  let sidePanel = null;
  let layoutManager = null;
  let moveStrip = null;
  let bottomSheet = null;
  let evalBar = null;
  let analysisPanel = null;
  let autoTimer = null;
  let onKeyDown = null;
  let unsubSettings = null;
  let disposed = false;

  const stopAuto = () => {
    if (autoTimer) {
      window.clearInterval(autoTimer);
      autoTimer = null;
      leakTracker.trackTimer(-1);
    }
  };

  return {
    async mount(container, route) {
      disposed = false;
      const isShare = route.name === 'replay';
      let record = null;
      let errMsg = '';

      if (isShare) {
        const g = route.query?.g || '';
        const dec = await decodeSharePayload(g, { isImport: true });
        if (dec.ok) record = dec.record;
        else errMsg = dec.error?.message || 'Liên kết chia sẻ không hợp lệ hoặc đã bị hỏng.';
      } else {
        const id = route.query?.id || '';
        record = id ? await ctx.gameStore.getGame(id) : null;
        if (!record) errMsg = 'Không tìm thấy ván cờ trong thư viện.';
      }

      if (disposed) return;

      if (!record) {
        container.className = 'lobby-shell';
        container.innerHTML = `
          <div class="lobby-content" style="justify-content:center;align-items:center;text-align:center">
            <div class="modal-card setup-modal">
              <h3>Không thể mở ván cờ</h3>
              <p class="set-hint" id="replay-err-msg"></p>
              <div class="modal-actions" style="margin-top:16px">
                <button type="button" class="pill-btn" data-go="library">Thư viện</button>
                <button type="button" class="pill-btn pill-btn-gold" data-go="lobby">Về sảnh</button>
              </div>
            </div>
          </div>
        `;
        container.querySelector('#replay-err-msg').textContent = errMsg;
        container.querySelector('[data-go="library"]').addEventListener('click', () => ctx.router.navigate('/library'));
        container.querySelector('[data-go="lobby"]').addEventListener('click', () => ctx.router.navigate('/'));
        return;
      }

      const { board, rules } = rebuildBoardFromRecord(record);
      const isJieqi = record.variant === 'jieqi';
      let viewPly = board.history.length;

      container.className = 'app-shell game-shell is-replay-shell';
      container.innerHTML = `
        <main id="board-stage" class="board-stage">
          <div class="game-top-nav">
            <button type="button" class="game-nav-btn" data-nav="back">${isShare ? '← Sảnh' : '← Thư viện'}</button>
            <span class="replay-mode-pill" data-nowrap="1">${isShare ? 'Đang xem ván chia sẻ' : 'Đang xem ván đã lưu'}</span>
            ${isShare ? `<button type="button" class="game-nav-btn" data-arch="save" title="Lưu vào thư viện">💾 Lưu</button>` : ''}
          </div>
          <div class="replay-banner-slot"></div>
          <div class="pv-preview-banner" data-testid="pv-preview-banner" hidden>
            <span class="pv-preview-label">Đang xem phương án của máy</span>
            <button type="button" class="mini-seg-btn" data-action="exit-pv-preview">Thoát</button>
          </div>
          <div class="game-board-host"></div>
          <div class="move-strip-host"></div>
          <nav class="mobile-controls-bar" data-testid="mobile-controls" aria-label="Điều khiển xem lại">
            <button type="button" class="mctrl-btn" data-rev-act="start"><span class="mctrl-icon">⏮</span><span class="mctrl-label">Đầu</span></button>
            <button type="button" class="mctrl-btn" data-rev-act="prev"><span class="mctrl-icon">◀</span><span class="mctrl-label">Trước</span></button>
            <button type="button" class="mctrl-btn" data-rev-act="play"><span class="mctrl-icon">⏯</span><span class="mctrl-label">Phát</span></button>
            <button type="button" class="mctrl-btn" data-rev-act="next"><span class="mctrl-icon">▶</span><span class="mctrl-label">Sau</span></button>
            <button type="button" class="mctrl-btn" data-rev-act="live"><span class="mctrl-icon">⏭</span><span class="mctrl-label">Cuối</span></button>
          </nav>
        </main>
        <aside id="side-panel" class="side-panel" aria-label="Bảng xem lại ván đã lưu"></aside>
      `;

      const stage = container.querySelector('.game-board-host');
      const moveStripHost = container.querySelector('.move-strip-host');
      const sidePanelEl = container.querySelector('#side-panel');
      const pvPreviewBanner = container.querySelector('[data-testid="pv-preview-banner"]');
      pvPreviewBanner?.querySelector('[data-action="exit-pv-preview"]')?.addEventListener('click', () => {
        analysisPanel?.clearPreview();
      });

      const openAnalysis = () => {
        if (!analysisPanel || !sidePanel || !sidePanel.getPolicy().showAnalysis) return;
        sidePanel.setAnalysisMode(true);
        if (bottomSheet && bottomSheet.enabled) {
          bottomSheet.open('full');
          bottomSheet.selectTab('analysis');
        }
        analysisPanel.setActive(true);
      };
      const closeAnalysis = () => {
        if (analysisPanel?.previewActive) analysisPanel.clearPreview();
        analysisPanel?.setActive(false);
        sidePanel?.setAnalysisMode(false);
        if (bottomSheet && bottomSheet.enabled) {
          bottomSheet.selectTab('moves');
          bottomSheet.close();
        }
      };

      const saveShareTopBtn = container.querySelector('[data-arch="save"]');
      if (saveShareTopBtn) {
        saveShareTopBtn.addEventListener('click', async () => {
          const res = await saveRecordWithPrunePrompt(ctx, { ...record, source: 'import' });
          if (res.ok) {
            saveShareTopBtn.disabled = true;
            saveShareTopBtn.textContent = 'Đã lưu ✓';
          }
        });
      }

      container.querySelector('.mobile-controls-bar').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-rev-act], [data-maction]');
        if (!b) return;
        const a = b.dataset.revAct || b.dataset.maction;
        if (a === 'start') goToPly(0);
        else if (a === 'prev') goToPly(viewPly - 1);
        else if (a === 'play') toggleAuto();
        else if (a === 'next') goToPly(viewPly + 1);
        else if (a === 'live') goToPly(board.history.length);
        else if (a === 'analyze') openAnalysis();
      });

      container.querySelector('[data-nav="back"]').addEventListener('click', () => {
        ctx.router.navigate(isShare ? '/' : '/library');
      });

      const currentViewFen = () => board.snapshotAt(viewPly).fen;
      const currentViewPool = () => (isJieqi ? board.getPool(viewPly) : null);

      const goToPly = (target, { isScrub = false, fromAuto = false, keepMistakeFocus = false } = {}) => {
        if (disposed) return;
        if (!fromAuto) stopAuto();
        const total = board.history.length;
        const prev = viewPly;
        viewPly = Math.max(0, Math.min(total, Math.floor(target)));
        const delta = viewPly - prev;
        const snap = board.snapshotAt(viewPly);
        const viewBoard = isJieqi ? JieqiBoard.fromPublicFen(snap.fen) : Board.fromFen(snap.fen);
        const transition = isScrub ? 'instant' : delta === 1 ? 'forward' : delta === -1 ? 'backward' : 'jump';
        const stepMove = delta === 1 ? board.history[viewPly - 1] : delta === -1 ? board.history[prev - 1] : null;

        boardView.setReviewState({
          active: true,
          viewPly,
          totalPlies: total,
          hasNewMoves: false,
          viewBoard,
          lastMove: snap.move,
          transition,
          stepMove,
          reducedMotion: false,
        });
        sidePanel.setReviewState({ viewPly, hasNewMoves: false, autoPlaying: Boolean(autoTimer), skipScroll: isScrub });
        if (moveStrip) moveStrip.update(viewPly);
        if (analysisPanel) analysisPanel.syncPly(viewPly, { keepMistakeFocus });
        if (ctx.testMode && typeof window !== 'undefined') {
          window.__view = { ply: viewPly, total, fen: snap.fen, sideToMove: viewBoard.sideToMove };
        }
      };

      const toggleAuto = () => {
        if (autoTimer) {
          stopAuto();
          sidePanel.setReviewState({ viewPly, autoPlaying: false, skipScroll: true });
          return;
        }
        if (board.history.length === 0) return;
        if (viewPly >= board.history.length) goToPly(0, { fromAuto: true });
        leakTracker.trackTimer(1);
        autoTimer = window.setInterval(() => {
          if (disposed || viewPly >= board.history.length) {
            stopAuto();
            sidePanel?.setReviewState({ viewPly, autoPlaying: false, skipScroll: true });
            return;
          }
          goToPly(viewPly + 1, { fromAuto: true });
        }, 750);
        sidePanel.setReviewState({ viewPly, autoPlaying: true, skipScroll: true });
      };

      boardView = new BoardView({
        container: stage,
        board,
        rules,
        theme: ctx.getTheme(),
        practiceMode: false,
        testMode: ctx.testMode,
        onReturnToLive: () => goToPly(board.history.length),
        onContinueFromHere: () => {
          openContinueFromPositionModal(ctx, {
            variant: record.variant,
            fen: currentViewFen(),
            pool: currentViewPool(),
          });
        },
      });
      boardView.setLocked(true);
      boardView.setAllowContinue(true);
      // Dock review banner above the board so it never covers the top file labels
      const bannerSlot = container.querySelector('.replay-banner-slot');
      const revBannerEl = stage.querySelector('.review-banner');
      if (bannerSlot && revBannerEl) {
        bannerSlot.appendChild(revBannerEl);
      }

      sidePanel = new SidePanel({
        container: sidePanelEl,
        modalRoot: ctx.modalRoot,
        board,
        theme: ctx.getTheme(),
        notation: ctx.settingsStore.get().notation,
        variant: isJieqi ? 'coup' : 'cotuong',
        showPool: ctx.settingsStore.get().jieqi.showPool,
        mode: record.mode || 'local',
        isArchive: true,
        isUnfinishedArchive: record.result === 'unfinished',
        muted: ctx.sfx.isMuted(),
        volume: ctx.sfx.getVolume(),
        voiceEnabled: ctx.sfx.isVoiceEnabled(),
        onNewGame: () => {},
        onUndo: () => {},
        onFlip: () => boardView.flip(),
        onToggleTheme: () => {
          const next = ctx.cycleTheme();
          boardView.setTheme(next);
          sidePanel.setTheme(next);
        },
        onTogglePractice: () => {},
        onModeChange: () => {},
        onPlayerSideChange: () => {},
        onAiLevelChange: () => {},
        onHint: () => {},
        onResign: () => {},
        onOpenAnalysis: () => openAnalysis(),
        onOpenSettings: (triggerEl) => openSettingsModal(ctx, 'appearance', triggerEl),
        onToggleNotation: () => {
          ctx.settingsStore.update((st) => {
            st.notation = st.notation === 'coord' ? 'traditional' : 'coord';
          });
        },
        onOpenNotationHelp: (triggerEl) => openNotationHelpModal(ctx, triggerEl),
        onReturnLive: () => goToPly(board.history.length),
        onContinueHere: () => {
          openContinueFromPositionModal(ctx, {
            variant: record.variant,
            fen: currentViewFen(),
            pool: currentViewPool(),
          });
        },
        onExportGame: () => {
          openExportModal(ctx, {
            record,
            currentFen: currentViewFen(),
            allowSaveToLibrary: isShare,
          });
        },
        onSelectPly: (ply, opts) => {
          if (analysisPanel && !opts?.isScrub) {
            analysisPanel.selectMove(ply, opts);
          } else {
            goToPly(ply, opts);
          }
        },
        onStepPly: (delta) => goToPly(viewPly + delta),
        onToggleAutoPlay: () => toggleAuto(),
        onToggleMute: () => {
          ctx.toggleMute();
          sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
        },
        onToggleVoice: () => {
          ctx.toggleVoice();
          sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
        },
        onVolumeChange: (v) => ctx.setVolume(v),
      });

      sidePanel.redCard.querySelector('.player-name').textContent = record.red?.name || 'Đỏ';
      sidePanel.blackCard.querySelector('.player-name').textContent = record.black?.name || 'Đen';
      if (sidePanel.compactStatusEl) {
        sidePanel.compactStatusEl.textContent = formatResultVi(record);
      }

      // Add mobile analyze button if P4 policy allows analysis
      const allowArchiveAnalysis = sidePanel.getPolicy().showAnalysis;
      if (allowArchiveAnalysis) {
        const mctrl = container.querySelector('.mobile-controls-bar');
        if (mctrl) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mctrl-btn';
          btn.dataset.maction = 'analyze';
          btn.innerHTML = '<span class="mctrl-icon" aria-hidden="true">📊</span><span class="mctrl-label" data-nowrap="1">Phân tích</span>';
          mctrl.appendChild(btn);
        }
      }

      // Mount EvalBar + AnalysisPanel (Cờ Tướng full support; unfinished local allowed per P4)
      evalBar = new EvalBar({ container: stage });
      boardView.onFlipChange = (flipped) => {
        container.classList.toggle('is-flipped', Boolean(flipped));
        if (evalBar) evalBar.setFlipped(flipped);
      };
      const anPane = sidePanelEl.querySelector('.sheet-pane[data-spane="analysis"]');
      if (anPane) anPane.hidden = false;
      sidePanelEl.classList.add('has-analysis');

      const blockedUnfinished = record.result === 'unfinished' && record.mode !== 'local';
      const analysisHost = sidePanel.analysisPaneHost || sidePanelEl;
      analysisPanel = new AnalysisPanel({
        ctx,
        hostEl: analysisHost,
        evalBar,
        boardView,
        sidePanel,
        startFen: record.start.fen,
        moves: (record.moves || []).map((m) => m.m),
        variant: record.variant,
        isUnfinished: blockedUnfinished,
        onSelectPly: (ply, opts) => goToPly(ply, opts),
        onClose: () => closeAnalysis(),
        onPreviewFen: (fen, pvArrows) => {
          if (fen) {
            if (pvPreviewBanner) pvPreviewBanner.hidden = false;
            boardView.setReviewState({
              active: true,
              viewPly,
              totalPlies: board.history.length,
              hasNewMoves: false,
              viewBoard: Board.fromFen(fen),
              lastMove: null,
              transition: 'instant',
              reducedMotion: true,
            });
            boardView.setAnalysisArrows(pvArrows || []);
          } else {
            if (pvPreviewBanner) pvPreviewBanner.hidden = true;
            goToPly(viewPly, { isScrub: true });
          }
        },
        onTryMove: (ply, iccs) => {
          if (isJieqi || !iccs || iccs.length !== 4) return;
          const b = Board.fromFen(board.snapshotAt(ply).fen);
          const from = { x: FILES.indexOf(iccs[0]), y: 9 - Number(iccs[1]) };
          const to = { x: FILES.indexOf(iccs[2]), y: 9 - Number(iccs[3]) };
          b.applyMove(from, to);
          openContinueFromPositionModal(ctx, {
            variant: 'xiangqi',
            fen: b.toFen(),
            pool: null,
          });
        },
      });

      goToPly(board.history.length, { isScrub: true });

      analysisPanel.loadCached().then((cached) => {
        if (disposed || isJieqi || blockedUnfinished) return;
        if (route.query?.analyze === '1') {
          openAnalysis();
          if (!cached) {
            if (route.query?.auto === '1') {
              analysisPanel.start({ preset: route.query?.preset || 'fast', forceEngine: route.query?.engine });
            } else {
              analysisPanel.openSetupModal();
            }
          }
        }
      });

      const sheetEl = sidePanelEl.querySelector('[data-testid="bottom-sheet"]');
      if (sheetEl) {
        let prevSheetState = 'closed';
        bottomSheet = new BottomSheet({
          sheetEl,
          hostContainer: container,
          onStateChange: (st) => {
            if (prevSheetState !== 'closed' && st === 'closed' && analysisPanel && analysisPanel.running) {
              analysisPanel.stop();
            }
            prevSheetState = st;
            if (layoutManager) layoutManager.setSheetState(st);
            if (moveStrip) moveStrip.setExpanded(st !== 'closed');
          },
        });
      }

      moveStrip = new MoveStrip({
        container: moveStripHost,
        board,
        notation: ctx.settingsStore.get().notation,
        onSelectPly: (ply) => goToPly(ply),
        onOpenSheet: () => {
          if (bottomSheet) bottomSheet.open('half');
        },
      });
      moveStrip.update(viewPly);

      layoutManager = new LayoutManager({
        rootEl: container,
        testMode: ctx.testMode,
        onChange: ({ mode: layoutMode, compactBoard }) => {
          if (boardView) boardView.setCompactMode(compactBoard);
          if (bottomSheet) bottomSheet.setEnabled(layoutMode === 'stack');
        },
      });

      unsubSettings = ctx.settingsStore.subscribe((st) => {
        if (disposed) return;
        const th = ctx.getTheme();
        boardView.setTheme(th);
        sidePanel.setTheme(th);
        sidePanel.setShowPool(st.jieqi.showPool);
        sidePanel.setNotation(st.notation);
        if (moveStrip) moveStrip.setNotation(st.notation);
        if (analysisPanel) analysisPanel.setNotation(st.notation);
      });

      onKeyDown = (ev) => {
        if (ctx.modalRoot && !ctx.modalRoot.hidden) return;
        if (ev.key === 'Escape') {
          if (analysisPanel && analysisPanel.previewActive) {
            analysisPanel.clearPreview();
          } else if (sidePanel && sidePanel.analysisOpen) {
            closeAnalysis();
          }
          return;
        }
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); goToPly(viewPly - 1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); goToPly(viewPly + 1); }
        else if (ev.key === 'Home') { ev.preventDefault(); goToPly(0); }
        else if (ev.key === 'End') { ev.preventDefault(); goToPly(board.history.length); }
        else if (ev.key === ' ') { ev.preventDefault(); toggleAuto(); }
        else if (ev.key.toLowerCase() === 'f') { boardView.flip(); }
      };
      window.addEventListener('keydown', onKeyDown);
      leakTracker.trackListener(1);

      if (ctx.testMode && typeof window !== 'undefined') {
        window.__board = board;
      }
    },

    unmount() {
      disposed = true;
      stopAuto();
      if (unsubSettings) { unsubSettings(); unsubSettings = null; }
      if (onKeyDown) {
        window.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
        leakTracker.trackListener(-1);
      }
      if (layoutManager) {
        layoutManager.dispose();
        layoutManager = null;
      }
      if (moveStrip) {
        moveStrip.dispose();
        moveStrip = null;
      }
      if (bottomSheet) {
        bottomSheet.dispose();
        bottomSheet = null;
      }
      if (analysisPanel) {
        analysisPanel.dispose();
        analysisPanel = null;
      }
      if (evalBar) {
        evalBar.dispose();
        evalBar = null;
      }
      if (boardView) {
        boardView.animator.clear();
        boardView = null;
      }
      if (sidePanel) {
        sidePanel.closeOverflowMenu?.();
        sidePanel.closeModal();
        sidePanel = null;
      }
    },
  };
}
