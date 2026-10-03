import { audio } from '../audio/engine';
import { getUnit, slotRange } from '../core/catalog';
import { translate } from '../data/i18n';
import type { BattleEvent, DeathStyle, PublicUnitView, Settings, TeamId } from '../core/types';
import { MAX_TEAM } from '../core/types';
import { battleTargetingHtml, renderBattleCard, renderCocoonBattleAbility, renderStickerRail, fitCardSlabs, bindScrapReadouts } from '../ui/cards';
import { cardMotion, clipDuration, type AnimClip } from './character';

const SLIDE_DUR = 0.38;
const SIDE_FLIP_DUR = 0.34;
const SIDE_SWITCH_TOTAL = SLIDE_DUR + SIDE_FLIP_DUR;
/** Fool laugh: shake, then a full second of stillness before the card goes. */
const LAUGH_SHAKE = 0.75;
const LAUGH_HOLD = 1;
/** Curtain intro: black → closed hold → our panels travel fully off → music → cards. */
const CURTAIN_BLACK = 0.3;
/** Closed cloth, before it parts. */
const CURTAIN_CLOSED_HOLD = 2;
/** Must match the wing transition in CSS. */
const CURTAIN_OPEN_DUR = 2.8;
const CURTAIN_ARENA_AT = CURTAIN_BLACK + CURTAIN_CLOSED_HOLD;
const CURTAIN_FIELD_AT = CURTAIN_ARENA_AT + CURTAIN_OPEN_DUR;
const CURTAIN_CARDS = 0.55;
const CURTAIN_MAX = CURTAIN_FIELD_AT + CURTAIN_CARDS;
/** Dealer: one slot on both sides, then the next. Fight waits a second after the last card lands. */
const DEAL_FLIGHT = 0.36;
const DEAL_GAP = 0.08;
const DEAL_HOLD = 1;
/** Banf smoke: dense cover first, then open; phase-2 card is already under before clear. */
const SMOKE_HOLD_MS = [340, 170, 150, 160] as const;
const SMOKE_FADE_MS = 280;
const SMOKE_TOTAL_MS = SMOKE_HOLD_MS.reduce((a, b) => a + b, 0) + SMOKE_FADE_MS;
const SMOKE_TOTAL_SEC = SMOKE_TOTAL_MS / 1000;
/** Swap form while frame 1 still covers the card. */
const SMOKE_REVEAL_MS = SMOKE_HOLD_MS[0]!;
/** Cancelled swing: reach the ambush card, hold while it changes, then step back. */
const APPROACH_ARRIVE = 0.36;
const APPROACH_HOLD_END = 0.48;
const APPROACH_TOTAL = 0.84;

function approachBlend(t: number): number {
  if (t <= 0.1) return 0;
  if (t <= APPROACH_ARRIVE) {
    const u = (t - 0.1) / (APPROACH_ARRIVE - 0.1);
    return 1 - (1 - u) * (1 - u);
  }
  if (t <= APPROACH_HOLD_END) return 1;
  if (t >= APPROACH_TOTAL) return 0;
  const u = (t - APPROACH_HOLD_END) / (APPROACH_TOTAL - APPROACH_HOLD_END);
  return 1 - u * u;
}

interface Actor {
  uid: string;
  defId: string;
  team: TeamId;
  slot: number;
  clip: AnimClip;
  clipT: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  dead: boolean;
  gone: boolean;
  death: DeathStyle;
  flash: number;
  pop: number;
  stickers: string[];
  /** Sticker slots already used this scrap. A rail redraw must not paint them fresh. */
  spentSlots: number[];
  silenced: boolean;
  slideDx: number;
  slideDy: number;
  slideLeft: number;
  /** Card has landed; hold the next beat so the hit does not flash mid-slide. */
  settleLeft: number;
  /** After a side-switch slide settles, play a short mirror flip. */
  flipLeft: number;
  pendingFlip: boolean;
  /** Seconds left of the laugh shake. */
  laughLeft: number;
  /** Cancelled swing traveling onto an ambush card. -1 when idle. */
  approachT: number;
  approachDx: number;
  approachDy: number;
  /** Death plays forward, then the same clip runs backward. */
  rewindPhase: 'out' | 'back' | null;
  /** Word shown when the death clip turns around. Rewind and Revive share the motion. */
  rewindFloat: { text: string; kind: string } | null;
  rewindHp: number;
}

interface AmbushFx {
  revealAt: number;
  pending: BattleEvent[];
  targetId: string;
  revealed: boolean;
}

export class BattleView {
  private actors = new Map<string, Actor>();
  private events: BattleEvent[] = [];
  private i = 0;
  private wait = 0;
  private intro = 3;
  private curtain = 2.55;
  private introElapsed = 0;
  private curtainPhase: 'black' | 'closed' | 'opening' | 'open' | 'gone' = 'black';
  private arenaUnder = false;
  private cardsArmed = false;
  private curtainOpening = false;
  private dealing = false;
  private dealHold = false;
  private dealSlot = 0;
  private dealClock = 0;
  private reduceMotion = false;
  private ended = false;
  private paused = false;
  private speed = 1;
  private t = 0;
  private logLines: string[] = [];
  private ambushFx: AmbushFx | null = null;
  /** "Ambush!" waits until the transform smoke has fully cleared. */
  private pendingAmbushLabel: string | null = null;
  /** Async VFX (Banf smoke) still playing — scrap must not close until this hits 0. */
  private fxRemain = 0;
  /** Game-time when the Banf smoke veil is gone. Next beat waits for this. */
  private smokeUntil = 0;
  onDone: (() => void) | null = null;
  /** Curtains are open on the scrap field — fight music may start. */
  onField: (() => void) | null = null;
  private fieldShown = false;

  constructor(
    private host: HTMLElement,
    private settings: Settings,
  ) {}

  load(events: BattleEvent[]): void {
    this.events = events;
    this.i = 0;
    this.wait = 0;
    this.intro = CURTAIN_MAX;
    this.curtain = CURTAIN_MAX;
    this.introElapsed = 0;
    this.curtainPhase = 'black';
    this.arenaUnder = false;
    this.cardsArmed = false;
    this.curtainOpening = false;
    this.dealing = false;
    this.dealHold = false;
    this.dealSlot = 0;
    this.dealClock = 0;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.host.classList.add('is-intro', 'is-preamble');
    this.host.classList.remove('is-field-up');
    this.host.closest('.screen-battle')?.classList.add('is-preamble');
    const introEl = this.host.querySelector('.battle-intro');
    introEl?.classList.remove('is-gone');
    introEl?.setAttribute('data-curtain', 'black');
    this.ended = false;
    this.fxRemain = 0;
    this.smokeUntil = 0;
    this.fieldShown = false;
    this.actors.clear();
    this.logLines = [];
    this.ambushFx = null;
    this.pendingAmbushLabel = null;
    this.t = 0;
    this.buildBoard();
    bindScrapReadouts(this.host);
    for (const ev of events) {
      if (ev.type === 'UnitSpawned') this.spawn(ev.unit, true);
    }
    while (this.i < events.length) {
      const ev = events[this.i]!;
      if (ev.type === 'BattleStarted' || ev.type === 'UnitSpawned') this.i += 1;
      else break;
    }
  }

