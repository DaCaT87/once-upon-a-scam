import {
  applySticker,
  canAcceptSticker,
  shareStickerOnApply,
  capTeam,
  cloneTeam,
  compactSlots,
  eatsStickers,
  firstFreeSlot,
  getSticker,
  getUnit,
  instanceFromDef,
  makeSnapshot,
  offerStickers,
  offerStickersOfRarity,
  offerUnits,
  offerUnitsOfRarity,
  randomUnitOfRarity,
  teamSizeForRound,
} from '../core/catalog';
import { STICKER_BY_ID } from '../data/stickers';
import { EVENT_BY_ID, huntLevelForRound, huntMonstersFor, huntPower, huntStickerFor, lossRewardRarity } from '../data/events';
import { nextWellRarity } from '../data/rarity';
import { STARTING_BRONZE_IDS, unitsByRarity } from '../data/units';
import { makeId } from '../core/ids';
import { mixSeed } from '../core/rng';
import { SeededRng } from '../core/rng';
import { simulateBattle } from '../sim/simulation';
import type { AlleyChoice, BattleResult, EventId, LostTale, RunMode, RunState, TeamSnapshot, UnitInstance } from '../core/types';
import { growCircuit, openCircuit, settleCircuit } from './circuit';
import { ALLEY_PICK, DATA_VERSION, DRAFT_OFFER, DRAFT_PICK, MAX_TEAM, RECRUIT_OFFER, RECRUIT_PICK, STICKER_OFFER, STICKER_PICK } from '../core/types';

export function victoryPointsOf(run: { victoryPoints?: number; wins: number; history?: { winner?: string }[] }): number {
  if (typeof run.victoryPoints === 'number') return run.victoryPoints;
  const draws = (run.history ?? []).filter((h) => h.winner === 'draw').length;
  return run.wins * 3 + draws;
}

export function pveRating(wins: number): { key: string; positive: boolean } {
  if (wins <= 3) return { key: 'ratingDefeat', positive: false };
  if (wins <= 5) return { key: 'ratingSurvivor', positive: false };
  if (wins === 6) return { key: 'ratingGood', positive: false };
  if (wins <= 8) return { key: 'ratingVictory', positive: true };
  if (wins === 9) return { key: 'ratingDominating', positive: true };
  return { key: 'ratingPerfect', positive: true };
}

function remapUnitId(id: string): string {
  if (id === 'broken-marionette') return 'sir-forget-a-lot';
  if (id === 'tyrant-queen') return 'scary-scarecrow';
  return id;
}

export function migrateRun(run: RunState): RunState {
  const known = (id: string) => STICKER_BY_ID.has(id);
  const team = capTeam(run.team).map((u) => ({
    ...u,
    defId: remapUnitId(u.defId),
    stickerIds: u.stickerIds.filter(known),
  }));
  const recruitPicks = Array.isArray(run.recruitPicks) ? run.recruitPicks : [];
  return {
    ...run,
    team,
    draftPicks: run.draftPicks.slice(0, DRAFT_PICK),
    recruitPicks: recruitPicks.slice(0, recruitPickLimit(recruitPicks)),
    stickerBag: (Array.isArray(run.stickerBag) ? run.stickerBag : []).filter(known),
    pendingStickerIds: (Array.isArray(run.pendingStickerIds) ? run.pendingStickerIds : []).filter(known),
    stickerOffers: (Array.isArray(run.stickerOffers) ? run.stickerOffers : []).filter(known),
    eventId: run.eventId && EVENT_BY_ID.has(run.eventId) ? run.eventId : null,
    eventStep: run.eventStep ?? null,
    eventOffers: Array.isArray(run.eventOffers) ? run.eventOffers : [],
    eventPicks: Array.isArray(run.eventPicks) ? run.eventPicks : [],
    huntMonsterId: run.huntMonsterId ?? null,
    lastBonusBattle: run.lastBonusBattle ?? null,
    recruitRarityBump: Boolean(run.recruitRarityBump),
    alleyPicks: Array.isArray(run.alleyPicks) ? run.alleyPicks : [],
    alleyQueue: Array.isArray(run.alleyQueue) ? run.alleyQueue : [],
    alleyDone: Array.isArray(run.alleyDone) ? run.alleyDone : [],
    stickersGained:
      run.stickersGained ??
      team.reduce((n, u) => n + u.stickerIds.length, 0) + (Array.isArray(run.stickerBag) ? run.stickerBag.length : 0),
    deathsThisRun: run.deathsThisRun ?? 0,
    victoryPoints: victoryPointsOf(run),
    lostTales: (Array.isArray(run.lostTales) ? run.lostTales : []).map((tale) => ({
      defId: remapUnitId(tale.defId),
      stickerIds: (tale.stickerIds ?? []).filter(known),
      permanentMods: {
        atk: tale.permanentMods?.atk ?? 0,
        hp: tale.permanentMods?.hp ?? 0,
        speed: tale.permanentMods?.speed ?? 0,
      },
    })),
  };
}

export function bareRun(mode: RunMode, playerId: string, playerName: string, seed?: number): RunState {
  const s = seed ?? (Date.now() ^ Math.floor(Math.random() * 1e9));
  const rng = new SeededRng(s);
  const draftOffers = rng.pickN([...STARTING_BRONZE_IDS], DRAFT_OFFER);
  return {
    runId: makeId('run'),
    mode,
    playerId,
    playerName,
    round: 1,
    wins: 0,
    losses: 0,
    phase: 'draft',
    team: [],
    pendingStickerIds: [],
    stickerOffers: [],
    stickerPickCount: 1,
    recruitOffers: [],
    recruitPicks: [],
    draftOffers,
    draftPicks: [],
    lastBattle: null,
    lastBonusBattle: null,
    history: [],
    seed: s,
    offerCounter: 1,
    dataVersion: DATA_VERSION,
    startedAt: Date.now(),
    stickerBag: [],
    eventId: null,
    eventStep: null,
    eventOffers: [],
    eventPicks: [],
    huntMonsterId: null,
    recruitRarityBump: false,
    alleyPicks: [],
    alleyQueue: [],
    alleyDone: [],
    stickersGained: 0,
    deathsThisRun: 0,
    victoryPoints: 0,
    lostTales: [],
  };
}

export function createRun(mode: RunMode, playerId: string, playerName: string, seed?: number): RunState {
  const run = bareRun(mode, playerId, playerName, seed);
  return { ...run, circuit: openCircuit(run.seed, run.playerName) };
}

function rngFor(run: RunState, salt: number): SeededRng {
  return new SeededRng(mixSeed(run.seed, run.offerCounter, salt, run.round));
}

function spreadIfMythic(team: UnitInstance[], _stickerId: string, _rng: SeededRng): UnitInstance[] {
  return team;
}

export function toggleDraftPick(run: RunState, defId: string): RunState {
  const picks = run.draftPicks.includes(defId)
    ? run.draftPicks.filter((id) => id !== defId)
    : run.draftPicks.length < DRAFT_PICK
      ? [...run.draftPicks, defId]
      : run.draftPicks;
  return { ...run, draftPicks: picks };
}

function hasRecruitRarityBump(defId: string): boolean {
  return getUnit(defId).ability?.id === 'farm-boy.bump';
}

function grantsGoldOnRecruit(defId: string): boolean {
  return Boolean(getUnit(defId).passives?.grantGoldUnitOnRecruit);
}

export function recruitPickLimit(
  _picks: string[],
  eventId?: string | null,
  eventStep?: string | null,
): number {
  if (eventId === 'wishing-well' && eventStep === 'reward') return 1;
  return RECRUIT_PICK;
}

function goldUnitsOnRecruit(picks: string[]): number {
  return picks.filter(grantsGoldOnRecruit).length;
}

function collectRecruitGoldUnits(run: RunState, defIds: string[]): string[] {
  const pool = unitsByRarity('gold').map((u) => u.id);
  const granted: string[] = [];
  let salt = 0;
  for (const defId of defIds) {
    if (!grantsGoldOnRecruit(defId) || !pool.length) continue;
    const pick = rngFor(run, 0xa01d + salt).pick(pool);
    salt += 1;
    if (pick) granted.push(pick);
  }
  return granted;
}

