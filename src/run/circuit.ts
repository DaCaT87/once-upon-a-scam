import { canAcceptSticker, cloneTeam, firstFreeSlot, getUnit, makeSnapshot } from '../core/catalog';
import { ovenSweetOffer } from '../data/stickers';
import { mixSeed, SeededRng } from '../core/rng';
import { simulateBattle } from '../sim/simulation';
import type { CircuitRival, RivalVice, RunState, TeamSnapshot } from '../core/types';
import { MAX_TEAM, RUN_ROUNDS } from '../core/types';
import {
  alleyPickFor,
  bestStickerHost,
  ensureFullLine,
  formLine,
  pickDraft,
  pickStickerOffer,
  recruitScore,
  viceAt,
} from '../ai/brain';
import {
  afterResult,
  applyBattleSide,
  applyShopSticker,
  assignPendingSticker,
  bareRun,
  chooseAlley,
  claimBookSticker,
  claimBookUnit,
  claimHunt,
  confirmDraft,
  ensureBookOffers,
  eventIsBlocked,
  eventSelectSticker,
  eventSelectUnit,
  finishRecruit,
  ovenDiscardSticker,
  passAlley,
  pickEventKind,
  placeEventUnit,
  placeRecruit,
  replaceBookUnit,
  replaceEventUnit,
  replaceRecruit,
  resolveHuntFight,
  seatGoldUnit,
  settleBookChoice,
  settleStickerShop,
  skipEmptyEvent,
  skipRecruit,
  skipStickers,
  throwEventReward,
  toggleDraftPick,
} from './runEngine';

const NAMES = [
  'Dolly Two',
  'Ink Pete',
  'Velvet Mae',
  'Lefty Cal',
  'MissRibbon',
  'Porkpie Jo',
  'Mid Clerk',
  'Hattie',
  'Cinder Sid',
  'Brass Nell',
  'Quiet Irv',
  'Marq Bess',
];

function weakest(team: RunState['team']): RunState['team'][number] | undefined {
  return team.slice().sort((a, b) => recruitScore(a.defId, team) - recruitScore(b.defId, team))[0];
}

function strongest(team: RunState['team'], vice: RivalVice = 'brawler'): RunState['team'][number] | undefined {
  return team.slice().sort((a, b) => recruitScore(b.defId, team, vice) - recruitScore(a.defId, team, vice))[0];
}

function copyTales(tales: CircuitRival['lostTales']): CircuitRival['lostTales'] {
  return tales.map((t) => ({
    defId: t.defId,
    stickerIds: [...t.stickerIds],
    permanentMods: { ...t.permanentMods },
  }));
}

export function rivalSnapshot(rival: CircuitRival, round: number): TeamSnapshot {
  const team =
    round <= 1
      ? rival.team
      : ensureFullLine(rival.team, { seed: rival.seed, round, vice: rival.vice, wins: rival.wins });
  const snap = makeSnapshot({
    playerId: rival.playerId,
    playerName: rival.playerName,
    runId: rival.playerId,
    round,
    team: team.length ? team : [],
    lostLastRound: rival.lostLastRound,
    lossesThisRun: rival.losses,
    stickersGained: rival.stickersGained,
    deathsThisRun: rival.deathsThisRun,
  });
  snap.createdAt = rival.seed;
  return snap;
}

function leaderOf(circuit: CircuitRival[]): CircuitRival {
  return circuit
    .slice()
    .sort((a, b) => b.wins - a.wins || b.victoryPoints - a.victoryPoints || a.playerName.localeCompare(b.playerName))[0]!;
}

/** Rounds 1–9: each rival once, in the order they were seated. Round 10: rematch vs the win leader. */
export function circuitOpponent(run: RunState): TeamSnapshot | null {
  const circuit = run.circuit;
  if (!circuit?.length) return null;
  const rival = run.round >= RUN_ROUNDS ? leaderOf(circuit) : circuit[run.round - 1];
  if (!rival) return null;
  return rivalSnapshot(rival, run.round);
}

