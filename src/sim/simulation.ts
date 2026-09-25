import {
  clampStat,
  computedStats,
  getSticker,
  getUnit,
  mergePassives,
  offerStickers,
  offerStickersOfRarity,
  offerUnits,
  randomUnitOfRarity,
  resolveTargeting,
  scaleStickerAbility,
  stickerEffectScale,
  baseFormOf,
} from '../core/catalog';
import { SeededRng } from '../core/rng';
import type {
  AbilityCondition,
  AbilityDef,
  BattleEvent,
  BattleResult,
  CharacterArt,
  EffectOp,
  EffectTarget,
  Passives,
  PublicUnitView,
  TeamId,
  TeamSnapshot,
  TargetingType,
} from '../core/types';
import { MAX_STICKERS, MAX_TEAM } from '../core/types';
import { nextHatchRarity } from '../data/rarity';
import { pickTarget } from './targeting';

const MAX_CYCLES = 48;
const MAX_EVENTS = 8000;
const MAX_DEPTH = 8;

interface AbilityState {
  def: AbilityDef;
  used: boolean;
  stickerId?: string;
  stickerSlot?: number;
}

interface Combatant {
  uid: string;
  defId: string;
  team: TeamId;
  slot: number;
  nameKey: string;
  rarity: PublicUnitView['rarity'];
  atk: number;
  hp: number;
  maxHp: number;
  speed: number;
  stickers: string[];
  art: CharacterArt;
  summoned: boolean;
  dead: boolean;
  dying: boolean;
  targeting: TargetingType;
  passives: Passives;
  abilities: AbilityState[];
  lastTargetId: string | null;
  lastAttackerId: string | null;
  avoidUids: string[];
  attacksDone: number;
  turnsTaken: number;
  hitsTaken: number;
  permanentMods: { atk: number; hp: number; speed: number };
  stickerEffectsSuppressed: boolean;
  silenced: boolean;
  coreAtk: number;
  halfHpTriggered: boolean;
  cheatDeathUsed: boolean;
  cooldownLeft: number;
  /** Set when Cooldown starts during this figure’s own turn, so that turn does not count. */
  cooldownDefer: boolean;
  ravenFlockHp?: number;
  pigRevert?: {
    defId: string;
    nameKey: string;
    rarity: PublicUnitView['rarity'];
    atk: number;
    maxHp: number;
    speed: number;
    targeting: TargetingType;
    passives: Passives;
    abilities: AbilityState[];
    art: CharacterArt;
    coreAtk: number;
  };
  /** Home seat while a Cocoon sticker has this figure on the other line. */
  cocoonHome?: { team: TeamId; slot: number };
  /** Home seat of a figure Purple Widows has wrapped. Cleared when it returns or dies. */
  cocoonWrap?: {
    homeTeam: TeamId;
    homeSlot: number;
    revert: {
      defId: string;
      nameKey: string;
      rarity: PublicUnitView['rarity'];
      atk: number;
      maxHp: number;
      speed: number;
      targeting: TargetingType;
      passives: Passives;
      abilities: AbilityState[];
      art: CharacterArt;
      coreAtk: number;
    };
  };
}

interface SimState {
  rng: SeededRng;
  units: Combatant[];
  events: BattleEvent[];
  depth: number;
  cycle: number;
  deathQueue: string[];
  resolvingDeaths: boolean;
  round: number;
  attackCancelled: boolean;
  pendingAmbush: {
    ambusherId: string;
    attackerId: string;
    into?: string;
    copyStickers?: boolean;
  } | null;
  pendingExtraAttacks: string[];
  drainingExtraAttacks: boolean;
  pendingSideSwitches: Array<{ sourceId: string; targetId: string }>;
  actingId: string | null;
  lostLastRound: Record<TeamId, boolean>;
  lossesThisRun: Record<TeamId, number>;
  graveyard: Array<{ team: TeamId; defId: string; stickers: string[]; permanentMods: Combatant['permanentMods'] }>;
}

function viewOf(u: Combatant): PublicUnitView {
  return {
    uid: u.uid,
    defId: u.defId,
    team: u.team,
    slot: u.slot,
    nameKey: u.nameKey,
    rarity: u.rarity,
    atk: u.atk,
    hp: u.hp,
    maxHp: u.maxHp,
    speed: u.speed,
    stickers: [...u.stickers],
    targeting: u.targeting,
    art: u.art,
    summoned: u.summoned,
    silenced: u.silenced,
    provoke: u.passives.provoke || undefined,
  };
}

function collectAbilities(snapUnit: TeamSnapshot['units'][number]): AbilityState[] {
  const def = getUnit(snapUnit.defId);
  const list: AbilityState[] = [];
  if (def.ability) list.push({ def: def.ability, used: false });
  for (let stickerSlot = 0; stickerSlot < snapUnit.stickerIds.length; stickerSlot++) {
    const sid = snapUnit.stickerIds[stickerSlot]!;
    const ab = getSticker(sid).ability;
    if (!ab) continue;
    list.push({
      def: scaleStickerAbility(ab, stickerEffectScale(snapUnit, sid)),
      used: false,
      stickerId: sid,
      stickerSlot,
    });
  }
  return list;
}

function hydrate(snap: TeamSnapshot, team: TeamId): Combatant[] {
  const statCtx = { stickersGained: snap.stickersGained ?? 0, deathsThisRun: snap.deathsThisRun ?? 0 };
  return snap.units.map((su) => {
    const def = getUnit(su.defId);
    const stats = computedStats(su, statCtx);
    const passives = mergePassives(su);
    const c: Combatant = {
      uid: `${team}:${su.instanceId}`,
      defId: su.defId,
      team,
      slot: su.slot,
      nameKey: def.nameKey,
      rarity: def.rarity,
      atk: stats.atk,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      stickers: [...su.stickerIds],
      art: def.art,
      summoned: def.tags.includes('summon'),
      dead: false,
      dying: false,
      targeting: resolveTargeting(su),
      passives,
      abilities: collectAbilities(su),
      lastTargetId: null,
      lastAttackerId: null,
      avoidUids: [],
      attacksDone: 0,
      turnsTaken: 0,
      hitsTaken: 0,
      permanentMods: { ...su.permanentMods },
      stickerEffectsSuppressed: false,
      silenced: false,
      coreAtk: stats.atk,
      halfHpTriggered: false,
      cheatDeathUsed: false,
      cooldownLeft: 0,
      cooldownDefer: false,
    };
    return c;
  });
}

function living(state: SimState, team?: TeamId): Combatant[] {
  return state.units.filter((u) => !u.dead && u.hp > 0 && (team ? u.team === team : true));
}

function byUid(state: SimState, id: string | null): Combatant | undefined {
  if (!id) return undefined;
  return state.units.find((u) => u.uid === id);
}

function actionOrder(units: Combatant[], rng: SeededRng): Combatant[] {
  const keyed = units.map((u) => ({ u, tie: rng.next() }));
  keyed.sort((a, b) => {
    if (b.u.speed !== a.u.speed) return b.u.speed - a.u.speed;
    return a.tie - b.tie;
  });
  return keyed.map((k) => k.u);
}

/** Turn order for a cycle: teamActsFirst only warps the first combat cycle. */
function cycleActionOrder(state: SimState): Combatant[] {
  const live = living(state);
  if (state.cycle !== 1) return actionOrder(live, state.rng);
  const playerFirst = live.some((u) => u.team === 'player' && u.passives.teamActsFirst);
  const enemyFirst = live.some((u) => u.team === 'enemy' && u.passives.teamActsFirst);
  if (playerFirst === enemyFirst) return actionOrder(live, state.rng);
  const firstTeam: TeamId = playerFirst ? 'player' : 'enemy';
  if (!state.events.some((e) => e.type === 'Log' && e.message === `time:${firstTeam}`)) {
    emit(state, { type: 'Log', message: `time:${firstTeam}` });
  }
  return [
    ...actionOrder(
      live.filter((u) => u.team === firstTeam),
      state.rng,
    ),
    ...actionOrder(
      live.filter((u) => u.team !== firstTeam),
      state.rng,
    ),
  ];
}

function emit(state: SimState, event: BattleEvent): void {
  if (state.events.length >= MAX_EVENTS) return;
  state.events.push(event);
}

function spendSticker(state: SimState, unit: Combatant, stickerId: string, stickerSlot?: number): void {
  emit(state, { type: 'StickerSpent', unitId: unit.uid, stickerId, stickerSlot });
}

function spendPassiveStickers(
  state: SimState,
  unit: Combatant,
  kind: 'cheatDeath' | 'healBelowHalf',
): void {
  unit.stickers.forEach((sid, stickerSlot) => {
    const p = getSticker(sid).passives;
    if (kind === 'cheatDeath' && p?.cheatDeath) spendSticker(state, unit, sid, stickerSlot);
    if (kind === 'healBelowHalf' && (p?.healBelowHalf ?? 0) > 0) spendSticker(state, unit, sid, stickerSlot);
  });
}

function condOk(
  state: SimState,
  c: Combatant,
  cond: AbilityCondition | undefined,
  ctx: { kind?: string; isAttack?: boolean; attackTarget?: Combatant },
): boolean {
  if (!cond || cond.kind === 'always') return true;
  switch (cond.kind) {
    case 'isAttackDamage':
      return Boolean(ctx.isAttack);
    case 'hpFull':
      return c.hp >= c.maxHp;
    case 'hpBelowPct':
      return c.hp / Math.max(1, c.maxHp) <= cond.pct;
    case 'isLastAlly':
      return true;
    case 'firstAttack':
      return c.attacksDone === 0;
    case 'firstNTurns':
      return c.turnsTaken < cond.n;
    case 'sourceIsAttack':
      return Boolean(ctx.isAttack);
    case 'adjacentGold':
      return adjacent(state, c).some((a) => a.rarity === 'gold');
    case 'survivedAttack':
      return Boolean(ctx.isAttack) && c.hp > 0 && !c.dead;
    case 'targetHasHigherAtk':
      return Boolean(ctx.attackTarget && ctx.attackTarget.atk > c.atk);
    case 'targetHasStickers':
      return Boolean(ctx.attackTarget && ctx.attackTarget.stickers.length > 0);
    default:
      return true;
  }
}

function alliesOf(state: SimState, u: Combatant): Combatant[] {
  return living(state, u.team).filter((x) => x.uid !== u.uid);
}

function enemiesOf(state: SimState, u: Combatant): Combatant[] {
  return living(state, u.team === 'player' ? 'enemy' : 'player');
}

function leftAlly(state: SimState, u: Combatant): Combatant | undefined {
  return alliesOf(state, u)
    .filter((a) => a.slot < u.slot)
    .sort((a, b) => b.slot - a.slot)[0];
}

function rightAlly(state: SimState, u: Combatant): Combatant | undefined {
  return alliesOf(state, u)
    .filter((a) => a.slot > u.slot)
    .sort((a, b) => a.slot - b.slot)[0];
}