function planRecruitAdds(run: RunState, picks: string[], room: number): string[] {
  const golds = collectRecruitGoldUnits(run, picks);
  let goldAt = 0;
  const out: string[] = [];
  for (const defId of picks) {
    if (out.length >= room) break;
    out.push(defId);
    if (!grantsGoldOnRecruit(defId)) continue;
    if (out.length >= room) break;
    const gold = golds[goldAt];
    goldAt += 1;
    if (gold) out.push(gold);
  }
  return out;
}

function grantShopStickerOnRecruit(defId: string): boolean {
  return Boolean(getUnit(defId).passives?.grantShopStickerOnRecruit);
}

function collectRecruitStickers(run: RunState, defIds: string[]): string[] {
  const granted: string[] = [];
  let salt = 0;
  for (const defId of defIds) {
    const rarity = getUnit(defId).passives?.grantStickerOnRecruit;
    if (rarity) {
      const sid = offerStickersOfRarity(rarity, 1, rngFor(run, 0xb10 + salt))[0];
      salt += 1;
      if (sid) granted.push(sid);
    }
    if (!grantShopStickerOnRecruit(defId)) continue;
    const sid = offerStickers(1, rngFor(run, 0xc51d + salt), run.round)[0];
    salt += 1;
    if (sid) granted.push(sid);
  }
  return granted;
}

function applyLossGrowth(team: UnitInstance[], winner: 'player' | 'enemy' | 'draw'): UnitInstance[] {
  if (winner !== 'enemy') return team;
  return team.map((u) => {
    const gain = getUnit(u.defId).passives?.gainOnLoss;
    if (!gain) return u;
    return {
      ...u,
      permanentMods: {
        atk: u.permanentMods.atk + gain.atk,
        hp: u.permanentMods.hp + gain.hp,
        speed: u.permanentMods.speed,
      },
    };
  });
}

function instanceOnSide(uid: string, side: 'player' | 'enemy'): string | null {
  const prefix = `${side}:`;
  if (!uid.startsWith(prefix)) return null;
  const rest = uid.slice(prefix.length);
  if (rest.startsWith('summon:')) return null;
  return rest;
}

function lostLastScrap(run: RunState): boolean {
  const last = run.history[run.history.length - 1];
  if (!last) return false;
  if (last.winner) return last.winner === 'enemy';
  return last.win === false;
}

function addPermanentMods(u: UnitInstance, atk: number, hp: number, speed = 0): UnitInstance {
  return {
    ...u,
    permanentMods: {
      atk: u.permanentMods.atk + atk,
      hp: u.permanentMods.hp + hp,
      speed: u.permanentMods.speed + speed,
    },
  };
}

function stripSticker(u: UnitInstance, stickerId: string): UnitInstance {
  const i = u.stickerIds.indexOf(stickerId);
  if (i < 0) return u;
  const stickerIds = [...u.stickerIds];
  stickerIds.splice(i, 1);
  return { ...u, stickerIds };
}

function persistBattleTeam(
  run: RunState,
  side: 'player' | 'enemy' = 'player',
): { team: UnitInstance[]; stickerBag: string[]; deathsThisRun: number; stickersGained: number } {
  const sideOf = (uid: string) => instanceOnSide(uid, side);
  const events = run.lastBattle?.events ?? [];
  let team = cloneTeam(run.team);
  const melted = new Set<string>();
  const exhausted = new Map<string, { recipientId: string | null; atk: number; hp: number }>();
  const deathGrown = new Set<string>();
  const deadPlayer = new Set<string>();
  const poisonUndo = new Map<string, { slot: number; restore: string | null }[]>();
  const stickerBag = [...run.stickerBag];
  let deathsThisRun = run.deathsThisRun ?? 0;
  let stickersGained = run.stickersGained ?? 0;
  for (const ev of events) {
    if (ev.type === 'Transformed') {
      if (ev.combat) continue;
      const id = sideOf(ev.unit.uid);
      if (!id) continue;
      team = team.map((u) => (u.instanceId === id ? { ...u, defId: ev.unit.defId } : u));
    }
    if (ev.type === 'AteSticker') {
      const id = sideOf(ev.unitId);
      if (!id) continue;
      team = team.map((u) =>
        u.instanceId === id
          ? {
              ...u,
              permanentMods: {
                atk: u.permanentMods.atk + ev.atk,
                hp: u.permanentMods.hp + ev.hp,
                speed: u.permanentMods.speed,
              },
            }
          : u,
      );
    }
    if (ev.type === 'GrantedSticker') {
      const id = sideOf(ev.unitId);
      if (id) {
        const holder = team.find((u) => u.instanceId === id);
        if (holder && canAcceptSticker(holder) && !eatsStickers(holder.defId)) {
          const fromId = holder.defId;
          team = team.map((u) => (u.instanceId === id ? applySticker(u, ev.stickerId) : u));
          team = shareStickerOnApply(team, id, ev.stickerId, fromId);
        }
        stickersGained += 1;
      }
    }
    if (ev.type === 'StoleSticker') {
      const victim = sideOf(ev.victimId);
      if (victim) {
        team = team.map((u) => (u.instanceId === victim ? stripSticker(u, ev.stickerId) : u));
      }
      if (ev.applied) {
        const thief = sideOf(ev.thiefId);
        if (thief) {
          const holder = team.find((u) => u.instanceId === thief);
          if (holder && canAcceptSticker(holder) && !eatsStickers(holder.defId)) {
            const fromId = holder.defId;
            team = team.map((u) => (u.instanceId === thief ? applySticker(u, ev.stickerId) : u));
            team = shareStickerOnApply(team, thief, ev.stickerId, fromId);
          }
          stickersGained += 1;
        }
      }
    }
    if (ev.type === 'StatChanged' && ev.permanent) {
      const id = sideOf(ev.unitId);
      if (id) {
        team = team.map((u) =>
          u.instanceId === id
            ? addPermanentMods(
                u,
                ev.stat === 'atk' ? ev.amount : 0,
                ev.stat === 'maxHp' ? ev.amount : 0,
                ev.stat === 'speed' ? ev.amount : 0,
              )
            : u,
        );
      }
    }
    if (ev.type === 'ExhaustedSticker') {
      const id = sideOf(ev.unitId);
      if (id) team = team.map((u) => (u.instanceId === id ? stripSticker(u, ev.stickerId) : u));
    }
    if (ev.type === 'TrashedStickers') {
      const id = sideOf(ev.unitId);
      if (!id) continue;
      team = team.map((u) => {
        if (u.instanceId !== id) return u;
        const stickerIds = [...u.stickerIds];
        for (const old of ev.removed) {
          const i = stickerIds.indexOf(old);
          if (i >= 0) stickerIds[i] = 'trash';
        }
        return { ...u, stickerIds };
      });
    }
    if (ev.type === 'PoisonApplied') {
      const id = sideOf(ev.unitId);
      if (!id) continue;
      team = team.map((u) => {
        if (u.instanceId !== id) return u;
        const stickerIds = [...u.stickerIds];
        const undo = poisonUndo.get(id) ?? [];
        if (ev.added) {
          if (stickerIds.length < 3 && stickerIds.filter((s) => s === 'poison').length < 3) {
            stickerIds.push('poison');
            undo.push({ slot: stickerIds.length - 1, restore: null });
          }
        } else if (ev.removed) {
          const i = stickerIds.indexOf(ev.removed);
          if (i >= 0) {
            stickerIds[i] = 'poison';
            undo.push({ slot: i, restore: ev.removed });
          }
        }
        poisonUndo.set(id, undo);
        return { ...u, stickerIds };
      });
    }
    if (ev.type === 'ExhaustedUnit') {
      const id = sideOf(ev.unitId);
      if (id) {
        exhausted.set(id, {
          recipientId: ev.recipientId ? sideOf(ev.recipientId) : null,
          atk: ev.atk,
          hp: ev.hp,
        });
      }
    }
    if (ev.type === 'UnitDied') {
      deathsThisRun += 1;
      const id = sideOf(ev.unitId);
      if (id && !deathGrown.has(id)) {
        const holder = team.find((u) => u.instanceId === id);
        const gain = holder ? getUnit(holder.defId).passives?.gainOnDeath : undefined;
        if (gain) {
          deathGrown.add(id);
          team = team.map((u) => (u.instanceId === id ? addPermanentMods(u, gain.atk, gain.hp) : u));
        }
      }
      team = team.map((u) => {
        if (deadPlayer.has(u.instanceId)) return u;
        if (id && u.instanceId === id) return u;
        const gain = getUnit(u.defId).passives?.gainOnAnyDeath;
        if (!gain) return u;
        return addPermanentMods(u, gain.atk, gain.hp);
      });
      if (id) deadPlayer.add(id);
      if (id) {
        const fallen = team.find((u) => u.instanceId === id);
        const aura = fallen ? getUnit(fallen.defId).passives?.alliesGainOnDeath : undefined;
        if (aura) {
          team = team.map((u) => (u.instanceId === id ? u : addPermanentMods(u, aura.atk, aura.hp)));
        }
      }
      const gift = id ? exhausted.get(id) : undefined;
      if (id && gift) {
        melted.add(id);
        if (gift.recipientId && (gift.atk || gift.hp)) {
          team = team.map((u) => (u.instanceId === gift.recipientId ? addPermanentMods(u, gift.atk, gift.hp) : u));
        }
      }
    }
  }
  if (run.eventId === 'monster-hunt') {
    const fallen = new Set<string>();
    for (const ev of events) {
      if (ev.type === 'UnitDied') {
        const id = sideOf(ev.unitId);
        if (id) fallen.add(id);
      }
      if (ev.type === 'Revived') {
        const id = sideOf(ev.unitId);
        if (id) fallen.delete(id);
      }
    }
    for (const id of fallen) melted.add(id);
  }
  team = compactSlots(team.filter((u) => !melted.has(u.instanceId)));
  team = team.map((u) => {
    const undo = poisonUndo.get(u.instanceId);
    if (!undo?.length) return u;
    const stickerIds = [...u.stickerIds];
    for (const step of [...undo].reverse()) {
      if (step.restore) stickerIds[step.slot] = step.restore;
      else stickerIds.splice(step.slot, 1);
    }
    return { ...u, stickerIds };
  });
  team = team.map((u) =>
    getUnit(u.defId).passives?.forgetStickersAfterScrap && u.stickerIds.length ? { ...u, stickerIds: [] } : u,
  );
  return { team, stickerBag, deathsThisRun, stickersGained };
}

