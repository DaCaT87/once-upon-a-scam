import {
  applySticker,
  canAcceptSticker,
  computedStats,
  firstFreeSlot,
  getSticker,
  getUnit,
  idlePacifist,
  instanceFromDef,
  makeSnapshot,
  offerUnits,
  offerUnitsOfRarity,
  shareStickerOnApply,
} from '../core/catalog';
import { recruitableUnits } from '../data/units';
import { detId } from '../core/ids';
import { mixSeed, SeededRng } from '../core/rng';
import { simulateBattle } from '../sim/simulation';
import { MAX_STICKERS, MAX_TEAM, RIVAL_VICES } from '../core/types';
import { RARITY_ORDER, shopMaxRarity } from '../data/rarity';
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

/** A rival may run several ambush/wake pacifists, but only one idle body. */
export const MAX_RIVAL_IDLE_PACIFISTS = 1;

export function idlePacifistCount(team: { defId: string }[]): number {
  return team.filter((u) => idlePacifist(u.defId)).length;
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

/** Bench worth this round. A body left behind the shop loses to the current shelf. */
export function benchValue(defId: string, vice: RivalVice = 'brawler', round = 1): number {
  const def = getUnit(defId);
  const rarity = RARITY_ORDER.indexOf(def.rarity);
  const shop = RARITY_ORDER.indexOf(shopMaxRarity(Math.max(1, round)));
  const behind = Math.max(0, shop - rarity);
  let n = scoreUnit(defId, [], vice) - behind * (8 + round * 3);
  if (idlePacifist(defId)) n -= 40;
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
  if (idlePacifist(defId) && idlePacifistCount(team) >= MAX_RIVAL_IDLE_PACIFISTS) n -= 80;
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

function combos<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k < 0 || k > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/** How hard this exact roster hits, in its best order. Duplicates and extra idle bodies are illegal. */
export function linePower(defIds: string[]): number {
  if (!defIds.length) return 0;
  if (new Set(defIds).size !== defIds.length) return -1e9;
  if (defIds.filter((id) => idlePacifist(id)).length > MAX_RIVAL_IDLE_PACIFISTS) return -1e9;
  const lined = formLine(defIds.map((id, i) => instanceFromDef(id, i + 1, `line${i}`)));
  return lineScore(lined) + lined.reduce((n, unit) => n + scoreUnit(unit.defId), 0);
}

const GAUNTLET = [
  ['farm-boy', 'hunter', 'drunken-giant', 'tin-soldier'],
  ['village-fool', 'puss-in-boots', 'magic-mirror', 'hunter'],
  ['village-fool', 'farm-boy', 'hunter', 'drunken-giant'],
];

function rosterSnap(ids: string[], name: string) {
  return makeSnapshot({
    playerId: name,
    playerName: name,
    runId: name,
    round: 6,
    team: formLine(ids.map((id, i) => instanceFromDef(id, i + 1, `${name}-${i}`))),
  });
}

/** One seeded scrap. Positive if `ids` wins, negative if it loses. */
function scrapMargin(ids: string[], foes: string[], seed: number): number {
  if (!ids.length) return -1;
  const fight = simulateBattle(rosterSnap(ids, 'line'), rosterSnap(foes, 'foe'), seed);
  if (fight.winner === 'player') return 1 + fight.hpPct.player;
  if (fight.winner === 'draw') return fight.hpPct.player - fight.hpPct.enemy;
  return -1 - fight.hpPct.enemy;
}

function rankRosters(rosters: string[][]): string[] {
  const legalAll = rosters.filter((ids) => ids.length > 0 && linePower(ids) > -1e8);
  const full = legalAll.reduce((n, ids) => Math.max(n, ids.length), 0);
  const seen = new Set<string>();
  const legal = legalAll.filter((ids) => {
    if (ids.length !== full) return false;
    const key = ids.slice().sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!legal.length) return [];
  if (legal.length === 1) return legal[0]!;
  const score = legal.map(() => 0);
  if (legal.length <= 18) {
    for (let i = 0; i < legal.length; i++) {
      for (let j = i + 1; j < legal.length; j++) {
        const margin = scrapMargin(legal[i]!, legal[j]!, 11);
        if (margin > 0.5) score[i] += 1;
        else if (margin < -0.5) score[j] += 1;
      }
    }
  } else {
    for (let i = 0; i < legal.length; i++) {
      for (let g = 0; g < GAUNTLET.length; g++) {
        score[i] += scrapMargin(legal[i]!, GAUNTLET[g]!, 20 + g);
      }
    }
  }
  let best = 0;
  for (let i = 1; i < score.length; i++) if (score[i]! > score[best]!) best = i;
  return legal[best]!;
}

/**
 * Strongest roster you can reach from the bench plus this shop, adding at most `picks` new figures.
 * Small fields are ranked by fighting each other. Larger shops are ranked against a fixed gauntlet.
 */
export function bestSquad(teamIds: string[], offers: string[], picks: number, size = MAX_TEAM): string[] {
  const base = [...new Set(teamIds)];
  const shop = [...new Set(offers)].filter((id) => !base.includes(id));
  const found: string[][] = [];
  const addCap = Math.max(0, Math.min(picks, shop.length));
  for (let k = 0; k <= addCap; k++) {
    for (const add of combos(shop, k)) {
      const minDrop = Math.max(0, base.length + k - size);
      const maxDrop = Math.min(base.length, k);
      for (let d = minDrop; d <= maxDrop; d++) {
        for (const drop of combos(base, d)) {
          const gone = new Set(drop);
          found.push([...base.filter((id) => !gone.has(id)), ...add]);
        }
      }
    }
  }
  return rankRosters(found);
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

export function pickDraft(offers: string[], _vice: RivalVice): string[] {
  if (offers.length <= 2) return offers.slice();
  return bestSquad([], offers, 2, 2);
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
  run: { alleyDone?: AlleyChoice[]; team: UnitInstance[]; wins: number; round?: number },
  vice: RivalVice,
): AlleyChoice {
  const done = run.alleyDone ?? [];
  const left = (['recruit', 'sticker', 'event'] as const).filter((choice) => !done.includes(choice));
  if (!left.length) return 'event';
  const full = run.team.length >= MAX_TEAM;
  const holes = run.team.reduce((n, u) => n + Math.max(0, MAX_STICKERS - u.stickerIds.length), 0);
  const score = (choice: AlleyChoice): number => {
    if (choice === 'recruit') {
      let n = full ? 2 : 18;
      if (full && run.team.length) {
        const weak = run.team.reduce((low, u) =>
          recruitScore(u.defId, run.team, vice) < recruitScore(low.defId, run.team, vice) ? u : low,
        );
        const gap = RARITY_ORDER.indexOf(shopMaxRarity(run.round ?? 1)) - RARITY_ORDER.indexOf(getUnit(weak.defId).rarity);
        if (gap >= 1) n = 14 + gap * 4;
      }
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

function pickAttackerId(team: UnitInstance[], round: number, vice: RivalVice, rng: SeededRng): string {
  const taken = new Set(team.map((u) => u.defId));
  let best = '';
  let bestN = -Infinity;
  for (let n = 0; n < 8; n++) {
    const id = offerUnits(Math.max(2, round), 1, rng.fork(0x21 + n))[0];
    if (!id || idlePacifist(id) || taken.has(id)) continue;
    const score = recruitScore(id, team, vice);
    if (score > bestN) {
      bestN = score;
      best = id;
    }
  }
  if (best) return best;
  const attackers = recruitableUnits().filter((u) => u.rarity !== 'diamond' && !idlePacifist(u.id) && !taken.has(u.id));
  return rng.pick(attackers.length ? attackers : recruitableUnits().filter((u) => !idlePacifist(u.id))).id;
}

function trimExtraPacifists(
  team: UnitInstance[],
  round: number,
  vice: RivalVice,
  rng: SeededRng,
  seed: number,
): UnitInstance[] {
  const pac = team.filter((u) => idlePacifist(u.defId));
  if (pac.length <= MAX_RIVAL_IDLE_PACIFISTS) return team;
  const keep = pac.slice().sort((a, b) => recruitScore(b.defId, team, vice) - recruitScore(a.defId, team, vice))[0];
  let next = team.map((u) => ({ ...u }));
  for (const extra of pac) {
    if (extra.instanceId === keep?.instanceId) continue;
    const id = pickAttackerId(next, round, vice, rng);
    next = next.map((u) =>
      u.instanceId === extra.instanceId ? instanceFromDef(id, u.slot, detId('atk', mixSeed(seed, u.slot, round), u.slot)) : u,
    );
  }
  return next;
}

function pickFillId(team: UnitInstance[], round: number, vice: RivalVice, rng: SeededRng): string {
  const wantAttacker = idlePacifistCount(team) >= MAX_RIVAL_IDLE_PACIFISTS;
  if (!wantAttacker && !hasDiamond(team) && rng.chance(diamondChance(round, vice))) {
    const dia = offerUnitsOfRarity('diamond', 1, rng, false)[0];
    if (dia && getUnit(dia).rarity === 'diamond' && getUnit(dia).recruitable && !idlePacifist(dia)) return dia;
  }
  if (wantAttacker) return pickAttackerId(team, round, vice, rng);
  let best = '';
  let bestN = -Infinity;
  for (let n = 0; n < 8; n++) {
    const id = offerUnits(Math.max(2, round), 1, rng.fork(0x11 + n))[0];
    if (!id) continue;
    const score = recruitScore(id, team, vice);
    if (score > bestN) {
      bestN = score;
      best = id;
    }
  }
  return best || 'farm-boy';
}

/** Keep a rival on 4 figures. From round 6 a seat can roll a recruitable diamond. */
export function ensureFullLine(
  team: UnitInstance[],
  opts: { seed: number; round: number; vice?: RivalVice; wins?: number },
): UnitInstance[] {
  const vice = opts.vice ?? 'brawler';
  const rng = new SeededRng(mixSeed(opts.seed, opts.round, 0xf11));
  let next = trimExtraPacifists(
    team.map((u) => ({ ...u })),
    opts.round,
    vice,
    rng,
    opts.seed,
  );
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
    const diaOk =
      dia &&
      getUnit(dia).rarity === 'diamond' &&
      getUnit(dia).recruitable &&
      getUnit(weak.defId).rarity !== 'diamond' &&
      (!idlePacifist(dia) || idlePacifistCount(next.filter((u) => u.instanceId !== weak.instanceId)) < MAX_RIVAL_IDLE_PACIFISTS);
    if (diaOk && dia && weak) {
      next = next.map((u) =>
        u.instanceId === weak.instanceId ? instanceFromDef(dia, u.slot, detId('dia', opts.seed, u.slot)) : u,
      );
    }
  }
  return formLine(next);
}