function immediateBehind(state: SimState, u: Combatant): Combatant | undefined {
  return alliesOf(state, u).find((a) => a.slot === u.slot + 1);
}

function adjacent(state: SimState, u: Combatant): Combatant[] {
  return alliesOf(state, u).filter((a) => Math.abs(a.slot - u.slot) === 1);
}

function resolveTargets(
  state: SimState,
  owner: Combatant,
  sel: EffectTarget,
  ctx: { attackTarget?: Combatant; attacker?: Combatant },
): Combatant[] {
  switch (sel) {
    case 'self':
      return [owner];
    case 'attackTarget':
      // Dying foes still count so on-kill effects can see the KO'd card.
      return ctx.attackTarget && (!ctx.attackTarget.dead || ctx.attackTarget.dying) ? [ctx.attackTarget] : [];
    case 'attacker':
      return ctx.attacker && !ctx.attacker.dead ? [ctx.attacker] : [];
    case 'lastTarget': {
      const last = byUid(state, owner.lastTargetId);
      if (last && !last.dead) return [last];
      const t = aim(state, owner);
      return t ? [t as Combatant] : [];
    }
    case 'leftAlly': {
      const a = leftAlly(state, owner);
      return a ? [a] : [];
    }
    case 'rightAlly': {
      const a = rightAlly(state, owner);
      return a ? [a] : [];
    }
    case 'adjacentAllies':
      return adjacent(state, owner);
    case 'allAllies':
      return alliesOf(state, owner);
    case 'team':
      return living(state, owner.team);
    case 'allEnemies':
      return enemiesOf(state, owner);
    case 'allOthers':
      return living(state).filter((u) => u.uid !== owner.uid);
    case 'randomEnemy': {
      const foes = enemiesOf(state, owner);
      return foes.length ? [state.rng.pick(foes)] : [];
    }
    case 'mirrorEnemy': {
      const foes = enemiesOf(state, owner);
      const m = foes.find((e) => e.slot === owner.slot);
      return m ? [m] : [];
    }
    case 'highestAtkEnemy': {
      const foes = enemiesOf(state, owner).slice().sort((a, b) => {
        if (b.atk !== a.atk) return b.atk - a.atk;
        return a.slot - b.slot;
      });
      return foes[0] ? [foes[0]] : [];
    }
    case 'lowestHpAlly': {
      const al = [...alliesOf(state, owner), owner].filter((x) => !x.dead).sort((a, b) => {
        if (a.hp !== b.hp) return a.hp - b.hp;
        return a.slot - b.slot;
      });
      return al[0] ? [al[0]] : [];
    }
    default:
      return [];
  }
}

function emptySlot(state: SimState, team: TeamId): number | null {
  const used = new Set(living(state, team).map((u) => u.slot));
  for (let s = 1; s <= MAX_TEAM; s++) if (!used.has(s)) return s;
  return null;
}

function blockedBySteadfast(source: Combatant | null, target: Combatant, kind: 'attack' | 'effect' | 'thorns' | 'reflect'): boolean {
  if (!target.passives.steadfast) return false;
  if (!source || source.team === target.team) return false;
  return kind !== 'attack';
}

function scaleBuff(target: Combatant, amount: number, permanent = false): number {
  if (amount > 0 && permanent && target.passives.buffTriple) return amount * 3;
  return amount;
}

function applyOp(state: SimState, source: Combatant, target: Combatant, op: EffectOp, kind: 'effect' | 'attack'): void {
  if (
    blockedBySteadfast(source, target, 'effect') &&
    op.op !== 'transform' &&
    op.op !== 'revertToBase' &&
    op.op !== 'stealCombatSticker' &&
    op.op !== 'copyCombatStickers' &&
    op.op !== 'copyOneCombatSticker' &&
    op.op !== 'silence'
  )
    return;
  switch (op.op) {
    case 'modStat': {
      const permanent = op.duration === 'permanent';
      const amount = scaleBuff(target, op.amount, permanent);
      if (op.stat === 'atk') {
        target.atk = clampStat('atk', target.atk + amount);
        if (permanent) target.permanentMods.atk += amount;
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'atk', amount, now: target.atk, permanent });
      } else if (op.stat === 'speed') {
        target.speed = clampStat('speed', target.speed + amount);
        if (permanent) target.permanentMods.speed += amount;
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'speed', amount, now: target.speed, permanent });
      } else if (op.stat === 'maxHp') {
        target.maxHp = clampStat('maxHp', target.maxHp + amount);
        if (permanent) target.permanentMods.hp += amount;
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'maxHp', amount, now: target.maxHp, permanent });
      } else if (op.stat === 'hp') {
        target.hp = Math.min(target.maxHp, clampStat('hp', target.hp + amount));
        if (amount > 0) emit(state, { type: 'Healed', unitId: target.uid, amount });
        else if (amount < 0) dealDamage(state, source, target, -amount, 'effect', true);
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'hp', amount, now: target.hp, permanent });
      }
      break;
    }
    case 'damage': {
      let amount = op.amount;
      if (op.pctOf && op.pct != null) {
        const base = op.pctOf === 'maxHp' ? target.maxHp : target.hp;
        const raw = base * op.pct;
        amount = op.roundUp ? Math.ceil(raw) : Math.floor(raw);
      }
      if (op.trueDamage && amount >= 99) {
        emit(state, { type: 'Log', message: `death:${target.uid}` });
      }
      dealDamage(state, source, target, amount, kind === 'attack' ? 'attack' : 'effect', Boolean(op.trueDamage));
      break;
    }
    case 'damageFromAtk':
      emit(state, { type: 'Log', message: `revenge:${target.uid}:${Math.max(0, source.atk)}` });
      dealDamage(state, source, target, Math.max(0, source.atk), kind === 'attack' ? 'attack' : 'effect', false);
      break;
    case 'heal': {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + op.amount);
      const gained = target.hp - before;
      if (gained > 0) emit(state, { type: 'Healed', unitId: target.uid, amount: gained });
      break;
    }
    case 'healToFull': {
      const gained = target.maxHp - target.hp;
      if (gained > 0) {
        target.hp = target.maxHp;
        emit(state, { type: 'Healed', unitId: target.uid, amount: gained });
      }
      break;
    }
    case 'summon':
      trySummon(state, source, op.unitId);
      break;
    case 'summonFront':
      summonInFront(state, source, op.unitId);
      break;
    case 'summonFallen':
      trySummonFallen(state, source);
      break;
    case 'stealStat': {
      const from = target;
      const amt = op.amount;
      if (op.stat === 'atk') {
        const take = Math.min(amt, from.atk);
        from.atk = clampStat('atk', from.atk - take);
        source.atk = clampStat('atk', source.atk + take);
        emit(state, { type: 'StatChanged', unitId: from.uid, stat: 'atk', amount: -take, now: from.atk });
        emit(state, { type: 'StatChanged', unitId: source.uid, stat: 'atk', amount: take, now: source.atk });
      } else {
        const take = Math.min(amt, from.speed);
        from.speed = clampStat('speed', from.speed - take);
        source.speed = clampStat('speed', source.speed + take);
        emit(state, { type: 'StatChanged', unitId: from.uid, stat: 'speed', amount: -take, now: from.speed });
        emit(state, { type: 'StatChanged', unitId: source.uid, stat: 'speed', amount: take, now: source.speed });
      }
      break;
    }
    case 'transform':
      transformCombatant(state, target, op);
      break;
    case 'revertToBase':
      revertToBaseVersion(state, target);
      break;
    case 'copyHighestAllyAtk': {
      const pool = living(state, target.team);
      if (!pool.length) break;
      const best = pool.slice().sort((a, b) => b.atk - a.atk || a.slot - b.slot)[0]!;
      const before = target.atk;
      target.atk = clampStat('atk', best.atk);
      emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'atk', amount: target.atk - before, now: target.atk });
      break;
    }
    case 'grantCombatSticker':
      grantCombatSticker(state, source, target, op.source, Boolean(op.permanent));
      break;
    case 'stealCombatSticker':
      stealCombatSticker(state, source, target);
      break;
    case 'peelCombatSticker':
      peelCombatSticker(state, source, target);
      break;
    case 'exhaustAllStickers':
      emit(state, { type: 'Log', message: `forget:${target.uid}` });
      exhaustAllCombatStickers(state, target);
      break;
    case 'trashStickers':
      trashCombatStickers(state, target);
      break;
    case 'applyPoison':
      applyPoison(state, target);
      break;
    case 'copyCombatStickers':
      copyCombatStickers(state, source, target);
      break;
    case 'copyOneCombatSticker':
      copyOneCombatSticker(state, source, target);
      break;
    case 'earnSticker': {
      const sid = offerStickersOfRarity(op.rarity, 1, state.rng)[0];
      if (sid) emit(state, { type: 'EarnedSticker', unitId: source.uid, stickerId: sid });
      break;
    }
    case 'moveForward':
      moveTowardFront(state, target);
      break;
    case 'moveBack':
      moveTowardBack(state, target);
      break;
    case 'moveToLastSlot':
      moveToLastSlot(state, target);
      break;
    case 'charmAttack':
      emit(state, { type: 'ConfusedSkip', unitId: target.uid });
      charmIntoAllyAttack(state, target);
      break;
    case 'switchSides':
      state.pendingSideSwitches.push({ sourceId: source.uid, targetId: target.uid });
      break;
    case 'wrapCocoon':
      wrapCocoon(state, source, target);
      break;
    case 'becomeCocoon':
      becomeCocoon(state, target);
      break;
    case 'pullCocoon':
      pullCocoon(state, source, target);
      break;
    case 'ambush':
      state.attackCancelled = true;
      state.pendingAmbush = {
        ambusherId: source.uid,
        attackerId: target.uid,
        into: op.into,
        copyStickers: op.copyStickers,
      };
      break;
    case 'modRandomStat': {
      const pick = state.rng.pick(op.stats);
      const duration = op.duration;
      const shown = scaleBuff(target, op.amount, duration === 'permanent');
      if (pick === 'atk') {
        applyOp(state, source, target, { op: 'modStat', stat: 'atk', amount: op.amount, duration }, kind);
      } else if (pick === 'speed') {
        applyOp(state, source, target, { op: 'modStat', stat: 'speed', amount: op.amount, duration }, kind);
      } else {
        applyOp(state, source, target, { op: 'modStat', stat: 'maxHp', amount: op.amount, duration }, kind);
        applyOp(state, source, target, { op: 'modStat', stat: 'hp', amount: op.amount, duration }, kind);
      }
      emit(state, { type: 'GiftedStat', unitId: source.uid, recipientId: target.uid, stat: pick, amount: shown });
      break;
    }
    case 'counterAttack':
      emit(state, { type: 'Log', message: `guardian:${source.uid}` });
      strike(state, source, target);
      break;
    case 'extraAttack':
      if (op.noChain && state.drainingExtraAttacks) break;
      if (!target.dead && !target.dying && target.hp > 0) {
        state.pendingExtraAttacks.push(target.uid);
      }
      break;
    case 'doubleAtkHp': {
      const atkGain = target.atk;
      if (atkGain) {
        target.atk = clampStat('atk', target.atk + atkGain);
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'atk', amount: atkGain, now: target.atk });
      }
      const hpGain = target.maxHp;
      if (hpGain) {
        target.maxHp = clampStat('maxHp', target.maxHp + hpGain);
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'maxHp', amount: hpGain, now: target.maxHp });
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + hpGain);
        const gained = target.hp - before;
        if (gained > 0) emit(state, { type: 'Healed', unitId: target.uid, amount: gained });
        emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'hp', amount: gained, now: target.hp });
      }
      break;
    }
    case 'exhaustSticker':
      exhaustCombatSticker(state, target, op.stickerId);
      break;
    case 'grantDiamondStickers':
      grantDiamondStickers(state, source);
      break;
    case 'exhaustUnit': {
      const atk = Math.max(0, source.atk);
      const hp = Math.max(0, source.maxHp);
      const behind = op.giftBehind ? rightAlly(state, source) : undefined;
      if (behind) {
        if (atk) applyOp(state, source, behind, { op: 'modStat', stat: 'atk', amount: atk, duration: 'combat' }, kind);
        if (hp) {
          applyOp(state, source, behind, { op: 'modStat', stat: 'maxHp', amount: hp, duration: 'combat' }, kind);
          applyOp(state, source, behind, { op: 'modStat', stat: 'hp', amount: hp, duration: 'combat' }, kind);
        }
      }
      emit(state, {
        type: 'ExhaustedUnit',
        unitId: source.uid,
        recipientId: behind?.uid ?? null,
        atk,
        hp,
      });
      if (behind) emit(state, { type: 'Log', message: `melt:${source.uid}` });
      break;
    }
    case 'silence':
      silenceCard(state, source, target);
      break;
  }
}