/** Write one side of a finished scrap back onto that side's lineup. */
export function applyBattleSide(
  team: UnitInstance[],
  result: BattleResult,
  side: 'player' | 'enemy',
  meta: { stickerBag: string[]; deathsThisRun: number; stickersGained: number },
): {
  team: UnitInstance[];
  stickerBag: string[];
  deathsThisRun: number;
  stickersGained: number;
  pendingStickerIds: string[];
  won: boolean;
  draw: boolean;
  lost: boolean;
} {
  const ghost = {
    team: cloneTeam(team),
    stickerBag: [...meta.stickerBag],
    deathsThisRun: meta.deathsThisRun,
    stickersGained: meta.stickersGained,
    lastBattle: result,
    eventId: null,
  } as RunState;
  const persisted = persistBattleTeam(ghost, side);
  const view = result.winner === 'draw' ? 'draw' : side === 'player' ? result.winner : result.winner === 'player' ? 'enemy' : 'player';
  const prefix = `${side}:`;
  const pendingStickerIds = result.events.flatMap((ev) =>
    ev.type === 'EarnedSticker' && ev.unitId.startsWith(prefix) ? [ev.stickerId] : [],
  );
  return {
    team: applyLossGrowth(persisted.team, view),
    stickerBag: persisted.stickerBag,
    deathsThisRun: persisted.deathsThisRun,
    stickersGained: persisted.stickersGained,
    pendingStickerIds,
    won: view === 'player',
    draw: view === 'draw',
    lost: view === 'enemy',
  };
}

export function placeDraft(run: RunState, defId: string, slot: number): RunState {
  if (run.phase !== 'draft') return run;
  if (!run.draftOffers.includes(defId) || run.draftPicks.includes(defId)) return run;
  if (run.draftPicks.length >= DRAFT_PICK) return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  const team = cloneTeam(run.team);
  if (team.some((u) => u.slot === slot)) return run;
  team.push(instanceFromDef(defId, slot, makeId('u')));
  return {
    ...run,
    team,
    draftPicks: [...run.draftPicks, defId],
    draftOffers: run.draftOffers.filter((id) => id !== defId),
  };
}

export function confirmDraft(run: RunState): RunState {
  if (run.phase !== 'draft') return run;
  if (run.draftPicks.length > DRAFT_PICK) return run;
  const team =
    run.team.length > 0
      ? cloneTeam(run.team)
      : run.draftPicks.map((id, i) => instanceFromDef(id, i + 1, makeId('u')));
  const bump = run.draftPicks.some(hasRecruitRarityBump);
  const gifts = collectRecruitStickers(run, run.draftPicks);
  const next = { ...run, team, draftPicks: run.draftPicks, recruitRarityBump: run.recruitRarityBump || bump };
  if (!gifts.length) return { ...next, phase: 'formation' };
  return {
    ...next,
    phase: 'stickerAssign',
    pendingStickerIds: gifts,
    stickerOffers: [],
    stickerPickCount: gifts.length,
    recruitPicks: [],
    eventId: null,
  };
}

export function setFormation(run: RunState, team: UnitInstance[]): RunState {
  return { ...run, team: compactSlots(team) };
}

export function swapSlots(run: RunState, slotA: number, slotB: number): RunState {
  return moveUnitSlot(run, slotA, slotB);
}

/** Swap two occupied slots, or move a unit into an empty slot. */
export function moveUnitSlot(run: RunState, fromSlot: number, toSlot: number): RunState {
  if (fromSlot === toSlot) return run;
  if (fromSlot < 1 || fromSlot > MAX_TEAM || toSlot < 1 || toSlot > MAX_TEAM) return run;
  const team = cloneTeam(run.team);
  const a = team.find((u) => u.slot === fromSlot);
  if (!a) return run;
  const b = team.find((u) => u.slot === toSlot);
  if (b) {
    a.slot = toSlot;
    b.slot = fromSlot;
  } else {
    a.slot = toSlot;
  }
  return { ...run, team };
}

export function playerSnapshot(run: RunState): TeamSnapshot {
  const snap = makeSnapshot({
    playerId: run.playerId,
    playerName: run.playerName,
    runId: run.runId,
    round: run.round,
    team: run.team,
    lostLastRound: lostLastScrap(run),
    lossesThisRun: run.losses,
    stickersGained: run.stickersGained ?? 0,
    deathsThisRun: run.deathsThisRun ?? 0,
  });
  snap.createdAt = Date.now();
  return snap;
}

