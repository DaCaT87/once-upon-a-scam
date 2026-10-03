import {
  applySticker,
  canAcceptSticker,
  computedStats,
  firstFreeSlot,
  getSticker,
  getUnit,
  instanceFromDef,
  offerUnits,
  offerUnitsOfRarity,
  shareStickerOnApply,
} from '../core/catalog';
import { detId } from '../core/ids';
import { mixSeed, SeededRng } from '../core/rng';
import { MAX_STICKERS, MAX_TEAM, RIVAL_VICES } from '../core/types';
import type { AlleyChoice, RivalVice, UnitInstance } from '../core/types';

export type { RivalVice };

export function isRivalVice(value: unknown): value is RivalVice {
  return typeof value === 'string' && (RIVAL_VICES as readonly string[]).includes(value);
}

export function viceAt(index: number): RivalVice {
  const n = RIVAL_VICES.length;
  return RIVAL_VICES[((index % n) + n) % n]!;
}

const RARITY_PTS = { bronze: 0, silver: 8, gold: 18, platinum: 26, diamond: 40 } as const;

export function powerOf(defId: string): number {
  const def = getUnit(defId);
  return def.atk * 3 + def.hp * 2 + def.speed * 2 + RARITY_PTS[def.rarity] + (def.ability ? 5 : 0);
}

export function scoreUnit(defId: string, stickers: string[] = [], vice: RivalVice = 'brawler'): number {
  const def = getUnit(defId);
  const fake: UnitInstance = {
    instanceId: 'x',
    defId,
    slot: 1,
    stickerIds: stickers,
    permanentMods: { atk: 0, hp: 0, speed: 0 },
  };
  const s = computedStats(fake);
  let n = s.atk * 3 + s.hp * 2 + s.speed * 2 + RARITY_PTS[def.rarity] + stickers.length * 4 + (def.ability ? 5 : 0);
  if (def.passives?.provoke) n += 4;
  if (def.passives?.guardian) n += 4;
  if (vice === 'tank' && (def.passives?.provoke || def.tags.includes('tank'))) n += 10;
  if (vice === 'sneak' && def.targeting === 'sneak') n += 12;
  if (vice === 'brawler' && def.targeting === 'brawler') n += 8;
  if (vice === 'guardian' && def.passives?.guardian) n += 14;
  if (vice === 'tempo' && s.speed >= 6) n += 8;
  if (vice === 'sticker' && def.passives?.eatStickers) n += 6;
  return n;
}

export function pairSynergy(a: string, b: string): number {
  const left = getUnit(a);
  const right = getUnit(b);
  let n = 0;
  if (left.passives?.provoke && right.targeting === 'sneak') n += 10;
  if (right.passives?.provoke && left.targeting === 'sneak') n += 10;
  if (left.passives?.guardian && right.atk >= 2) n += 12;
  if (right.passives?.guardian && left.atk >= 2) n += 12;
  if (left.targeting === 'brawler' && right.passives?.provoke) n += 8;
  if (right.targeting === 'brawler' && left.passives?.provoke) n += 8;
  return n;
}

export function recruitScore(defId: string, team: UnitInstance[], vice: RivalVice = 'brawler'): number {
  let n = scoreUnit(defId, [], vice);
  const defs = team.map((u) => getUnit(u.defId));
  const hasTaunt = defs.some((d) => d.passives?.provoke);
  const hasSneak = defs.some((d) => d.targeting === 'sneak');
  const maxAtk = Math.max(0, ...team.map((u) => computedStats(u).atk), getUnit(defId).atk);
  const def = getUnit(defId);
  if (def.passives?.provoke && !hasTaunt) n += 12;
  if (def.passives?.guardian && maxAtk >= 2) n += 12;
  if (def.targeting === 'sneak' && hasTaunt && !hasSneak) n += 8;
  if (def.targeting === 'brawler' && hasTaunt) n += 4;
  if (defs.some((d) => d.passives?.guardian) && def.atk >= 3) n += 8;
  for (const u of team) n += pairSynergy(defId, u.defId) * 0.4;
  return n;
}