function combatSnap(c: Combatant) {
  return {
    instanceId: c.uid,
    defId: c.defId,
    slot: c.slot,
    stickerIds: [...c.stickers],
    permanentMods: { atk: 0, hp: 0, speed: 0 },
    baseStats: { atk: c.atk, hp: c.maxHp, speed: c.speed },
  };
}

function sharesCombatHp(fromId: string, toId: string): boolean {
  const pairs: Array<[string, string]> = [
    ['cobblers-elves', 'woken-bear'],
    ['jack-in-the-box', 'sprung-jack'],
    ['mimic', 'sprung-mimic'],
  ];
  return pairs.some(([a, b]) => (fromId === a && toId === b) || (fromId === b && toId === a));
}

function rebuildFromDef(c: Combatant): void {
  const def = getUnit(c.defId);
  const snap = combatSnap(c);
  const stats = computedStats(snap);
  const passives = mergePassives(snap);
  c.nameKey = def.nameKey;
  c.rarity = def.rarity;
  c.art = def.art;
  c.atk = stats.atk;
  c.hp = stats.hp;
  c.maxHp = stats.hp;
  c.speed = stats.speed;
  c.coreAtk = stats.atk;
  c.targeting = resolveTargeting(snap);
  c.passives = passives;
  c.abilities = collectAbilities(snap);
}

function transformCombatant(
  state: SimState,
  target: Combatant,
  op: Extract<EffectOp, { op: 'transform' }>,
): void {
  if (target.dead) return;
  const revive = Boolean(op.revive);
  if ((target.dying || target.hp <= 0) && !revive) return;
  let nextId = op.unitId;
  if (op.randomRarity) {
    nextId = randomUnitOfRarity(op.randomRarity, state.rng, target.defId) ?? undefined;
  } else if (op.randomShop) {
    nextId = offerUnits(state.round, 1, state.rng, new Set([target.defId, 'the-egg']))[0];
  } else if (op.randomShopUp) {
    nextId = randomUnitOfRarity(nextHatchRarity(state.round), state.rng, target.defId) ?? undefined;
  }
  if (!nextId || nextId === target.defId) return;
  if (op.untilTurnEnd) {
    applyPigForm(state, target, nextId);
    return;
  }
  const fromId = target.defId;
  if (fromId === 'flock-of-ravens') {
    target.ravenFlockHp = Math.max(0, target.hp);
  }
  if (revive && nextId === 'flock-of-ravens' && target.ravenFlockHp === 0) return;
  const keptHp = target.hp;
  target.defId = nextId;
  rebuildFromDef(target);
  if (sharesCombatHp(fromId, nextId)) {
    target.hp = Math.min(target.maxHp, Math.max(1, keptHp));
  }
  if (nextId === 'flock-of-ravens' && target.ravenFlockHp != null) {
    target.hp = Math.min(target.maxHp, Math.max(1, target.ravenFlockHp));
  }
  target.dead = false;
  target.dying = false;
  emit(state, { type: 'Transformed', unit: viewOf(target), fromId, combat: op.duration === 'combat' });
  maybeSuppressSummon(state, target);
}

function applyPigForm(state: SimState, target: Combatant, pigId: string): void {
  if (target.pigRevert) return;
  const pig = getUnit(pigId);
  const fromId = target.defId;
  target.pigRevert = {
    defId: target.defId,
    nameKey: target.nameKey,
    rarity: target.rarity,
    atk: target.atk,
    maxHp: target.maxHp,
    speed: target.speed,
    targeting: target.targeting,
    passives: { ...target.passives },
    abilities: target.abilities.map((ab) => ({
      def: ab.def,
      used: ab.used,
      stickerId: ab.stickerId,
      stickerSlot: ab.stickerSlot,
    })),
    art: target.art,
    coreAtk: target.coreAtk,
  };
  const hp = Math.max(1, target.hp);
  const maxHp = Math.max(hp, target.maxHp);
  target.defId = pig.id;
  target.nameKey = pig.nameKey;
  target.art = pig.art;
  target.atk = 0;
  target.coreAtk = 0;
  target.speed = clampStat('speed', pig.speed);
  target.hp = hp;
  target.maxHp = maxHp;
  target.targeting = pig.targeting;
  target.passives = { ...pig.passives };
  target.abilities = pig.ability ? [{ def: pig.ability, used: false }] : [];
  emit(state, { type: 'Transformed', unit: viewOf(target), fromId, combat: true });
  refreshChampionAtk(state);
}

function revertPigForm(state: SimState, target: Combatant): void {
  const prev = target.pigRevert;
  if (!prev || target.dead || target.dying) return;
  const fromId = target.defId;
  target.defId = prev.defId;
  target.nameKey = prev.nameKey;
  target.rarity = prev.rarity;
  target.art = prev.art;
  target.atk = clampStat('atk', prev.atk);
  target.coreAtk = clampStat('atk', prev.coreAtk);
  target.maxHp = clampStat('maxHp', prev.maxHp);
  target.hp = Math.min(target.maxHp, clampStat('hp', target.hp));
  target.speed = clampStat('speed', prev.speed);
  target.targeting = prev.targeting;
  target.passives = prev.passives;
  target.abilities = prev.abilities;
  target.pigRevert = undefined;
  emit(state, { type: 'Transformed', unit: viewOf(target), fromId, combat: true });
  if (target.cocoonHome) returnCocoonHome(state, target);
  refreshChampionAtk(state);
}

/** Undo forms (Prince Charming → Frog Prince, pigs, etc.) and rebuild the printed card for this scrap. */
function revertToBaseVersion(state: SimState, target: Combatant): void {
  if (target.dead || target.dying || target.hp <= 0) return;
  if (target.pigRevert) revertPigForm(state, target);
  if (target.dead || target.dying || target.hp <= 0) return;
  const fromId = target.defId;
  const keptHp = target.hp;
  const baseId = baseFormOf(target.defId);
  target.defId = baseId;
  target.stickers = [];
  target.permanentMods = { atk: 0, hp: 0, speed: 0 };
  target.stickerEffectsSuppressed = false;
  rebuildFromDef(target);
  target.hp = Math.min(target.maxHp, Math.max(1, keptHp));
  target.coreAtk = target.atk;
  emit(state, { type: 'Transformed', unit: viewOf(target), fromId, combat: true });
  maybeSuppressSummon(state, target);
  refreshChampionAtk(state);
}

function charmIntoAllyAttack(state: SimState, attacker: Combatant): void {
  if (attacker.dead || attacker.dying || attacker.hp <= 0) return;
  const mates = living(state, attacker.team).filter((a) => a.uid !== attacker.uid);
  if (!mates.length) return;
  resolveAttack(state, attacker, state.rng.pick(mates));
}

function cocoonIsOut(state: SimState): boolean {
  return state.units.some(
    (u) => !u.dead && !u.dying && u.hp > 0 && (u.cocoonWrap || (u.defId === 'silk-cocoon' && u.pigRevert)),
  );
}

/** A side is still in the scrap only while one of its figures is standing on that line. A Cocoon pulled across no longer counts for the side it left. */
function sidePresent(state: SimState, team: TeamId): boolean {
  return living(state, team).length > 0;
}

function seatOnFront(state: SimState, unit: Combatant, team: TeamId): void {
  const fromTeam = unit.team;
  const others = living(state, team)
    .filter((u) => u.uid !== unit.uid)
    .sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid));
  unit.team = team;
  unit.slot = 1;
  emit(state, { type: 'SwitchedSides', unitId: unit.uid, fromTeam, team, slot: 1 });
  others.forEach((u, i) => {
    const dest = i + 2;
    if (u.slot === dest) return;
    const fromSlot = u.slot;
    u.slot = dest;
    emit(state, { type: 'MovedForward', unitId: u.uid, fromSlot, toSlot: dest });
  });
  if (fromTeam !== team) compactLine(state, fromTeam);
}

/** ON HIT: the struck figure becomes a Cocoon, keeping its HP, until that Cocoon takes damage. Only one at a time. */
function becomeCocoon(state: SimState, target: Combatant): void {
  if (target.dead || target.dying || target.hp <= 0) return;
  if (target.defId === 'silk-cocoon' || target.pigRevert || cocoonIsOut(state)) return;
  applyPigForm(state, target, 'silk-cocoon');
}

/** AFTER ATTACK: pull that Cocoon onto this figure’s slot 1 and make sure it has Taunt. */
function pullCocoon(state: SimState, source: Combatant, target: Combatant): void {
  if (source.dead || source.dying || source.hp <= 0) return;
  if (target.dead || target.dying || target.hp <= 0) return;
  if (target.defId !== 'silk-cocoon') return;
  if (!target.cocoonHome) target.cocoonHome = { team: target.team, slot: target.slot };
  if (!target.passives.provoke) {
    target.passives = { ...target.passives, provoke: true };
    emit(state, { type: 'TauntGranted', unitId: target.uid });
  }
  seatOnFront(state, target, source.team);
}