export function resolveFight(run: RunState, enemy: TeamSnapshot): RunState {
  const team = capTeam(run.team);
  const packed = { ...run, team };
  const player = playerSnapshot(packed);
  const foe = { ...enemy, units: capTeam(enemy.units, teamSizeForRound(run.round)) };
  const seed = mixSeed(run.seed, run.round, 0x51a7);
  const result = simulateBattle(player, foe, seed);
  const win = result.winner === 'player';
  const gained = result.winner === 'player' ? 3 : result.winner === 'draw' ? 1 : 0;
  const wins = run.wins + (win ? 1 : 0);
  const losses = run.losses + (win ? 0 : result.winner === 'draw' ? 0 : 1);
  const draw = result.winner === 'draw';
  const next: RunState = {
    ...run,
    wins,
    losses: draw ? run.losses : losses,
    victoryPoints: victoryPointsOf(run) + gained,
    lastBattle: result,
    phase: 'result',
    history: [
      ...run.history,
      {
        round: run.round,
        win,
        winner: result.winner,
        opponentName: foe.playerName,
        opponentId: foe.playerId,
        survivorDiff: result.survivorCount.player - result.survivorCount.enemy,
        hpPctPlayer: result.hpPct.player,
        hpPctEnemy: result.hpPct.enemy,
        seed,
        events: result.events,
        playerSnap: player,
        enemySnap: foe,
      },
    ],
  };
  const persisted = persistBattleTeam({ ...next, team });
  const settled: RunState = {
    ...next,
    team: applyLossGrowth(persisted.team, result.winner),
    stickerBag: persisted.stickerBag,
    deathsThisRun: persisted.deathsThisRun,
    stickersGained: persisted.stickersGained,
  };
  return settleCircuit(settled, foe);
}

export function afterResult(run: RunState): RunState {
  if (run.round >= 10) return { ...run, phase: 'final' };
  const gifts = (run.lastBattle?.events ?? []).flatMap((ev) =>
    ev.type === 'EarnedSticker' && ev.unitId.startsWith('player:') ? [ev.stickerId] : [],
  );
  if (gifts.length) {
    return {
      ...run,
      phase: 'stickerAssign',
      pendingStickerIds: gifts,
      stickerOffers: [],
      stickerPickCount: gifts.length,
      recruitOffers: [],
      recruitPicks: [],
    };
  }
  return beginPostFight(run);
}

function beginPostFight(run: RunState): RunState {
  const rng = rngFor({ ...run, offerCounter: run.offerCounter + 1 }, 0xe7e);
  const ev = rng.pick(Array.from(EVENT_BY_ID.keys()));
  return {
    ...run,
    phase: 'postFight',
    pendingStickerIds: [],
    stickerOffers: [],
    stickerPickCount: STICKER_PICK,
    recruitOffers: [],
    recruitPicks: [],
    eventId: ev,
    eventStep: null,
    eventOffers: [],
    eventPicks: [],
    huntMonsterId: ev === 'monster-hunt' ? rng.pick(huntMonstersFor(run.round)).unitId : null,
    lastBonusBattle: null,
    alleyPicks: [],
    alleyQueue: [],
    alleyDone: [],
    offerCounter: run.offerCounter + 1,
  };
}

function isScrapStickerLoot(run: RunState): boolean {
  return run.phase === 'stickerAssign' && !run.stickerOffers.length && !run.recruitPicks.length && !run.eventId;
}

function isOpeningStickerGift(run: RunState): boolean {
  return isScrapStickerLoot(run) && run.history.length === 0 && !(run.alleyDone?.length);
}

function clearAlleyWork(run: RunState): RunState {
  return {
    ...run,
    pendingStickerIds: [],
    stickerOffers: [],
    recruitOffers: [],
    recruitPicks: [],
    eventStep: null,
    eventOffers: [],
    eventPicks: [],
    lastBonusBattle: null,
  };
}

function startAlleyChoice(run: RunState, pick: AlleyChoice): RunState {
  if (pick === 'recruit') return beginRecruit(run);
  if (pick === 'sticker') return beginSticker(run);
  return beginEvent(run);
}

function activeAlley(run: RunState): AlleyChoice | null {
  // Event rewards reuse the recruit and sticker screens. eventStep stays set
  // until the reward is settled, so those must close the event, not the shop.
  if (run.phase === 'event' || run.eventStep) return 'event';
  if (run.phase === 'recruit') return 'recruit';
  if (run.phase === 'sticker') return 'sticker';
  if (run.phase === 'stickerAssign') {
    if (run.stickerOffers.length) return 'sticker';
    if (run.recruitPicks.length) return 'recruit';
    return null;
  }
  return null;
}

function leaveAlley(run: RunState): RunState {
  const grown = growCircuit(run);
  return {
    ...clearAlleyWork(grown),
    team: compactSlots(grown.team),
    phase: 'formation',
    round: grown.round + 1,
    alleyPicks: [],
    alleyQueue: [],
    alleyDone: [],
    eventId: null,
    huntMonsterId: null,
  };
}

export function finishAlley(run: RunState): RunState {
  const done = activeAlley(run);
  const prev = run.alleyDone ?? [];
  const alleyDone = done && !prev.includes(done) ? [...prev, done] : prev;
  const cleared = clearAlleyWork({ ...run, alleyDone, alleyPicks: [], alleyQueue: [] });
  if (alleyDone.length >= ALLEY_PICK) return leaveAlley(cleared);
  return { ...cleared, phase: 'postFight' };
}

export function passAlley(run: RunState): RunState {
  if (run.phase === 'postFight') return leaveAlley(run);
  if (!activeAlley(run)) return run;
  return leaveAlley(run);
}

export function toggleAlleyPick(run: RunState, pick: AlleyChoice): RunState {
  return chooseAlley(run, pick);
}

export function confirmAlleyPicks(run: RunState): RunState {
  return run;
}

export function chooseAlley(run: RunState, pick: AlleyChoice): RunState {
  if (run.phase !== 'postFight') return run;
  const done = run.alleyDone ?? [];
  if (done.includes(pick) || done.length >= ALLEY_PICK) return run;
  return startAlleyChoice(run, pick);
}

export function beginSticker(run: RunState): RunState {
  const rng = rngFor(run, 0x57c);
  const offers = offerStickers(STICKER_OFFER, rng, run.round);
  return {
    ...run,
    phase: 'sticker',
    stickerOffers: offers,
    stickerPickCount: STICKER_PICK,
    pendingStickerIds: [],
    offerCounter: run.offerCounter + 1,
  };
}

export function beginEvent(run: RunState): RunState {
  const rng = rngFor(run, 0xe7e);
  const eventId = run.eventId && EVENT_BY_ID.has(run.eventId) ? run.eventId : rng.pick(Array.from(EVENT_BY_ID.keys()));
  const huntMonsterId =
    eventId === 'monster-hunt'
      ? run.huntMonsterId ?? rng.pick(huntMonstersFor(run.round)).unitId
      : run.huntMonsterId;
  const eventStep =
    eventId === 'wishing-well' ? 'preview'
    : eventId === 'book-of-lost-tales' ? 'book-kind'
    : eventId === 'monster-hunt' ? 'hunt-lineup'
    : 'preview';
  const opened = {
    ...run,
    phase: 'event' as const,
    eventId,
    eventStep,
    eventOffers: [] as string[],
    eventPicks: [] as string[],
    huntMonsterId,
    offerCounter: run.offerCounter + 1,
  };
  return eventId === 'book-of-lost-tales' ? ensureBookOffers(opened) : opened;
}

const BOOK_UNIT = 'book-unit:';
const BOOK_STICKER = 'book-sticker:';

export function bookSpread(run: RunState): { unitId: string | null; stickerId: string | null } {
  const unit = run.eventOffers.find((o) => o.startsWith(BOOK_UNIT));
  const sticker = run.eventOffers.find((o) => o.startsWith(BOOK_STICKER));
  return {
    unitId: unit ? unit.slice(BOOK_UNIT.length) : null,
    stickerId: sticker ? sticker.slice(BOOK_STICKER.length) : null,
  };
}

/** Roll the sticker and the unit once, at the loss rarity, before the book opens. */
export function ensureBookOffers(run: RunState): RunState {
  if (run.eventId !== 'book-of-lost-tales' || run.eventStep !== 'book-kind') return run;
  if (run.eventOffers.includes('book-picked')) return run;
  const have = bookSpread(run);
  if (have.unitId && have.stickerId) return run;
  const rarity = lossRewardRarity(run.losses);
  const unitId = have.unitId ?? randomUnitOfRarity(rarity, rngFor(run, 0xb12));
  const stickerId = have.stickerId ?? offerStickersOfRarity(rarity, 1, rngFor(run, 0xb11))[0] ?? null;
  const eventOffers = run.eventOffers.filter((o) => !o.startsWith(BOOK_UNIT) && !o.startsWith(BOOK_STICKER));
  if (unitId) eventOffers.push(`${BOOK_UNIT}${unitId}`);
  if (stickerId) eventOffers.push(`${BOOK_STICKER}${stickerId}`);
  return { ...run, eventOffers };
}

