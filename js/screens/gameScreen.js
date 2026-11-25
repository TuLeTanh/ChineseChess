/**
 * Game screen module ({ mount(container, route), unmount() }) that wires
 * GameController + BoardView + SidePanel + keyboard shortcuts with strict
 * cleanup on unmount (zero listener/timer/worker/canvas leaks).
 */
import { RED, BLACK } from '../model/piece.js';
import { START_FEN } from '../model/fen.js';
import { BoardView } from '../ui/boardView.js';
import { SidePanel } from '../ui/sidePanel.js';
import { AiClient } from '../ai/client.js';
import { PikafishClient } from '../ai/pikafishClient.js';
import { GameController } from '../game/GameController.js';
import { xiangqiVariant } from '../variants/xiangqi.js';
import { jieqiVariant } from '../variants/jieqi.js';
import { dealRemainingPool } from '../jieqi/rules.js';
import { GameStatus } from '../rules.js';
import { openSettingsModal } from '../ui/settingsModal.js';
import { openExportModal, saveRecordWithPrunePrompt } from '../ui/saveModals.js';
import { buildRecordFromBoard } from '../storage/gameRecord.js';
import { OnlineGameBridge } from '../online/onlineGameController.js';
import { leakTracker } from '../app/router.js';
import { LayoutManager } from '../ui/layoutManager.js';
import { MoveStrip } from '../ui/moveStrip.js';
import { BottomSheet } from '../ui/bottomSheet.js';
import { HapticsManager } from '../ui/haptics.js';
import { WakeLockController } from '../app/wakeLock.js';
import { AI_LEVELS } from '../ai/levels.js';

