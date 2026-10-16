import { audio, type MusicCue } from '../audio/engine';
import { barePrintedSummon, firstFreeSlot, getSticker, getUnit, killsLeftOnCard, stickerArtFile } from '../core/catalog';
import { clampPlayerName, PLAYER_NAME_MAX } from '../core/ids';
import { EVENT_BY_ID, HUNT_MONSTERS, huntStickerFor, lossRewardRarity } from '../data/events';
import { rarityRank, shopMaxRarity, stickerMaxRarity } from '../data/rarity';
import { grantableStickers, isOvenSweet, libraryHuntStickers, ovenSweetBase, ovenSweets } from '../data/stickers';
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
  ensureAlleyEvent,
  peekRecruitGiftTarget,
  settleBookChoice,
  eventIsBlocked,
  eventSelectSticker,
  eventSelectUnit,
  eventUnitReward,
  migrateRun,
  isOpeningStickerGift,
  candlesOf,
  placeOf,
  scrapCandles,
  livingIds,
  ovenDiscardSticker,
  pickEventKind,
  beginRecruit,
  beginSticker,
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
import {
  ALLEY_PICK,
  DATA_VERSION,
  DRAFT_PICK,
  MAX_STICKERS,
  MAX_TEAM,
  STARTING_CANDLES,
  STICKER_PICK,
} from '../core/types';
import { bindTargetingTips, fitCardSlabs, paintPortraits, renderDossierOverlay, renderOfferCard, renderStickerCard, renderTeamLane, renderUnitCard, t } from './cards';
import { bindFullscreenControls, enterFullscreen, exitFullscreen, setLandscapeGateLabel, syncFullscreenChrome, toggleFullscreen } from './fullscreen';
import { applyViewportScale } from './scale';
import { fadeOutScene, revealScene, SCRAP_COVER_MS, SCRAP_REVEAL_MS, syncScene, willChangeScene } from './sceneFade';