/** @deprecated Events are rolled once per alley; kept for tests/compat. */
export function chooseEvent(run: RunState, eventId: EventId): RunState {
  if (run.phase !== 'event' && run.phase !== 'postFight') return run;
  if (!EVENT_BY_ID.has(eventId)) return run;
  return beginEvent({ ...run, eventId, phase: 'event', eventStep: null });
}

export function toggleStickerPick(run: RunState, id: string): RunState {
  const has = run.pendingStickerIds.includes(id);
  if (has) return { ...run, pendingStickerIds: run.pendingStickerIds.filter((x) => x !== id) };
  if (run.pendingStickerIds.length >= run.stickerPickCount) return run;
  return { ...run, pendingStickerIds: [...run.pendingStickerIds, id] };
}

export function confirmStickerPicks(run: RunState): RunState {
  if (run.pendingStickerIds.length !== run.stickerPickCount) return run;
  return { ...run, phase: 'stickerAssign' };
}

export function storePendingStickers(run: RunState): RunState {
  if (run.pendingStickerIds.length !== run.stickerPickCount) return run;
  return finishAlley({
    ...run,
    stickerBag: [...run.stickerBag, ...run.pendingStickerIds],
    pendingStickerIds: [],
    stickersGained: (run.stickersGained ?? 0) + run.pendingStickerIds.length,
  });
}

export function skipStickers(run: RunState): RunState {
  if (run.phase !== 'sticker' && run.phase !== 'stickerAssign') return run;
  if (isOpeningStickerGift(run)) return { ...run, phase: 'formation', pendingStickerIds: [] };
  if (isScrapStickerLoot(run)) return beginPostFight({ ...run, pendingStickerIds: [] });
  // Event sticker reward: throwing away closes the event (same as recruit throw).
  if (run.eventId && run.phase === 'stickerAssign') {
    return finishAlley({ ...run, pendingStickerIds: [] });
  }
  return finishAlley({ ...run, pendingStickerIds: [] });
}

export function assignPendingSticker(
  run: RunState,
  instanceId: string,
  replaceIndex?: number,
  stickerId?: string,
  opts?: { settle?: boolean },
): RunState {
  if (!run.pendingStickerIds.length) return run;
  const pending = [...run.pendingStickerIds];
  const idx = stickerId ? pending.indexOf(stickerId) : 0;
  if (idx < 0) return run;
  const [sid] = pending.splice(idx, 1);
  if (!sid) return run;
  const plateRng = rngFor(run, 0x51a7);
  const fromId = run.team.find((u) => u.instanceId === instanceId)?.defId;
  const team = spreadIfMythic(
    shareStickerOnApply(
      cloneTeam(run.team).map((u) => (u.instanceId === instanceId ? applySticker(u, sid, replaceIndex, plateRng) : u)),
      instanceId,
      sid,
      fromId,
    ),
    sid,
    plateRng,
  );
  const next = { ...run, team, pendingStickerIds: pending, stickersGained: (run.stickersGained ?? 0) + 1 };
  if (pending.length) return next;
  if (opts?.settle === false) return next;
  return settleStickerAssign(next);
}

/** Apply a shop offer onto a unit but stay on the sticker screen (UI shows FX, then settles). */
export function applyShopSticker(run: RunState, stickerId: string, instanceId: string, replaceIndex?: number): RunState {
  if (run.phase !== 'sticker') return run;
  if (!run.stickerOffers.includes(stickerId)) return run;
  const inst = run.team.find((u) => u.instanceId === instanceId);
  if (!inst) return run;
  if (!canAcceptSticker(inst) && replaceIndex == null) return run;
  const plateRng = rngFor(run, 0x51a9);
  const fromId = inst.defId;
  const team = spreadIfMythic(
    shareStickerOnApply(
      cloneTeam(run.team).map((u) => (u.instanceId === instanceId ? applySticker(u, stickerId, replaceIndex, plateRng) : u)),
      instanceId,
      stickerId,
      fromId,
    ),
    stickerId,
    plateRng,
  );
  return {
    ...run,
    team,
    stickersGained: (run.stickersGained ?? 0) + 1,
  };
}

export function settleStickerShop(run: RunState): RunState {
  if (run.phase !== 'sticker') return run;
  return finishAlley({ ...run, pendingStickerIds: [], stickerOffers: [] });
}

export function settleStickerAssign(run: RunState): RunState {
  if (run.phase !== 'stickerAssign') return run;
  if (run.pendingStickerIds.length) return run;
  if (isOpeningStickerGift(run)) return { ...run, phase: 'formation', pendingStickerIds: [] };
  if (isScrapStickerLoot(run)) return beginPostFight({ ...run, pendingStickerIds: [] });
  return finishAlley({ ...run, pendingStickerIds: [] });
}

export function applyBagSticker(run: RunState, stickerId: string, instanceId: string, replaceIndex?: number): RunState {
  const bagIdx = run.stickerBag.indexOf(stickerId);
  if (bagIdx < 0) return run;
  const inst = run.team.find((u) => u.instanceId === instanceId);
  if (!inst) return run;
  if (!canAcceptSticker(inst) && replaceIndex == null) return run;
  const plateRng = rngFor(run, 0x51a8);
  const fromId = inst.defId;
  const team = spreadIfMythic(
    shareStickerOnApply(
      cloneTeam(run.team).map((u) => (u.instanceId === instanceId ? applySticker(u, stickerId, replaceIndex, plateRng) : u)),
      instanceId,
      stickerId,
      fromId,
    ),
    stickerId,
    plateRng,
  );
  const stickerBag = run.stickerBag.slice();
  stickerBag.splice(bagIdx, 1);
  return { ...run, team, stickerBag };
}

export function beginRecruit(run: RunState): RunState {
  const rng = rngFor(run, 0x9ec);
  return {
    ...run,
    phase: 'recruit',
    recruitOffers: offerUnits(run.round, RECRUIT_OFFER, rng, new Set(), run.recruitRarityBump),
    recruitPicks: [],
    offerCounter: run.offerCounter + 1,
    recruitRarityBump: false,
  };
}

function canTakeRecruit(run: RunState, defId: string): boolean {
  if (run.phase !== 'recruit') return false;
  if (!run.recruitOffers.includes(defId)) return false;
  if (run.recruitPicks.includes(defId)) return false;
  return run.recruitPicks.length < recruitPickLimit(run.recruitPicks, run.eventId, run.eventStep);
}

function appendGoldRecruit(run: RunState, team: UnitInstance[], defId: string): UnitInstance[] {
  if (!grantsGoldOnRecruit(defId)) return team;
  if (team.length >= MAX_TEAM) return team;
  const gold = collectRecruitGoldUnits(run, [defId])[0];
  if (!gold) return team;
  const slot = firstFreeSlot(team);
  if (slot < 1 || slot > MAX_TEAM || team.some((u) => u.slot === slot)) return team;
  return [...team, instanceFromDef(gold, slot, makeId('u'))];
}

/** Drag an offer onto an empty team slot. */
export function placeRecruit(run: RunState, defId: string, slot: number): RunState {
  if (!canTakeRecruit(run, defId)) return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  let team = cloneTeam(run.team);
  if (team.some((u) => u.slot === slot)) return run;
  team.push(instanceFromDef(defId, slot, makeId('u')));
  team = appendGoldRecruit(run, team, defId);
  return {
    ...run,
    team,
    recruitPicks: [...run.recruitPicks, defId],
    recruitOffers: run.recruitOffers.filter((id) => id !== defId),
  };
}