function returnCocoonHome(state: SimState, unit: Combatant): void {
  const home = unit.cocoonHome;
  if (!home) return;
  unit.cocoonHome = undefined;
  const fromTeam = unit.team;
  const mates = living(state, home.team).filter((u) => u.uid !== unit.uid);
  const preferredFree = !mates.some((u) => u.slot === home.slot);
  const open = preferredFree ? home.slot : emptySlot(state, home.team);
  const slot = open ?? mates.reduce((m, u) => Math.max(m, u.slot), 0) + 1;
  unit.team = home.team;
  unit.slot = slot;
  emit(state, { type: 'SwitchedSides', unitId: unit.uid, fromTeam, team: home.team, slot });
  compactLine(state, fromTeam);
  compactLine(state, home.team);
}

/** After the hit lands, wrap the survivor if Purple Widows does not already have a cocoon out. */
function wrapCocoon(state: SimState, source: Combatant, target: Combatant): void {
  if (source.dead || source.dying || source.hp <= 0) return;
  if (target.dead || target.dying || target.hp <= 0) return;
  if (target.team === source.team || target.cocoonWrap || cocoonIsOut(state)) return;
  const cocoon = getUnit('silk-cocoon');
  target.cocoonWrap = {
    homeTeam: target.team,
    homeSlot: target.slot,
    revert: {
      defId: target.defId,
      nameKey: target.nameKey,
      rarity: target.rarity,
      atk: target.atk,
      maxHp: target.maxHp,
      speed: target.speed,
      targeting: target.targeting,
      passives: { ...target.passives },
      abilities: target.abilities.map((ab) => ({
        def: ab.def,
        used: ab.used,
        stickerId: ab.stickerId,
        stickerSlot: ab.stickerSlot,
      })),
      art: target.art,
      coreAtk: target.coreAtk,
    },
  };
  const fromId = target.defId;
  target.defId = cocoon.id;
  target.nameKey = cocoon.nameKey;
  target.rarity = cocoon.rarity;
  target.art = cocoon.art;
  target.atk = 0;
  target.coreAtk = 0;
  target.targeting = cocoon.targeting;
  target.passives = { provoke: true };
  target.abilities = [];
  emit(state, { type: 'Transformed', unit: viewOf(target), fromId, combat: true });
  seatOnFront(state, target, source.team);
  refreshChampionAtk(state);
}

function releaseCocoon(state: SimState, unit: Combatant): void {
  const wrap = unit.cocoonWrap;
  if (!wrap) return;
  if (unit.dead || unit.dying || unit.hp <= 0) {
    unit.cocoonWrap = undefined;
    return;
  }
  const prev = wrap.revert;
  const fromId = unit.defId;
  const fromTeam = unit.team;
  unit.defId = prev.defId;
  unit.nameKey = prev.nameKey;
  unit.rarity = prev.rarity;
  unit.art = prev.art;
  unit.atk = clampStat('atk', prev.atk);
  unit.coreAtk = clampStat('atk', prev.coreAtk);
  unit.maxHp = clampStat('maxHp', prev.maxHp);
  unit.hp = Math.min(unit.maxHp, clampStat('hp', unit.hp));
  unit.speed = clampStat('speed', prev.speed);
  unit.targeting = prev.targeting;
  unit.passives = prev.passives;
  unit.abilities = prev.abilities;
  unit.cocoonWrap = undefined;
  emit(state, { type: 'Transformed', unit: viewOf(unit), fromId, combat: true });
  const home = wrap.homeTeam;
  const mates = living(state, home).filter((u) => u.uid !== unit.uid);
  const preferredFree = !mates.some((u) => u.slot === wrap.homeSlot);
  const open = preferredFree ? wrap.homeSlot : emptySlot(state, home);
  const slot = open ?? mates.reduce((m, u) => Math.max(m, u.slot), 0) + 1;
  unit.team = home;
  unit.slot = slot;
  emit(state, { type: 'SwitchedSides', unitId: unit.uid, fromTeam, team: home, slot });
  compactLine(state, fromTeam);
  compactLine(state, home);
  refreshChampionAtk(state);
}

function releaseLivingCocoons(state: SimState): void {
  for (const u of [...state.units]) {
    if (u.cocoonWrap && !u.dead && u.hp > 0) releaseCocoon(state, u);
  }
}

function switchCombatSides(state: SimState, source: Combatant, target: Combatant): void {
  if (target.dead || target.dying || target.hp <= 0) return;
  if (target.team === source.team) return;
  const fromTeam = target.team;
  const dest = source.team;
  // Max 4 per side. Dying/dead cards free their seat; if the line is full, no switch.
  if (living(state, dest).length >= MAX_TEAM) return;
  const preferred = source.slot;
  const preferredFree = !living(state, dest).some((u) => u.slot === preferred);
  const slot = preferredFree ? preferred : emptySlot(state, dest);
  if (slot === null) return;
  target.team = dest;
  target.slot = slot;
  emit(state, { type: 'SwitchedSides', unitId: target.uid, fromTeam, team: dest, slot });
  compactLine(state, fromTeam);
  compactLine(state, dest);
}

function applyCombatSticker(state: SimState, target: Combatant, stickerId: string, skipCopy = false): void {
  const eat = getUnit(target.defId).passives?.eatStickers;
  if (eat) {
    if (eat.atk) applyOp(state, target, target, { op: 'modStat', stat: 'atk', amount: eat.atk, duration: 'combat' }, 'effect');
    if (eat.hp) {
      applyOp(state, target, target, { op: 'modStat', stat: 'maxHp', amount: eat.hp, duration: 'combat' }, 'effect');
      applyOp(state, target, target, { op: 'modStat', stat: 'hp', amount: eat.hp, duration: 'combat' }, 'effect');
    }
    emit(state, { type: 'AteSticker', unitId: target.uid, stickerId, atk: eat.atk, hp: eat.hp });
    return;
  }
  const st = getSticker(stickerId);
  target.stickers.push(stickerId);
  if (st.ability?.trigger === 'onApply') {
    const share = !skipCopy && getUnit(target.defId).passives?.shareStickerOnApply;
    for (const op of st.ability.effects) applyOp(state, target, target, op, 'effect');
    if (share) {
      const ally = living(state, target.team)
        .filter((u) => u.uid !== target.uid && canAcceptCombatSticker(u))
        .sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid))[0];
      if (ally) applyCombatSticker(state, ally, stickerId, true);
    }
    return;
  }
  if (target.stickerEffectsSuppressed) return;
  const snap = combatSnap(target);
  const n = stickerEffectScale(snap, stickerId);
  if (st.passives?.doubleStats) {
    // Chimps: Mirror doubles then ×3 → multiply by 6 (add 5× current).
    const gain = target.passives.buffTriple ? 5 : 1;
    const atk = target.atk;
    const speed = target.speed;
    const maxHp = target.maxHp;
    const hp = target.hp;
    if (atk) applyOp(state, target, target, { op: 'modStat', stat: 'atk', amount: atk * gain, duration: 'combat' }, 'effect');
    if (speed) applyOp(state, target, target, { op: 'modStat', stat: 'speed', amount: speed * gain, duration: 'combat' }, 'effect');
    if (maxHp) applyOp(state, target, target, { op: 'modStat', stat: 'maxHp', amount: maxHp * gain, duration: 'combat' }, 'effect');
    if (hp) applyOp(state, target, target, { op: 'modStat', stat: 'hp', amount: hp * gain, duration: 'combat' }, 'effect');
  } else if (st.ability) {
    target.abilities.push({
      def: scaleStickerAbility(st.ability, n),
      used: false,
      stickerId,
      stickerSlot: target.stickers.length - 1,
    });
  }
  target.passives = mergePassives(snap);
  target.targeting = resolveTargeting(snap);
  if (st.statMods?.atk) applyOp(state, target, target, { op: 'modStat', stat: 'atk', amount: scaleBuff(target, st.statMods.atk * n, true), duration: 'combat' }, 'effect');
  if (st.statMods?.speed) applyOp(state, target, target, { op: 'modStat', stat: 'speed', amount: scaleBuff(target, st.statMods.speed * n, true), duration: 'combat' }, 'effect');
  if (st.statMods?.hp) {
    const hp = scaleBuff(target, st.statMods.hp * n, true);
    applyOp(state, target, target, { op: 'modStat', stat: 'maxHp', amount: hp, duration: 'combat' }, 'effect');
    applyOp(state, target, target, { op: 'modStat', stat: 'hp', amount: hp, duration: 'combat' }, 'effect');
  }
  if (!skipCopy && getUnit(target.defId).passives?.shareStickerOnApply) {
    const ally = living(state, target.team)
      .filter((u) => u.uid !== target.uid && canAcceptCombatSticker(u))
      .sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid))[0];
    if (ally) applyCombatSticker(state, ally, stickerId, true);
  }
}

function canAcceptCombatSticker(target: Combatant): boolean {
  if (target.dead || target.dying || target.hp <= 0) return false;
  if (getUnit(target.defId).passives?.eatStickers) return true;
  return target.stickers.length < MAX_STICKERS;
}

function stealCombatSticker(state: SimState, thief: Combatant, victim: Combatant): void {
  if (thief.uid === victim.uid) return;
  if (!victim.stickers.length) return;
  const sid = victim.stickers.splice(state.rng.int(victim.stickers.length), 1)[0];
  if (!sid) return;
  const applied = canAcceptCombatSticker(thief);
  emit(state, { type: 'StoleSticker', thiefId: thief.uid, victimId: victim.uid, stickerId: sid, applied });
  if (!victim.stickerEffectsSuppressed) reverseCombatSticker(state, victim, sid);
  if (applied) applyCombatSticker(state, thief, sid);
}

function copyCombatStickers(state: SimState, thief: Combatant, victim: Combatant): void {
  if (thief.uid === victim.uid) return;
  for (const sid of [...victim.stickers]) {
    if (!canAcceptCombatSticker(thief)) break;
    const eats = Boolean(getUnit(thief.defId).passives?.eatStickers);
    applyCombatSticker(state, thief, sid);
    if (!eats) emit(state, { type: 'GainedCombatSticker', unitId: thief.uid, stickerId: sid, sourceId: victim.uid });
  }
}

function copyOneCombatSticker(state: SimState, thief: Combatant, victim: Combatant): void {
  if (thief.uid === victim.uid) return;
  if (!victim.stickers.length || !canAcceptCombatSticker(thief)) return;
  const sid = state.rng.pick(victim.stickers);
  const eats = Boolean(getUnit(thief.defId).passives?.eatStickers);
  applyCombatSticker(state, thief, sid);
  if (!eats) emit(state, { type: 'GainedCombatSticker', unitId: thief.uid, stickerId: sid, sourceId: victim.uid });
}

function peelCombatSticker(state: SimState, _source: Combatant, target: Combatant): void {
  if (!target.stickers.length) return;
  const idx = state.rng.int(target.stickers.length);
  const sid = target.stickers[idx];
  if (!sid) return;
  target.stickers.splice(idx, 1);
  if (!target.stickerEffectsSuppressed) reverseCombatSticker(state, target, sid);
  emit(state, { type: 'PeeledSticker', unitId: target.uid, stickerId: sid, stickerSlot: idx });
  emit(state, { type: 'StickerSpent', unitId: target.uid, stickerId: sid, stickerSlot: idx });
}