type Screen = 'menu' | 'run' | 'battle' | 'codex';

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
  /** Two alley picks done: skip the old formation screen and start the scrap. */
  private alleyFightArmed = false;
  private huntFightArmed = false;
  private raf = 0;
  private lastTs = 0;
  private dragSticker: string | null = null;
  private ghost: HTMLElement | null = null;
  private ghostGrabX = 36;
  private ghostGrabY = 36;
  private dragSlot: number | null = null;
  private cardZoom: HTMLElement | null = null;
  private zoomFloat: HTMLElement | null = null;
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
  private endingTimer = 0;
  /** True while playTaleEnd has taken ownership of the coda (paint must not start it under the veil). */
  private deferTaleCoda = false;
  /** Prevents double tale-end from nightOver + leaveBattleEnd / Skip paths. */
  private taleEndLock = false;

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
    if (import.meta.env.DEV) {
      const prove = new URLSearchParams(location.search).get('try');
      if (prove === 'candles') {
        this.mountCandleTest();
        return;
      }
      if (prove === 'rug') {
        this.mountRugTest();
        return;
      }
      if (prove === 'round') {
        this.mountRoundProveTest();
        return;
      }
      if (prove === 'scrapfields') {
        this.mountScrapFieldsTest();
        return;
      }
      if (prove === 'huntfield') {
        this.mountHuntFieldProve();
        return;
      }
      if (prove === 'shoplayout') {
        this.mountShopLayoutTest();
        return;
      }
    }
    const tryId = this.tryEvent();
    const shopTry = new URLSearchParams(location.search).get('try');
    if (shopTry === 'recruit') {
      // Itch GIF / try: keep the board airy — two seated, room to drop offers.
      const base = this.marketTryRun();
      this.run = beginRecruit({
        ...base,
        team: base.team.slice(0, 2).map((u, i) => ({ ...u, slot: i + 1 })),
      });
      this.screen = 'run';
    } else if (shopTry === 'sticker') {
      this.run = beginSticker(this.marketTryRun());
      this.screen = 'run';
    } else if (shopTry === 'well-reward') {
      this.run = this.wellRewardTryRun();
      this.screen = 'run';
    } else if (shopTry === 'oven-reward') {
      this.run = this.ovenRewardTryRun();
      this.screen = 'run';
    } else if (shopTry === 'clone-reward') {
      this.run = this.cloneRewardTryRun();
      this.screen = 'run';
    } else if (shopTry === 'well-sticker-reward') {
      this.run = this.wellStickerRewardTryRun();
      this.screen = 'run';
    } else if (this.isMarketTry()) {
      this.run = this.marketTryRun();
      this.screen = 'run';
    } else if (this.isEndingFilmTry()) {
      // Straight to film coda with real unit cards (not bare art PNGs).
      this.run = { ...this.endingTryRun(), phase: 'final' };
      this.screen = 'run';
    } else if (this.isEndingTry()) {
      this.run = this.endingTryRun();
      this.screen = 'battle';
    } else if (this.isFightTry() || this.isPaperTry() || this.isCandeliereTry() || this.isTwoZoneTry()) {
      this.run = this.fightTryRun();
      this.screen = 'run';
    } else if (this.isHeraldTry()) {
      this.run = this.heraldTryRun();
      this.screen = 'run';
    } else if (this.isGiftTry()) {
      this.run = this.giftTryRun();
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
    } else if (this.isSilenceTry()) {
      this.run = this.silenceTryRun();
      this.screen = 'battle';
    } else if (this.isTaleTry()) {
      this.run = this.taleTryRun();
      this.screen = 'battle';
    } else if (this.isAmbushTry()) {
      this.run = this.ambushTryRun();
      this.screen = 'battle';
    } else if (this.isVsTry()) {
      this.run = this.vsTryRun();
      this.screen = 'battle';
    } else if (this.isNegVpTry()) {
      this.run = this.negVpTryRun();
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
        if (this.run?.phase === 'final' && !this.isEndingTry()) {
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
    document.getElementById('options-gear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHomeChromeMenu();
    });
    document.getElementById('home-chrome')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act !== 'set-locale' && act !== 'exit-game' && act !== 'menu' && act !== 'skip-battle') return;
      e.stopPropagation();
      if (act !== 'skip-battle') this.setHomeChromeMenu(false);
      void this.onAction(act, btn);
    });
    document.getElementById('dev-skip-battle')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    document.getElementById('exit-stamp')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    document.getElementById('menu-stamp')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    document.addEventListener('click', (e) => {
      const chrome = document.getElementById('home-chrome');
      if (!chrome?.classList.contains('is-open')) return;
      const t = e.target as Node;
      if (chrome.contains(t)) return;
      if (document.getElementById('credits-panel')?.contains(t)) return;
      this.setHomeChromeMenu(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setHomeChromeMenu(false);
    });
    this.render();
  }

  private setHomeChromeMenu(open: boolean): void {
    const chrome = document.getElementById('home-chrome');
    const rail = document.getElementById('home-chrome-rail');
    const gear = document.getElementById('options-gear');
    if (!chrome || !rail || !gear) return;
    chrome.classList.toggle('is-open', open);
    rail.hidden = !open;
    gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) {
      const credits = document.getElementById('credits-panel');
      if (credits) credits.hidden = true;
    }
  }

  private toggleHomeChromeMenu(): void {
    const chrome = document.getElementById('home-chrome');
    this.setHomeChromeMenu(!chrome?.classList.contains('is-open'));
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
    document.getElementById('options-gear')?.addEventListener('pointerdown', (e) => {
      if (e.button === 0) audio.play('click', 'ui');
    });
    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-act]');
      if (btn?.classList.contains('book-page') && target.closest('.rule-tip')) return;
      if (btn) {
        this.onAction(btn.dataset.act!, btn);
        return;
      }
      // Library: left click opens the tale. Right click zooms figures only.
      if (this.screen !== 'codex' || this.cardZoom || this.dossierDefId) return;
      if (target.closest('.rule-tip, .dossier-overlay')) return;
      const card = target.closest<HTMLElement>('.unit-card[data-def]');
      if (!card?.dataset.def) return;
      this.openDossier(card.dataset.def);
    });
    this.root.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest('.btn-fight-art')) e.preventDefault();
    });
    window.addEventListener('resize', () => {
      this.layoutFightSeal();
      this.syncFieldSeam();
    });
    window.visualViewport?.addEventListener('resize', () => {
      this.layoutFightSeal();
      this.syncFieldSeam();
    });
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        e.preventDefault();
        return;
      }
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
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
        // Phone: tap to zoom. Library left tap opens the tale instead.
        if (!this.phonePlay() || e.button !== 0 || this.cardZoom || this.screen === 'codex') return;
        const card = this.zoomableCard(e.target);
        if (!card) return;
        if (e.target instanceof Element && e.target.closest('button, .rule-tip, .sticker-slot')) e.preventDefault();
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
    this.root.addEventListener(
      'contextmenu',
      (e) => {
        if (this.phonePlay() || this.cardZoom) return;
        const card = this.zoomableCard(e.target);
        if (!card) return;
        e.preventDefault();
        this.openCardZoom(card);
      },
      { capture: true },
    );
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
      if (this.tryEvent() || this.isMarketTry() || this.isGiftTry() || this.isFightTry() || this.isHeraldTry() || this.isEndingTry() || this.isWidowTry() || this.isWidowCardTry() || this.isHuntCardsTry() || this.isWoodsmanTry() || this.isFilthTry() || this.isScrapTry() || this.isAmbushTry() || this.isTaleTry() || this.isSilenceTry() || this.isNegVpTry()) sessionStorage.removeItem('oua.try-run');
      else await this.services.runs.clear();
    } else if (this.run) {
      if (this.tryEvent() || this.isMarketTry() || this.isGiftTry() || this.isFightTry() || this.isHeraldTry() || this.isEndingTry() || this.isWidowTry() || this.isWidowCardTry() || this.isHuntCardsTry() || this.isWoodsmanTry() || this.isFilthTry() || this.isScrapTry() || this.isAmbushTry() || this.isTaleTry() || this.isSilenceTry() || this.isNegVpTry()) sessionStorage.setItem('oua.try-run', JSON.stringify(this.run));
      else await this.services.runs.save(this.run);
    }
    saveSettings(this.settings);
    saveCodex(this.codex);
  }

  private L(key: string): string {
    return t(this.settings.locale, key);
  }

  private recruitCountHint(count: number, limit: number): string {
    return `${this.L('alleyHintLead')} <b class="recruit-count">${count}/${limit}</b>`;
  }

  private pickHintClass(count: number): string {
    return count > 0 ? ' is-pick-progress' : '';
  }

  /** Dev bench: the three candles, then one snuffs so the dying flame can be watched. */
  private mountCandleTest(): void {
    document.title = 'Candles';
    document.documentElement.classList.add('is-square', 'is-candle-try');
    applyViewportScale();
    this.root.innerHTML = `<div class="candle-test">
      <p class="candle-test-title">Candele · fiamma + spegnimento</p>
      ${this.candlesMarkup(STARTING_CANDLES)}
    </div>`;
    const candles = [...this.root.querySelectorAll<HTMLElement>('.candle')];
    let index = candles.length - 1;
    const snuff = (): void => {
      const el = candles[index];
      if (!el) return;
      el.classList.add('is-snuffing');
      // Flame out 1.05s, then smoke 1.15s.
      window.setTimeout(() => {
        el.classList.remove('is-lit', 'is-snuffing');
        el.classList.add('is-out');
        window.setTimeout(() => {
          el.classList.remove('is-out');
          el.classList.add('is-lit');
          index = (index + candles.length - 1) % candles.length;
          window.setTimeout(snuff, 1100);
        }, 900);
      }, 2300);
    };
    window.setTimeout(snuff, 1400);
  }

  /** Dev bench: five compact round-counter proofs side by side. */
  private mountRoundProveTest(): void {
    document.title = 'Round proves';
    document.documentElement.classList.add('is-square', 'is-round-prove');
    applyViewportScale();
    this.root.innerHTML = `<div class="round-prove">
      <p class="round-prove-title">Round · prove (round 3 / 10)</p>
      <div class="round-prove-grid">
        <figure class="round-prove-card" data-kind="corner">
          <div class="round-prove-stage">
            <img src="./art/ui/round-prove-corner.png?v=p1" alt="" draggable="false" />
            <span class="round-prove-overlay is-corner"><b>3</b><i>/10</i></span>
          </div>
          <figcaption>1 · Angolo carta</figcaption>
        </figure>
        <figure class="round-prove-card" data-kind="tally">
          <div class="round-prove-stage">
            <img src="./art/ui/round-prove-tally.png?v=p1" alt="" draggable="false" />
          </div>
          <figcaption>2 · Tacche legno</figcaption>
        </figure>
        <figure class="round-prove-card" data-kind="tag">
          <div class="round-prove-stage">
            <img src="./art/ui/round-prove-tag.png?v=p1" alt="" draggable="false" />
            <span class="round-prove-overlay is-tag"><em>ROUND</em><b>3</b></span>
          </div>
          <figcaption>3 · Chiodo + cartellino</figcaption>
        </figure>
        <figure class="round-prove-card" data-kind="ink">
          <div class="round-prove-stage is-ink">
            <span class="round-prove-ink"><b>3</b><i>·10</i></span>
          </div>
          <figcaption>4 · Solo inchiostro</figcaption>
        </figure>
        <figure class="round-prove-card" data-kind="beads">
          <div class="round-prove-stage">
            <img src="./art/ui/round-prove-beads.png?v=p1" alt="" draggable="false" />
          </div>
          <figcaption>5 · Filo e perle</figcaption>
        </figure>
      </div>
    </div>`;
  }

  /** Dev bench: red/blue scrap rug preview (not wired into battle yet). */
  private mountRugTest(): void {
    document.title = 'Scrap rug';
    document.documentElement.classList.add('is-square', 'is-rug-try');
    applyViewportScale();
    const card = (side: 'you' | 'foe', i: number) =>
      `<div class="rug-card is-${side}" style="--i:${i}" aria-hidden="true"><i></i><b>${side === 'you' ? 'YOU' : 'FOE'}</b></div>`;
    this.root.innerHTML = `<div class="rug-test">
      <div class="rug-stage">
        <div class="rug-mat" aria-hidden="true">
          <img class="rug-art" src="./art/ui/scrap-rug-preview.png?v=rug3" alt="" draggable="false" />
        </div>
        <div class="rug-boards">
          <div class="rug-side is-you">${[0, 1, 2, 3].map((i) => card('you', i)).join('')}</div>
          <div class="rug-side is-foe">${[0, 1, 2, 3].map((i) => card('foe', i)).join('')}</div>
        </div>
      </div>
      <p class="rug-caption">Anteprima · 4 tue (rosso) · 4 oppo (blu) · lati smussati, non a punta</p>
    </div>`;
    const stage = this.root.querySelector('.rug-stage');
    window.setTimeout(() => stage?.classList.add('is-unrolled'), 80);
  }

  /** Dev bench: scrap / hunt table field mood boards. */
  private mountScrapFieldsTest(): void {
    document.title = 'Scrap fields';
    document.documentElement.classList.add('is-square', 'is-scrapfields-try');
    applyViewportScale();
    this.root.innerHTML = `<div class="scrapfields-test">
      <p class="scrapfields-title">Campo scrap · stesso legno del market</p>
      <div class="scrapfields-grid">
        <figure class="scrapfields-card">
          <img src="./art/ui/scrap-field-base.jpg?v=sf3" alt="Market wood" draggable="false" />
          <figcaption>Base · legno market (invariato)</figcaption>
        </figure>
        <figure class="scrapfields-card">
          <img src="./art/ui/scrap-field-vs.jpg?v=sf3" alt="VS player" draggable="false" />
          <figcaption>VS player · team chiari (amber / blu)</figcaption>
        </figure>
        <figure class="scrapfields-card">
          <img src="./art/ui/scrap-field-hunt.png?v=huntrovi51" alt="Monster hunt" draggable="false" />
          <figcaption>Monster hunt · tavolo market + rovi</figcaption>
        </figure>
      </div>
      <p class="scrapfields-title"><a href="?try=huntfield">Prova full-bleed hunt + lampi →</a></p>
    </div>`;
  }

  /** Full-bleed hunt table with sample cards so layout vs brambles is clear. */
  private mountHuntFieldProve(): void {
    document.title = 'Hunt field';
    document.documentElement.classList.add('is-huntfield-try', 'is-hunt');
    document.documentElement.classList.remove('is-square', 'is-menu', 'is-battle', 'is-ending', 'is-preamble');
    applyViewportScale();
    this.syncHuntLightning(true);
    const loc = this.settings.locale;
    const you = [
      { instanceId: 'p1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      { instanceId: 'p2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      { instanceId: 'p3', defId: 'puss-in-boots', slot: 3, stickerIds: ['steel-sword'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      { instanceId: 'p4', defId: 'village-fool', slot: 4, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
    ];
    const boss = {
      instanceId: 'hunt-boss',
      defId: 'big-bad-wolf',
      slot: 1,
      stickerIds: [] as string[],
      permanentMods: { atk: 0, hp: 0, speed: 0 },
    };
    this.root.innerHTML = `<section class="screen screen-battle huntfield-prove-board">
      <div class="battle-wrap is-hunt" id="battlefield">
        <div class="battle-line">
          <div class="battle-fit">
            <div class="battle-board">
              <div class="battle-side is-player">
                ${you.map((u) => renderUnitCard(loc, u, { extraClass: 'battle-card is-dealt' })).join('')}
              </div>
              <div class="battle-side is-enemy">
                ${renderUnitCard(loc, boss, { extraClass: 'battle-card is-dealt is-hunt-card' })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
    paintPortraits(this.root);
    const homeChrome = document.getElementById('home-chrome');
    if (homeChrome) homeChrome.hidden = false;
    /* ROUND + candles after DOM paint so chrome sync cannot wipe them. */
    this.syncRunChromeHud();
    requestAnimationFrame(() => {
      this.syncRunChromeHud();
      this.syncFieldSeam();
    });
  }

  /** Straight joint in the gap between the two sides, a little taller than the cards. */
  private syncFieldSeam(): void {
    const seamEl = document.querySelector<HTMLElement>('.field-seam');
    const stage = document.getElementById('stage-fill');
    if (!seamEl || !stage) return;
    if (!document.documentElement.classList.contains('is-hunt')) return;
    const player = this.root.querySelector<HTMLElement>('.battle-side.is-player');
    const enemy = this.root.querySelector<HTMLElement>('.battle-side.is-enemy');
    const card = this.root.querySelector<HTMLElement>('.battle-card, .battle-side .unit-card');
    if (!player || !enemy || !card) return;
    const stageBox = stage.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    const e = enemy.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (c.height < 8 || stageBox.width < 8) return;
    const sideBySide = p.bottom > e.top + 8 && p.top < e.bottom - 8;
    const thick = 7;
    if (sideBySide) {
      const gapMid = p.right <= e.left + 8 ? (p.right + e.left) / 2 : (e.right + p.left) / 2;
      const length = c.height * 1.12;
      seamEl.classList.remove('is-across');
      seamEl.style.left = `${gapMid - thick / 2 - stageBox.left}px`;
      seamEl.style.top = `${c.top + c.height / 2 - length / 2 - stageBox.top}px`;
      seamEl.style.width = `${thick}px`;
      seamEl.style.height = `${length}px`;
      return;
    }
    const gapMid = p.bottom <= e.top + 8 ? (p.bottom + e.top) / 2 : (e.bottom + p.top) / 2;
    const length = Math.max(p.width, e.width) * 1.04;
    const midX = (Math.min(p.left, e.left) + Math.max(p.right, e.right)) / 2;
    seamEl.classList.add('is-across');
    seamEl.style.left = `${midX - length / 2 - stageBox.left}px`;
    seamEl.style.top = `${gapMid - thick / 2 - stageBox.top}px`;
    seamEl.style.width = `${length}px`;
    seamEl.style.height = `${thick}px`;
  }

  private syncHuntLightning(on: boolean): void {
    let flash = document.getElementById('hunt-lightning');
    if (!on) {
      flash?.remove();
      return;
    }
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'hunt-lightning';
      flash.className = 'hunt-lightning';
      flash.setAttribute('aria-hidden', 'true');
      document.body.appendChild(flash);
    }
  }

  /** Static mood board only — no iframes (they freeze the tab). */
  /**
   * Stickers: keep top edges aligned; place the row so the shortest sticker’s
   * bottom sits ≤200px above the team (taller cards hang lower into that band).
   */
  private syncStickerOfferGap(): void {
    const root = document.documentElement;
    const offers = this.root.querySelector<HTMLElement>('.screen-sticker .sticker-shop-offers');
    if (!offers) {
      root.style.removeProperty('--sticker-short-slack');
      root.style.removeProperty('--sticker-offer-h');
      return;
    }
    const apply = () => {
      const cards = [...offers.querySelectorAll<HTMLElement>(':scope > .sticker-card')];
      if (!cards.length) return;
      // offsetHeight is in layout (design) px. getBoundingClientRect is screen px
      // after --ui-scale, which put "Glue sticker" on top of the offers on phone.
      const heights = cards.map((c) => c.offsetHeight);
      const maxH = Math.max(...heights);
      const minH = Math.min(...heights);
      root.style.setProperty('--sticker-short-slack', `${Math.max(0, maxH - minH)}px`);
      root.style.setProperty('--sticker-offer-h', `${maxH}px`);
    };
    apply();
    requestAnimationFrame(apply);
  }

  private mountShopLayoutTest(): void {
    document.title = 'Shop layout';
    document.documentElement.classList.add('is-square', 'is-shoplayout-try');
    applyViewportScale();
    const cases = [
      { src: './art/ui/gap-proof-recruit.jpg?v=g3', label: 'Recruit · figure · gap 100' },
      { src: './art/ui/gap-proof-sticker.jpg?v=g3', label: 'Sticker shop · top-align · ≤200' },
      { src: './art/ui/gap-proof-well.jpg?v=g3', label: 'Well figura · gap 100' },
      { src: './art/ui/gap-proof-oven.jpg?v=g3', label: 'Oven sweet · top-align · ≤200' },
      { src: './art/ui/gap-proof-clone.jpg?v=g3', label: 'Clone figura · gap 100' },
      { src: './art/ui/gap-proof-well-sticker.jpg?v=g3', label: 'Well sticker · top-align · ≤200' },
    ];
    this.root.innerHTML = `<div class="shoplayout-test">
      <p class="shoplayout-title">Prova gap: figure 100px · sticker top-align ≤200px (solo immagini). Book escluso.</p>
      <div class="shoplayout-grid">
        ${cases
          .map(
            (c) => `<figure class="shoplayout-card">
          <img src="${c.src}" alt="${c.label}" draggable="false" />
          <figcaption>${c.label}</figcaption>
        </figure>`,
          )
          .join('')}
      </div>
    </div>`;
  }

  /** Well after sacrifice: 1 figure to seat (same recruit offer row). */
  private wellRewardTryRun(): RunState {
    return {
      ...this.marketTryRun(),
      runId: 'run-well-reward',
      phase: 'recruit',
      eventId: 'wishing-well',
      eventStep: 'reward',
      recruitOffers: ['tin-soldier'],
      recruitPicks: [],
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  /** Oven after eating: pick 1 of 3 sweets on the sticker assign row. */
  private ovenRewardTryRun(): RunState {
    return {
      ...this.marketTryRun(),
      runId: 'run-oven-reward',
      phase: 'stickerAssign',
      eventId: 'witch-oven',
      eventStep: 'reward',
      pendingStickerIds: ['health-sweet:6', 'attack-sweet:2', 'speed-sweet:5'],
      stickerPickCount: 1,
      stickerOffers: [],
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  /** Clone after picking a figure: 1 clone card to seat. */
  private cloneRewardTryRun(): RunState {
    return {
      ...this.marketTryRun(),
      runId: 'run-clone-reward',
      phase: 'event',
      eventId: 'cloning-chamber',
      eventStep: 'reward-unit',
      eventOffers: [
        JSON.stringify({
          defId: 'hunter',
          stickerIds: [],
          permanentMods: { atk: 0, hp: 0, speed: 0 },
        }),
      ],
      eventPicks: [],
      pendingStickerIds: [],
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  /** Well sticker path: 1 upgraded sticker to glue. */
  private wellStickerRewardTryRun(): RunState {
    return {
      ...this.marketTryRun(),
      runId: 'run-well-sticker-reward',
      phase: 'stickerAssign',
      eventId: 'wishing-well',
      eventStep: 'reward',
      pendingStickerIds: ['steel-sword'],
      stickerPickCount: 1,
      stickerOffers: [],
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  private candleHolderKind(): 'none' | 'nuvoletta' | 'candeliere' {
    const q = new URLSearchParams(location.search).get('try');
    if (q === 'candeliere') return 'candeliere';
    if (q === 'twozone' || q === 'fight') return 'none';
    return 'none';
  }

  private candlesMarkup(lit: number): string {
    const n = Math.max(0, Math.min(STARTING_CANDLES, Math.floor(lit)));
    const flames = Array.from({ length: STARTING_CANDLES }, (_, i) => {
      const on = i < n;
      return `<span class="candle${on ? ' is-lit' : ' is-out'}" data-candle="${i}" aria-hidden="true">
        <img class="candle-body" src="./art/ui/candle-body.png?v=candle43" alt="" draggable="false" />
        <span class="candle-flame" aria-hidden="true"><img src="./art/ui/candle-flame-sheet.png?v=candle43" alt="" draggable="false" /></span>
        <span class="candle-smoke" aria-hidden="true"><img src="./art/ui/candle-smoke-sheet.png?v=candle43" alt="" draggable="false" /></span>
      </span>`;
    }).join('');
    const holder = this.candleHolderKind();
    const row = `<span class="candle-row">${flames}</span>`;
    const inner =
      holder === 'candeliere'
        ? `<img class="candle-candeliere" src="./art/ui/candle-candeliere.png?v=candel1" alt="" draggable="false" />${row}`
        : holder === 'nuvoletta'
          ? `<img class="candle-nuvoletta" src="./art/ui/candle-nuvoletta.png?v=nube3" alt="" draggable="false" />${row}`
          : `<span class="candle-hole"><img class="candle-void" src="./art/ui/candle-smoke-void.png?v=smoke10" alt="" draggable="false" />${row}</span><img class="candle-scribble" src="./art/ui/candle-smoke-rim.png?v=smoke10" alt="" draggable="false" />`;
    return `<span class="line-candles rule-tip" data-holder="${holder}" aria-expanded="false" aria-label="${this.L('candles')} ${n}/${STARTING_CANDLES}"><span class="candle-hud">${inner}</span><span class="targeting-tip" role="tooltip">${this.L('candlesTip')}</span></span>`;
  }

  private recruitCandlesHtml(candles = STARTING_CANDLES): string {
    return `<span class="recruit-candles">${this.candlesMarkup(candles)}</span>`;
  }

  /** Ink seal + round number only. Hidden on menu and on the result. */
  private syncRoundDie(round: number | null): void {
    const hud = document.getElementById('round-hud');
    const num = document.getElementById('round-hud-num');
    if (!hud) return;
    if (round == null || !Number.isFinite(round)) {
      hud.hidden = true;
      hud.setAttribute('aria-hidden', 'true');
      hud.removeAttribute('aria-label');
      if (num) {
        num.textContent = '';
        num.className = 'round-hud-num';
      }
      return;
    }
    const n = Math.max(1, Math.floor(round));
    const digits = String(n);
    if (num) {
      num.textContent = digits;
      // Optical classes: 6/8 sit high in Georgia; two-digit rounds shrink a hair.
      num.className = 'round-hud-num';
      if (digits.length >= 2) num.classList.add('is-wide');
      else if (n === 2) num.classList.add('is-digit-2');
      else if (n === 6) num.classList.add('is-digit-6');
      else if (n === 8) num.classList.add('is-digit-8');
    }
    hud.dataset.round = digits;
    hud.hidden = false;
    hud.setAttribute('aria-hidden', 'false');
    hud.setAttribute('aria-label', `${this.L('round')} ${n}`);
  }

  /** Candles above the scene veil — same visibility rules as the round stamp. */
  private syncCandleHud(lit: number | null): void {
    const host = document.getElementById('run-candle-hud');
    if (!host) return;
    if (lit == null || !Number.isFinite(lit)) {
      host.hidden = true;
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
      return;
    }
    const n = Math.max(0, Math.min(STARTING_CANDLES, Math.floor(lit)));
    const prev = host.querySelector<HTMLElement>('.line-candles');
    const prevN = prev ? prev.querySelectorAll('.candle.is-lit, .candle.is-snuffing').length : -1;
    // Keep the live DOM while a flame is dying, and skip no-op remounts.
    if (prev && (prev.querySelector('.is-snuffing') || prevN === n)) {
      host.hidden = false;
      host.setAttribute('aria-hidden', 'false');
      return;
    }
    host.innerHTML = this.recruitCandlesHtml(n);
    host.hidden = false;
    host.setAttribute('aria-hidden', 'false');
  }

  private syncRunChromeHud(): void {
    /* Hunt-field art prove: keep ROUND + candles up even without a live run. */
    if (document.documentElement.classList.contains('is-huntfield-try')) {
      this.syncRoundDie(5);
      this.syncCandleHud(2);
      return;
    }
    const endingOn = Boolean(this.root.querySelector('.ending-cast, .screen-ending'));
    const inRun = Boolean(this.run) && (this.screen === 'run' || this.screen === 'battle') && !endingOn;
    // Visible through the whole run (incl. result + fades). Hidden only off-game / ending.
    const hide = !inRun || this.run?.phase === 'final';
    this.syncRoundDie(hide ? null : this.run!.round);
    if (hide) {
      this.syncCandleHud(null);
      return;
    }
    const lit =
      this.screen === 'battle' ? this.candlesDuringBattle() : candlesOf(this.run!);
    this.syncCandleHud(lit);
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

  private fightArtButton(act = 'fight', extraClass = ''): string {
    const ready = this.isFightReady();
    const alleyDone = this.isAlleyFightReady();
    const label = alleyDone ? `${this.L('fightBang')} ${ALLEY_PICK}/${ALLEY_PICK}` : this.L('fightBang');
    return `<button type="button" class="btn-fight-art${ready ? ' is-fight-ready' : ''}${extraClass}" data-act="${act}" draggable="false" aria-label="${label}">
      <img src="./art/ui/btn-fight.png?v=fight-nobrown1" alt="${label}" draggable="false" />
    </button>`;
  }

  /** Fight buzzes when the only move left is rearrange + Fight. */
  private isFightReady(): boolean {
    return this.isAlleyFightReady() || this.isDraftFightReady();
  }

  /** Opening recruit: both starters seated — only rearrange + Fight left. */
  private isDraftFightReady(): boolean {
    return Boolean(this.run?.phase === 'draft' && this.run.draftPicks.length >= DRAFT_PICK);
  }

  /** Market Square: both alley stops done — plates gray, only rearrange + Fight left. */
  private isAlleyFightReady(): boolean {
    return Boolean(this.run?.phase === 'postFight' && (this.run.alleyDone?.length ?? 0) >= ALLEY_PICK);
  }

  private alleyPassButton(act: string, extraClass = ''): string {
    return `<button type="button" class="${this.shopPassClass(extraClass)}" data-act="${act}">${this.L('skipRecruit')}</button>`;
  }

  private eventSkipButton(empty = false): string {
    return `<button type="button" class="btn ghost" data-act="skip-event">${empty ? this.L('eventContinue') : this.L('skipRecruit')}</button>`;
  }

  private syncShopPassReady(): void {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-act="skip-recruit"], [data-act="skip-sticker"]');
    if (!btn || btn.classList.contains('btn-fight-art')) return;
    btn.classList.toggle('is-shop-ready', this.shopPicksDone());
  }

  private clearShopHold(): void {
    window.clearTimeout(this.shopHoldTimer);
    this.shopHoldTimer = 0;
  }

  private scheduleShopClose(holdMs = 500): void {
    if (this.run?.phase === 'draft') return;
    if (this.run && isOpeningStickerGift(this.run)) return;
    if (!this.shopPicksDone()) return;
    this.shopBusy = true;
    this.clearShopHold();
    this.shopHoldTimer = window.setTimeout(() => {
      void this.closeFinishedShop();
    }, holdMs);
  }

  private flashSignedSlot(slot: number): void {
    const root = this.recruitTeamRoot() ?? this.root.querySelector('.team-table');
    const card =
      root?.querySelector<HTMLElement>(`.team-slot[data-slot="${slot}"] .unit-card[data-instance]`) ??
      root?.querySelector<HTMLElement>(`.unit-card[data-instance][data-slot="${slot}"]`);
    if (!card) return;
    card.classList.remove('is-just-signed');
    void card.offsetWidth;
    card.classList.add('is-just-signed');
  }

  /** Keep the shop/event up so the swap is visible, then leave to square or scrap. */
  private showSwapThenContinue(slot: number, next: RunState): void {
    this.shopBusy = true;
    this.recruitReplace = null;
    this.clearShopHold();
    const teamRoot = this.recruitTeamRoot();
    if (teamRoot) {
      teamRoot.innerHTML = renderTeamLane(this.settings.locale, next.team, {
        showEmpty: true,
        ...this.runStatCtx(),
      });
      requestAnimationFrame(() => {
        fitCardSlabs(teamRoot);
        this.flashSignedSlot(slot);
      });
    }
    this.shopHoldTimer = window.setTimeout(() => {
      this.shopBusy = false;
      this.run = next;
      this.persistAndRender();
    }, 500);
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
    if (pass && !pass.classList.contains('btn-fight-art')) pass.className = this.shopPassClass(' sticker-throw-away');
    this.bindStickerShopGestures({ offers: false });
    if (this.canRearrangeTeam()) this.setupFormationDrag();
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

  /** After the result, the arena sinks into black, then the square is painted. */
  private async fadeArenaToSquare(): Promise<void> {
    const ticket = ++this.fadeTicket;
    await fadeOutScene(SCRAP_COVER_MS);
    if (ticket !== this.fadeTicket) return;
    cancelAnimationFrame(this.raf);
    this.paintScreen();
    revealScene(this.viewKey(), SCRAP_REVEAL_MS);
  }

  /** Fight: cover the square, open onto the field, wait until it is fully visible, then deal. */
  private async fadeSquareToArena(): Promise<void> {
    const ticket = ++this.fadeTicket;
    await fadeOutScene(SCRAP_COVER_MS);
    if (ticket !== this.fadeTicket) return;
    this.dossierDefId = null;
    this.screen = 'battle';
    this.paintScreen();
    await revealScene(this.viewKey(), SCRAP_REVEAL_MS);
    if (ticket !== this.fadeTicket) return;
    this.battleView?.beginScrap();
  }

  /** Cover the screen that is still up, then paint the next one and uncover it. */
  private async crossfadeRender(): Promise<void> {
    const ticket = ++this.fadeTicket;
    if (this.screen !== 'battle') cancelAnimationFrame(this.raf);
    await fadeOutScene();
    if (ticket !== this.fadeTicket) return;
    this.paintScreen();
    revealScene(this.viewKey());
  }

  private render(): void {
    if (this.shouldAutoHuntFight()) {
      void this.launchHuntFight();
      return;
    }
    const page = this.viewKey();
    if (willChangeScene(page)) {
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

  /** Phone tap, or desktop right-click on a figure: inspect overlay. Stickers on PC stay as they are. */
  private cardInspect(): boolean {
    return this.phonePlay() || window.matchMedia('(pointer: fine)').matches;
  }

  private zoomableCard(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    if (target.closest('.card-zoom, .dossier-overlay, input, a')) return null;
    // HUD / menu actions — not a card face under a control.
    const act = target.closest<HTMLElement>('[data-act]');
    if (act && !act.closest('.unit-card, .sticker-card')) return null;
    const inspect = this.cardInspect();
    if (!inspect && target.closest('.rule-tip, button')) return null;
    const unit = target.closest<HTMLElement>('.unit-card');
    if (unit && !unit.classList.contains('is-empty') && !unit.classList.contains('team-slot-empty')) {
      return unit;
    }
    const sticker = target.closest<HTMLElement>('.sticker-card');
    if (!sticker) return null;
    // Stickers: phone tap-zoom only. Desktop keeps the text on the card.
    if (!this.phonePlay()) return null;
    return sticker;
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
        killTally: (() => {
          const n = card.querySelector('[data-kill-left]')?.textContent?.trim();
          const need = killsLeftOnCard(defId, 0);
          if (n != null && n !== '' && need != null) return Math.max(0, need - Number(n));
          return saved?.killTally;
        })(),
      },
      {
        ...this.runStatCtx(),
        extraClass: card.classList.contains('is-silenced') ? 'is-silenced' : undefined,
        rewindLeft: (() => {
          const n = card.querySelector('[data-rewind-left]')?.textContent?.trim();
          return n != null && n !== '' ? Number(n) : undefined;
        })(),
      },
    );
  }

  /** Zoom rebuilds the face; keep Once-stickers gray with the same red cross. */
  private copySpentStickers(from: HTMLElement, to: HTMLElement): void {
    const src = [...from.querySelectorAll<HTMLElement>(':scope > .sticker-rail .sticker-slot')];
    const dst = [...to.querySelectorAll<HTMLElement>(':scope > .sticker-rail .sticker-slot')];
    for (let i = 0; i < dst.length; i++) {
      const a = src[i];
      const b = dst[i];
      if (!a || !b) continue;
      if (a.classList.contains('is-spent') || a.classList.contains('is-graying')) {
        b.classList.add('is-spent', 'is-spent-still');
      }
    }
  }

  private openCardZoom(card: HTMLElement): void {
    if (!this.cardInspect()) return;
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
    this.copySpentStickers(card, face);
    // Table-sized face first so ability fits the parchment; then scale the whole card.
    if (face.classList.contains('unit-card')) face.style.width = 'var(--card-w)';
    else face.style.width = '240px';
    overlay.append(scrim, stage);
    const shut = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeCardZoom();
    };
    scrim.addEventListener('pointerdown', shut);
    stage.addEventListener('pointerdown', (e) => {
      const hit = e.target instanceof Element ? e.target : null;
      if (hit?.closest('.rule-tip, .form-peek')) return;
      shut(e);
    });
    document.body.appendChild(overlay);
    this.root.querySelectorAll('.battle-card.is-held').forEach((el) => el.classList.remove('is-held'));
    fitCardSlabs(stage);
    bindTargetingTips(stage, () => this.settings.locale);
    const floats = document.querySelectorAll<HTMLElement>('.targeting-float');
    this.zoomFloat = floats[floats.length - 1] ?? null;
    this.zoomFloat?.classList.add('zoom-float');
    const naturalW = face.offsetWidth || 248;
    const naturalH = face.offsetHeight || 376;
    // Desktop inspect is half the old fill. Phone tap nearly fills the screen (bigger than the table card).
    const fill = Math.min((window.innerWidth - 40) / naturalW, (window.innerHeight - 32) / naturalH);
    const scale = this.phonePlay() ? fill * 0.92 : fill * 0.5;
    face.style.transformOrigin = 'top left';
    face.style.transform = `scale(${scale})`;
    stage.style.width = `${naturalW * scale}px`;
    stage.style.height = `${naturalH * scale}px`;
    this.cardZoom = overlay;
    if (this.screen === 'battle' && this.battleView) {
      this.battleView.setPaused(true);
      this.zoomPaused = true;
    }
  }

  private closeCardZoom(): void {
    this.zoomFloat?.remove();
    this.zoomFloat = null;
    this.cardZoom?.remove();
    this.cardZoom = null;
    if (!this.zoomPaused) return;
    this.zoomPaused = false;
    this.battleView?.setPaused(false);
  }

  private paintScreen(): void {
    if (document.documentElement.classList.contains('is-huntfield-try')) {
      this.syncRunChromeHud();
      this.syncHuntLightning(true);
      return;
    }
    this.closeCardZoom();
    this.stopMenu?.();
    this.stopMenu = null;
    if (this.screen !== 'battle') cancelAnimationFrame(this.raf);
    audio.setVolumes(this.settings.music, this.settings.sfx, this.settings.ui);
    document.title = this.tryTitle() ?? (this.isWidowTry() || this.isWidowCardTry() ? 'Widow' : null) ?? (this.isHuntCardsTry() ? 'Hunt cards' : null) ?? (this.isWoodsmanTry() ? 'Woodsman' : null) ?? (this.isFilthTry() ? 'Filth' : null) ?? (this.isScrapTry() ? 'Scrap' : null) ?? (this.isAmbushTry() ? 'Ambush' : null) ?? (this.isTaleTry() ? 'Tale' : null) ?? (this.isSilenceTry() ? 'Silence' : null) ?? (this.isNegVpTry() ? 'Neg VP' : null) ?? (this.isMarketTry() ? 'Market' : null) ?? (this.isGiftTry() ? 'Gift' : null) ?? (this.isCandeliereTry() ? 'Candeliere' : null) ?? (this.isTwoZoneTry() ? 'Two-zone table' : null) ?? (this.isPaperTry() ? 'Paper base' : null) ?? (this.isFightTry() ? 'Fight' : null) ?? (this.isHeraldTry() ? 'Herald' : null) ?? (this.isEndingTry() || this.isEndingFilmTry() ? 'Ending' : null) ?? this.L('title');
    document.documentElement.classList.toggle('is-twozone', this.isTwoZoneTry());
    const paperOn = this.isPaperBaseOn();
    document.documentElement.classList.toggle('is-paper-base', paperOn);
    const paperCorners = document.getElementById('paper-corners');
    if (paperCorners) {
      paperCorners.hidden = !paperOn;
      paperCorners.setAttribute('aria-hidden', paperOn ? 'false' : 'true');
    }
    const huntfieldTry = document.documentElement.classList.contains('is-huntfield-try');
    const huntFight = huntfieldTry || (this.screen === 'battle' && this.isHuntBattle());
    document.documentElement.classList.toggle('is-menu', !huntfieldTry && this.screen === 'menu');
    document.documentElement.classList.toggle('is-battle', this.screen === 'battle' && !huntFight);
    document.documentElement.classList.toggle('is-hunt', huntFight);
    document.documentElement.classList.toggle('is-square', this.screen === 'run');
    document.documentElement.classList.toggle('is-ending', false);
    document.documentElement.classList.toggle('is-codex', this.screen === 'codex');
    document.documentElement.classList.toggle('is-preamble', this.screen === 'battle');
    applyViewportScale();
    // Only mute during the hunt event screen itself — not the whole market round
    // just because this alley rolled monster-hunt (that left the square silent).
    const huntQuiet =
      this.screen === 'run' &&
      this.run?.eventId === 'monster-hunt' &&
      this.run.phase === 'event';
    const curtainHold = this.screen === 'battle' && !this.battleFieldUp;
    if (curtainHold) {
      /* Square music is already fading. Fight/hunt starts when the field appears. */
    } else if (huntQuiet) audio.fadeOut();
    else audio.setCue(this.musicCue());
    switch (this.screen) {
      case 'menu':
        this.root.innerHTML = this.menuHtml();
        paintPortraits(this.root);
        break;
      case 'run':
        if (this.run?.eventId === 'monster-hunt' && this.run.eventStep === 'hunt-result') {
          this.run = claimHunt(this.run);
          void this.persist();
        }
        if (this.run?.phase === 'result') {
          this.run = afterResult(this.run);
          void this.persist();
        }
        this.root.innerHTML = this.runHtml();
        if (this.ovenShopEnter) {
          this.root.querySelector('.screen')?.classList.add('is-oven-enter');
          this.ovenShopEnter = false;
        }
        paintPortraits(this.root);
        this.syncStickerOfferGap();
        this.bindRunGestures();
        if (this.run?.phase === 'final' && !this.deferTaleCoda) {
          const cast = this.root.querySelector<HTMLElement>('.ending-cast');
          void this.beginTaleCoda(cast);
        }
        break;
      case 'battle':
        // Every scrap starts at 1×; the arrow can bump to 2× mid-fight.
        this.settings.battleSpeed = 1;
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
    const endingOn = Boolean(this.root.querySelector('.ending-cast'));
    document.documentElement.classList.toggle('is-ending', endingOn);
    document.documentElement.classList.toggle('is-square', this.screen === 'run' && !endingOn);
    if (endingOn) document.documentElement.classList.remove('is-battle', 'is-hunt', 'is-preamble');
    const onMenu = this.screen === 'menu';
    const chromeOk = !endingOn && this.screen !== 'codex';
    const homeChrome = document.getElementById('home-chrome');
    if (homeChrome) homeChrome.hidden = !chromeOk;
    if (!chromeOk) this.setHomeChromeMenu(false);
    const creditsBtn = document.getElementById('credits-stamp');
    const creditsPanel = document.getElementById('credits-panel');
    const creditsCopy = document.getElementById('credits-copy');
    if (creditsCopy) creditsCopy.textContent = this.L('audioNote');
    if (creditsBtn) {
      creditsBtn.textContent = this.L('credits');
      creditsBtn.hidden = !onMenu;
    }
    const exitStamp = document.getElementById('exit-stamp');
    if (exitStamp) {
      exitStamp.textContent = this.L('exit');
      exitStamp.hidden = endingOn;
    }
    if (creditsPanel && !onMenu) creditsPanel.hidden = true;
    this.syncRunChromeHud();
    this.syncHuntLightning(
      document.documentElement.classList.contains('is-hunt') ||
        document.documentElement.classList.contains('is-huntfield-try'),
    );
    const langStamp = document.querySelector('.lang-stamp');
    if (langStamp) {
      langStamp.setAttribute('aria-label', this.L('language'));
      for (const btn of langStamp.querySelectorAll<HTMLButtonElement>('.lang-btn')) {
        const loc = btn.dataset.locale;
        const on = loc === this.settings.locale;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (loc === 'en') btn.textContent = this.L('langEnglish');
        if (loc === 'it') btn.textContent = this.L('langItalian');
      }
    }
    const menuStamp = document.getElementById('menu-stamp');
    if (menuStamp) {
      menuStamp.textContent = this.L('quitToMenu');
      menuStamp.hidden = onMenu || endingOn;
    }
    const gear = document.getElementById('options-gear');
    if (gear) gear.setAttribute('aria-label', this.L('options'));
    this.syncDevSkipChrome();
    requestAnimationFrame(() => {
      this.layoutFightSeal();
      this.syncFieldSeam();
      requestAnimationFrame(() => {
        this.layoutFightSeal();
        this.syncFieldSeam();
      });
      const cast = this.root.querySelector<HTMLElement>('.ending-cast');
      if (cast) this.layoutEndingTale(cast);
    });
  }

  /** Center Fight in the gap between slot 1 and the outer screen edge. */
  private layoutFightSeal(): void {
    const btn = this.root.querySelector<HTMLElement>('.btn-fight-art');
    const screen = this.root.querySelector<HTMLElement>('.screen');
    const slot =
      this.root.querySelector<HTMLElement>('.team-table .team-slot[data-slot="1"]') ??
      this.root.querySelector<HTMLElement>('.team-table [data-slot="1"]');
    if (!btn || !screen || !slot) return;
    const host = btn.closest<HTMLElement>('.recruit-actions, .team-actions') ?? btn;
    host.style.left = '';
    host.style.right = '';
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const screenBox = screen.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    if (slotBox.width < 8 || hostBox.width < 8) return;
    const center = (slotBox.right + screenBox.right) / 2;
    const left = (center - hostBox.width / 2 - screenBox.left) / scale + 10;
    host.style.left = `${Math.max(0, left)}px`;
    host.style.right = 'auto';
    const market = screen.classList.contains('screen-choice');
    host.style.transform = market ? 'translateY(-5px)' : 'translateY(-15px)';
  }

  private layoutEndingTale(root: HTMLElement): void {
    const row = root.querySelector<HTMLElement>('.ending-cast .battle-end-row, .battle-end-row');
    if (!row) return;
    row.style.top = '';
    row.style.left = '';
    row.style.transform = '';
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
        </div>
      </section>`;
  }

  private runHtml(): string {
    if (this.run?.phase === 'postFight') {
      const ready = ensureAlleyEvent(this.run);
      if (ready !== this.run) {
        this.run = ready;
        void this.persist();
      }
    }
    const run = this.run!;
    if (run.phase !== 'sticker' && run.phase !== 'stickerAssign') this.clearSpentOffers();
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    if (run.phase === 'draft') {
      return `
        <section class="screen screen-recruit">
          <div class="hud recruit-hud">
            ${this.recruitCandlesHtml(candlesOf(run))}
          </div>
          <p class="hint sticker-shop-hint${this.pickHintClass(run.draftPicks.length)}">${this.recruitCountHint(run.draftPicks.length, DRAFT_PICK)}</p>
          <div class="recruit-shop-offers grid5">${run.draftOffers
            .map((id) => renderOfferCard(loc, id, false, '', stats))
            .join('')}</div>
          <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, { showEmpty: true, ...stats })}</div>
          <div class="row recruit-actions">
            ${this.fightArtButton()}
          </div>
        </section>`;
    }
    if (run.phase === 'postFight') {
      const rarity = shopMaxRarity(run.round);
      const done = run.alleyDone ?? [];
      const ev = run.eventId ? EVENT_BY_ID.get(run.eventId) : undefined;
      const plate = (id: AlleyChoice, art: string, title: string, desc: string, opts?: { extraClass?: string; rarity?: string }) => {
        const alleyFull = done.length >= ALLEY_PICK;
        const used = done.includes(id) || alleyFull;
        const rar = opts?.rarity ?? rarity;
        const extra = opts?.extraClass ? ` ${opts.extraClass}` : '';
        const hunt = Boolean(opts?.extraClass?.includes('is-hunt-plate'));
        const hideRarity = Boolean(opts?.extraClass?.includes('is-event-plain'));
        const shopGem = id === 'recruit' || id === 'sticker' || Boolean(opts?.extraClass?.includes('is-alley-hunt-cutout'));
        const liftTextbox = id === 'event' && !opts?.extraClass?.includes('is-alley-hunt-cutout');
        const mark = shopGem
          ? `<img class="shop-gem" src="./art/ui/shop-gem-${rar}.png?v=gem2" alt="" draggable="false" />`
          : hunt && !hideRarity && !opts?.extraClass?.includes('printed-card')
            ? `<img class="hunt-rarity" src="./art/ui/rarity-corner-${rar}.png?v=gem1" alt="" draggable="false" /><div class="rarity-mark"><img src="./art/ui/rarity-${rar}.png?v=metal" alt="" draggable="false" /></div>`
            : '';
        return `<button type="button" class="unit-card rarity-${rar} choice-plate is-${id}${extra}${used ? ' is-done' : ''}" data-act="alley-${id}" ${used ? 'disabled' : ''}>
          <div class="card-art">
            <img class="portrait-art scenic" src="${art}" alt="" draggable="false" />
          </div>
          ${liftTextbox ? `<img class="event-textbox" src="${art}" alt="" draggable="false" />` : ''}
          ${mark}
          <div class="card-slab">
            <h3 class="card-name">${title}</h3>
            <div class="ability"><p class="ability-rule">${desc}</p></div>
          </div>
        </button>`;
      };
      const eventPlateHtml = (() => {
        const title = ev ? this.L(ev.nameKey) : '';
        const desc = ev ? this.L(ev.descKey) : '';
        const full = { extraClass: 'is-event-plain is-alley-full-plate' as const };
        if (run.eventId === 'monster-hunt' && run.huntMonsterId) {
          return plate(
            'event',
            `./art/ui/plate-hunt-${run.huntMonsterId}.png?v=restore1`,
            title,
            desc,
            {
              extraClass: 'is-event-plain is-alley-full-plate is-alley-hunt-cutout',
              rarity: HUNT_MONSTERS.find((m) => m.unitId === run.huntMonsterId)?.rarity,
            },
          );
        }
        const art =
          run.eventId === 'witch-oven' ? './art/ui/plate-witch-oven.png?v=restore1'
          : run.eventId === 'wishing-well' ? './art/ui/plate-wishing-well.png?v=restore1'
          : run.eventId === 'cloning-chamber' ? './art/ui/plate-cloning-chamber.png?v=restore1'
          : run.eventId === 'book-of-lost-tales' ? './art/ui/plate-book-of-lost-tales.png?v=restore1'
          : '';
        if (!art || !ev) return '';
        return plate('event', art, title, desc, full);
      })();
      const alleyFull = done.length >= ALLEY_PICK;
      const hint = alleyFull
        ? `${this.L('fightBang')} <b class="recruit-count">${ALLEY_PICK}/${ALLEY_PICK}</b>`
        : done.length > 0
          ? this.L('alleyHintNext')
          : this.L('alleyHintLead');
      return `
        <section class="screen screen-choice has-line">
          <div class="hud recruit-hud">
            ${this.recruitCandlesHtml(candlesOf(run))}
          </div>
          <p class="hint sticker-shop-hint">${
            alleyFull ? hint : `${hint} <b class="recruit-count">${done.length}/${ALLEY_PICK}</b>`
          }</p>
          <div class="choice-table">
            ${plate('recruit', './art/ui/plate-recruit.png?v=restore1', this.L('alleyRecruit'), this.L('alleyRecruitD'), {
              extraClass: 'is-event-plain is-alley-full-plate',
            })}
            ${plate('sticker', './art/ui/plate-sticker.png?v=restore1', this.L('alleySticker'), this.L('alleyStickerD'), {
              extraClass: 'is-event-plain is-alley-full-plate',
              rarity: stickerMaxRarity(run.round),
            })}
            ${eventPlateHtml}
          </div>
          <div class="grid5 team-table" id="lineup">${renderTeamLane(loc, run.team, { showEmpty: true, ...stats })}</div>
          <div class="row recruit-actions">
            ${this.fightArtButton()}
          </div>
        </section>`;
    }
    if (run.phase === 'event') {
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
        : run.phase === 'stickerAssign' && run.eventId === 'witch-oven'
          ? this.L('ovenChoose')
        : run.phase === 'stickerAssign' && run.eventId
          ? this.L('eventRewardSticker')
          : this.L('stickOneHint');
      return `
        <section class="screen screen-sticker${run.eventId && run.eventStep ? ' is-event-title' : ''}">
          <div class="hud recruit-hud">
            ${this.recruitCandlesHtml(candlesOf(run))}
          </div>
          <p class="hint sticker-shop-hint">${hint}</p>
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
          ${
            isOpeningStickerGift(run)
              ? this.fightArtButton()
              : this.alleyPassButton('skip-sticker', ' sticker-throw-away')
          }
        </section>`;
    }
    if (run.phase === 'recruit') {
      const limit = recruitPickLimit(run.recruitPicks, run.eventId, run.eventStep);
      const hint = this.recruitReplace ? this.L('recruitReplaceHint') : this.L('recruitHint');
      const replacing = Boolean(this.recruitReplace);
      return `
        <section class="screen screen-recruit${replacing ? ' is-replacing' : ''}">
          <div class="hud recruit-hud">
            ${this.recruitCandlesHtml(candlesOf(run))}
          </div>
          <p class="hint sticker-shop-hint${replacing ? '' : this.pickHintClass(run.recruitPicks.length)}">${replacing ? hint : this.recruitCountHint(run.recruitPicks.length, limit)}</p>
          <div class="recruit-shop-offers grid5">${this.recruitOfferIds(run)
            .map((id) => renderOfferCard(loc, id, this.recruitReplace?.defId === id, '', stats))
            .join('')}</div>
          <div class="recruit-shop-team grid5 team-table">${renderTeamLane(loc, run.team, {
            showEmpty: true,
            ...stats,
            cardOpts: (u) => ({
              extraClass: replacing ? 'is-replace-pick' : '',
            }),
          })}</div>
          <div class="row recruit-actions">
            ${
              replacing && !this.recruitReplace?.gold
                ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
                : replacing
                  ? ''
                  : this.alleyPassButton('skip-recruit')
            }
          </div>
        </section>`;
    }
    if (run.phase === 'result') {
      return `
        <section class="screen screen-result">
          <p class="result-wins">${this.L('wins')} ${run.wins}${this.L('of10')}</p>
          <div class="grid5 result-team team-table">${renderTeamLane(loc, run.team, stats)}</div>
          <button class="btn result-next" data-act="after-result">${this.L('next')}</button>
        </section>`;
    }
    if (run.phase === 'final') {
      // Night over: team + "Your Tale ends in…" — never the old standings sheet.
      return this.endingCastHtml();
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
      <section class="screen screen-choice has-line">
        <div class="hud recruit-hud">
          ${this.recruitCandlesHtml(candlesOf(run))}
        </div>
        <div class="grid5 team-table" id="lineup">${renderTeamLane(loc, run.team, {
          ...stats,
          showEmpty: true,
        })}</div>
        <div class="row recruit-actions">
          ${this.fightArtButton()}
        </div>
      </section>`;
  }

  private wellHtml(): string {
    const run = this.run!;
    const loc = this.settings.locale;
    const stats = this.runStatCtx();
    const empty = eventIsBlocked(run);
    const replacing = Boolean(this.recruitReplace);
    const hint = replacing ? this.L('recruitReplaceHint') : this.L('wellPick');
    const kindOffers = `<div class="well-object" data-well-drop="1" aria-label="${this.L('wellTitle')}">
          <img class="well-shut" src="./art/ui/event-wishing-well-object.png?v=wellfresh1" alt="" draggable="false" />
          <img class="well-open" src="./art/ui/event-wishing-well-open-object.png?v=wellsplash8" alt="" draggable="false" />
          <img class="well-fed" src="./art/ui/event-wishing-well-fed-object.png?v=wellframe4" alt="" draggable="false" />
        </div>`;

    return `
      <section class="screen screen-recruit screen-well${replacing ? ' is-replacing' : ''}">
        <div class="hud recruit-hud">
          ${this.recruitCandlesHtml(candlesOf(run))}
          <p class="hint sticker-shop-hint">${hint}</p>
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
              : this.eventSkipButton(empty)
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
          ${this.recruitCandlesHtml(candlesOf(run))}
          <p class="hint sticker-shop-hint">${hint}</p>
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
              : this.eventSkipButton(empty)
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
          ${this.recruitCandlesHtml(candlesOf(run))}
          <p class="hint sticker-shop-hint">${hint}</p>
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
                ? this.alleyPassButton('throw-event-reward', ' sticker-throw-away')
                : this.eventSkipButton(empty)
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
          ${this.recruitCandlesHtml(candlesOf(run))}
          <p class="hint sticker-shop-hint">${stickerReplace ? this.L('replaceHint') : replacing ? this.L('recruitReplaceHint') : this.L('bookPick')}</p>
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
              : this.eventSkipButton()
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
          <div class="hud recruit-hud">
            ${this.recruitCandlesHtml(candlesOf(run))}
            <span class="event-cat ${ev?.category ?? ''}">${cat}</span>
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
                : this.alleyPassButton('throw-event-reward', ' sticker-throw-away')
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
        <div class="hud recruit-hud">
          ${this.recruitCandlesHtml(candlesOf(run))}
          <span class="event-cat ${ev?.category ?? ''}">${cat}${
            run.eventId === 'book-of-lost-tales' ? ` · ${this.L(rewardRarity)}` : ''
          }</span>
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
        ${showBoss ? `<div class="grid5 event-boss">${renderUnitCard(loc, { instanceId: huntId!, defId: huntId!, slot: 1, stickerIds: barePrintedSummon(huntId!) ? [] : [huntStickerFor(huntId!)].filter((id): id is string => Boolean(id)), permanentMods: { atk: 0, hp: 0, speed: 0 } }, { extraClass: 'offer is-hunt-plate', ...stats })}</div>` : ''}
        ${
          showOvenSticker
            ? `<div class="row event-oven-tray">${renderStickerCard(loc, run.pendingStickerIds[0]!, false)}</div>`
            : ''
        }
        ${
          showTeam
            ? `<div class="grid5 team-table">${renderTeamLane(loc, run.team, {
                showEmpty: true,
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
          ${canSkip ? this.eventSkipButton(empty) : ''}
        </div>
      </section>`;
  }

  private isHuntBattle(): boolean {
    return this.run?.lastBattle?.snapshots.b.playerId === 'monster-hunt';
  }

  private musicCue(): MusicCue {
    if (this.run?.phase === 'final') return 'final';
    if (this.screen === 'battle' && this.battleFieldUp && this.isHuntBattle()) return 'hunt';
    if (this.screen === 'battle' && this.battleFieldUp) return 'fight';
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

  /** Candles while the scrap is playing: count before this fight's snuff. */
  private candlesDuringBattle(): number {
    return scrapCandles(this.run!);
  }

  private battleHtml(): string {
    const run = this.run!;
    const foeName = this.battleFoeName();
    const hunt = this.isHuntBattle() ? ' is-hunt' : '';
    return `
      <section class="screen screen-battle is-preamble${hunt}">
        <div class="battle-wrap is-intro is-preamble${hunt}" id="battlefield">
          <div class="battle-hud" aria-hidden="true">
            ${this.recruitCandlesHtml(this.candlesDuringBattle())}
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
            ${this.battleSpeedMarkup()}
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
    const stickerIds = [...orderedStickers(grantableStickers()), ...orderedStickers(ovenSweets()), ...orderedStickers(libraryHuntStickers())].map((s) => s.id);
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
              const stickerIds = barePrintedSummon(u.id) ? [] : [...(u.startingStickers ?? [])];
              // Hunt bosses keep their glued sticker; cocoon / garbage pile stay bare.
              if (glued && !stickerIds.includes(glued) && !barePrintedSummon(u.id)) stickerIds.push(glued);
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
    if (run.phase === 'event') {
      if (
        run.eventId === 'wishing-well' &&
        (run.eventStep === 'preview' || run.eventStep === 'well-kind' || run.eventStep === 'well-sticker')
      ) {
        this.bindWellGestures();
      } else if (run.eventId === 'book-of-lost-tales' && run.eventStep === 'book-kind') {
        this.bindBookGestures();
      } else if (run.eventId !== 'witch-oven' && run.eventId !== 'cloning-chamber') {
        this.root.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
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
    }
    if (this.canRearrangeTeam()) this.setupFormationDrag();
  }

  private canRearrangeTeam(): boolean {
    if (!this.run || this.shopBusy) return false;
    if (this.recruitReplace || this.replacePick) return false;
    const phase = this.run.phase;
    return (
      phase === 'draft' ||
      phase === 'recruit' ||
      phase === 'sticker' ||
      phase === 'stickerAssign' ||
      phase === 'formation' ||
      phase === 'postFight' ||
      phase === 'event'
    );
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
        img.src = `./art/stickers/${stickerArtFile(sid)}.png?v=cast179`;
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
    const sweetApply = Boolean(stickerId && isOvenSweet(stickerId));
    const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${instanceId}"]`);

    const revealApplied = () => {
      if (stickerId && (fromShop || fromAssign)) {
        this.markSpentOffer(stickerId);
      }
      this.run = next;
      this.noteTeam();
      void this.persist();
      this.renderPreservingScroll();
      if (sweetApply && stickerId) {
        this.flashOvenSweet(instanceId, stickerId);
        return;
      }
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
      if (fromShop || fromAssign) {
        if (this.shopPicksDone()) {
          void this.closeFinishedShop();
          return;
        }
        this.shopBusy = false;
        this.syncShopPassReady();
        return;
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
    this.shopHoldTimer = window.setTimeout(advance, sweetApply ? 1200 : 500);
  }

  /** The sweet lands in the rail like a plated sticker, then leaves. No smoke. */
  private flashOvenSweet(instanceId: string, offerId: string): void {
    requestAnimationFrame(() => {
      const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${instanceId}"]`);
      const rail = card?.querySelector('.sticker-rail');
      if (!card || !rail) return;
      const artId = ovenSweetBase(offerId);
      let slot = rail.querySelector<HTMLElement>('.sticker-slot:not(.filled)');
      let created = false;
      if (!slot) {
        slot = document.createElement('div');
        slot.dataset.stickerSlot = '3';
        rail.appendChild(slot);
        created = true;
      }
      slot.classList.add('filled', 'sticker-pop', 'is-new-stick', 'is-oven-flash');
      slot.dataset.sticker = artId;
      const img = document.createElement('img');
      img.src = `./art/stickers/${stickerArtFile(artId)}.png?v=cast179`;
      img.alt = '';
      img.draggable = false;
      slot.appendChild(img);
      card.classList.add('is-stick-shake');
      window.setTimeout(() => {
        card.classList.remove('is-stick-shake');
        slot?.classList.remove('sticker-pop', 'is-new-stick');
        slot?.classList.add('is-oven-gone');
      }, 680);
      window.setTimeout(() => {
        if (!slot?.isConnected) return;
        if (created) {
          slot.remove();
          return;
        }
        slot.className = 'sticker-slot';
        delete slot.dataset.sticker;
        slot.replaceChildren();
      }, 980);
    });
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
    const lineups = [...this.root.querySelectorAll<HTMLElement>('.team-table')].filter(
      (el) => !el.classList.contains('result-team'),
    );
    if (!lineups.length) return;
    const feed = this.root.querySelector<HTMLElement>('[data-oven-drop], [data-well-drop], [data-clone-drop]');
    const peelStickers = Boolean(feed?.hasAttribute('data-well-drop'));
    for (const lineup of lineups) {
      lineup.querySelectorAll<HTMLElement>('.unit-card[data-instance]').forEach((el) => {
        el.querySelectorAll('img').forEach((img) => {
          img.draggable = false;
        });
        el.addEventListener(
          'pointerdown',
          (e) => {
            if (e.button !== 0 || !this.run || this.shopBusy) return;
            if ((e.target as HTMLElement).closest('.rule-tip')) return;
            if (peelStickers && (e.target as HTMLElement).closest('.sticker-slot.filled')) return;
            const startX = e.clientX;
            const startY = e.clientY;
            let dragging = false;
            this.dragSlot = Number(el.dataset.slot);

            const slotUnder = (ev: PointerEvent): HTMLElement | null => {
              if (this.ghost) this.ghost.style.visibility = 'hidden';
              const hit = document.elementFromPoint(ev.clientX, ev.clientY);
              if (this.ghost) this.ghost.style.visibility = '';
              const slot = hit?.closest<HTMLElement>('.team-slot');
              if (slot && lineup.contains(slot)) {
                return (
                  slot.querySelector<HTMLElement>('.unit-card[data-instance]') ??
                  slot.querySelector<HTMLElement>('.unit-card')
                );
              }
              const card = hit?.closest<HTMLElement>('.unit-card');
              if (card && lineup.contains(card)) return card;
              return null;
            };
            const beginDrag = (ev: PointerEvent) => {
              if (dragging) return;
              dragging = true;
              this.zoomHold = null;
              try {
                el.setPointerCapture(ev.pointerId);
              } catch {
                /* capture is best-effort */
              }
              el.classList.add('is-dragging', 'lift');
              this.ghost = document.createElement('div');
              this.ghost.className = 'ghost-card';
              const clone = el.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('img').forEach((img) => {
                img.draggable = false;
              });
              this.ghost.appendChild(clone);
              document.body.appendChild(this.ghost);
              this.moveGhost(ev);
            };
            const onMove = (ev: PointerEvent) => {
              if (this.dragSlot == null) return;
              if (!dragging) {
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
                beginDrag(ev);
              }
              ev.preventDefault();
              this.moveGhost(ev);
              lineup.querySelectorAll('.unit-card').forEach((c) => c.classList.remove('drop-glow'));
              feed?.classList.remove('drop-glow');
              if (feed && this.hitsEl(ev, feed)) {
                feed.classList.add('drop-glow');
                if (feed.hasAttribute('data-oven-drop') && !this.shopBusy) feed.classList.add('is-hungry');
                return;
              }
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
              const fed = Boolean(feed && dragging && this.hitsEl(ev, feed));
              this.clearGhost();
              el.classList.remove('is-dragging', 'lift');
              lineup.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
              feed?.classList.remove('drop-glow');
              if (!dragging) {
                this.dragSlot = null;
                return;
              }
              el.addEventListener(
                'click',
                (ce) => {
                  ce.stopPropagation();
                  ce.preventDefault();
                },
                { capture: true, once: true },
              );
              const inst = el.dataset.instance;
              if (fed && feed && inst && this.run) {
                if (feed.hasAttribute('data-oven-drop')) this.feedOven(el, feed, inst);
                else if (feed.hasAttribute('data-well-drop')) this.feedWell(feed, { type: 'unit', card: el, instanceId: inst });
                else if (feed.hasAttribute('data-clone-drop')) this.feedClone(el, feed, inst);
                this.dragSlot = null;
                return;
              }
              feed?.classList.remove('is-hungry');
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
          },
          { capture: true },
        );
      });
    }
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
          img.src = `./art/stickers/${stickerArtFile(sid)}.png?v=cast179`;
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
          if (kind === 'unit') this.glowTeamDrop(ev, teamRoot, true);
          else {
            teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
            bookStickerTarget(ev)?.classList.add('drop-glow');
          }
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const overTeam = kind === 'unit' ? this.pointerOverTeam(ev, teamRoot) : false;
          const unitEl = kind === 'sticker' ? bookStickerTarget(ev) : null;
          this.clearGhost();
          card.classList.remove('is-dragging');
          if (!unitEl) card.classList.remove('is-peeled');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!this.run || this.run.eventId !== 'book-of-lost-tales' || this.shopBusy) return;
          if (kind === 'unit' && overTeam) {
            if (this.teamHasFreeSeat()) {
              const free = firstFreeSlot(this.run.team);
              const next = claimBookUnit(this.run, free);
              if (next === this.run) return;
              this.run = next;
              audio.play('wood', 'ui');
              this.holdBookClose();
              return;
            }
            if (this.run.team.length >= MAX_TEAM) {
              const defId = bookSpread(ensureBookOffers(this.run)).unitId;
              if (!defId) return;
              this.recruitReplace = { defId };
              audio.play('paper', 'ui');
              this.render();
            }
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
        img.src = `./art/stickers/${stickerArtFile(stickerId)}.png?v=cast179`;
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
    const finish = () => {
      this.shopBusy = false;
      if (!this.run || this.run.eventId !== 'wishing-well') return;
      this.ovenShopEnter = true;
      this.run =
        drop.type === 'unit'
          ? eventSelectUnit(this.run, drop.instanceId)
          : eventSelectSticker(this.run, drop.instanceId, drop.stickerId);
      this.persistAndRender();
    };
    // GIF capture drives hungry → fed → reward on its own clock (screenshot time must not eat the splash).
    if (document.documentElement.dataset.ouaCapLock === '1') {
      (window as unknown as { __ouaWellCapFinish?: () => void }).__ouaWellCapFinish = () => {
        const el = document.querySelector('.well-object');
        if (el instanceof HTMLElement) {
          el.classList.remove('is-hungry');
          el.classList.add('is-fed');
        }
        finish();
      };
      return;
    }
    this.shopHoldTimer = window.setTimeout(() => {
      if (!this.run || this.run.eventId !== 'wishing-well') {
        this.shopBusy = false;
        return;
      }
      well.classList.remove('is-hungry');
      well.classList.add('is-fed');
      this.shopHoldTimer = window.setTimeout(finish, 1000);
    }, 1000);
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

  /** True when the pointer is anywhere over the team lane. */
  private pointerOverTeam(e: PointerEvent, root: HTMLElement): boolean {
    if (this.ghost) this.ghost.style.visibility = 'hidden';
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (this.ghost) this.ghost.style.visibility = '';
    return Boolean(hit && root.contains(hit));
  }

  private teamHasFreeSeat(): boolean {
    if (!this.run) return false;
    if (this.run.team.length >= MAX_TEAM) return false;
    const free = firstFreeSlot(this.run.team);
    return free >= 1 && free <= MAX_TEAM && !this.run.team.some((u) => u.slot === free);
  }

  /** Glow the packed free seat (or an occupied seat if the line is full and replace is allowed). */
  private glowTeamDrop(e: PointerEvent, root: HTMLElement, allowReplace: boolean): void {
    root.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
    if (!this.run || !this.pointerOverTeam(e, root)) return;
    if (this.teamHasFreeSeat()) {
      const free = firstFreeSlot(this.run.team);
      root.querySelector<HTMLElement>(`[data-slot="${free}"]`)?.classList.add('drop-glow');
      return;
    }
    if (!allowReplace) return;
    const over = this.slotUnder(e, root);
    if (!over) return;
    const slot = Number(over.dataset.slot);
    if (this.run.team.some((u) => u.slot === slot)) over.classList.add('drop-glow');
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
    if (this.run?.pendingStickerIds.length) {
      void this.playRecruitGiftAutoGlue().then(() => this.scheduleShopClose());
      return;
    }
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
    if (this.isGiftTry()) this.forceGiftTryPlated();
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
          this.glowTeamDrop(ev, teamRoot, false);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const overTeam = this.pointerOverTeam(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!overTeam || !this.run || !this.teamHasFreeSeat()) return;
          this.takeDraftOffer(defId);
        };
        this.listenDrag(onMove, onUp);
      });
    });
  }

  private canStillRecruit(): boolean {
    if (!this.run || this.run.phase !== 'recruit') return false;
    if (this.recruitReplace) return true;
    if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep) && !this.run.pendingGoldUnitId) return false;
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

    this.syncCandleHud(candlesOf(run));

    const hint = this.root.querySelector('.screen-recruit .sticker-shop-hint');
    if (hint) {
      if (this.recruitReplace) {
        hint.classList.remove('is-pick-progress');
        hint.textContent = this.L('recruitReplaceHint');
      } else {
        hint.classList.toggle('is-pick-progress', count > 0);
        hint.innerHTML = this.recruitCountHint(count, limit);
      }
    }

    const teamRoot = this.recruitTeamRoot();
    if (teamRoot) {
      const replacing = Boolean(this.recruitReplace);
      teamRoot.innerHTML = renderTeamLane(loc, run.team, {
        showEmpty: true,
        ...this.runStatCtx(),
        cardOpts: () => ({ extraClass: replacing ? 'is-replace-pick' : '' }),
      });
      requestAnimationFrame(() => fitCardSlabs(teamRoot));
    }

    const actions = this.root.querySelector('.recruit-actions');
    if (actions && (run.phase === 'recruit' || run.phase === 'draft')) {
      actions.innerHTML = this.recruitReplace?.gold
        ? ''
        : this.recruitReplace
          ? `<button class="btn ghost" data-act="cancel-replace-recruit">${this.L('cancel')}</button>`
          : run.phase === 'draft'
            ? this.fightArtButton()
            : this.alleyPassButton('skip-recruit');
    }

    const screen = this.root.querySelector('.screen-recruit');
    screen?.classList.toggle('is-replacing', Boolean(this.recruitReplace));

    this.bindRecruitShopGestures();
    if (this.canRearrangeTeam()) this.setupFormationDrag();
    requestAnimationFrame(() => this.layoutFightSeal());
  }

  private bindRecruitTeamGestures(): void {
    if (!this.run || this.run.phase !== 'recruit' || !this.recruitReplace) return;
    this.root.querySelectorAll<HTMLElement>('.recruit-shop-team .unit-card[data-instance]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!this.run || !this.recruitReplace) return;
        const slot = Number(el.dataset.slot);
        if (!slot) return;
        const defId = this.recruitReplace.defId;
        const gold = this.recruitReplace.gold;
        this.recruitReplace = null;
        this.run = gold ? seatGoldUnit(this.run, slot) : replaceRecruit(this.run, defId, slot);
        audio.play('paper', 'ui');
        this.afterRecruitChange(slot);
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
          const next = replaceEventUnit(this.run, slot);
          if (next === this.run) return;
          audio.play('paper', 'ui');
          this.showSwapThenContinue(slot, next);
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
          this.glowTeamDrop(ev, teamRoot, true);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = this.slotUnder(ev, teamRoot);
          const overTeam = this.pointerOverTeam(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!this.run || this.run.eventStep !== 'reward-unit') return;
          if (overTeam && this.teamHasFreeSeat()) {
            const free = firstFreeSlot(this.run.team);
            const next = placeEventUnit(this.run, free);
            if (next === this.run) return;
            audio.play('wood', 'ui');
            this.showSwapThenContinue(free, next);
            return;
          }
          if (over) {
            const slot = Number(over.dataset.slot);
            if (slot >= 1 && slot <= MAX_TEAM && this.run.team.some((u) => u.slot === slot)) {
              this.recruitReplace = { defId: reward.defId };
              audio.play('paper', 'ui');
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
      const next = placeEventUnit(this.run, free);
      if (next === this.run) return;
      audio.play('wood', 'ui');
      this.showSwapThenContinue(free, next);
      return;
    }
    const reward = eventUnitReward(this.run);
    if (!reward) return;
    this.recruitReplace = { defId: reward.defId };
    audio.play('paper', 'ui');
    this.render();
  }

  private afterRecruitChange(replacedSlot?: number): void {
    this.noteTeam();
    void this.persist();
    this.patchRecruitShopDom();
    if (replacedSlot) requestAnimationFrame(() => this.flashSignedSlot(replacedSlot));
    if (this.run?.pendingStickerIds.length) {
      void this.playRecruitGiftAutoGlue().then(() => this.scheduleShopClose(500));
      return;
    }
    this.scheduleShopClose(500);
  }

  /** Gift try always rolls a plated sticker so the smoke + flash is visible. */
  private forceGiftTryPlated(): void {
    if (!this.run?.pendingStickerIds.length) return;
    this.run = {
      ...this.run,
      pendingStickerIds: this.run.pendingStickerIds.map((id) => {
        if (id.endsWith('-plated')) return id;
        const rar = getSticker(id).rarity;
        if (rar === 'bronze') return 'silver-plated';
        if (rar === 'silver') return 'gold-plated';
        if (rar === 'gold') return 'platinum-plated';
        if (rar === 'platinum') return 'diamond-plated';
        return id;
      }),
    };
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise((r) => {
      window.setTimeout(r, ms);
    });
  }

  /** Drop a sticker onto the figure's rail so it is visible before apply / smoke. */
  private flashStickerOnRail(instanceId: string, stickerId: string): void {
    const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${instanceId}"]`);
    const rail = card?.querySelector('.sticker-rail');
    if (!card || !rail) return;
    let slot = rail.querySelector<HTMLElement>('.sticker-slot:not(.filled)');
    if (!slot) {
      slot = document.createElement('div');
      slot.dataset.stickerSlot = '3';
      rail.appendChild(slot);
    }
    slot.classList.add('filled', 'sticker-pop', 'is-new-stick');
    slot.dataset.sticker = stickerId;
    slot.replaceChildren();
    const img = document.createElement('img');
    img.src = `./art/stickers/${stickerArtFile(stickerId)}.png?v=cast179`;
    img.alt = '';
    img.draggable = false;
    slot.appendChild(img);
    card.classList.add('is-stick-shake');
    window.setTimeout(() => card.classList.remove('is-stick-shake'), 420);
  }

  private commitRecruitGift(target: { instanceId: string; stickerId: string; replaceIndex?: number }): boolean {
    if (!this.run) return false;
    const next = assignPendingSticker(this.run, target.instanceId, target.replaceIndex, target.stickerId, { settle: false });
    if (next === this.run) return false;
    this.run = next;
    this.noteTeam();
    this.patchRecruitShopDom();
    return true;
  }

  /** Farm Boy / Goose: after a beat, the gift lands on the figure. Plated shows, then smoke, then transform. */
  private async playRecruitGiftAutoGlue(): Promise<void> {
    if (!this.run?.pendingStickerIds.length) return;
    this.shopBusy = true;
    this.clearShopHold();
    await this.waitMs(480);
    let salt = 0;
    while (this.run?.pendingStickerIds.length) {
      const target = peekRecruitGiftTarget(this.run, salt);
      if (!target) {
        this.run = { ...this.run, pendingStickerIds: this.run.pendingStickerIds.slice(1) };
        salt += 1;
        continue;
      }
      const plated = target.stickerId.endsWith('-plated');
      const card = this.root.querySelector<HTMLElement>(`.unit-card[data-instance="${target.instanceId}"]`);
      this.flashStickerOnRail(target.instanceId, target.stickerId);
      audio.play('peel', 'ui');
      if (plated && card) {
        await this.waitMs(420);
        await new Promise<void>((resolve) => {
          this.playShopBanf(
            card,
            () => {
              this.commitRecruitGift(target);
            },
            () => resolve(),
          );
        });
      } else {
        this.commitRecruitGift(target);
        this.applyFx = { instanceId: target.instanceId, stickerId: target.stickerId };
        this.playApplyFx();
        await this.waitMs(900);
      }
      salt += 1;
    }
    this.shopBusy = false;
    this.noteTeam();
    void this.persist();
    this.patchRecruitShopDom();
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
    if (this.run.recruitPicks.includes(defId)) return;
    if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep) && this.run.pendingGoldUnitId !== defId) return;
    if (!this.run.recruitOffers.includes(defId) && this.run.pendingGoldUnitId !== defId) return;
    const free = firstFreeSlot(this.run.team);
    const hasRoom =
      this.run.team.length < MAX_TEAM &&
      free >= 1 &&
      free <= MAX_TEAM &&
      !this.run.team.some((u) => u.slot === free);
    if (hasRoom) {
      this.run = placeRecruit(this.run, defId, free);
      if (this.isGiftTry()) this.forceGiftTryPlated();
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
        if (this.run.recruitPicks.length >= recruitPickLimit(this.run.recruitPicks, this.run.eventId, this.run.eventStep) && this.run.pendingGoldUnitId !== el.dataset.def) return;
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
          this.glowTeamDrop(ev, teamRoot, true);
        };
        const onUp = (ev: PointerEvent) => {
          this.unlistenDrag(onMove, onUp);
          const over = this.slotUnder(ev, teamRoot);
          const overTeam = this.pointerOverTeam(ev, teamRoot);
          this.clearGhost();
          el.classList.remove('is-dragging');
          teamRoot.querySelectorAll('.drop-glow').forEach((c) => c.classList.remove('drop-glow'));
          if (!overTeam || !this.run) return;
          if (this.teamHasFreeSeat()) {
            const free = firstFreeSlot(this.run.team);
            const next = placeRecruit(this.run, defId, free);
            if (next === this.run) return;
            this.run = next;
            if (this.isGiftTry()) this.forceGiftTryPlated();
            audio.play('wood', 'ui');
            this.afterRecruitChange();
            return;
          }
          if (!over) return;
          const slot = Number(over.dataset.slot);
          if (!slot) return;
          const occupant = this.run.team.find((u) => u.slot === slot);
          if (!occupant) return;
          const next = replaceRecruit(this.run, defId, slot);
          if (next === this.run) return;
          this.run = next;
          if (this.isGiftTry()) this.forceGiftTryPlated();
          audio.play('paper', 'ui');
          this.afterRecruitChange(slot);
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

  /** Skip battle: local/dev only — never on itch. */
  private showDevSkip(): boolean {
    if (import.meta.env.DEV) return true;
    const host = location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  private syncDevSkipChrome(): void {
    const skip = document.getElementById('dev-skip-battle');
    if (!skip) return;
    const show = this.showDevSkip() && this.screen === 'battle';
    skip.hidden = !show;
    skip.textContent = this.L('skip');
  }

  /** One forward-arrow toggle: 2× when slow, 1× when fast. */
  private battleSpeedMarkup(): string {
    const fast = this.settings.battleSpeed === 2;
    const act = fast ? 'spd-1' : 'spd-2';
    const label = fast ? this.L('speed1') : this.L('speed2');
    return `<div class="battle-ui-speed">
      <button type="button" class="battle-speed-btn${fast ? ' is-on' : ''}" data-act="${act}" aria-pressed="${fast ? 'true' : 'false'}" aria-label="${label}">
        <img class="battle-speed-art" src="./art/ui/btn-speed-arrow.png?v=spd6" alt="" draggable="false" />
        <span class="battle-speed-label">${label}</span>
      </button>
    </div>`;
  }

  private setBattleSpeed(speed: 1 | 2): void {
    if (this.settings.battleSpeed === speed) return;
    this.settings.battleSpeed = speed;
    this.battleView?.setSpeed(speed);
    const btn = this.root.querySelector<HTMLButtonElement>('.battle-speed-btn');
    if (!btn) return;
    const fast = speed === 2;
    const label = fast ? this.L('speed1') : this.L('speed2');
    btn.dataset.act = fast ? 'spd-1' : 'spd-2';
    btn.classList.toggle('is-on', fast);
    btn.setAttribute('aria-pressed', fast ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    const text = btn.querySelector('.battle-speed-label');
    if (text) text.textContent = label;
  }

  private isMarketTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'market';
  }

  private isGiftTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'gift';
  }

  private isFightTry(): boolean {
    const q = new URLSearchParams(location.search).get('try');
    return q === 'fight' || q === 'paper';
  }

  /** Dev preview: cream paper base + torn black corners under HUD. */
  private isPaperTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'paper';
  }

  private isPaperBaseOn(): boolean {
    const params = new URLSearchParams(location.search);
    if (params.get('try') === 'paper') return true;
    return params.get('paper') === '1' && (this.isFightTry() || this.screen === 'run');
  }

  private isCandeliereTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'candeliere';
  }

  private isTwoZoneTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'twozone';
  }

  /** Opening shop with two signed, so Fight is the only move besides rearranging. */
  private fightTryRun(): RunState {
    let run = createRun('ai', this.player.id, this.player.name || 'Buddy', 0x81);
    run = {
      ...run,
      team: [],
      phase: 'draft',
      draftPicks: [],
      draftOffers: ['village-fool', 'hunter', 'puss-in-boots', 'tin-soldier'],
    };
    run = placeDraft(run, 'village-fool', 1);
    run = placeDraft(run, 'hunter', 2);
    return run;
  }

  /** Farm Boy and Golden Goose still in the opening shop, not on the line. */
  private giftTryRun(): RunState {
    const run = createRun('ai', this.player.id, this.player.name || 'Buddy', 0x77);
    return {
      ...run,
      team: [],
      phase: 'draft',
      draftPicks: [],
      recruitPicks: [],
      pendingStickerIds: [],
      draftOffers: ['farm-boy', 'golden-goose', 'village-fool', 'hunter'],
    };
  }

  private isHeraldTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'herald';
  }

  /** Alley shop: 1/2 already signed, Herald is the last pick so Onward can auto-close. */
  private heraldTryRun(): RunState {
    return {
      ...this.ovenLoopRun(),
      runId: 'run-herald-test',
      round: 5,
      phase: 'recruit',
      eventId: null,
      eventStep: null,
      recruitOffers: ['royal-herald', 'village-fool', 'puss-in-boots'],
      recruitPicks: ['tin-soldier'],
      pendingGoldUnitId: null,
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'tin-soldier', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
  }

  private isEndingTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'ending';
  }

  private isEndingFilmTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'ending-film';
  }

  private endingPlace(): number {
    const n = Number(new URLSearchParams(location.search).get('place'));
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
  }

  /** Last scrap on the field: Skip → Victory → black → tale coda. */
  private endingTryRun(): RunState {
    const place = this.endingPlace();
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-ending-test',
      round: 10,
      wins: Math.max(0, 4 - place),
      candles: Math.max(1, STARTING_CANDLES - Math.min(2, place - 1)),
      phase: 'battle',
      eventId: null,
      eventStep: null,
      playerName: 'TestPlayer',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'steel-sword'], permanentMods: { atk: 8, hp: 12, speed: 2 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword'], permanentMods: { atk: 6, hp: 10, speed: 2 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u4', defId: 'village-fool', slot: 4, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-ending-foe',
      playerName: 'Ink Pete',
      candles: Math.max(0, candlesOf(player) - 1),
      team: [
        { instanceId: 'e1', defId: 'village-fool', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    return resolveFight(player, playerSnapshot(foe));
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

  /** Store scrap-vs-player GIF lineup (itch capture). */
  private isVsTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'vs';
  }

  private isTaleTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'tale';
  }

  private isSilenceTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'silence';
  }

  private isNegVpTry(): boolean {
    return new URLSearchParams(location.search).get('try') === 'negvp';
  }

  /** Last candle lit — a loss ends the night. */
  private negVpTryRun(): RunState {
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-negvp-test',
      round: 3,
      wins: 0,
      candles: 1,
      phase: 'battle',
      eventId: null,
      eventStep: null,
      playerName: 'TestPlayer',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'steel-sword'], permanentMods: { atk: 8, hp: 12, speed: 2 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword'], permanentMods: { atk: 6, hp: 10, speed: 2 } },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-negvp-foe',
      playerName: 'Ink Pete',
      candles: STARTING_CANDLES,
      team: [
        { instanceId: 'e1', defId: 'village-fool', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    return resolveFight(player, playerSnapshot(foe));
  }

  /** Ice King silences Farm Boy so inspect can show the red X. */
  private silenceTryRun(): RunState {
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-silence-test',
      round: 2,
      phase: 'battle',
      eventId: null,
      eventStep: null,
      playerName: 'Farm Boy',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'steel-sword'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['rusty-knife'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-silence-foe',
      playerName: 'Ice King',
      team: [
        { instanceId: 'e1', defId: 'ice-king', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    return resolveFight(player, playerSnapshot(foe));
  }

  /** Tenth scrap, so Skip jumps to the tale-end line. */
  private taleTryRun(): RunState {
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-tale-test',
      round: 10,
      wins: 7,
      candles: 2,
      phase: 'battle',
      eventId: null,
      eventStep: null,
      playerName: 'TestPlayer',
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'steel-sword'], permanentMods: { atk: 8, hp: 12, speed: 2 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword'], permanentMods: { atk: 6, hp: 10, speed: 2 } },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-tale-foe',
      playerName: 'Ink Pete',
      candles: 1,
      team: [
        { instanceId: 'e1', defId: 'village-fool', slot: 1, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
    };
    return resolveFight(player, playerSnapshot(foe));
  }

  /** Farm boy swings into a toy box so the ambush can be watched. */
  private ambushTryRun(): RunState {
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-ambush-test',
      round: 1,
      phase: 'battle',
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

  /** Same cast as the live itch scrap-vs-player GIF — new UI, 1×. */
  private vsTryRun(): RunState {
    const blank = { stickerIds: [] as string[], permanentMods: { atk: 0, hp: 0, speed: 0 } };
    const player: RunState = {
      ...this.ovenLoopRun(),
      runId: 'run-vs-itch',
      round: 5,
      wins: 3,
      phase: 'battle',
      eventId: null,
      eventStep: null,
      playerName: 'Buddy',
      team: [
        { instanceId: 'u1', defId: 'puss-in-boots', slot: 3, ...blank },
        { instanceId: 'u2', defId: 'hunter', slot: 2, ...blank },
        { instanceId: 'u3', defId: 'farm-boy', slot: 1, ...blank },
      ],
    };
    const foe: RunState = {
      ...player,
      runId: 'run-vs-itch-foe',
      playerName: 'Rival',
      team: [
        { instanceId: 'e1', defId: 'woodland-girl', slot: 1, ...blank },
        { instanceId: 'e2', defId: 'big-bad-wolf', slot: 2, ...blank },
        { instanceId: 'e3', defId: 'gingerbread-man', slot: 3, ...blank },
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
      candles: STARTING_CANDLES,
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
    const alleyQ = new URLSearchParams(location.search).get('alley');
    const alleyDone: AlleyChoice[] =
      alleyQ === '2' || alleyQ === 'full' ? ['recruit', 'sticker'] : alleyQ === '1' ? ['recruit'] : [];
    return {
      ...this.ovenLoopRun(),
      runId: 'run-market-test',
      phase: 'postFight',
      eventId: 'book-of-lost-tales',
      eventStep: null,
      eventOffers: [],
      eventPicks: [],
      alleyDone,
      alleyPicks: [],
      alleyQueue: [],
      team: [
        { instanceId: 'u1', defId: 'farm-boy', slot: 1, stickerIds: ['fur-armor', 'rusty-knife'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u2', defId: 'hunter', slot: 2, stickerIds: ['steel-sword'], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u3', defId: 'puss-in-boots', slot: 3, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
        { instanceId: 'u4', defId: 'village-fool', slot: 4, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
      ],
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
      alleyDone: new URLSearchParams(location.search).get('alley') === '2' ? ['recruit'] : [],
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
    }, 500);
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
      candles: STARTING_CANDLES,
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
    if (act === 'close-dossier') {
      this.closeDossier();
      return;
    }
    if (act === 'menu') {
      if (this.run?.phase === 'final') this.run = null;
      this.taleEndLock = false;
      this.deferTaleCoda = false;
      return this.go('menu');
    }
    if (act === 'fullscreen') {
      await toggleFullscreen();
      return;
    }
    if (act === 'exit-game') {
      await this.closeGame();
      return;
    }
    if (act === 'new-run') {
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
    if (act === 'skip-sticker' && this.run) {
      this.replacePick = null;
      this.shopBusy = false;
      this.clearShopHold();
      const giftDone = this.isGiftStickerAssign() && this.run.pendingStickerIds.length === 0 && this.spentOfferIds.length > 0;
      const shopDone = this.run.phase === 'sticker' && this.spentOfferIds.length > 0;
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
      this.recruitReplace = null;
      if (this.run?.phase === 'recruit' || this.run?.phase === 'draft') this.patchRecruitShopDom();
      else this.render();
      return;
    }
    if (act === 'skip-recruit' && this.run) {
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
      return this.startFightFromSquare();
    }
    if (act === 'after-result' && this.run) {
      this.run = afterResult(this.run);
      await this.persist();
      return this.render();
    }
    if (act === 'spd-1') this.setBattleSpeed(1);
    if (act === 'spd-2') this.setBattleSpeed(2);
    if (act === 'skip-battle') {
      this.battleView?.skip();
      audio.play('whoosh');
    }
  }

  private async maybeFullscreen(): Promise<void> {
    if (this.settings.preferFullscreen) await enterFullscreen();
  }

  /**
   * Browsers/itch block window.close() unless we opened the tab.
   * Old path: close → fail → exitFullscreen → layout thrash / blank feel.
   * Soft land: hush music, leave fullscreen, stay on a healthy menu.
   */
  private async closeGame(): Promise<void> {
    audio.stopMusic();
    await exitFullscreen();
    try {
      window.close();
    } catch {
      /* blocked */
    }
    if (window.closed) return;
    applyViewportScale();
    if (this.screen !== 'menu') this.go('menu');
    else this.render();
  }

  private async launchHuntFight(): Promise<void> {
    if (!this.run || this.huntFightArmed) return;
    if (this.run.eventId !== 'monster-hunt' || !this.run.huntMonsterId) return;
    this.huntFightArmed = true;
    try {
      audio.unlock();
      this.run = resolveHuntFight(this.run);
      await this.persist();
      audio.leaveSquare('hunt');
      await this.maybeFullscreen();
      audio.unlock();
      await this.fadeSquareToArena();
    } finally {
      this.huntFightArmed = false;
    }
  }

  private async startNewRun(): Promise<void> {
    const alias = clampPlayerName(this.root.querySelector<HTMLInputElement>('#alias')?.value || this.player.name);
    this.player = { ...this.player, name: alias };
    savePlayer(this.player.id, alias);
    this.taleEndLock = false;
    this.deferTaleCoda = false;
    this.run = null;
    if (!this.tryEvent() && !this.isMarketTry() && !this.isGiftTry() && !this.isFightTry() && !this.isHeraldTry() && !this.isEndingTry() && !this.isWidowTry() && !this.isWidowCardTry() && !this.isHuntCardsTry() && !this.isWoodsmanTry() && !this.isFilthTry() && !this.isScrapTry() && !this.isAmbushTry()) await this.services.runs.clear();
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

  /** Hunt uses the Market Square line. Skip the extra rearrange screen. */
  private shouldAutoHuntFight(): boolean {
    return this.screen === 'run' && this.isHuntLineup();
  }

  /** Square Fight, draft Fight, or leftover opening gifts: you press it so you can still rearrange. */
  private async startFightFromSquare(): Promise<void> {
    if (!this.run || this.alleyFightArmed || this.shopBusy) return;
    this.alleyFightArmed = true;
    try {
      // Keep the tap gesture alive for WebAudio before any await / fullscreen.
      audio.unlock();
      if (this.run.phase === 'draft') {
        this.run = confirmDraft(this.run);
        this.noteTeam();
        await this.persist();
        if (this.run.phase === 'stickerAssign') {
          this.render();
          return;
        }
      } else if (isOpeningStickerGift(this.run) || (this.run.phase === 'stickerAssign' && !this.run.eventId && !this.run.history.length)) {
        this.run = { ...this.run, pendingStickerIds: [] };
        await this.persist();
      } else if (this.run.phase === 'postFight') {
        this.run = passAlley(this.run);
        await this.persist();
      } else if (this.run.phase === 'formation') {
        await this.persist();
      }
      // Samsung: give the WebAudio tick a real turn before fullscreen + the scrap sim.
      await new Promise<void>((r) => setTimeout(r, 120));
      await this.maybeFullscreen();
      audio.unlock();
      await this.beginFight();
    } finally {
      this.alleyFightArmed = false;
    }
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
    audio.leaveSquare('fight');
    await this.fadeSquareToArena();
  }

  private esc(text: string): string {
    return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
  }

  private playBattleEnd(): void {
    const run = this.run;
    const field = this.root.querySelector<HTMLElement>('#battlefield');
    const battle = run?.lastBattle;
    if (!run || !field || !battle || field.querySelector('.battle-end')) return;
    const endingMs = Math.round(audio.beginEnding() * 1000);
    // Scrap dance is half as long, so the fade back to the square starts sooner.
    const waitMs = this.isHuntEndPending() ? endingMs + 1000 : Math.round((endingMs + 1000) / 2);
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

  private revealBattleEnd(
    field: HTMLElement,
    battle: NonNullable<NonNullable<typeof this.run>['lastBattle']>,
  ): void {
    const run = this.run;
    if (!run) return;
    field.classList.add('is-ended');
    const hunt = this.isHuntEndPending();
    const to = candlesOf(run);
    const from = scrapCandles(run);
    field.insertAdjacentHTML('beforeend', `<div class="battle-end" hidden></div>`);

    if (to < from) {
      const snuffed =
        document.querySelector<HTMLElement>(`#run-candle-hud .candle[data-candle="${to}"]`) ??
        field.querySelector<HTMLElement>(`.battle-hud .candle[data-candle="${to}"]`);
      if (snuffed?.classList.contains('is-lit')) {
          window.setTimeout(() => {
            snuffed.classList.add('is-snuffing');
            window.setTimeout(() => {
              snuffed.classList.remove('is-lit', 'is-snuffing');
              snuffed.classList.add('is-out');
            }, 2300);
          }, 480);
      }
    }
    const nightOver = !hunt && (to <= 0 || livingIds(run).length <= 1);
    let hold = hunt ? 1000 : nightOver ? 2000 : 500;
    if (to < from) hold = Math.max(hold, 2800);
    window.setTimeout(() => {
      if (this.screen !== 'battle') return;
      if (nightOver) {
        void this.playTaleEnd(field);
        return;
      }
      void this.leaveBattleEnd();
    }, hold);
  }

  private async leaveBattleEnd(): Promise<void> {
    if (!this.run) return;
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
    await this.persist();
    if (this.run.phase === 'final') {
      await this.playTaleEnd();
      return;
    }
    this.battleFieldUp = false;
    this.screen = 'run';
    await this.fadeArenaToSquare();
  }

  private placeCaption(place: number): string {
    if (this.settings.locale === 'it') return `${place}°`;
    const tens = place % 100;
    const suf = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] ?? 'th');
    return `${place}${suf}`;
  }

  private talePlace(): number {
    if (this.isEndingTry() || this.isEndingFilmTry()) return this.endingPlace();
    if (!this.run) return 1;
    return placeOf(this.run, this.run.playerId);
  }

  private endingCrownHtml(placeN: number): string {
    if (placeN > 3) return '';
    const metal = placeN === 1 ? 'gold' : placeN === 2 ? 'silver' : 'bronze';
    return `<svg class="tale-crown is-${metal}" viewBox="0 0 64 48" aria-hidden="true"><path d="M4 40h56l-6-22-14 12L32 6 22 30 8 18z"/></svg>`;
  }

  /** One span per letter so the line can be written out in order. */
  private taleInk(text: string, start: number): string {
    return [...text].map((ch, n) => {
      const body = ch === ' ' ? '&nbsp;' : this.esc(ch);
      return `<span class="tale-ch" style="--i:${start + n}">${body}</span>`;
    }).join('');
  }

  private endingTaleHtml(): string {
    const placeN = this.talePlace();
    const full = this.placeCaption(placeN);
    const split = full.match(/^(\d+)(.*)$/);
    const digits = split?.[1] ?? full;
    const suffix = split?.[2] ?? '';
    const lead = this.L('taleEnds');
    const place = this.L('standingPlaceWord');
    const podium = placeN <= 3 ? ' is-podium' : '';
    const dotsAt = [...lead].length;
    return `
      <span class="tale-lead">${this.taleInk(lead, 0)}</span>
      <span class="tale-swap">
        <span class="tale-dots">${this.taleInk('...', dotsAt)}</span>
        <span class="tale-result${podium}"><span class="tale-rank"><span class="tale-rank-num"><span class="tale-figure">${this.endingCrownHtml(placeN)}${this.esc(digits)}</span>${this.esc(suffix)}</span></span><span class="tale-place"> ${this.esc(place)}</span></span>
      </span>`;
  }

  private endingCastMarkup(): string {
    const run = this.run!;
    return `
      <div class="ending-cast">
        <div class="ending-team grid5">${renderTeamLane(this.settings.locale, run.team, {
          showEmpty: false,
          ...this.runStatCtx(),
        })}</div>
        <div class="battle-end-row">
          <p class="ending-tale battle-end-word is-tale is-gone">${this.endingTaleHtml()}</p>
        </div>
        <div class="film-plate" aria-hidden="true">
          <div class="film-curtain"></div>
          <div class="film-spot"></div>
          <svg class="film-grain" viewBox="0 0 400 400" preserveAspectRatio="none">
            <filter id="film-noise">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
            </filter>
            <rect width="100%" height="100%" filter="url(#film-noise)" />
          </svg>
          <div class="film-scratches"></div>
          <div class="film-dust"></div>
          <div class="film-flicker"></div>
        </div>
        <button type="button" class="film-end" data-act="menu"><span>The End</span></button>
      </div>`;
  }

  private endingCastHtml(): string {
    return `<section class="screen screen-ending">${this.endingCastMarkup()}</section>`;
  }

  /** Shared coda: "Your Tale ends in…" then soft fade to menu. */
  private async beginTaleCoda(root: HTMLElement | null): Promise<void> {
    if (!root || !this.run || this.run.phase !== 'final') return;
    if (root.dataset.taleCoda === '1') return;
    root.dataset.taleCoda = '1';
    try {
      await this.finishRun();
    } catch {
      /* Leaderboard / clear must not kill the coda. */
    }
    if (!this.root.contains(root) || !this.run) return;
    window.clearTimeout(this.endingTimer);
    audio.beginEnding();
    audio.setCue('final');
    document.documentElement.classList.add('is-ending');
    document.documentElement.classList.remove('is-battle', 'is-hunt', 'is-preamble', 'is-square');
    this.syncRunChromeHud();
    const homeChrome = document.getElementById('home-chrome');
    if (homeChrome) homeChrome.hidden = true;
    this.setHomeChromeMenu(false);
    const menuStamp = document.getElementById('menu-stamp');
    if (menuStamp) menuStamp.hidden = true;
    const word = root.querySelector<HTMLElement>('.ending-tale');
    if (!word) return;
    // Banner parchment stays up; ink fades in so the team never jumps.
    this.layoutEndingTale(root);
    await new Promise<void>((r) => {
      this.endingTimer = window.setTimeout(r, 800);
    });
    if (!this.run || !this.root.contains(root)) return;
    void word.offsetWidth;
    word.classList.remove('is-gone');
    const letters = word.querySelectorAll('.tale-lead .tale-ch, .tale-dots .tale-ch').length;
    await new Promise<void>((r) => {
      this.endingTimer = window.setTimeout(r, letters * 75 + 900);
    });
    if (!this.run || !this.root.contains(root)) return;
    word.classList.add('is-place');
    await new Promise<void>((r) => {
      this.endingTimer = window.setTimeout(r, 3000);
    });
    if (!this.run || !this.root.contains(root)) return;
    root.classList.add('is-the-end');
  }

  /** Last scrap: soft fade onto the market table with the team, then the tale line, then the menu. */
  private async playTaleEnd(_field?: HTMLElement): Promise<void> {
    if (!this.run) return;
    if (this.run.phase === 'result') this.run = afterResult(this.run);
    if (this.run.phase !== 'final') return;
    if (this.taleEndLock) return;
    this.taleEndLock = true;
    this.battleFieldUp = false;
    audio.setCue('final');
    const ticket = ++this.fadeTicket;
    document.documentElement.classList.add('is-result-fade');
    await fadeOutScene(SCRAP_COVER_MS);
    if (ticket !== this.fadeTicket || !this.run || this.run.phase !== 'final') {
      document.documentElement.classList.remove('is-result-fade');
      this.taleEndLock = false;
      return;
    }
    // Tear down the scrap loop before replacing the DOM — a late raf was crashing after the fade.
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.battleView = null;
    this.screen = 'run';
    document.documentElement.classList.remove('is-result-fade', 'is-battle', 'is-hunt', 'is-preamble');
    // Paint the Grimm table ending (not the arena). Start the coda only after the unveil.
    this.deferTaleCoda = true;
    this.paintScreen();
    this.deferTaleCoda = false;
    await revealScene('ending', SCRAP_REVEAL_MS);
    if (ticket !== this.fadeTicket || !this.run) return;
    const cast = this.root.querySelector<HTMLElement>('.ending-cast');
    await this.beginTaleCoda(cast);
  }

  private mountBattle(): void {
    const field = this.root.querySelector<HTMLElement>('#battlefield');
    if (!field || !this.run?.lastBattle) return;
    const view = new BattleView(field, this.settings);
    this.battleView = view;
    view.setSpeed(this.settings.battleSpeed);
    view.onField = () => {
      this.battleFieldUp = true;
      // Phones often drop the Fight gesture during the black fade; wake audio again here.
      const cue = this.musicCue();
      if (cue === 'fight' || cue === 'hunt') audio.ensureBattle(cue);
      else audio.setCue(cue);
    };
    view.load(this.run.lastBattle.events);
    view.onDone = () => {
      const winner = this.run?.lastBattle?.winner;
      if (winner) view.beginVictory(winner);
      if (this.isHuntEndPending()) {
        this.playBattleEnd();
        return;
      }
      if (this.run?.phase !== 'result') {
        // Scrap try: soft music end + victory dance, then next boss.
        // Dance is short so the arena fade can start sooner (~half of the old 2.6s hold).
        const ending = this.isScrapTry() ? 0 : audio.beginEnding();
        const waitMs = this.isScrapTry()
          ? 1300
          : Math.max(2600, Math.round(ending * 1000) + 1800);
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
      if (this.battleView !== view) return;
      const dt = Math.min(0.05, (now - this.lastTs) / 1000);
      this.lastTs = now;
      try {
        view.tick(dt);
        view.draw();
      } catch {
        this.battleView = null;
        return;
      }
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