/** Drag an offer onto an occupied slot — fires the occupant (stickers and all). */
export function replaceRecruit(run: RunState, defId: string, slot: number): RunState {
  if (!canTakeRecruit(run, defId)) return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  let team = cloneTeam(run.team);
  const victim = team.find((u) => u.slot === slot);
  if (!victim) return placeRecruit(run, defId, slot);
  team = team.filter((u) => u.instanceId !== victim.instanceId);
  team.push(instanceFromDef(defId, slot, makeId('u')));
  team = appendGoldRecruit(run, team, defId);
  return rememberLost(
    {
      ...run,
      team,
      recruitPicks: [...run.recruitPicks, defId],
      recruitOffers: run.recruitOffers.filter((id) => id !== defId),
    },
    [victim],
  );
}

/** Leave the recruit shop; units are already on the team from place/replace. */
export function finishRecruit(run: RunState): RunState {
  const taking = run.recruitPicks;
  const bump = taking.some(hasRecruitRarityBump);
  const granted = collectRecruitStickers(run, taking);
  const next = {
    ...run,
    pendingStickerIds: granted,
    recruitRarityBump: run.recruitRarityBump || bump,
  };
  if (granted.length) return { ...next, phase: 'stickerAssign' as const };
  return finishAlley(next);
}

/** @deprecated Prefer placeRecruit + finishRecruit. Kept for batch callers. */
export function toggleRecruit(run: RunState, defId: string): RunState {
  const has = run.recruitPicks.includes(defId);
  if (has) return { ...run, recruitPicks: run.recruitPicks.filter((id) => id !== defId) };
  const nextPicks = [...run.recruitPicks, defId];
  if (nextPicks.length > recruitPickLimit(nextPicks)) return run;
  return { ...run, recruitPicks: nextPicks };
}

/** Picked units that restocked their shop slot stay visible as selected. */
export function recruitShopDisplay(run: RunState): string[] {
  const extra = run.recruitPicks.filter((id) => !run.recruitOffers.includes(id));
  return [...extra, ...run.recruitOffers];
}

/** @deprecated Prefer placeRecruit / replaceRecruit + finishRecruit. */
export function confirmRecruit(run: RunState, cuts: string[]): RunState {
  let team = cloneTeam(run.team);
  const cutUnits = team.filter((u) => cuts.includes(u.instanceId));
  for (const cutId of cuts) team = team.filter((u) => u.instanceId !== cutId);
  const room = MAX_TEAM - team.length;
  const taking = planRecruitAdds(run, run.recruitPicks, room);
  for (const defId of taking) {
    const slot = firstFreeSlot(team);
    team.push(instanceFromDef(defId, slot, makeId('u')));
  }
  const bump = taking.some(hasRecruitRarityBump);
  const granted = collectRecruitStickers(run, taking);
  const next = {
    ...rememberLost(run, cutUnits),
    team: compactSlots(team),
    recruitPicks: taking,
    pendingStickerIds: granted,
    recruitRarityBump: run.recruitRarityBump || bump,
  };
  if (granted.length) return { ...next, phase: 'stickerAssign' as const };
  return finishAlley(next);
}

export function skipRecruit(run: RunState): RunState {
  if (run.recruitPicks.length) return finishRecruit(run);
  return finishAlley({ ...run, recruitPicks: [] });
}

export function neededCuts(run: RunState): number {
  return Math.max(0, run.team.length + run.recruitPicks.length + goldUnitsOnRecruit(run.recruitPicks) - MAX_TEAM);
}

export function teamHasAppliedStickers(run: RunState): boolean {
  return run.team.some((u) => u.stickerIds.length > 0);
}

function taleOf(u: UnitInstance): LostTale {
  return {
    defId: u.defId,
    stickerIds: [...u.stickerIds],
    permanentMods: { ...u.permanentMods },
  };
}

function rememberLost(run: RunState, units: UnitInstance[]): RunState {
  if (!units.length) return run;
  return { ...run, lostTales: [...(run.lostTales ?? []), ...units.map(taleOf)] };
}

function copyUnit(source: { defId: string; stickerIds: string[]; permanentMods: UnitInstance['permanentMods'] }, slot: number): UnitInstance {
  return {
    instanceId: makeId('u'),
    defId: source.defId,
    slot,
    stickerIds: [...source.stickerIds],
    permanentMods: { ...source.permanentMods },
  };
}

function grantEventStickers(run: RunState, ids: string[]): RunState {
  const kept = ids.filter((id) => STICKER_BY_ID.has(id));
  if (!kept.length) return finishAlley(run);
  // Stay tied to this alley event until every sticker is glued or discarded.
  return {
    ...run,
    phase: 'stickerAssign',
    eventId: run.eventId,
    eventStep: 'reward',
    pendingStickerIds: kept,
    stickerPickCount: kept.length,
    stickerOffers: [],
    stickersGained: (run.stickersGained ?? 0) + kept.length,
  };
}

export function eventIsBlocked(run: RunState): boolean {
  if (run.eventStep === 'pick' || run.eventStep === 'well-kind' || run.eventStep === 'book-kind') return false;
  if (run.eventId === 'wishing-well') {
    if (run.eventStep === 'well-pick' || run.eventStep === 'reward-unit') return false;
    if (run.eventOffers[0] === 'kind:sticker') return !teamHasAppliedStickers(run);
    return run.team.length < 1;
  }
  if (run.eventId === 'cloning-chamber' || run.eventId === 'witch-oven') return run.team.length < 1;
  return false;
}

export function lostTaleOffers(run: RunState): LostTale[] {
  return (run.lostTales ?? []).slice(-3);
}

export function resolveHuntFight(run: RunState): RunState {
  if (run.eventId !== 'monster-hunt' || !run.huntMonsterId) return run;
  let inst = instanceFromDef(run.huntMonsterId, 1, makeId('hunt'));
  inst.permanentMods = huntPower(huntLevelForRound(run.round));
  const glued = huntStickerFor(run.huntMonsterId);
  if (glued) inst = applySticker(inst, glued);
  const enemy = makeSnapshot({
    playerId: 'monster-hunt',
    playerName: run.huntMonsterId,
    runId: run.runId,
    round: run.round,
    team: [inst],
  });
  enemy.createdAt = Date.now();
  const player = playerSnapshot(run);
  const seed = mixSeed(run.seed, run.round, 0xb07);
  const result = simulateBattle(player, enemy, seed);
  const next = { ...run, lastBonusBattle: result, lastBattle: result, eventStep: 'hunt-result' as const };
  const persisted = persistBattleTeam(next);
  return {
    ...next,
    team: applyLossGrowth(persisted.team, result.winner),
    stickerBag: persisted.stickerBag,
    deathsThisRun: persisted.deathsThisRun,
    stickersGained: persisted.stickersGained,
  };
}

export function claimHunt(run: RunState): RunState {
  if (run.eventId !== 'monster-hunt' || run.eventStep !== 'hunt-result') return run;
  const won = run.lastBonusBattle?.winner === 'player';
  const sid = won && run.huntMonsterId ? huntStickerFor(run.huntMonsterId) : null;
  if (!sid) return finishAlley(run);
  return grantEventStickers(run, [sid]);
}

export function skipEmptyEvent(run: RunState): RunState {
  if (run.phase !== 'event') return run;
  if (
    run.eventStep === 'reward' ||
    run.eventStep === 'reward-unit' ||
    run.eventStep === 'oven-apply' ||
    run.eventStep === 'roster-cut'
  ) {
    return run;
  }
  return finishAlley(run);
}

export function pickEventKind(run: RunState, kind: 'unit' | 'sticker'): RunState {
  if (run.phase !== 'event') return run;
  if (run.eventId === 'wishing-well' && run.eventStep === 'well-kind') {
    return {
      ...run,
      eventStep: 'preview',
      eventOffers: [`kind:${kind}`],
      eventPicks: [],
    };
  }
  if (run.eventId === 'book-of-lost-tales' && run.eventStep === 'book-kind') {
    return grantBookReward(run, kind);
  }
  return run;
}