  setSpeed(s: number): void {
    this.speed = s;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  beginVictory(winner: TeamId | 'draw'): void {
    this.host.querySelector('.battle-fx')?.replaceChildren();
    this.host.querySelectorAll('.is-stat-up, .is-stat-down, .is-new-stick, .sticker-pop').forEach((el) => {
      el.classList.remove('is-stat-up', 'is-stat-down', 'is-new-stick', 'sticker-pop');
    });
    for (const a of this.actors.values()) {
      if (!a.dead && (winner === a.team || winner === 'draw')) {
        a.clip = 'victory';
        a.clipT = 0;
      }
    }
  }

  skip(): void {
    this.pendingAmbushLabel = null;
    if (this.ambushFx) {
      this.revealAmbush(true);
      this.ambushFx = null;
    }
    while (this.i < this.events.length) this.apply(this.events[this.i++]!, true);
    this.cardsArmed = true;
    this.dealing = false;
    this.endIntro();
    if (this.ended) return;
    this.ended = true;
    this.onDone?.();
  }

  get log(): string[] {
    return this.logLines;
  }

  private setCurtainPhase(phase: 'black' | 'closed' | 'opening' | 'open' | 'gone'): void {
    if (this.curtainPhase === phase) return;
    this.curtainPhase = phase;
    this.host.querySelector('.battle-intro')?.setAttribute('data-curtain', phase);
  }

  /** Bottom and the outer folds start later, and still finish with the rest of the cloth. */
  private clothTravel(t: number, yN: number, u: number): number {
    const delay = 0.36 * Math.pow(yN, 1.4) + 0.2 * (1 - u);
    const span = 1 - delay;
    const local = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - delay) / span));
    return local * local * (3 - 2 * local);
  }

  /** Inner hem. The two edges stay straight and meet on the center line while the curtain is shut. */
  private velvetHemX(w: number, t: number, yN: number, side: 'left' | 'right'): number {
    const half = w * 0.5;
    const lead = this.clothTravel(t, yN, 1);
    const rest = side === 'left' ? half : w - half;
    const dest = side === 'left' ? -w * 0.18 : w + w * 0.18;
    return rest + (dest - rest) * lead;
  }

  private velvetWash(ctx: CanvasRenderingContext2D, h: number): CanvasGradient {
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#7a2830');
    wash.addColorStop(0.38, '#541820');
    wash.addColorStop(1, '#2a1014');
    return wash;
  }

  private velvetFold(ctx: CanvasRenderingContext2D, x: number, width: number): CanvasGradient {
    const fold = ctx.createLinearGradient(x, 0, x + width, 0);
    fold.addColorStop(0, 'rgba(18, 6, 8, 0.62)');
    fold.addColorStop(0.28, 'rgba(70, 16, 20, 0.08)');
    fold.addColorStop(0.55, 'rgba(170, 48, 52, 0.28)');
    fold.addColorStop(1, 'rgba(14, 4, 6, 0.55)');
    return fold;
  }

  private paintVelvetWing(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    side: 'left' | 'right',
  ): void {
    const segs = 24;
    let onStage = false;
    const hem: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const x = this.velvetHemX(w, t, s / segs, side);
      hem.push(x);
      if (side === 'left' ? x > 0 : x < w) onStage = true;
    }
    if (!onStage) return;
    const exit = Math.min(1, Math.max(0, (t - 0.72) / 0.28));
    const outer = (side === 'left' ? -w * 0.16 : w + w * 0.16) * exit + (side === 'left' ? 0 : w) * (1 - exit);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(side === 'left' ? Math.min(outer, 0) : Math.max(outer, w), 0);
    ctx.lineTo(side === 'left' ? Math.min(outer, 0) : Math.max(outer, w), h);
    for (let s = segs; s >= 0; s--) ctx.lineTo(hem[s]!, (h * s) / segs);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = this.velvetWash(ctx, h);
    ctx.fillRect(0, 0, w, h);
    const g = this.clothTravel(t, 0, 1);
    const pleatW = Math.max(6, (w / 24) * (1 - g * 0.7));
    const shift = (side === 'left' ? -1 : 1) * g * w * 0.5;
    const bow = (yN: number) => {
      const drape = Math.sin(yN * Math.PI) * g * w * 0.06;
      const lean = yN * yN * g * w * 0.045;
      return drape + (side === 'left' ? -lean : lean);
    };
    for (let i = -6; i < 36; i++) {
      const x0 = i * pleatW + shift;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const yN = s / segs;
        const x = x0 + bow(yN);
        if (s === 0) ctx.moveTo(x, 0);
        else ctx.lineTo(x, (h * s) / segs);
      }
      for (let s = segs; s >= 0; s--) ctx.lineTo(x0 + pleatW + bow(s / segs), (h * s) / segs);
      ctx.closePath();
      ctx.fillStyle = this.velvetFold(ctx, x0, pleatW);
      ctx.fill();
    }
    const band = Math.max(12, w * 0.014);
    const sign = side === 'left' ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(hem[0]!, 0);
    for (let s = 1; s <= segs; s++) ctx.lineTo(hem[s]!, (h * s) / segs);
    for (let s = segs; s >= 0; s--) ctx.lineTo(hem[s]! + sign * band, (h * s) / segs);
    ctx.closePath();
    const edge = hem[Math.floor(segs / 2)] ?? w * 0.5;
    const lip = ctx.createLinearGradient(edge, 0, edge + sign * band, 0);
    lip.addColorStop(0, 'rgba(16, 5, 7, 0.78)');
    lip.addColorStop(0.22, 'rgba(150, 42, 48, 0.34)');
    lip.addColorStop(1, 'rgba(84, 24, 32, 0)');
    ctx.fillStyle = lip;
    ctx.fill();
    ctx.restore();
  }

  /** Painted theatre cloth. Pleats gather to the wings and the hem swings behind. */
  private paintCurtain(open: number): void {
    const canvas = this.host.querySelector<HTMLCanvasElement>('.curtain-cloth');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (rect.width < 2 || rect.height < 2) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = open <= 0 ? 0 : open >= 1 ? 1 : open * open * (3 - 2 * open);
    ctx.clearRect(0, 0, w, h);
    if (t < 0.02) {
      this.paintVelvetWing(ctx, w, h, 0, 'left');
      this.paintVelvetWing(ctx, w, h, 0, 'right');
      return;
    }
    this.paintVelvetWing(ctx, w, h, t, 'left');
    this.paintVelvetWing(ctx, w, h, t, 'right');
  }

  /** Arena swaps in under the parting curtains — no scene-fade flash. */
  private revealArenaUnderCurtain(): void {
    if (this.arenaUnder) return;
    this.arenaUnder = true;
    this.host.classList.remove('is-preamble');
    this.host.closest('.screen-battle')?.classList.remove('is-preamble');
    document.documentElement.classList.remove('is-preamble');
  }

  private endCurtain(): void {
    this.curtain = 0;
    this.revealArenaUnderCurtain();
    this.setCurtainPhase('open');
    this.host.classList.add('is-field-up');
    this.showField();
  }

  private endIntro(): void {
    this.intro = 0;
    this.curtain = 0;
    this.revealArenaUnderCurtain();
    this.host.classList.remove('is-intro', 'is-preamble');
    this.host.classList.add('is-field-up');
    this.host.closest('.screen-battle')?.classList.remove('is-preamble');
    document.documentElement.classList.remove('is-preamble');
    this.setCurtainPhase('gone');
    this.host.querySelector('.battle-intro')?.classList.add('is-gone');
    this.showField();
  }

  private showField(): void {
    if (this.fieldShown) return;
    this.fieldShown = true;
    this.onField?.();
  }

  private advanceCurtain(dt: number): void {
    this.introElapsed += dt;
    const e = this.introElapsed;
    const closed = this.reduceMotion ? 0.15 : CURTAIN_CLOSED_HOLD;
    const openDur = this.reduceMotion ? 0.05 : CURTAIN_OPEN_DUR;
    const arenaAt = CURTAIN_BLACK + closed;
    const fieldAt = arenaAt + openDur;
    if (e < CURTAIN_BLACK) {
      this.setCurtainPhase('black');
      return;
    }
    const open = e < arenaAt ? 0 : Math.min(1, (e - arenaAt) / openDur);
    this.paintCurtain(open);
    if (e < arenaAt) {
      this.setCurtainPhase('closed');
      return;
    }
    if (!this.curtainOpening) {
      this.curtainOpening = true;
      this.revealArenaUnderCurtain();
      this.setCurtainPhase('opening');
    }
    if (e < fieldAt) return;
    if (!this.cardsArmed) {
      this.paintCurtain(1);
      this.endCurtain();
      this.cardsArmed = true;
      this.dealing = true;
      this.dealHold = false;
      this.dealSlot = 0;
      this.dealClock = 0;
      this.intro = 1;
      return;
    }
    this.advanceDeal(dt);
  }

  private nextDealSlot(after: number): number | null {
    let best: number | null = null;
    for (const a of this.actors.values()) {
      if (a.slot > after && (best === null || a.slot < best)) best = a.slot;
    }
    return best;
  }

  /** Slot 1 on both sides, then 2, then 3, then 4. One card snap each beat. */
  private advanceDeal(dt: number): void {
    this.dealClock += dt;
    if (!this.dealHold) {
      const ready = this.dealSlot === 0 || this.dealClock >= DEAL_FLIGHT + DEAL_GAP;
      if (!ready) return;
      const next = this.nextDealSlot(this.dealSlot);
      if (next === null) {
        this.dealHold = true;
        this.dealClock = 0;
        return;
      }
      this.dealSlot = next;
      this.dealClock = 0;
      audio.play('paper');
      return;
    }
    if (this.dealClock >= DEAL_HOLD) {
      this.dealing = false;
      this.endIntro();
    }
  }

  tick(dt: number): void {
    if (this.paused) return;
    if (this.intro > 0) {
      this.advanceCurtain(dt);
      for (const a of this.actors.values()) this.advanceActor(a, dt);
      return;
    }
    const d = dt * this.speed;
    this.t += d;
    this.fxRemain = Math.max(0, this.fxRemain - d);
    for (const a of this.actors.values()) this.advanceActor(a, d);
    if (this.ambushFx && !this.ambushFx.revealed && this.t >= this.ambushFx.revealAt) {
      this.revealAmbush(false);
    }
    this.wait -= d;
    while (this.wait <= 0 && this.i < this.events.length && !this.ended) {
      if (this.ambushFx) {
        this.revealAmbush(false);
        this.ambushFx = null;
      }
      const next = this.events[this.i]!;
      // One beat ends before the next. Slot shuffles of the same moment still travel together.
      const slotBeat = next.type === 'MovedForward' || next.type === 'MovedToBack' || next.type === 'SlotsSwapped';
      if (this.clipBusy()) break;
      if (!slotBeat && this.slideBusy()) break;
      this.wait = this.apply(this.events[this.i++]!, false);
    }
    if (this.i >= this.events.length && !this.ended && !this.ambushFx && this.fxRemain <= 0 && !this.clipBusy() && !this.slideBusy()) {
      this.ended = true;
      this.onDone?.();
    }
  }

  draw(): void {
    for (const a of this.actors.values()) this.syncCard(a);
  }

  private buildBoard(): void {
    const player = this.host.querySelector('.battle-side.is-player');
    const enemy = this.host.querySelector('.battle-side.is-enemy');
    if (!player || !enemy) return;
    const slots = slotRange();
    player.innerHTML = slots
      .slice()
      .reverse()
      .map((slot) => `<div class="battle-slot" data-battle-slot="player-${slot}"></div>`)
      .join('');
    enemy.innerHTML = slots
      .map((slot) => `<div class="battle-slot" data-battle-slot="enemy-${slot}"></div>`)
      .join('');
    this.host.querySelector('.battle-fx')?.replaceChildren();
  }

  private slotEl(team: TeamId, slot: number): HTMLElement | null {
    return this.host.querySelector(`[data-battle-slot="${team}-${slot}"]`);
  }

  private ensureSlot(team: TeamId, slot: number): HTMLElement | null {
    if (slot < 1 || slot > MAX_TEAM) return null;
    const existing = this.slotEl(team, slot);
    if (existing) return existing;
    const side = this.host.querySelector(team === 'player' ? '.battle-side.is-player' : '.battle-side.is-enemy');
    if (!side) return null;
    const el = document.createElement('div');
    el.className = 'battle-slot';
    el.dataset.battleSlot = `${team}-${slot}`;
    const others = [...side.querySelectorAll<HTMLElement>('.battle-slot')];
    const next = others.find((s) => {
      const n = Number(s.dataset.battleSlot?.split('-').pop());
      return team === 'player' ? n < slot : n > slot;
    });
    if (next) side.insertBefore(el, next);
    else side.appendChild(el);
    return el;
  }

  private cardEl(uid: string): HTMLElement | null {
    return this.host.querySelector(`[data-uid="${cssEscape(uid)}"]`);
  }

  private spawn(unit: PublicUnitView, silent: boolean): void {
    const loc = this.settings.locale;
    const holder = this.ensureSlot(unit.team, unit.slot);
    if (!holder) return;
    holder.innerHTML = renderBattleCard(loc, unit);
    requestAnimationFrame(() => fitCardSlabs(holder));
    const actor: Actor = {
      uid: unit.uid,
      defId: unit.defId,
      team: unit.team,
      slot: unit.slot,
      clip: silent ? 'idle' : 'enter',
      clipT: 0,
      hp: unit.hp,
      maxHp: unit.maxHp,
      atk: unit.atk,
      speed: unit.speed,
      dead: false,
      gone: false,
      death: 'flatten',
      flash: 0,
      pop: 0,
      stickers: [...unit.stickers],
      spentSlots: [...(this.actors.get(unit.uid)?.spentSlots ?? [])],
      silenced: Boolean(unit.silenced),
      slideDx: 0,
      slideDy: 0,
      slideLeft: 0,
      settleLeft: 0,
      flipLeft: 0,
      pendingFlip: false,
      laughLeft: 0,
      approachT: -1,
      approachDx: 0,
      approachDy: 0,
      rewindPhase: null,
      rewindFloat: null,
      rewindHp: unit.maxHp,
    };
    this.actors.set(unit.uid, actor);
    this.paintStickerRail(actor);
    if (!silent) audio.play('paper');
  }

  private advanceActor(a: Actor, d: number): void {
    a.flash = Math.max(0, a.flash - d * 5);
    a.pop = Math.max(0, a.pop - d);
    const wasSliding = a.slideLeft > 0;
    a.slideLeft = Math.max(0, a.slideLeft - d);
    if (wasSliding && a.slideLeft === 0) a.settleLeft = 0.14;
    else a.settleLeft = Math.max(0, a.settleLeft - d);
    if (a.pendingFlip && a.slideLeft <= 0) {
      a.pendingFlip = false;
      a.flipLeft = SIDE_FLIP_DUR;
    }
    a.flipLeft = Math.max(0, a.flipLeft - d);
    a.laughLeft = Math.max(0, a.laughLeft - d);
    if (a.approachT >= 0) {
      a.approachT += d;
      if (a.approachT >= APPROACH_TOTAL) this.endApproach(a);
    }
    if (a.rewindPhase === 'out') {
      a.clipT += d;
      if (a.clipT >= clipDuration('death')) {
        a.rewindPhase = 'back';
        a.clipT = clipDuration('death');
        a.hp = a.rewindHp;
        a.dead = false;
        if (a.rewindFloat) this.float(a, a.rewindFloat.text, a.rewindFloat.kind);
      }
      return;
    }
    if (a.rewindPhase === 'back') {
      a.clipT -= d;
      if (a.clipT <= 0) {
        a.rewindPhase = null;
        a.clip = 'idle';
        a.clipT = 0;
        a.hp = a.rewindHp;
        a.dead = false;
      }
      return;
    }
    a.clipT += d;
    if (a.dead && !a.gone && a.clipT >= clipDuration('death')) this.finishDeath(a);
    if (a.dead) return;
    if (a.clip !== 'idle' && a.clip !== 'victory' && a.clipT >= clipDuration(a.clip)) {
      a.clip = 'idle';
      a.clipT = 0;
    }
  }

  private finishDeath(a: Actor): void {
    a.gone = true;
    this.cardEl(a.uid)?.remove();
  }

  /** Death forward, then the same clip backward. The word is Revive or Rewind. */
  private beginDeathRewind(tgt: Actor, hp: number, text: string, kind: string, silent: boolean): void {
    tgt.gone = false;
    tgt.rewindHp = hp;
    tgt.rewindFloat = { text, kind };
    if (silent) {
      tgt.dead = false;
      tgt.rewindPhase = null;
      tgt.clip = 'idle';
      tgt.clipT = 0;
      tgt.hp = hp;
      return;
    }
    tgt.dead = true;
    tgt.hp = 0;
    tgt.rewindPhase = 'out';
    tgt.clip = 'death';
    tgt.clipT = 0;
    audio.play('bell');
  }

  private syncCard(a: Actor): void {
    const el = this.cardEl(a.uid);
    if (!el) return;
    const m = cardMotion(a.clip, a.clipT, a.team, a.death);
    const closing = a.approachT >= 0;
    const blend = closing ? approachBlend(a.approachT) : 0;
    const motionX = closing ? a.approachDx * blend + (a.approachT < 0.12 ? m.x : 0) : m.x;
    const motionY = closing ? a.approachDy * blend + m.y : m.y;
    const u = a.slideLeft > 0 ? a.slideLeft / SLIDE_DUR : 0;
    // Ease-out so the card settles into the slot instead of overshooting.
    const slide = u * u;
    const laugh = a.laughLeft > 0 ? Math.sin(this.t * 46) : 0;
    let foldY = m.foldY;
    if (a.flipLeft > 0) {
      const t = 1 - a.flipLeft / SIDE_FLIP_DUR;
      // Fold edge-on then open — reads as a mirror flip without leaving the card reversed.
      foldY = Math.sin(t * Math.PI) * 82;
    }
    const arriving = this.dealing && !this.dealHold && a.slot === this.dealSlot;
    const p = arriving ? Math.min(1, this.dealClock / DEAL_FLIGHT) : 1;
    const ease = 1 - (1 - p) * (1 - p);
    const dealY = (1 - ease) * -150;
    const dealX = (1 - ease) * (a.team === 'player' ? 64 : -64);
    const dealRot = (1 - ease) * (a.team === 'player' ? -9 : 9);
    el.style.transform = `translate(${motionX + a.slideDx * slide + laugh * 10 + dealX}px, ${motionY + a.slideDy * slide + dealY}px) rotate(${m.rot + laugh * 7 + dealRot}deg) rotateX(${m.foldX}deg) rotateY(${foldY}deg) scale(${m.sx}, ${m.sy})`;
    el.classList.toggle('is-dealt', this.dealing && a.slot <= this.dealSlot && a.slot > 0);
    el.style.opacity = (() => {
      if (this.intro <= 0) return String(m.opacity);
      if (!this.fieldShown) return '0';
      const fade = 1 - Math.max(0, this.intro) / CURTAIN_CARDS;
      return String(Math.max(0, Math.min(1, fade)) * m.opacity);
    })();
    const flying = a.slideLeft > 0 || a.flipLeft > 0 || a.pendingFlip;
    el.style.zIndex = arriving ? '8' : a.clip === 'attack' ? '6' : flying ? '7' : a.dead ? '0' : '1';
    el.dataset.death = a.death;
    el.classList.toggle('is-flash', a.flash > 0 && !this.settings.reduceFlash);
    el.classList.toggle('is-dead', a.dead);
    el.classList.toggle('is-attack', a.clip === 'attack');
    el.classList.toggle('is-hit', a.clip === 'hit');
    el.classList.toggle('is-pop', a.pop > 0);
    el.classList.toggle('is-side-switch', flying);
    const atk = el.querySelector('[data-stat="atk"]');
    const hp = el.querySelector('[data-stat="hp"]');
    const spd = el.querySelector('[data-stat="spd"]');
    if (atk) atk.textContent = String(a.atk);
    if (hp) hp.textContent = String(Math.max(0, a.hp));
    if (spd) spd.textContent = String(a.speed);
    if (a.pop > 0) {
      el.querySelectorAll('.sticker-slot.filled:not(.is-new-stick)').forEach((s) => s.classList.add('sticker-pop'));
    } else {
      el.querySelectorAll('.sticker-pop:not(.is-new-stick)').forEach((s) => s.classList.remove('sticker-pop'));
    }
  }

  private apply(ev: BattleEvent, silent: boolean): number {
    switch (ev.type) {
      case 'Summoned':
        this.spawn(ev.unit, silent);
        if (!silent) this.pulse(ev.unit.uid);
        return silent ? 0 : 0.42;
      case 'AttackStarted': {
        const a = this.actors.get(ev.unitId);
        if (a && !a.dead) {
          a.clip = 'attack';
          a.clipT = 0;
        }
        this.markTarget(ev.targetId);
        if (!silent) audio.play('whoosh');
        if (ev.cancelled) {
          if (silent) {
            if (a) {
              a.clip = 'idle';
              a.clipT = 0;
            }
            this.consumeAmbushFollowup(true);
            return 0;
          }
          // The swing reaches the card. No hit. The form changes on contact, then that card attacks.
          if (a) this.beginApproach(a, ev.targetId);
          this.ambushFx = {
            revealAt: this.t + APPROACH_ARRIVE,
            pending: this.consumeAmbushFollowup(false),
            targetId: ev.targetId,
            revealed: false,
          };
          return APPROACH_ARRIVE + 0.04;
        }
        return 0.52;
      }
      case 'Ambushed': {
        if (!silent) {
          this.pendingAmbushLabel = ev.unitId;
          if (this.t + 0.02 >= this.smokeUntil) this.flushAmbushLabel();
          this.pulse(ev.unitId);
        }
        return silent ? 0 : 0.08;
      }
      case 'DamageDealt': {
        const tgt = this.actors.get(ev.targetId);
        if (tgt) {
          tgt.hp = this.sawLog(`cheat-death:${ev.targetId}`) ? 1 : Math.max(0, tgt.hp - ev.amount);
          if (!tgt.dead) {
            tgt.clip = 'hit';
            tgt.clipT = 0;
          }
          tgt.flash = 1;
          if (!silent) {
            const loc = this.settings.locale;
            const revengeCue = this.peekPrevLog(`revenge:${ev.targetId}:`);
            if (ev.kind === 'thorns' && !revengeCue) {
              this.float(tgt, translate(loc, 'fx.thorn'), 'is-thorn');
              this.holdFx(0.16 + 0.9);
              window.setTimeout(() => this.float(tgt, `−${ev.amount}`, 'is-hurt'), this.wallMs(160));
            } else if (ev.kind === 'reflect' && !revengeCue) {
              this.float(tgt, translate(loc, 'fx.reflect'), 'is-reflect');
              this.holdFx(0.16 + 0.9);
              window.setTimeout(() => this.float(tgt, `−${ev.amount}`, 'is-hurt'), this.wallMs(160));
            } else {
              this.float(tgt, `−${ev.amount}`, 'is-hurt');
            }
            this.burst(tgt, 'impact');
            audio.play(ev.kind === 'attack' ? 'punch' : 'boing');
          }
        }
        if (ev.kind !== 'attack') this.pulse(ev.sourceId);
        if (!silent && (ev.kind === 'thorns' || ev.kind === 'reflect') && !this.peekPrevLog(`revenge:${ev.targetId}:`)) {
          return 0.34;
        }
        return ev.kind === 'attack' ? 0.22 : 0.12;
      }
      case 'Healed': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.hp = Math.min(tgt.maxHp, tgt.hp + ev.amount);
          if (!silent) this.float(tgt, `+${ev.amount}`, 'is-heal');
        }
        this.pulse(ev.unitId);
        return 0.14;
      }
      case 'StatChanged': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          if (ev.stat === 'atk') tgt.atk = ev.now;
          if (ev.stat === 'speed') tgt.speed = ev.now;
          if (ev.stat === 'maxHp') tgt.maxHp = ev.now;
          if (ev.stat === 'hp') tgt.hp = ev.now;
          const cursedNext = this.peekNextLog(`curse:${ev.unitId}:`);
          const giftedNext = this.peekGiftedStat(ev.unitId);
          if (!silent && ev.amount !== 0 && !cursedNext && !giftedNext) {
            const signed = `${ev.amount > 0 ? '+' : '−'}${Math.abs(ev.amount)}`;
            const label =
              ev.stat === 'speed' ? `SPD ${signed}` : ev.stat === 'atk' ? `ATK ${signed}` : `${ev.stat.toUpperCase()} ${signed}`;
            const el = this.cardEl(ev.unitId);
            if (ev.amount < 0) {
              this.float(tgt, label, ev.stat === 'speed' ? 'is-speed-down' : 'is-hurt');
              el?.classList.remove('is-target');
              el?.classList.add('is-debuffed');
              window.setTimeout(() => el?.classList.remove('is-debuffed'), this.wallMs(1100));
            } else {
              this.float(tgt, label, 'is-buff');
            }
            const chip = el?.querySelector(`[data-stat="${ev.stat === 'speed' ? 'spd' : ev.stat === 'atk' ? 'atk' : 'hp'}"]`);
            if (chip && ev.amount < 0) {
              chip.classList.remove('is-stat-up');
              chip.classList.add('is-stat-down');
              window.setTimeout(() => chip.classList.remove('is-stat-down'), this.wallMs(1100));
            } else if (chip && ev.amount > 0) {
              chip.classList.remove('is-stat-down');
              chip.classList.add('is-stat-up');
              window.setTimeout(() => chip.classList.remove('is-stat-up'), this.wallMs(1100));
            }
          }
        }
        this.pulse(ev.unitId);
        // Let multi-target battle-start dust (Sandman) actually read on screen.
        return silent || ev.amount === 0 ? 0.08 : ev.stat === 'speed' ? 0.32 : 0.22;
      }
      case 'Transformed': {
        const prev = this.actors.get(ev.unit.uid);
        const slot = prev?.slot ?? ev.unit.slot;
        const unit = { ...ev.unit, slot };
        if (silent) {
          this.spawn(unit, true);
          const a = this.actors.get(unit.uid);
          if (a) {
            a.hp = unit.hp;
            a.maxHp = unit.maxHp;
            a.atk = unit.atk;
            a.speed = unit.speed;
            a.silenced = Boolean(unit.silenced);
            a.dead = false;
            a.clip = 'idle';
            a.clipT = 0;
          }
          return 0;
        }
        if (prev) {
          this.burst(prev, 'smoke');
          audio.play('puff');
          this.smokeUntil = Math.max(this.smokeUntil, this.t + SMOKE_TOTAL_SEC);
          this.holdFx(SMOKE_TOTAL_SEC);
        }
        // Phase 1 stays visible under smoke; swap to phase 2 while still covered so
        // when the puff finishes the new form is already there (no late pop).
        window.setTimeout(() => {
          this.spawn(unit, true);
          const a = this.actors.get(unit.uid);
          if (a) {
            a.hp = unit.hp;
            a.maxHp = unit.maxHp;
            a.atk = unit.atk;
            a.speed = unit.speed;
            a.silenced = Boolean(unit.silenced);
            a.dead = false;
            a.clip = 'idle';
            a.clipT = 0;
          }
        }, this.wallMs(SMOKE_REVEAL_MS));
        return SMOKE_TOTAL_SEC;
      }
      case 'SlotsSwapped': {
        const a = this.actors.get(ev.aId);
        const b = this.actors.get(ev.bId);
        if (a && b) {
          const slotA = a.slot;
          a.slot = b.slot;
          b.slot = slotA;
          const elA = this.cardEl(a.uid);
          const elB = this.cardEl(b.uid);
          const holdA = this.ensureSlot(a.team, a.slot);
          const holdB = this.ensureSlot(b.team, b.slot);
          if (elA && holdA) holdA.appendChild(elA);
          if (elB && holdB) holdB.appendChild(elB);
        }
        return silent ? 0 : 0.2;
      }
      case 'MovedForward': {
        const a = this.actors.get(ev.unitId);
        if (a) this.slideToSlot(a, ev.toSlot, silent);
        const next = this.events[this.i];
        if (silent || next?.type === 'MovedForward' || next?.type === 'MovedToBack') return 0;
        return SLIDE_DUR;
      }
      case 'MovedToBack': {
        const a = this.actors.get(ev.unitId);
        if (a) {
          this.slideToSlot(a, ev.toSlot, silent);
          if (!silent && !this.peekPrevLog(`fear:${ev.unitId}`)) {
            this.float(a, 'BACK', 'is-stat');
          }
        }
        return silent ? 0 : SLIDE_DUR;
      }
      case 'TauntGranted': {
        const el = this.cardEl(ev.unitId);
        const next = renderCocoonBattleAbility(this.settings.locale, true);
        const existing = el?.querySelector('.ability');
        if (existing) existing.outerHTML = next;
        else el?.querySelector('.card-slab')?.insertAdjacentHTML('beforeend', next);
        return 0;
      }
      case 'SwitchedSides': {
        const a = this.actors.get(ev.unitId);
        if (a) {
          a.team = ev.team;
          let slot = ev.slot;
          // Compact often emits MovedForward right after — land on the final seat in one hop.
          while (this.i < this.events.length) {
            const next = this.events[this.i]!;
            if (next.type !== 'MovedForward' || next.unitId !== ev.unitId) break;
            slot = next.toSlot;
            this.i += 1;
          }
          const el = this.cardEl(a.uid);
          if (el) {
            el.dataset.team = ev.team;
            el.dataset.slot = String(slot);
          }
          this.slideToSlot(a, slot, silent);
          if (!silent) {
            a.pendingFlip = true;
            if (a.slideLeft <= 0) {
              a.pendingFlip = false;
              a.flipLeft = SIDE_FLIP_DUR;
            }
          }
        }
        return silent ? 0 : SIDE_SWITCH_TOTAL;
      }
      case 'AteSticker': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt && !silent) this.float(tgt, translate(this.settings.locale, 'fx.chomp'), 'is-chomp');
        this.pulse(ev.unitId);
        return 0.16;
      }
      case 'StoleSticker': {
        const victim = this.actors.get(ev.victimId);
        const thief = this.actors.get(ev.thiefId);
        if (thief && !silent) {
          this.float(thief, translate(this.settings.locale, 'fx.steal'), 'is-stat');
        }
        const ateAlready = this.events
          .slice(Math.max(0, this.i - 8), this.i - 1)
          .some((e) => e.type === 'AteSticker' && e.unitId === ev.thiefId && e.stickerId === ev.stickerId);
        if (victim) {
          const vIdx = victim.stickers.indexOf(ev.stickerId);
          if (vIdx >= 0) this.dropStickerAt(victim, vIdx);
        }
        if (!silent && victim && thief && ev.applied && !ateAlready) {
          this.flySticker(ev.victimId, ev.thiefId, ev.stickerId, () => {});
        }
        if (victim) {
          this.paintStickerRail(victim);
          this.refreshTargeting(ev.victimId);
        }
        if (ev.applied && !ateAlready) this.applyStickerToCard(ev.thiefId, ev.stickerId, silent);
        this.pulse(ev.thiefId);
        this.pulse(ev.victimId);
        return silent ? 0 : ev.applied && !ateAlready ? 0.55 : 0.4;
      }
      case 'PeeledSticker': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          if (!tgt.stickers.includes(ev.stickerId)) tgt.stickers.push(ev.stickerId);
          const card = this.cardEl(ev.unitId);
          if (card && !card.querySelector(`[data-sticker="${cssEscape(ev.stickerId)}"]`)) {
            this.paintStickerRail(tgt);
          }
          this.markStickerSpent(card, ev.stickerId, ev.stickerSlot, silent);
          this.refreshTargeting(ev.unitId);
        }
        this.pulse(ev.unitId);
        return 0.1;
      }
      case 'TrashedStickers':
      case 'PoisonApplied':
      case 'PoisonFaded': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          const next = [...ev.stickers];
          tgt.spentSlots = tgt.spentSlots.filter((i) => tgt.stickers[i] === next[i]);
          tgt.stickers = next;
          this.paintStickerRail(tgt);
          this.refreshTargeting(ev.unitId);
        }
        this.pulse(ev.unitId);
        return 0.16;
      }
      case 'ExhaustedSticker': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          const idx = tgt.stickers.indexOf(ev.stickerId);
          if (idx >= 0) this.dropStickerAt(tgt, idx);
          this.paintStickerRail(tgt);
          this.refreshTargeting(ev.unitId);
          if (!silent) this.float(tgt, 'USED', 'is-stat');
        }
        this.pulse(ev.unitId);
        return 0.12;
      }
      case 'StickerSpent': {
        const card = this.cardEl(ev.unitId);
        const lead = silent ? 0 : this.effectTailMs();
        return this.markStickerSpent(card, ev.stickerId, ev.stickerSlot, silent, lead);
      }
      case 'ExhaustedUnit': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt && !silent) {
          if (this.peekNextLog(`melt:${ev.unitId}`)) {
            this.float(tgt, translate(this.settings.locale, 'fx.melt'), 'is-melt');
          } else {
            this.float(tgt, 'OUT', 'is-stat');
          }
        }
        this.pulse(ev.unitId);
        if (ev.recipientId) this.pulse(ev.recipientId);
        return 0.12;
      }
      case 'EarnedSticker': {
        this.pulse(ev.unitId);
        const tgt = this.actors.get(ev.unitId);
        if (tgt && !silent) this.float(tgt, 'GOLD', 'is-stat');
        return 0.16;
      }
      case 'GrantedSticker': {
        this.applyStickerToCard(ev.unitId, ev.stickerId, silent);
        return silent ? 0 : 0.28;
      }
      case 'GainedCombatSticker': {
        this.applyStickerToCard(ev.unitId, ev.stickerId, silent);
        if (!silent) this.pulse(ev.sourceId);
        return silent ? 0 : 0.34;
      }
      case 'Rewound': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.death = ev.death;
          this.beginDeathRewind(tgt, ev.hp, translate(this.settings.locale, 'fx.rewind'), 'is-rewind', silent);
        }
        this.cardEl(ev.masterId)
          ?.querySelectorAll('[data-rewind-left]')
          .forEach((count) => {
            count.textContent = String(ev.rewindLeft);
          });
        return silent ? 0 : clipDuration('death') * 2;
      }
      case 'Revived': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.dead = false;
          tgt.gone = false;
          tgt.hp = ev.hp;
          tgt.clip = 'idle';
          tgt.clipT = 0;
          tgt.rewindPhase = null;
          if (!silent) {
            this.float(tgt, translate(this.settings.locale, 'fx.revive'), 'is-revive');
            audio.play('bell');
          }
        }
        this.pulse(ev.unitId);
        return silent ? 0 : 0.35;
      }
      case 'GiftedStat': {
        const tgt = this.actors.get(ev.recipientId);
        if (tgt && !silent) {
          const label =
            ev.stat === 'atk' ? `+${ev.amount} ATK` : ev.stat === 'speed' ? `+${ev.amount} SPEED` : `+${ev.amount} HP`;
          this.float(tgt, label, ev.stat === 'hp' ? 'is-heal' : 'is-gift');
        }
        this.pulse(ev.recipientId);
        this.pulse(ev.unitId);
        return silent ? 0 : 0.2;
      }
      case 'Evaded': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt && !silent) this.float(tgt, translate(this.settings.locale, 'fx.evade'), 'is-evade');
        this.pulse(ev.unitId);
        if (ev.sourceId) this.pulse(ev.sourceId);
        return 0.16;
      }
      case 'ConfusedSkip': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt && !silent) this.float(tgt, '???', 'is-confused');
        this.pulse(ev.unitId);
        return 0.16;
      }
      case 'UnitDied': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.dead = true;
          tgt.hp = 0;
          tgt.clip = 'death';
          tgt.clipT = 0;
          tgt.death = ev.death;
          if (!silent) {
            audio.play('death');
            this.holdFx(clipDuration('death'));
          } else {
            this.finishDeath(tgt);
          }
        }
        return silent ? 0 : 0.92;
      }
      case 'BattleEnded':
        // Dance and the result word start together, once floats and smoke are gone.
        return 0;
      case 'Log': {
        this.logLines.push(ev.message);
        if (!silent) {
          const loc = this.settings.locale;
          if (ev.message.startsWith('cheat-death:')) {
            const uid = ev.message.slice('cheat-death:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              tgt.hp = 1;
              this.float(tgt, translate(loc, 'fx.cheatDeath'), 'is-lucky');
              this.pulse(uid);
              audio.play('bell');
            }
            return 0.28;
          }
          if (ev.message.startsWith('curse:')) {
            const parts = ev.message.split(':');
            const uid = parts[1] ?? '';
            const amount = Number(parts[2] ?? 1);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.curse'), 'is-curse');
              this.holdFx(0.16 + 0.9);
              window.setTimeout(() => this.float(tgt, `ATK −${amount}`, 'is-hurt'), this.wallMs(160));
              this.pulse(uid);
            }
            return 0.34;
          }
          if (ev.message.startsWith('fear:')) {
            const uid = ev.message.slice('fear:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.fear'), 'is-fear');
              this.markTarget(uid);
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('rise:')) {
            const uid = ev.message.slice('rise:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.rise'), 'is-rise');
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('death:')) {
            const uid = ev.message.slice('death:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.death'), 'is-death');
              this.markTarget(uid);
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('guardian:')) {
            const uid = ev.message.slice('guardian:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.guardian'), 'is-guardian');
              this.markActing(uid);
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('taunt:')) {
            const uid = ev.message.slice('taunt:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.taunt'), 'is-taunt');
              this.markActing(uid);
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('melt:')) {
            const uid = ev.message.slice('melt:'.length);
            if (this.peekPrevEventType() === 'ExhaustedUnit') return 0;
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.melt'), 'is-melt');
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('revenge:')) {
            const parts = ev.message.split(':');
            const uid = parts[1] ?? '';
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.revenge'), 'is-revenge');
              this.markTarget(uid);
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('forget:')) {
            const uid = ev.message.slice('forget:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              this.float(tgt, translate(loc, 'fx.forget'), 'is-forget');
              this.pulse(uid);
            }
            return 0.22;
          }
          if (ev.message.startsWith('haha:')) {
            const uid = ev.message.slice('haha:'.length);
            const tgt = this.actors.get(uid);
            if (tgt) {
              tgt.laughLeft = LAUGH_SHAKE;
              this.float(tgt, translate(loc, 'fx.haha'), 'is-haha');
            }
            return LAUGH_SHAKE + LAUGH_HOLD;
          }
          if (ev.message.startsWith('time:')) {
            const team = ev.message.slice('time:'.length) as TeamId;
            const label = translate(loc, 'fx.time');
            for (const a of this.actors.values()) {
              if (a.team === team && !a.dead && !a.gone) {
                this.float(a, label, 'is-time');
                this.pulse(a.uid);
              }
            }
            return 0.34;
          }
        }
        return 0;
      }
      case 'TurnStarted': {
        this.markActing(ev.unitId);
        return silent ? 0 : 0.12;
      }
      case 'TurnEnded': {
        this.clearActing(ev.unitId);
        return 0;
      }
      case 'BattleStartAct': {
        this.markActing(ev.unitId);
        return silent ? 0 : 0.18;
      }
      case 'Silenced': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.silenced = true;
          const el = this.cardEl(ev.unitId);
          if (el) {
            el.classList.add('is-silenced');
            this.paintStickerRail(tgt);
            el.querySelector('.ability')?.remove();
            el.querySelector('.timing-type')?.closest('.rule-tip')?.remove();
            // Keep targeting chip; strip timing labels from rule-row
            el.querySelectorAll('.timing-type').forEach((n) => n.remove());
          }
          if (!silent) {
            this.markTarget(ev.unitId);
            this.float(tgt, translate(this.settings.locale, 'fx.silence'), 'is-silence');
            this.pulse(ev.unitId);
          }
        }
        this.pulse(ev.sourceId);
        return silent ? 0 : 0.22;
      }
      default:
        return ev.type === 'BattleEffectsResolved' ? 0.16 : 0.02;
    }
  }

  /** Move the attacker until the cards nearly touch. The hit clip stays unused. */
  private beginApproach(a: Actor, targetId: string): void {
    const el = this.cardEl(a.uid);
    const tgt = this.cardEl(targetId);
    if (!el || !tgt) {
      a.approachT = -1;
      return;
    }
    const ar = el.getBoundingClientRect();
    const tr = tgt.getBoundingClientRect();
    const sx = ar.width / Math.max(1, el.offsetWidth);
    const sy = ar.height / Math.max(1, el.offsetHeight);
    const vx = tr.left + tr.width / 2 - (ar.left + ar.width / 2);
    const vy = tr.top + tr.height / 2 - (ar.top + ar.height / 2);
    const dist = Math.hypot(vx, vy);
    const pad = (ar.width + tr.width) / 2 + 18 * sx;
    const travel = Math.max(0, dist - pad);
    const k = dist > 1 ? travel / dist : 0;
    a.approachDx = (vx * k) / sx;
    a.approachDy = (vy * k) / sy;
    a.approachT = 0;
    const side = el.closest('.battle-side');
    const slot = el.closest('.battle-slot');
    if (side instanceof HTMLElement) side.style.zIndex = '4';
    if (slot instanceof HTMLElement) slot.style.zIndex = '4';
  }

  private endApproach(a: Actor): void {
    a.approachT = -1;
    a.approachDx = 0;
    a.approachDy = 0;
    const el = this.cardEl(a.uid);
    const side = el?.closest('.battle-side');
    const slot = el?.closest('.battle-slot');
    if (side instanceof HTMLElement) side.style.zIndex = '';
    if (slot instanceof HTMLElement) slot.style.zIndex = '';
  }

  private consumeAmbushFollowup(applyNow: boolean): BattleEvent[] {
    const pending: BattleEvent[] = [];
    while (this.i < this.events.length) {
      const next = this.events[this.i]!;
      pending.push(next);
      this.i += 1;
      if (applyNow) this.apply(next, true);
      if (next.type === 'Ambushed') break;
      if (next.type === 'AttackStarted' || next.type === 'TurnStarted' || next.type === 'BattleEnded') {
        // Safety: rewind if we overshot without Ambushed
        this.i -= 1;
        pending.pop();
        break;
      }
    }
    return pending;
  }

  /** The word appears only once the smoke element is gone. */
  private flushAmbushLabel(): void {
    const uid = this.pendingAmbushLabel;
    if (!uid || this.ended) return;
    this.pendingAmbushLabel = null;
    const live = this.actors.get(uid);
    if (live) this.float(live, translate(this.settings.locale, 'fx.ambush'), 'is-ambush');
  }

  private revealAmbush(silent: boolean): void {
    const fx = this.ambushFx;
    if (!fx || fx.revealed) return;
    fx.revealed = true;
    for (const ev of fx.pending) this.apply(ev, silent);
    if (!silent) {
      const tgt = this.actors.get(fx.targetId);
      // Ambushed event already floats; if somehow missing, still pulse target
      if (tgt && !fx.pending.some((e) => e.type === 'Ambushed')) {
        this.float(tgt, translate(this.settings.locale, 'fx.ambush'), 'is-ambush');
      }
    }
  }

  private slideToSlot(a: Actor, toSlot: number, silent: boolean): void {
    const el = this.cardEl(a.uid);
    const hold = this.ensureSlot(a.team, toSlot);
    if (!el || !hold) {
      a.slot = toSlot;
      return;
    }
    const first = el.getBoundingClientRect();
    hold.appendChild(el);
    a.slot = toSlot;
    el.dataset.slot = String(toSlot);
    if (silent) {
      a.slideDx = 0;
      a.slideDy = 0;
      a.slideLeft = 0;
      return;
    }
    // Clear live transforms so `last` is the true slot anchor (chained slides otherwise overshoot).
    const prevTransform = el.style.transform;
    el.style.transform = 'none';
    const last = el.getBoundingClientRect();
    el.style.transform = prevTransform;
    const sx = last.width / Math.max(1, el.offsetWidth);
    const sy = last.height / Math.max(1, el.offsetHeight);
    a.slideDx = (first.left - last.left) / sx;
    a.slideDy = (first.top - last.top) / sy;
    a.slideLeft = Math.hypot(a.slideDx, a.slideDy) < 1 ? 0 : SLIDE_DUR;
  }

  private pulse(uid: string): void {
    const a = this.actors.get(uid);
    if (a) a.pop = 0.55;
  }

  private markTarget(uid: string): void {
    this.host.querySelectorAll('.is-target').forEach((el) => el.classList.remove('is-target'));
    this.cardEl(uid)?.classList.add('is-target');
  }

  private markActing(uid: string): void {
    this.host.querySelectorAll('.is-acting').forEach((el) => el.classList.remove('is-acting'));
    this.cardEl(uid)?.classList.add('is-acting');
  }

  private clearActing(uid: string): void {
    this.cardEl(uid)?.classList.remove('is-acting');
  }

  private peekGiftedStat(unitId: string): boolean {
    for (let j = this.i; j < Math.min(this.i + 5, this.events.length); j++) {
      const e = this.events[j]!;
      if (e.type === 'GiftedStat' && e.recipientId === unitId) return true;
      if (e.type === 'StatChanged' && e.unitId === unitId) continue;
      break;
    }
    return false;
  }

  /** Card clips, laugh, and Banf smoke must finish before a different beat starts. */
  private clipBusy(): boolean {
    if (this.t + 0.02 < this.smokeUntil) return true;
    for (const a of this.actors.values()) {
      if (a.approachT >= 0 && a.approachT + 0.02 < APPROACH_TOTAL) return true;
      if (a.laughLeft > 0.02) return true;
      if (a.rewindPhase) return true;
      if (a.gone) continue;
      if (a.clip === 'attack' || a.clip === 'hit' || a.clip === 'death' || a.clip === 'enter') {
        if (a.clipT + 0.02 < clipDuration(a.clip)) return true;
      }
    }
    return false;
  }

  private slideBusy(): boolean {
    for (const a of this.actors.values()) {
      if (a.slideLeft > 0.02 || a.settleLeft > 0.02 || a.flipLeft > 0.02 || a.pendingFlip) return true;
    }
    return false;
  }

  /** During apply(), `this.i` already points at the next event. */
  private peekNextLog(prefix: string): boolean {
    const next = this.events[this.i];
    return next?.type === 'Log' && typeof next.message === 'string' && next.message.startsWith(prefix);
  }

  private peekPrevLog(prefix: string): boolean {
    const prev = this.events[this.i - 2];
    return prev?.type === 'Log' && typeof prev.message === 'string' && prev.message.startsWith(prefix);
  }

  /** Current event is already consumed, so scan the events just before it. */
  private sawLog(prefix: string, lookback = 8): boolean {
    const cur = this.i - 1;
    for (let j = cur - 1; j >= Math.max(0, cur - lookback); j--) {
      const e = this.events[j];
      if (e?.type === 'Log' && e.message.startsWith(prefix)) return true;
    }
    return false;
  }

  private peekPrevEventType(): BattleEvent['type'] | null {
    const prev = this.events[this.i - 2];
    return prev?.type ?? null;
  }

  /** Keep scrap open until this much game-time of VFX has played out. */
  private holdFx(sec: number): void {
    if (sec <= 0) return;
    this.fxRemain = Math.max(this.fxRemain, sec);
  }

  /** Wall-clock delay matching current battle speed (setTimeout is not game-timed). */
  private wallMs(ms: number): number {
    return ms / Math.max(0.01, this.speed);
  }

  private rememberSpent(card: HTMLElement, slot: HTMLElement): void {
    const actor = this.actors.get(card.dataset.uid ?? '');
    const index = Number(slot.dataset.stickerSlot);
    if (!actor || !Number.isInteger(index) || actor.spentSlots.includes(index)) return;
    actor.spentSlots.push(index);
  }

  private dropStickerAt(actor: Actor, index: number): void {
    actor.stickers.splice(index, 1);
    actor.spentSlots = actor.spentSlots.filter((s) => s !== index).map((s) => (s > index ? s - 1 : s));
  }

  /** Redraw the rail and keep already-spent stickers gray, with the cross. */
  private paintStickerRail(actor: Actor): void {
    const rail = this.cardEl(actor.uid)?.querySelector('.sticker-rail');
    if (!rail) return;
    rail.innerHTML = renderStickerRail(this.settings.locale, actor.stickers, { spent: actor.silenced });
    if (actor.silenced) return;
    for (const index of actor.spentSlots) {
      rail.querySelector(`[data-sticker-slot="${index}"]`)?.classList.add('is-spent', 'is-spent-still');
    }
  }

  /** How long the damage number or impact still has left on screen. */
  private effectTailMs(): number {
    let max = 0;
    const nodes = this.host.querySelectorAll<HTMLElement>('.battle-float, .battle-burst:not(.is-smoke)');
    for (const el of nodes) {
      for (const anim of el.getAnimations()) {
        const timing = anim.effect?.getComputedTiming();
        if (!timing) continue;
        const end = Number(timing.endTime);
        const now = Number(anim.currentTime ?? 0);
        if (!Number.isFinite(end) || !Number.isFinite(now)) continue;
        max = Math.max(max, end - now);
      }
    }
    return Math.max(0, max);
  }

  /** Color while the effect plays, then gray, then the red cross. Returns seconds to hold. */
  private markStickerSpent(
    card: HTMLElement | null,
    stickerId: string,
    stickerSlot?: number,
    silent = false,
    leadMs = 0,
  ): number {
    if (!card) return 0;
    const bySlot =
      stickerSlot != null
        ? card.querySelector<HTMLElement>(`[data-sticker-slot="${stickerSlot}"]`)
        : null;
    const matches = [...card.querySelectorAll<HTMLElement>(`[data-sticker="${cssEscape(stickerId)}"]`)];
    const slot = bySlot ?? matches.find((s) => !s.classList.contains('is-spent')) ?? matches[0];
    if (!slot || slot.classList.contains('is-spent') || slot.classList.contains('is-graying')) return 0;
    this.rememberSpent(card, slot);
    const noteSpent = () => {
      const name = slot.querySelector('.tip-name')?.textContent?.trim();
      const rarity = slot.querySelector('.tip-rarity')?.textContent?.trim();
      const effect = slot.querySelector('.tip-effect')?.textContent?.trim();
      const spent = slot.querySelector('.tip-spent')?.textContent?.trim();
      if (name && effect && spent) {
        slot.setAttribute('aria-label', `${name}. ${rarity ? `${rarity}. ` : ''}${effect}. ${spent}`);
      }
      if (slot.matches(':hover')) document.querySelector('.targeting-float')?.classList.add('is-spent');
    };
    const showCross = () => {
      if (!slot.isConnected) return;
      slot.classList.remove('is-graying', 'sticker-pop');
      slot.classList.add('is-spent');
      noteSpent();
    };
    if (silent || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      showCross();
      return 0;
    }
    const grayAt = Math.max(this.wallMs(500), leadMs);
    const crossAt = grayAt + this.wallMs(550);
    slot.classList.add('sticker-pop');
    window.setTimeout(() => {
      if (!slot.isConnected) return;
      slot.classList.remove('sticker-pop');
      slot.classList.add('is-graying');
      noteSpent();
    }, grayAt);
    window.setTimeout(showCross, crossAt);
    return (crossAt + this.wallMs(260)) / 1000;
  }

  private applyStickerToCard(uid: string, stickerId: string, silent: boolean): void {
    const tgt = this.actors.get(uid);
    if (!tgt) return;
    tgt.stickers.push(stickerId);
    const el = this.cardEl(uid);
    const rail = el?.querySelector('.sticker-rail');
    if (rail) {
      const freshAt = tgt.stickers.length - 1;
      this.paintStickerRail(tgt);
      if (!silent && !tgt.silenced) {
        const fresh = rail.querySelector<HTMLElement>(`[data-sticker-slot="${freshAt}"]`);
        fresh?.classList.add('sticker-pop', 'is-new-stick');
        this.holdFx(0.7);
        window.setTimeout(() => fresh?.classList.remove('sticker-pop', 'is-new-stick'), this.wallMs(700));
      }
    }
    this.pulse(uid);
    this.refreshTargeting(uid);
    if (!silent) audio.play('peel');
  }

  /** The word on the card follows the stickers it has now. */
  private refreshTargeting(uid: string): void {
    const tgt = this.actors.get(uid);
    const row = this.cardEl(uid)?.querySelector('.rule-row');
    if (!tgt || !row) return;
    row.innerHTML = battleTargetingHtml(this.settings.locale, tgt.defId, tgt.stickers);
  }

  /** Animate a sticker icon from one card rail to another, then run onDone. */
  private flySticker(fromUid: string, toUid: string, stickerId: string, onDone: () => void): void {
    const fromCard = this.cardEl(fromUid);
    const toCard = this.cardEl(toUid);
    const layer = this.host.querySelector<HTMLElement>('.battle-fx');
    const slot = fromCard?.querySelector<HTMLElement>(`[data-sticker="${cssEscape(stickerId)}"]`);
    const img = slot?.querySelector('img');
    if (!fromCard || !toCard || !layer || !img) {
      onDone();
      return;
    }
    const from = localPoint(this.host, slot!);
    const toRail = toCard.querySelector('.sticker-rail');
    const toAt = localPoint(this.host, (toRail as HTMLElement) || toCard);
    const flyer = document.createElement('img');
    flyer.className = 'sticker-fly';
    flyer.src = img.src;
    flyer.alt = '';
    flyer.draggable = false;
    flyer.style.left = `${from.cx}px`;
    flyer.style.top = `${from.cy}px`;
    layer.appendChild(flyer);
    this.holdFx(0.5);
    requestAnimationFrame(() => {
      flyer.style.left = `${toAt.cx}px`;
      flyer.style.top = `${toAt.top + 28}px`;
      flyer.classList.add('is-flying');
    });
    window.setTimeout(() => {
      flyer.remove();
      onDone();
    }, this.wallMs(480));
  }

  private float(a: Actor, text: string, kind: string): void {
    const card = this.cardEl(a.uid);
    const layer = this.host.querySelector<HTMLElement>('.battle-fx');
    if (!card || !layer) return;
    const at = localPoint(this.host, card);
    const el = document.createElement('span');
    el.className = `battle-float ${kind}`;
    el.textContent = text;
    const stacked = layer.querySelectorAll('.battle-float').length;
    el.style.left = `${at.cx + (stacked % 3) * 14 - 14}px`;
    // Banf sits on the card face; other floats rise from the top edge.
    el.style.top = kind === 'is-rewind' || kind === 'is-revive' ? `${at.cy}px` : `${at.top + 18 - stacked * 18}px`;
    layer.appendChild(el);
    const life = 1.5;
    this.holdFx(life);
    window.setTimeout(() => el.remove(), this.wallMs(life * 1000));
  }

  private burst(a: Actor, kind: 'impact' | 'ink' | 'smoke'): void {
    const card = this.cardEl(a.uid);
    const layer = this.host.querySelector<HTMLElement>('.battle-fx');
    if (!card || !layer) return;
    const at = localPoint(this.host, card);
    if (kind === 'smoke') {
      this.smokeBurst(layer, card, at.cx, at.cy);
      return;
    }
    const el = document.createElement('img');
    el.className = 'battle-burst';
    el.src = `./art/vfx/${kind}.png?v=hit8`;
    el.alt = '';
    el.style.left = `${at.cx}px`;
    el.style.top = `${at.cy}px`;
    layer.appendChild(el);
    this.holdFx(0.48);
    window.setTimeout(() => el.remove(), this.wallMs(480));
  }

  private smokeBurst(layer: HTMLElement, card: HTMLElement, cx: number, cy: number): void {
    const frames = [1, 2, 3, 4].map((n) => `./art/vfx/smoke-${n}.png?v=banf2`);
    const el = document.createElement('img');
    el.className = 'battle-burst is-smoke';
    el.src = frames[0]!;
    el.alt = '';
    // Cover the whole card with margin — smoke is the transform veil.
    const cover = Math.max(card.offsetWidth, card.offsetHeight) * 1.8275; // ~2.15 × 0.85
    el.style.width = `${cover}px`;
    el.style.height = `${cover}px`;
    el.style.marginLeft = `${-cover / 2}px`;
    el.style.marginTop = `${-cover / 2}px`;
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    layer.appendChild(el);
    this.holdFx(SMOKE_TOTAL_SEC);
    let i = 0;
    const advance = () => {
      const hold = this.wallMs(SMOKE_HOLD_MS[i] ?? 160);
      window.setTimeout(() => {
        i += 1;
        if (i >= frames.length) {
          window.setTimeout(() => {
            el.remove();
            this.flushAmbushLabel();
          }, this.wallMs(SMOKE_FADE_MS));
          return;
        }
        el.src = frames[i]!;
        advance();
      }, hold);
    };
    advance();
  }
}

/** Map a card from screen pixels into the host's unscaled CSS box. */
function localPoint(origin: HTMLElement, el: HTMLElement): { cx: number; cy: number; top: number } {
  const o = origin.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const sx = o.width / Math.max(1, origin.offsetWidth);
  const sy = o.height / Math.max(1, origin.offsetHeight);
  return {
    cx: (r.left + r.width / 2 - o.left) / sx,
    cy: (r.top + r.height / 2 - o.top) / sy,
    top: (r.top - o.top) / sy,
  };
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