function takeRival(run: RunState, seed: number, name: string, id: string, vice: RivalVice): CircuitRival {
  return {
    playerId: id,
    playerName: name,
    seed,
    wins: 0,
    losses: 0,
    draws: 0,
    victoryPoints: 0,
    team: formLine(run.team),
    offerCounter: run.offerCounter,
    stickersGained: run.stickersGained ?? 0,
    deathsThisRun: run.deathsThisRun ?? 0,
    lostTales: copyTales(run.lostTales ?? []),
    lostLastRound: false,
    pendingStickerIds: [],
    vice,
  };
}

function stamp(run: RunState): string {
  return [
    run.phase,
    run.round,
    run.eventId ?? '',
    run.eventStep ?? '',
    run.pendingStickerIds.join(','),
    run.recruitPicks.join(','),
    (run.alleyDone ?? []).join(','),
    run.eventOffers.join('|'),
    run.team.length,
  ].join('/');
}

function glueOne(run: RunState, vice: RivalVice): RunState {
  const sweets = run.pendingStickerIds.filter((id) => ovenSweetOffer(id));
  if (sweets.length && sweets.length === run.pendingStickerIds.length) {
    const best = [...sweets].sort((a, b) => (ovenSweetOffer(b)?.amount ?? 0) - (ovenSweetOffer(a)?.amount ?? 0))[0];
    const host = (best && bestStickerHost(run.team, best, vice)) ?? run.team[0];
    if (!best || !host) return skipStickers(run);
    const replace = canAcceptSticker(host) ? undefined : 0;
    return assignPendingSticker(run, host.instanceId, replace, best);
  }
  const sid = run.pendingStickerIds[0];
  const host = (sid && bestStickerHost(run.team, sid, vice)) ?? run.team.find((u) => canAcceptSticker(u)) ?? run.team[0];
  if (!sid || !host) return skipStickers(run);
  const replace = canAcceptSticker(host) ? undefined : 0;
  return assignPendingSticker(run, host.instanceId, replace, sid);
}

function playGifts(run: RunState, vice: RivalVice): RunState {
  let guard = 0;
  while (run.phase === 'stickerAssign' && guard++ < 8) {
    const next = glueOne(run, vice);
    if (stamp(next) === stamp(run)) return skipStickers(run);
    run = next;
  }
  return run.phase === 'stickerAssign' ? skipStickers(run) : run;
}

function takeRecruit(run: RunState, vice: RivalVice): RunState {
  if (run.pendingGoldUnitId && run.eventId === 'book-of-lost-tales') {
    const open = run.team.filter((u) => !getUnit(u.defId).passives?.grantGoldUnitOnRecruit);
    const victim = weakest(open.length ? open : run.team);
    if (!victim) return skipRecruit(run);
    return seatGoldUnit(run, victim.slot);
  }
  const ranked = run.recruitOffers.slice().sort((a, b) => recruitScore(b, run.team, vice) - recruitScore(a, run.team, vice));
  let guard = 0;
  while (run.phase === 'recruit' && ranked.length && guard++ < 4) {
    const id = ranked.shift()!;
    if (!run.recruitOffers.includes(id)) continue;
    const free = firstFreeSlot(run.team);
    if (run.team.length < MAX_TEAM && free >= 1 && free <= MAX_TEAM && !run.team.some((u) => u.slot === free)) {
      const next = placeRecruit(run, id, free);
      if (next === run) break;
      run = next;
      continue;
    }
    const weak = weakest(run.team);
    if (!weak || recruitScore(id, run.team, vice) <= recruitScore(weak.defId, run.team, vice)) break;
    const next = replaceRecruit(run, id, weak.slot);
    if (next === run) break;
    run = next;
  }
  const done = finishRecruit(run);
  return done.phase === 'recruit' ? skipRecruit(run) : done;
}