function grantBookReward(run: RunState, kind: 'unit' | 'sticker'): RunState {
  const ready = ensureBookOffers(run);
  const spread = bookSpread(ready);
  const rarity = lossRewardRarity(ready.losses);
  const rng = rngFor(ready, 0xb00);
  if (kind === 'sticker') {
    const sid = spread.stickerId ?? offerStickersOfRarity(rarity, 1, rng)[0];
    if (!sid) return finishAlley(ready);
    return grantEventStickers({ ...ready, eventStep: 'preview' }, [sid]);
  }
  const defId = spread.unitId ?? randomUnitOfRarity(rarity, rng);
  if (!defId) return finishAlley(ready);
  return placeCopy(
    { ...ready, eventStep: 'preview' },
    { defId, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } },
  );
}

/** Place the book's unit on an empty slot, or fire the occupant of a full slot. */
export function replaceBookUnit(run: RunState, slot: number): RunState {
  if (run.phase !== 'event' || run.eventId !== 'book-of-lost-tales' || run.eventStep !== 'book-kind') return run;
  if (run.eventOffers.includes('book-picked')) return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  const ready = ensureBookOffers(run);
  const defId = bookSpread(ready).unitId;
  if (!defId) return run;
  const team = cloneTeam(ready.team);
  const victim = team.find((u) => u.slot === slot);
  if (!victim) return claimBookUnit(ready, slot);
  const next = team.filter((u) => u.instanceId !== victim.instanceId);
  next.push(copyUnit({ defId, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } }, slot));
  const eventOffers = ready.eventOffers.filter((o) => !o.startsWith(BOOK_UNIT));
  eventOffers.push('book-picked');
  return rememberLost(
    {
      ...ready,
      team: next,
      eventOffers,
      eventPicks: [],
      pendingStickerIds: [],
    },
    [victim],
  );
}

/** Place the book's unit on an empty slot. Only that page clears; the sticker stays until the event closes. */
export function claimBookUnit(run: RunState, slot: number): RunState {
  if (run.phase !== 'event' || run.eventId !== 'book-of-lost-tales' || run.eventStep !== 'book-kind') return run;
  if (run.eventOffers.includes('book-picked')) return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  const ready = ensureBookOffers(run);
  const defId = bookSpread(ready).unitId;
  if (!defId) return run;
  const team = cloneTeam(ready.team);
  if (team.some((u) => u.slot === slot)) return run;
  team.push(copyUnit({ defId, stickerIds: [], permanentMods: { atk: 0, hp: 0, speed: 0 } }, slot));
  const eventOffers = ready.eventOffers.filter((o) => !o.startsWith(BOOK_UNIT));
  eventOffers.push('book-picked');
  return {
    ...ready,
    team: compactSlots(team),
    eventOffers,
    eventPicks: [],
    pendingStickerIds: [],
  };
}

/** Glue the book's sticker onto a team unit. Only that page clears; the card stays until the event closes. */
export function claimBookSticker(run: RunState, instanceId: string, replaceIndex?: number): RunState {
  if (run.phase !== 'event' || run.eventId !== 'book-of-lost-tales' || run.eventStep !== 'book-kind') return run;
  if (run.eventOffers.includes('book-picked')) return run;
  const ready = ensureBookOffers(run);
  const sid = bookSpread(ready).stickerId;
  if (!sid || !STICKER_BY_ID.has(sid)) return run;
  const unit = ready.team.find((u) => u.instanceId === instanceId);
  if (!unit || (!canAcceptSticker(unit) && replaceIndex == null)) return run;
  const plateRng = rngFor(ready, 0xb13);
  const fromId = unit.defId;
  const team = spreadIfMythic(
    shareStickerOnApply(
      cloneTeam(ready.team).map((u) => (u.instanceId === instanceId ? applySticker(u, sid, replaceIndex, plateRng) : u)),
      instanceId,
      sid,
      fromId,
    ),
    sid,
    plateRng,
  );
  const eventOffers = ready.eventOffers.filter((o) => !o.startsWith(BOOK_STICKER));
  eventOffers.push('book-picked');
  return {
    ...ready,
    team,
    eventOffers,
    eventPicks: [],
    pendingStickerIds: [],
    stickersGained: (ready.stickersGained ?? 0) + 1,
  };
}

/** The book choice is done. Leave the event without a recruit or sticker shop. */
export function settleBookChoice(run: RunState): RunState {
  if (run.eventId !== 'book-of-lost-tales' || !run.eventOffers.includes('book-picked')) return run;
  return finishAlley({
    ...run,
    eventOffers: [],
    eventPicks: [],
    pendingStickerIds: [],
  });
}

export function eventSelectUnit(run: RunState, instanceId: string): RunState {
  if (run.phase !== 'event') return run;

  const unit = run.team.find((u) => u.instanceId === instanceId);
  if (!unit) return run;

  if (run.eventStep === 'roster-cut') {
    return resolveRosterCut(run, instanceId);
  }

  if (
    run.eventId === 'wishing-well' &&
    (run.eventStep === 'preview' || run.eventStep === 'well-kind') &&
    run.eventOffers[0] !== 'kind:sticker'
  ) {
    return sacrificeWellUnit(run, instanceId);
  }

  if (run.eventId === 'wishing-well' && run.eventStep === 'preview' && run.eventOffers[0] === 'kind:sticker') {
    if (!unit.stickerIds.length) return run;
    if (unit.stickerIds.length === 1) return sacrificeWellSticker(run, instanceId, unit.stickerIds[0]!);
    return { ...run, eventPicks: [instanceId], eventStep: 'well-sticker' };
  }

  if (run.eventId === 'witch-oven' && run.eventStep === 'preview') {
    return resolveOven(run, instanceId);
  }

  if (run.eventId === 'cloning-chamber' && run.eventStep === 'preview') {
    return placeCopy(run, {
      defId: unit.defId,
      stickerIds: [],
      permanentMods: { ...unit.permanentMods },
    });
  }

  if (run.eventId === 'witch-oven' && run.eventStep === 'oven-apply') {
    return ovenApplyToUnit(run, instanceId);
  }

  return run;
}

export function eventSelectSticker(run: RunState, instanceId: string, stickerId: string): RunState {
  if (run.phase !== 'event') return run;
  const unit = run.team.find((u) => u.instanceId === instanceId);
  if (!unit || !unit.stickerIds.includes(stickerId)) return run;
  if (run.eventId === 'wishing-well' && (run.eventStep === 'preview' || run.eventStep === 'well-sticker' || run.eventStep === 'well-kind')) {
    if (run.eventOffers[0] && run.eventOffers[0] !== 'kind:sticker') return run;
    if (run.eventStep === 'well-sticker' && run.eventPicks[0] !== instanceId) return run;
    return sacrificeWellSticker(run, instanceId, stickerId);
  }
  return run;
}

function sacrificeWellUnit(run: RunState, instanceId: string): RunState {
  const victim = run.team.find((u) => u.instanceId === instanceId);
  if (!victim) return run;
  const rarity = nextWellRarity(getUnit(victim.defId).rarity);
  const rng = rngFor(run, 0x111);
  const nextId = randomUnitOfRarity(rarity, rng, victim.defId);
  const team = cloneTeam(run.team).filter((u) => u.instanceId !== instanceId);
  const base = rememberLost({ ...run, team: compactSlots(team), eventPicks: [], eventOffers: [] }, [victim]);
  if (!nextId) return finishAlley(base);
  return {
    ...base,
    phase: 'recruit',
    eventStep: 'reward',
    recruitOffers: [nextId],
    recruitPicks: [],
    eventOffers: [],
    eventPicks: [],
  };
}

function sacrificeWellSticker(run: RunState, instanceId: string, stickerId: string): RunState {
  const rarity = nextWellRarity(getSticker(stickerId).rarity);
  const rng = rngFor(run, 0x111);
  const team = cloneTeam(run.team).map((u) => {
    if (u.instanceId !== instanceId) return u;
    return { ...u, stickerIds: u.stickerIds.filter((id) => id !== stickerId) };
  });
  const reward = offerStickersOfRarity(rarity, 1, rng)[0];
  if (!reward) return finishAlley({ ...run, team, eventPicks: [], eventOffers: [] });
  return grantEventStickers(
    { ...run, team, eventStep: 'well-pick', eventPicks: [], eventOffers: [reward], offerCounter: run.offerCounter + 1 },
    [reward],
  );
}