function exhaustAllCombatStickers(state: SimState, target: Combatant): void {
  for (const sid of [...target.stickers]) exhaustCombatSticker(state, target, sid);
}

function exhaustCombatSticker(state: SimState, target: Combatant, stickerId: string): void {
  const idx = target.stickers.indexOf(stickerId);
  if (idx < 0) return;
  target.stickers.splice(idx, 1);
  if (!target.stickerEffectsSuppressed) reverseCombatSticker(state, target, stickerId);
  emit(state, { type: 'ExhaustedSticker', unitId: target.uid, stickerId });
}

/** A random Diamond sticker for every figure on this side, then Exhaust Mythic Treasure. */
function grantDiamondStickers(state: SimState, source: Combatant): void {
  const allies = living(state, source.team)
    .slice()
    .sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid));
  for (const ally of allies) {
    const bearer = ally.uid === source.uid && ally.stickers.includes('mythic-treasure');
    if (bearer && !canAcceptCombatSticker(ally)) exhaustCombatSticker(state, ally, 'mythic-treasure');
    if (!canAcceptCombatSticker(ally)) continue;
    const sid = offerStickersOfRarity('diamond', 1, state.rng)[0];
    if (!sid) continue;
    const eats = Boolean(getUnit(ally.defId).passives?.eatStickers);
    applyCombatSticker(state, ally, sid);
    if (eats || !ally.stickers.includes(sid)) continue;
    emit(state, { type: 'GrantedSticker', unitId: ally.uid, stickerId: sid });
  }
  if (source.stickers.includes('mythic-treasure')) exhaustCombatSticker(state, source, 'mythic-treasure');
}

function trashCombatStickers(state: SimState, target: Combatant): void {
  const removed: string[] = [];
  for (let i = 0; i < target.stickers.length; i++) {
    const sid = target.stickers[i];
    if (!sid || sid === 'trash') continue;
    target.stickers[i] = 'trash';
    if (!target.stickerEffectsSuppressed) reverseCombatSticker(state, target, sid, true);
    removed.push(sid);
  }
  if (!removed.length) return;
  emit(state, { type: 'TrashedStickers', unitId: target.uid, removed, stickers: [...target.stickers] });
}

/** One Poison sticker. A free slot gets a new one; a full card converts one random non-Poison sticker. Cap 3. */
function applyPoison(state: SimState, target: Combatant): void {
  if (target.dead || target.dying) return;
  if (target.stickers.filter((id) => id === 'poison').length >= MAX_STICKERS) return;
  if (target.stickers.length < MAX_STICKERS) {
    const before = target.stickers.length;
    applyCombatSticker(state, target, 'poison');
    if (target.stickers.length === before + 1 && target.stickers[target.stickers.length - 1] === 'poison') {
      emit(state, { type: 'PoisonApplied', unitId: target.uid, added: true, removed: null, stickers: [...target.stickers] });
    }
    return;
  }
  const open: number[] = [];
  target.stickers.forEach((id, index) => {
    if (id !== 'poison') open.push(index);
  });
  if (!open.length) return;
  const index = state.rng.pick(open);
  const removed = target.stickers[index]!;
  target.stickers[index] = 'poison';
  if (!target.stickerEffectsSuppressed) {
    reverseCombatSticker(state, target, removed, true);
    const st = getSticker('poison');
    if (st.ability) {
      target.abilities.push({
        def: scaleStickerAbility(st.ability, 1),
        used: false,
        stickerId: 'poison',
        stickerSlot: index,
      });
    }
    const snap = combatSnap(target);
    target.passives = mergePassives(snap);
    target.targeting = resolveTargeting(snap);
  }
  emit(state, { type: 'PoisonApplied', unitId: target.uid, added: false, removed, stickers: [...target.stickers] });
}

function reverseCombatSticker(state: SimState, target: Combatant, stickerId: string, skipDeath = false): void {
  const st = getSticker(stickerId);
  const ghost = { ...combatSnap(target), stickerIds: [...target.stickers, stickerId] };
  const n = stickerEffectScale(ghost, stickerId);
  if (st.statMods?.atk) nudgeCombatStat(state, target, 'atk', -scaleBuff(target, st.statMods.atk * n, true));
  if (st.statMods?.speed) nudgeCombatStat(state, target, 'speed', -scaleBuff(target, st.statMods.speed * n, true));
  if (st.statMods?.hp) {
    const amount = -scaleBuff(target, st.statMods.hp * n, true);
    nudgeCombatStat(state, target, 'maxHp', amount);
    nudgeCombatStat(state, target, 'hp', amount);
  }
  if (st.ability) {
    const i = target.abilities.findIndex((ab) => ab.def.id === st.ability!.id);
    if (i >= 0) target.abilities.splice(i, 1);
  }
  target.passives = mergePassives(combatSnap(target));
  target.targeting = resolveTargeting(combatSnap(target));
  if (!skipDeath && target.hp <= 0) queueDeath(state, target, null);
}

function nudgeCombatStat(state: SimState, target: Combatant, stat: 'atk' | 'speed' | 'maxHp' | 'hp', amount: number): void {
  if (!amount) return;
  if (stat === 'atk') {
    target.atk = clampStat('atk', target.atk + amount);
    emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'atk', amount, now: target.atk });
    return;
  }
  if (stat === 'speed') {
    target.speed = clampStat('speed', target.speed + amount);
    emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'speed', amount, now: target.speed });
    return;
  }
  if (stat === 'maxHp') {
    target.maxHp = clampStat('maxHp', target.maxHp + amount);
    if (target.hp > target.maxHp) target.hp = target.maxHp;
    emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'maxHp', amount, now: target.maxHp });
    return;
  }
  target.hp = Math.min(target.maxHp, clampStat('hp', target.hp + amount));
  emit(state, { type: 'StatChanged', unitId: target.uid, stat: 'hp', amount, now: target.hp });
}

function silenceCard(state: SimState, source: Combatant, target: Combatant): void {
  if (target.dead || target.dying || target.uid === source.uid) return;
  if (target.silenced) return;
  const def = getUnit(target.defId);
  // Stickers stay on the card but look spent; effects are suppressed for this scrap.
  target.stickerEffectsSuppressed = true;
  target.silenced = true;
  target.passives = {};
  target.abilities = [];
  target.targeting = def.targeting;
  // Keep current combat ATK/HP/Speed (Sandman slows and other mods already applied stay).
  target.coreAtk = target.atk;
  emit(state, { type: 'Silenced', sourceId: source.uid, unitId: target.uid });
}

function anyOtherSilencer(state: SimState, exceptUid?: string): boolean {
  return living(state).some((u) => u.uid !== exceptUid && u.passives.silence);
}

function maybeSuppressSummon(state: SimState, c: Combatant): void {
  if (c.passives.silence) return;
  if (!anyOtherSilencer(state, c.uid)) return;
  // Mid-scrap summons: silence as if Ice King is still on the field.
  const source = living(state).find((u) => u.passives.silence);
  if (source) silenceCard(state, source, c);
}

function hasBattleStartAbility(u: Combatant): boolean {
  return u.abilities.some((a) => a.def.trigger === 'battleStart' && !(a.used && a.def.once));
}

/** Resolve Battle Start one card at a time by current Speed; re-sort after each card. */
function resolveBattleStarts(state: SimState): void {
  const pending = new Set(living(state).filter(hasBattleStartAbility).map((u) => u.uid));
  if (!pending.size) {
    // Keep RNG aligned with older fireAbilities(battleStart) which sorted every living card.
    void actionOrder(living(state), state.rng);
    return;
  }
  while (pending.size) {
    const candidates = living(state).filter((u) => pending.has(u.uid) && hasBattleStartAbility(u));
    if (!candidates.length) break;
    const actor = actionOrder(candidates, state.rng)[0];
    if (!actor) break;
    pending.delete(actor.uid);
    emit(state, { type: 'BattleStartAct', unitId: actor.uid });
    fireAbilities(state, 'battleStart', (c) => c.uid === actor.uid, {});
  }
}

function suppressCardEffects(c: Combatant): void {
  const def = getUnit(c.defId);
  c.stickerEffectsSuppressed = true;
  c.silenced = true;
  c.passives = {};
  c.abilities = [];
  c.targeting = def.targeting;
  c.coreAtk = c.atk;
}

function grantCombatSticker(
  state: SimState,
  source: Combatant,
  target: Combatant,
  from: 'shop' | 'behind' | 'mirrorEnemy',
  permanent = false,
): void {
  if (!canAcceptCombatSticker(target)) return;
  let sid: string | undefined;
  if (from === 'shop') {
    sid = offerStickers(1, state.rng, state.round)[0];
  } else if (from === 'behind') {
    const behind = rightAlly(state, source);
    if (!behind?.stickers.length) return;
    sid = state.rng.pick(behind.stickers);
  } else {
    const foe = enemiesOf(state, source).find((e) => e.slot === source.slot);
    if (!foe?.stickers.length) return;
    sid = state.rng.pick(foe.stickers);
  }
  if (!sid) return;
  const eats = Boolean(getUnit(target.defId).passives?.eatStickers);
  applyCombatSticker(state, target, sid);
  if (eats) return;
  if (!target.stickers.includes(sid)) return;
  if (permanent) emit(state, { type: 'GrantedSticker', unitId: target.uid, stickerId: sid });
  else emit(state, { type: 'GainedCombatSticker', unitId: target.uid, stickerId: sid, sourceId: source.uid });
}

function swapCombatSlots(state: SimState, a: Combatant, b: Combatant): void {
  if (a.uid === b.uid) return;
  const sa = a.slot;
  a.slot = b.slot;
  b.slot = sa;
  emit(state, { type: 'SlotsSwapped', aId: a.uid, bId: b.uid });
}

function moveToLastSlot(state: SimState, target: Combatant): void {
  if (target.dead || target.dying || target.hp <= 0) return;
  const line = living(state, target.team).slice().sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid));
  const last = line[line.length - 1];
  if (!last || last.uid === target.uid) return;
  const fromSlot = target.slot;
  const toSlot = last.slot;
  for (const u of line) {
    if (u.uid === target.uid) continue;
    if (u.slot <= fromSlot || u.slot > toSlot) continue;
    const prev = u.slot;
    u.slot = prev - 1;
    emit(state, { type: 'MovedForward', unitId: u.uid, fromSlot: prev, toSlot: u.slot });
  }
  target.slot = toSlot;
  emit(state, { type: 'Log', message: `fear:${target.uid}` });
  emit(state, { type: 'MovedToBack', unitId: target.uid, fromSlot, toSlot });
}

function moveTowardBack(state: SimState, target: Combatant): void {
  const dest = target.slot + 1;
  const occupant = state.units.find((u) => u.team === target.team && u.slot === dest && !u.dead);
  if (!occupant) return;
  swapCombatSlots(state, target, occupant);
}