export function stickerFit(defId: string, stickerId: string, vice: RivalVice = 'brawler'): number {
  const def = getUnit(defId);
  const st = getSticker(stickerId);
  let score = 1;
  for (const tag of def.tags) {
    if (st.archetypes.includes(tag)) score += 6;
  }
  if (st.family === 'stat') score += 2;
  if (st.statMods?.atk && (def.tags.includes('attack') || def.targeting === 'brawler')) score += 5;
  if (st.statMods?.hp && (def.tags.includes('tank') || def.passives?.provoke)) score += 5;
  if (st.statMods?.speed && (def.targeting === 'sneak' || vice === 'tempo')) score += 4;
  if (st.targeting && def.tags.includes('target')) score += 2;
  if (st.passives?.guardian && def.atk >= 1) score += 8;
  if (st.passives?.provoke && def.hp >= 6) score += 6;
  if (vice === 'sticker') score += 2;
  if (vice === 'tank' && (st.statMods?.hp || st.passives?.provoke || st.passives?.guardian)) score += 4;
  if (vice === 'brawler' && st.statMods?.atk) score += 4;
  if (vice === 'sneak' && (st.targeting === 'sneak' || st.statMods?.speed)) score += 4;
  return score;
}

export function bestStickerHost(
  team: UnitInstance[],
  stickerId: string,
  vice: RivalVice = 'brawler',
): UnitInstance | undefined {
  if (!team.length) return undefined;
  const ranked = team
    .map((u) => ({
      u,
      fit: stickerFit(u.defId, stickerId, vice) - (canAcceptSticker(u) ? 0 : 8) - u.stickerIds.length,
    }))
    .sort((a, b) => b.fit - a.fit);
  return ranked[0]?.u;
}

function lineScore(line: UnitInstance[]): number {
  let s = 0;
  const bySlot = new Map(line.map((u) => [u.slot, u]));
  for (const u of line) {
    const def = getUnit(u.defId);
    const st = computedStats(u);
    const behind = bySlot.get(u.slot + 1);
    if (def.passives?.provoke) s += (5 - u.slot) * 10 + st.hp;
    if (def.targeting === 'sneak') s += u.slot * 8 + st.atk;
    if (def.passives?.guardian) {
      if (behind) s += 24 + computedStats(behind).atk * 5;
      else s -= 14;
    }
    if (def.targeting === 'pacifist' && !def.passives?.provoke) s += u.slot * 3;
    if (def.targeting === 'brawler') s += (3.2 - u.slot) * (st.atk + 1);
  }
  return s;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations(items.filter((_, j) => j !== i))) out.push([item, ...rest]);
  });
  return out;
}

export function formLine<T extends UnitInstance>(team: T[]): T[] {
  if (team.length <= 1) return team.map((u, i) => ({ ...u, slot: i + 1 }));
  let best = team;
  let bestScore = -Infinity;
  for (const perm of permutations(team)) {
    const lined = perm.map((u, i) => ({ ...u, slot: i + 1 }));
    const score = lineScore(lined);
    if (score > bestScore) {
      bestScore = score;
      best = lined;
    }
  }
  return best;
}

export function pickDraft(offers: string[], vice: RivalVice): string[] {
  if (offers.length <= 2) return offers.slice();
  let best: string[] = offers.slice(0, 2);
  let bestScore = -Infinity;
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i]!;
      const b = offers[j]!;
      const n = scoreUnit(a, [], vice) + scoreUnit(b, [], vice) + pairSynergy(a, b);
      if (n > bestScore) {
        bestScore = n;
        best = [a, b];
      }
    }
  }
  return best;
}

export function pickStickerOffer(team: UnitInstance[], offers: string[], vice: RivalVice): string | undefined {
  if (!offers.length) return undefined;
  return offers.slice().sort((a, b) => {
    const ha = bestStickerHost(team, a, vice);
    const hb = bestStickerHost(team, b, vice);
    const sa = ha ? stickerFit(ha.defId, a, vice) : -1;
    const sb = hb ? stickerFit(hb.defId, b, vice) : -1;
    return sb - sa;
  })[0];
}