function takeSticker(run: RunState, vice: RivalVice): RunState {
  const sid = pickStickerOffer(run.team, run.stickerOffers, vice);
  if (sid && run.team.length) {
    const host = bestStickerHost(run.team, sid, vice) ?? run.team[0]!;
    const replace = canAcceptSticker(host) ? undefined : 0;
    run = applyShopSticker(run, sid, host.instanceId, replace);
  }
  return settleStickerShop(run);
}

function stepEvent(run: RunState, vice: RivalVice): RunState {
  if (eventIsBlocked(run)) return skipEmptyEvent(run);
  const id = run.eventId;
  if (id === 'monster-hunt') {
    if (run.eventStep === 'hunt-lineup' || run.eventStep === 'preview') return resolveHuntFight(run);
    if (run.eventStep === 'hunt-result') return claimHunt(run);
  }
  if (id === 'book-of-lost-tales') {
    if (run.eventOffers.includes('book-picked')) return settleBookChoice(run);
    const ready = ensureBookOffers(run);
    if (ready.team.length < MAX_TEAM) return claimBookUnit(ready, firstFreeSlot(ready.team));
    const host = ready.team.find((u) => canAcceptSticker(u)) ?? run.team[0];
    if (host) return claimBookSticker(ready, host.instanceId, host.stickerIds.length >= 3 ? 0 : undefined);
    const weak = weakest(ready.team);
    if (weak) return replaceBookUnit(ready, weak.slot);
    return skipEmptyEvent(ready);
  }
  if (id === 'wishing-well') {
    if (run.eventStep === 'reward-unit') {
      if (run.team.length < MAX_TEAM) return placeEventUnit(run, firstFreeSlot(run.team));
      const weak = weakest(run.team);
      return weak ? replaceEventUnit(run, weak.slot) : throwEventReward(run);
    }
    if (run.eventStep === 'well-kind') {
      const kind = vice === 'sticker' || run.team.length <= 1 ? 'sticker' : 'unit';
      return pickEventKind(run, kind);
    }
    if (run.eventStep === 'well-sticker') {
      const inst = run.eventPicks[0];
      const unit = run.team.find((u) => u.instanceId === inst);
      const sid = unit?.stickerIds[0];
      if (inst && sid) return eventSelectSticker(run, inst, sid);
      return skipEmptyEvent(run);
    }
    if (run.eventOffers[0] === 'kind:sticker') {
      const unit = run.team.find((u) => u.stickerIds.length);
      if (!unit) return skipEmptyEvent(run);
      return eventSelectSticker(run, unit.instanceId, unit.stickerIds[0]!);
    }
    const weak = weakest(run.team);
    if (!weak) return skipEmptyEvent(run);
    return eventSelectUnit(run, weak.instanceId);
  }
  if (id === 'witch-oven') {
    if (run.eventStep === 'oven-apply') {
      const sid = run.pendingStickerIds[0];
      const host = (sid && bestStickerHost(run.team, sid, vice)) ?? run.team.find((u) => canAcceptSticker(u));
      if (host && run.pendingStickerIds.length) return eventSelectUnit(run, host.instanceId);
      return ovenDiscardSticker(run);
    }
    const donor =
      run.team.slice().sort((a, b) => b.stickerIds.length - a.stickerIds.length)[0] ?? run.team[0];
    if (!donor) return skipEmptyEvent(run);
    return eventSelectUnit(run, donor.instanceId);
  }
  if (id === 'cloning-chamber') {
    if (run.eventStep === 'reward-unit') {
      if (run.team.length < MAX_TEAM) return placeEventUnit(run, firstFreeSlot(run.team));
      const weak = weakest(run.team);
      return weak ? replaceEventUnit(run, weak.slot) : throwEventReward(run);
    }
    const strong = strongest(run.team, vice);
    if (!strong) return skipEmptyEvent(run);
    return eventSelectUnit(run, strong.instanceId);
  }
  return skipEmptyEvent(run);
}