function moveTowardFront(state: SimState, target: Combatant): void {
  const dest = target.slot - 1;
  if (dest < 1) return;
  const occupant = state.units.find((u) => u.team === target.team && u.slot === dest && !u.dead);
  const fromSlot = target.slot;
  if (occupant) swapCombatSlots(state, target, occupant);
  else {
    target.slot = dest;
    emit(state, { type: 'MovedForward', unitId: target.uid, fromSlot, toSlot: dest });
  }
}

function summonInFront(state: SimState, source: Combatant, unitId: string): void {
  if (source.dead || source.dying || source.hp <= 0) return;
  const mates = living(state, source.team);
  if (mates.length >= MAX_TEAM || mates.some((u) => u.slot >= MAX_TEAM)) return;
  const backFirst = [...mates].sort((a, b) => b.slot - a.slot || b.uid.localeCompare(a.uid));
  for (const u of backFirst) {
    const fromSlot = u.slot;
    u.slot = fromSlot + 1;
    emit(state, { type: 'MovedToBack', unitId: u.uid, fromSlot, toSlot: u.slot });
  }
  trySummon(state, source, unitId);
}

function trySummon(state: SimState, source: Combatant, unitId: string): void {
  const slot = emptySlot(state, source.team);
  if (slot === null) return;
  const def = getUnit(unitId);
  const uid = `${source.team}:summon:${unitId}:${state.events.length}`;
  const c: Combatant = {
    uid,
    defId: def.id,
    team: source.team,
    slot,
    nameKey: def.nameKey,
    rarity: def.rarity,
    atk: def.atk,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    stickers: [],
    art: def.art,
    summoned: true,
    dead: false,
    dying: false,
    targeting: def.targeting,
    passives: { ...def.passives },
    abilities: def.ability ? [{ def: def.ability, used: false }] : [],
    lastTargetId: null,
    lastAttackerId: null,
    avoidUids: [],
    attacksDone: 0,
    turnsTaken: 0,
    hitsTaken: 0,
    permanentMods: { atk: 0, hp: 0, speed: 0 },
    stickerEffectsSuppressed: false,
    silenced: false,
    coreAtk: def.atk,
    halfHpTriggered: false,
    cheatDeathUsed: false,
    cooldownLeft: 0,
    cooldownDefer: false,
  };
  state.units.push(c);
  emit(state, { type: 'Summoned', unit: viewOf(c) });
  maybeSuppressSummon(state, c);
}

function trySummonFallen(state: SimState, source: Combatant): void {
  const slot = emptySlot(state, source.team);
  if (slot === null) return;
  let idx = -1;
  for (let i = state.graveyard.length - 1; i >= 0; i--) {
    const fallen = state.graveyard[i]!;
    if (fallen.team === source.team && fallen.defId !== source.defId) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;
  const fallen = state.graveyard.splice(idx, 1)[0];
  if (!fallen) return;
  emit(state, { type: 'Log', message: `rise:${source.uid}` });
  const snap = {
    instanceId: `fallen:${fallen.defId}:${state.events.length}`,
    defId: fallen.defId,
    slot,
    stickerIds: [...fallen.stickers],
    permanentMods: { ...fallen.permanentMods },
    baseStats: { atk: 0, hp: 1, speed: 0 },
  };
  const def = getUnit(fallen.defId);
  const stats = computedStats(snap);
  const passives = mergePassives(snap);
  const c: Combatant = {
    uid: `${source.team}:summon:${fallen.defId}:${state.events.length}`,
    defId: def.id,
    team: source.team,
    slot,
    nameKey: def.nameKey,
    rarity: def.rarity,
    atk: stats.atk,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    stickers: [...fallen.stickers],
    art: def.art,
    summoned: true,
    dead: false,
    dying: false,
    targeting: resolveTargeting(snap),
    passives,
    abilities: collectAbilities(snap),
    lastTargetId: null,
    lastAttackerId: null,
    avoidUids: [],
    attacksDone: 0,
    turnsTaken: 0,
    hitsTaken: 0,
    permanentMods: { ...fallen.permanentMods },
    stickerEffectsSuppressed: false,
    silenced: false,
    coreAtk: stats.atk,
    halfHpTriggered: false,
    cheatDeathUsed: false,
    cooldownLeft: 0,
    cooldownDefer: false,
  };
  state.units.push(c);
  emit(state, { type: 'Summoned', unit: viewOf(c) });
  maybeSuppressSummon(state, c);
  refreshChampionAtk(state);
}

function fireAbilities(
  state: SimState,
  trigger: AbilityDef['trigger'],
  ownerFilter: (c: Combatant) => boolean,
  ctx: { attackTarget?: Combatant; attacker?: Combatant; kind?: string; isAttack?: boolean },
): void {
  if (state.depth >= MAX_DEPTH || state.events.length >= MAX_EVENTS) {
    emit(state, { type: 'Log', message: 'trigger-depth-cap' });
    return;
  }
  state.depth += 1;
  const owners = actionOrder(
    state.units.filter((u) => (trigger === 'scrapEnded' || !u.dead) && ownerFilter(u)),
    state.rng,
  );
  for (const owner of owners) {
    for (const ab of owner.abilities) {
      if (ab.def.trigger !== trigger) continue;
      if (ab.used && ab.def.once) continue;
      if (!condOk(state, owner, ab.def.condition, ctx)) continue;
      const targets = resolveTargets(state, owner, ab.def.target, ctx);
      if (ab.def.once) {
        ab.used = true;
        if (ab.stickerId) spendSticker(state, owner, ab.stickerId, ab.stickerSlot);
      }
      for (const t of targets) {
        for (const op of ab.def.effects) applyOp(state, owner, t, op, 'effect');
      }
    }
  }
  state.depth -= 1;
  flushDeaths(state);
}

function aim(state: SimState, owner: Combatant): Combatant | null {
  const foes = enemiesOf(state, owner);
  const provoked = foes.filter((e) => e.passives.provoke && !e.dead && e.hp > 0).map((e) => e.uid);
  return pickTarget(owner.targeting, owner, foes, {
    ignoreProvoke: Boolean(owner.passives.ignoreProvoke),
    provoked,
    avoid: owner.avoidUids,
  }) as Combatant | null;
}

function noteAttackContact(
  state: SimState,
  source: Combatant | null,
  target: Combatant,
  kind: 'attack' | 'effect' | 'thorns' | 'reflect',
): void {
  if (kind !== 'attack' || !source) return;
  fireAbilities(state, 'damageReceived', (c) => c.uid === target.uid, {
    attackTarget: target,
    attacker: source,
    isAttack: true,
  });
}

function dealDamage(
  state: SimState,
  source: Combatant | null,
  target: Combatant,
  amount: number,
  kind: 'attack' | 'effect' | 'thorns' | 'reflect',
  trueDamage = false,
): void {
  if (target.dead || target.dying || amount <= 0) return;
  if (blockedBySteadfast(source, target, kind)) return;
  if (kind === 'attack' && !trueDamage && target.passives.evade) {
    const others = living(state, target.team).filter((a) => a.uid !== target.uid);
    if (others.length) {
      swapCombatSlots(state, target, state.rng.pick(others));
      emit(state, { type: 'DamageReceived', unitId: target.uid, amount: 0, sourceId: source?.uid ?? null, absorbed: true });
      emit(state, {
        type: 'Evaded',
        unitId: target.uid,
        sourceId: source?.uid ?? null,
        reflected: Boolean(target.passives.evadeReflect && source),
      });
      emit(state, { type: 'Log', message: `evade:${target.uid}` });
      if (target.passives.evadeReflect && source && source.uid !== target.uid && !source.dead) {
        dealDamage(state, target, source, amount, 'reflect', false);
      }
      return;
    }
  }
  let dmg = amount;
  const firstHit = target.hitsTaken === 0;
  target.hitsTaken += 1;
  if (!trueDamage && firstHit && (target.passives.firstHitReduce ?? 0) > 0) {
    dmg = Math.max(0, dmg - (target.passives.firstHitReduce ?? 0));
  }
  if (dmg <= 0) {
    emit(state, { type: 'DamageReceived', unitId: target.uid, amount: 0, sourceId: source?.uid ?? null, absorbed: true });
    noteAttackContact(state, source, target, kind);
    return;
  }
  const hpBefore = target.hp;
  const cocoonTakingDamage = target.defId === 'silk-cocoon' && Boolean(target.pigRevert);
  target.hp -= dmg;
  if (target.hp <= 0 && target.passives.cheatDeath && !target.cheatDeathUsed) {
    target.cheatDeathUsed = true;
    target.hp = 1;
    emit(state, { type: 'Log', message: `cheat-death:${target.uid}` });
    spendPassiveStickers(state, target, 'cheatDeath');
  }
  const lethal = target.hp <= 0;
  emit(state, {
    type: 'DamageDealt',
    sourceId: source?.uid ?? 'effect',
    targetId: target.uid,
    amount: dmg,
    lethal,
    kind,
  });
  emit(state, { type: 'DamageReceived', unitId: target.uid, amount: dmg, sourceId: source?.uid ?? null, absorbed: false });
  if (source && source.uid !== target.uid) target.lastAttackerId = source.uid;

  if (kind === 'attack' && source) {
    fireAbilities(state, 'damageDealt', (c) => c.uid === source.uid, {
      attackTarget: target,
      attacker: source,
      isAttack: true,
    });
    fireAbilities(state, 'damageReceived', (c) => c.uid === target.uid, {
      attackTarget: target,
      attacker: source,
      isAttack: true,
    });
    if ((source.passives.lifesteal ?? 0) > 0 && !source.dead && !source.dying) {
      const heal = source.passives.lifesteal ?? 0;
      source.hp = Math.min(source.maxHp, source.hp + heal);
      emit(state, { type: 'Healed', unitId: source.uid, amount: heal });
    }
  } else if (kind !== 'thorns') {
    fireAbilities(state, 'damageReceived', (c) => c.uid === target.uid, {
      attackTarget: target,
      attacker: source ?? undefined,
      isAttack: false,
    });
  }

  if (target.hp > 0) triggerBelowHalf(state, target, hpBefore);
  if (cocoonTakingDamage && !target.dead && !target.dying) revertPigForm(state, target);
  // Resolve kill (and on-kill like Steal) before thorns/reflect, or a lethal retaliate
  // marks the killer dead and skips unitKilled entirely.
  if (target.hp <= 0) queueDeath(state, target, source);

  if (
    kind === 'attack' &&
    source &&
    !source.dead &&
    !source.dying &&
    (target.passives.thorns ?? 0) > 0 &&
    !blockedBySteadfast(target, source, 'thorns')
  ) {
    dealDamage(state, target, source, target.passives.thorns ?? 0, 'thorns', false);
  }

  if (
    source &&
    source.uid !== target.uid &&
    !source.dead &&
    !source.dying &&
    kind !== 'reflect' &&
    target.passives.reflectDamageTaken
  ) {
    dealDamage(state, target, source, dmg, 'reflect', false);
  }
}

function triggerBelowHalf(state: SimState, target: Combatant, hpBefore: number): void {
  if (target.halfHpTriggered || target.dead || target.dying || target.hp <= 0) return;
  if (hpBefore * 2 > target.maxHp && target.hp * 2 <= target.maxHp) {
    target.halfHpTriggered = true;
    const heal = target.passives.healBelowHalf ?? 0;
    if (heal > 0) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + heal);
      const gained = target.hp - before;
      if (gained > 0) emit(state, { type: 'Healed', unitId: target.uid, amount: gained });
      spendPassiveStickers(state, target, 'healBelowHalf');
    }
  }
}