export function createGameScreen(ctx) {
  let controller = null;
  let boardView = null;
  let sidePanel = null;
  let onlineBridge = null;
  let layoutManager = null;
  let moveStrip = null;
  let bottomSheet = null;
  let wakeLock = null;
  let onKeyDown = null;
  let onBeforeUnload = null;
  let onVisChange = null;
  let onPageHide = null;
  let autosaveTimer = null;
  let unsubSettings = null;

  return {
    async mount(container, route) {
      const q = route.query || {};
      const urlParams = new URLSearchParams(window.location.search);
      const settings = ctx.settingsStore.get();

      const variant = route.game === 'coup' ? jieqiVariant : xiangqiVariant;
      const mode = route.mode === 'ai' ? 'ai' : route.mode === 'online' ? 'online' : 'local';
      let sideChoice = q.side || urlParams.get('side') || settings.last.side || RED;
      if (sideChoice === 'random') sideChoice = Math.random() < 0.5 ? RED : BLACK;
      const playerSide = sideChoice === 'black' ? BLACK : RED;

      const aiLevel = q.level || urlParams.get('level') || settings.last.level || 'nghiep-du';
      const customStart = ctx.pendingCustomStart;
      ctx.pendingCustomStart = null;
      const resumeSnap = ctx.pendingResume;
      ctx.pendingResume = null;
      const initialFen =
        (customStart && customStart.game === route.game ? customStart.fen : '') ||
        q.fen ||
        urlParams.get('fen') ||
        (variant.id === 'coup' ? '' : START_FEN);
      const practiceMode = variant.supportsPracticeMode && q.free === '1';
      const autoFlipLocal = q.autoflip === '1';

      const autosaveSlot =
        mode === 'local' || mode === 'ai'
          ? `${variant.id === 'coup' ? 'jieqi' : 'xiangqi'}:${mode}`
          : null;

      const buildCurrentRecord = (result = 'unfinished', reason = null, source = 'manual') => {
        const sNow = ctx.settingsStore.get();
        const myName = sNow.nickname || 'Bạn';
        const aiName = `Máy (${controller.aiLevel})`;
        const isAi = controller.mode === 'ai';
        const redInfo =
          isAi && controller.playerSide !== RED
            ? { name: aiName, kind: 'engine', level: controller.aiLevel }
            : { name: isAi ? myName : 'Đỏ', kind: 'human' };
        const blackInfo =
          isAi && controller.playerSide !== BLACK
            ? { name: aiName, kind: 'engine', level: controller.aiLevel }
            : { name: isAi ? myName : 'Đen', kind: 'human' };
        return buildRecordFromBoard({
          board: controller.board,
          variant: variant.id === 'coup' ? 'jieqi' : 'xiangqi',
          mode: controller.mode,
          red: redInfo,
          black: blackInfo,
          result,
          reason,
          startFen: controller.gameStartFen || undefined,
          source,
        });
      };

      const flushAutosaveNow = () => {
        if (!autosaveSlot || !controller || controller.disposed || !ctx.gameStore) return;
        const sNow = ctx.settingsStore.get();
        if (sNow.storage?.autosaveInProgress === false) return;
        if (controller.board.history.length === 0 || controller.isGameOver()) return;
        const snap = {
          record: buildCurrentRecord('unfinished', null, 'autosave'),
          secretLocal:
            controller.board.isJieqi && controller.board._secret
              ? Object.fromEntries(controller.board._secret.entries())
              : undefined,
          halfmoveClock: controller.board.halfmoveClock,
          positionHistory: [...controller.board.positionHistory],
          ai: { level: controller.aiLevel, engine: controller.engineType, side: controller.playerSide },
          free: controller.practiceMode,
          viewPly: null,
        };
        ctx.gameStore.putAutosave(autosaveSlot, snap);
      };

      const scheduleAutosave = () => {
        if (!autosaveSlot) return;
        if (autosaveTimer) {
          window.clearTimeout(autosaveTimer);
          autosaveTimer = null;
          leakTracker.trackTimer(-1);
        }
        leakTracker.trackTimer(1);
        autosaveTimer = window.setTimeout(() => {
          autosaveTimer = null;
          leakTracker.trackTimer(-1);
          flushAutosaveNow();
        }, 250);
      };

      const aiClient = new AiClient();
      const pikafishClient = new PikafishClient();
      const pfInfo = variant.supportsPikafish ? await pikafishClient.probeInfo() : { available: false };
      const reqEngine = q.engine || urlParams.get('engine') || settings.last.engine || (pfInfo.available ? 'pikafish' : 'js');
      const engineType = variant.supportsPikafish && pfInfo.available && reqEngine === 'pikafish' ? 'pikafish' : 'js';

      // Build game shell inside container with top bar, board host, move strip host, and mobile controls
      const levelName = (AI_LEVELS.find((l) => l.id === aiLevel) || AI_LEVELS[1]).name;
      const topChipText =
        `${variant.id === 'coup' ? 'Cờ Úp' : 'Cờ Tướng'} · ` +
        (mode === 'ai' ? `Đấu máy · ${levelName}` : mode === 'online' ? 'Trực tuyến' : 'Hai người');

      container.className = 'app-shell game-shell';
      container.innerHTML = `
        <main id="board-stage" class="board-stage">
          <div class="game-top-nav">
            <button type="button" class="game-nav-btn" data-nav="lobby" title="Về sảnh">← Sảnh</button>
            <div class="game-top-chip" data-testid="top-mode-chip">${topChipText}</div>
            <div class="game-top-right">
              <button type="button" class="game-nav-btn game-top-save" data-testid="top-save-btn" aria-label="Lưu hoặc xuất ván cờ" title="Lưu / Xuất">💾</button>
              <button type="button" class="game-nav-btn" data-nav="settings" aria-label="Cài đặt" title="Cài đặt">⚙</button>
            </div>
          </div>
          <div class="game-board-host"></div>
          <div class="move-strip-host"></div>
          <nav class="mobile-controls-bar" data-testid="mobile-controls" aria-label="Điều khiển nhanh"></nav>
        </main>
        <aside id="side-panel" class="side-panel" aria-label="Bảng thông tin ván cờ"></aside>
      `;
      const stage = container.querySelector('.game-board-host');
      const moveStripHost = container.querySelector('.move-strip-host');
      const mobileControlsEl = container.querySelector('.mobile-controls-bar');
      const topChipEl = container.querySelector('[data-testid="top-mode-chip"]');
      const sidePanelEl = container.querySelector('#side-panel');
      const modalRoot = ctx.modalRoot;

      const openSaveExport = () => {
        if (!controller) return;
        const viewedFen = controller.board.snapshotAt(controller.viewPly).fen;
        openExportModal(ctx, {
          record: buildCurrentRecord(
            controller.isGameOver() ? (controller.resigned ? (controller.playerSide === RED ? 'black' : 'red') : 'draw') : 'unfinished',
            controller.resigned ? 'resign' : null,
            'manual'
          ),
          currentFen: viewedFen,
          allowSaveToLibrary: mode !== 'online',
        });
      };
      container.querySelector('[data-testid="top-save-btn"]').addEventListener('click', openSaveExport);

      container.querySelector('[data-nav="lobby"]').addEventListener('click', () => {
        if (controller && controller.isGameInProgress()) {
          modalRoot.hidden = false;
          modalRoot.innerHTML = `
            <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leave-title">
              <div class="modal-card">
                <h3 id="leave-title">Rời ván cờ?</h3>
                <p>${
                  mode === 'online'
                    ? 'Rời trận sẽ bị xử thua.'
                    : ctx.settingsStore.get().storage?.autosaveInProgress !== false
                      ? 'Ván sẽ được lưu để tiếp tục sau.'
                      : 'Ván hiện tại sẽ mất.'
                }</p>
                <div class="modal-actions">
                  <button type="button" class="pill-btn modal-cancel">Ở lại</button>
                  <button type="button" class="pill-btn pill-btn-danger modal-leave-ok">Về sảnh</button>
                </div>
              </div>
            </div>
          `;
          modalRoot.querySelector('.modal-cancel').addEventListener('click', () => {
            modalRoot.hidden = true;
            modalRoot.innerHTML = '';
          });
          modalRoot.querySelector('.modal-leave-ok').addEventListener('click', () => {
            flushAutosaveNow();
            modalRoot.hidden = true;
            modalRoot.innerHTML = '';
            ctx.router.navigate('/');
          });
          return;
        }
        ctx.router.navigate('/');
      });

      container.querySelector('[data-nav="settings"]').addEventListener('click', (ev) => {
        openSettingsModal(ctx, 'appearance', ev.currentTarget);
      });

      const haptics = new HapticsManager({
        isEnabled: () => ctx.settingsStore.get().haptics !== false,
      });

      controller = new GameController({
        variant,
        mode,
        playerSide,
        aiLevel,
        engineType,
        practiceMode,
        autoFlipLocal,
        initialFen,
        theme: ctx.getTheme(),
        sfx: ctx.sfx,
        haptics,
        aiClient,
        pikafishClient,
        testMode: ctx.testMode,
        onPersistHook: ({ event, status, isResign }) => {
          if (!ctx.gameStore || mode === 'online') return;
          if (event === 'reset') {
            if (autosaveSlot) ctx.gameStore.clearAutosave(autosaveSlot);
            return;
          }
          if (event === 'gameover') {
            if (autosaveSlot) ctx.gameStore.clearAutosave(autosaveSlot);
            if (ctx.settingsStore.get().storage?.saveFinishedGames !== false) {
              let result = 'unfinished';
              let reason = null;
              if (isResign) {
                result = controller.playerSide === RED ? 'black' : 'red';
                reason = 'resign';
              } else if (status === GameStatus.Checkmate) {
                result = controller.board.sideToMove === RED ? 'black' : 'red';
                reason = 'checkmate';
              } else if (status === GameStatus.Stalemate) {
                result = controller.board.sideToMove === RED ? 'black' : 'red';
                reason = 'stalemate';
              } else if (status === GameStatus.DrawRepetition) {
                result = 'draw';
                reason = 'repetition';
              } else if (status === GameStatus.DrawNoCapture) {
                result = 'draw';
                reason = 'noCapture';
              }
              saveRecordWithPrunePrompt(ctx, buildCurrentRecord(result, reason, 'autosave'));
            }
            return;
          }
          if (event === 'move' || event === 'undo') {
            scheduleAutosave();
          }
        },
      });
      if (customStart && customStart.game === 'coup' && customStart.pool && controller.board.isJieqi) {
        dealRemainingPool(controller.board, customStart.pool);
      }

      boardView = new BoardView({
        container: stage,
        board: controller.board,
        rules: controller.activeRules,
        theme: ctx.getTheme(),
        practiceMode: controller.practiceMode,
        testMode: ctx.testMode,
        isTouchLiftEnabled: () => ctx.settingsStore.get().touchLift !== false,
        onSelectPiece: () => {
          boardView.clearHintArrow();
          ctx.sfx.play('select');
          haptics.trigger('pick', { inReview: controller.isReviewing() });
        },
        onMoveLanded: (move) => controller.onMoveLanded(move),
        onIllegalMove: () => {
          ctx.sfx.play('illegal');
          haptics.trigger('illegal', { inReview: controller.isReviewing() });
        },
        onStateChange: (evt) => controller.onStateChange(evt),
        onReturnToLive: () => controller.goToPly(controller.board.history.length),
        onContinueFromHere: () => {
          if (sidePanel && controller.isReviewing() && controller.canContinue()) {
            sidePanel.requestTruncate(controller.viewPly);
          }
        },
      });
      boardView.setAllowContinue(controller.canContinue());

      sidePanel = new SidePanel({
        container: sidePanelEl,
        modalRoot,
        board: controller.board,
        theme: ctx.getTheme(),
        variant: variant.id,
        showPool: settings.jieqi.showPool,
        practiceMode: controller.practiceMode,
        mode: mode === 'ai' ? 'ai' : 'pvp',
        playerSide: controller.playerSide,
        aiLevel: controller.aiLevel,
        engineType: controller.engineType,
        pikafishInfo: pfInfo,
        hintsLeft: controller.hintsLeft,
        muted: ctx.sfx.isMuted(),
        volume: ctx.sfx.getVolume(),
        voiceEnabled: ctx.sfx.isVoiceEnabled(),
        onNewGame: () => controller.startFreshGame(true),
        onUndo: () => controller.handleUndo(),
        onFlip: () => boardView.flip(),
        onToggleTheme: () => {
          const next = ctx.cycleTheme();
          stage.classList.add('is-theme-fading');
          window.setTimeout(() => {
            if (!controller || controller.disposed) return;
            controller.setTheme(next);
            boardView.setTheme(next);
            sidePanel.setTheme(next);
            stage.classList.remove('is-theme-fading');
          }, 100);
        },
        onTogglePractice: (enabled) => {
          controller.practiceMode = enabled;
          controller.activeRules = controller.variant.createRules(enabled);
          boardView.setRules(controller.activeRules, enabled);
          controller.evaluateStatus({ type: 'mode' });
        },
        onModeChange: (newMode) => {
          const mapped = newMode === 'ai' ? 'ai' : 'local';
          ctx.settingsStore.update((s) => {
            s.last.mode = mapped;
          });
          controller.mode = mapped;
          boardView.setAllowContinue(controller.canContinue());
          if (mapped === 'local') {
            pikafishClient.cancel();
            aiClient.terminate();
            boardView.setHumanSide(null);
            boardView.setFlipped(false);
            controller.startFreshGame(false);
          } else {
            controller.startFreshGame(false);
          }
        },
        onPlayerSideChange: (side) => {
          controller.playerSide = side;
          ctx.settingsStore.update((s) => {
            s.last.side = side;
          });
          controller.startFreshGame(false);
        },
        onAiLevelChange: (lvl) => {
          controller.aiLevel = lvl;
          ctx.settingsStore.update((s) => {
            s.last.level = lvl;
          });
          sidePanel.update(controller.lastStatus);
        },
        onEngineChange: (eng) => {
          controller.engineType = eng;
          ctx.settingsStore.update((s) => {
            s.last.engine = eng;
          });
          controller.cancelAi();
          if (eng === 'pikafish') aiClient.terminate();
          sidePanel.setEngineState(eng, pfInfo);
          if (controller.mode === 'ai' && !controller.isGameOver() && controller.board.sideToMove !== controller.playerSide) {
            controller.maybeTriggerAiTurn();
          }
        },
        onHint: () => controller.handleHint(),
        onResign: () => controller.handleResign(),
        onExportGame: () => {
          const viewedFen = controller.board.snapshotAt(controller.viewPly).fen;
          openExportModal(ctx, {
            record: buildCurrentRecord(
              controller.isGameOver() ? (controller.resigned ? (controller.playerSide === RED ? 'black' : 'red') : 'draw') : 'unfinished',
              controller.resigned ? 'resign' : null,
              'manual'
            ),
            currentFen: viewedFen,
            allowSaveToLibrary: true,
          });
        },
        onReviewGameOver: () => {
          controller.cancelEndFx();
          controller.viewPly = controller.board.history.length;
          sidePanel.update(controller.lastStatus);
          controller.updateViewHook();
        },
        onSelectPly: (ply, opts) => controller.goToPly(ply, opts),
        onStepPly: (delta) => controller.goToPly(controller.viewPly + delta),
        onToggleAutoPlay: () => controller.toggleAutoPlay(),
        onConfirmTruncate: (ply) => controller.handleContinueFromHere(ply),
        onToggleMute: () => {
          ctx.toggleMute();
          sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
        },
        onToggleVoice: () => {
          ctx.toggleVoice();
          sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
        },
        onVolumeChange: (vol) => {
          ctx.setVolume(vol);
        },
        onPanelUpdated: (info) => {
          if (moveStrip) moveStrip.update(info.viewPly);
          renderMobileControls(info);
          if (wakeLock) wakeLock.sync();
          if (topChipEl && controller) {
            const lvl = (AI_LEVELS.find((l) => l.id === controller.aiLevel) || AI_LEVELS[1]).name;
            topChipEl.textContent =
              `${variant.id === 'coup' ? 'Cờ Úp' : 'Cờ Tướng'} · ` +
              (controller.mode === 'ai' ? `Đấu máy · ${lvl}` : controller.mode === 'online' ? 'Trực tuyến' : 'Hai người');
          }
        },
      });

      function renderMobileControls(info = {}) {
        if (!mobileControlsEl || !controller || !sidePanel) return;
        const isRev = Boolean(info.isReview);
        const curMode = controller.mode;
        const undoDisallowed = controller.board.isJieqi && (curMode === 'ai' || curMode === 'online');
        const canUndo = info.canUndo ?? (!undoDisallowed && controller.board.history.length > 0);
        const canHint =
          curMode === 'ai' &&
          !isRev &&
          !controller.isGameOver() &&
          !sidePanel.aiThinking &&
          controller.hintsLeft > 0 &&
          controller.board.sideToMove === controller.playerSide;
        const gameOver = controller.isGameOver();

        let buttons = [];
        if (isRev) {
          buttons = [
            { act: 'rev-start', icon: '⏮', label: 'Đầu', disabled: controller.viewPly <= 0 },
            { act: 'rev-prev', icon: '◀', label: 'Trước', disabled: controller.viewPly <= 0 },
            { act: 'rev-play', icon: sidePanel.autoPlaying ? '⏸' : '⏯', label: 'Phát', disabled: false },
            { act: 'rev-next', icon: '▶', label: 'Sau', disabled: controller.viewPly >= controller.board.history.length },
            { act: 'rev-live', icon: '⏭', label: 'Cuối', disabled: controller.viewPly >= controller.board.history.length },
          ];
        } else if (curMode === 'ai') {
          if (!undoDisallowed) {
            buttons.push({ act: 'undo', icon: '↩', label: 'Đi lại', disabled: !canUndo });
          }
          buttons.push(
            { act: 'hint', icon: '💡', label: `Gợi ý (${controller.hintsLeft})`, disabled: !canHint },
            { act: 'resign', icon: '🏳', label: 'Đầu hàng', disabled: gameOver },
            { act: 'sheet', icon: '⌃', label: 'Nước đi', disabled: false }
          );
        } else if (curMode === 'online') {
          buttons = [
            { act: 'online-draw', icon: '🤝', label: 'Xin hòa', disabled: gameOver },
            { act: 'resign', icon: '🏳', label: 'Đầu hàng', disabled: gameOver },
            { act: 'sheet', icon: '⌃', label: 'Nước đi', disabled: false },
          ];
        } else {
          buttons = [
            { act: 'undo', icon: '↩', label: 'Đi lại', disabled: !canUndo },
            { act: 'flip', icon: '⇅', label: 'Xoay bàn', disabled: false },
            { act: 'new', icon: '＋', label: 'Ván mới', disabled: false },
            { act: 'sheet', icon: '⌃', label: 'Nước đi', disabled: false },
          ];
        }

        mobileControlsEl.innerHTML = buttons
          .map(
            (b) =>
              `<button type="button" class="mctrl-btn" data-maction="${b.act}" ${b.disabled ? 'disabled' : ''}>` +
              `<span class="mctrl-icon" aria-hidden="true">${b.icon}</span>` +
              `<span class="mctrl-label" data-nowrap="1">${b.label}</span>` +
              `</button>`
          )
          .join('');
      };

      mobileControlsEl.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-maction]');
        if (!btn || btn.disabled) return;
        const act = btn.dataset.maction;
        if (act === 'undo') controller.handleUndo();
        else if (act === 'flip') boardView.flip();
        else if (act === 'new') sidePanel.requestNewGame();
        else if (act === 'hint') controller.handleHint();
        else if (act === 'resign') sidePanel.requestResign();
        else if (act === 'online-draw') {
          if (onlineBridge && onlineBridge.drawBtn) onlineBridge.drawBtn.click();
        } else if (act === 'sheet') {
          if (bottomSheet) bottomSheet.toggle();
        } else if (act === 'rev-start') controller.goToPly(0);
        else if (act === 'rev-prev') controller.goToPly(controller.viewPly - 1);
        else if (act === 'rev-play') controller.toggleAutoPlay();
        else if (act === 'rev-next') controller.goToPly(controller.viewPly + 1);
        else if (act === 'rev-live') controller.goToPly(controller.board.history.length);
      });

      moveStrip = new MoveStrip({
        container: moveStripHost,
        board: controller.board,
        onSelectPly: (ply) => controller.goToPly(ply),
        onOpenSheet: () => {
          if (bottomSheet) bottomSheet.open('half');
        },
      });

      boardView.onFlipChange = (flipped) => {
        container.classList.toggle('is-flipped', Boolean(flipped));
      };
      container.classList.toggle('is-flipped', Boolean(boardView.flipped));

      const sheetEl = sidePanelEl.querySelector('[data-testid="bottom-sheet"]');
      if (sheetEl) {
        bottomSheet = new BottomSheet({
          sheetEl,
          hostContainer: container,
          onStateChange: (st) => {
            if (layoutManager) layoutManager.setSheetState(st);
            if (moveStrip) moveStrip.setExpanded(st !== 'closed');
          },
        });
      }

      layoutManager = new LayoutManager({
        rootEl: container,
        testMode: ctx.testMode,
        onChange: ({ mode: layoutMode, compactBoard }) => {
          if (boardView) boardView.setCompactMode(compactBoard);
          if (bottomSheet) bottomSheet.setEnabled(layoutMode === 'stack');
        },
      });

      ctx.sfx.voice.onCaption = (info) => {
        if (boardView) boardView.showVoiceCaption(info);
      };

      controller.attachViews(boardView, sidePanel);

      // Add "Lưu / Xuất" button to side panel (in all live modes)
      const exportRow = document.createElement('div');
      exportRow.className = 'side-export-row';
      exportRow.innerHTML = `<button type="button" class="pill-btn pill-btn-compact" data-action="save-export">💾 Lưu / Xuất</button>`;
      exportRow.querySelector('button').addEventListener('click', () => {
        const viewedFen = controller.board.snapshotAt(controller.viewPly).fen;
        openExportModal(ctx, {
          record: buildCurrentRecord('unfinished', null, 'manual'),
          currentFen: viewedFen,
          allowSaveToLibrary: mode !== 'online',
        });
      });
      const audioBar = sidePanelEl.querySelector('.audio-bar');
      if (audioBar) audioBar.parentNode.insertBefore(exportRow, audioBar);

      if (resumeSnap) {
        controller.restoreAutosave(resumeSnap);
      } else if (autosaveSlot && q.resume === '1' && ctx.gameStore) {
        const snap = await ctx.gameStore.getAutosave(autosaveSlot);
        if (snap) controller.restoreAutosave(snap);
      }

      onVisChange = () => {
        if (document.hidden) flushAutosaveNow();
      };
      onPageHide = () => flushAutosaveNow();
      document.addEventListener('visibilitychange', onVisChange);
      window.addEventListener('pagehide', onPageHide);
      leakTracker.trackListener(2);

      if (mode === 'online') {
        onlineBridge = new OnlineGameBridge({
          ctx,
          controller,
          boardView,
          sidePanel,
          stageEl: container.querySelector('#board-stage'),
        });
        await onlineBridge.attach();
      }

      wakeLock = new WakeLockController({
        shouldHold: () =>
          Boolean(
            controller &&
            !controller.disposed &&
            !controller.isGameOver() &&
            ctx.settingsStore.get().keepAwake !== false
          ),
      });
      wakeLock.sync();

      unsubSettings = ctx.settingsStore.subscribe((s) => {
        if (!controller || controller.disposed) return;
        const th = ctx.getTheme();
        controller.setTheme(th);
        boardView.setTheme(th);
        sidePanel.setTheme(th);
        sidePanel.syncAudio(s.audio.muted, s.audio.volume, s.audio.voice);
        sidePanel.setShowPool(s.jieqi.showPool);
        if (wakeLock) wakeLock.sync();
      });

      onBeforeUnload = () => {
        if (controller) controller.dispose();
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      leakTracker.trackListener(1);

      onKeyDown = (ev) => {
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        if (modalRoot && !modalRoot.hidden) {
          if (ev.key === 'Escape' && sidePanel) sidePanel.closeModal();
          return;
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
          ev.preventDefault();
          controller.handleUndo();
          return;
        }
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

        if (ev.key === 'ArrowLeft') {
          ev.preventDefault();
          controller.goToPly(controller.viewPly - 1);
        } else if (ev.key === 'ArrowRight') {
          ev.preventDefault();
          controller.goToPly(controller.viewPly + 1);
        } else if (ev.key === 'Home') {
          ev.preventDefault();
          controller.goToPly(0);
        } else if (ev.key === 'End') {
          ev.preventDefault();
          controller.goToPly(controller.board.history.length);
        } else if (ev.key === ' ') {
          ev.preventDefault();
          controller.toggleAutoPlay();
        } else if (ev.key === 'Escape') {
          if (controller.isReviewing()) {
            controller.goToPly(controller.board.history.length);
          } else {
            boardView.clearSelection();
          }
        } else {
          const key = ev.key.toLowerCase();
          if (key === 'f') boardView.flip();
          else if (key === 'm') {
            ctx.toggleMute();
            sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
          } else if (key === 'v') {
            ctx.toggleVoice();
            sidePanel.syncAudio(ctx.sfx.isMuted(), ctx.sfx.getVolume(), ctx.sfx.isVoiceEnabled());
          } else if (key === 'n') {
            sidePanel.requestNewGame();
          }
        }
      };
      window.addEventListener('keydown', onKeyDown);
      leakTracker.trackListener(1);
    },

    unmount() {
      if (autosaveTimer) {
        window.clearTimeout(autosaveTimer);
        autosaveTimer = null;
        leakTracker.trackTimer(-1);
      }
      if (onVisChange) {
        document.removeEventListener('visibilitychange', onVisChange);
        onVisChange = null;
        leakTracker.trackListener(-1);
      }
      if (onPageHide) {
        window.removeEventListener('pagehide', onPageHide);
        onPageHide = null;
        leakTracker.trackListener(-1);
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
      if (onBeforeUnload) {
        window.removeEventListener('beforeunload', onBeforeUnload);
        onBeforeUnload = null;
        leakTracker.trackListener(-1);
      }
      if (wakeLock) {
        wakeLock.dispose();
        wakeLock = null;
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
      if (onlineBridge) {
        onlineBridge.dispose();
        onlineBridge = null;
      }
      if (controller) {
        controller.dispose();
        controller = null;
      }
      if (sidePanel) {
        sidePanel.closeModal();
        sidePanel = null;
      }
      if (boardView) {
        boardView.dispose();
        boardView = null;
      }
      ctx.sfx.voice.onCaption = () => {};
    },
  };
}
