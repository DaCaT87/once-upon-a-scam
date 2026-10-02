import { audio, type MusicCue } from '../audio/engine';
import { firstFreeSlot, getUnit, stickerArtFile } from '../core/catalog';
import { clampPlayerName, PLAYER_NAME_MAX } from '../core/ids';
import { EVENT_BY_ID, HUNT_MONSTERS, eventHidesRarity, huntStickerFor, lossRewardRarity } from '../data/events';
import { rarityRank, shopMaxRarity, stickerMaxRarity } from '../data/rarity';
import { grantableStickers, libraryHuntStickers } from '../data/stickers';
import { UNITS } from '../data/units';
import { discover, loadCodex, loadPlayer, loadSettings, saveCodex, savePlayer, saveSettings } from '../persist/settings';
import { BattleView } from '../render/battleView';
import { circuitOpponent } from '../run/circuit';
import {
  afterResult,
  applyShopSticker,
  assignPendingSticker,
  settleStickerAssign,
  settleStickerShop,
  chooseAlley,
  canMoveUnitSlot,
  claimHunt,
  confirmDraft,
  createRun,
  bookSpread,
  claimBookSticker,
  claimBookUnit,
  ensureBookOffers,
  settleBookChoice,
  eventIsBlocked,
  eventSelectSticker,
  eventSelectUnit,
  eventUnitReward,
  migrateRun,
  huntKnockedOutIds,
  victoryPointsOf,
  ovenDiscardSticker,
  pickEventKind,
  placeDraft,
  placeEventUnit,
  placeRecruit,
  playerSnapshot,
  replaceEventUnit,
  replaceRecruit,
  seatGoldUnit,
  replaceBookUnit,
  resolveFight,
  resolveHuntFight,
  runScore,
  passAlley,
  skipEmptyEvent,
  skipRecruit,
  skipStickers,
  swapSlots,
  throwEventReward,
  recruitPickLimit,
  validateSnapshot,
} from '../run/runEngine';
import { createLocalServices } from '../services/local';
import type { AlleyChoice, CodexState, EventId, RunState, Settings, UnitInstance } from '../core/types';
import { ALLEY_PICK, DATA_VERSION, DRAFT_PICK, MAX_STICKERS, MAX_TEAM, RUN_ROUNDS, STICKER_PICK } from '../core/types';
import { bindTargetingTips, fitCardSlabs, paintPortraits, rarityLabel, renderDossierOverlay, renderOfferCard, renderStickerCard, renderTeamLane, renderUnitCard, t } from './cards';
import { bindFullscreenControls, enterFullscreen, exitFullscreen, setLandscapeGateLabel, syncFullscreenChrome, toggleFullscreen } from './fullscreen';
import { fadeOutLight, fadeOutScene, hideVeil, revealLight, revealScene, syncScene, willChangeScene } from './sceneFade';

type Screen = 'menu' | 'options' | 'run' | 'battle' | 'codex';

export class GameApp {
  private services = createLocalServices();
  private settings: Settings = loadSettings();
  private player = loadPlayer();
  private codex: CodexState = loadCodex();
  private run: RunState | null = null;
  private screen: Screen = 'menu';
  private cuts: string[] = [];
  private battleView: BattleView | null = null;
  /** Fight music starts when the board is visible, not during the round sign. */
  private battleFieldUp = false;
  /** Latest screen fade. An older fade bails out when a newer one starts. */
  private fadeTicket = 0;
  private raf = 0;
  private lastTs = 0;
  private dragSticker: string | null = null;
  private ghost: HTMLElement | null = null;
  private ghostGrabX = 36;
  private ghostGrabY = 36;
  private dragSlot: number | null = null;
  private cardZoom: HTMLElement | null = null;
  private zoomHold: { x: number; y: number; card: HTMLElement } | null = null;
  /** True when the open card zoom is what paused the scrap. */
  private zoomPaused = false;
  /** Offer waiting for which team card to fire when the line is full. */
  private recruitReplace: { defId: string; gold?: boolean } | null = null;
  /** Card waiting for which of 3 stickers to peel when applying a new one. */
  private replacePick: { instanceId: string; from: 'assign' | 'shop' | 'book'; stickerId?: string } | null = null;
  private applyFx: { instanceId: string; stickerId: string } | null = null;
  private shopBusy = false;
  private shopHoldTimer = 0;
  private ovenShopEnter = false;
  /** Offers whose art stays peeled/empty after a successful drop. */
  private spentOfferIds: string[] = [];

  private markSpentOffer(id: string): void {
    this.spentOfferIds.push(id);
  }

  private clearSpentOffers(): void {
    this.spentOfferIds = [];
  }
  private stopMenu: (() => void) | null = null;
  private dossierDefId: string | null = null;

  constructor(private root: HTMLElement) {}

  private runStatCtx(): { stickersGained: number; deathsThisRun: number } {
    return {
      stickersGained: this.run?.stickersGained ?? 0,
      deathsThisRun: this.run?.deathsThisRun ?? 0,
    };
  }

  async start(): Promise<void> {
    const tryId = this.tryEvent();
    if (this.isMarketTry()) {
      this.run = this.marketTryRun();
      this.screen = 'run';
    } else if (this.isWidowTry()) {
      this.run = this.widowTryRun();
      this.screen = 'battle';
    } else if (this.isWidowCardTry()) {
      this.run = this.widowCardTryRun();
      this.screen = 'run';
    } else if (this.isHuntCardsTry()) {
      this.run = this.huntCardsTryRun();
      this.screen = 'run';
    } else if (this.isWoodsmanTry()) {
      this.run = this.woodsmanTryRun();
      this.screen = 'run';
    } else if (this.isFilthTry()) {
      this.run = this.filthTryRun();
      this.screen = 'run';
    } else if (this.isScrapTry()) {
      sessionStorage.setItem('oua.scrap-boss', 'thousand-maws');
      this.run = this.scrapTryRun();
      this.screen = 'battle';
    } else if (this.isAmbushTry()) {
      this.run = this.ambushTryRun();
      this.screen = 'battle';
    } else if (tryId === 'monster-hunt') {
      this.armTry(tryId);
      this.run = resolveHuntFight({
        ...this.huntLoopRun(),
        phase: 'event',
        eventStep: 'preview',
        team: [
          { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'steel-sword', 'rusty-knife'], permanentMods: { atk: 8, hp: 12, speed: 2 } },
          { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword', 'fur-armor'], permanentMods: { atk: 6, hp: 10, speed: 2 } },
          { instanceId: 'u3', defId: 'royal-herald', slot: 3, stickerIds: ['fur-armor'], permanentMods: { atk: 4, hp: 8, speed: 1 } },
          { instanceId: 'u4', defId: 'puss-in-boots', slot: 4, stickerIds: ['steel-sword'], permanentMods: { atk: 5, hp: 8, speed: 3 } },
        ],
      });
      this.screen = 'battle';
    } else if (tryId) {
      this.armTry(tryId);
      this.run = this.tryRun(tryId);
      this.screen = 'run';
    } else {
      this.run = await this.services.runs.load();
      try {
        this.run?.team.forEach((u) => getUnit(u.defId));
        if (this.run) this.run = migrateRun(this.run);
        if (this.run?.phase === 'final') {
          this.run = null;
          await this.services.runs.clear();
        }
      } catch {
        this.run = null;
        await this.services.runs.clear();
      }
    }
    this.bindGlobal();
    bindFullscreenControls(() => ({
      enter: this.L('fullscreen'),
      exit: this.L('fullscreenExit'),
    }));
    document.getElementById('menu-stamp')?.addEventListener('click', () => {
      void this.onAction('menu', this.root);
    });
    document.getElementById('options-gear')?.addEventListener('click', () => {
      void this.onAction('options', this.root);
    });
    this.render();
  }