/** Legacy: auto-claim if UI still calls it; reward is already a single sticker. */
export function pickWellSticker(run: RunState, stickerId: string): RunState {
  if (run.eventStep !== 'well-pick' || !run.eventOffers.includes(stickerId)) return run;
  return grantEventStickers(run, [stickerId]);
}

function resolveOven(run: RunState, instanceId: string): RunState {
  const victim = run.team.find((u) => u.instanceId === instanceId);
  if (!victim) return run;
  const recovered = [...victim.stickerIds];
  const team = cloneTeam(run.team).filter((u) => u.instanceId !== instanceId);
  const next = rememberLost({ ...run, team: compactSlots(team), eventPicks: [] }, [victim]);
  if (!recovered.length) return finishAlley(next);
  return grantEventStickers(next, recovered);
}

export function ovenDiscardSticker(run: RunState): RunState {
  if (run.phase !== 'event' || run.eventStep !== 'oven-apply' || !run.pendingStickerIds.length) return run;
  const rest = run.pendingStickerIds.slice(1);
  if (!rest.length) return finishAlley({ ...run, pendingStickerIds: [] });
  return { ...run, pendingStickerIds: rest };
}

function ovenApplyToUnit(run: RunState, instanceId: string): RunState {
  const sid = run.pendingStickerIds[0];
  if (!sid) return finishAlley({ ...run, pendingStickerIds: [] });
  const unit = run.team.find((u) => u.instanceId === instanceId);
  if (!unit || !canAcceptSticker(unit)) return run;
  const plateRng = rngFor(run, 0xe01);
  const team = spreadIfMythic(
    cloneTeam(run.team).map((u) => (u.instanceId === instanceId ? applySticker(u, sid, undefined, plateRng) : u)),
    sid,
    plateRng,
  );
  const rest = run.pendingStickerIds.slice(1);
  if (!rest.length) return finishAlley({ ...run, team, pendingStickerIds: [] });
  return { ...run, team, pendingStickerIds: rest };
}

function beginUnitReward(
  run: RunState,
  source: { defId: string; stickerIds: string[]; permanentMods: UnitInstance['permanentMods'] },
): RunState {
  return {
    ...run,
    phase: 'event',
    eventStep: 'reward-unit',
    eventPicks: [],
    eventOffers: [JSON.stringify({
      defId: source.defId,
      stickerIds: source.stickerIds,
      permanentMods: source.permanentMods,
    } satisfies LostTale)],
    pendingStickerIds: [],
  };
}

export function eventUnitReward(run: RunState): LostTale | null {
  return pendingUnitReward(run);
}

function pendingUnitReward(run: RunState): LostTale | null {
  if (run.eventStep !== 'reward-unit' && run.eventStep !== 'roster-cut') return null;
  return pendingCopy(run);
}

/** Drag the revealed unit onto an empty slot — same as recruit shop. */
export function placeEventUnit(run: RunState, slot: number): RunState {
  const source = pendingUnitReward(run);
  if (!source || run.eventStep !== 'reward-unit') return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  let team = cloneTeam(run.team);
  if (team.some((u) => u.slot === slot)) return run;
  team.push(copyUnit(source, slot));
  return finishAlley({
    ...run,
    team: compactSlots(team),
    eventPicks: [],
    eventOffers: [],
  });
}

/** Drag onto an occupied slot — destroy occupant (stickers and all). */
export function replaceEventUnit(run: RunState, slot: number): RunState {
  const source = pendingUnitReward(run);
  if (!source || run.eventStep !== 'reward-unit') return run;
  if (slot < 1 || slot > MAX_TEAM) return run;
  let team = cloneTeam(run.team);
  const victim = team.find((u) => u.slot === slot);
  if (!victim) return placeEventUnit(run, slot);
  team = team.filter((u) => u.instanceId !== victim.instanceId);
  team.push(copyUnit(source, slot));
  return finishAlley(
    rememberLost(
      {
        ...run,
        team: compactSlots(team),
        eventPicks: [],
        eventOffers: [],
      },
      [victim],
    ),
  );
}

/** Throw the revealed unit/sticker reward away and leave the event. */
export function throwEventReward(run: RunState): RunState {
  if (run.phase === 'event' && run.eventStep === 'reward-unit') {
    return finishAlley({ ...run, eventPicks: [], eventOffers: [], pendingStickerIds: [] });
  }
  if (run.phase === 'stickerAssign' && run.eventId && run.eventStep === 'reward') {
    return finishAlley({ ...run, pendingStickerIds: [] });
  }
  return run;
}

/** @deprecated Use placeEventUnit / throwEventReward. */
export function claimEventReward(run: RunState): RunState {
  return throwEventReward(run);
}

function placeCopy(
  run: RunState,
  source: { defId: string; stickerIds: string[]; permanentMods: UnitInstance['permanentMods'] },
): RunState {
  return beginUnitReward(run, source);
}

function pendingCopy(run: RunState): LostTale | null {
  const raw = run.eventOffers[0];
  if (!raw) return null;
  try {
    const tale = JSON.parse(raw) as LostTale;
    if (!tale?.defId) return null;
    return {
      defId: tale.defId,
      stickerIds: Array.isArray(tale.stickerIds) ? tale.stickerIds : [],
      permanentMods: {
        atk: tale.permanentMods?.atk ?? 0,
        hp: tale.permanentMods?.hp ?? 0,
        speed: tale.permanentMods?.speed ?? 0,
      },
    };
  } catch {
    return null;
  }
}

function resolveRosterCut(run: RunState, instanceId: string): RunState {
  // Legacy path: cutting to make room now happens via replaceEventUnit on reward-unit.
  const source = pendingCopy(run);
  const victim = run.team.find((u) => u.instanceId === instanceId);
  if (!source || !victim) return run;
  const team = cloneTeam(run.team).filter((u) => u.instanceId !== instanceId);
  return beginUnitReward(
    rememberLost({ ...run, team: compactSlots(team), eventOffers: [] }, [victim]),
    source,
  );
}

export function runScore(run: RunState): { survivorDiff: number; hpPctTotal: number } {
  const survivorDiff = run.history.reduce((s, h) => s + h.survivorDiff, 0);
  const hpPctTotal = run.history.reduce((s, h) => s + h.hpPctPlayer, 0);
  return { survivorDiff, hpPctTotal };
}

export function compareRuns(
  a: { wins: number; survivorDiff: number; hpPctTotal: number },
  b: { wins: number; survivorDiff: number; hpPctTotal: number },
): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.survivorDiff !== a.survivorDiff) return b.survivorDiff - a.survivorDiff;
  if (b.hpPctTotal !== a.hpPctTotal) return b.hpPctTotal - a.hpPctTotal;
  return 0;
}

export function validateSnapshot(snap: TeamSnapshot): string[] {
  const errors: string[] = [];
  if (snap.schemaVersion !== 1) errors.push('schema');
  if (snap.units.length < 1 || snap.units.length > MAX_TEAM) errors.push('size');
  const slots = new Set<number>();
  for (const u of snap.units) {
    if (u.slot < 1 || u.slot > MAX_TEAM) errors.push('slot');
    if (slots.has(u.slot)) errors.push('dup-slot');
    slots.add(u.slot);
    if (u.stickerIds.length > 3) errors.push('stickers');
    try {
      getUnitSafe(u.defId);
    } catch {
      errors.push('unit');
    }
    for (const s of u.stickerIds) {
      try {
        getStickerSafe(s);
      } catch {
        errors.push('sticker');
      }
    }
  }
  return errors;
}

function getUnitSafe(id: string): void {
  getUnit(id);
}
function getStickerSafe(id: string): void {
  getSticker(id);
}