function stepRival(run: RunState, vice: RivalVice): RunState {
  if (run.phase === 'stickerAssign') return glueOne(run, vice);
  if (run.phase === 'postFight') {
    const pick = alleyPickFor(run, vice);
    const next = chooseAlley(run, pick);
    return next === run ? passAlley(run) : next;
  }
  if (run.phase === 'recruit') return takeRecruit(run, vice);
  if (run.phase === 'sticker') return takeSticker(run, vice);
  if (run.phase === 'event') return stepEvent(run, vice);
  if (run.phase === 'result') return afterResult(run);
  return run;
}

function forceLeave(run: RunState): RunState {
  if (run.phase === 'stickerAssign') return skipStickers(run);
  if (run.phase === 'recruit') return skipRecruit(run);
  if (run.phase === 'sticker') return settleStickerShop(run);
  if (run.phase === 'event') {
    if (run.eventStep === 'oven-apply') return ovenDiscardSticker(run);
    if (run.eventStep === 'reward-unit') return throwEventReward(run);
    const skipped = skipEmptyEvent(run);
    return skipped === run ? passAlley(run) : skipped;
  }
  if (run.phase === 'postFight') return passAlley(run);
  return run;
}

function playAlley(start: RunState, vice: RivalVice): RunState {
  let run = start;
  const round = run.round;
  let stuck = 0;
  for (let i = 0; i < 64 && run.round === round && run.phase !== 'formation'; i++) {
    const mark = stamp(run);
    let next = stepRival(run, vice);
    if (stamp(next) === mark) {
      stuck += 1;
      next = forceLeave(run);
    } else {
      stuck = 0;
    }
    if (stamp(next) === mark) break;
    run = next;
    if (stuck > 3) break;
  }
  return { ...run, team: ensureFullLine(run.team, { seed: run.seed, round: run.round, vice }) };
}

function shellFromRival(rival: CircuitRival, round: number): RunState {
  const snap = rivalSnapshot(rival, round);
  const run = bareRun('ai', rival.playerId, rival.playerName, rival.seed);
  return {
    ...run,
    round,
    wins: rival.wins,
    losses: rival.losses,
    victoryPoints: rival.victoryPoints,
    phase: 'result',
    team: cloneTeam(rival.team),
    offerCounter: rival.offerCounter,
    stickersGained: rival.stickersGained,
    deathsThisRun: rival.deathsThisRun,
    lostTales: copyTales(rival.lostTales),
    lastBattle: null,
    circuit: undefined,
    history: [
      {
        round,
        win: !rival.lostLastRound,
        winner: rival.lostLastRound ? 'enemy' : 'player',
        opponentName: '',
        opponentId: '',
        survivorDiff: 0,
        hpPctPlayer: 0,
        hpPctEnemy: 0,
        seed: rival.seed,
        events: [],
        playerSnap: snap,
        enemySnap: snap,
      },
    ],
  };
}

function writeBack(rival: CircuitRival, run: RunState): CircuitRival {
  const vice = rival.vice ?? 'brawler';
  return {
    ...rival,
    team: ensureFullLine(run.team, { seed: rival.seed, round: Math.max(2, run.round), vice, wins: rival.wins }),
    offerCounter: run.offerCounter,
    stickersGained: run.stickersGained ?? rival.stickersGained,
    deathsThisRun: run.deathsThisRun ?? rival.deathsThisRun,
    lostTales: copyTales(run.lostTales ?? []),
    pendingStickerIds: [],
    vice: rival.vice,
  };
}

function growRival(rival: CircuitRival, round: number): CircuitRival {
  const vice = rival.vice ?? 'brawler';
  let run = shellFromRival(rival, round);
  if (rival.pendingStickerIds.length) {
    run = playGifts(
      {
        ...run,
        phase: 'stickerAssign',
        pendingStickerIds: [...rival.pendingStickerIds],
        stickerPickCount: rival.pendingStickerIds.length,
        eventId: null,
      },
      vice,
    );
  }
  if (run.phase === 'result') run = afterResult(run);
  if (run.phase !== 'formation') run = playAlley(run, vice);
  return writeBack(rival, run);
}