export function alleyPickFor(
  run: { alleyDone?: AlleyChoice[]; team: UnitInstance[]; wins: number },
  vice: RivalVice,
): AlleyChoice {
  const done = run.alleyDone ?? [];
  const left = (['recruit', 'sticker', 'event'] as const).filter((choice) => !done.includes(choice));
  if (!left.length) return 'event';
  const full = run.team.length >= MAX_TEAM;
  const holes = run.team.reduce((n, u) => n + Math.max(0, MAX_STICKERS - u.stickerIds.length), 0);
  const score = (choice: AlleyChoice): number => {
    if (choice === 'recruit') {
      let n = full ? 1 : 18;
      if (vice === 'tank' || vice === 'brawler' || vice === 'sneak' || vice === 'guardian') n += 2;
      return n;
    }
    if (choice === 'sticker') {
      let n = 8 + Math.min(6, holes);
      if (vice === 'sticker') n += 6;
      if (full) n += 3;
      return n;
    }
    let n = 7;
    if (vice === 'hunt' || vice === 'clone' || vice === 'oven') n += 8;
    if (full) n += 2;
    if (run.wins >= 3) n += 2;
    if (!full) n -= 8;
    return n;
  };
  return left.slice().sort((a, b) => score(b) - score(a))[0]!;
}

export function placeStickers(
  team: UnitInstance[],
  stickerIds: string[],
  vice: RivalVice = 'brawler',
): UnitInstance[] {
  let next = team.map((u) => ({ ...u, stickerIds: [...u.stickerIds] }));
  for (const sid of stickerIds) {
    const host = bestStickerHost(next, sid, vice);
    if (!host) continue;
    const i = next.findIndex((u) => u.instanceId === host.instanceId);
    if (i < 0) continue;
    const fromId = next[i]!.defId;
    next[i] = applySticker(next[i]!, sid, next[i]!.stickerIds.length >= MAX_STICKERS ? 0 : undefined);
    next = shareStickerOnApply(next, next[i]!.instanceId, sid, fromId);
  }
  return next;
}

function hasDiamond(team: UnitInstance[]): boolean {
  return team.some((u) => getUnit(u.defId).rarity === 'diamond');
}

export function diamondChance(round: number, vice: RivalVice, wins = 0): number {
  if (round < 6) return 0;
  let p = 0.05 + (round - 6) * 0.04;
  if (vice === 'hunt' || vice === 'clone') p += 0.14;
  if (wins >= 4) p += 0.08;
  return Math.min(0.4, p);
}

function pickFillId(team: UnitInstance[], round: number, vice: RivalVice, rng: SeededRng): string {
  if (!hasDiamond(team) && rng.chance(diamondChance(round, vice))) {
    const dia = offerUnitsOfRarity('diamond', 1, rng, false)[0];
    if (dia && getUnit(dia).rarity === 'diamond' && getUnit(dia).recruitable) return dia;
  }
  return offerUnits(Math.max(2, round), 1, rng)[0] ?? 'farm-boy';
}

/** Keep a rival on 4 figures. From round 6 a seat can roll a recruitable diamond. */
export function ensureFullLine(
  team: UnitInstance[],
  opts: { seed: number; round: number; vice?: RivalVice; wins?: number },
): UnitInstance[] {
  const vice = opts.vice ?? 'brawler';
  const rng = new SeededRng(mixSeed(opts.seed, opts.round, 0xf11));
  let next = team.map((u) => ({ ...u }));
  let n = 0;
  while (next.length < MAX_TEAM && n++ < MAX_TEAM) {
    const id = pickFillId(next, opts.round, vice, rng);
    const slot = firstFreeSlot(next);
    next.push(instanceFromDef(id, slot, detId('fill', mixSeed(opts.seed, slot, opts.round), n)));
  }
  if (next.length >= MAX_TEAM && !hasDiamond(next) && rng.chance(diamondChance(opts.round, vice, opts.wins ?? 0))) {
    const dia = offerUnitsOfRarity('diamond', 1, rng, false)[0];
    const weak = next
      .slice()
      .sort((a, b) => recruitScore(a.defId, next, vice) - recruitScore(b.defId, next, vice))[0];
    if (dia && weak && getUnit(dia).rarity === 'diamond' && getUnit(dia).recruitable && getUnit(weak.defId).rarity !== 'diamond') {
      next = next.map((u) =>
        u.instanceId === weak.instanceId ? instanceFromDef(dia, u.slot, detId('dia', opts.seed, u.slot)) : u,
      );
    }
  }
  return formLine(next);
}
