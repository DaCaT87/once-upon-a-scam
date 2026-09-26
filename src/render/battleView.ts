import { audio } from '../audio/engine';
import { getUnit, slotRange } from '../core/catalog';
import { translate } from '../data/i18n';
import type { BattleEvent, DeathStyle, PublicUnitView, Settings, TeamId } from '../core/types';
import { MAX_TEAM } from '../core/types';
import { renderBattleCard, renderCocoonBattleAbility, renderStickerRail, fitCardSlabs } from '../ui/cards';
import { cardMotion, clipDuration, type AnimClip } from './character';
import { commitScene } from '../ui/sceneFade';

const SLIDE_DUR = 0.38;
const SIDE_FLIP_DUR = 0.34;
const SIDE_SWITCH_TOTAL = SLIDE_DUR + SIDE_FLIP_DUR;
/** Fool laugh: shake, then a full second of stillness before the card goes. */
const LAUGH_SHAKE = 0.75;
const LAUGH_HOLD = 1;
/** Banf smoke: dense cover first, then open; phase-2 card is already under before clear. */
const SMOKE_HOLD_MS = [340, 170, 150, 160] as const;
const SMOKE_FADE_MS = 280;
const SMOKE_TOTAL_MS = SMOKE_HOLD_MS.reduce((a, b) => a + b, 0) + SMOKE_FADE_MS;
const SMOKE_TOTAL_SEC = SMOKE_TOTAL_MS / 1000;
/** Swap form while frame 1 still covers the card. */
const SMOKE_REVEAL_MS = SMOKE_HOLD_MS[0]!;

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
  private ended = false;
  private paused = false;
  private speed = 1;
  private t = 0;
  private logLines: string[] = [];
  private ambushFx: AmbushFx | null = null;
  /** Async VFX (Banf smoke) still playing — scrap must not close until this hits 0. */
  private fxRemain = 0;
  /** Game-time when the Banf smoke veil is gone. Next beat waits for this. */
  private smokeUntil = 0;
  onDone: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    private settings: Settings,
  ) {}

  load(events: BattleEvent[]): void {
    this.events = events;
    this.i = 0;
    this.wait = 0;
    this.intro = 3.8;
    this.curtain = 2.7;
    this.host.classList.add('is-intro', 'is-preamble');
    this.host.closest('.screen-battle')?.classList.add('is-preamble');
    this.host.querySelector('.battle-intro')?.classList.remove('is-gone');
    this.ended = false;
    this.fxRemain = 0;
    this.smokeUntil = 0;
    this.actors.clear();
    this.logLines = [];
    this.ambushFx = null;
    this.t = 0;
    this.buildBoard();
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
    if (this.ambushFx) {
      this.revealAmbush(true);
      this.ambushFx = null;
    }
    while (this.i < this.events.length) this.apply(this.events[this.i++]!, true);
    this.endIntro();
    if (this.ended) return;
    this.ended = true;
    this.onDone?.();
  }

  get log(): string[] {
    return this.logLines;
  }

  private endCurtain(): void {
    this.curtain = 0;
    this.host.classList.remove('is-preamble');
    this.host.closest('.screen-battle')?.classList.remove('is-preamble');
    document.documentElement.classList.remove('is-preamble');
    commitScene();
  }

  private endIntro(): void {
    this.intro = 0;
    this.curtain = 0;
    this.host.classList.remove('is-intro', 'is-preamble');
    this.host.closest('.screen-battle')?.classList.remove('is-preamble');
    document.documentElement.classList.remove('is-preamble');
    commitScene();
    this.host.querySelector('.battle-intro')?.classList.add('is-gone');
  }

  tick(dt: number): void {
    if (this.paused) return;
    if (this.intro > 0) {
      this.intro -= dt;
      if (this.curtain > 0) {
        this.curtain -= dt;
        if (this.curtain <= 0) this.endCurtain();
      }
      if (this.intro <= 0) this.endIntro();
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
      silenced: Boolean(unit.silenced),
      slideDx: 0,
      slideDy: 0,
      slideLeft: 0,
      settleLeft: 0,
      flipLeft: 0,
      pendingFlip: false,
      laughLeft: 0,
      rewindPhase: null,
      rewindFloat: null,
      rewindHp: unit.maxHp,
    };
    this.actors.set(unit.uid, actor);
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
    audio.play('death');
  }

  private syncCard(a: Actor): void {
    const el = this.cardEl(a.uid);
    if (!el) return;
    const m = cardMotion(a.clip, a.clipT, a.team, a.death);
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
    el.style.transform = `translate(${m.x + a.slideDx * slide + laugh * 10}px, ${m.y + a.slideDy * slide}px) rotate(${m.rot + laugh * 7}deg) rotateX(${m.foldX}deg) rotateY(${foldY}deg) scale(${m.sx}, ${m.sy})`;
    el.style.opacity = this.intro > 0 ? '0' : String(m.opacity);
    const flying = a.slideLeft > 0 || a.flipLeft > 0 || a.pendingFlip;
    el.style.zIndex = a.clip === 'attack' ? '6' : flying ? '7' : a.dead ? '0' : '1';
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
          if (a) {
            a.clip = 'idle';
            a.clipT = 0;
          }
          if (silent) {
            this.consumeAmbushFollowup(true);
            return 0;
          }
          // The swing is cancelled. Banf plays next, and the counterattack waits until the smoke is gone.
          return 0.28;
        }
        return 0.52;
      }
      case 'Ambushed': {
        if (!silent) {
          const tgt = this.actors.get(ev.unitId);
          if (tgt) this.float(tgt, translate(this.settings.locale, 'fx.ambush'), 'is-ambush');
          this.pulse(ev.unitId);
          audio.play('bell');
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
          audio.play('paper');
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
          if (vIdx >= 0) victim.stickers.splice(vIdx, 1);
        }
        if (!silent && victim && thief && ev.applied && !ateAlready) {
          this.flySticker(ev.victimId, ev.thiefId, ev.stickerId, () => {});
        }
        if (victim) {
          const rail = this.cardEl(ev.victimId)?.querySelector('.sticker-rail');
          if (rail) {
            rail.innerHTML = renderStickerRail(this.settings.locale, victim.stickers, { spent: victim.silenced });
          }
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
          const rail = card?.querySelector('.sticker-rail');
          if (rail && !card?.querySelector(`[data-sticker="${cssEscape(ev.stickerId)}"]`)) {
            rail.innerHTML = renderStickerRail(this.settings.locale, tgt.stickers, { spent: tgt.silenced });
          }
          this.markStickerSpent(card, ev.stickerId, ev.stickerSlot);
        }
        this.pulse(ev.unitId);
        return 0.1;
      }
      case 'TrashedStickers':
      case 'PoisonApplied': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.stickers = [...ev.stickers];
          const card = this.cardEl(ev.unitId);
          const rail = card?.querySelector('.sticker-rail');
          if (rail) rail.innerHTML = renderStickerRail(this.settings.locale, tgt.stickers, { spent: tgt.silenced });
        }
        this.pulse(ev.unitId);
        return 0.16;
      }
      case 'ExhaustedSticker': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          const idx = tgt.stickers.indexOf(ev.stickerId);
          if (idx >= 0) tgt.stickers.splice(idx, 1);
          const card = this.cardEl(ev.unitId);
          const rail = card?.querySelector('.sticker-rail');
          if (rail) rail.innerHTML = renderStickerRail(this.settings.locale, tgt.stickers, { spent: tgt.silenced });
          if (!silent) this.float(tgt, 'USED', 'is-stat');
        }
        this.pulse(ev.unitId);
        return 0.12;
      }
      case 'StickerSpent': {
        const card = this.cardEl(ev.unitId);
        this.markStickerSpent(card, ev.stickerId, ev.stickerSlot);
        return 0.42;
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
        return silent ? 0 : clipDuration('death') * 2;
      }
      case 'Revived': {
        const tgt = this.actors.get(ev.unitId);
        if (tgt) {
          tgt.death = getUnit(tgt.defId).art.death;
          this.beginDeathRewind(tgt, ev.hp, translate(this.settings.locale, 'fx.revive'), 'is-revive', silent);
        }
        this.pulse(ev.unitId);
        return silent ? 0 : clipDuration('death') * 2;
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
            const rail = el.querySelector('.sticker-rail');
            if (rail) {
              rail.innerHTML = renderStickerRail(this.settings.locale, tgt.stickers, { spent: true });
            }
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

  private markStickerSpent(card: HTMLElement | null, stickerId: string, stickerSlot?: number): void {
    if (!card) return;
    const bySlot =
      stickerSlot != null
        ? card.querySelector<HTMLElement>(`[data-sticker-slot="${stickerSlot}"]`)
        : null;
    const matches = [...card.querySelectorAll<HTMLElement>(`[data-sticker="${cssEscape(stickerId)}"]`)];
    const slot = bySlot ?? matches.find((s) => !s.classList.contains('is-spent')) ?? matches[0];
    if (!slot) return;
    slot.classList.add('is-spent', 'sticker-pop');
    const name = slot.querySelector('.tip-name')?.textContent?.trim();
    const rarity = slot.querySelector('.tip-rarity')?.textContent?.trim();
    const effect = slot.querySelector('.tip-effect')?.textContent?.trim();
    const spent = slot.querySelector('.tip-spent')?.textContent?.trim();
    if (name && effect && spent) {
      slot.setAttribute('aria-label', `${name}. ${rarity ? `${rarity}. ` : ''}${effect}. ${spent}`);
    }
    if (slot.matches(':hover')) document.querySelector('.targeting-float')?.classList.add('is-spent');
    window.setTimeout(() => slot.classList.remove('sticker-pop'), this.wallMs(480));
  }

  private applyStickerToCard(uid: string, stickerId: string, silent: boolean): void {
    const tgt = this.actors.get(uid);
    if (!tgt) return;
    tgt.stickers.push(stickerId);
    const el = this.cardEl(uid);
    const rail = el?.querySelector('.sticker-rail');
    if (rail) {
      const before = rail.querySelectorAll('.sticker-slot.filled').length;
      rail.innerHTML = renderStickerRail(this.settings.locale, tgt.stickers, { spent: tgt.silenced });
      if (!silent && !tgt.silenced) {
        const slots = [...rail.querySelectorAll<HTMLElement>('.sticker-slot.filled')];
        const fresh = slots[Math.min(before, slots.length - 1)];
        fresh?.classList.add('sticker-pop', 'is-new-stick');
        this.holdFx(0.7);
        window.setTimeout(() => fresh?.classList.remove('sticker-pop', 'is-new-stick'), this.wallMs(700));
      }
    }
    this.pulse(uid);
    if (!silent) audio.play('paper');
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
          window.setTimeout(() => el.remove(), this.wallMs(SMOKE_FADE_MS));
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