function queueDeath(state: SimState, target: Combatant, source: Combatant | null): void {
  if (target.dying || target.dead) return;
  target.dying = true;
  target.hp = 0;
  if (source && !source.dead) {
    emit(state, { type: 'UnitKilled', killerId: source.uid, victimId: target.uid });
  }
  state.deathQueue.push(target.uid);
  if (source && !source.dead) {
    fireAbilities(state, 'unitKilled', (c) => c.uid === source.uid, { attackTarget: target, attacker: source });
  }
}

function printedCombatDefId(c: Combatant): string {
  if (c.pigRevert) return c.pigRevert.defId;
  if (c.defId === 'flock-of-ravens') return 'king-of-crows';
  return c.defId;
}

function rewindMaster(state: SimState, victim: Combatant): Combatant | undefined {
  return state.units.find(
    (u) =>
      u.team === victim.team &&
      u.passives.rewind &&
      !u.silenced &&
      u.cooldownLeft <= 0 &&
      !u.dead &&
      (u.uid === victim.uid || (!u.dying && u.hp > 0)),
  );
}

function flushDeaths(state: SimState): void {
  if (state.resolvingDeaths) return;
  state.resolvingDeaths = true;
  while (state.deathQueue.length) {
    const id = state.deathQueue.shift()!;
    const victim = byUid(state, id);
    if (!victim || victim.dead) continue;
    fireAbilities(state, 'onDeath', (c) => c.uid === victim.uid, { attacker: byUid(state, victim.lastAttackerId) });
    if (victim.hp > 0 && !victim.dead) {
      state.pendingSideSwitches = state.pendingSideSwitches.filter((p) => p.sourceId !== victim.uid);
      victim.dying = false;
      emit(state, { type: 'Revived', unitId: victim.uid, hp: victim.hp });
      continue;
    }
    const master = rewindMaster(state, victim);
    if (master) {
      master.cooldownLeft = Math.max(1, master.passives.cooldown ?? 1);
      if (state.actingId === master.uid) master.cooldownDefer = true;
      state.pendingSideSwitches = state.pendingSideSwitches.filter((p) => p.sourceId !== victim.uid);
      victim.dying = false;
      victim.hp = victim.maxHp;
      emit(state, {
        type: 'Rewound',
        unitId: victim.uid,
        death: getUnit(printedCombatDefId(victim)).art.death,
        hp: victim.hp,
      });
      continue;
    }
    const pendingSwitches = state.pendingSideSwitches.filter((p) => p.sourceId === victim.uid);
    state.pendingSideSwitches = state.pendingSideSwitches.filter((p) => p.sourceId !== victim.uid);
    if (pendingSwitches.length) emit(state, { type: 'Log', message: `haha:${victim.uid}` });
    const death = getUnit(printedCombatDefId(victim)).art.death;
    emit(state, { type: 'UnitDied', unitId: victim.uid, death });
    for (const p of pendingSwitches) {
      const killer = byUid(state, p.targetId);
      if (killer) switchCombatSides(state, victim, killer);
    }
    state.graveyard.push({
      team: victim.team,
      defId: printedCombatDefId(victim),
      stickers: [...victim.stickers],
      permanentMods: { ...victim.permanentMods },
    });
    for (const u of living(state)) {
      const amt = u.passives.atkPerGameDeath ?? 0;
      if (!amt) continue;
      u.atk = clampStat('atk', u.atk + amt);
      u.coreAtk = clampStat('atk', u.coreAtk + amt);
      emit(state, { type: 'StatChanged', unitId: u.uid, stat: 'atk', amount: amt, now: u.atk });
    }
    refreshChampionAtk(state);
    const allies = state.units.filter((u) => u.team === victim.team && u.uid !== victim.uid && !u.dead);
    const enemies = state.units.filter((u) => u.team !== victim.team && !u.dead);
    for (const a of actionOrder(allies, state.rng)) {
      emit(state, { type: 'AllyDied', watcherId: a.uid, deadId: victim.uid });
    }
    fireAbilities(state, 'allyDied', (c) => c.team === victim.team && c.uid !== victim.uid && !c.dead, {
      attackTarget: victim,
    });
    for (const e of actionOrder(enemies, state.rng)) {
      emit(state, { type: 'EnemyDied', watcherId: e.uid, deadId: victim.uid });
    }
    fireAbilities(state, 'enemyDied', (c) => c.team !== victim.team && !c.dead, { attackTarget: victim });
    fireAbilities(state, 'anyDied', (c) => c.uid !== victim.uid && !c.dead && c.hp > 0, { attackTarget: victim });
    victim.dead = true;
    victim.dying = false;
    compactLine(state, victim.team);
  }
  state.resolvingDeaths = false;
}

function compactLine(state: SimState, team: TeamId): void {
  const live = living(state, team).slice().sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid));
  live.forEach((u, i) => {
    const dest = i + 1;
    if (u.slot === dest) return;
    const fromSlot = u.slot;
    u.slot = dest;
    emit(state, { type: 'MovedForward', unitId: u.uid, fromSlot, toSlot: dest });
  });
}

function refreshChampionAtk(state: SimState): void {
  for (const u of living(state)) {
    if (!u.passives.championAtk) continue;
    const peak = state.units
      .filter((x) => x.uid !== u.uid && !x.dead && x.hp > 0)
      .reduce((m, x) => Math.max(m, x.passives.championAtk ? x.coreAtk : x.atk), 0);
    const next = clampStat('atk', peak + 1);
    if (u.atk === next) continue;
    const amount = next - u.atk;
    u.atk = next;
    emit(state, { type: 'StatChanged', unitId: u.uid, stat: 'atk', amount, now: u.atk });
  }
}

function attackDamageBonus(_state: SimState, u: Combatant, target: Combatant): number {
  let bonus = 0;
  if (target.hp * 2 <= target.maxHp) bonus += u.passives.bonusVsLowHp ?? 0;
  if (target.atk > u.atk) bonus += u.passives.bonusIfTargetHigherAtk ?? 0;
  bonus += (u.passives.atkPerTargetSticker ?? 0) * target.stickers.length;
  return bonus;
}

function isAmbushWaiting(u: Combatant): boolean {
  return u.abilities.some((a) => !a.used && a.def.effects.some((e) => e.op === 'ambush'));
}

function refusesToAttack(u: Combatant): boolean {
  return u.targeting === 'pacifist' || isAmbushWaiting(u);
}

function extraAttacksThisTurn(state: SimState, u: Combatant): number {
  let n = u.passives.extraAttacks ?? 0;
  if (state.lostLastRound[u.team]) n += u.passives.extraAttacksIfLostLastRound ?? 0;
  return Math.max(0, n);
}

function resolveAttack(state: SimState, u: Combatant, target: Combatant): void {
  if (refusesToAttack(u) || u.dead || target.dead || u.atk <= 0) return;
  if (u.team !== target.team) {
    if (target.passives.provoke) {
      emit(state, { type: 'Log', message: `taunt:${target.uid}` });
    }
    state.attackCancelled = false;
    state.pendingAmbush = null;
    fireAbilities(
      state,
      'whenTargeted',
      (c) => c.uid === target.uid || (Boolean(c.passives.guardian) && immediateBehind(state, c)?.uid === target.uid),
      {
        attackTarget: target,
        attacker: u,
        isAttack: true,
      },
    );
    if (state.attackCancelled) {
      state.attackCancelled = false;
      const pend = state.pendingAmbush;
      state.pendingAmbush = null;
      emit(state, { type: 'AttackStarted', unitId: u.uid, targetId: target.uid, cancelled: true });
      if (pend) {
        const ambusher = byUid(state, pend.ambusherId);
        const attacker = byUid(state, pend.attackerId) ?? u;
        if (ambusher && !ambusher.dead) {
          if (pend.copyStickers) copyCombatStickers(state, ambusher, attacker);
          if (pend.into) {
            transformCombatant(state, ambusher, { op: 'transform', unitId: pend.into, duration: 'combat' });
          }
          emit(state, { type: 'Ambushed', unitId: ambusher.uid, attackerId: u.uid });
        }
      }
      if (!u.dead && !target.dead) strike(state, target, u);
      return;
    }
  }
  strike(state, u, target);
}

function strike(state: SimState, u: Combatant, target: Combatant): void {
  if (refusesToAttack(u) || u.dead || target.dead || u.atk <= 0) return;
  u.lastTargetId = target.uid;
  emit(state, { type: 'BeforeAttack', unitId: u.uid, targetId: target.uid });
  fireAbilities(state, 'beforeAttack', (c) => c.uid === u.uid, { attackTarget: target, attacker: u, isAttack: true });
  if (u.dead || target.dead) return;
  emit(state, { type: 'AttackStarted', unitId: u.uid, targetId: target.uid });
  fireAbilities(state, 'attackStarted', (c) => c.uid === u.uid, { attackTarget: target, attacker: u, isAttack: true });
  const curse = u.passives.curseAtk ?? 0;
  if (curse > 0 && u.team !== target.team && !target.dead && !target.dying) {
    applyOp(state, u, target, { op: 'modStat', stat: 'atk', amount: -curse, duration: 'combat' }, 'effect');
    emit(state, { type: 'Log', message: `curse:${target.uid}:${curse}` });
  }
  if (u.passives.heartseeker && u.team !== target.team && !target.avoidUids.includes(u.uid)) {
    target.avoidUids.push(u.uid);
  }
  const dmg = Math.max(1, u.atk + attackDamageBonus(state, u, target));
  dealDamage(state, u, target, dmg, 'attack', false);
  u.attacksDone += 1;
  fireAbilities(state, 'afterAttack', (c) => c.uid === u.uid, { attackTarget: target, attacker: u, isAttack: true });
  flushDeaths(state);
  drainExtraAttacks(state);
}