  private bindGlobal(): void {
    // Capture so the bus wakes before any button click tries to play.
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    audio.setVolumes(this.settings.music, this.settings.sfx, this.settings.ui);
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
        if (!btn || btn.matches(':disabled, [aria-disabled="true"]')) return;
        const act = btn.dataset.act;
        if (act === 'alley-recruit' || act === 'alley-sticker' || act === 'alley-event') return;
        audio.play('click', 'ui');
      },
      { capture: true },
    );
    document.getElementById('menu-stamp')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    document.getElementById('options-gear')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-act]');
      if (btn?.classList.contains('book-page') && target.closest('.rule-tip')) return;
      if (btn) this.onAction(btn.dataset.act!, btn);
    });
    this.root.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest('.btn-fight-art')) e.preventDefault();
    });
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        e.preventDefault();
        return;
      }
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      if (this.screen !== 'codex') return;
      const card = target.closest<HTMLElement>('.unit-card[data-def]');
      if (!card?.dataset.def) return;
      this.openDossier(card.dataset.def);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.cardZoom) {
        e.preventDefault();
        this.closeCardZoom();
        return;
      }
      const credits = document.getElementById('credits-panel');
      if (credits && !credits.hidden) {
        credits.hidden = true;
        return;
      }
      if (!this.dossierDefId) return;
      e.preventDefault();
      this.closeDossier();
    });
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.phonePlay() || e.button !== 0 || this.cardZoom) return;
        const card = this.zoomableCard(e.target);
        if (!card) return;
        this.zoomHold = { x: e.clientX, y: e.clientY, card };
      },
      { capture: true },
    );
    window.addEventListener('pointermove', (e) => {
      const hold = this.zoomHold;
      if (!hold) return;
      if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 14) this.zoomHold = null;
    });
    window.addEventListener('pointerup', (e) => {
      const hold = this.zoomHold;
      this.zoomHold = null;
      if (!hold || !this.phonePlay()) return;
      if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 14) return;
      const card = hold.card;
      requestAnimationFrame(() => {
        if (!card.isConnected || this.cardZoom) return;
        this.openCardZoom(card);
      });
    });
    window.addEventListener('pointercancel', () => {
      this.zoomHold = null;
    });
    document.getElementById('credits-stamp')?.addEventListener('click', () => {
      const panel = document.getElementById('credits-panel');
      if (!panel) return;
      const copy = document.getElementById('credits-copy');
      if (copy) copy.textContent = this.L('audioNote');
      panel.hidden = !panel.hidden;
    });
    bindTargetingTips(this.root, () => this.settings.locale);
  }

  private async persist(): Promise<void> {
    if (this.run?.phase === 'final') {
      if (this.tryEvent() || this.isMarketTry() || this.isWidowTry() || this.isWidowCardTry() || this.isHuntCardsTry() || this.isWoodsmanTry() || this.isFilthTry() || this.isScrapTry() || this.isAmbushTry()) sessionStorage.removeItem('oua.try-run');
      else await this.services.runs.clear();
    } else if (this.run) {
      if (this.tryEvent() || this.isMarketTry() || this.isWidowTry() || this.isWidowCardTry() || this.isHuntCardsTry() || this.isWoodsmanTry() || this.isFilthTry() || this.isScrapTry() || this.isAmbushTry()) sessionStorage.setItem('oua.try-run', JSON.stringify(this.run));
      else await this.services.runs.save(this.run);
    }
    saveSettings(this.settings);
    saveCodex(this.codex);
  }

  private L(key: string): string {
    return t(this.settings.locale, key);
  }

  private recruitCountHint(count: number, limit: number): string {
    return `${this.L('alleyHint')} <b class="recruit-count">${count}/${limit}</b>`;
  }

  private recruitRoundHtml(round: number, points = 0): string {
    return `<span class="recruit-round-line">${this.L('round')} <span class="recruit-round-count"><b>${round}</b><i>/</i><b>${RUN_ROUNDS}</b></span></span><span class="line-crown rule-tip" aria-expanded="false" aria-label="${this.L('victoryPoints')}"><img src="./art/ui/crown-wins.png?v=crown7" alt="" draggable="false" /><b><span class="vp-max" aria-hidden="true">30</span><span class="vp-face">${points}</span></b><span class="targeting-tip" role="tooltip">${this.L('victoryPoints')}</span></span>`;
  }

  private shopPicksDone(): boolean {
    if (!this.run) return false;
    if (this.run.phase === 'draft') return this.run.draftPicks.length >= DRAFT_PICK;
    if (this.run.phase === 'recruit') {
      if (this.recruitReplace) return false;
      return this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep);
    }
    if (this.run.phase === 'sticker') return this.spentOfferIds.length >= STICKER_PICK;
    if (this.isGiftStickerAssign()) {
      return this.run.pendingStickerIds.length === 0 && this.spentOfferIds.length > 0;
    }
    return false;
  }

  private shopPassClass(extra = ''): string {
    const ready = this.shopPicksDone() ? ' is-shop-ready' : '';
    return `btn ghost${extra}${ready}`;
  }

  private syncShopPassReady(): void {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-act="skip-recruit"], [data-act="skip-sticker"]');
    if (!btn) return;
    btn.classList.toggle('is-shop-ready', this.shopPicksDone());
  }

  private clearShopHold(): void {
    window.clearTimeout(this.shopHoldTimer);
    this.shopHoldTimer = 0;
  }

  private scheduleShopClose(): void {
    if (!this.shopPicksDone()) return;
    this.shopBusy = true;
    this.clearShopHold();
    this.shopHoldTimer = window.setTimeout(() => {
      void this.closeFinishedShop();
    }, 1000);
  }

  private async closeFinishedShop(): Promise<void> {
    if (!this.run || !this.shopPicksDone()) {
      this.shopBusy = false;
      return;
    }
    this.shopBusy = false;
    this.recruitReplace = null;
    this.replacePick = null;
    if (this.run.phase === 'draft') {
      this.run = confirmDraft(this.run);
      this.noteTeam();
    } else if (this.run.phase === 'recruit') {
      this.run = skipRecruit(this.run);
    } else if (this.isGiftStickerAssign()) {
      this.run = settleStickerAssign(this.run);
      this.clearSpentOffers();
    } else if (this.run.phase === 'sticker') {
      this.run = settleStickerShop(this.run);
      this.clearSpentOffers();
    } else {
      return;
    }
    await this.persist();
    this.render();
    this.maybeLoopEvents();
  }

  private isGiftStickerAssign(): boolean {
    return this.run?.phase === 'stickerAssign';
  }

  /** Event rewards reuse the recruit and sticker screens. Keep the event's name on them. */
  private eventFaceTitle(fallbackKey: string): string {
    const run = this.run;
    if (!run?.eventId || !run.eventStep) return this.L(fallbackKey);
    const ev = EVENT_BY_ID.get(run.eventId);
    return ev ? this.L(ev.nameKey) : this.L(fallbackKey);
  }

  private stickerShopOfferIds(): string[] {
    if (!this.run) return [];
    if (this.run.phase === 'sticker') return this.run.stickerOffers;
    if (this.isGiftStickerAssign()) {
      return [...this.run.pendingStickerIds, ...this.spentOfferIds];
    }
    return [];
  }

  private bindStickerShopGestures(opts?: { offers?: boolean }): void {
    if (!this.run || (this.run.phase !== 'sticker' && !this.isGiftStickerAssign())) return;
    if (opts?.offers !== false) this.setupStickerDrag('.sticker-card.shop-sticker');
    this.root.querySelectorAll<HTMLElement>('.sticker-shop-team .unit-card[data-instance]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (!this.run || !this.replacePick || (this.replacePick.from !== 'shop' && this.replacePick.from !== 'assign')) return;
        if (this.replacePick.instanceId !== el.dataset.instance) return;
        const slotEl = (e.target as HTMLElement).closest<HTMLElement>('.sticker-slot.filled');
        if (!slotEl || !this.replacePick.stickerId) return;
        const idx = Number(slotEl.dataset.stickerSlot);
        if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_STICKERS) return;
        e.preventDefault();
        e.stopPropagation();
        this.commitStickerApply(el.dataset.instance!, idx, this.replacePick.stickerId);
      });
    });
  }

  private patchStickerShopDom(): void {
    if (!this.run || (this.run.phase !== 'sticker' && !this.isGiftStickerAssign())) return;
    const loc = this.settings.locale;
    const teamRoot = this.recruitTeamRoot();
    if (teamRoot) {
      teamRoot.innerHTML = renderTeamLane(loc, this.run.team, {
        showEmpty: true,
        ...this.runStatCtx(),
        cardOpts: (u) => ({
          extraClass:
            (this.replacePick?.from === 'shop' || this.replacePick?.from === 'assign') &&
            this.replacePick.instanceId === u.instanceId
              ? 'is-replace-pick'
              : '',
        }),
      });
      requestAnimationFrame(() => fitCardSlabs(teamRoot));
    }
    const hint = this.root.querySelector('.screen-sticker .sticker-shop-hint');
    if (hint) {
      if (this.replacePick?.from === 'shop' || this.replacePick?.from === 'assign') hint.textContent = this.L('replaceHint');
      else if (this.run.phase === 'stickerAssign') {
        hint.textContent = this.L(this.run.eventId ? 'eventRewardSticker' : 'stickOneHint');
      } else {
        hint.textContent = this.L('stickOneHint');
      }
    }
    const pass = this.root.querySelector('[data-act="skip-sticker"]');
    if (pass) pass.className = this.shopPassClass(' sticker-throw-away');
    this.bindStickerShopGestures({ offers: false });
  }


  /** One id per screen. Picks inside the same shop do not count as a new screen. */
  private viewKey(): string {
    if (this.screen !== 'run' || !this.run) return this.screen;
    const run = this.run;
    if (run.phase === 'event' || run.phase === 'formation') {
      return `run:${run.phase}:${run.eventId ?? ''}:${run.eventStep ?? ''}`;
    }
    return `run:${run.phase}`;
  }

  private go(screen: Screen): void {
    this.dossierDefId = null;
    if (screen === 'battle') this.battleFieldUp = false;
    this.screen = screen;
    this.render();
  }

  /** Scrap arena, player or hunt, dims under a light black before the square is painted. */
  private async fadeArenaToSquare(): Promise<void> {
    const ticket = ++this.fadeTicket;
    cancelAnimationFrame(this.raf);
    await fadeOutLight();
    if (ticket !== this.fadeTicket) return;
    this.paintScreen();
    revealLight(this.viewKey());
  }

  /** Cover the screen that is still up, then paint the next one and uncover it. */
  private async crossfadeRender(): Promise<void> {
    const ticket = ++this.fadeTicket;
    if (this.screen !== 'battle') cancelAnimationFrame(this.raf);
    await fadeOutScene();
    if (ticket !== this.fadeTicket) return;
    this.paintScreen();
    const page = this.viewKey();
    if (this.screen === 'battle' && !this.battleFieldUp) {
      syncScene(page);
      hideVeil();
      return;
    }
    revealScene(page);
  }

  private render(): void {
    const page = this.viewKey();
    const curtain = this.screen === 'battle' && !this.battleFieldUp;
    if (!curtain && willChangeScene(page)) {
      void this.crossfadeRender();
      return;
    }
    this.paintScreen();
    syncScene(page);
  }

  /** A phone in landscape. A mouse, even in a small window, does not count. */
  private phonePlay(): boolean {
    const short = Math.min(window.innerWidth, window.innerHeight);
    return short < 520 && window.matchMedia('(pointer: coarse)').matches;
  }

  private zoomableCard(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    if (target.closest('.card-zoom, .rule-tip, .dossier-overlay, button, a, input')) return null;
    const unit = target.closest<HTMLElement>('.unit-card');
    if (unit && !unit.classList.contains('is-empty') && !unit.classList.contains('team-slot-empty')) return unit;
    const sticker = target.closest<HTMLElement>('.sticker-card');
    if (sticker) return sticker;
    return null;
  }

  /** Library card for this figure, including the stickers glued on it. */
  private zoomCardHtml(card: HTMLElement): string {
    const loc = this.settings.locale;
    if (card.classList.contains('sticker-card')) {
      const id = card.dataset.sticker;
      return id ? renderStickerCard(loc, id, false) : '';
    }
    const defId = card.dataset.def;
    if (!defId) return '';
    const instanceId = card.dataset.instance || defId;
    const saved = this.run?.team.find((u) => u.instanceId === instanceId);
    const stickerIds = [...card.querySelectorAll<HTMLElement>(':scope > .sticker-rail .sticker-slot.filled')]
      .map((slot) => slot.dataset.sticker)
      .filter((id): id is string => Boolean(id));
    return renderUnitCard(
      loc,
      {
        instanceId,
        defId,
        slot: Number(card.dataset.slot) || saved?.slot || 1,
        stickerIds: stickerIds.length ? stickerIds : (saved?.stickerIds ?? []),
        permanentMods: saved?.permanentMods ?? { atk: 0, hp: 0, speed: 0 },
      },
      this.runStatCtx(),
    );
  }

  private openCardZoom(card: HTMLElement): void {
    if (!this.phonePlay()) return;
    const html = this.zoomCardHtml(card);
    if (!html) return;
    this.closeCardZoom();
    document.querySelector('.targeting-float')?.classList.remove('is-on');
    this.root.querySelectorAll('.rule-tip.is-open').forEach((el) => {
      el.classList.remove('is-open');
      el.setAttribute('aria-expanded', 'false');
    });
    const overlay = document.createElement('div');
    overlay.className = 'card-zoom';
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'card-zoom-scrim';
    scrim.setAttribute('aria-label', this.L('exit'));
    const stage = document.createElement('div');
    stage.className = 'card-zoom-stage';
    stage.innerHTML = html;
    const face = stage.querySelector<HTMLElement>('.unit-card, .sticker-card');
    if (!face) return;
    face.querySelectorAll('img').forEach((img) => {
      img.draggable = false;
    });
    overlay.append(scrim, stage);
    const shut = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeCardZoom();
    };
    overlay.addEventListener('pointerdown', shut);
    overlay.addEventListener('click', shut);
    document.body.appendChild(overlay);
    const naturalW = face.offsetWidth || 248;
    const naturalH = face.offsetHeight || 375;
    const scale = Math.min((window.innerWidth - 28) / naturalW, (window.innerHeight - 20) / naturalH);
    face.style.transformOrigin = 'top left';
    face.style.transform = `scale(${scale})`;
    stage.style.width = `${naturalW * scale}px`;
    stage.style.height = `${naturalH * scale}px`;
    this.cardZoom = overlay;
    const pauseBtn = this.root.querySelector<HTMLButtonElement>('[data-act="pause-battle"]');
    if (this.screen === 'battle' && this.battleView && pauseBtn?.dataset.paused !== '1') {
      this.battleView.setPaused(true);
      this.zoomPaused = true;
    }
  }

  private closeCardZoom(): void {
    this.cardZoom?.remove();
    this.cardZoom = null;
    if (!this.zoomPaused) return;
    this.zoomPaused = false;
    const pauseBtn = this.root.querySelector<HTMLButtonElement>('[data-act="pause-battle"]');
    if (pauseBtn?.dataset.paused !== '1') this.battleView?.setPaused(false);
  }

  private paintScreen(): void {
    this.closeCardZoom();
    this.stopMenu?.();
    this.stopMenu = null;
    if (this.screen !== 'battle') cancelAnimationFrame(this.raf);
    audio.setVolumes(this.settings.music, this.settings.sfx, this.settings.ui);
    document.title = this.tryTitle() ?? (this.isWidowTry() || this.isWidowCardTry() ? 'Widow' : null) ?? (this.isHuntCardsTry() ? 'Hunt cards' : null) ?? (this.isWoodsmanTry() ? 'Woodsman' : null) ?? (this.isFilthTry() ? 'Filth' : null) ?? (this.isScrapTry() ? 'Scrap' : null) ?? (this.isAmbushTry() ? 'Ambush' : null) ?? (this.isMarketTry() ? 'Market' : null) ?? this.L('title');
    if (this.run?.phase === 'recruit' && this.run.pendingGoldUnitId) {
      this.recruitReplace = { defId: this.run.pendingGoldUnitId, gold: true };
    }
    const huntFight = this.screen === 'battle' && this.isHuntBattle();
    document.documentElement.classList.toggle('is-menu', this.screen === 'menu' || this.screen === 'options');
    document.documentElement.classList.toggle('is-battle', this.screen === 'battle' && !huntFight);
    document.documentElement.classList.toggle('is-hunt', huntFight);
    document.documentElement.classList.toggle('is-square', this.screen === 'run');
    document.documentElement.classList.toggle('is-codex', this.screen === 'codex');
    document.documentElement.classList.toggle('is-preamble', this.screen === 'battle');
    const huntEvent =
      this.screen === 'run' &&
      this.run?.eventId === 'monster-hunt' &&
      this.run.phase !== 'stickerAssign';
    const curtainHold = this.screen === 'battle' && !this.battleFieldUp;
    if (curtainHold) {
      /* Square music is already fading. Fight/hunt starts when the field appears. */
    } else if (huntEvent) audio.fadeOut();
    else audio.setCue(this.musicCue());
    switch (this.screen) {
      case 'menu':
        this.root.innerHTML = this.menuHtml();
        paintPortraits(this.root);
        break;
      case 'options':
        this.root.innerHTML = this.optionsHtml();
        break;
      case 'run':
        if (this.run?.eventId === 'monster-hunt' && this.run.eventStep === 'hunt-result') {
          this.run = claimHunt(this.run);
          void this.persist();
        }
        if (this.run?.phase === 'result') {
          this.run = afterResult(this.run);
          if (this.run.phase === 'final') void this.finishRun();
          void this.persist();
        }
        this.root.innerHTML = this.runHtml();
        if (this.ovenShopEnter) {
          this.root.querySelector('.screen')?.classList.add('is-oven-enter');
          this.ovenShopEnter = false;
        }
        paintPortraits(this.root);
        this.bindRunGestures();
        break;
      case 'battle':
        this.root.innerHTML = this.battleHtml();
        this.mountBattle();
        break;
      case 'codex':
        this.root.innerHTML = this.codexHtml();
        paintPortraits(this.root);
        break;
    }
    this.mountDossier();
    syncFullscreenChrome(this.L('fullscreen'), this.L('fullscreenExit'));
    setLandscapeGateLabel(this.L('turnPhone'));
    const stamps = document.querySelector('.corner-stamps');
    if (stamps instanceof HTMLElement) stamps.hidden = this.screen === 'codex';
    const creditsBtn = document.getElementById('credits-stamp');
    const creditsPanel = document.getElementById('credits-panel');
    const creditsCopy = document.getElementById('credits-copy');
    if (creditsCopy) creditsCopy.textContent = this.L('audioNote');
    if (creditsBtn) {
      creditsBtn.hidden = this.screen !== 'menu';
      creditsBtn.textContent = this.L('credits');
    }
    if (creditsPanel && this.screen !== 'menu') creditsPanel.hidden = true;
    const menuStamp = document.getElementById('menu-stamp');
    if (menuStamp) {
      menuStamp.textContent = this.L('quitToMenu');
      menuStamp.hidden = this.screen === 'menu';
    }
    const gear = document.getElementById('options-gear');
    if (gear) {
      gear.setAttribute('aria-label', this.L('options'));
      gear.hidden = this.screen !== 'menu' && this.screen !== 'options';
    }
  }

  private openDossier(defId: string): void {
    try {
      getUnit(defId);
    } catch {
      return;
    }
    this.dossierDefId = defId;
    audio.play('paper', 'ui');
    this.mountDossier();
  }

  private closeDossier(): void {
    this.dossierDefId = null;
    document.querySelector('.dossier-overlay')?.remove();
  }

  private mountDossier(): void {
    document.querySelector('.dossier-overlay')?.remove();
    if (!this.dossierDefId) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = renderDossierOverlay(this.settings.locale, this.dossierDefId).trim();
    const el = wrap.firstElementChild;
    if (!(el instanceof HTMLElement)) return;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (!(e.target instanceof Element)) return;
      const hop = e.target.closest<HTMLElement>('[data-act="next-dossier"], [data-act="prev-dossier"]');
      if (hop?.dataset.def) {
        e.preventDefault();
        this.openDossier(hop.dataset.def);
        return;
      }
      if (!e.target.closest('[data-act="close-dossier"]')) return;
      e.preventDefault();
      this.closeDossier();
    });
  }

  private menuHtml(): string {
    return `
      <section class="screen menu-screen">
        <div class="menu-stage" aria-hidden="true">
          <div class="menu-paint"></div>
          <div class="menu-wash"></div>
        </div>
        <div class="brand">
          <h1>
            <img class="brand-logo" src="./art/ui/logo-title.png?v=logo2" alt="${this.L('title')}" draggable="false" />
          </h1>
        </div>
        <div class="col menu-actions">
          <label class="menu-alias">${this.L('playerName')}
            <input class="name-field" id="alias" maxlength="${PLAYER_NAME_MAX}" value="${this.esc(clampPlayerName(this.player.name))}" />
          </label>
          <button class="btn btn-play" data-act="new-run">${this.L('newRun')}</button>
          ${this.run && this.run.phase !== 'final' ? `<button class="btn ghost" data-act="continue">${this.L('continue')}</button>` : ''}
          <button class="btn ghost" data-act="codex">${this.L('codex')}</button>
          <button class="btn ghost" data-act="exit-game">${this.L('exit')}</button>
        </div>
      </section>`;
  }

  private optionsHtml(): string {
    const on = (locale: 'en' | 'it') => (this.settings.locale === locale ? ' is-on' : '');
    return `
      <section class="screen menu-screen">
        <div class="menu-stage" aria-hidden="true">
          <div class="menu-paint"></div>
          <div class="menu-wash"></div>
        </div>
        <div class="col menu-actions">
          <button type="button" class="btn ghost${on('en')}" data-act="set-locale" data-locale="en" aria-pressed="${this.settings.locale === 'en'}">${this.L('langEnglish')}</button>
          <button type="button" class="btn ghost${on('it')}" data-act="set-locale" data-locale="it" aria-pressed="${this.settings.locale === 'it'}">${this.L('langItalian')}</button>
          <button type="button" class="btn ghost" data-act="menu">${this.L('back')}</button>
        </div>
      </section>`;
  }

  private runHtml(): string {
    const run = this.run!;
    if (run.phase !== 'sticker' && run.phase !== 'stickerAssign') this.clearSpentOffers();
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    if (run.phase === 'draft') {
      return `
        <section class="screen screen-recruit">
          <div class="hud recruit-hud">
            <span class="recruit-title">${this.L('recruit')}</span>
            <p class="hint sticker-shop-hint">${this.recruitCountHint(run.draftPicks.length, DRAFT_PICK)}</p>
            <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
          </div>
          <div class="recruit-shop-offers grid5">${run.draftOffers
            .map((id) => renderOfferCard(loc, id, false, '', stats))
            .join('')}</div>
          <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, { showEmpty: true, ...stats })}</div>
          <div class="row recruit-actions">
            <button class="${this.shopPassClass()}" data-act="skip-recruit">${this.L('skipRecruit')}</button>
          </div>
        </section>`;
    }
    if (run.phase === 'postFight') {
      const rarity = shopMaxRarity(run.round);
      const done = run.alleyDone ?? [];
      const ev = run.eventId ? EVENT_BY_ID.get(run.eventId) : undefined;
      const plate = (id: AlleyChoice, art: string, title: string, desc: string, opts?: { extraClass?: string; rarity?: string }) => {
        const used = done.includes(id);
        const rar = opts?.rarity ?? rarity;
        const extra = opts?.extraClass ? ` ${opts.extraClass}` : '';
        const hunt = Boolean(opts?.extraClass?.includes('is-hunt-plate'));
        const hideRarity = Boolean(opts?.extraClass?.includes('is-event-plain'));
        const shopGem = id === 'recruit' || id === 'sticker' || Boolean(opts?.extraClass?.includes('is-alley-hunt-cutout'));
        const mark = shopGem
          ? `<img class="shop-gem" src="./art/ui/shop-gem-${rar}.png?v=gem2" alt="" draggable="false" />`
          : hunt && !hideRarity && !opts?.extraClass?.includes('printed-card')
            ? `<img class="hunt-rarity" src="./art/ui/rarity-corner-${rar}.png?v=gem1" alt="" draggable="false" /><div class="rarity-mark"><img src="./art/ui/rarity-${rar}.png?v=metal" alt="" draggable="false" /></div>`
            : '';
        return `<button type="button" class="unit-card rarity-${rar} choice-plate is-${id}${extra}${used ? ' is-done' : ''}" data-act="alley-${id}" ${used ? 'disabled' : ''}>
          <div class="card-art">
            <img class="portrait-art scenic" src="${art}" alt="" draggable="false" />
          </div>
          ${mark}
          <div class="card-slab">
            <h3 class="card-name">${title}</h3>
            <div class="ability"><p class="ability-rule">${desc}</p></div>
          </div>
        </button>`;
      };
      const eventPlateHtml = (() => {
        if (run.eventId === 'monster-hunt' && run.huntMonsterId) {
          return plate(
            'event',
            `./art/ui/plate-hunt-${run.huntMonsterId}.png?v=alley3`,
            ev ? this.L(ev.nameKey) : this.L('alleyEvent'),
            ev ? this.L(ev.descKey) : this.L('alleyEventD'),
            { extraClass: 'is-event-plain is-alley-full-plate is-alley-hunt-cutout', rarity: HUNT_MONSTERS.find((m) => m.unitId === run.huntMonsterId)?.rarity },
          );
        }
        const title = ev ? this.L(ev.nameKey) : this.L('alleyEvent');
        const desc = ev ? this.L(ev.descKey) : this.L('alleyEventD');
        if (run.eventId === 'witch-oven') {
          return plate('event', './art/ui/plate-witch-oven.png?v=alley10', title, desc, {
            extraClass: 'is-event-plain is-alley-full-plate',
          });
        }
        if (run.eventId === 'wishing-well') {
          return plate('event', './art/ui/plate-wishing-well.png?v=alley17', title, desc, {
            extraClass: 'is-event-plain is-alley-full-plate',
          });
        }
        if (run.eventId === 'cloning-chamber') {
          return plate('event', './art/ui/plate-cloning-chamber.png?v=alley30', title, desc, {
            extraClass: 'is-event-plain is-alley-full-plate',
          });
        }
        if (run.eventId === 'book-of-lost-tales') {
          return plate('event', './art/ui/plate-book-of-lost-tales.png?v=bookplate8', title, desc, {
            extraClass: 'is-event-plain is-alley-full-plate',
          });
        }
        const art = ev?.art ?? './art/ui/plate-event-gift.jpg?v=card1';
        return plate('event', art, title, desc, eventHidesRarity(run.eventId) ? { extraClass: 'is-event-plain' } : undefined);
      })();
      const hint = done.length > 0 ? this.L('alleyHintNext') : this.L('alleyHintLead');
      return `
        <section class="screen screen-choice">
          <div class="hud recruit-hud">
            <span class="recruit-title">${this.L('alleyTitle')}</span>
            <p class="hint sticker-shop-hint">${hint} <b class="recruit-count">${done.length}/${ALLEY_PICK}</b></p>
            <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
          </div>
          <div class="choice-table">
            ${plate('recruit', './art/ui/plate-recruit.png?v=recruit15', this.L('alleyRecruit'), this.L('alleyRecruitD'), {
              extraClass: 'is-event-plain is-alley-full-plate',
            })}
            ${plate('sticker', './art/ui/plate-sticker.png?v=alley3', this.L('alleySticker'), this.L('alleyStickerD'), {
              extraClass: 'is-event-plain is-alley-full-plate',
              rarity: stickerMaxRarity(run.round),
            })}
            ${eventPlateHtml}
          </div>
          <div class="row recruit-actions">
            <button class="btn ghost" data-act="pass-alley">${this.L('alleyPass')}</button>
          </div>
        </section>`;
    }
    if (run.phase === 'event') {
      if (this.isHuntLineup()) return this.teamLineupHtml();
      if (run.eventId === 'wishing-well') return this.wellHtml();
      if (run.eventId === 'witch-oven') return this.ovenHtml();
      if (run.eventId === 'cloning-chamber') return this.cloneHtml();
      if (run.eventId === 'book-of-lost-tales' && run.eventStep === 'book-kind') {
        const opened = ensureBookOffers(run);
        if (opened !== run) {
          this.run = opened;
          void this.persist();
        }
        return this.bookHtml();
      }
      return this.eventHtml();
    }
    if (run.phase === 'sticker' || this.isGiftStickerAssign()) {
      const offers = this.stickerShopOfferIds();
      const hint = this.replacePick?.from === 'shop' || this.replacePick?.from === 'assign'
        ? this.L('replaceHint')
        : run.phase === 'stickerAssign' && run.eventId
          ? this.L('eventRewardSticker')
          : this.L('stickOneHint');
      return `
        <section class="screen screen-sticker${run.eventId && run.eventStep ? ' is-event-title' : ''}">
          <div class="hud recruit-hud">
            <span class="recruit-title">${this.eventFaceTitle('alleySticker')}</span>
            <p class="hint sticker-shop-hint">${hint}</p>
            <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
          </div>
          <div class="sticker-shop-offers row">${offers
            .map((id, i) => {
              const spent = this.isGiftStickerAssign()
                ? i >= run.pendingStickerIds.length
                : this.spentOfferIds.includes(id);
              return renderStickerCard(loc, id, false, spent ? 'shop-sticker is-spent-offer' : 'shop-sticker');
            })
            .join('')}</div>
          <div class="sticker-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
            showEmpty: true,
            ...stats,
            cardOpts: (u) => ({
              extraClass:
                (this.replacePick?.from === 'shop' || this.replacePick?.from === 'assign') &&
                this.replacePick.instanceId === u.instanceId
                  ? 'is-replace-pick'
                  : '',
            }),
          })}</div>
          <button type="button" class="${this.shopPassClass(' sticker-throw-away')}" data-act="skip-sticker">${this.L('skipRecruit')}</button>
        </section>`;
    }
    if (run.phase === 'stickerAssign') {
      const hint = this.replacePick?.from === 'assign'
        ? this.L('replaceHint')
        : run.eventId
          ? this.L('eventRewardSticker')
          : this.L('stickOneHint');
      const pendings = run.pendingStickerIds;
      const ev = run.eventId ? EVENT_BY_ID.get(run.eventId) : undefined;
      const title = ev ? this.L(ev.nameKey) : this.L('assignSticker');
      return `
        <section class="screen screen-sticker">
          <div class="hud"><span>${title}</span><span>${pendings.length} left</span></div>
          <p class="hint sticker-shop-hint" style="color:var(--cream)">${hint}</p>
          <div class="sticker-shop-offers row">${pendings.map((id) => renderStickerCard(loc, id, true, 'assign-sticker')).join('')}</div>
          <div class="sticker-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
            ...stats,
            cardOpts: (u) => ({
              extraClass:
                this.replacePick?.from === 'assign' && this.replacePick.instanceId === u.instanceId
                  ? 'is-replace-pick'
                  : '',
            }),
          })}</div>
          <button type="button" class="${this.shopPassClass(' sticker-throw-away')}" data-act="skip-sticker">${this.L('skipRecruit')}</button>
        </section>`;
    }
    if (run.phase === 'recruit') {
      const limit = recruitPickLimit(run.recruitPicks, run.eventId, run.eventStep);
      const hint = this.recruitReplace ? this.L('recruitReplaceHint') : this.L('recruitHint');
      const replacing = Boolean(this.recruitReplace);
      return `
        <section class="screen screen-recruit${replacing ? ' is-replacing' : ''}">
          <div class="hud recruit-hud">
            <span class="recruit-title">${this.eventFaceTitle('recruit')}</span>
            <p class="hint sticker-shop-hint">${replacing ? hint : this.recruitCountHint(run.recruitPicks.length, limit)}</p>
            <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
          </div>
          <div class="recruit-shop-offers grid5">${this.recruitOfferIds(run)
            .map((id) => renderOfferCard(loc, id, this.recruitReplace?.defId === id, '', stats))
            .join('')}</div>
          <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
            showEmpty: true,
            ...stats,
            cardOpts: (u) => ({
              extraClass: replacing && !this.goldWouldReplaceHerald(u) ? 'is-replace-pick' : '',
            }),
          })}</div>
          <div class="row recruit-actions">
            ${
              replacing && !this.recruitReplace?.gold
                ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
                : replacing
                  ? ''
                  : `<button class="${this.shopPassClass()}" data-act="skip-recruit">${this.L('skipRecruit')}</button>`
            }
          </div>
        </section>`;
    }
    if (run.phase === 'result') {
      const b = run.lastBattle!;
      const win = b.winner === 'player';
      return `
        <section class="screen screen-result">
          <h2 class="result-title ${win ? 'is-win' : 'is-lose'}">${win ? this.L('resultWin') : this.L('resultLose')}</h2>
          <p class="result-wins">${this.L('wins')} ${run.wins}${this.L('of10')}</p>
          <div class="grid5 result-team team-table">${renderTeamLane(loc, run.team, stats)}</div>
          <button class="btn result-next" data-act="after-result">${this.L('next')}</button>
        </section>`;
    }
    if (run.phase === 'final') {
      const rows = this.standingsRows();
      return `
        <section class="screen screen-final">
          <div class="final-sheet">
            <h2 class="final-title">${this.L('finalTitle')}</h2>
            <table>
              <thead>
                <tr>
                  <th>${this.L('standingPlace')}</th>
                  <th>${this.L('standingName')}</th>
                  <th class="num">${this.L('victoryPoints')}</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row) =>
                      `<tr class="${row.you ? 'is-you' : ''}"><td>${row.place}</td><td class="name">${this.esc(row.name)}</td><td class="num">${row.points}</td></tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>`;
    }
    return this.teamLineupHtml();
  }

  private isHuntLineup(): boolean {
    const run = this.run;
    if (!run || run.phase !== 'event' || run.eventId !== 'monster-hunt') return false;
    return run.eventStep === 'hunt-lineup' || run.eventStep === 'preview';
  }

  private teamLineupHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    return `
      <section class="screen screen-team">
        <div class="hud recruit-hud">
          <div class="line-heading">
            <span class="recruit-title">${this.L('formationTitle')}</span>
          </div>
          <p class="hint sticker-shop-hint">${this.L('formationHint')}</p>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <div class="grid5 team-table" id="lineup">${renderTeamLane(loc, run.team, {
          ...stats,
          showEmpty: true,
          slotBadge: true,
        })}</div>
        <div class="team-actions">
          <button class="btn-fight-art" data-act="fight" draggable="false" aria-label="${this.L('fight')}">
            <img src="./art/ui/btn-fight.png?v=fight-alpha1" alt="${this.L('fight')}" draggable="false" />
          </button>
        </div>
      </section>`;
  }

  private wellHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const empty = eventIsBlocked(run);
    const unitReward = run.eventStep === 'reward-unit' ? eventUnitReward(run) : null;
    const replacing = Boolean(this.recruitReplace);
    const hint = replacing
      ? this.L('recruitReplaceHint')
      : unitReward
        ? this.L('eventRewardUnit')
        : this.L('wellPick');

    const kindOffers = unitReward
      ? renderUnitCard(
          loc,
          {
            instanceId: 'event-reward',
            defId: unitReward.defId,
            slot: 1,
            stickerIds: unitReward.stickerIds,
            permanentMods: unitReward.permanentMods,
          },
          {
            selected: true,
            extraClass: `offer is-event-reward${replacing && this.recruitReplace?.defId === unitReward.defId ? ' is-replace-pick' : ''}`,
            ...stats,
          },
        )
      : `<div class="well-object" data-well-drop="1" aria-label="${this.L('wellTitle')}">
          <img class="well-shut" src="./art/ui/event-wishing-well-object.png?v=wellfresh1" alt="" draggable="false" />
          <img class="well-open" src="./art/ui/event-wishing-well-open-object.png?v=wellsplash8" alt="" draggable="false" />
          <img class="well-fed" src="./art/ui/event-wishing-well-fed-object.png?v=wellframe4" alt="" draggable="false" />
        </div>`;

    return `
      <section class="screen screen-recruit screen-well${replacing ? ' is-replacing' : ''}">
        <div class="hud recruit-hud">
          <span class="recruit-title">${this.L('wellTitle')}</span>
          <p class="hint sticker-shop-hint">${hint}</p>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <div class="recruit-shop-offers grid5">${kindOffers}</div>
        <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
          showEmpty: true,
          ...stats,
          cardOpts: (u) => ({
            extraClass: replacing ? 'is-replace-pick' : '',
            selected: run.eventPicks.includes(u.instanceId),
          }),
        })}</div>
        <div class="row recruit-actions">
          ${
            replacing
              ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
              : unitReward
                ? `<button class="btn ghost sticker-throw-away" data-act="throw-event-reward">${this.L('skipRecruit')}</button>`
                : `<button class="btn ghost" data-act="skip-event">${empty ? this.L('eventContinue') : this.L('skipRecruit')}</button>`
          }
        </div>
      </section>`;
  }

  private ovenHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const empty = eventIsBlocked(run);
    const applying = run.eventStep === 'oven-apply' && Boolean(run.pendingStickerIds[0]);
    const hint = applying ? this.L('ovenApply') : this.L('ovenPick');
    const offers = applying
      ? renderStickerCard(loc, run.pendingStickerIds[0]!, false, 'is-oven-sticker')
      : `<div class="oven-object" data-oven-drop="1" aria-label="${this.L('evt.witchOven')}">
          <img class="oven-shut" src="./art/ui/event-witch-oven-object.png?v=ovenfresh2" alt="" draggable="false" />
          <img class="oven-open" src="./art/ui/event-witch-oven-open-object.png?v=ovenfresh2" alt="" draggable="false" />
          <img class="oven-chew" src="./art/ui/event-witch-oven-chew-1.png?v=ovenchew4" alt="" draggable="false" />
          <img class="oven-chew2" src="./art/ui/event-witch-oven-chew-2.png?v=ovenchew4" alt="" draggable="false" />
          <img class="oven-fed" src="./art/ui/event-witch-oven-fed-object.png?v=ovensmile1" alt="" draggable="false" />
        </div>`;

    return `
      <section class="screen screen-recruit screen-well screen-oven">
        <div class="hud recruit-hud">
          <span class="recruit-title">${this.L('evt.witchOven')}</span>
          <p class="hint sticker-shop-hint">${hint}</p>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <div class="recruit-shop-offers grid5">${offers}</div>
        <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
          showEmpty: true,
          ...stats,
          cardOpts: (u) => ({
            selected: run.eventPicks.includes(u.instanceId),
          }),
        })}</div>
        <div class="row recruit-actions">
          ${
            applying
              ? `<button class="btn ghost" data-act="oven-discard">${this.L('ovenDiscard')}</button>`
              : `<button class="btn ghost" data-act="skip-event">${empty ? this.L('eventContinue') : this.L('skipRecruit')}</button>`
          }
        </div>
      </section>`;
  }

  private cloneHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const empty = eventIsBlocked(run);
    const unitReward = run.eventStep === 'reward-unit' ? eventUnitReward(run) : null;
    const replacing = Boolean(this.recruitReplace);
    const hint = replacing
      ? this.L('recruitReplaceHint')
      : unitReward
        ? this.L('eventRewardUnit')
        : this.L('clonePick');

    const offers = unitReward
      ? renderUnitCard(
          loc,
          {
            instanceId: 'event-reward',
            defId: unitReward.defId,
            slot: 1,
            stickerIds: unitReward.stickerIds,
            permanentMods: unitReward.permanentMods,
          },
          {
            selected: true,
            extraClass: `offer is-event-reward${replacing && this.recruitReplace?.defId === unitReward.defId ? ' is-replace-pick' : ''}`,
            ...stats,
          },
        )
      : `<div class="clone-object" data-clone-drop="1" aria-label="${this.L('evt.cloningChamber')}">
          <img class="clone-shut" src="./art/ui/event-cloning-chamber-object.png?v=chambermatch3" alt="" draggable="false" />
          <img class="clone-inside" src="./art/ui/event-cloning-chamber-inside-object.png?v=chambermatch1" alt="" draggable="false" />
          <img class="clone-exit" src="./art/ui/event-cloning-chamber-exit-object.png?v=chambermatch1" alt="" draggable="false" />
        </div>`;

    return `
      <section class="screen screen-recruit${unitReward ? '' : ' screen-well screen-clone'}${replacing ? ' is-replacing' : ''}">
        <div class="hud recruit-hud">
          <span class="recruit-title">${this.L('evt.cloningChamber')}</span>
          <p class="hint sticker-shop-hint">${hint}</p>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <div class="recruit-shop-offers grid5${unitReward ? ' event-reward-offer' : ''}">${offers}</div>
        <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
          showEmpty: true,
          ...stats,
          cardOpts: (u) => ({
            extraClass: replacing ? 'is-replace-pick' : '',
            selected: run.eventPicks.includes(u.instanceId),
          }),
        })}</div>
        <div class="row recruit-actions">
          ${
            replacing
              ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
              : unitReward
                ? `<button class="btn ghost sticker-throw-away" data-act="throw-event-reward">${this.L('skipRecruit')}</button>`
                : `<button class="btn ghost" data-act="skip-event">${empty ? this.L('eventContinue') : this.L('skipRecruit')}</button>`
          }
        </div>
      </section>`;
  }

  private bookHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const spread = bookSpread(run);
    const ev = EVENT_BY_ID.get('book-of-lost-tales');
    const sticker = spread.stickerId
      ? renderStickerCard(loc, spread.stickerId, false, 'book-offer')
      : '';
    const unit = spread.unitId
      ? renderUnitCard(
          loc,
          {
            instanceId: 'book-unit',
            defId: spread.unitId,
            slot: 1,
            stickerIds: [],
            permanentMods: { atk: 0, hp: 0, speed: 0 },
          },
          { extraClass: 'offer book-offer', ...stats },
        )
      : '';
    const replacing = Boolean(this.recruitReplace);
    const stickerReplace = this.replacePick?.from === 'book' ? this.replacePick : null;
    return `
      <section class="screen screen-recruit screen-book${replacing ? ' is-replacing' : ''}">
        <div class="hud recruit-hud">
          <span class="recruit-title">${ev ? this.L(ev.nameKey) : this.L('alleyEvent')}</span>
          <p class="hint sticker-shop-hint">${stickerReplace ? this.L('replaceHint') : replacing ? this.L('recruitReplaceHint') : this.L('bookPick')}</p>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <div class="book-open">
          <img src="./art/ui/event-book-open.png?v=open8" alt="" draggable="false" />
          <div class="book-page is-left" data-book-kind="sticker">${sticker}</div>
          <div class="book-page is-right" data-book-kind="unit">${unit}</div>
        </div>
        <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
          showEmpty: true,
          ...stats,
          cardOpts: (u) => ({
            extraClass: replacing || stickerReplace?.instanceId === u.instanceId ? 'is-replace-pick' : '',
          }),
        })}</div>
        <div class="row recruit-actions">
          ${
            stickerReplace
              ? `<button class="btn ghost" data-act="cancel-book-sticker">${this.L('cancel')}</button>`
              : replacing
              ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
              : `<button class="btn ghost" data-act="skip-event">${this.L('skipRecruit')}</button>`
          }
        </div>
      </section>`;
  }

  private eventHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const ev = run.eventId ? EVENT_BY_ID.get(run.eventId) : undefined;
    const cat = ev ? this.L(`event${ev.category[0]!.toUpperCase()}${ev.category.slice(1)}`) : '';
    const empty = eventIsBlocked(run);
    const huntId = run.huntMonsterId;
    const rewardRarity = lossRewardRarity(run.losses);
    const unitReward = run.eventStep === 'reward-unit' ? eventUnitReward(run) : null;
    const replacing = Boolean(this.recruitReplace);
    const hint =
      run.eventStep === 'reward-unit'
        ? (replacing ? this.L('recruitReplaceHint') : this.L('eventRewardUnit'))
      : run.eventStep === 'well-kind' ? this.L('wellKindHint')
      : run.eventStep === 'book-kind' ? this.L('bookPick')
      : run.eventStep === 'well-sticker' || (run.eventId === 'wishing-well' && run.eventStep === 'preview' && run.eventOffers[0] === 'kind:sticker')
        ? this.L('wellPick')
      : run.eventId === 'wishing-well' && run.eventStep === 'preview' && run.eventOffers[0] === 'kind:unit'
        ? this.L('wellSacrificeUnit')
      : run.eventId === 'witch-oven' && run.eventStep === 'preview' ? this.L('ovenPick')
      : run.eventStep === 'oven-apply' ? this.L('ovenApply')
      : run.eventId === 'cloning-chamber' && run.eventStep === 'preview' ? this.L('clonePick')
      : run.eventStep === 'roster-cut' ? this.L(run.eventId === 'cloning-chamber' ? 'cloneCut' : 'bookCut')
      : ev ? this.L(ev.descKey) : '';

    if (run.eventStep === 'reward-unit' && unitReward) {
      return `
        <section class="screen screen-recruit screen-event-inside${replacing ? ' is-replacing' : ''}">
          <div class="hud">
            <span>${ev ? this.L(ev.nameKey) : this.L('alleyEvent')}</span>
            <span class="event-cat ${ev?.category ?? ''}">${cat}</span>
            <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
          </div>
          <p class="hint sticker-shop-hint" style="color:var(--cream)">${hint}</p>
          <div class="recruit-shop-offers grid5 event-reward-offer">
            ${renderUnitCard(
              loc,
              {
                instanceId: 'event-reward',
                defId: unitReward.defId,
                slot: 1,
                stickerIds: unitReward.stickerIds,
                permanentMods: unitReward.permanentMods,
              },
              {
                selected: true,
                extraClass: `offer is-event-reward${replacing && this.recruitReplace?.defId === unitReward.defId ? ' is-replace-pick' : ''}`,
                ...stats,
              },
            )}
          </div>
          <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
            showEmpty: true,
            ...stats,
            cardOpts: () => ({ extraClass: replacing ? 'is-replace-pick' : '' }),
          })}</div>
          <div class="row recruit-actions">
            ${
              replacing
                ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
                : `<button class="btn ghost sticker-throw-away" data-act="throw-event-reward">${this.L('skipRecruit')}</button>`
            }
          </div>
        </section>`;
    }

    const showBoss = Boolean(huntId) && run.eventId === 'monster-hunt' && run.eventStep === 'preview';
    const showKind = run.eventStep === 'well-kind' || run.eventStep === 'book-kind';
    const showOvenSticker = run.eventStep === 'oven-apply' && run.pendingStickerIds[0];
    const showTeam =
      !showBoss &&
      !showKind &&
      (run.eventStep === 'preview' ||
        run.eventStep === 'well-sticker' ||
        run.eventStep === 'roster-cut' ||
        run.eventStep === 'oven-apply');
    const canSkip =
      run.eventStep !== 'oven-apply' &&
      run.eventStep !== 'reward-unit' &&
      run.eventStep !== 'roster-cut';

    return `
      <section class="screen screen-sticker screen-event-inside">
        <div class="hud">
          <span>${ev ? this.L(ev.nameKey) : this.L('alleyEvent')}</span>
          <span class="event-cat ${ev?.category ?? ''}">${cat}${
            run.eventId === 'book-of-lost-tales' ? ` · ${this.L(rewardRarity)}` : ''
          }</span>
          <span class="recruit-round">${this.recruitRoundHtml(run.round, victoryPointsOf(run))}</span>
        </div>
        <p class="hint" style="color:var(--cream)">${hint}</p>
        ${
          showKind
            ? `<div class="event-kind-row">
                <button class="btn" data-act="event-kind-unit">${this.L(run.eventStep === 'book-kind' ? 'bookKindUnit' : 'wellKindUnit')}</button>
                <button class="btn" data-act="event-kind-sticker">${this.L(run.eventStep === 'book-kind' ? 'bookKindSticker' : 'wellKindSticker')}</button>
              </div>`
            : ''
        }
        ${showBoss ? `<div class="grid5 event-boss">${renderUnitCard(loc, { instanceId: huntId!, defId: huntId!, slot: 1, stickerIds: [huntStickerFor(huntId!)].filter((id): id is string => Boolean(id)), permanentMods: { atk: 0, hp: 0, speed: 0 } }, { extraClass: 'offer is-hunt-plate', ...stats })}</div>` : ''}
        ${
          showOvenSticker
            ? `<div class="row event-oven-tray">${renderStickerCard(loc, run.pendingStickerIds[0]!, false)}</div>`
            : ''
        }
        ${
          showTeam
            ? `<div class="grid5 team-table">${renderTeamLane(loc, run.team, {
                ...stats,
                cardOpts: (u) => ({
                  selected: run.eventPicks.includes(u.instanceId) || this.cuts.includes(u.instanceId),
                }),
              })}</div>`
            : ''
        }
        <div class="row recruit-actions event-actions">
          ${run.eventId === 'monster-hunt' && run.eventStep === 'preview' && !empty ? `<button class="btn" data-act="start-hunt">${this.L('huntEnter')}</button>` : ''}
          ${run.eventStep === 'oven-apply' ? `<button class="btn ghost" data-act="oven-discard">${this.L('ovenDiscard')}</button>` : ''}
          ${canSkip ? `<button class="btn ghost" data-act="skip-event">${empty ? this.L('eventContinue') : this.L('skipRecruit')}</button>` : ''}
        </div>
      </section>`;
  }

  private isHuntBattle(): boolean {
    return this.run?.lastBattle?.snapshots.b.playerId === 'monster-hunt';
  }

  private musicCue(): MusicCue {
    if (this.screen === 'battle' && this.battleFieldUp && this.isHuntBattle()) return 'hunt';
    if (this.screen === 'battle' && this.battleFieldUp) return 'fight';
    if (this.screen === 'run' && this.run?.phase === 'final') return 'final';
    if (this.screen === 'menu' || this.screen === 'codex') return 'menu';
    if (this.screen === 'run') return 'square';
    return 'menu';
  }

  private huntBossName(): string | null {
    const run = this.run;
    if (!run?.huntMonsterId) return null;
    if (!this.isHuntBattle() && run.eventId !== 'monster-hunt') return null;
    try {
      return this.L(getUnit(run.huntMonsterId).nameKey);
    } catch {
      return null;
    }
  }

  private battleFoeName(): string {
    const hunt = this.huntBossName();
    if (hunt) return hunt;
    const run = this.run!;
    const hist = run.history[run.history.length - 1];
    const fromHist = hist?.opponentName?.trim() ?? '';
    if (fromHist) return fromHist;
    const snap = run.lastBattle?.snapshots.b;
    const fromSnap = snap?.playerName?.trim() ?? '';
    if (fromSnap && snap?.playerId !== 'monster-hunt' && !fromSnap.includes('-')) return fromSnap;
    return this.L('house');
  }

  /** Score beside the crown while the scrap is playing: before this fight's points. */
  private crownPointsDuringBattle(): number {
    const run = this.run!;
    const total = victoryPointsOf(run);
    if (run.eventId === 'monster-hunt') return total + huntKnockedOutIds(run, 'player').length;
    const winner = run.lastBattle?.winner;
    if (winner === 'player') return Math.max(0, total - 3);
    if (winner === 'draw') return Math.max(0, total - 1);
    return total;
  }

  private battleHtml(): string {
    const run = this.run!;
    const foeName = this.battleFoeName();
    const hunt = run.eventId === 'monster-hunt' ? ' is-hunt' : '';
    return `
      <section class="screen screen-battle is-preamble${hunt}">
        <div class="battle-wrap is-intro is-preamble${hunt}" id="battlefield">
          <div class="battle-hud" aria-hidden="true">
            <span class="recruit-round">${this.recruitRoundHtml(run.round, this.crownPointsDuringBattle())}</span>
          </div>
          <div class="battle-line">
            <div class="battle-fit">
              <div class="battle-board">
                <div class="battle-side is-player" aria-label="${this.L('you')}"></div>
                <div class="battle-side is-enemy" aria-label="${foeName}"></div>
              </div>
            </div>
          </div>
          <div class="battle-fx" aria-hidden="true"></div>
          <div class="battle-intro" data-curtain="black" aria-hidden="true">
            <div class="curtain-veil"></div>
            <div class="curtain-house" aria-hidden="true">
              <canvas class="curtain-cloth" aria-hidden="true"></canvas>
            </div>
          </div>
          <div class="battle-ui">
            <div>
              <button class="btn ghost" data-act="spd-1">${this.L('speed1')}</button>
              <button class="btn ghost" data-act="spd-2">${this.L('speed2')}</button>
              <button class="btn ghost" data-act="pause-battle">${this.L('pause')}</button>
            </div>
            <div>
              <button class="btn" data-act="skip-battle">${this.L('skip')}</button>
            </div>
          </div>
        </div>
        ${this.settings.showCombatLog ? `<div class="log-box" id="clog"></div>` : ''}
      </section>`;
  }

  private codexHtml(): string {
    const loc = this.settings.locale;
    const byBook = (a: (typeof UNITS)[number], b: (typeof UNITS)[number]) => {
      const rarity = rarityRank(a.rarity) - rarityRank(b.rarity);
      if (rarity !== 0) return rarity;
      return this.L(a.nameKey).localeCompare(this.L(b.nameKey), loc);
    };
    const units = [
      ...UNITS.filter((u) => u.recruitable).slice().sort(byBook),
      ...UNITS.filter((u) => u.tags.includes('hunt')).slice().sort(byBook),
    ];
    const orderedStickers = (list: ReturnType<typeof grantableStickers>) =>
      list.slice().sort((a, b) => {
        const rarity = rarityRank(a.rarity) - rarityRank(b.rarity);
        if (rarity !== 0) return rarity;
        return this.L(a.nameKey).localeCompare(this.L(b.nameKey), loc, { sensitivity: 'base' });
      });
    const stickerIds = [...orderedStickers(grantableStickers()), ...orderedStickers(libraryHuntStickers())].map((s) => s.id);
    return `
      <section class="screen screen-codex">
        <div class="codex-wash" aria-hidden="true"></div>
        <header class="codex-hud">
          <div class="codex-hud-copy">
            <h2 class="recruit-title">${this.L('codex')}</h2>
            <p class="codex-hint">${this.L('codexTaleHint')}</p>
          </div>
        </header>
        <div class="codex-hud-actions">
          <button type="button" class="btn ghost" data-act="fullscreen">${this.L('fullscreen')}</button>
          <button type="button" class="btn ghost" data-act="menu">${this.L('quitToMenu')}</button>
        </div>
        <h2 class="sign codex-heading">${this.L('figures')}</h2>
        <div class="codex-grid">
          ${units
            .map((u) => {
              const glued = huntStickerFor(u.id);
              const stickerIds = [...(u.startingStickers ?? [])];
              if (glued && !stickerIds.includes(glued)) stickerIds.push(glued);
              const inst: UnitInstance = {
                instanceId: u.id,
                defId: u.id,
                slot: 1,
                stickerIds,
                permanentMods: { atk: 0, hp: 0, speed: 0 },
              };
              return `<div class="codex-item">${renderUnitCard(loc, inst)}</div>`;
            })
            .join('')}
        </div>
        <h2 class="sign codex-heading">${this.L('stickers')}</h2>
        <div class="codex-grid">
          ${stickerIds.map((id) => `<div class="codex-item">${renderStickerCard(loc, id, false)}</div>`).join('')}
        </div>
      </section>`;
  }

  private bindRunGestures(): void {
    const run = this.run;
    if (!run) return;
    if (run.phase === 'draft' || run.phase === 'recruit') {
      this.bindRecruitShopGestures();
    }
    if (run.phase === 'event' && run.eventStep === 'reward-unit') {
      this.bindEventRewardGestures();
    }
    if (run.phase === 'sticker' || this.isGiftStickerAssign()) {
      this.bindStickerShopGestures();
    }
    if (run.phase === 'stickerAssign' && run.eventId) {
      this.setupStickerDrag('.sticker-card.assign-sticker');
      this.root.querySelectorAll<HTMLElement>('.sticker-shop-team .unit-card[data-instance]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (!this.run || !this.replacePick || this.replacePick.from !== 'assign') return;
          if (this.replacePick.instanceId !== el.dataset.instance) return;
          const slotEl = (e.target as HTMLElement).closest<HTMLElement>('.sticker-slot.filled');
          if (!slotEl) return;
          const idx = Number(slotEl.dataset.stickerSlot);
          if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_STICKERS) return;
          e.preventDefault();
          e.stopPropagation();
          this.commitStickerApply(el.dataset.instance!, idx);
        });
      });
    }
    if (run.phase === 'event') {
      if (run.eventId === 'witch-oven' && run.eventStep === 'preview') {
        this.bindOvenGestures();
      } else if (run.eventId === 'cloning-chamber' && run.eventStep === 'preview') {
        this.bindCloneGestures();
      } else if (
        run.eventId === 'wishing-well' &&
        (run.eventStep === 'preview' || run.eventStep === 'well-kind' || run.eventStep === 'well-sticker')
      ) {
        this.bindWellGestures();
      } else if (run.eventId === 'book-of-lost-tales' && run.eventStep === 'book-kind') {
        this.bindBookGestures();
      } else this.root.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (!this.run) return;
          const slot = (e.target as HTMLElement).closest<HTMLElement>('.sticker-slot.filled');
          const stickerId = slot?.dataset.sticker;
          const inst = el.dataset.instance!;
          if (
            stickerId &&
            this.run.eventId === 'wishing-well' &&
            this.run.eventOffers[0] === 'kind:sticker' &&
            (this.run.eventStep === 'well-sticker' || this.run.eventStep === 'preview')
          ) {
            const next = eventSelectSticker(this.run, inst, stickerId);
            if (next !== this.run) {
              this.run = next;
              audio.play('peel', 'ui');
              this.persistAndRender();
              return;
            }
          }
          this.run = eventSelectUnit(this.run, inst);
          audio.play('paper', 'ui');
          this.persistAndRender();
        });
      });
    }
    if (run.phase === 'formation' || this.isHuntLineup()) this.setupFormationDrag();
  }

  private clearGhost(): void {
    this.ghost?.remove();
    this.ghost = null;
  }

  private cardUnder(e: PointerEvent): HTMLElement | null {
    if (this.ghost) this.ghost.style.visibility = 'hidden';
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (this.ghost) this.ghost.style.visibility = '';
    return hit?.closest<HTMLElement>('.unit-card') ?? null;
  }

  private listenDrag(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  private unlistenDrag(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }

  private setupStickerDrag(selector: string): void {
    this.root.querySelectorAll<HTMLElement>(selector).forEach((sticker) => {
      const sid = sticker.dataset.sticker;
      if (!sid) return;
      sticker.style.cursor = 'grab';
      sticker.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });

      const onMove = (e: PointerEvent) => {
        if (!this.dragSticker) return;
        e.preventDefault();
        this.moveGhost(e);
        this.root.querySelectorAll('.unit-card').forEach((c) => c.classList.remove('drop-glow'));
        const over = this.cardUnder(e);
        if (over && this.root.contains(over) && over.dataset.instance) over.classList.add('drop-glow');
      };

      const onUp = (e: PointerEvent) => {
        this.unlistenDrag(onMove, onUp);
        const over = this.cardUnder(e);
        this.clearGhost();
        this.root.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
        const dropped = Boolean(over && this.run && this.dragSticker && this.root.contains(over));
        const draggedId = this.dragSticker;
        this.dragSticker = null;
        if (!dropped || !over || !this.run || !draggedId) {
          sticker.classList.remove('is-peeled');
          return;
        }
        const inst = this.run.team.find((u) => u.instanceId === over.dataset.instance);
        if (!inst) {
          sticker.classList.remove('is-peeled');
          return;
        }
        if (inst.stickerIds.length >= MAX_STICKERS) {
          sticker.classList.remove('is-peeled');
          const from = this.run.phase === 'sticker' ? 'shop' : 'assign';
          this.replacePick = { instanceId: inst.instanceId, from, stickerId: draggedId };
          audio.play('paper', 'ui');
          this.renderPreservingScroll();
          return;
        }
        this.commitStickerApply(inst.instanceId, undefined, draggedId);
      };

      sticker.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || this.shopBusy) return;
        if (this.shopPicksDone()) return;
        if (sticker.classList.contains('is-spent-offer')) return;
        e.preventDefault();
        this.replacePick = null;
        this.dragSticker = sid;

        const art = sticker.querySelector<HTMLElement>('.sticker-art');
        const peelFrom = art ?? sticker;
        const rect = peelFrom.getBoundingClientRect();
        this.ghostGrabX = Math.min(Math.max(8, e.clientX - rect.left), Math.max(16, rect.width - 8));
        this.ghostGrabY = Math.min(Math.max(8, e.clientY - rect.top), Math.max(16, rect.height - 8));

        sticker.classList.add('is-peeled');

        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-sticker';
        const img = document.createElement('img');
        img.src = `./art/stickers/${stickerArtFile(sid)}.png?v=cast155`;
        img.alt = '';
        img.draggable = false;
        img.style.width = `${Math.max(48, rect.width)}px`;
        img.style.height = `${Math.max(48, rect.height)}px`;
        this.ghost.appendChild(img);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private commitStickerApply(instanceId: string, replaceIndex?: number, shopStickerId?: string): void {
    if (!this.run || this.shopBusy) return;
    if (this.run.phase === 'sticker' && this.spentOfferIds.length >= STICKER_PICK) return;
    if (this.isGiftStickerAssign() && this.run.pendingStickerIds.length === 0) return;
    const before = this.run.team.find((u) => u.instanceId === instanceId);
    const beforeDef = before?.defId;
    let stickerId: string | null = null;
    let next: RunState;
    const fromShop = this.run.phase === 'sticker';
    const fromAssign = this.run.phase === 'stickerAssign';

    if (fromShop) {
      stickerId = shopStickerId ?? this.replacePick?.stickerId ?? null;
      if (!stickerId) return;
      next = applyShopSticker(this.run, stickerId, instanceId, replaceIndex);
      this.codex = discover(this.codex, [], [stickerId]);
    } else if (fromAssign) {
      stickerId = shopStickerId ?? this.run.pendingStickerIds[0] ?? null;
      if (!stickerId) return;
      next = assignPendingSticker(this.run, instanceId, replaceIndex, stickerId, { settle: false });
    } else {
      return;
    }

    if (next === this.run) {
      this.shopBusy = false;
      return;
    }

    this.replacePick = null;
    this.shopBusy = true;
    window.clearTimeout(this.shopHoldTimer);
    audio.play('peel', 'ui');

    const after = next.team.find((u) => u.instanceId === instanceId);
    const transformed = Boolean(beforeDef && after && beforeDef !== after.defId);
    const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${instanceId}"]`);

    const revealApplied = () => {
      if (stickerId && (fromShop || this.isGiftStickerAssign())) this.markSpentOffer(stickerId);
      this.run = next;
      this.noteTeam();
      void this.persist();
      this.renderPreservingScroll();
      if (!transformed) {
        this.applyFx = { instanceId, stickerId: stickerId! };
        this.playApplyFx();
      }
    };

    const advance = () => {
      if (!this.run) {
        this.shopBusy = false;
        return;
      }
      if (fromShop || this.isGiftStickerAssign()) {
        if (this.shopPicksDone()) {
          void this.closeFinishedShop();
          return;
        }
        this.shopBusy = false;
        this.syncShopPassReady();
        return;
      }
      if (fromAssign && this.run.pendingStickerIds.length === 0) {
        this.run = settleStickerAssign(this.run);
        this.clearSpentOffers();
        void this.persist();
        this.renderPreservingScroll();
      }
      this.shopBusy = false;
    };

    if (transformed && card) {
      this.playShopBanf(card, revealApplied, () => {
        this.shopHoldTimer = window.setTimeout(advance, 400);
      });
      return;
    }

    revealApplied();
    this.shopHoldTimer = window.setTimeout(advance, 1000);
  }

  private playShopBanf(card: HTMLElement, onReveal: () => void, onDone: () => void): void {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hold = [340, 170, 150, 160] as const;
    const fadeMs = 280;
    const revealMs = hold[0]!;
    const totalMs = hold.reduce((a, b) => a + b, 0) + fadeMs;

    const frames = [1, 2, 3, 4].map((n) => `./art/vfx/smoke-${n}.png?v=banf2`);
    const smoke = document.createElement('img');
    smoke.className = 'battle-burst is-smoke shop-banf-smoke';
    smoke.src = frames[0]!;
    smoke.alt = '';
    const cover = Math.max(rect.width, rect.height) * 1.8275;
    smoke.style.width = `${cover}px`;
    smoke.style.height = `${cover}px`;
    smoke.style.marginLeft = `${-cover / 2}px`;
    smoke.style.marginTop = `${-cover / 2}px`;
    smoke.style.left = `${cx}px`;
    smoke.style.top = `${cy}px`;
    document.body.appendChild(smoke);
    audio.play('paper', 'ui');

    let i = 0;
    const advanceFrame = () => {
      const wait = hold[i] ?? 160;
      window.setTimeout(() => {
        i += 1;
        if (i >= frames.length) {
          window.setTimeout(() => smoke.remove(), fadeMs);
          return;
        }
        smoke.src = frames[i]!;
        advanceFrame();
      }, wait);
    };
    advanceFrame();

    window.setTimeout(() => {
      onReveal();
    }, revealMs);

    window.setTimeout(() => {
      onDone();
    }, totalMs);
  }

  private renderPreservingScroll(): void {
    const y = this.root.scrollTop;
    this.render();
    this.root.scrollTop = y;
  }

  private playApplyFx(): void {
    const fx = this.applyFx;
    if (!fx) return;
    requestAnimationFrame(() => {
      const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${fx.instanceId}"]`);
      if (!card) {
        this.applyFx = null;
        return;
      }
      card.classList.add('is-stick-shake');
      const slots = [...card.querySelectorAll<HTMLElement>('.sticker-slot.filled')];
      const matches = slots.filter((s) => s.dataset.sticker === fx.stickerId);
      const slot = matches[matches.length - 1] ?? slots[slots.length - 1];
      slot?.classList.add('sticker-pop', 'is-new-stick');
      window.setTimeout(() => {
        card.classList.remove('is-stick-shake');
        slot?.classList.remove('sticker-pop', 'is-new-stick');
        this.applyFx = null;
      }, 450);
    });
  }

  private setupFormationDrag(): void {
    const lineup = this.root.querySelector('#lineup');
    if (!lineup) return;
    lineup.querySelectorAll<HTMLElement>('.unit-card').forEach((el) => {
      if (el.classList.contains('is-empty')) return;
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.dragSlot = Number(el.dataset.slot);
        el.classList.add('is-dragging', 'lift');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);

        const slotUnder = (ev: PointerEvent): HTMLElement | null => {
          if (this.ghost) this.ghost.style.visibility = 'hidden';
          const hit = document.elementFromPoint(ev.clientX, ev.clientY);
          if (this.ghost) this.ghost.style.visibility = '';
          const slot = hit?.closest<HTMLElement>('.team-slot');
          if (!slot || !lineup.contains(slot)) return this.cardUnder(ev);
          return (
            slot.querySelector<HTMLElement>('.unit-card[data-instance]') ??
            slot.querySelector<HTMLElement>('.unit-card')
          );
        };
        const onMove = (ev: PointerEvent) => {
          if (this.dragSlot == null) return;
          this.moveGhost(ev);
          lineup.querySelectorAll('.unit-card').forEach((c) => c.classList.remove('drop-glow'));
          const over = slotUnder(ev);
          const to = over ? Number(over.dataset.slot) : 0;
          if (
            over &&
            lineup.contains(over) &&
            over !== el &&
            this.run &&
            this.dragSlot != null &&
            canMoveUnitSlot(this.run.team, this.dragSlot, to)
          ) {
            over.classList.add('drop-glow');
          }
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = slotUnder(ev);
          this.clearGhost();
          el.classList.remove('is-dragging', 'lift');
          lineup.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (over && lineup.contains(over) && this.run && this.dragSlot != null) {
            const b = Number(over.dataset.slot);
            if (canMoveUnitSlot(this.run.team, this.dragSlot, b)) {
              this.run = swapSlots(this.run, this.dragSlot, b);
              audio.play('wood', 'ui');
              this.persistAndRender();
            }
          }
          this.dragSlot = null;
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private recruitTeamRoot(): HTMLElement | null {
    return this.root.querySelector('.recruit-shop-team, .sticker-shop-team');
  }

  private bindBookGestures(): void {
    const run = this.run;
    if (!run || run.eventId !== 'book-of-lost-tales' || run.eventStep !== 'book-kind') return;
    const teamRoot = this.recruitTeamRoot();
    if (!teamRoot) return;
    if (this.replacePick?.from === 'book') {
      teamRoot.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (!this.run || this.replacePick?.from !== 'book' || this.replacePick.instanceId !== el.dataset.instance) return;
          const slotEl = (e.target as HTMLElement).closest<HTMLElement>('.sticker-slot.filled');
          if (!slotEl) return;
          const idx = Number(slotEl.dataset.stickerSlot);
          if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_STICKERS) return;
          e.preventDefault();
          e.stopPropagation();
          const next = claimBookSticker(this.run, el.dataset.instance!, idx);
          if (next === this.run) return;
          this.replacePick = null;
          this.run = next;
          audio.play('peel', 'ui');
          this.holdBookClose();
        });
      });
    }
    if (this.recruitReplace) {
      teamRoot.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
        el.addEventListener('click', () => {
          if (!this.run || !this.recruitReplace || this.run.eventId !== 'book-of-lost-tales') return;
          const slot = Number(el.dataset.slot);
          if (!slot) return;
          this.recruitReplace = null;
          this.run = replaceBookUnit(this.run, slot);
          audio.play('paper', 'ui');
          this.holdBookClose();
        });
      });
      return;
    }
    this.root.querySelectorAll<HTMLElement>('.book-page').forEach((page) => {
      const kind = page.dataset.bookKind === 'sticker' ? 'sticker' : 'unit';
      const card = page.querySelector<HTMLElement>('.unit-card, .sticker-card');
      if (!card) return;
      card.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      card.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        if ((e.target as HTMLElement).closest('.rule-tip')) return;
        e.preventDefault();
        e.stopPropagation();
        this.ghost = document.createElement('div');
        if (kind === 'sticker') {
          const sid = card.dataset.sticker;
          if (!sid) return;
          const art = card.querySelector<HTMLElement>('.sticker-art');
          const peelFrom = art ?? card;
          const rect = peelFrom.getBoundingClientRect();
          this.ghostGrabX = Math.min(Math.max(8, e.clientX - rect.left), Math.max(16, rect.width - 8));
          this.ghostGrabY = Math.min(Math.max(8, e.clientY - rect.top), Math.max(16, rect.height - 8));
          card.classList.add('is-peeled');
          this.ghost.className = 'ghost-sticker';
          const img = document.createElement('img');
          img.src = `./art/stickers/${stickerArtFile(sid)}.png?v=cast155`;
          img.alt = '';
          img.draggable = false;
          img.style.width = `${Math.max(48, rect.width)}px`;
          img.style.height = `${Math.max(48, rect.height)}px`;
          this.ghost.appendChild(img);
        } else {
          card.classList.add('is-dragging');
          this.ghost.className = 'ghost-card';
          const clone = card.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('img').forEach((img) => {
            img.draggable = false;
          });
          this.ghost.appendChild(clone);
        }
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        const bookStickerTarget = (ev: PointerEvent): HTMLElement | null => {
          const over = this.cardUnder(ev);
          if (!over || !teamRoot.contains(over) || over.closest('.book-open')) return null;
          if (!over.dataset.instance || over.classList.contains('is-empty')) return null;
          return over;
        };
        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (kind === 'unit') this.slotUnder(ev, teamRoot)?.classList.add('drop-glow');
          else bookStickerTarget(ev)?.classList.add('drop-glow');
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const slotEl = kind === 'unit' ? this.slotUnder(ev, teamRoot) : null;
          const unitEl = kind === 'sticker' ? bookStickerTarget(ev) : null;
          this.clearGhost();
          card.classList.remove('is-dragging');
          if (!unitEl) card.classList.remove('is-peeled');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!this.run || this.run.eventId !== 'book-of-lost-tales' || this.shopBusy) return;
          if (kind === 'unit' && slotEl && !slotEl.closest('.book-open')) {
            const slot = Number(slotEl.dataset.slot);
            if (slot < 1 || slot > MAX_TEAM) return;
            if (this.run.team.length >= MAX_TEAM) {
              const defId = bookSpread(ensureBookOffers(this.run)).unitId;
              if (!defId) return;
              this.recruitReplace = { defId };
              audio.play('paper', 'ui');
              this.render();
              return;
            }
            const next = claimBookUnit(this.run, slot);
            if (next === this.run) return;
            this.run = next;
            audio.play('wood', 'ui');
            this.holdBookClose();
            return;
          }
          if (unitEl) {
            const instanceId = unitEl.dataset.instance;
            if (!instanceId) {
              card.classList.remove('is-peeled');
              return;
            }
            const host = this.run.team.find((u) => u.instanceId === instanceId);
            if (host && host.stickerIds.length >= MAX_STICKERS) {
              this.replacePick = { instanceId, from: 'book', stickerId: card.dataset.sticker };
              audio.play('paper', 'ui');
              this.render();
              return;
            }
            const next = claimBookSticker(this.run, instanceId);
            if (next === this.run) {
              card.classList.remove('is-peeled');
              return;
            }
            this.run = next;
            audio.play('peel', 'ui');
            this.holdBookClose();
          }
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private bindWellGestures(): void {
    const run = this.run;
    if (!run || run.eventId !== 'wishing-well') return;
    if (run.eventStep !== 'preview' && run.eventStep !== 'well-kind' && run.eventStep !== 'well-sticker') return;
    const well = this.root.querySelector<HTMLElement>('[data-well-drop]');
    const teamRoot = this.recruitTeamRoot();
    if (!well || !teamRoot) return;

    const track = (ev: PointerEvent) => {
      well.classList.toggle('drop-glow', this.hitsEl(ev, well));
    };

    teamRoot.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        if ((e.target as HTMLElement).closest('.sticker-slot.filled')) return;
        e.preventDefault();
        const inst = el.dataset.instance;
        if (!inst) return;
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          track(ev);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const hit = this.hitsEl(ev, well);
          this.clearGhost();
          el.classList.remove('is-dragging');
          well.classList.remove('drop-glow');
          if (!hit || !this.run || this.run.eventId !== 'wishing-well') {
            well.classList.remove('is-hungry');
            return;
          }
          this.feedWell(well, { type: 'unit', card: el, instanceId: inst });
        };
        this.listenDrag(onMove, onUp);
      });
    });

    teamRoot.querySelectorAll<HTMLElement>('.sticker-slot.filled[data-sticker]').forEach((slot) => {
      slot.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        const card = slot.closest<HTMLElement>('.unit-card[data-instance]');
        const inst = card?.dataset.instance;
        const stickerId = slot.dataset.sticker;
        if (!inst || !stickerId) return;
        e.preventDefault();
        e.stopPropagation();
        audio.play('peel', 'ui');
        const rect = slot.getBoundingClientRect();
        this.ghostGrabX = Math.min(Math.max(8, e.clientX - rect.left), Math.max(16, rect.width - 8));
        this.ghostGrabY = Math.min(Math.max(8, e.clientY - rect.top), Math.max(16, rect.height - 8));
        slot.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-sticker';
        const img = document.createElement('img');
        img.src = `./art/stickers/${stickerArtFile(stickerId)}.png?v=cast155`;
        img.alt = '';
        img.draggable = false;
        img.style.width = `${Math.max(48, rect.width)}px`;
        img.style.height = `${Math.max(48, rect.height)}px`;
        this.ghost.appendChild(img);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          track(ev);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const hit = this.hitsEl(ev, well);
          this.clearGhost();
          slot.classList.remove('is-dragging');
          well.classList.remove('drop-glow');
          if (!hit || !this.run || this.run.eventId !== 'wishing-well') {
            well.classList.remove('is-hungry');
            return;
          }
          this.feedWell(well, { type: 'sticker', slot, instanceId: inst, stickerId });
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private feedWell(
    well: HTMLElement,
    drop:
      | { type: 'unit'; card: HTMLElement; instanceId: string }
      | { type: 'sticker'; slot: HTMLElement; instanceId: string; stickerId: string },
  ): void {
    if (!this.run || this.shopBusy) return;
    this.shopBusy = true;
    if (drop.type === 'unit') {
      drop.card.classList.add('is-eaten');
      drop.card.querySelectorAll('.sticker-rail, .sticker-slot').forEach((el) => el.remove());
    } else {
      drop.slot.style.visibility = 'hidden';
    }
    well.classList.add('is-hungry');
    well.classList.remove('is-fed');
    audio.play('paper', 'ui');
    this.clearShopHold();
    this.shopHoldTimer = window.setTimeout(() => {
      if (!this.run || this.run.eventId !== 'wishing-well') {
        this.shopBusy = false;
        return;
      }
      well.classList.remove('is-hungry');
      well.classList.add('is-fed');
      this.shopHoldTimer = window.setTimeout(() => {
        this.shopBusy = false;
        if (!this.run || this.run.eventId !== 'wishing-well') return;
        this.ovenShopEnter = true;
        this.run =
          drop.type === 'unit'
            ? eventSelectUnit(this.run, drop.instanceId)
            : eventSelectSticker(this.run, drop.instanceId, drop.stickerId);
        this.persistAndRender();
      }, 1000);
    }, 1000);
  }

  private bindOvenGestures(): void {
    const run = this.run;
    if (!run || run.eventId !== 'witch-oven' || run.eventStep !== 'preview') return;
    const oven = this.root.querySelector<HTMLElement>('[data-oven-drop]');
    const teamRoot = this.recruitTeamRoot();
    if (!oven || !teamRoot) return;
    teamRoot.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        e.preventDefault();
        const inst = el.dataset.instance;
        if (!inst) return;
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);

        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          const over = this.hitsEl(ev, oven);
          oven.classList.toggle('drop-glow', over);
          if (!this.shopBusy) oven.classList.toggle('is-hungry', over);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const hit = this.hitsEl(ev, oven);
          this.clearGhost();
          el.classList.remove('is-dragging');
          oven.classList.remove('drop-glow');
          if (!hit || !this.run || this.run.eventId !== 'witch-oven' || this.run.eventStep !== 'preview') {
            oven.classList.remove('is-hungry');
            return;
          }
          this.feedOven(el, oven, inst);
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private bindCloneGestures(): void {
    const run = this.run;
    if (!run || run.eventId !== 'cloning-chamber' || run.eventStep !== 'preview') return;
    const chamber = this.root.querySelector<HTMLElement>('[data-clone-drop]');
    const teamRoot = this.recruitTeamRoot();
    if (!chamber || !teamRoot) return;

    const track = (ev: PointerEvent) => {
      chamber.classList.toggle('drop-glow', this.hitsEl(ev, chamber));
    };

    teamRoot.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        if ((e.target as HTMLElement).closest('.sticker-slot.filled')) return;
        e.preventDefault();
        const inst = el.dataset.instance;
        if (!inst) return;
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          track(ev);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const hit = this.hitsEl(ev, chamber);
          this.clearGhost();
          el.classList.remove('is-dragging');
          chamber.classList.remove('drop-glow');
          if (!hit || !this.run || this.run.eventId !== 'cloning-chamber' || this.run.eventStep !== 'preview') {
            return;
          }
          this.feedClone(el, chamber, inst);
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private feedClone(card: HTMLElement, chamber: HTMLElement, instanceId: string): void {
    if (!this.run || this.shopBusy) return;
    this.shopBusy = true;
    chamber.classList.remove('is-hungry', 'is-exit');
    chamber.classList.add('is-fed');
    audio.play('paper', 'ui');
    this.clearShopHold();
    this.shopHoldTimer = window.setTimeout(() => {
      if (!this.run || this.run.eventId !== 'cloning-chamber' || this.run.eventStep !== 'preview') {
        this.shopBusy = false;
        return;
      }
      chamber.classList.add('is-exit');
      this.shopHoldTimer = window.setTimeout(() => {
        this.shopBusy = false;
        if (!this.run || this.run.eventId !== 'cloning-chamber' || this.run.eventStep !== 'preview') return;
        this.ovenShopEnter = true;
        this.run = eventSelectUnit(this.run, instanceId);
        this.persistAndRender();
      }, 1000);
    }, 1000);
  }

  private feedOven(card: HTMLElement, oven: HTMLElement, instanceId: string): void {
    if (!this.run || this.shopBusy) return;
    this.shopBusy = true;
    card.classList.add('is-eaten');
    card.querySelectorAll('.sticker-rail, .sticker-slot').forEach((el) => el.remove());
    oven.classList.remove('is-hungry', 'is-fed', 'is-chew-b');
    oven.classList.add('is-chew');
    audio.play('paper', 'ui');
    this.clearShopHold();
    const chew = (ms: number, step: () => void) => {
      this.shopHoldTimer = window.setTimeout(step, ms);
    };
    const chewAlive = () =>
      Boolean(this.run && this.run.eventId === 'witch-oven' && this.run.eventStep === 'preview');
    let bites = 0;
    const bite = () => {
      if (!chewAlive()) {
        this.shopBusy = false;
        return;
      }
      if (!oven.classList.contains('is-chew-b')) {
        oven.classList.add('is-chew-b');
        chew(bites === 2 ? 1000 : 320, bite);
        return;
      }
      bites += 1;
      if (bites < 3) {
        oven.classList.remove('is-chew-b');
        chew(320, bite);
        return;
      }
      oven.classList.remove('is-chew', 'is-chew-b');
      oven.classList.add('is-fed');
      chew(700, () => {
        this.shopBusy = false;
        const run = this.run;
        if (!run || run.eventId !== 'witch-oven' || run.eventStep !== 'preview') return;
        this.ovenShopEnter = true;
        this.run = eventSelectUnit(run, instanceId);
        this.persistAndRender();
      });
    };
    chew(320, bite);
  }

  private nearEl(e: PointerEvent, el: HTMLElement, pad: number): boolean {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  }

  private hitsEl(e: PointerEvent, el: HTMLElement): boolean {
    if (this.ghost) this.ghost.style.visibility = 'hidden';
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (this.ghost) this.ghost.style.visibility = '';
    return Boolean(hit && (hit === el || el.contains(hit)));
  }

  private slotUnder(e: PointerEvent, root: HTMLElement): HTMLElement | null {
    if (this.ghost) this.ghost.style.visibility = 'hidden';
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (this.ghost) this.ghost.style.visibility = '';
    const slot = hit?.closest<HTMLElement>('[data-slot]');
    if (!slot || !root.contains(slot)) return null;
    return slot;
  }

  private canStillDraft(): boolean {
    if (!this.run || this.run.phase !== 'draft') return false;
    if (this.run.draftPicks.length >= DRAFT_PICK) return false;
    return this.run.draftOffers.some((id) => !this.run!.draftPicks.includes(id));
  }

  private afterDraftChange(): void {
    this.noteTeam();
    void this.persist();
    this.patchRecruitShopDom();
    this.scheduleShopClose();
  }

  private takeDraftOffer(defId: string): void {
    if (!this.run || this.run.phase !== 'draft' || this.shopBusy) return;
    if (this.run.draftPicks.length >= DRAFT_PICK) return;
    if (!this.run.draftOffers.includes(defId) || this.run.draftPicks.includes(defId)) return;
    const free = firstFreeSlot(this.run.team);
    if (this.run.team.length >= MAX_TEAM || free < 1 || free > MAX_TEAM || this.run.team.some((u) => u.slot === free)) {
      return;
    }
    this.run = placeDraft(this.run, defId, free);
    audio.play('wood', 'ui');
    this.afterDraftChange();
  }

  private setupDraftOfferDrag(): void {
    const teamRoot = this.recruitTeamRoot();
    if (!teamRoot) return;
    this.root.querySelectorAll<HTMLElement>('.recruit-shop-offers .unit-card.offer:not(.is-spent-offer)').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        if (this.run.draftPicks.length >= DRAFT_PICK) return;
        const defId = el.dataset.def;
        if (!defId || this.run.draftPicks.includes(defId)) return;
        e.preventDefault();
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);

        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          teamRoot.querySelectorAll('[data-slot]').forEach((c) => c.classList.remove('drop-glow'));
          const over = this.slotUnder(ev, teamRoot);
          over?.classList.add('drop-glow');
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = this.slotUnder(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!over || !this.run) return;
          this.takeDraftOffer(defId);
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private canStillRecruit(): boolean {
    if (!this.run || this.run.phase !== 'recruit') return false;
    if (this.recruitReplace) return true;
    if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep)) return false;
    return this.run.recruitOffers.some((id) => !this.run!.recruitPicks.includes(id));
  }

  /** In-place DOM patch so offers/team slots keep the same footprint (no shop jump). */
  private patchRecruitShopDom(): void {
    if (!this.run || (this.run.phase !== 'recruit' && this.run.phase !== 'draft')) return;
    const run = this.run;
    const loc = this.settings.locale;
    const count = run.phase === 'draft' ? run.draftPicks.length : run.recruitPicks.length;
    const limit = run.phase === 'draft' ? DRAFT_PICK : recruitPickLimit(run.recruitPicks, run.eventId, run.eventStep);
    const offers = this.recruitOfferIds(run);

    const offersRoot = this.root.querySelector('.recruit-shop-offers');
    if (offersRoot) {
      const stats = this.runStatCtx();
      offersRoot.innerHTML = offers
        .map((id) => renderOfferCard(loc, id, this.recruitReplace?.defId === id, '', stats))
        .join('');
    }

    const round = this.root.querySelector('.screen-recruit .recruit-round');
    if (round) round.innerHTML = this.recruitRoundHtml(run.round, victoryPointsOf(run));

    const hint = this.root.querySelector('.screen-recruit .sticker-shop-hint');
    if (hint) {
      if (this.recruitReplace) hint.textContent = this.L('recruitReplaceHint');
      else hint.innerHTML = this.recruitCountHint(count, limit);
    }

    const teamRoot = this.recruitTeamRoot();
    if (teamRoot) {
      const replacing = Boolean(this.recruitReplace);
      teamRoot.innerHTML = renderTeamLane(loc, run.team, {
        showEmpty: true,
        ...this.runStatCtx(),
        cardOpts: (u) => ({ extraClass: replacing && !this.goldWouldReplaceHerald(u) ? 'is-replace-pick' : '' }),
      });
      requestAnimationFrame(() => fitCardSlabs(teamRoot));
    }

    const actions = this.root.querySelector('.recruit-actions');
    if (actions && (run.phase === 'recruit' || run.phase === 'draft')) {
      actions.innerHTML = this.recruitReplace?.gold
        ? ''
        : this.recruitReplace
          ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
          : `<button class="${this.shopPassClass()}" data-act="skip-recruit">${this.L('skipRecruit')}</button>`;
    }

    const screen = this.root.querySelector('.screen-recruit');
    screen?.classList.toggle('is-replacing', Boolean(this.recruitReplace));

    this.bindRecruitShopGestures();
  }

  private bindRecruitTeamGestures(): void {
    if (!this.run || this.run.phase !== 'recruit' || !this.recruitReplace) return;
    this.root.querySelectorAll<HTMLElement>('.recruit-shop-team .unit-card[data-instance]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!this.run || !this.recruitReplace) return;
        const slot = Number(el.dataset.slot);
        if (!slot) return;
        const host = this.run.team.find((u) => u.slot === slot);
        if (host && this.goldWouldReplaceHerald(host)) return;
        const defId = this.recruitReplace.defId;
        const gold = this.recruitReplace.gold;
        this.recruitReplace = null;
        this.run = gold ? seatGoldUnit(this.run, slot) : replaceRecruit(this.run, defId, slot);
        audio.play('paper', 'ui');
        this.afterRecruitChange();
      });
    });
  }

  private bindRecruitShopGestures(): void {
    if (!this.run) return;
    if (this.run.phase === 'draft') {
      this.setupDraftOfferDrag();
      return;
    }
    if (this.run.phase !== 'recruit') return;
    this.setupRecruitOfferDrag();
    this.bindRecruitTeamGestures();
  }

  private bindEventRewardGestures(): void {
    if (!this.run || this.run.eventStep !== 'reward-unit') return;
    const reward = eventUnitReward(this.run);
    if (!reward) return;
    const teamRoot = this.recruitTeamRoot();
    if (!teamRoot) return;

    if (this.recruitReplace) {
      this.root.querySelectorAll<HTMLElement>('.recruit-shop-team .unit-card[data-instance]').forEach((el) => {
        el.addEventListener('click', () => {
          if (!this.run || !this.recruitReplace || this.run.eventStep !== 'reward-unit') return;
          const slot = Number(el.dataset.slot);
          if (!slot) return;
          this.recruitReplace = null;
          this.run = replaceEventUnit(this.run, slot);
          this.noteTeam();
          audio.play('paper', 'ui');
          void this.persist();
          this.render();
        });
      });
      return;
    }

    this.root.querySelectorAll<HTMLElement>('.event-reward-offer .unit-card.offer').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.run.eventStep !== 'reward-unit') return;
        e.preventDefault();
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);

        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          teamRoot.querySelectorAll('[data-slot]').forEach((c) => c.classList.remove('drop-glow'));
          const over = this.slotUnder(ev, teamRoot);
          over?.classList.add('drop-glow');
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = this.slotUnder(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!this.run || this.run.eventStep !== 'reward-unit') return;
          if (over) {
            const slot = Number(over.dataset.slot);
            if (slot >= 1 && slot <= MAX_TEAM) {
              if (this.run.team.some((u) => u.slot === slot)) {
                this.recruitReplace = { defId: reward.defId };
                audio.play('paper', 'ui');
                this.render();
                return;
              }
              this.run = placeEventUnit(this.run, slot);
              this.noteTeam();
              audio.play('wood', 'ui');
              void this.persist();
              this.render();
              return;
            }
          }
          this.takeEventRewardOffer();
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private takeEventRewardOffer(): void {
    if (!this.run || this.run.eventStep !== 'reward-unit') return;
    if (this.recruitReplace) return;
    const free = firstFreeSlot(this.run.team);
    const hasRoom =
      this.run.team.length < MAX_TEAM &&
      free >= 1 &&
      free <= MAX_TEAM &&
      !this.run.team.some((u) => u.slot === free);
    if (hasRoom) {
      this.run = placeEventUnit(this.run, free);
      this.noteTeam();
      audio.play('wood', 'ui');
      void this.persist();
      this.render();
      return;
    }
    const reward = eventUnitReward(this.run);
    if (!reward) return;
    this.recruitReplace = { defId: reward.defId };
    audio.play('paper', 'ui');
    this.render();
  }

  private goldWouldReplaceHerald(unit: { defId: string }): boolean {
    return Boolean(this.recruitReplace?.gold && getUnit(unit.defId).passives?.grantGoldUnitOnRecruit);
  }

  private afterRecruitChange(): void {
    this.noteTeam();
    void this.persist();
    if (this.run?.pendingGoldUnitId) this.recruitReplace = { defId: this.run.pendingGoldUnitId, gold: true };
    this.patchRecruitShopDom();
    this.scheduleShopClose();
  }

  private recruitOfferIds(run: RunState): string[] {
    if (run.phase === 'draft') return run.draftOffers;
    const ids = run.recruitOffers.slice();
    const gold = run.pendingGoldUnitId;
    if (gold && !ids.includes(gold)) ids.push(gold);
    return ids;
  }

  private takeRecruitOffer(defId: string): void {
    if (!this.run || this.run.phase !== 'recruit' || this.shopBusy) return;
    if (this.recruitReplace) return;
    if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep)) return;
    if (!this.run.recruitOffers.includes(defId) || this.run.recruitPicks.includes(defId)) return;
    const free = firstFreeSlot(this.run.team);
    const hasRoom =
      this.run.team.length < MAX_TEAM &&
      free >= 1 &&
      free <= MAX_TEAM &&
      !this.run.team.some((u) => u.slot === free);
    if (hasRoom) {
      this.run = placeRecruit(this.run, defId, free);
      audio.play('wood', 'ui');
      this.afterRecruitChange();
      return;
    }
    this.recruitReplace = { defId };
    audio.play('paper', 'ui');
    this.patchRecruitShopDom();
  }

  private setupRecruitOfferDrag(): void {
    const teamRoot = this.recruitTeamRoot();
    if (!teamRoot || this.recruitReplace) return;
    this.root.querySelectorAll<HTMLElement>('.recruit-shop-offers .unit-card.offer:not(.is-spent-offer)').forEach((el) => {
      el.querySelectorAll('img').forEach((img) => {
        img.draggable = false;
      });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.run || this.shopBusy) return;
        if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep)) return;
        const defId = el.dataset.def;
        if (!defId || this.run.recruitPicks.includes(defId)) return;
        e.preventDefault();
        el.classList.add('is-dragging');
        this.ghost = document.createElement('div');
        this.ghost.className = 'ghost-card';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        this.ghost.appendChild(clone);
        document.body.appendChild(this.ghost);
        this.moveGhost(e);

        const onMove = (ev: PointerEvent) => {
          this.moveGhost(ev);
          teamRoot.querySelectorAll('[data-slot]').forEach((c) => c.classList.remove('drop-glow'));
          const over = this.slotUnder(ev, teamRoot);
          over?.classList.add('drop-glow');
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = this.slotUnder(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!over || !this.run) return;
          this.takeRecruitOffer(defId);
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private moveGhost(e: PointerEvent): void {
    if (!this.ghost) return;
    const sticker = this.ghost.classList.contains('ghost-sticker');
    this.ghost.style.left = `${e.clientX - (sticker ? this.ghostGrabX : 90)}px`;
    this.ghost.style.top = `${e.clientY - (sticker ? this.ghostGrabY : 40)}px`;
  }

  private noteTeam(): void {
    if (!this.run) return;
    this.codex = discover(
      this.codex,
      this.run.team.map((u) => u.defId),
      this.run.team.flatMap((u) => u.stickerIds),
    );
    saveCodex(this.codex);
  }

  private persistAndRender(): void {
    void this.persist();
    this.render();
    this.maybeLoopEvents();
  }

  private isMarketTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'market';
  }

  private isWidowTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'widow';
  }

  private isWidowCardTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'widow-card';
  }

  private isHuntCardsTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'hunt-cards';
  }

  private isWoodsmanTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'woodsman';
  }

  private isFilthTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'filth';
  }

  private isScrapTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'scrap';
  }

  private isAmbushTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'ambush';
  }

  /** Farm boy swings into a toy box so the ambush can be watched. */
  private ambushTryRun(): RunState {
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-ambush-test',
      round: 1,
      phase: 'fight',
      playerName: 'Farm Boy',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-ambush-foe',
      playerName: 'Toy Box',
      team: [
        { instanceId: 'e1', defId: 'jack-in-the-box', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    return resolveFight(player, playerSnapshot(foe));
  }

  /** Formation table: the woodsman already wearing his axe. */
  private woodsmanTryRun(): RunState {
    return {
      ...this.widowCardTryRun(),
      runId: 'run-woodsman',
      team: [
        {
          instanceId: 'mw',
          defId: 'mad-woodsman',
          slot: 1,
          stickerIds: ['woodsmans-axe'],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        },
        {
          instanceId: 'tm',
          defId: 'thousand-maws',
          slot: 2,
          stickerIds: [],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        },
      ],
    };
  }

  /** Formation table: the sewer lord wearing Filth, and a figure already reduced to Trash. */
  private filthTryRun(): RunState {
    return {
      ...this.widowCardTryRun(),
      runId: 'run-filth',
      team: [
        {
          instanceId: 'sl',
          defId: 'sewer-lord',
          slot: 1,
          stickerIds: ['filth'],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        },
        {
          instanceId: 'fb',
          defId: 'farm-boy',
          slot: 2,
          stickerIds: ['trash'],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        },
      ],
    };
  }

  /** Battle that replays every hunt boss, in rarity order, then again. */
  private scrapTryRun(): RunState {
    const order = ['thousand-maws', 'purple-widows', 'sewer-lord', 'mad-woodsman', 'greed-fang'];
    const stored = sessionStorage.getItem('oua.scrap-boss');
    const boss = order.includes(stored ?? '') ? stored! : 'thousand-maws';
    const round = boss === 'purple-widows' ? 4 : boss === 'sewer-lord' ? 6 : boss === 'mad-woodsman' ? 8 : boss === 'greed-fang' ? 9 : 1;
    return resolveHuntFight({
      ...this.ovenLoopRun(),
      runId: 'run-scrap-test',
      round,
      phase: 'event',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'rusty-knife'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
      eventId: 'monster-hunt',
      eventStep: 'preview',
      huntMonsterId: boss,
    });
  }

  private huntCardsTryRun(): RunState {
    const blank = { stickerIds: [] as string[], permanentMods: { atk: 0, hp: 0, speed: 0 } };
    return {
      ...this.widowCardTryRun(),
      runId: 'run-hunt-cards',
      team: [
        { instanceId: 'sl', defId: 'sewer-lord', slot: 2, ...blank },
        { instanceId: 'gf', defId: 'greed-fang', slot: 1, stickerIds: ['mythic-treasure'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  /** Formation table, one Widow card, so the ability text can be read at card size. */
  private widowCardTryRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-widow-card',
      phase: 'formation',
      round: 10,
      wins: 9,
      losses: 0,
      victoryPoints: 15,
      team: [
        {
          instanceId: 'widow',
          defId: 'purple-widows',
          slot: 1,
          stickerIds: [],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        },
      ],
      eventId: null,
      eventStep: null,
      huntMonsterId: null,
    };
  }

  /** Silver hunt. Mimic acts after the widow, so his sneak hits the taunting cocoon. The gatekeeper is the back-line body she wraps. */
  private widowTryRun(): RunState {
    const team = [
      { instanceId: 'u1', defId: 'sprung-mimic', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      { instanceId: 'u2', defId: 'old-gatekeeper', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
    ];
    return resolveHuntFight({
      ...this.ovenLoopRun(),
      runId: 'run-widow-test',
      round: 3,
      phase: 'event',
      team,
      eventId: 'monster-hunt',
      eventStep: 'preview',
      huntMonsterId: 'purple-widows',
    });
  }

  private marketTryRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-market-test',
      phase: 'postFight',
      eventId: 'book-of-lost-tales',
      eventStep: null,
      eventOffers: [],
      eventPicks: [],
      alleyDone: [],
      alleyPicks: [],
      alleyQueue: [],
    };
  }

  private tryEvent(): EventId | null {
    const q = new URLSearchParams(location.search).get('try');
    if (
      q === 'wishing-well' ||
      q === 'witch-oven' ||
      q === 'cloning-chamber' ||
      q === 'book-of-lost-tales' ||
      q === 'monster-hunt'
    ) return q;
    return null;
  }

  private tryTitle(): string | null {
    const id = this.tryEvent();
    if (id === 'wishing-well') return 'Well';
    if (id === 'witch-oven') return 'Oven';
    if (id === 'cloning-chamber') return 'Chamber';
    if (id === 'book-of-lost-tales') return 'Book';
    if (id === 'monster-hunt') return 'Hunt';
    return null;
  }

  private armTry(id: EventId): void {
    sessionStorage.removeItem('oua.loop-oven');
    sessionStorage.removeItem('oua.loop-well');
    sessionStorage.removeItem('oua.loop-clone');
    sessionStorage.removeItem('oua.loop-book');
    sessionStorage.removeItem('oua.loop-hunt');
    const key =
      id === 'wishing-well' ? 'oua.loop-well'
      : id === 'witch-oven' ? 'oua.loop-oven'
      : id === 'cloning-chamber' ? 'oua.loop-clone'
      : id === 'book-of-lost-tales' ? 'oua.loop-book'
      : 'oua.loop-hunt';
    sessionStorage.setItem(key, '1');
  }

  private tryRun(id: EventId): RunState {
    if (id === 'wishing-well') return this.wellLoopRun();
    if (id === 'cloning-chamber') return this.cloneLoopRun();
    if (id === 'book-of-lost-tales') return this.bookLoopRun();
    if (id === 'monster-hunt') return this.huntLoopRun();
    return this.ovenLoopRun();
  }

  private maybeLoopEvents(): void {
    if (!this.tryEvent()) return;
    this.maybeLoopOven();
    this.maybeLoopWell();
    this.maybeLoopClone();
    this.maybeLoopBook();
    this.maybeLoopHunt();
  }

  private isOvenLoop(): boolean {
    return sessionStorage.getItem('oua.loop-oven') === '1';
  }

  private ovenLoopRun(): RunState {
    const team = [
      { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'fur-armor'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
    ];
    return {
      runId: 'run-oven-test',
      mode: 'ai',
      playerId: 'p-test',
      playerName: 'TestPlayer',
      round: 3,
      wins: 2,
      losses: 0,
      phase: 'event',
      team,
      pendingStickerIds: [],
      stickerOffers: [],
      stickerPickCount: 1,
      recruitOffers: [],
      recruitPicks: [],
      draftOffers: [],
      draftPicks: [],
      lastBattle: null,
      lastBonusBattle: null,
      history: [],
      seed: 42,
      offerCounter: 4,
      dataVersion: DATA_VERSION,
      startedAt: Date.now(),
      eventId: 'witch-oven',
      eventStep: 'preview',
      eventOffers: [],
      eventPicks: [],
      huntMonsterId: null,
      recruitRarityBump: false,
      alleyPicks: [],
      alleyQueue: [],
      alleyDone: [],
      stickersGained: 0,
      deathsThisRun: 0,
      lostTales: [],
    };
  }

  private maybeLoopOven(): void {
    if (!this.isOvenLoop() || !this.run) return;
    const stay = this.run.eventId === 'witch-oven' && (this.run.phase === 'event' || this.run.phase === 'stickerAssign');
    if (stay) return;
    this.shopBusy = false;
    this.clearShopHold();
    this.clearSpentOffers();
    this.replacePick = null;
    this.recruitReplace = null;
    this.run = this.ovenLoopRun();
    void this.persist();
    this.render();
  }

  private isWellLoop(): boolean {
    return sessionStorage.getItem('oua.loop-well') === '1';
  }

  private wellLoopRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-well-test',
      eventId: 'wishing-well',
      eventStep: 'preview',
    };
  }

  private maybeLoopWell(): void {
    if (!this.isWellLoop() || !this.run) return;
    const stay =
      this.run.eventId === 'wishing-well' &&
      (this.run.phase === 'event' || this.run.phase === 'stickerAssign' || this.run.phase === 'recruit');
    if (stay) return;
    this.shopBusy = false;
    this.clearShopHold();
    this.clearSpentOffers();
    this.replacePick = null;
    this.recruitReplace = null;
    this.run = this.wellLoopRun();
    void this.persist();
    this.render();
  }

  private isCloneLoop(): boolean {
    return sessionStorage.getItem('oua.loop-clone') === '1';
  }

  private cloneLoopRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-clone-test',
      eventId: 'cloning-chamber',
      eventStep: 'preview',
    };
  }

  private maybeLoopClone(): void {
    if (!this.isCloneLoop() || !this.run) return;
    const stay = this.run.eventId === 'cloning-chamber' && this.run.phase === 'event';
    if (stay) return;
    this.shopBusy = false;
    this.clearShopHold();
    this.clearSpentOffers();
    this.replacePick = null;
    this.recruitReplace = null;
    this.run = this.cloneLoopRun();
    void this.persist();
    this.render();
  }

  private isBookLoop(): boolean {
    return sessionStorage.getItem('oua.loop-book') === '1';
  }

  private bookLoopRun(): RunState {
    return ensureBookOffers({
      ...this.ovenLoopRun(),
      runId: 'run-book-test',
      eventId: 'book-of-lost-tales',
      eventStep: 'book-kind',
      eventOffers: ['book-sticker:cursed-armor'],
    });
  }

  private holdBookClose(): void {
    this.shopBusy = true;
    this.noteTeam();
    this.persistAndRender();
    this.clearShopHold();
    this.shopHoldTimer = window.setTimeout(() => {
      this.shopBusy = false;
      if (!this.run || this.run.eventId !== 'book-of-lost-tales') return;
      this.run = settleBookChoice(this.run);
      if (this.isBookLoop()) this.run = this.bookLoopRun();
      this.persistAndRender();
    }, 1000);
  }

  private maybeLoopBook(): void {
    if (!this.isBookLoop() || !this.run) return;
    const stay =
      this.run.eventId === 'book-of-lost-tales' &&
      (this.run.phase === 'event' || this.run.phase === 'stickerAssign' || this.run.phase === 'recruit');
    if (stay) return;
    this.shopBusy = false;
    this.clearShopHold();
    this.clearSpentOffers();
    this.replacePick = null;
    this.recruitReplace = null;
    this.run = this.bookLoopRun();
    void this.persist();
    this.render();
  }

  private isHuntLoop(): boolean {
    return sessionStorage.getItem('oua.loop-hunt') === '1';
  }

  private huntLoopRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-hunt-test',
      round: 1,
      wins: 0,
      losses: 0,
      victoryPoints: 0,
      phase: 'postFight',
      eventId: 'monster-hunt',
      eventStep: null,
      huntMonsterId: 'thousand-maws',
      alleyDone: [],
      alleyPicks: [],
      alleyQueue: [],
    };
  }

  private maybeLoopHunt(): void {
    if (!this.isHuntLoop() || !this.run) return;
    const stay =
      this.run.eventId === 'monster-hunt' &&
      (this.run.phase === 'event' || this.run.phase === 'stickerAssign' || this.screen === 'battle');
    if (stay) return;
    this.shopBusy = false;
    this.clearShopHold();
    this.clearSpentOffers();
    this.replacePick = null;
    this.recruitReplace = null;
    this.run = this.huntLoopRun();
    void this.persist();
    this.render();
  }

  private async onAction(act: string, el: HTMLElement): Promise<void> {
    if (act === 'preview-clip') {
      const clip = el.dataset.clip;
      const img = this.root.querySelector<HTMLImageElement>('#card-sample .portrait-art');
      if (img && clip) {
        img.dataset.locked = 'true';
        img.src = `./art/units/frog-prince/${clip}.png`;
      }
      for (const btn of this.root.querySelectorAll<HTMLElement>('[data-act="preview-clip"]')) {
        btn.setAttribute('aria-pressed', btn === el ? 'true' : 'false');
      }
      return;
    }
    if (act === 'preview-rarity') {
      const rarity = el.dataset.rarity;
      const seal = this.root.querySelector<HTMLElement>('#card-sample .rarity-seal');
      const img = seal?.querySelector('img');
      if (seal && img && rarity) {
        const name = rarityLabel(this.settings.locale, rarity);
        img.src = `./art/ui/seal-${rarity}.png?v=coins`;
        seal.dataset.rarity = rarity;
        seal.setAttribute('aria-label', name);
        const tip = seal.querySelector('.targeting-tip');
        if (tip) tip.textContent = name;
      }
      for (const btn of this.root.querySelectorAll<HTMLElement>('[data-act="preview-rarity"]')) {
        btn.setAttribute('aria-pressed', btn === el ? 'true' : 'false');
      }
      return;
    }
    if (act === 'close-dossier') {
      this.closeDossier();
      return;
    }
    if (act === 'menu') {
      if (this.run?.phase === 'final') this.run = null;
      return this.go('menu');
    }
    if (act === 'fullscreen') {
      await toggleFullscreen();
      return;
    }
    if (act === 'exit-game') {
      this.closeGame();
      return;
    }
    if (act === 'play' || act === 'new-run') {
      sessionStorage.removeItem('oua.loop-oven');
      sessionStorage.removeItem('oua.loop-well');
      sessionStorage.removeItem('oua.loop-clone');
      sessionStorage.removeItem('oua.loop-book');
      sessionStorage.removeItem('oua.loop-hunt');
      await this.startNewRun();
      return;
    }
    if (act === 'continue' && this.run && this.run.phase !== 'final') {
      await this.maybeFullscreen();
      return this.go('run');
    }
    if (act === 'codex') return this.go('codex');
    if (act === 'options') return this.go('options');
    if (act === 'set-locale') {
      const next = el.dataset.locale;
      if (next !== 'en' && next !== 'it') return;
      if (this.settings.locale === next) return;
      this.settings.locale = next;
      saveSettings(this.settings);
      syncFullscreenChrome(this.L('fullscreen'), this.L('fullscreenExit'));
      setLandscapeGateLabel(this.L('turnPhone'));
      return this.render();
    }
    if (act === 'confirm-draft' && this.run) {
      this.run = confirmDraft(this.run);
      this.noteTeam();
      await this.persist();
      return this.render();
    }
    if ((act === 'alley-recruit' || act === 'alley-sticker' || act === 'alley-event') && this.run) {
      if (el.classList.contains('is-done') || el.getAttribute('aria-disabled') === 'true') return;
      const pick = act.slice('alley-'.length) as AlleyChoice;
      this.run = chooseAlley(this.run, pick);
      this.cuts = [];
      await this.persist();
      return this.render();
    }
    if ((act === 'event-kind-unit' || act === 'event-kind-sticker') && this.run) {
      this.run = pickEventKind(this.run, act === 'event-kind-unit' ? 'unit' : 'sticker');
      this.codex = discover(this.codex, [], this.run.pendingStickerIds);
      this.noteTeam();
      audio.play('paper', 'ui');
      await this.persist();
      return this.render();
    }
    if (act === 'oven-discard' && this.run) {
      this.run = ovenDiscardSticker(this.run);
      audio.play('peel', 'ui');
      await this.persist();
      this.render();
      this.maybeLoopEvents();
      return;
    }
    if (act === 'throw-event-reward' && this.run) {
      this.recruitReplace = null;
      this.run = throwEventReward(this.run);
      audio.play('peel', 'ui');
      await this.persist();
      this.render();
      this.maybeLoopEvents();
      return;
    }
    if (act === 'claim-event-reward' && this.run) {
      this.recruitReplace = null;
      this.run = throwEventReward(this.run);
      audio.play('peel', 'ui');
      await this.persist();
      return this.render();
    }
    if (act === 'pass-alley' && this.run) {
      this.run = passAlley(this.run);
      this.cuts = [];
      await this.persist();
      return this.render();
    }
    if (act === 'skip-sticker' && this.run) {
      const giftDone = this.isGiftStickerAssign() && this.run.pendingStickerIds.length === 0 && this.spentOfferIds.length > 0;
      const shopDone = this.run.phase === 'sticker' && this.spentOfferIds.length > 0;
      this.replacePick = null;
      this.shopBusy = false;
      this.clearShopHold();
      if (giftDone) this.run = settleStickerAssign(this.run);
      else if (shopDone) this.run = settleStickerShop(this.run);
      else this.run = skipStickers(this.run);
      this.clearSpentOffers();
      await this.persist();
      this.render();
      this.maybeLoopEvents();
      return;
    }
    if (act === 'start-hunt' && this.run) {
      return this.launchHuntFight();
    }
    if (act === 'skip-event' && this.run) {
      this.run = skipEmptyEvent(this.run);
      await this.persist();
      this.render();
      this.maybeLoopEvents();
      return;
    }
    if (act === 'cancel-book-sticker') {
      this.replacePick = null;
      this.render();
      return;
    }
    if (act === 'cancel-replace-recruit') {
      if (this.recruitReplace?.gold) return;
      this.recruitReplace = null;
      if (this.run?.phase === 'recruit' || this.run?.phase === 'draft') this.patchRecruitShopDom();
      else this.render();
      return;
    }
    if (act === 'skip-recruit' && this.run) {
      if (this.run.pendingGoldUnitId) return;
      this.clearShopHold();
      this.shopBusy = false;
      if (this.run.phase === 'draft') {
        this.run = confirmDraft(this.run);
        this.noteTeam();
        await this.persist();
        return this.render();
      }
      this.recruitReplace = null;
      this.run = skipRecruit(this.run);
      await this.persist();
      this.render();
      this.maybeLoopEvents();
      return;
    }
    if (act === 'fight' && this.run) {
      if (this.isHuntLineup()) return this.launchHuntFight();
      // Samsung: give the WebAudio tick a real turn before fullscreen + the scrap sim.
      await new Promise<void>((r) => setTimeout(r, 120));
      await this.maybeFullscreen();
      audio.unlock();
      await this.beginFight();
      return;
    }
    if (act === 'after-result' && this.run) {
      this.run = afterResult(this.run);
      if (this.run.phase === 'final') await this.finishRun();
      await this.persist();
      return this.render();
    }
    if (act === 'abandon') {
      this.root.insertAdjacentHTML(
        'beforeend',
        `<div class="paper panel" id="confirm-abandon" style="position:fixed;inset:auto;top:30%;left:50%;transform:translateX(-50%);z-index:20;max-width:360px">
          <p>${this.L('confirmDelete')}</p>
          <div class="row">
            <button class="btn danger" data-act="abandon-yes">${this.L('yes')}</button>
            <button class="btn ghost" data-act="abandon-no">${this.L('no')}</button>
          </div>
        </div>`,
      );
      return;
    }
    if (act === 'abandon-no') {
      this.root.querySelector('#confirm-abandon')?.remove();
      return;
    }
    if (act === 'abandon-yes') {
      this.run = null;
      await this.services.runs.clear();
      return this.go('menu');
    }
    if (act === 'new-from-final') {
      await this.startNewRun();
      return;
    }
    if (act === 'spd-1') this.battleView?.setSpeed(1);
    if (act === 'spd-2') this.battleView?.setSpeed(2);
    if (act === 'pause-battle') {
      const btn = el;
      const nowPaused = btn.dataset.paused !== '1';
      this.battleView?.setPaused(nowPaused);
      btn.dataset.paused = nowPaused ? '1' : '0';
      btn.textContent = nowPaused ? this.L('resume') : this.L('pause');
    }
    if (act === 'skip-battle') {
      this.battleView?.skip();
      audio.play('whoosh');
    }
  }

  private async maybeFullscreen(): Promise<void> {
    if (this.settings.preferFullscreen) await enterFullscreen();
  }

  private closeGame(): void {
    window.close();
    if (window.closed) return;
    void exitFullscreen().then(() => {
      window.close();
    });
  }

  private async launchHuntFight(): Promise<void> {
    if (!this.run) return;
    this.run = resolveHuntFight(this.run);
    await this.persist();
    this.go('battle');
    audio.leaveSquare('hunt');
    await this.maybeFullscreen();
  }

  private async startNewRun(): Promise<void> {
    const alias = clampPlayerName(this.root.querySelector<HTMLInputElement>('#alias')?.value || this.player.name);
    this.player = { ...this.player, name: alias };
    savePlayer(this.player.id, alias);
    this.run = null;
    if (!this.tryEvent() && !this.isMarketTry() && !this.isWidowTry() && !this.isWidowCardTry() && !this.isHuntCardsTry() && !this.isWoodsmanTry() && !this.isFilthTry() && !this.isScrapTry() && !this.isAmbushTry()) await this.services.runs.clear();
    this.run = createRun('ai', this.player.id, alias);
    this.cuts = [];
    this.noteDraft();
    await this.maybeFullscreen();
    await this.persist();
    this.go('run');
  }

  private noteDraft(): void {
    if (!this.run) return;
    this.codex = discover(this.codex, this.run.draftOffers, []);
    saveCodex(this.codex);
  }

  private async beginFight(): Promise<void> {
    if (!this.run) return;
    // Let the Fight tick leave the speaker on Samsung before the sync scrap sim runs.
    await new Promise<void>((r) => setTimeout(r, 0));
    const enemy =
      circuitOpponent(this.run) ??
      (await this.services.matchmaking.findOpponent(this.run.round, this.run.runId, this.run.playerName));
    this.run = resolveFight(this.run, enemy);
    const snap = playerSnapshot(this.run);
    if (!validateSnapshot(snap).length) await this.services.snapshots.save(snap);
    await this.persist();
    this.go('battle');
    audio.leaveSquare('fight');
  }

  private esc(text: string): string {
    return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
  }

  private standingsRows(): { place: number; name: string; points: number; you: boolean }[] {
    const run = this.run!;
    if (run.circuit?.length) {
      const seated = [
        { name: clampPlayerName(run.playerName), points: victoryPointsOf(run), you: true },
        ...run.circuit.map((rival) => ({ name: clampPlayerName(rival.playerName), points: rival.victoryPoints, you: false })),
      ].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      let place = 0;
      let last = Number.POSITIVE_INFINITY;
      return seated.map((row, i) => {
        if (row.points !== last) {
          place = i + 1;
          last = row.points;
        }
        return { ...row, place };
      });
    }
    const foes = new Map<string, number>();
    for (const h of run.history) {
      const gain = h.winner === 'draw' ? 1 : h.winner === 'enemy' || (h.winner == null && !h.win) ? 3 : 0;
      const name = clampPlayerName(h.opponentName?.trim() || this.L('house'));
      foes.set(name, (foes.get(name) ?? 0) + gain);
    }
    const rows = [
      { name: clampPlayerName(run.playerName), points: victoryPointsOf(run), you: true },
      ...[...foes].map(([name, points]) => ({ name, points, you: false })),
    ].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    let place = 0;
    let last = Number.POSITIVE_INFINITY;
    return rows.map((row, i) => {
      if (row.points !== last) {
        place = i + 1;
        last = row.points;
      }
      return { ...row, place };
    });
  }

  private playBattleEnd(): void {
    const run = this.run;
    const field = this.root.querySelector<HTMLElement>('#battlefield');
    const battle = run?.lastBattle;
    if (!run || !field || !battle || field.querySelector('.battle-end')) return;
    const waitMs = Math.round(audio.beginEnding() * 1000);
    window.setTimeout(() => {
      if (this.screen !== 'battle') return;
      if (this.run?.phase !== 'result' && !this.isHuntEndPending()) return;
      const live = this.root.querySelector<HTMLElement>('#battlefield');
      const still = this.run?.lastBattle;
      if (!live || !still || live.querySelector('.battle-end')) return;
      this.revealBattleEnd(live, still);
    }, waitMs);
  }

  private isHuntEndPending(): boolean {
    return this.run?.eventId === 'monster-hunt' && this.run.eventStep === 'hunt-result';
  }

  private revealBattleEnd(field: HTMLElement, battle: NonNullable<NonNullable<typeof this.run>['lastBattle']>): void {
    const run = this.run;
    if (!run) return;
    field.classList.add('is-ended');
    const winner = battle.winner;
    const hunt = this.isHuntEndPending();
    const gained = hunt ? 0 : winner === 'player' ? 3 : winner === 'draw' ? 1 : 0;
    const to = victoryPointsOf(run);
    const from = hunt ? to + huntKnockedOutIds(run, 'player').length : Math.max(0, to - gained);
    const wordKey = winner === 'player' ? 'resultWin' : winner === 'draw' ? 'resultDraw' : 'resultLose';
    const wordClass = winner === 'player' ? 'is-win' : winner === 'draw' ? 'is-draw' : 'is-lose';
    field.insertAdjacentHTML(
      'beforeend',
      `<div class="battle-end">
        <div class="battle-end-row">
          <h2 class="battle-end-word ${wordClass}">${this.L(wordKey)}</h2>
        </div>
      </div>`,
    );
    const row = field.querySelector<HTMLElement>('.battle-end-row');
    const board = field.querySelector<HTMLElement>('.battle-board');
    if (row && board) {
      let y = 0;
      let node: HTMLElement | null = board;
      while (node && node !== field) {
        y += node.offsetTop;
        node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
      }
      row.style.top = `${Math.max(0, y - 86)}px`;
    }

    const steps = Math.abs(to - from);
    if (steps === 0) {
      window.setTimeout(() => void this.leaveBattleEnd(), 2000);
      return;
    }

    const crown = field.querySelector<HTMLElement>('.battle-hud .line-crown');
    const score = crown?.querySelector(':scope > b');
    if (crown && score) {
      const rising = to > from;
      const roll = document.createElement('span');
      roll.className = 'vp-roll';
      const sizer = document.createElement('span');
      sizer.className = 'vp-max';
      sizer.setAttribute('aria-hidden', 'true');
      sizer.textContent = '30';
      const strip = document.createElement('span');
      strip.className = 'vp-roll-strip';
      for (let i = 0; i <= steps; i++) {
        const cell = document.createElement('b');
        cell.textContent = String(rising ? from + i : from - i);
        strip.appendChild(cell);
      }
      roll.append(sizer, strip);
      score.replaceWith(roll);
      const tick = (step: number, stepH: number) => {
        if (step > steps) return;
        strip.style.transform = `translateY(${-step * stepH}px)`;
        if (step === steps) {
          window.setTimeout(() => void this.leaveBattleEnd(), 1400);
          return;
        }
        window.setTimeout(() => tick(step + 1, stepH), 420);
      };
      window.requestAnimationFrame(() => {
        // offsetHeight stays in the stage's own pixels. getBoundingClientRect
        // is already shrunk by the phone scale, so the roll would stop halfway.
        const stepH = strip.querySelector('b')?.offsetHeight || 128;
        window.setTimeout(() => tick(1, stepH), 480);
      });
      return;
    }
    window.setTimeout(() => void this.leaveBattleEnd(), 2000);
  }

  private async leaveBattleEnd(): Promise<void> {
    if (!this.run) return;
    cancelAnimationFrame(this.raf);
    if (this.isHuntEndPending()) {
      this.run = claimHunt(this.run);
      this.codex = discover(this.codex, [], this.run.pendingStickerIds);
      this.noteTeam();
      this.battleFieldUp = false;
      this.screen = 'run';
      await this.persist();
      await this.fadeArenaToSquare();
      this.maybeLoopHunt();
      return;
    }
    if (this.run.phase !== 'result') return;
    this.run = afterResult(this.run);
    if (this.run.phase === 'final') await this.finishRun();
    await this.persist();
    this.battleFieldUp = false;
    this.screen = 'run';
    await this.fadeArenaToSquare();
  }

  private mountBattle(): void {
    const field = this.root.querySelector<HTMLElement>('#battlefield');
    if (!field || !this.run?.lastBattle) return;
    const view = new BattleView(field, this.settings);
    this.battleView = view;
    view.setSpeed(this.settings.battleSpeed);
    view.load(this.run.lastBattle.events);
    view.onField = () => {
      this.battleFieldUp = true;
      audio.setCue(this.musicCue());
    };
    view.onDone = () => {
      const winner = this.run?.lastBattle?.winner;
      if (winner) view.beginVictory(winner);
      if (this.isHuntEndPending()) {
        this.playBattleEnd();
        return;
      }
      if (this.run?.phase !== 'result') {
        // Scrap try: soft music end + victory dance, then next boss.
        const ending = this.isScrapTry() ? 0 : audio.beginEnding();
        const waitMs = Math.max(2600, Math.round(ending * 1000) + 1800);
        window.setTimeout(() => {
          if (this.isScrapTry()) {
            const order = ['thousand-maws', 'purple-widows', 'sewer-lord', 'mad-woodsman', 'greed-fang'];
            const cur = sessionStorage.getItem('oua.scrap-boss') ?? 'thousand-maws';
            const next = order[(order.indexOf(cur) + 1) % order.length] ?? 'thousand-maws';
            sessionStorage.setItem('oua.scrap-boss', next);
            this.battleFieldUp = false;
            this.run = this.scrapTryRun();
            this.screen = 'battle';
            this.render();
            void this.persist();
            return;
          }
          this.battleFieldUp = false;
          this.screen = 'run';
          void this.persist();
          void this.fadeArenaToSquare();
        }, waitMs);
        return;
      }
      this.playBattleEnd();
    };
    cancelAnimationFrame(this.raf);
    this.lastTs = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastTs) / 1000);
      this.lastTs = now;
      view.tick(dt);
      view.draw();
      const log = this.root.querySelector('#clog');
      if (log) log.textContent = view.log.slice(-8).join('\n');
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async finishRun(): Promise<void> {
    if (!this.run) return;
    const score = runScore(this.run);
    await this.services.leaderboard.submit({
      runId: this.run.runId,
      playerId: this.run.playerId,
      playerName: this.run.playerName,
      mode: this.run.mode,
      wins: this.run.wins,
      survivorDiff: score.survivorDiff,
      hpPctTotal: score.hpPctTotal,
      finishedAt: Date.now(),
    });
    await this.services.runs.clear();
  }
}