/** After your alley, the other nine take theirs on the round that just ended. */
export function growCircuit(run: RunState): RunState {
  if (!run.circuit?.length) return run;
  if (run.round >= RUN_ROUNDS) return run;
  if ((run.circuitGrown ?? 0) >= run.round) return run;
  return {
    ...run,
    circuit: run.circuit.map((rival) => growRival(rival, run.round)),
    circuitGrown: run.round,
  };
}

function commit(rival: CircuitRival, out: ReturnType<typeof applyBattleSide>): CircuitRival {
  return {
    ...rival,
    team: out.team,
    deathsThisRun: out.deathsThisRun,
    stickersGained: out.stickersGained,
    pendingStickerIds: out.pendingStickerIds,
    wins: rival.wins + (out.won ? 1 : 0),
    losses: rival.losses + (out.lost ? 1 : 0),
    draws: rival.draws + (out.draw ? 1 : 0),
    victoryPoints: rival.victoryPoints + (out.won ? 3 : out.draw ? 1 : 0),
    lostLastRound: out.lost,
  };
}

function playPair(a: CircuitRival, b: CircuitRival, round: number, seed: number): [CircuitRival, CircuitRival] {
  const result = simulateBattle(rivalSnapshot(a, round), rivalSnapshot(b, round), seed);
  const left = applyBattleSide(a.team, result, 'player', a);
  const right = applyBattleSide(b.team, result, 'enemy', b);
  return [commit(a, left), commit(b, right)];
}

function scheduledIndex(run: RunState): number {
  const circuit = run.circuit ?? [];
  if (run.round >= RUN_ROUNDS) {
    const leader = leaderOf(circuit);
    const index = circuit.findIndex((r) => r.playerId === leader.playerId);
    return index >= 0 ? index : 0;
  }
  return Math.min(circuit.length - 1, Math.max(0, run.round - 1));
}

/** The scraps you are not in. Your opponent sits out; the other eight pair off. */
export function settleCircuit(run: RunState, enemy: TeamSnapshot): RunState {
  if (!run.circuit?.length || !run.lastBattle) return run;
  if ((run.circuitPlayed ?? 0) >= run.round) return run;
  const circuit = run.circuit.slice();
  const index = scheduledIndex(run);
  const faced = circuit[index];
  if (faced && enemy.playerId === faced.playerId) {
    circuit[index] = commit(faced, applyBattleSide(faced.team, run.lastBattle, 'enemy', faced));
  }
  const rest = circuit.map((rival, i) => ({ rival, i })).filter((row) => row.i !== index);
  for (let p = 0; p + 1 < rest.length; p += 2) {
    const left = rest[p]!;
    const right = rest[p + 1]!;
    const [a, b] = playPair(left.rival, right.rival, run.round, mixSeed(run.seed, run.round, p, 0xc1c));
    circuit[left.i] = a;
    circuit[right.i] = b;
  }
  return { ...run, circuit, circuitPlayed: run.round };
}

function draftOne(seed: number, name: string, id: string, vice: RivalVice): CircuitRival {
  let run = bareRun('ai', id, name, seed);
  for (const defId of pickDraft(run.draftOffers, vice)) run = toggleDraftPick(run, defId);
  run = confirmDraft(run);
  if (run.phase === 'stickerAssign') run = playGifts(run, vice);
  return takeRival(run, seed, name, id, vice);
}

/** Nine rivals, seated once from this run's seed. Each seat keeps a vice. */
export function openCircuit(seed: number, playerName: string): CircuitRival[] {
  const rng = new SeededRng(mixSeed(seed, 0xc10));
  const pool = NAMES.filter((name) => name.trim().toLowerCase() !== playerName.trim().toLowerCase());
  const names = rng.pickN(pool, 9);
  return names.map((name, i) =>
    draftOne(mixSeed(seed, i + 1, 0xc11), name, `rival_${(seed >>> 0).toString(16)}_${i}`, viceAt(i)),
  );
}