function performAttack(state: SimState, u: Combatant): void {
  if (refusesToAttack(u) || u.atk <= 0) return;
  if ((u.passives.drunkChance ?? 0) > 0) {
    const roll = state.rng.next();
    if (roll < 0.25) {
      emit(state, { type: 'ConfusedSkip', unitId: u.uid });
      return;
    }
    if (roll < 0.5) {
      const allies = living(state, u.team).filter((a) => a.uid !== u.uid);
      if (allies.length) {
        emit(state, { type: 'ConfusedSkip', unitId: u.uid });
        resolveAttack(state, u, state.rng.pick(allies));
        return;
      }
    }
  }
  if (u.targeting === 'flock') {
    const foes = enemiesOf(state, u).slice().sort((a, b) => a.slot - b.slot || a.uid.localeCompare(b.uid));
    const rest = u.avoidUids.length ? foes.filter((foe) => !u.avoidUids.includes(foe.uid)) : foes;
    const pool = rest.length ? rest : foes;
    for (const foe of pool) {
      if (u.dead || u.dying) break;
      if (foe.dead || foe.dying || foe.hp <= 0) continue;
      resolveAttack(state, u, foe);
    }
    return;
  }
  let target = aim(state, u);
  if (!target) return;
  resolveAttack(state, u, target);
}

function drainExtraAttacks(state: SimState): void {
  if (state.drainingExtraAttacks) return;
  state.drainingExtraAttacks = true;
  while (state.pendingExtraAttacks.length) {
    const id = state.pendingExtraAttacks.shift()!;
    const u = byUid(state, id);
    if (u && !u.dead && !u.dying && u.hp > 0) performAttack(state, u);
  }
  state.drainingExtraAttacks = false;
}

function takeTurn(state: SimState, u: Combatant): void {
  if (u.dead) return;
  state.actingId = u.uid;
  refreshChampionAtk(state);
  emit(state, { type: 'TurnStarted', unitId: u.uid, cycle: state.cycle });
  fireAbilities(state, 'turnStarted', (c) => c.uid === u.uid, {});
  if (!u.dead && !u.dying && u.hp > 0) performAttack(state, u);
  const extras = extraAttacksThisTurn(state, u);
  for (let i = 0; i < extras; i++) {
    if (u.dead || u.dying || u.hp <= 0) break;
    performAttack(state, u);
  }
  u.turnsTaken += 1;
  u.avoidUids = [];
  emit(state, { type: 'TurnEnded', unitId: u.uid });
  fireAbilities(state, 'turnEnded', (c) => c.uid === u.uid, {});
  if (u.cocoonWrap) releaseCocoon(state, u);
  if (!(u.defId === 'silk-cocoon' && u.pigRevert)) revertPigForm(state, u);
  flushDeaths(state);
  if (u.cooldownLeft > 0 && !u.cooldownDefer) u.cooldownLeft -= 1;
  u.cooldownDefer = false;
  state.actingId = null;
}

function teamAlive(state: SimState, team: TeamId): boolean {
  return living(state, team).length > 0;
}

function scoreTeam(state: SimState, team: TeamId) {
  const live = living(state, team);
  const hp = live.reduce((s, u) => s + u.hp, 0);
  const max = live.reduce((s, u) => s + u.maxHp, 0) || 1;
  const atk = live.reduce((s, u) => s + u.atk, 0);
  return { count: live.length, hp, hpPct: hp / max, atk };
}

function isPacifistUnit(u: Combatant): boolean {
  return u.targeting === 'pacifist';
}

/** True when both sides still have units and every living unit is Pacifist. */
function onlyPacifistsRemain(state: SimState): boolean {
  if (!teamAlive(state, 'player') || !teamAlive(state, 'enemy')) return false;
  const live = living(state);
  return live.length > 0 && live.every(isPacifistUnit);
}

/** A card that will swing as soon as it has attack, even if attack is still 0. */
function wouldSwingIfBuffed(u: Combatant): boolean {
  return !refusesToAttack(u);
}

function formBecomesAttacker(defId: string, seen: Set<string>): boolean {
  if (seen.has(defId)) return false;
  seen.add(defId);
  const def = getUnit(defId);
  if (def.targeting !== 'pacifist' && def.atk > 0) return true;
  const ab = def.ability;
  if (!ab || (ab.trigger !== 'turnStarted' && ab.trigger !== 'turnEnded')) return false;
  return ab.effects.some((e) => e.op === 'transform' && Boolean(e.unitId) && formBecomesAttacker(e.unitId, seen));
}

function atkGrantRecipients(state: SimState, u: Combatant, sel: EffectTarget): Combatant[] {
  switch (sel) {
    case 'self':
      return [u];
    case 'leftAlly': {
      const a = leftAlly(state, u);
      return a ? [a] : [];
    }
    case 'rightAlly': {
      const a = rightAlly(state, u);
      return a ? [a] : [];
    }
    case 'adjacentAllies':
      return adjacent(state, u);
    case 'allAllies':
      return alliesOf(state, u);
    case 'team':
      return living(state, u.team);
    default:
      return living(state).filter((x) => x.uid !== u.uid);
  }
}

function effectCanRaiseAtk(e: EffectOp): boolean {
  if (e.op === 'modStat' && e.stat === 'atk' && e.amount > 0) return true;
  if (e.op === 'modRandomStat' && e.amount > 0 && e.stats.includes('atk')) return true;
  if (e.op === 'grantCombatSticker' || e.op === 'copyHighestAllyAtk' || e.op === 'doubleAtkHp') return true;
  if (e.op === 'stealStat' && e.stat === 'atk' && e.amount > 0) return true;
  return false;
}

/** This card will deal damage, or wake someone who will, without waiting to be hit. */
function pressesTheFight(state: SimState, u: Combatant): boolean {
  if (wouldSwingIfBuffed(u) && u.atk > 0) return true;
  if (u.silenced) return false;
  for (const a of u.abilities) {
    if (a.used) continue;
    if (a.def.trigger !== 'turnStarted' && a.def.trigger !== 'turnEnded') continue;
    const recipients = atkGrantRecipients(state, u, a.def.target);
    for (const e of a.def.effects) {
      if (e.op === 'damage' || e.op === 'damageFromAtk') return true;
      if (e.op === 'charmAttack' || e.op === 'extraAttack' || e.op === 'counterAttack') return true;
      if (e.op === 'summon' || e.op === 'summonFallen') return true;
      if (e.op === 'transform') {
        if (e.unitId && formBecomesAttacker(e.unitId, new Set())) return true;
        if (e.randomShop || e.randomShopUp || e.randomRarity) return true;
      }
      if (effectCanRaiseAtk(e) && recipients.some(wouldSwingIfBuffed)) return true;
    }
  }
  return false;
}

/** Both sides are still up, and nobody left will land a hit on their own. */
function scrapIsStalemate(state: SimState): boolean {
  if (!teamAlive(state, 'player') || !teamAlive(state, 'enemy')) return false;
  return living(state).every((u) => !pressesTheFight(state, u));
}

function decideWinner(state: SimState, timedOut: boolean, stalled: boolean): BattleResult['winner'] {
  if (stalled) return 'draw';
  const p = teamAlive(state, 'player');
  const e = teamAlive(state, 'enemy');
  if (p && !e) return 'player';
  if (e && !p) return 'enemy';
  if (!p && !e) return 'draw';
  const ps = scoreTeam(state, 'player');
  const es = scoreTeam(state, 'enemy');
  // Nobody left is willing to swing: the scrap is a draw, even if one side has more cards.
  if (onlyPacifistsRemain(state)) return 'draw';
  if (ps.count !== es.count) return ps.count > es.count ? 'player' : 'enemy';
  if (ps.hpPct !== es.hpPct) return ps.hpPct > es.hpPct ? 'player' : 'enemy';
  if (ps.atk !== es.atk) return ps.atk > es.atk ? 'player' : 'enemy';
  return timedOut ? 'draw' : 'draw';
}

export function simulateBattle(a: TeamSnapshot, b: TeamSnapshot, seed: number): BattleResult {
  const state: SimState = {
    rng: new SeededRng(seed),
    units: [...hydrate(a, 'player'), ...hydrate(b, 'enemy')],
    events: [],
    depth: 0,
    cycle: 0,
    deathQueue: [],
    resolvingDeaths: false,
    round: a.round,
    attackCancelled: false,
    pendingAmbush: null,
    pendingExtraAttacks: [],
    drainingExtraAttacks: false,
    pendingSideSwitches: [],
    actingId: null,
    lostLastRound: {
      player: Boolean(a.lostLastRound),
      enemy: Boolean(b.lostLastRound),
    },
    lossesThisRun: {
      player: Math.max(0, a.lossesThisRun ?? 0),
      enemy: Math.max(0, b.lossesThisRun ?? 0),
    },
    graveyard: [],
  };

  refreshChampionAtk(state);
  emit(state, { type: 'BattleStarted', seed });
  for (const u of actionOrder(state.units, state.rng)) emit(state, { type: 'UnitSpawned', unit: viewOf(u) });

  resolveBattleStarts(state);
  refreshChampionAtk(state);
  emit(state, { type: 'BattleEffectsResolved' });
  flushDeaths(state);

  let timedOut = false;
  let stalled = false;
  while (sidePresent(state, 'player') && sidePresent(state, 'enemy') && state.cycle < MAX_CYCLES) {
    if (scrapIsStalemate(state)) {
      stalled = true;
      break;
    }
    state.cycle += 1;
    const order = cycleActionOrder(state);
    for (const u of order) {
      if (u.dead) continue;
      if (!sidePresent(state, 'player') || !sidePresent(state, 'enemy')) break;
      takeTurn(state, u);
    }
  }
  releaseLivingCocoons(state);
  if (!stalled && teamAlive(state, 'player') && teamAlive(state, 'enemy')) timedOut = true;

  const winner = decideWinner(state, timedOut, stalled);
  const ps = scoreTeam(state, 'player');
  const es = scoreTeam(state, 'enemy');
  // End abilities (hatch, scrap stickers) resolve first. The victory dance is the last beat,
  // so the form that just appeared is the one that dances.
  fireAbilities(state, 'battleEnded', () => true, {});
  fireAbilities(state, 'scrapEnded', () => true, {});
  emit(state, {
    type: 'BattleEnded',
    winner,
    survivors: winner === 'player' ? ps.count : winner === 'enemy' ? es.count : 0,
    hpRemaining: winner === 'player' ? ps.hp : winner === 'enemy' ? es.hp : 0,
    hpPct: winner === 'player' ? ps.hpPct : winner === 'enemy' ? es.hpPct : 0,
  });

  return {
    winner,
    survivorCount: { player: ps.count, enemy: es.count },
    hpRemaining: { player: ps.hp, enemy: es.hp },
    hpPct: { player: ps.hpPct, enemy: es.hpPct },
    totalAtkAlive: { player: ps.atk, enemy: es.atk },
    durationCycles: state.cycle,
    seed,
    events: state.events,
    snapshots: { a, b },
    timedOut,
  };
}

export function assertDeterministic(a: TeamSnapshot, b: TeamSnapshot, seed: number): boolean {
  const r1 = simulateBattle(a, b, seed);
  const r2 = simulateBattle(a, b, seed);
  return JSON.stringify(r1.events) === JSON.stringify(r2.events) && r1.winner === r2.winner;
}
