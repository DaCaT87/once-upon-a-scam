import { autoPlayRun } from './run/autoPlay';
import { buildOpponent } from './ai/buildAI';
import { applySticker, assertAbilityTiming, assertCompactSlots, baseFormOf, computedStats, getSticker, getUnit, hasCardFace, hasPrintedCard, hasStickerArt, hasUnitArt, instanceFromDef, makeSnapshot, nextFormOf, offerStickers, offerUnits, prevFormOf, resolveTargeting, usesPrintedCardFace } from './core/catalog';
import { assertShopCurve } from './data/rarity';
import { HUNT_MONSTERS, huntMonstersFor, huntStickerFor } from './data/events';
import { STICKERS, grantableStickers, libraryHuntStickers, shopStickers } from './data/stickers';
import { mixSeed, SeededRng } from './core/rng';
import {
  afterResult,
  applyBagSticker,
  assignPendingSticker,
  chooseAlley,
  beginEvent,
  claimHunt,
  confirmDraft,
  confirmStickerPicks,
  createRun,
  eventIsBlocked,
  eventSelectSticker,
  eventSelectUnit,
  eventUnitReward,
  finishRecruit,
  ensureBookOffers,
  claimBookSticker,
  pickEventKind,
  placeDraft,
  placeEventUnit,
  placeRecruit,
  recruitPickLimit,
  resolveFight,
  resolveHuntFight,
  skipEmptyEvent,
  skipRecruit,
  skipStickers,
  throwEventReward,
  toggleDraftPick,
} from './run/runEngine';
import { translate } from './data/i18n';
import { UNITS } from './data/units';
import { abilityRule, renderBattleCard, renderOfferCard, renderStickerCard, renderUnitCard } from './ui/cards';
import { assertDeterministic, simulateBattle } from './sim/simulation';
import { assertTargetingRules } from './sim/targeting';
import type { RunState } from './core/types';

assertTargetingRules();
assertAbilityTiming();
assertCompactSlots();
assertShopCurve();
{
  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  for (const s of STICKERS) {
    const name = translate('en', s.nameKey);
    const want = slug(name);
    if (s.id !== want && !(s.id === 'hermes-boots' && want === 'hermes-wings')) {
      throw new Error(`sticker id ${s.id} should be ${want} (${name})`);
    }
    if (!hasStickerArt(s.id)) throw new Error(`missing sticker art ${s.id}`);
  }
}
{
  const glued = renderUnitCard('en', applySticker(instanceFromDef('farm-boy', 1, 'fbSpentTip'), 'lucky-charm'));
  if (!glued.includes('tip-sticker') || !glued.includes('tip-name') || !glued.includes('Lucky Charm')) {
    throw new Error('sticker hover should show the name');
  }
  if (!glued.includes('tip-effect') || !glued.includes('remain at 1 HP')) {
    throw new Error('sticker hover should show the effect');
  }
  if (!glued.includes('tip-rarity') || !glued.includes('data-rarity="gold"') || !glued.includes('>Gold<')) {
    throw new Error('sticker hover should show the rarity');
  }
  if (!glued.includes('tip-spent') || !glued.includes('Spent')) {
    throw new Error('sticker hover should include Spent');
  }
  const gluedIt = renderUnitCard('it', applySticker(instanceFromDef('farm-boy', 1, 'fbSpentTipIt'), 'lucky-charm'));
  if (!gluedIt.includes('Usato')) throw new Error('sticker hover it should say Usato');
}
{
  const r1 = offerUnits(1, 4, new SeededRng(0x51));
  if (r1.length !== 4 || r1.some((id) => getUnit(id).rarity !== 'bronze')) {
    throw new Error(`recruit mix r1 ${r1.join(',')}`);
  }
  const r2 = offerUnits(2, 4, new SeededRng(0x55)).map((id) => getUnit(id).rarity);
  if (r2.filter((r) => r === 'bronze').length !== 3 || r2.filter((r) => r === 'silver').length !== 1) {
    throw new Error(`recruit mix r2 ${r2.join(',')}`);
  }
  const r6 = offerUnits(6, 4, new SeededRng(0x52)).map((id) => getUnit(id).rarity);
  if (r6.filter((r) => r === 'silver').length !== 2 || r6.filter((r) => r === 'gold').length !== 2) {
    throw new Error(`recruit mix r6 ${r6.join(',')}`);
  }
  const s1 = offerStickers(3, new SeededRng(0x53), 1);
  if (s1.length !== 3 || s1.some((id) => getSticker(id).rarity !== 'bronze')) {
    throw new Error(`sticker mix r1 ${s1.join(',')}`);
  }
  const s8 = offerStickers(3, new SeededRng(0x58), 8).map((id) => getSticker(id).rarity);
  if (s8.filter((r) => r === 'silver').length !== 1 || s8.filter((r) => r === 'gold').length !== 1 || s8.filter((r) => r === 'platinum').length !== 1) {
    throw new Error(`sticker mix r8 ${s8.join(',')}`);
  }
  const s9 = offerStickers(3, new SeededRng(0x54), 9).map((id) => getSticker(id).rarity);
  if (s9.filter((r) => r === 'gold').length !== 1 || s9.filter((r) => r === 'platinum').length !== 2) {
    throw new Error(`sticker mix r9 ${s9.join(',')}`);
  }
  if (shopStickers().some((s) => s.rarity === 'diamond')) throw new Error('shop diamond sticker');
  for (let n = 1; n <= 9; n++) {
    if (offerStickers(3, new SeededRng(0x60 + n), n).some((id) => getSticker(id).rarity === 'diamond')) {
      throw new Error(`shop sticker diamond r${n}`);
    }
    if (offerUnits(n, 4, new SeededRng(0x70 + n)).some((id) => getUnit(id).rarity === 'diamond')) {
      throw new Error(`shop unit diamond r${n}`);
    }
  }
}
{
  const hunter = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('hunter', 1, 'h1')],
  });
  const prey = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'd1'), instanceFromDef('paper-dove', 2, 'd2')],
  });
  const scrap = simulateBattle(hunter, prey, 7);
  const hunterSwings = scrap.events.filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:h1');
  if (scrap.winner !== 'player' || scrap.durationCycles !== 1 || hunterSwings.length !== 2) {
    throw new Error(`hunter volley failed win=${scrap.winner} cycles=${scrap.durationCycles} swings=${hunterSwings.length}`);
  }
}
{
  const witch = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('witch-hunter', 1, 'w1')],
  });
  const marked = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('village-fool', 1, 'f1'), 'fur-armor')],
  });
  const scrap = simulateBattle(witch, marked, 3);
  if (
    !scrap.events.some(
      (e) => e.type === 'DamageDealt' && e.kind === 'attack' && e.sourceId === 'player:w1' && e.amount === 4,
    )
  ) {
    throw new Error('witch hunter sticker atk failed');
  }
}
{
  const witch = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('witch-hunter', 1, 'w2')],
  });
  const marked = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [applySticker(applySticker(instanceFromDef('village-fool', 1, 'f2'), 'fur-armor'), 'rabbits-foot')],
  });
  const scrap = simulateBattle(witch, marked, 3);
  if (
    !scrap.events.some(
      (e) => e.type === 'DamageDealt' && e.kind === 'attack' && e.sourceId === 'player:w2' && e.amount === 6,
    )
  ) {
    throw new Error('witch hunter two-sticker atk failed');
  }
}
{
  const field = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('scary-scarecrow', 1, 'sc1')],
  });
  const row = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('village-fool', 1, 'vfA'), instanceFromDef('village-fool', 2, 'vfB')],
  });
  const scrap = simulateBattle(field, row, 4);
  const shove = scrap.events.find((e) => e.type === 'MovedToBack' && e.unitId === 'enemy:vfA');
  const slide = scrap.events.find((e) => e.type === 'MovedForward' && e.unitId === 'enemy:vfB');
  if (
    getUnit('scary-scarecrow').targeting !== 'brawler' ||
    !shove ||
    shove.type !== 'MovedToBack' ||
    shove.fromSlot !== 1 ||
    shove.toSlot !== 2 ||
    !slide ||
    slide.type !== 'MovedForward' ||
    slide.fromSlot !== 2 ||
    slide.toSlot !== 1
  ) {
    throw new Error('scary scarecrow did not send the front foe to the last slot');
  }
}
{
  const field = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('farm-boy', 1, 'ws1'), 'water-spirit')],
  });
  const row = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('village-fool', 1, 'vfA'), instanceFromDef('village-fool', 2, 'vfB')],
  });
  const scrap = simulateBattle(field, row, 7);
  const swap = scrap.events.find((e) => e.type === 'SlotsSwapped');
  if (
    !swap ||
    swap.type !== 'SlotsSwapped' ||
    !((swap.aId === 'enemy:vfA' && swap.bId === 'enemy:vfB') || (swap.aId === 'enemy:vfB' && swap.bId === 'enemy:vfA'))
  ) {
    throw new Error('water spirit did not shove the hit card one slot back');
  }
}
{
  const field = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('farm-boy', 1, 'ws2'), 'water-spirit')],
  });
  const row = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('village-fool', 1, 'vfSolo')],
  });
  const scrap = simulateBattle(field, row, 8);
  if (scrap.events.some((e) => e.type === 'SlotsSwapped')) {
    throw new Error('water spirit should not move the last slot');
  }
}
{
  const sip = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'bl1'), 'blood-leech')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdA'), instanceFromDef('paper-dove', 2, 'pdB')],
    }),
    9,
  );
  if (
    !sip.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:bl1') ||
    !sip.events.some((e) => e.type === 'Healed' && e.unitId === 'player:bl1' && e.amount === 2)
  ) {
    throw new Error('blood leech should heal 2 on attack');
  }
}
{
  const gate = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('old-gatekeeper', 1, 'og1')],
  });
  const hunter = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('hunter', 1, 'h1')],
  });
  const scrap = simulateBattle(gate, hunter, 4);
  if (
    !scrap.events.some(
      (e) =>
        e.type === 'DamageDealt' && e.sourceId === 'player:og1' && e.targetId === 'enemy:h1' && e.amount === 2 && e.kind === 'thorns',
    )
  ) {
    throw new Error('old gatekeeper thorns failed');
  }
}
{
  let doll = instanceFromDef('patchwork-princess', 1, 'pp');
  doll = applySticker(doll, 'rabbits-foot');
  const stats = computedStats(doll);
  if (doll.stickerIds.join(',') !== 'rabbits-foot' || stats.speed !== 5) {
    throw new Error(`patchwork princess solo share atk=${stats.atk} hp=${stats.hp} spd=${stats.speed} stk=${doll.stickerIds.join(',')}`);
  }
  let run = createRun('ai', 'tester', 'PrincessShare', 0x34);
  run = {
    ...run,
    phase: 'stickerAssign',
    pendingStickerIds: ['rabbits-foot'],
    stickerPickCount: 1,
    team: [instanceFromDef('patchwork-princess', 1, 'pp2'), instanceFromDef('farm-boy', 2, 'fb2')],
  };
  run = assignPendingSticker(run, 'pp2');
  const princess = run.team.find((u) => u.instanceId === 'pp2');
  const boy = run.team.find((u) => u.instanceId === 'fb2');
  if (princess?.stickerIds.join(',') !== 'rabbits-foot' || boy?.stickerIds.join(',') !== 'rabbits-foot') {
    throw new Error(`patchwork princess share failed pp=${princess?.stickerIds.join(',')} boy=${boy?.stickerIds.join(',')}`);
  }
  let packed = instanceFromDef('farm-boy', 2, 'fb3');
  packed = applySticker(packed, 'rusty-knife');
  packed = applySticker(packed, 'fur-armor');
  packed = applySticker(packed, 'spiked-shield');
  run = {
    ...run,
    phase: 'stickerAssign',
    pendingStickerIds: ['rabbits-foot'],
    stickerPickCount: 1,
    team: [instanceFromDef('patchwork-princess', 1, 'pp3'), packed],
  };
  run = assignPendingSticker(run, 'pp3');
  const full = run.team.find((u) => u.instanceId === 'fb3');
  if (run.team.find((u) => u.instanceId === 'pp3')?.stickerIds.join(',') !== 'rabbits-foot' || full?.stickerIds.includes('rabbits-foot')) {
    throw new Error(`patchwork princess should skip a full ally stk=${full?.stickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Princess', 0x33);
  run = {
    ...run,
    round: 1,
    phase: 'recruit',
    recruitOffers: ['patchwork-princess', 'village-fool', 'farm-boy'],
    recruitPicks: [],
  };
  run = placeRecruit(run, 'patchwork-princess', 1);
  run = finishRecruit(run);
  const princess = run.team.find((u) => u.defId === 'patchwork-princess');
  if (!princess || run.pendingStickerIds.length || run.phase === 'stickerAssign') {
    throw new Error(`princess should not gift on recruit phase=${run.phase} pending=${run.pendingStickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Forget', 0x11);
  run = {
    ...run,
    team: [
      applySticker(applySticker(instanceFromDef('sir-forget-a-lot', 1, 'sf1'), 'fur-armor'), 'rabbits-foot'),
    ],
  };
  const dummy = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('village-fool', 1, 'vf9')],
  });
  run = resolveFight(run, dummy);
  const sir = run.team.find((u) => u.instanceId === 'sf1');
  const used = (run.lastBattle?.events ?? []).filter(
    (e) => e.type === 'ExhaustedSticker' && e.unitId === 'player:sf1',
  );
  if (!sir || sir.stickerIds.length !== 0 || used.length !== 2) {
    throw new Error(`sir forget survive failed stickers=${sir?.stickerIds.join(',')} exhaust=${used.length}`);
  }
}
{
  let run = createRun('ai', 'tester', 'ForgetDead', 0x12);
  run = {
    ...run,
    team: [applySticker(instanceFromDef('sir-forget-a-lot', 1, 'sf2'), 'fur-armor')],
  };
  const brute = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'g1')],
  });
  run = resolveFight(run, brute);
  const sir = run.team.find((u) => u.instanceId === 'sf2');
  if (
    !sir ||
    sir.stickerIds.length !== 0 ||
    !run.lastBattle?.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:sf2') ||
    !run.lastBattle.events.some((e) => e.type === 'ExhaustedSticker' && e.unitId === 'player:sf2')
  ) {
    throw new Error(`sir forget death failed stickers=${sir?.stickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Duck', 0x44);
  run = { ...run, team: [instanceFromDef('black-duck', 1, 'd1')] };
  const brute = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'g1')],
  });
  run = resolveFight(run, brute);
  const duck = run.team.find((u) => u.instanceId === 'd1');
  if (
    !run.lastBattle?.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:d1') ||
    !duck ||
    duck.permanentMods.atk !== 0 ||
    duck.permanentMods.hp !== 0
  ) {
    throw new Error(`black duck should not grow on death atk=${duck?.permanentMods.atk} hp=${duck?.permanentMods.hp}`);
  }
}
{
  const firstTurnAttacks = (events: ReturnType<typeof simulateBattle>['events'], uid: string): number => {
    let n = 0;
    let inTurn = false;
    for (const e of events) {
      if (e.type === 'TurnStarted' && e.unitId === uid) {
        inTurn = true;
        continue;
      }
      if (!inTurn) continue;
      if (e.type === 'TurnEnded' && e.unitId === uid) break;
      if (e.type === 'AttackStarted' && e.unitId === uid) n += 1;
    }
    return n;
  };
  const duck = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 2,
    lostLastRound: true,
    team: [instanceFromDef('black-duck', 1, 'd1')],
  });
  const wall = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 2,
    team: [
      {
        ...instanceFromDef('giving-tree', 1, 'g1'),
        permanentMods: { atk: 0, hp: 20, speed: 0 },
      },
    ],
  });
  const revenge = simulateBattle(duck, wall, 3);
  const calm = simulateBattle({ ...duck, lostLastRound: false }, wall, 3);
  const firstScrap = simulateBattle({ ...duck, lostLastRound: false, lossesThisRun: 0 }, wall, 3);
  const oldLossCount = simulateBattle({ ...duck, lostLastRound: false, lossesThisRun: 5 }, wall, 3);
  const revengeHits = firstTurnAttacks(revenge.events, 'player:d1');
  const calmHits = firstTurnAttacks(calm.events, 'player:d1');
  if (getUnit('black-duck').atk !== 2) throw new Error('black duck atk');
  if (!hasCardFace('black-duck')) throw new Error('black duck card face');
  if (getUnit('black-duck').passives?.extraAttacksIfLostLastRound !== 1) {
    throw new Error('black duck should gain Double Attack after a loss');
  }
  if (revengeHits !== 2) throw new Error(`black duck loss swings=${revengeHits}`);
  if (calmHits !== 1) throw new Error(`black duck calm attacks=${calmHits}`);
  if (firstTurnAttacks(firstScrap.events, 'player:d1') !== 1) {
    throw new Error('black duck first scrap should attack once');
  }
  if (firstTurnAttacks(oldLossCount.events, 'player:d1') !== 1) {
    throw new Error('black duck should ignore lifetime losses without a last-scrap loss');
  }
  if (abilityRule('en', 'black-duck') !== translate('en', 'ab.black-duck.d')) {
    throw new Error('black duck en text');
  }
  if (!abilityRule('en', 'black-duck').includes(translate('en', 'keywordDoubleAttack'))) {
    throw new Error('black duck should name Double Attack');
  }
  if (!abilityRule('it', 'black-duck').includes(translate('it', 'keywordDoubleAttack'))) {
    throw new Error('black duck should name Doppio Attacco');
  }
}
{
  let run = createRun('ai', 'tester', 'Herald', 0x22);
  run = {
    ...run,
    round: 5,
    phase: 'recruit',
    recruitOffers: ['royal-herald', 'village-fool', 'hunter'],
    recruitPicks: [],
  };
  run = placeRecruit(run, 'royal-herald', 1);
  const foolSlot = run.team.some((u) => u.slot === 2) ? 3 : 2;
  run = placeRecruit(run, 'village-fool', foolSlot);
  run = placeRecruit(run, 'hunter', foolSlot === 3 ? 4 : 3);
  if (run.recruitPicks.length !== 2 || run.recruitPicks.includes('hunter') || recruitPickLimit(run.recruitPicks) !== 2) {
    throw new Error(`herald recruit cap failed picks=${run.recruitPicks.join(',')} limit=${recruitPickLimit(run.recruitPicks)}`);
  }
  run = finishRecruit(run);
  const heraldGold = run.team.find((u) => u.defId !== 'royal-herald' && u.defId !== 'village-fool');
  if (
    run.team.length !== 3 ||
    !run.team.some((u) => u.defId === 'royal-herald') ||
    !heraldGold ||
    getUnit(heraldGold.defId).rarity !== 'gold' ||
    run.recruitRarityBump
  ) {
    throw new Error(`herald gold failed bump=${run.recruitRarityBump} team=${run.team.map((u) => u.defId).join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'NoExtra', 0x23);
  run = {
    ...run,
    phase: 'recruit',
    recruitOffers: ['village-fool', 'farm-boy', 'hunter'],
    recruitPicks: [],
  };
  run = placeRecruit(run, 'village-fool', 1);
  run = placeRecruit(run, 'farm-boy', 2);
  run = placeRecruit(run, 'hunter', 3);
  if (run.recruitPicks.length !== 2 || run.recruitPicks.includes('hunter')) {
    throw new Error(`recruit cap failed picks=${run.recruitPicks.join(',')}`);
  }
}
{
  const doll = getUnit('cursed-doll');
  if (doll.hp !== 7 || doll.atk !== 0 || doll.speed !== 0 || doll.targeting !== 'pacifist') {
    throw new Error(`cursed doll stats ${doll.hp}/${doll.atk}/${doll.speed} ${doll.targeting}`);
  }
  const cursed = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('cursed-doll', 1, 'cd1')],
  });
  const bruiser = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('farm-boy', 1, 'fb1')],
  });
  const scrap = simulateBattle(cursed, bruiser, 5);
  if (
    !scrap.events.some((e) => e.type === 'DamageDealt' && e.targetId === 'player:cd1' && e.amount === 2 && e.kind === 'attack') ||
    !scrap.events.some((e) => e.type === 'DamageDealt' && e.targetId === 'enemy:fb1' && e.amount === 3 && e.kind === 'thorns') ||
    scrap.events.some((e) => e.type === 'DamageDealt' && e.kind === 'reflect' && (e.sourceId === 'player:cd1' || e.targetId === 'enemy:fb1'))
  ) {
    throw new Error('cursed doll should thorn 3 and not reflect');
  }
}
{
  const cat = getUnit('miss-misfortune');
  if (cat.hp !== 1 || cat.atk !== 0 || cat.speed !== 0 || cat.targeting !== 'pacifist') {
    throw new Error(`miss misfortune stats ${cat.hp}/${cat.atk}/${cat.speed} ${cat.targeting}`);
  }
  const alone = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('miss-misfortune', 1, 'mm1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb6')],
    }),
    5,
  );
  if (
    alone.events.some((e) => e.type === 'Evaded' && e.unitId === 'player:mm1') ||
    alone.events.some((e) => e.type === 'DamageDealt' && e.targetId === 'enemy:fb6' && e.kind === 'reflect') ||
    !alone.events.some((e) => e.type === 'DamageDealt' && e.targetId === 'player:mm1' && e.kind === 'attack')
  ) {
    throw new Error('miss misfortune should not evade alone');
  }
  const pair = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('miss-misfortune', 1, 'mm2'), instanceFromDef('village-fool', 2, 'vfM')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb7')],
    }),
    6,
  );
  if (
    !pair.events.some((e) => e.type === 'SlotsSwapped') ||
    !pair.events.some((e) => e.type === 'Evaded' && e.unitId === 'player:mm2' && e.reflected)
  ) {
    throw new Error('miss misfortune evade swap failed');
  }
}
{
  const glass = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('glass-knight', 1, 'gk1')],
  });
  const brute = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'g1')],
  });
  const scrap = simulateBattle(glass, brute, 5);
  if (
    !scrap.events.some(
      (e) =>
        e.type === 'DamageDealt' && e.sourceId === 'player:gk1' && e.targetId === 'enemy:g1' && e.amount === 6 && e.kind === 'effect',
    )
  ) {
    throw new Error('glass knight shatter failed');
  }
}
{
  if (getUnit('wish-pinata').targeting !== 'pacifist' || getUnit('wish-pinata').atk !== 0 || getUnit('wish-pinata').speed !== 0) {
    throw new Error('wish pinata should be pacifist 0/0');
  }
  const pinata = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [
      instanceFromDef('wish-pinata', 1, 'wp1'),
      instanceFromDef('happy-rat', 2, 'hr1'),
      instanceFromDef('happy-rat', 3, 'hr2'),
    ],
  });
  const brute = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'g1')],
  });
  const scrap = simulateBattle(pinata, brute, 8);
  const ate = scrap.events.filter((e) => e.type === 'AteSticker');
  const rats = new Set(ate.map((e) => e.unitId));
  if (
    !scrap.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:wp1') ||
    ate.length !== 2 ||
    !rats.has('player:hr1') ||
    !rats.has('player:hr2') ||
    scrap.events.some((e) => e.type === 'GrantedSticker')
  ) {
    throw new Error(`wish pinata burst failed ate=${ate.length} rats=${[...rats].join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Pinata', 0x71);
  run = {
    ...run,
    team: [instanceFromDef('wish-pinata', 1, 'wp2'), instanceFromDef('farm-boy', 2, 'fb5')],
  };
  const brute = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'g9')],
  });
  run = resolveFight(run, brute);
  const boy = run.team.find((u) => u.instanceId === 'fb5');
  const gift = (run.lastBattle?.events ?? []).find(
    (e) => e.type === 'GrantedSticker' && e.unitId === 'player:fb5',
  );
  if (
    !boy ||
    !gift ||
    gift.type !== 'GrantedSticker' ||
    boy.stickerIds.length < 1 ||
    boy.stickerIds[0] !== gift.stickerId
  ) {
    throw new Error(`wish pinata persist failed stickers=${boy?.stickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Aladdin', 0x61);
  run = { ...run, team: [instanceFromDef('aladdin', 1, 'al1')] };
  const prey = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('farm-boy', 1, 'fb1'), 'fur-armor')],
  });
  run = resolveFight(run, prey);
  const thief = run.team.find((u) => u.instanceId === 'al1');
  if (
    !run.lastBattle?.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:fb1') ||
    !run.lastBattle.events.some(
      (e) => e.type === 'StoleSticker' && e.thiefId === 'player:al1' && e.stickerId === 'fur-armor' && e.applied,
    ) ||
    !thief ||
    thief.stickerIds[0] !== 'fur-armor'
  ) {
    throw new Error(`aladdin steal failed stickers=${thief?.stickerIds.join(',')}`);
  }
  const stoleAt = run.lastBattle.events.findIndex((e) => e.type === 'StoleSticker');
  const diedAt = run.lastBattle.events.findIndex((e) => e.type === 'UnitDied');
  if (stoleAt < 0 || diedAt < 0 || stoleAt > diedAt) {
    throw new Error('steal must happen on the attack, before the target is KO');
  }
}
{
  const tough = applySticker(instanceFromDef('village-fool', 1, 'fool1'), 'fur-armor');
  tough.permanentMods = { atk: 0, hp: 200, speed: 0 };
  const scrap = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('aladdin', 1, 'alLive')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [tough],
    }),
    4,
  );
  const stole = scrap.events.find((e) => e.type === 'StoleSticker' && e.thiefId === 'player:alLive');
  if (!stole || stole.type !== 'StoleSticker' || !stole.applied || stole.stickerId !== 'fur-armor') {
    throw new Error('steal must take a sticker from a target that stays alive');
  }
  if (scrap.events.some((e) => e.type === 'UnitDied')) {
    throw new Error('steal test target should survive');
  }
}
{
  // Steal is On Attack, so it resolves before the hit and before Reflect.
  const aladdin = instanceFromDef('aladdin', 1, 'alRef');
  aladdin.permanentMods = { atk: 0, hp: 30, speed: 0 };
  const scrap = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [aladdin],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('cursed-doll', 1, 'cd1'), 'cursed-armor')],
    }),
    3,
  );
  const stole = scrap.events.find((e) => e.type === 'StoleSticker' && e.thiefId === 'player:alRef');
  if (!stole || stole.type !== 'StoleSticker' || stole.stickerId !== 'cursed-armor' || !stole.applied) {
    throw new Error('aladdin steal must fire even when the kill triggers Reflect');
  }
  const killIdx = scrap.events.findIndex((e) => e.type === 'StoleSticker' && e.thiefId === 'player:alRef');
  const reflectLethal = scrap.events.findIndex(
    (e) => e.type === 'DamageDealt' && e.kind === 'reflect' && e.lethal && e.targetId === 'player:alRef',
  );
  if (reflectLethal >= 0 && killIdx > reflectLethal) {
    throw new Error('steal must resolve before lethal reflect on the killer');
  }
}
{
  let packed = instanceFromDef('aladdin', 1, 'al2');
  packed = applySticker(packed, 'rusty-knife');
  packed = applySticker(packed, 'rabbits-foot');
  packed = applySticker(packed, 'spiked-shield');
  const full = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [packed],
  });
  const marked = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('farm-boy', 1, 'fb2'), 'fur-armor')],
  });
  const scrap = simulateBattle(full, marked, 9);
  const steal = scrap.events.find((e) => e.type === 'StoleSticker');
  if (!steal || steal.type !== 'StoleSticker' || steal.applied || steal.stickerId !== 'fur-armor') {
    throw new Error(`aladdin full steal failed applied=${steal && steal.type === 'StoleSticker' ? steal.applied : 'none'}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Monster', 0x62);
  run = {
    ...run,
    team: [instanceFromDef('ogre-king', 1, 'ogPm'), instanceFromDef('patchwork-monster', 2, 'pm1')],
  };
  const prey = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('farm-boy', 1, 'fb1')],
  });
  run = resolveFight(run, prey);
  const beast = run.team.find((u) => u.instanceId === 'pm1');
  if (
    !run.lastBattle?.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:fb1') ||
    !run.lastBattle.events.some(
      (e) => e.type === 'StatChanged' && e.unitId === 'player:pm1' && e.stat === 'atk' && e.amount === 1,
    ) ||
    !beast ||
    beast.permanentMods.atk !== 1 ||
    beast.permanentMods.hp !== 2
  ) {
    throw new Error(
      `patchwork monster feast failed atk=${beast?.permanentMods.atk} hp=${beast?.permanentMods.hp}`,
    );
  }
}
{
  let run = createRun('ai', 'tester', 'Goose', 0x71);
  run = {
    ...run,
    team: [instanceFromDef('golden-goose', 1, 'gg1'), instanceFromDef('village-fool', 2, 'vf1')],
  };
  const prey = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'pd1')],
  });
  run = resolveFight(run, prey);
  const gift = run.lastBattle?.events.find((e) => e.type === 'EarnedSticker');
  if (
    !gift ||
    gift.type !== 'EarnedSticker' ||
    gift.unitId !== 'player:gg1' ||
    getSticker(gift.stickerId).rarity !== 'gold' ||
    run.team.some((u) => u.permanentMods.atk || u.permanentMods.hp)
  ) {
    throw new Error(`golden goose gift failed ${gift && gift.type === 'EarnedSticker' ? gift.stickerId : 'none'}`);
  }
  run = afterResult(run);
  if (run.phase !== 'stickerAssign' || run.pendingStickerIds[0] !== gift.stickerId) {
    throw new Error(`golden goose assign phase=${run.phase} pending=${run.pendingStickerIds.join(',')}`);
  }
  run = skipStickers(run);
  if (run.phase !== 'postFight' || run.alleyDone.length) {
    throw new Error(`golden goose loot closed phase=${run.phase} alley=${run.alleyDone.join(',')}`);
  }
}
{
  const scrap = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('golden-goose', 1, 'gg2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og1')],
    }),
    11,
  );
  if (scrap.events.some((e) => e.type === 'EarnedSticker')) throw new Error('dead goose laid a sticker');
}
{
  let run = createRun('ai', 'tester', 'Frog', 0x81);
  run = { ...run, team: [applySticker(instanceFromDef('farm-boy', 1, 'fb3'), 'fur-armor')] };
  const frog = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('toxic-frog', 1, 'tf1')],
  });
  run = resolveFight(run, frog);
  const boy = run.team.find((u) => u.instanceId === 'fb3');
  if (
    !run.lastBattle?.events.some((e) => e.type === 'PeeledSticker' && e.unitId === 'player:fb3' && e.stickerId === 'fur-armor') ||
    !boy ||
    boy.stickerIds[0] !== 'fur-armor'
  ) {
    throw new Error(`toxic frog peel persist failed stickers=${boy?.stickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Tree', 0x91);
  run = {
    ...run,
    team: [instanceFromDef('giving-tree', 1, 'gt1'), instanceFromDef('farm-boy', 2, 'fb4')],
  };
  const bruiser = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('ogre-king', 1, 'og2')],
  });
  run = resolveFight(run, bruiser);
  const treeDef = getUnit('giving-tree');
  if (treeDef.hp !== 12 || treeDef.atk !== 0 || treeDef.speed !== 0 || treeDef.targeting !== 'pacifist') {
    throw new Error(`giving tree stats ${treeDef.hp}/${treeDef.atk}/${treeDef.speed} ${treeDef.targeting}`);
  }
  const tree = run.team.find((u) => u.instanceId === 'gt1');
  const boy = run.team.find((u) => u.instanceId === 'fb4');
  const gifts = (run.lastBattle?.events ?? []).filter(
    (e) => e.type === 'GiftedStat' && e.unitId === 'player:gt1' && e.recipientId === 'player:fb4',
  );
  const gifted = { atk: 0, hp: 0, speed: 0 };
  for (const ev of gifts) {
    if (ev.type !== 'GiftedStat') continue;
    gifted[ev.stat] += ev.amount;
  }
  if (
    !tree ||
    !boy ||
    !gifts.length ||
    tree.permanentMods.atk !== 0 ||
    tree.permanentMods.hp !== 0 ||
    boy.permanentMods.atk !== gifted.atk ||
    boy.permanentMods.hp !== gifted.hp ||
    boy.permanentMods.speed !== gifted.speed
  ) {
    throw new Error(
      `giving tree gift failed gifts=${gifts.length} tree=${tree?.permanentMods.atk}/${tree?.permanentMods.hp} boy=${boy?.permanentMods.atk}/${boy?.permanentMods.hp}/${boy?.permanentMods.speed}`,
    );
  }
}
{
  const frost = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ice-king', 1, 'iq1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb5'), 'fur-armor')],
    }),
    13,
  );
  const spawn = frost.events.find((e) => e.type === 'UnitSpawned' && e.unit.uid === 'enemy:fb5');
  if (!spawn || spawn.type !== 'UnitSpawned' || spawn.unit.hp !== 8 || spawn.unit.maxHp !== 8) {
    throw new Error(`ice king spawn hp=${spawn && spawn.type === 'UnitSpawned' ? spawn.unit.hp : 'none'}`);
  }
  if (!frost.events.some((e) => e.type === 'Silenced' && e.unitId === 'enemy:fb5' && e.sourceId === 'player:iq1')) {
    throw new Error('ice king should silence the farm boy');
  }
  if (!frost.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:fb5')) {
    throw new Error('ice king fur-armor still saved the farm boy');
  }
  if (getUnit('ice-king').rarity !== 'platinum') throw new Error('ice king rarity');
  if (abilityRule('en', 'ice-king') !== 'Silence all other figures.') throw new Error('ice king silence text');
}
{
  const hush = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ice-king', 1, 'iq2'), instanceFromDef('ogre-king', 2, 'ogIq')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('phoenix', 1, 'ph2')],
    }),
    14,
  );
  if (hush.events.some((e) => e.type === 'Revived' && e.unitId === 'enemy:ph2')) {
    throw new Error('ice king did not silence phoenix');
  }
  if (!hush.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:ph2')) {
    throw new Error('silenced phoenix should die');
  }
}
{
  const dust = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ice-king', 1, 'iq3')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('sandman', 1, 'sm2')],
    }),
    16,
  );
  if (!dust.events.some((e) => e.type === 'Silenced' && e.unitId === 'enemy:sm2' && e.sourceId === 'player:iq3')) {
    throw new Error('ice king did not silence sandman');
  }
  if (!dust.events.some((e) => e.type === 'BattleStartAct' && e.unitId === 'player:iq3')) {
    throw new Error('ice king battle start act missing');
  }
  if (getUnit('pied-piper').rarity !== 'gold') throw new Error('pied piper rarity');
}
{
  const hushAlly = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('phoenix', 1, 'phAlly'), instanceFromDef('ice-king', 2, 'iqAlly')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [
        {
          ...instanceFromDef('farm-boy', 1, 'fbIq'),
          permanentMods: { atk: 20, hp: 10, speed: 10 },
        },
      ],
    }),
    15,
  );
  if (!hushAlly.events.some((e) => e.type === 'Silenced' && e.unitId === 'player:phAlly')) {
    throw new Error('ice king should silence allied phoenix');
  }
  if (hushAlly.events.some((e) => e.type === 'Revived' && e.unitId === 'player:phAlly')) {
    throw new Error('ice king did not silence allied phoenix');
  }
  if (!hushAlly.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:phAlly')) {
    throw new Error('silenced allied phoenix should die');
  }
}
{
  const copy = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('mimic', 1, 'mi1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb6'), 'fur-armor')],
    }),
    17,
  );
  if (
    !copy.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:mi1' && e.targetId === 'enemy:fb6') ||
    !copy.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:mi1' && e.stat === 'maxHp' && e.amount === 2) ||
    copy.events.some((e) => e.type === 'PeeledSticker')
  ) {
    throw new Error('mimic ambush copy failed');
  }
}
{
  const blocked = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('mimic', 1, 'mi2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('village-fool', 1, 'fb7'), 'fur-armor')],
    }),
    18,
  );
  if (
    blocked.events.some((e) => e.type === 'Ambushed' && e.unitId === 'player:mi2') ||
    blocked.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:mi2' && e.stat === 'maxHp' && e.amount === 2) ||
    blocked.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:mi2')
  ) {
    throw new Error('mimic should copy stickers only when Ambush triggers');
  }
}
{
  const hide = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('jack-in-the-box', 1, 'jk1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfAmb')],
    }),
    22,
  );
  if (hide.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:jk1')) {
    throw new Error('ambush should not attack until attacked');
  }
}
{
  const sprung = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('jack-in-the-box', 1, 'jk2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fbAmb'), instanceFromDef('paper-dove', 2, 'pdAmb')],
    }),
    23,
  );
  const jackHits = sprung.events.filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:jk2' && !e.cancelled);
  if (
    sprung.events.some(
      (e) => e.type === 'AttackStarted' && e.unitId === 'enemy:pdAmb' && e.targetId === 'player:jk2' && !e.cancelled,
    )
  ) {
    throw new Error('ambush should cancel the first incoming attack');
  }
  if (
    !sprung.events.some(
      (e) => e.type === 'AttackStarted' && e.unitId === 'enemy:pdAmb' && e.targetId === 'player:jk2' && e.cancelled,
    )
  ) {
    throw new Error('ambush should still play the incoming attack wind-up');
  }
  if (!sprung.events.some((e) => e.type === 'Ambushed' && e.unitId === 'player:jk2' && e.attackerId === 'enemy:pdAmb')) {
    throw new Error('ambush should trigger on the first incoming attack');
  }
  if (!jackHits.length || jackHits[0]?.type !== 'AttackStarted' || jackHits[0].targetId !== 'enemy:pdAmb') {
    throw new Error('ambush should attack the attacker instead');
  }
  if (!jackHits.some((e) => e.type === 'AttackStarted' && e.targetId === 'enemy:fbAmb')) {
    throw new Error('ambush jack should use brawler targeting after the ambush');
  }
  const popped = sprung.events.find((e) => e.type === 'Transformed' && e.fromId === 'jack-in-the-box');
  if (
    !popped ||
    popped.type !== 'Transformed' ||
    popped.unit.defId !== 'sprung-jack' ||
    popped.unit.atk !== 2 ||
    popped.unit.hp !== 6 ||
    !popped.combat
  ) {
    throw new Error('ambush jack should transform for the scrap and keep shared HP');
  }
}
{
  const sneak = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('mimic', 1, 'mi3')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('farm-boy', 1, 'fbSneak'), 'rabbits-foot'),
        instanceFromDef('village-fool', 2, 'vfSneak'),
      ],
    }),
    24,
  );
  const mimicHits = sneak.events.filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:mi3');
  if (!mimicHits.length || mimicHits[0]?.type !== 'AttackStarted' || mimicHits[0].targetId !== 'enemy:fbSneak') {
    throw new Error('ambush mimic should attack the attacker instead');
  }
  if (!mimicHits.some((e) => e.type === 'AttackStarted' && e.targetId === 'enemy:vfSneak')) {
    throw new Error('ambush mimic should use sneak targeting after the ambush');
  }
  const unlatched = sneak.events.find((e) => e.type === 'Transformed' && e.fromId === 'mimic');
  if (!unlatched || unlatched.type !== 'Transformed' || unlatched.unit.defId !== 'sprung-mimic' || !unlatched.combat) {
    throw new Error('ambush mimic should transform for the scrap');
  }
}
{
  if (
    !hasUnitArt('jack-in-the-box') ||
    !hasCardFace('jack-in-the-box') ||
    !hasPrintedCard('jack-in-the-box') ||
    !hasUnitArt('sprung-jack') ||
    !hasCardFace('sprung-jack') ||
    !hasPrintedCard('sprung-jack')
  ) {
    throw new Error('toy box art');
  }
  if (
    !hasUnitArt('mimic') ||
    !hasCardFace('mimic') ||
    !hasPrintedCard('mimic') ||
    !hasUnitArt('sprung-mimic') ||
    !hasCardFace('sprung-mimic') ||
    !hasPrintedCard('sprung-mimic')
  ) {
    throw new Error('treasure chest art');
  }
  const boxCard = renderUnitCard('en', instanceFromDef('jack-in-the-box', 1, 'tbArt'));
  if (
    !boxCard.includes('printed-card') ||
    !boxCard.includes('Toy Box') ||
    !boxCard.includes('Ambush') ||
    !boxCard.includes('data-preview-unit="sprung-jack"') ||
    !boxCard.includes(translate('en', 'keywordPeekHint')) ||
    boxCard.includes('peek-hint')
  ) {
    throw new Error('toy box printed card');
  }
  const jackCard = renderUnitCard('en', instanceFromDef('sprung-jack', 1, 'sjArt'));
  if (!jackCard.includes('printed-card') || !jackCard.includes('Jack in the Box') || jackCard.includes('Ambush')) {
    throw new Error('sprung jack printed card');
  }
  const chestCard = renderUnitCard('en', instanceFromDef('mimic', 1, 'tcArt'));
  if (
    !chestCard.includes('printed-card') ||
    !chestCard.includes('Treasure Chest') ||
    !chestCard.includes('data-preview-unit="sprung-mimic"')
  ) {
    throw new Error('treasure chest printed card');
  }
}
{
  const hoard = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('the-collector', 1, 'tc1')],
      stickersGained: 4,
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pd4')],
    }),
    19,
  );
  const spawn = hoard.events.find((e) => e.type === 'UnitSpawned' && e.unit.uid === 'player:tc1');
  if (!spawn || spawn.type !== 'UnitSpawned' || spawn.unit.atk !== 5 || spawn.unit.hp !== 5) {
    throw new Error(`collector scale failed ${spawn && spawn.type === 'UnitSpawned' ? `${spawn.unit.atk}/${spawn.unit.hp}` : 'none'}`);
  }
  const offerHtml = renderOfferCard('en', 'the-collector', false, '', { stickersGained: 4 });
  if (!offerHtml.includes('<b>5</b>') || (offerHtml.match(/<b>5<\/b>/g) ?? []).length < 2) {
    throw new Error('collector shop offer must show stickersGained stats');
  }
  const chimpOffer = renderUnitCard('en', applySticker(instanceFromDef('three-little-pigs', 1, 'chShop'), 'rusty-knife'));
  if (!chimpOffer.includes('<b>6</b>')) {
    throw new Error('chimps shop card must show tripled sticker ATK');
  }
}
{
  const rise = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('phoenix', 1, 'ph1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og3')],
    }),
    21,
  );
  const revived = rise.events.filter((e) => e.type === 'Revived' && e.unitId === 'player:ph1');
  if (revived.length !== 1) {
    throw new Error(`phoenix rise failed revived=${revived.length}`);
  }
  if (!hasUnitArt('phoenix') || !hasCardFace('phoenix') || !hasPrintedCard('phoenix')) throw new Error('phoenix art');
  const phoenixCard = renderUnitCard('en', instanceFromDef('phoenix', 1, 'phArt'));
  if (!phoenixCard.includes('printed-card') || !phoenixCard.includes('Phoenix')) {
    throw new Error('phoenix printed card');
  }
  if (!phoenixCard.includes('rarity-mark') || !phoenixCard.includes('data-rarity="platinum"')) {
    throw new Error('phoenix rarity hover');
  }
}
{
  const kingDef = getUnit('king-of-crows');
  if (kingDef.targeting !== 'sneak') throw new Error('king of ravens targeting');
  if (kingDef.rarity !== 'platinum' || kingDef.hp !== 7 || kingDef.atk !== 4 || kingDef.speed !== 7) {
    throw new Error('king of ravens stats');
  }
  if (kingDef.passives?.curseAtk !== 1) throw new Error('king of ravens curse');
  const flockDef = getUnit('flock-of-ravens');
  if (flockDef.targeting !== 'pacifist' || flockDef.hp !== 7 || flockDef.atk !== 0 || flockDef.speed !== 0) {
    throw new Error('flock of ravens stats');
  }
  if (flockDef.recruitable) throw new Error('flock of ravens should not be recruitable');
  const kingFx = kingDef.ability?.effects[0];
  const flockFx = flockDef.ability?.effects[0];
  if (!kingFx || kingFx.op !== 'transform' || kingFx.duration !== 'combat' || !kingFx.revive) {
    throw new Error('king transform should last the scrap');
  }
  if (!flockFx || flockFx.op !== 'transform' || flockFx.duration !== 'combat') {
    throw new Error('flock transform should last the scrap');
  }
  if (nextFormOf('king-of-crows') !== 'flock-of-ravens') throw new Error('king next form');
  if (prevFormOf('flock-of-ravens') !== 'king-of-crows') throw new Error('flock prev form');
  if (baseFormOf('flock-of-ravens') !== 'king-of-crows') throw new Error('flock base form');
  if (nextFormOf('flock-of-ravens') !== null) throw new Error('flock should not advertise a shop next form');
  if (!hasUnitArt('king-of-crows') || !hasCardFace('king-of-crows') || !hasPrintedCard('king-of-crows')) {
    throw new Error('king of ravens art');
  }
  if (!hasUnitArt('flock-of-ravens') || !hasCardFace('flock-of-ravens') || !hasPrintedCard('flock-of-ravens')) {
    throw new Error('flock of ravens art');
  }
  const ravenCard = renderUnitCard('en', instanceFromDef('king-of-crows', 1, 'kcArt'));
  if (!ravenCard.includes('printed-card') || !ravenCard.includes('King of Ravens') || !ravenCard.includes('Curse')) {
    throw new Error('king of ravens printed card');
  }
  if (!ravenCard.includes('king-of-crows/card.png') || ravenCard.includes('Become')) {
    throw new Error('king of ravens should use its printed card and Transform');
  }
  if (!ravenCard.includes('rarity-mark') || !ravenCard.includes('data-rarity="platinum"')) {
    throw new Error('printed cards should keep a rarity hover target');
  }
  if (
    !ravenCard.includes('is-peek-link') ||
    !ravenCard.includes('data-preview-unit="flock-of-ravens"') ||
    !ravenCard.includes(translate('en', 'keywordPeekHint')) ||
    ravenCard.includes('peek-hint')
  ) {
    throw new Error('flock keyword should stay unmoved on the card and use a left-click tooltip');
  }
  const curseTip = [...ravenCard.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((m) => m[0])
    .find((html) => html.includes('<strong>Curse</strong>'));
  if (!curseTip || curseTip.includes('is-peek-link') || curseTip.includes('peek-hint')) {
    throw new Error('curse should stay a text tooltip');
  }
  const flockCard = renderUnitCard('en', instanceFromDef('flock-of-ravens', 1, 'flArt'));
  if (
    !flockCard.includes('printed-card') ||
    !flockCard.includes('flock-of-ravens/card.png') ||
    !flockCard.includes('Flock of Ravens') ||
    flockCard.includes('king-of-crows/card.png')
  ) {
    throw new Error('flock of ravens printed card');
  }
  if (!flockCard.includes('keep-with') || !flockCard.includes('data-preview-unit="king-of-crows"')) {
    throw new Error('flock should keep King of Ravens next to into');
  }
  if (translate('en', 'unit.kingOfCrows') !== 'King of Ravens') throw new Error('king of ravens en name');
  if (translate('it', 'unit.kingOfCrows') !== 'Re dei Corvi') throw new Error('king of ravens it name');
  if (translate('en', 'unit.flockOfRavens') !== 'Flock of Ravens') throw new Error('flock en name');
  if (abilityRule('en', 'king-of-crows') !== 'Transform into Flock of Ravens. Curse.') throw new Error('king of ravens en text');
  if (abilityRule('it', 'king-of-crows') !== 'Trasforma in Stormo di Corvi. Maledizione.') throw new Error('king of ravens it text');
  if (
    abilityRule('en', 'flock-of-ravens') !==
    'Transform into King of Ravens. The next flock has leftover HP.'
  ) {
    throw new Error('flock of ravens en text');
  }
  if (
    abilityRule('it', 'flock-of-ravens') !==
    'Trasforma in Re dei Corvi. Il prossimo stormo ha gli HP rimasti.'
  ) {
    throw new Error('flock of ravens it text');
  }

  const peck = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('king-of-crows', 1, 'kcPeck')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fbPeck')],
    }),
    23,
  );
  const cursedAtk = peck.events.filter(
    (e) => e.type === 'StatChanged' && e.unitId === 'enemy:fbPeck' && e.stat === 'atk' && e.amount === -1,
  );
  if (cursedAtk.length < 2) throw new Error(`king curse stacks=${cursedAtk.length}`);
  if (
    !peck.events.some(
      (e) => e.type === 'AttackStarted' && e.unitId === 'player:kcPeck' && e.targetId === 'enemy:fbPeck',
    )
  ) {
    throw new Error('king of ravens sneak should hit the back');
  }

  const cycle = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('king-of-crows', 1, 'kcFlock')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogFlock')],
    }),
    23,
  );
  const forms = cycle.events.filter((e) => e.type === 'Transformed' && e.unit.uid === 'player:kcFlock');
  const toFlock = forms.filter((e) => e.type === 'Transformed' && e.fromId === 'king-of-crows' && e.unit.defId === 'flock-of-ravens');
  const toKing = forms.filter((e) => e.type === 'Transformed' && e.fromId === 'flock-of-ravens' && e.unit.defId === 'king-of-crows');
  if (!toFlock.length) throw new Error('king did not become flock');
  if (toFlock[0]?.type !== 'Transformed' || toFlock[0].unit.hp !== 7) {
    throw new Error(`first flock hp=${toFlock[0] && toFlock[0].type === 'Transformed' ? toFlock[0].unit.hp : 'none'}`);
  }
  if (!toKing.length) throw new Error('flock did not become king');
  if (toKing[0]?.type !== 'Transformed' || toKing[0].unit.hp !== 7) {
    throw new Error(`king return hp=${toKing[0] && toKing[0].type === 'Transformed' ? toKing[0].unit.hp : 'none'}`);
  }
  if (toFlock[0]?.type === 'Transformed' && toFlock[0].combat !== true) {
    throw new Error('king flock transform should be for the scrap');
  }
  if (cycle.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:kcFlock')) {
    throw new Error('flock that survives its turn should not kill the king');
  }
  if (cycle.events.some((e) => e.type === 'Transformed' && e.unit.uid === 'enemy:ogFlock')) {
    throw new Error('king of ravens should not revert foes');
  }

  const speedyOgre = applySticker(applySticker(instanceFromDef('ogre-king', 1, 'ogLeft'), 'hermes-boots'), 'rabbits-foot');
  const leftoverFight = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('king-of-crows', 1, 'kcLeftover')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [speedyOgre],
    }),
    23,
  );
  let form = 'king';
  let flockHp = 0;
  let saved: number | null = null;
  let nextFlock: number | null = null;
  for (const e of leftoverFight.events) {
    if (e.type === 'Transformed' && e.unit.uid === 'player:kcLeftover') {
      if (e.unit.defId === 'flock-of-ravens') {
        if (saved != null && nextFlock == null) nextFlock = e.unit.hp;
        flockHp = e.unit.hp;
        form = 'flock';
      } else {
        if (form === 'flock' && saved == null) saved = Math.max(0, flockHp);
        form = 'king';
      }
    }
    if (form === 'flock' && e.type === 'DamageDealt' && e.targetId === 'player:kcLeftover') {
      flockHp -= e.amount;
    }
  }
  if (saved == null || saved < 1) throw new Error(`flock leftover at end of turn saved=${saved}`);
  if (nextFlock == null) throw new Error('next flock never arrived to spend leftover HP');
  if (nextFlock !== saved) throw new Error(`next flock hp=${nextFlock} want ${saved}`);

  let ravenRun = createRun('ai', 'tester', 'Ravens', 0x73);
  ravenRun = { ...ravenRun, team: [instanceFromDef('king-of-crows', 1, 'kcKeep')] };
  ravenRun = resolveFight(
    ravenRun,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogKeep')],
    }),
  );
  const kept = ravenRun.team.find((u) => u.instanceId === 'kcKeep');
  if (!kept || kept.defId !== 'king-of-crows') {
    throw new Error(`raven Transform persisted def=${kept?.defId}`);
  }

  const slain = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('king-of-crows', 1, 'kcDead')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogDeadA'), instanceFromDef('ogre-king', 2, 'ogDeadB')],
    }),
    23,
  );
  if (!slain.events.some((e) => e.type === 'Transformed' && e.unit.uid === 'player:kcDead' && e.unit.defId === 'flock-of-ravens')) {
    throw new Error('king should become flock before dying');
  }
  if (slain.events.some((e) => e.type === 'Transformed' && e.unit.uid === 'player:kcDead' && e.fromId === 'flock-of-ravens')) {
    throw new Error('dead flock should not return the king');
  }
  if (!slain.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:kcDead')) {
    throw new Error('flock death should kill the king');
  }
}
{
  const reaper = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('miss-d', 1, 'de1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fbMiss'), instanceFromDef('paper-dove', 2, 'pd5')],
    }),
    25,
  );
  if (getUnit('miss-d').targeting !== 'hitman') throw new Error('miss d targeting');
  if (getUnit('miss-d').rarity !== 'diamond') throw new Error('miss d rarity');
  if (!hasUnitArt('miss-d') || !hasCardFace('miss-d') || !hasPrintedCard('miss-d')) {
    throw new Error('miss d art');
  }
  const missCard = renderUnitCard('en', instanceFromDef('miss-d', 1, 'mdArt'));
  if (!missCard.includes('printed-card') || !missCard.includes('Miss D.')) {
    throw new Error('miss d printed card');
  }
  if (!missCard.includes('rarity-mark') || !missCard.includes('data-rarity="diamond"')) {
    throw new Error('miss d rarity hover');
  }
  if (
    !reaper.events.some(
      (e) => e.type === 'AttackStarted' && e.unitId === 'player:de1' && e.targetId === 'enemy:pd5',
    )
  ) {
    throw new Error('miss d hitman should pick the lowest HP foe');
  }
  if (
    !reaper.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:de1' &&
        e.targetId === 'enemy:pd5' &&
        e.amount === 99 &&
        e.kind === 'effect',
    ) ||
    !reaper.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:pd5')
  ) {
    throw new Error('miss d did not kill the hit card');
  }
}
{
  const champ = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('champion-of-the-arena', 1, 'ch1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb8'), instanceFromDef('village-fool', 2, 'vf2')],
    }),
    27,
  );
  const spawn = champ.events.find((e) => e.type === 'UnitSpawned' && e.unit.uid === 'player:ch1');
  if (!spawn || spawn.type !== 'UnitSpawned' || spawn.unit.atk !== 3) {
    throw new Error(`champion atk=${spawn && spawn.type === 'UnitSpawned' ? spawn.unit.atk : 'none'}`);
  }
  if (translate('en', 'unit.championOfTheArena') !== 'Hero of the Arena') throw new Error('arena hero en name');
  if (translate('it', 'unit.championOfTheArena') !== 'Eroe dell’Arena') throw new Error('arena hero it name');
  if (!hasUnitArt('champion-of-the-arena') || !hasCardFace('champion-of-the-arena') || !hasPrintedCard('champion-of-the-arena')) {
    throw new Error('arena king art');
  }
  const arenaCard = renderUnitCard('en', instanceFromDef('champion-of-the-arena', 1, 'chArt'));
  if (!arenaCard.includes('printed-card') || !arenaCard.includes('Hero of the Arena')) {
    throw new Error('arena hero printed card');
  }
}
{
  const kingDef = getUnit('three-headed-snake');
  if (kingDef.targeting !== 'brawler') throw new Error(`three headed snake targeting=${kingDef.targeting}`);
  if (kingDef.passives?.extraAttacks !== 2) throw new Error('three headed snake should have Triple Attack');
  if (abilityRule('en', 'three-headed-snake') !== translate('en', 'keywordTripleAttack')) {
    throw new Error('three headed snake en text');
  }
  if (abilityRule('it', 'three-headed-snake') !== translate('it', 'keywordTripleAttack')) {
    throw new Error('three headed snake it text');
  }
  const volley = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('three-headed-snake', 1, 'ths1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [
        {
          ...instanceFromDef('giving-tree', 1, 'wall'),
          permanentMods: { atk: 0, hp: 40, speed: 0 },
        },
      ],
    }),
    15,
  );
  const turn = volley.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:ths1');
  const turnEnd = volley.events.findIndex((e, i) => i > turn && e.type === 'TurnEnded' && e.unitId === 'player:ths1');
  const swings = volley.events
    .slice(turn, turnEnd < 0 ? undefined : turnEnd)
    .filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:ths1');
  const targets = new Set(swings.map((e) => (e.type === 'AttackStarted' ? e.targetId : '')));
  if (swings.length !== 3 || targets.size !== 1) {
    throw new Error(`three headed snake triple failed swings=${swings.length} targets=${targets.size}`);
  }
  if (getUnit('three-headed-snake').rarity !== 'platinum') throw new Error('three headed snake rarity');
  if (getUnit('three-headed-snake').hp !== 11 || getUnit('three-headed-snake').atk !== 3 || getUnit('three-headed-snake').speed !== 7) {
    throw new Error('three headed snake stats');
  }
  if (!hasUnitArt('three-headed-snake') || !hasCardFace('three-headed-snake') || !hasPrintedCard('three-headed-snake')) {
    throw new Error('three headed snake art');
  }
}
{
  const rite = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb9'), instanceFromDef('anubis', 2, 'an1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og5')],
    }),
    29,
  );
  const died = rite.events.findIndex((e) => e.type === 'UnitDied' && e.unitId === 'player:fb9');
  const raised = rite.events.find(
    (e, i) => i > died && e.type === 'Summoned' && e.unit.defId === 'farm-boy' && e.unit.team === 'player',
  );
  if (died < 0 || !raised) throw new Error('anubis did not raise a fallen ally');
  if (getUnit('anubis').rarity !== 'diamond') throw new Error('anubis rarity');
  if (translate('en', 'unit.anubis') !== 'Ash Sorcerer') throw new Error('ash sorcerer en name');
  if (translate('it', 'unit.anubis') !== 'Stregone della cenere') throw new Error('ash sorcerer it name');
  if (getUnit('anubis').targeting !== 'hitman') throw new Error('ash sorcerer targeting');
  if (!hasUnitArt('anubis') || !hasCardFace('anubis')) throw new Error('anubis art');
}
{
  const clone = instanceFromDef('anubis', 1, 'anFrail');
  clone.permanentMods = { atk: 0, hp: -11, speed: 0 };
  const noSelf = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [clone, instanceFromDef('anubis', 2, 'anLive')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogAn')],
    }),
    33,
  );
  if (!noSelf.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:anFrail')) {
    throw new Error('ash sorcerer clone did not die');
  }
  if (noSelf.events.some((e) => e.type === 'Summoned' && e.unit.defId === 'anubis')) {
    throw new Error('ash sorcerer summoned itself');
  }
}
{
  const barren = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('anubis', 1, 'an2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pd4')],
    }),
    31,
  );
  if (barren.events.some((e) => e.type === 'Summoned')) throw new Error('anubis summoned without an allied corpse');
}
{
  const hole = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('black-hole', 1, 'bh1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og6')],
    }),
    17,
  );
  if (
    hole.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:bh1' &&
        e.targetId === 'enemy:og6' &&
        e.amount === 99,
    )
  ) {
    throw new Error('the fool should not deal 99 damage');
  }
  if (
    !hole.events.some(
      (e) =>
        e.type === 'SwitchedSides' &&
        e.unitId === 'enemy:og6' &&
        e.fromTeam === 'enemy' &&
        e.team === 'player' &&
        e.slot === 1,
    )
  ) {
    throw new Error('the fool did not take the killer into its place');
  }
  if (hole.winner !== 'player') throw new Error('the fool convert should win the scrap');
  const laughAt = hole.events.findIndex((e) => e.type === 'Log' && e.message === 'haha:player:bh1');
  const diedAt = hole.events.findIndex((e) => e.type === 'UnitDied' && e.unitId === 'player:bh1');
  const switchAt = hole.events.findIndex((e) => e.type === 'SwitchedSides' && e.unitId === 'enemy:og6');
  if (laughAt < 0 || diedAt < 0 || switchAt < 0 || !(laughAt < diedAt && diedAt < switchAt)) {
    throw new Error('the fool should laugh, die, then pull the killer');
  }
  if (abilityRule('en', 'black-hole') !== 'The figure that knocks me out switches sides.') {
    throw new Error('the fool en rule');
  }
  if (abilityRule('it', 'black-hole') !== 'La figura che mi mette KO cambia lato.') {
    throw new Error('the fool it rule');
  }
  if (getUnit('black-hole').targeting !== 'pacifist') throw new Error('the fool targeting');
  if (getUnit('black-hole').hp !== 1 || getUnit('black-hole').atk !== 0 || getUnit('black-hole').speed !== 0) {
    throw new Error('the fool stats');
  }
  if (translate('en', 'unit.blackHole') !== 'The Fool') throw new Error('the fool en name');
  if (translate('it', 'unit.blackHole') !== 'Il Folle') throw new Error('the fool it name');
  if (!hasUnitArt('black-hole') || !hasCardFace('black-hole')) throw new Error('the fool art');
}
{
  const seat = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('black-hole', 1, 'bh2'), instanceFromDef('cobblers-elves', 2, 'vfSeat')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogSeat')],
    }),
    21,
  );
  if (
    !seat.events.some(
      (e) => e.type === 'SwitchedSides' && e.unitId === 'enemy:ogSeat' && e.team === 'player' && e.slot === 1,
    )
  ) {
    throw new Error('the fool killer should sit in the fool’s slot');
  }
}
{
  const phoenixFool = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('black-hole', 1, 'bhPhx'), 'phoenix-heart')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogPhx')],
    }),
    23,
  );
  if (!phoenixFool.events.some((e) => e.type === 'Revived' && e.unitId === 'player:bhPhx')) {
    throw new Error('phoenix heart should revive the fool');
  }
  const revivedAt = phoenixFool.events.findIndex((e) => e.type === 'Revived' && e.unitId === 'player:bhPhx');
  if (phoenixFool.events.slice(0, revivedAt).some((e) => e.type === 'SwitchedSides')) {
    throw new Error('phoenix heart on the fool should block the side switch');
  }
}
{
  const dove = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'doveTm'), instanceFromDef('time-master', 2, 'tm1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogTm')],
    }),
    31,
  );
  const rewindAt = dove.events.findIndex((e) => e.type === 'Rewound' && e.unitId === 'player:doveTm');
  const rewindEv = dove.events[rewindAt];
  if (rewindAt < 0 || !rewindEv || rewindEv.type !== 'Rewound' || rewindEv.hp !== 2) {
    throw new Error('time master should rewind the first ally death at full HP');
  }
  if (dove.events.slice(0, rewindAt).some((e) => e.type === 'MovedForward')) {
    throw new Error('cards should not slide before the rewind finishes');
  }
  const burst = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'doveCd'), instanceFromDef('time-master', 2, 'tmCd')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('three-headed-snake', 1, 'snakeCd')],
    }),
    34,
  );
  const firstRewind = burst.events.findIndex((e) => e.type === 'Rewound' && e.unitId === 'player:doveCd');
  const deathAfter = burst.events.findIndex(
    (e, i) => i > firstRewind && e.type === 'UnitDied' && e.unitId === 'player:doveCd',
  );
  const turnBetween = burst.events.findIndex(
    (e, i) => i > firstRewind && i < deathAfter && e.type === 'TurnEnded' && e.unitId === 'player:tmCd',
  );
  const burstRewind = burst.events[firstRewind];
  if (
    firstRewind < 0 ||
    !burstRewind ||
    burstRewind.type !== 'Rewound' ||
    burstRewind.hp !== 2 ||
    deathAfter < 0 ||
    turnBetween >= 0
  ) {
    throw new Error('cooldown should block a second rewind before Time Master ends a turn');
  }
  const self = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('time-master', 1, 'tmSelf')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('ogre-king', 1, 'ogSelf'), 'giant-strength')],
    }),
    32,
  );
  const selfRewind = self.events.findIndex((e) => e.type === 'Rewound' && e.unitId === 'player:tmSelf');
  const selfDied = self.events.findIndex((e) => e.type === 'UnitDied' && e.unitId === 'player:tmSelf');
  if (selfRewind < 0) throw new Error('time master should rewind his own first death');
  if (selfDied >= 0 && selfDied < selfRewind) throw new Error('time master died before Rewind');
  const bare = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'doveBare')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogBare')],
    }),
    33,
  );
  if (bare.events.some((e) => e.type === 'Rewound')) throw new Error('rewind needs Time Master on the field');
  if (!bare.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:doveBare')) {
    throw new Error('without Time Master the dove should die');
  }
  if (getUnit('time-master').rarity !== 'diamond') throw new Error('time master rarity');
  if (
    getUnit('time-master').targeting !== 'pacifist' ||
    getUnit('time-master').hp !== 10 ||
    getUnit('time-master').atk !== 0 ||
    getUnit('time-master').speed !== 9
  ) {
    throw new Error('time master stats');
  }
  if (
    abilityRule('en', 'time-master') !==
    'When a figure on your side is knocked out, including this one, Rewind. Cooldown 1.'
  ) {
    throw new Error('time master en');
  }
  if (
    abilityRule('it', 'time-master') !==
    'Quando una figura dalla tua parte viene messa KO, anche questa, Rewind. Cooldown 1.'
  ) {
    throw new Error('time master it');
  }
  if (!hasUnitArt('time-master') || !hasCardFace('time-master') || !hasPrintedCard('time-master')) {
    throw new Error('time master art');
  }
}
{
  const dust = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('sandman', 1, 'sm1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb10')],
    }),
    19,
  );
  if (
    !dust.events.some(
      (e) => e.type === 'StatChanged' && e.unitId === 'enemy:fb10' && e.stat === 'speed' && e.amount === -1 && e.now === 4,
    )
  ) {
    throw new Error('sandman did not slow foes');
  }
  if (getUnit('sandman').rarity !== 'silver') throw new Error('sandman rarity');
  {
    const order = simulateBattle(
      makeSnapshot({
        playerId: 'p',
        playerName: 'p',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('sandman', 1, 'smOrd'), instanceFromDef('frog-prince', 2, 'fpOrd'), instanceFromDef('golden-goose', 3, 'ggOrd')],
      }),
      makeSnapshot({
        playerId: 'e',
        playerName: 'e',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('village-fool', 1, 'vfOrd')],
      }),
      23,
    );
    const acts = order.events.filter((e) => e.type === 'BattleStartAct').map((e) => (e.type === 'BattleStartAct' ? e.unitId : ''));
    const frogI = acts.indexOf('player:fpOrd');
    if (frogI < 0) {
      throw new Error(`battle start order frog failed acts=${acts.join(',')}`);
    }
    if (!order.events.some((e) => e.type === 'Transformed' && e.unit.uid === 'player:fpOrd' && e.unit.defId === 'prince-charming')) {
      throw new Error('frog should transform at battle start beside gold');
    }
  }
  const dustFloor = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('sandman', 1, 'sm2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('miss-misfortune', 1, 'wk9')],
    }),
    19,
  );
  if (
    !dustFloor.events.some(
      (e) => e.type === 'StatChanged' && e.unitId === 'enemy:wk9' && e.stat === 'speed' && e.now === 0,
    )
  ) {
    throw new Error('speed should not go below 0');
  }
}
{
  const swine = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('circe', 1, 'ci1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('ogre-king', 1, 'og7'), 'steel-sword')],
    }),
    21,
  );
  const hog = swine.events.find((e) => e.type === 'Transformed' && e.fromId === 'ogre-king');
  if (
    !hog ||
    hog.type !== 'Transformed' ||
    hog.unit.defId !== 'pig' ||
    hog.unit.team !== 'enemy' ||
    !hog.combat ||
    hog.unit.atk !== 0 ||
    hog.unit.speed !== 0 ||
    hog.unit.hp !== 16 ||
    hog.unit.rarity !== 'platinum' ||
    hog.unit.targeting !== 'pacifist'
  ) {
    throw new Error('circe did not turn the foe into a pig');
  }
  const hogAt = swine.events.indexOf(hog);
  const pigTurn = swine.events.findIndex((e, i) => i > hogAt && e.type === 'TurnEnded' && e.unitId === 'enemy:og7');
  const back = swine.events.find(
    (e, i) => i > pigTurn && e.type === 'Transformed' && e.fromId === 'pig' && e.unit.defId === 'ogre-king',
  );
  if (pigTurn < 0 || !back || back.type !== 'Transformed' || back.unit.atk !== 8) {
    throw new Error('pig did not revert at end of turn');
  }
  const pigged = swine.events.slice(hogAt, pigTurn + 1);
  if (pigged.some((e) => e.type === 'AttackStarted' && e.unitId === 'enemy:og7')) {
    throw new Error('pig attacked');
  }
  if (getUnit('circe').rarity !== 'platinum') throw new Error('circe rarity');
  if (!hasUnitArt('circe') || !hasCardFace('circe') || !hasPrintedCard('circe')) throw new Error('circe art');
  const circeCard = renderUnitCard('en', instanceFromDef('circe', 1, 'ciArt'));
  if (!circeCard.includes('printed-card') || !circeCard.includes('Witch Circe')) {
    throw new Error('circe printed card');
  }
  if (translate('en', 'unit.circe') !== 'Witch Circe') throw new Error('circe en name');
  if (translate('it', 'unit.circe') !== 'Maga Circe') throw new Error('circe it name');
  if (translate('en', 'stk.bandageRoll') !== 'Life Potion') throw new Error('life potion en name');
  if (translate('it', 'stk.bandageRoll') !== 'Pozione della Vita') throw new Error('life potion it name');
  if (translate('en', 'stk.boomStick') !== 'Revenge Bomb') throw new Error('revenge bomb en name');
  if (translate('it', 'stk.boomStick') !== 'Revenge Bomb') throw new Error('revenge bomb it name');
  for (const id of ['fireball', 'lightning-bolt', 'shower-of-arrows', 'dragons-breath', 'revenge-bomb'] as const) {
    if (!getSticker(id).ability?.once) throw new Error(`${id} should be once per scrap`);
  }
  if (translate('en', 'stk.fireball.d') !== 'Deal 2 damage to a random enemy. Once.') {
    throw new Error('fireball once copy');
  }
  if (translate('it', 'stk.fireball.d') !== 'Infligge 2 danni a un nemico casuale. Una volta.') {
    throw new Error('fireball once it copy');
  }
  if (!translate('en', 'stk.bandageRoll.d').endsWith('Once.')) throw new Error('life potion once copy');
  if (!translate('it', 'stk.bandageRoll.d').endsWith('Una volta.')) throw new Error('life potion once it copy');
  const fireHtml = renderStickerCard('en', 'fireball', false);
  if (!fireHtml.includes('Once.') || fireHtml.includes('only once this scrap') || fireHtml.includes('Remove from the game')) {
    throw new Error('fireball should keep plain Once text, not keyword Once or Exhaust');
  }
  if (!renderStickerCard('it', 'fireball', false).includes('Una volta.') || renderStickerCard('it', 'fireball', false).includes('una sola volta in questo scontro')) {
    throw new Error('fireball it should keep plain Una volta, not keyword Once');
  }
}
{
  if (shopStickers().length !== 41 || shopStickers().some((s) => s.id === 'tin-heart' || s.rarity === 'diamond')) {
    throw new Error(`shop sticker catalog ${shopStickers().length}`);
  }
  const missingArt = STICKERS.filter((s) => !hasStickerArt(s.id)).map((s) => s.id);
  if (missingArt.length) throw new Error(`missing sticker art ${missingArt.join(',')}`);
  const diamonds = grantableStickers().filter((s) => s.rarity === 'diamond');
  if (
    diamonds.length !== 3 ||
    !['reapers-scythe', 'void-heart', 'ares-helm'].every((id) => diamonds.some((s) => s.id === id))
  ) {
    throw new Error(`diamond stickers ${diamonds.map((s) => s.id).join(',')}`);
  }
  const wrap = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb8'), 'life-potion')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('puss-in-boots', 1, 'pu8')],
    }),
    23,
  );
  const heals = wrap.events.filter((e) => e.type === 'Healed' && e.unitId === 'player:fb8' && e.amount === 3);
  if (heals.length !== 1) throw new Error(`bandage roll heals=${heals.length}`);
  if (!wrap.events.some((e) => e.type === 'StickerSpent' && e.stickerId === 'life-potion')) {
    throw new Error('life potion should look spent after Once');
  }
}
{
  const knife = applySticker(instanceFromDef('three-little-pigs', 1, 'chKnife'), 'rusty-knife');
  if (computedStats(knife).atk !== 6) throw new Error(`chimp knife atk=${computedStats(knife).atk}`);
  const hammer = applySticker(instanceFromDef('three-little-pigs', 1, 'chHammer'), 'big-hammer');
  if (computedStats(hammer).atk !== 12 || computedStats(hammer).speed !== 5) {
    throw new Error(`chimp hammer ${computedStats(hammer).atk}/${computedStats(hammer).speed}`);
  }
  const banner = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('farm-boy', 1, 'chBanSrc'), 'war-banner'),
        instanceFromDef('three-little-pigs', 2, 'chBan'),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'chBanFoe')],
    }),
    71,
  );
  const combatAtk = banner.events.find(
    (e) => e.type === 'StatChanged' && e.unitId === 'player:chBan' && e.stat === 'atk' && !e.permanent,
  );
  if (!combatAtk || combatAtk.type !== 'StatChanged' || combatAtk.amount !== 1) {
    throw new Error(`chimp combat buff ${combatAtk && combatAtk.type === 'StatChanged' ? combatAtk.amount : 'none'}`);
  }
  const ares = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'aresSrc'), 'ares-helm')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'aresDove'), instanceFromDef('paper-dove', 2, 'aresDove2')],
    }),
    81,
  );
  const aresSwings = ares.events.filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:aresSrc');
  if (aresSwings.length < 2) throw new Error(`ares helm attacks=${aresSwings.length}`);
  const hide = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('three-little-pigs', 1, 'chHide'), 'troll-hide')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('puss-in-boots', 1, 'chHideFoe')],
    }),
    72,
  );
  const hideHeals = hide.events.filter((e) => e.type === 'Healed' && e.unitId === 'player:chHide' && e.amount === 1);
  if (!hideHeals.length) throw new Error('chimp heal should stay 1');
  if (hide.events.some((e) => e.type === 'Healed' && e.unitId === 'player:chHide' && e.amount === 3)) {
    throw new Error('chimp heal was tripled');
  }
  const gifted = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('giving-tree', 1, 'gtCh'), instanceFromDef('three-little-pigs', 2, 'chGift')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'chGiftFoe')],
    }),
    73,
  );
  const perm = gifted.events.find(
    (e) =>
      e.type === 'StatChanged' &&
      e.unitId === 'player:chGift' &&
      e.permanent &&
      (e.stat === 'atk' || e.stat === 'speed' || e.stat === 'maxHp') &&
      e.amount > 0,
  );
  if (!perm || perm.type !== 'StatChanged' || perm.amount !== 3) {
    throw new Error(`chimp permanent buff ${perm && perm.type === 'StatChanged' ? `${perm.stat}:${perm.amount}` : 'none'}`);
  }
}
{
  const feather = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb9'), 'lucky-charm')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'h9')],
    }),
    24,
  );
  if (!feather.events.some((e) => e.type === 'Log' && e.message === 'cheat-death:player:fb9')) {
    throw new Error('phoenix feather did not hold at 1');
  }
  if (!feather.events.some((e) => e.type === 'StickerSpent' && e.stickerId === 'lucky-charm')) {
    throw new Error('lucky charm should look spent after Once');
  }
}
{
  const plates: Array<['silver-plated' | 'gold-plated' | 'platinum-plated' | 'diamond-plated', 'silver' | 'gold' | 'platinum' | 'diamond']> = [
    ['silver-plated', 'silver'],
    ['gold-plated', 'gold'],
    ['platinum-plated', 'platinum'],
    ['diamond-plated', 'diamond'],
  ];
  for (const [sid, rarity] of plates) {
    const glued = applySticker(applySticker(instanceFromDef('farm-boy', 1, `fb-${sid}`), 'fur-armor'), sid);
    if (
      glued.defId === 'farm-boy' ||
      getUnit(glued.defId).rarity !== rarity ||
      glued.stickerIds.includes(sid) ||
      !glued.stickerIds.includes('fur-armor')
    ) {
      throw new Error(`${sid} on-apply def=${glued.defId} rarity=${getUnit(glued.defId).rarity} stk=${glued.stickerIds.join(',')}`);
    }
  }
  let platedRun = createRun('ai', 'tester', 'Plate', 0x91);
  platedRun = { ...platedRun, team: [instanceFromDef('farm-boy', 1, 'fb12')] };
  platedRun = applyBagSticker({ ...platedRun, stickerBag: ['silver-plated'] }, 'silver-plated', 'fb12');
  const changed = platedRun.team.find((u) => u.instanceId === 'fb12');
  if (
    !changed ||
    changed.defId === 'farm-boy' ||
    getUnit(changed.defId).rarity !== 'silver' ||
    changed.stickerIds.includes('silver-plated')
  ) {
    throw new Error(`silver-plated bag apply def=${changed?.defId} stk=${changed?.stickerIds.join(',')}`);
  }
}
{
  const boom = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb13'), 'revenge-bomb')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'h13')],
    }),
    26,
  );
  if (
    !boom.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.kind === 'effect' &&
        e.sourceId === 'player:fb13' &&
        e.targetId === 'enemy:h13' &&
        e.amount === 4,
    )
  ) {
    throw new Error('revenge bomb matching slot failed');
  }
}
{
  const heart = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb14'), 'phoenix-heart')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'h14')],
    }),
    27,
  );
  if (!heart.events.some((e) => e.type === 'Revived' && e.unitId === 'player:fb14' && e.hp === 6)) {
    throw new Error('phoenix heart did not revive full');
  }
}
{
  const fury = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fb15'), 'fire-spirit')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pd15'), instanceFromDef('paper-dove', 2, 'pd15b')],
    }),
    28,
  );
  const furyAtk = fury.events.find(
    (e) => e.type === 'StatChanged' && e.unitId === 'player:fb15' && e.stat === 'atk' && e.amount === 2,
  );
  if (!furyAtk) throw new Error('fire spirit should grant +2 ATK on its turn');
}
{
  const mirrored = applySticker(applySticker(instanceFromDef('farm-boy', 1, 'fb16'), 'rusty-knife'), 'mirror-mirror');
  const stats = computedStats(mirrored);
  if (stats.atk !== 6 || stats.hp !== 12 || stats.speed !== 10) {
    throw new Error(`mirror mirror stats ${stats.atk}/${stats.hp}/${stats.speed}`);
  }
  const twice = applySticker(mirrored, 'mirror-mirror');
  const doubled = computedStats(twice);
  if (doubled.atk !== 12 || doubled.hp !== 24 || doubled.speed !== 20) {
    throw new Error(`two mirrors ${doubled.atk}/${doubled.hp}/${doubled.speed}`);
  }
  const chimpMirror = applySticker(instanceFromDef('three-little-pigs', 1, 'chMir'), 'mirror-mirror');
  const cm = computedStats(chimpMirror);
  // Base 3/3/7 → ×2 ×3 = 18/18/42
  if (cm.atk !== 18 || cm.hp !== 18 || cm.speed !== 42) {
    throw new Error(`chimp mirror ${cm.atk}/${cm.hp}/${cm.speed}`);
  }
  const chimpBoth = applySticker(applySticker(instanceFromDef('three-little-pigs', 1, 'chMir2'), 'rusty-knife'), 'mirror-mirror');
  const cb = computedStats(chimpBoth);
  // (3+1) ×2 ×3 = 24 atk; hp 3×6=18; speed 7×6=42
  if (cb.atk !== 24 || cb.hp !== 18 || cb.speed !== 42) {
    throw new Error(`chimp knife mirror ${cb.atk}/${cb.hp}/${cb.speed}`);
  }
}
{
  const hide = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbHide'), 'troll-hide')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdHide')],
    }),
    40,
  );
  if (!hide.events.some((e) => e.type === 'Healed' && e.unitId === 'player:fbHide' && e.amount === 1)) {
    throw new Error('troll hide should heal 1 at end of turn');
  }
}
{
  const crown = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('farm-boy', 1, 'fbCrown'), 'bloodied-crown'),
        instanceFromDef('farm-boy', 2, 'fbCrownMate'),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdCrown')],
    }),
    43,
  );
  if (
    !crown.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:fbCrown' && e.stat === 'atk' && e.amount === 2) ||
    !crown.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:fbCrownMate' && e.stat === 'atk' && e.amount === 2)
  ) {
    throw new Error('bloodied crown should give +2 ATK to all your cards');
  }
}
{
  const blade = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbEx'), 'excalibur')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfEx')],
    }),
    41,
  );
  if (computedStats(applySticker(instanceFromDef('farm-boy', 1, 'fbExStat'), 'excalibur')).atk !== 9) {
    throw new Error('excalibur should be +7 ATK');
  }
  if (
    !blade.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:fbEx' &&
        e.targetId === 'enemy:vfEx' &&
        e.kind === 'attack' &&
        e.amount === 9,
    )
  ) {
    throw new Error('excalibur did not deal +7 ATK');
  }
}
{
  const scythe = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbScythe'), 'reapers-scythe')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogScythe')],
    }),
    44,
  );
  if (
    !scythe.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:fbScythe' &&
        e.targetId === 'enemy:ogScythe' &&
        e.amount === 99 &&
        e.kind === 'effect',
    )
  ) {
    throw new Error('reaper scythe did not kill on hit');
  }
}
{
  const voided = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbVoid'), 'void-heart')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogVoid')],
    }),
    42,
  );
  if (
    !voided.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:fbVoid' &&
        e.targetId === 'enemy:ogVoid' &&
        e.amount === 99 &&
        e.kind === 'effect',
    )
  ) {
    throw new Error('void heart did not destroy the killer');
  }
}
{
  const sneak = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('woodland-girl', 1, 'wgHood')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('farm-boy', 1, 'fbTaunt'), 'painted-target'),
        instanceFromDef('paper-dove', 2, 'pdBack'),
      ],
    }),
    43,
  );
  if (!sneak.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:wgHood' && e.targetId === 'enemy:fbTaunt')) {
    throw new Error('painted target did not taunt sneak');
  }
}
{
  const hood = applySticker(instanceFromDef('farm-boy', 1, 'fbHood'), 'thiefs-hood');
  if (resolveTargeting(hood) !== 'sneak') throw new Error('thief hood sneak');
  const scope = applySticker(instanceFromDef('farm-boy', 1, 'fbScope'), 'snipers-sight');
  if (resolveTargeting(scope) !== 'hitman') throw new Error('sniper sight hitman');
}
{
  const drums = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('farm-boy', 1, 'fbDrum'), 'war-banner'),
        instanceFromDef('farm-boy', 2, 'fbMate'),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'pdDrum')],
    }),
    44,
  );
  if (
    !drums.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:fbMate' && e.stat === 'atk' && e.amount === 1) ||
    drums.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:fbDrum' && e.stat === 'atk' && e.amount === 1)
  ) {
    throw new Error('war banner should buff allies only');
  }
}
{
  const bolt = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbBolt'), 'lightning-bolt')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfBolt')],
    }),
    45,
  );
  if (
    !bolt.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:fbBolt' &&
        e.targetId === 'enemy:vfBolt' &&
        e.amount === 3 &&
        e.kind === 'effect',
    )
  ) {
    throw new Error('lightning bolt should deal 3 at start of turn');
  }
}
{
  const ball = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbBall'), 'fireball')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfBall')],
    }),
    47,
  );
  if (
    !ball.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.sourceId === 'player:fbBall' &&
        e.targetId === 'enemy:vfBall' &&
        e.amount === 2 &&
        e.kind === 'effect',
    )
  ) {
    throw new Error('fireball should deal 2 at start of turn');
  }
  const ballTurn = ball.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:fbBall');
  const ballHit = ball.events.findIndex(
    (e) => e.type === 'DamageDealt' && e.sourceId === 'player:fbBall' && e.kind === 'effect' && e.amount === 2,
  );
  if (ballTurn < 0 || ballHit < 0 || ballHit < ballTurn) {
    throw new Error('fireball should fire on own turn start, not battle start');
  }
  if (ball.events.some((e) => e.type === 'ExhaustedSticker' && e.stickerId === 'fireball')) {
    throw new Error('fireball should not exhaust');
  }
  if (!ball.events.some((e) => e.type === 'StickerSpent' && e.unitId === 'player:fbBall' && e.stickerId === 'fireball')) {
    throw new Error('fireball should look spent after Once');
  }
}
{
  let triple = instanceFromDef('farm-boy', 1, 'fbTri');
  triple = applySticker(triple, 'fireball');
  triple = applySticker(triple, 'fireball');
  triple = applySticker(triple, 'fireball');
  const volley = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [triple],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfTri')],
    }),
    49,
  );
  const shots = volley.events.filter(
    (e) => e.type === 'DamageDealt' && e.sourceId === 'player:fbTri' && e.kind === 'effect' && e.amount === 2,
  );
  if (shots.length !== 3) {
    throw new Error(`three fireballs should all fire on turn start got=${shots.length}`);
  }
  const spentSlots = volley.events
    .filter((e) => e.type === 'StickerSpent' && e.stickerId === 'fireball')
    .map((e) => (e.type === 'StickerSpent' ? e.stickerSlot : -1));
  if (spentSlots.join(',') !== '0,1,2') {
    throw new Error(`fireballs should spend oldest first got=${spentSlots.join(',')}`);
  }
}
{
  let bolts = instanceFromDef('farm-boy', 1, 'fbBolts');
  bolts = applySticker(bolts, 'lightning-bolt');
  bolts = applySticker(bolts, 'lightning-bolt');
  const storm = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [bolts],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfBolts')],
    }),
    50,
  );
  const zaps = storm.events.filter(
    (e) => e.type === 'DamageDealt' && e.sourceId === 'player:fbBolts' && e.kind === 'effect' && e.amount === 3,
  );
  if (zaps.length !== 2) {
    throw new Error(`stacked lightning bolts should all fire on turn start got=${zaps.length}`);
  }
}
{
  const rain = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbRain'), 'shower-of-arrows')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfRainA'), instanceFromDef('village-fool', 2, 'vfRainB')],
    }),
    48,
  );
  if (
    !rain.events.some(
      (e) => e.type === 'DamageDealt' && e.targetId === 'enemy:vfRainA' && e.amount === 2 && e.kind === 'effect',
    ) ||
    !rain.events.some(
      (e) => e.type === 'DamageDealt' && e.targetId === 'enemy:vfRainB' && e.amount === 2 && e.kind === 'effect',
    )
  ) {
    throw new Error('shower of arrows should deal 2 to all enemies');
  }
}
{
  const breath = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbBreath'), 'dragons-breath')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'vfBreathA'), instanceFromDef('village-fool', 2, 'vfBreathB')],
    }),
    49,
  );
  if (
    !breath.events.some(
      (e) => e.type === 'DamageDealt' && e.targetId === 'enemy:vfBreathA' && e.amount === 3 && e.kind === 'effect',
    ) ||
    !breath.events.some(
      (e) => e.type === 'DamageDealt' && e.targetId === 'enemy:vfBreathB' && e.amount === 3 && e.kind === 'effect',
    )
  ) {
    throw new Error('dragons breath should deal 3 to all enemies');
  }
}
{
  const hoodCard = renderStickerCard('en', 'thiefs-hood', false);
  const scopeCard = renderStickerCard('en', 'snipers-sight', false);
  if (hoodCard.includes('data-targeting=') || scopeCard.includes('data-targeting=')) {
    throw new Error('sticker cards should not duplicate the colored targeting chip');
  }
  if (!hoodCard.includes('Sneak') || !scopeCard.includes('Hitman')) {
    throw new Error('sticker cards should still name Sneak and Hitman in the rule text');
  }
}
{
  const rusty = renderStickerCard('en', 'rusty-knife', false);
  const excalibur = renderStickerCard('en', 'excalibur', false);
  const voidIt = renderStickerCard('it', 'void-heart', false);
  if (rusty.includes('class="family"') || rusty.includes('familyStat')) {
    throw new Error('sticker cards should not show the family chip');
  }
  if (!rusty.includes('data-rarity="bronze"') || !rusty.includes('Bronze') || rusty.includes('seal-bronze.png')) {
    throw new Error('bronze sticker should show the rarity name without a seal');
  }
  if (!excalibur.includes('data-rarity="platinum"') || !excalibur.includes('Platinum')) {
    throw new Error('platinum sticker should show rarity');
  }
  if (!voidIt.includes('data-rarity="diamond"') || !voidIt.includes('Diamante')) {
    throw new Error('diamond sticker should show Italian rarity');
  }
}
{
  const giant = applySticker(instanceFromDef('farm-boy', 1, 'fbGiant'), 'giant-strength');
  if (computedStats(giant).atk !== 6) throw new Error(`giant strength atk=${computedStats(giant).atk}`);
  if (translate('en', 'stk.giantStrength.d') !== '+4 ATK.') throw new Error('giant strength copy');
}
{
  if (abilityRule('en', 'old-gatekeeper') !== 'Taunt. Thorn 2.') throw new Error('gatekeeper thorn number');
  if (abilityRule('it', 'old-gatekeeper') !== 'Taunt. Spine 2.') throw new Error('gatekeeper spine number');
  if (translate('en', 'stk.spikedShield.d') !== '+1 HP. Thorn 1.') throw new Error('spiked shield thorn number');
  if (translate('it', 'stk.spikedShield.d') !== '+1 HP. Spine 1.') throw new Error('spiked shield spine number');
  const shieldCard = renderStickerCard('en', 'spiked-shield', false);
  if (!shieldCard.includes('Thorn 1')) throw new Error('sticker card missing Thorn 1');
}
{
  const seek = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(applySticker(instanceFromDef('farm-boy', 1, 'hsAtk'), 'heartseeker-arrow'), 'rabbits-foot'),
        instanceFromDef('happy-rat', 2, 'hsAlly'),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'hsFoe')],
    }),
    52,
  );
  const foeHits = seek.events.filter((e) => e.type === 'AttackStarted' && e.unitId === 'enemy:hsFoe');
  if (!foeHits.some((e) => e.targetId === 'player:hsAlly') || foeHits.some((e) => e.targetId === 'player:hsAtk')) {
    throw new Error(`heartseeker redirect ${foeHits.map((e) => (e.type === 'AttackStarted' ? e.targetId : '')).join(',')}`);
  }
}
{
  const only = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(applySticker(instanceFromDef('farm-boy', 1, 'hsSolo'), 'heartseeker-arrow'), 'rabbits-foot')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'hsSoloFoe')],
    }),
    53,
  );
  if (!only.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'enemy:hsSoloFoe' && e.targetId === 'player:hsSolo')) {
    throw new Error('heartseeker must still hit when no other target');
  }
}
{
  const cursed = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'fbCurse'), 'cursed-armor')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdCurse')],
    }),
    45,
  );
  if (
    !cursed.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.kind === 'reflect' &&
        e.sourceId === 'player:fbCurse' &&
        e.targetId === 'enemy:pdCurse' &&
        e.amount === 1,
    ) ||
    !cursed.events.some(
      (e) =>
        e.type === 'DamageDealt' &&
        e.kind === 'effect' &&
        e.sourceId === 'player:fbCurse' &&
        e.targetId === 'player:fbCurse' &&
        e.amount === 2,
    )
  ) {
    throw new Error('cursed armor reflect or turn drain failed');
  }
}
{
  if (getUnit('gingerbread-man').targeting !== 'brawler') throw new Error('gingerbread targeting');
  if (getUnit('tiny-brave-mouse').targeting !== 'brawler') throw new Error('mouse targeting');
  if (getUnit('puss-in-boots').targeting !== 'hitman') throw new Error('puss targeting');
  const bat = getUnit('vampire-bat');
  if (bat.targeting !== 'hitman' || bat.hp !== 5 || bat.atk !== 2 || bat.speed !== 7 || bat.ability?.trigger !== 'damageDealt') {
    throw new Error(`vampire bat ${bat.hp}/${bat.atk}/${bat.speed} ${bat.targeting} ${bat.ability?.trigger}`);
  }
  {
    const sip = simulateBattle(
      makeSnapshot({
        playerId: 'p',
        playerName: 'p',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('vampire-bat', 1, 'vb1')],
      }),
      makeSnapshot({
        playerId: 'e',
        playerName: 'e',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('gingerbread-man', 1, 'gbBat')],
      }),
      4,
    );
    const healed = sip.events.filter((e) => e.type === 'Healed' && e.unitId === 'player:vb1' && e.amount === 1);
    const bitten = sip.events.findIndex((e) => e.type === 'DamageDealt' && e.sourceId === 'player:vb1' && e.kind === 'attack');
    const sipAt = sip.events.findIndex((e) => e.type === 'Healed' && e.unitId === 'player:vb1');
    if (bitten < 0 || sipAt < bitten || healed.length !== 2) {
      throw new Error('vampire bat should heal 1 when its hit lands');
    }
  }
  if (getUnit('jack-in-the-box').targeting !== 'pacifist') throw new Error('jack targeting');
  if (getUnit('jack-in-the-box').hp !== 6 || getUnit('jack-in-the-box').atk !== 0 || getUnit('jack-in-the-box').speed !== 0) {
    throw new Error('jack stats');
  }
  if (getUnit('sprung-jack').targeting !== 'brawler') throw new Error('sprung jack targeting');
  if (getUnit('sprung-jack').hp !== 6 || getUnit('sprung-jack').atk !== 2 || getUnit('sprung-jack').speed !== 3) {
    throw new Error('sprung jack stats');
  }
  if (getUnit('mimic').targeting !== 'pacifist' || getUnit('mimic').atk !== 0 || getUnit('mimic').speed !== 0) {
    throw new Error('mimic stats');
  }
  if (getUnit('sprung-mimic').targeting !== 'sneak' || getUnit('sprung-mimic').atk !== 4 || getUnit('sprung-mimic').speed !== 5) {
    throw new Error('sprung mimic stats');
  }
  if (getUnit('frog-prince').hp !== 4 || getUnit('frog-prince').atk !== 1 || getUnit('frog-prince').speed !== 6) {
    throw new Error('frog prince stats');
  }
  if (getUnit('tin-soldier').hp !== 4 || getUnit('tin-soldier').atk !== 2 || getUnit('tin-soldier').speed !== 3) {
    throw new Error('tin soldier stats');
  }
  if (getUnit('wax-knight').atk !== 4) throw new Error('wax knight atk');
  if (getUnit('hunter').atk !== 4) throw new Error('hunter atk');
  if (getUnit('royal-herald').hp !== 6) throw new Error('royal herald hp');
  if (
    getUnit('patchwork-princess').targeting !== 'pacifist' ||
    getUnit('patchwork-princess').hp !== 6 ||
    getUnit('patchwork-princess').atk !== 0 ||
    getUnit('patchwork-princess').speed !== 3
  ) {
    throw new Error('patchwork princess stats');
  }
  if (getUnit('magic-mirror').targeting !== 'brawler') throw new Error('goose targeting');
  if (getUnit('village-fool').targeting !== 'pacifist' || getUnit('village-fool').atk !== 0 || getUnit('village-fool').speed !== 0) {
    throw new Error('fool targeting');
  }
  if (getUnit('old-gatekeeper').targeting !== 'pacifist' || getUnit('old-gatekeeper').atk !== 0 || getUnit('old-gatekeeper').speed !== 0) {
    throw new Error('gatekeeper stats');
  }
  const fairy = getUnit('little-fairy');
  if (fairy.targeting !== 'pacifist' || fairy.atk !== 0 || fairy.speed !== 9) {
    throw new Error(`little fairy stats ${fairy.atk}/${fairy.speed} ${fairy.targeting}`);
  }
  {
    const scrap = simulateBattle(
      makeSnapshot({
        playerId: 'p',
        playerName: 'p',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('happy-rat', 1, 'hr9'), instanceFromDef('little-fairy', 2, 'lf1')],
      }),
      makeSnapshot({
        playerId: 'e',
        playerName: 'e',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('village-fool', 1, 'vf8')],
      }),
      7,
    );
    const start = scrap.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:lf1');
    const ate = scrap.events.findIndex(
      (e) => e.type === 'AteSticker' && e.unitId === 'player:hr9',
    );
    const stuck = scrap.events.find(
      (e) => e.type === 'GainedCombatSticker' && e.sourceId === 'player:lf1',
    );
    if (start < 0 || ate < 0 || ate < start) {
      throw new Error(`little fairy turn gift failed start=${start} ate=${ate}`);
    }
    if (stuck) throw new Error('little fairy should not also emit combat sticker when rat eats');
  }
  {
    const scrap = simulateBattle(
      makeSnapshot({
        playerId: 'p',
        playerName: 'p',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('farm-boy', 1, 'fbFairy'), instanceFromDef('little-fairy', 2, 'lf2')],
      }),
      makeSnapshot({
        playerId: 'e',
        playerName: 'e',
        runId: 'r',
        round: 1,
        team: [instanceFromDef('village-fool', 1, 'vfFairy')],
      }),
      11,
    );
    const gift = scrap.events.find(
      (e) =>
        e.type === 'GainedCombatSticker' &&
        e.sourceId === 'player:lf2' &&
        e.unitId === 'player:fbFairy',
    );
    if (!gift || gift.type !== 'GainedCombatSticker' || !gift.stickerId) {
      throw new Error('little fairy front ally combat sticker missing');
    }
  }
  for (const u of UNITS) {
    if (u.targeting !== 'pacifist') continue;
    if (u.atk !== 0) throw new Error(`pacifist ${u.id} atk ${u.atk}`);
    const wantSpeed =
      u.id === 'little-fairy' || u.id === 'time-master' ? 9 : u.id === 'patchwork-princess' ? 3 : 0;
    if (u.speed !== wantSpeed) throw new Error(`pacifist ${u.id} spd ${u.speed}`);
  }
  {
    const crushed = instanceFromDef('farm-boy', 1, 'crush');
    crushed.permanentMods = { atk: -99, hp: -99, speed: -99 };
    const floor = computedStats(crushed);
    if (floor.atk !== 0 || floor.speed !== 0 || floor.hp < 1) {
      throw new Error(`stat floor ${floor.atk}/${floor.hp}/${floor.speed}`);
    }
  }
  if (nextFormOf('frog-prince') !== 'prince-charming') throw new Error('frog next form');
  if (nextFormOf('woodland-girl') !== 'big-bad-wolf') throw new Error('woodland next form');
  if (nextFormOf('cobblers-elves') !== 'woken-bear') throw new Error('bear next form');
  if (nextFormOf('jack-in-the-box') !== 'sprung-jack') throw new Error('jack next form');
  if (nextFormOf('mimic') !== 'sprung-mimic') throw new Error('mimic next form');
  if (nextFormOf('the-egg') || nextFormOf('circe') || nextFormOf('prince-charming')) throw new Error('no next form');
  if (prevFormOf('prince-charming') !== 'frog-prince') throw new Error('prince prev form');
  if (prevFormOf('big-bad-wolf') !== 'woodland-girl') throw new Error('wolf prev form');
  if (prevFormOf('woken-bear') !== 'cobblers-elves') throw new Error('woken prev form');
  if (prevFormOf('sprung-jack') !== 'jack-in-the-box') throw new Error('sprung jack prev form');
  if (prevFormOf('sprung-mimic') !== 'mimic') throw new Error('sprung mimic prev form');
  if (prevFormOf('frog-prince') || prevFormOf('the-egg')) throw new Error('no prev form');
  if (baseFormOf('prince-charming') !== 'frog-prince') throw new Error('prince base form');
  if (baseFormOf('frog-prince') !== 'frog-prince') throw new Error('frog is already base');
  if (getUnit('glass-knight').atk !== 6 || getUnit('glass-knight').speed !== 6) throw new Error('glass knight stats');
  const bear = getUnit('cobblers-elves');
  if (bear.hp !== 9 || bear.atk !== 0 || bear.speed !== 0) throw new Error('sleeping bear stats');
  const woken = getUnit('woken-bear');
  if (woken.hp !== bear.hp || woken.atk !== 4 || woken.speed !== 5) throw new Error('woken bear stats');
  const tin = instanceFromDef('tin-soldier', 1, 'ts0');
  if (tin.stickerIds.length) throw new Error('tin soldier should start without stickers');
}
{
  const wax = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('wax-knight', 1, 'wk1')],
  });
  const sleeper = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('cobblers-elves', 1, 'sb-wax')],
  });
  const melt = simulateBattle(wax, sleeper, 2);
  if (
    !melt.events.some(
      (e) => e.type === 'DamageDealt' && e.sourceId === 'player:wk1' && e.targetId === 'player:wk1' && e.amount === 1 && e.kind === 'effect',
    )
  ) {
    throw new Error('wax knight did not melt at end of turn');
  }
  const woke = melt.events.find((e) => e.type === 'Transformed' && e.fromId === 'cobblers-elves');
  if (!woke || woke.type !== 'Transformed' || woke.unit.defId !== 'woken-bear' || woke.unit.hp !== 5 || woke.unit.maxHp !== 9) {
    throw new Error(
      `bear should keep shared HP on wake hp=${woke && woke.type === 'Transformed' ? `${woke.unit.hp}/${woke.unit.maxHp}` : 'none'}`,
    );
  }
}
{
  const confused = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('drunken-giant', 1, 'g1'), instanceFromDef('farm-boy', 2, 'fb1')],
  });
  const dove = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('cobblers-elves', 1, 'sb1')],
  });
  let skip = false;
  let allyHit = false;
  for (let seed = 1; seed <= 40; seed++) {
    const fight = simulateBattle(confused, dove, seed);
    if (fight.events.some((e) => e.type === 'ConfusedSkip' && e.unitId === 'player:g1')) skip = true;
    if (fight.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:g1' && e.targetId === 'player:fb1')) {
      allyHit = true;
    }
  }
  if (!skip || !allyHit) throw new Error(`confused mix skip=${skip} ally=${allyHit}`);
}
{
  const rat = applySticker(instanceFromDef('happy-rat', 1, 'hr9'), 'fur-armor');
  if (rat.stickerIds.length || rat.permanentMods.atk !== 0 || rat.permanentMods.hp !== 2) {
    throw new Error(`happy rat eat atk=${rat.permanentMods.atk} hp=${rat.permanentMods.hp} stk=${rat.stickerIds.join(',')}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Buddy', 0x77);
  run = { ...run, draftPicks: ['farm-boy', 'village-fool'] };
  run = confirmDraft(run);
  const gift = run.pendingStickerIds[0];
  if (run.phase !== 'stickerAssign' || !gift || getSticker(gift).rarity !== 'bronze' || run.round !== 1) {
    throw new Error(`farm draft gift phase=${run.phase} pending=${run.pendingStickerIds.join(',')}`);
  }
  run = skipStickers(run);
  if (run.phase !== 'formation' || run.round !== 1) throw new Error(`farm draft skip phase=${run.phase} round=${run.round}`);
}
{
  let empty = createRun('ai', 'tester', 'Pass', 0x79);
  empty = confirmDraft(empty);
  if (empty.phase !== 'formation' || empty.team.length !== 0) {
    throw new Error(`empty draft pass phase=${empty.phase} n=${empty.team.length}`);
  }
  let one = createRun('ai', 'tester', 'Pass1', 0x7a);
  one = placeDraft(one, one.draftOffers[0]!, 1);
  one = confirmDraft(one);
  if (one.phase !== 'formation' && one.phase !== 'stickerAssign') {
    throw new Error(`partial draft pass phase=${one.phase}`);
  }
  if (one.team.length !== 1) throw new Error(`partial draft kept ${one.team.length}`);
}
{
  let run = createRun('ai', 'tester', 'Hire', 0x78);
  run = {
    ...run,
    phase: 'recruit',
    recruitOffers: ['farm-boy', 'village-fool', 'hunter'],
    recruitPicks: [],
  };
  run = placeRecruit(run, 'farm-boy', 1);
  run = finishRecruit(run);
  const gift = run.pendingStickerIds[0];
  if (run.phase !== 'stickerAssign' || !gift || getSticker(gift).rarity !== 'bronze') {
    throw new Error(`farm recruit gift phase=${run.phase} pending=${run.pendingStickerIds.join(',')}`);
  }
}
{
  const egg = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('the-egg', 1, 'eg1')],
  });
  const sleeper = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('cobblers-elves', 1, 'sb1')],
  });
  const hatch = simulateBattle(egg, sleeper, 7);
  const xf = hatch.events.find((e) => e.type === 'Transformed' && e.fromId === 'the-egg');
  if (!xf || xf.type !== 'Transformed' || xf.combat || getUnit(xf.unit.defId).rarity !== 'silver') {
    throw new Error(`egg hatch ${xf && xf.type === 'Transformed' ? xf.unit.defId : 'none'}`);
  }
  const hatchAt = hatch.events.findIndex((e) => e.type === 'Transformed' && e.fromId === 'the-egg');
  const bowAt = hatch.events.findIndex((e) => e.type === 'BattleEnded');
  if (hatchAt < 0 || bowAt < 0 || hatchAt > bowAt) {
    throw new Error('egg must hatch before the victory dance');
  }
  if (abilityRule('en', 'woken-bear') !== '' || abilityRule('en', 'prince-charming') !== '') {
    throw new Error('woken bear / prince charming should have no body text');
  }
  if (abilityRule('en', 'sprung-jack') !== '' || abilityRule('en', 'sprung-mimic') !== '') {
    throw new Error('sprung ambush forms should have no body text');
  }
  if (!abilityRule('en', 'jack-in-the-box').startsWith(translate('en', 'keywordAmbush'))) {
    throw new Error('toy box should Ambush');
  }
  if (!abilityRule('en', 'jack-in-the-box').includes(translate('en', 'keywordJackInTheBox'))) {
    throw new Error('toy box should name Jack in the Box');
  }
  if (abilityRule('en', 'jack-in-the-box').includes(translate('en', 'keywordTransform'))) {
    throw new Error('toy box should not also say Transform');
  }
  if (abilityRule('en', 'mimic').includes(translate('en', 'keywordTransform'))) {
    throw new Error('treasure chest should not also say Transform');
  }
  if (
    abilityRule('en', 'mimic') !==
    'Copy all stickers from the attacker, for this scrap. Ambush. Mimic.'
  ) {
    throw new Error('treasure chest en text');
  }
  if (
    abilityRule('it', 'mimic') !==
    'Copia tutti gli sticker di chi l’ha attaccata, per questo scontro. Ambush. Mimic.'
  ) {
    throw new Error('treasure chest it text');
  }
  if (!abilityRule('en', 'the-egg').startsWith(translate('en', 'keywordBecome'))) {
    throw new Error('egg should Become');
  }
  if (!abilityRule('en', 'woodland-girl').startsWith(translate('en', 'keywordBecome'))) {
    throw new Error('woodland girl should Become');
  }
  if (abilityRule('en', 'aladdin') !== translate('en', 'keywordSteal')) {
    throw new Error('aladdin should be Steal only');
  }
  if (translate('en', 'timing.scrapEnd') === translate('en', 'timing.battleEnd')) {
    throw new Error('after scrap must not reuse battle end');
  }
  if (!abilityRule('en', 'cobblers-elves').startsWith(translate('en', 'keywordTransform'))) {
    throw new Error('sleeping bear should Transform');
  }
  for (const unit of UNITS) {
    const key = `lore.${unit.id}`;
    if (translate('en', key) === key || translate('it', key) === key) {
      throw new Error(`missing lore ${unit.id}`);
    }
  }
  const wake = getUnit('cobblers-elves').ability?.effects[0];
  if (!wake || wake.op !== 'transform' || wake.duration !== 'combat') {
    throw new Error('sleeping bear transform should end with the scrap');
  }
  let eggRun = createRun('ai', 'tester', 'Egg', 0x71);
  eggRun = { ...eggRun, team: [instanceFromDef('the-egg', 1, 'eg2')] };
  eggRun = resolveFight(
    eggRun,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('cobblers-elves', 1, 'sb-egg')],
    }),
  );
  const hatched = eggRun.team.find((u) => u.instanceId === 'eg2');
  if (!hatched || hatched.defId === 'the-egg') {
    throw new Error(`egg Become did not persist def=${hatched?.defId}`);
  }
  let bearRun = createRun('ai', 'tester', 'Bear', 0x72);
  bearRun = { ...bearRun, team: [instanceFromDef('cobblers-elves', 1, 'sb2')] };
  bearRun = resolveFight(
    bearRun,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb-bear')],
    }),
  );
  const stillSleeping = bearRun.team.find((u) => u.instanceId === 'sb2');
  if (!stillSleeping || stillSleeping.defId !== 'cobblers-elves') {
    throw new Error(`sleeping bear Transform persisted def=${stillSleeping?.defId}`);
  }
  let jackRun = createRun('ai', 'tester', 'Jack', 0x73);
  jackRun = { ...jackRun, team: [instanceFromDef('jack-in-the-box', 1, 'jkR')] };
  jackRun = resolveFight(
    jackRun,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'fb-jack')],
    }),
  );
  const stillBoxed = jackRun.team.find((u) => u.instanceId === 'jkR');
  if (!stillBoxed || stillBoxed.defId !== 'jack-in-the-box') {
    throw new Error(`toy box Transform persisted def=${stillBoxed?.defId}`);
  }
}
{
  const puss = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('puss-in-boots', 1, 'pu1')],
  });
  const fool = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('village-fool', 1, 'vf1'), 'fur-armor')],
  });
  const swipe = simulateBattle(puss, fool, 11);
  if (!swipe.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:pu1' && e.stat === 'maxHp' && e.amount === 2)) {
    throw new Error('puss did not copy a sticker');
  }
  if (
    !swipe.events.some(
      (e) =>
        e.type === 'GainedCombatSticker' &&
        e.unitId === 'player:pu1' &&
        e.stickerId === 'fur-armor' &&
        e.sourceId === 'enemy:vf1',
    )
  ) {
    throw new Error('puss copy must emit GainedCombatSticker for the rail FX');
  }
}
{
  const line = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('magic-mirror', 1, 'gg1'), instanceFromDef('farm-boy', 2, 'fb1')],
  });
  const dove = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'pd1')],
  });
  const guard = simulateBattle(line, dove, 13);
  if (!guard.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:gg1' && e.targetId === 'enemy:pd1')) {
    throw new Error('guardian did not counter the rear hit');
  }
  const skip = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('magic-mirror', 1, 'gg2'), instanceFromDef('farm-boy', 3, 'fb2')],
  });
  skip.units = skip.units.map((u) => (u.instanceId === 'fb2' ? { ...u, slot: 3 } : u));
  const sneak = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'pd2')],
  });
  const far = simulateBattle(skip, sneak, 13);
  const doveHitsRear = far.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'enemy:pd2' && e.targetId === 'player:fb2');
  if (!doveHitsRear) {
    throw new Error('sneak dove should hit the slot-3 farm boy');
  }
  const guardedFar = far.events.some((e, i) => {
    if (e.type !== 'AttackStarted' || e.unitId !== 'player:gg2') return false;
    for (let j = i + 1; j < far.events.length; j++) {
      const x = far.events[j];
      if (x.type === 'TurnStarted' || x.type === 'TurnEnded') return false;
      if (x.type === 'AttackStarted') {
        return x.unitId === 'enemy:pd2' && x.targetId === 'player:fb2';
      }
    }
    return false;
  });
  if (guardedFar) {
    throw new Error('guardian should ignore a card that is not immediately behind');
  }
  if (!translate('en', 'keywordGuardianD').includes('immediately behind')) {
    throw new Error('guardian tip should say immediately behind');
  }
}
{
  const crestLine = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [applySticker(instanceFromDef('farm-boy', 1, 'kc1'), 'knights-crest'), instanceFromDef('happy-rat', 2, 'hrKc')],
  });
  const crestDove = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'pdKc')],
  });
  const crestGuard = simulateBattle(crestLine, crestDove, 13);
  if (!crestGuard.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:kc1' && e.targetId === 'enemy:pdKc')) {
    throw new Error('knight crest guardian did not counter the rear hit');
  }
  if (translate('en', 'stk.knightsCrest.d') !== 'This unit has Guardian.') {
    throw new Error('knight crest text');
  }
}
{
  let run = createRun('ai', 'tester', 'Tin', 0x79);
  run = { ...run, team: [instanceFromDef('tin-soldier', 1, 'ts1'), instanceFromDef('farm-boy', 2, 'fb1')] };
  run = resolveFight(
    run,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og1')],
    }),
  );
  const tin = run.team.find((u) => u.instanceId === 'ts1');
  const boy = run.team.find((u) => u.instanceId === 'fb1');
  const gift = run.lastBattle?.events.find((e) => e.type === 'ExhaustedUnit' && e.unitId === 'player:ts1');
  if (
    tin ||
    !boy ||
    gift?.type !== 'ExhaustedUnit' ||
    gift.recipientId !== 'player:fb1' ||
    gift.atk !== 2 ||
    gift.hp !== 4 ||
    boy.permanentMods.atk !== 2 ||
    boy.permanentMods.hp !== 4
  ) {
    throw new Error(
      `tin exhaust tin=${tin?.instanceId} boy=${boy?.permanentMods.atk}/${boy?.permanentMods.hp} gift=${gift && gift.type === 'ExhaustedUnit' ? `${gift.recipientId}:${gift.atk}/${gift.hp}` : 'none'}`,
    );
  }
}
{
  let run = createRun('ai', 'tester', 'TinSolo', 0x7a);
  run = { ...run, team: [instanceFromDef('tin-soldier', 1, 'ts2')] };
  run = resolveFight(
    run,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'og2')],
    }),
  );
  const leftover = run.team.find((u) => u.instanceId === 'ts2');
  const solo = run.lastBattle?.events.find((e) => e.type === 'ExhaustedUnit' && e.unitId === 'player:ts2');
  if (leftover || solo?.type !== 'ExhaustedUnit' || solo.recipientId) {
    throw new Error(`solo tin should exhaust with no heir leftover=${leftover?.instanceId} rec=${solo && solo.type === 'ExhaustedUnit' ? solo.recipientId : 'none'}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Wolf', 0x81);
  run = { ...run, team: [instanceFromDef('big-bad-wolf', 1, 'w1')] };
  run = resolveFight(
    run,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdw1'), instanceFromDef('paper-dove', 2, 'pdw2')],
    }),
  );
  const wolf = run.team.find((u) => u.instanceId === 'w1');
  const fang = run.lastBattle?.events.filter(
    (e) => e.type === 'StatChanged' && e.unitId === 'player:w1' && e.stat === 'atk' && e.amount === 2 && !e.permanent,
  );
  if (!wolf || wolf.permanentMods.atk !== 0 || fang?.length !== 2) {
    throw new Error(`wolf scrap fang stacks atk=${wolf?.permanentMods.atk} n=${fang?.length}`);
  }
}
{
  let run = createRun('ai', 'tester', 'Horseman', 0x82);
  run = { ...run, team: [instanceFromDef('headless-horseman', 1, 'hh1')] };
  run = resolveFight(
    run,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'pdh1'), instanceFromDef('paper-dove', 2, 'pdh2')],
    }),
  );
  const horse = run.team.find((u) => u.instanceId === 'hh1');
  const harvest = run.lastBattle?.events.filter(
    (e) => e.type === 'StatChanged' && e.unitId === 'player:hh1' && e.stat === 'atk' && e.amount === 1 && e.permanent,
  );
  if (!horse || horse.permanentMods.atk !== 2 || harvest?.length !== 2) {
    throw new Error(`horseman permanent stacks atk=${horse?.permanentMods.atk} n=${harvest?.length}`);
  }
}
const a = buildOpponent(6, 0x51a7e, 0.7);
const b = buildOpponent(6, 0xC0FFEE, 0.7);
if (!assertDeterministic(a, b, 12345)) throw new Error('determinism failed');
{
  const left = makeSnapshot({
    playerId: 'p',
    playerName: 'p',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('farm-boy', 1, 's1'), instanceFromDef('farm-boy', 2, 's2')],
  });
  const right = makeSnapshot({
    playerId: 'e',
    playerName: 'e',
    runId: 'r',
    round: 1,
    team: [instanceFromDef('paper-dove', 1, 'd1')],
  });
  const spawnPair = (seed: number) =>
    simulateBattle(left, right, seed)
      .events.filter((e) => e.type === 'UnitSpawned' && (e.unit.uid === 'player:s1' || e.unit.uid === 'player:s2'))
      .map((e) => (e.type === 'UnitSpawned' ? e.unit.uid : ''));
  const p1 = spawnPair(0xace11);
  const p2 = spawnPair(0xace11);
  if (p1.join('|') !== p2.join('|') || p1.length !== 2) throw new Error('equal-speed spawn should be seed-stable');
  let flipped = false;
  for (let s = 0x1000; s < 0x1000 + 200; s++) {
    const p = spawnPair(s);
    if (p[0] !== p1[0]) {
      flipped = true;
      break;
    }
  }
  if (!flipped) throw new Error('equal-speed ties should be able to flip across seeds');
}
{
  const filthCard = renderStickerCard('en', 'filth', false);
  if (
    !filthCard.includes('ON HIT') ||
    !filthCard.includes('If it cannot, a random') ||
    !filthCard.includes('data-preview-sticker="poison"') ||
    !filthCard.includes('<strong>Poison</strong>') ||
    !filthCard.includes(translate('en', 'keywordPeekHint')) ||
    /On hit:/i.test(filthCard)
  ) {
    throw new Error('filth card should use the ON HIT chip');
  }
  const filthIt = renderStickerCard('it', 'filth', false);
  if (!filthIt.includes('Veleno') || !filthIt.includes('data-preview-sticker="poison"') || !filthIt.includes('<strong>Veleno</strong>')) {
    throw new Error('filth it');
  }
  const trashCard = renderStickerCard('en', 'trash', false);
  if (!trashCard.includes('No effect.') || trashCard.includes('ON HIT')) throw new Error('trash should have no effect');
  if (shopStickers().some((s) => s.id === 'trash' || s.id === 'filth' || s.id === 'poison')) throw new Error('filth, poison, or trash in the shop');
  if (!libraryHuntStickers().some((s) => s.id === 'filth')) throw new Error('filth should be in the library');
  if (huntStickerFor('sewer-lord') !== 'filth') throw new Error('sewer lord sticker');
  const glued = renderUnitCard('en', applySticker(instanceFromDef('sewer-lord', 1, 'fltip'), 'filth'));
  if (!glued.includes('ON HIT') || !glued.includes('data-preview-sticker="poison"') || !glued.includes('tip-rarity') || !glued.includes('>Gold<')) {
    throw new Error('filth hover should show the ON HIT chip');
  }
  let run = createRun('ai', 'tester', 'Filth', 0x71);
  run = {
    ...run,
    team: [applySticker(applySticker(instanceFromDef('farm-boy', 1, 'fl1'), 'fur-armor'), 'rusty-knife')],
  };
  const before = computedStats(run.team[0]!);
  if (before.hp !== 8 || before.atk !== 3) throw new Error(`filth setup hp=${before.hp} atk=${before.atk}`);
  run = resolveFight(
    run,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('paper-dove', 1, 'flFoe'), 'filth')],
    }),
  );
  const boy = run.team.find((u) => u.instanceId === 'fl1');
  const poisoned = (run.lastBattle?.events ?? []).filter((e) => e.type === 'PoisonApplied' && e.unitId === 'player:fl1');
  const hit = poisoned[0];
  if (poisoned.length !== 1 || !hit || hit.type !== 'PoisonApplied' || !hit.added || hit.removed !== null || hit.stickers.join(',') !== 'fur-armor,rusty-knife,poison') {
    throw new Error(`filth apply count=${poisoned.length} now=${hit && hit.type === 'PoisonApplied' ? hit.stickers.join(',') : ''}`);
  }
  const after = boy ? computedStats(boy) : null;
  if (!boy || boy.stickerIds.join(',') !== 'fur-armor,rusty-knife' || after?.hp !== 8 || after?.atk !== 3) {
    throw new Error(`filth persist stk=${boy?.stickerIds.join(',')} hp=${after?.hp} atk=${after?.atk}`);
  }
  let full = createRun('ai', 'tester', 'FilthFull', 0x73);
  full = {
    ...full,
    team: [
      applySticker(
        applySticker(applySticker(instanceFromDef('farm-boy', 1, 'fullRun'), 'fur-armor'), 'rusty-knife'),
        'trash',
      ),
    ],
  };
  full = resolveFight(
    full,
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('paper-dove', 1, 'flFullFoe'), 'filth')],
    }),
  );
  const restored = full.team.find((u) => u.instanceId === 'fullRun');
  const swapEv = (full.lastBattle?.events ?? []).find((e) => e.type === 'PoisonApplied' && e.unitId === 'player:fullRun');
  if (
    !restored ||
    restored.stickerIds.includes('poison') ||
    !swapEv ||
    swapEv.type !== 'PoisonApplied' ||
    swapEv.added ||
    !swapEv.removed ||
    restored.stickerIds.join(',') !== 'fur-armor,rusty-knife,trash'
  ) {
    throw new Error(`poison should give the sticker back stk=${restored?.stickerIds.join(',')}`);
  }
  const hunt = resolveHuntFight({
    ...createRun('ai', 'tester', 'FilthHunt', 0x72),
    phase: 'event',
    eventId: 'monster-hunt',
    eventStep: 'preview',
    huntMonsterId: 'sewer-lord',
    round: 6,
    team: [instanceFromDef('cursed-doll', 1, 'flh')],
  });
  const spawned = hunt.lastBonusBattle?.events.find((e) => e.type === 'UnitSpawned' && e.unit.defId === 'sewer-lord');
  if (!spawned || spawned.type !== 'UnitSpawned' || !spawned.unit.stickers.includes('filth') || spawned.unit.atk !== 6) {
    throw new Error(`sewer lord should enter wearing filth atk=${spawned && spawned.type === 'UnitSpawned' ? spawned.unit.atk : 'none'}`);
  }
}
{
  const poisonCard = renderStickerCard('en', 'poison', false);
  if (!poisonCard.includes('ON MY TURN') || !poisonCard.includes('Take 1 damage.') || poisonCard.includes('Up to 3')) {
    throw new Error('poison card');
  }
  if (!poisonCard.includes('rarity-gold')) throw new Error('poison should be gold');
  const poisonIt = renderStickerCard('it', 'poison', false);
  if (!poisonIt.includes('IL MIO TURNO') || !poisonIt.includes('Subisci 1 danno.')) {
    throw new Error('poison it');
  }
  const ticked = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'tox'), 'poison')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'doveTox')],
    }),
    5,
  );
  const start = ticked.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:tox');
  const tick = ticked.events.findIndex(
    (e) => e.type === 'DamageDealt' && e.targetId === 'player:tox' && e.kind === 'effect' && e.amount === 1,
  );
  const swing = ticked.events.findIndex((e) => e.type === 'AttackStarted' && e.unitId === 'player:tox');
  if (start < 0 || tick < 0 || swing < 0 || !(start < tick && tick < swing)) {
    throw new Error('poison should tick before the attack');
  }
  let triple = instanceFromDef('farm-boy', 1, 'tox3');
  triple = applySticker(triple, 'poison');
  triple = applySticker(triple, 'poison');
  triple = applySticker(triple, 'poison');
  const stacked = simulateBattle(
    makeSnapshot({ playerId: 'p', playerName: 'p', runId: 'r', round: 1, team: [triple] }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'doveTox3')],
    }),
    6,
  );
  const boyStart = stacked.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:tox3');
  const boySwing = stacked.events.findIndex((e) => e.type === 'AttackStarted' && e.unitId === 'player:tox3');
  const stacks = stacked.events.filter(
    (e, i) =>
      i > boyStart &&
      i < boySwing &&
      e.type === 'DamageDealt' &&
      e.targetId === 'player:tox3' &&
      e.kind === 'effect',
  );
  if (stacks.length !== 3 || stacks.reduce((n, e) => n + (e.type === 'DamageDealt' ? e.amount : 0), 0) !== 3) {
    throw new Error(`three poisons should deal 3 before the attack, got ${stacks.length}`);
  }
  const lethal = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(applySticker(instanceFromDef('paper-dove', 1, 'toxDie'), 'poison'), 'poison')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'boyTox')],
    }),
    7,
  );
  if (lethal.events.some((e) => e.type === 'AttackStarted' && e.unitId === 'player:toxDie')) {
    throw new Error('lethal poison should skip the attack');
  }
  const capped = simulateBattle(
    makeSnapshot({ playerId: 'p', playerName: 'p', runId: 'r', round: 1, team: [triple] }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('paper-dove', 1, 'filthCap'), 'filth')],
    }),
    8,
  );
  if (capped.events.some((e) => e.type === 'PoisonApplied')) throw new Error('a fourth poison should not apply');
  const converted = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(
          applySticker(applySticker(instanceFromDef('farm-boy', 1, 'full'), 'fur-armor'), 'rusty-knife'),
          'trash',
        ),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('paper-dove', 1, 'filthFull'), 'filth')],
    }),
    9,
  );
  const swaps = converted.events.filter((e) => e.type === 'PoisonApplied' && e.unitId === 'player:full');
  const swap = swaps[0];
  const kept = ['fur-armor', 'rusty-knife', 'trash'];
  if (
    swaps.length !== 1 ||
    !swap ||
    swap.type !== 'PoisonApplied' ||
    swap.added ||
    !swap.removed ||
    !kept.includes(swap.removed) ||
    swap.stickers.filter((id) => id === 'poison').length !== 1
  ) {
    throw new Error('a full card should turn one random sticker into poison');
  }
}
{
  const pile = getUnit('garbage-pile');
  if (pile.rarity !== 'gold' || pile.hp !== 6 || pile.atk !== 0 || pile.speed !== 0 || pile.targeting !== 'pacifist' || !pile.passives?.provoke) {
    throw new Error('garbage pile should be a gold pacifist taunt');
  }
  const lordCard = renderUnitCard('en', instanceFromDef('sewer-lord', 1, 'pileCard'));
  if (!lordCard.includes('BATTLE START') || !lordCard.includes('Garbage Piles')) {
    throw new Error('sewer lord should open with three piles');
  }
  const piles = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(applySticker(instanceFromDef('farm-boy', 1, 'gpBoy'), 'fur-armor'), 'rusty-knife')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('sewer-lord', 1, 'gpLord'), 'filth')],
    }),
    9,
  );
  const seats = new Map<string, { defId: string; slot: number }>();
  for (const e of piles.events) {
    if (e.type === 'BattleEffectsResolved') break;
    if (e.type === 'UnitSpawned' || e.type === 'Summoned') {
      if (!e.unit.uid.startsWith('enemy:')) continue;
      seats.set(e.unit.uid, { defId: e.unit.defId, slot: e.unit.slot });
    }
    if (e.type === 'MovedToBack') {
      const seat = seats.get(e.unitId);
      if (seat) seat.slot = e.toSlot;
    }
  }
  const line = [...seats.values()].sort((a, b) => a.slot - b.slot);
  const defs = line.map((s) => `${s.slot}:${s.defId}`).join(',');
  if (defs !== '1:garbage-pile,2:garbage-pile,3:garbage-pile,4:sewer-lord') {
    throw new Error(`piles should take the front, got ${defs}`);
  }
  const swing = piles.events.find((e) => e.type === 'AttackStarted' && e.unitId === 'player:gpBoy');
  const swung = swing && swing.type === 'AttackStarted' ? seats.get(swing.targetId) : undefined;
  if (!swung || swung.defId !== 'garbage-pile') throw new Error('taunt should pull the boy onto a pile');
  if (!piles.events.some((e) => e.type === 'PoisonApplied' && e.unitId === 'player:gpBoy')) {
    throw new Error('filth should poison the boy');
  }
}
{
  const fang = getUnit('greed-fang');
  if (fang.hp !== 30 || fang.atk !== 10 || fang.speed !== 3) throw new Error('greed fang stats');
  const fangCard = renderUnitCard('en', instanceFromDef('greed-fang', 1, 'gfCard'));
  if (!fangCard.includes('ON MY TURN') || !fangCard.includes('Deal 3 damage to all enemy figures.')) {
    throw new Error('greed fang should burn every enemy on its turn');
  }
  if (!renderUnitCard('it', instanceFromDef('greed-fang', 1, 'gfIt')).includes('figure nemiche')) {
    throw new Error('greed fang it');
  }
  const myth = renderStickerCard('en', 'mythic-treasure', false);
  if (!myth.includes('BATTLE START') || !myth.includes('Exhaust') || myth.includes('ON STICKER')) {
    throw new Error('mythic treasure should open at battle start and then exhaust');
  }
  const mythGlued = renderUnitCard('en', applySticker(instanceFromDef('greed-fang', 1, 'gfTip'), 'mythic-treasure'));
  if (!mythGlued.includes('BATTLE START') || !mythGlued.includes('Exhaust')) {
    throw new Error('mythic treasure hover should show battle start');
  }
  const diamonds = new Set(['reapers-scythe', 'void-heart', 'ares-helm']);
  const fangFight = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'gfBoy')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('greed-fang', 1, 'gf'), 'mythic-treasure')],
    }),
    11,
  );
  const gift = fangFight.events.find((e) => e.type === 'GrantedSticker' && e.unitId.startsWith('enemy:'));
  const spentTreasure = fangFight.events.some((e) => e.type === 'ExhaustedSticker' && e.stickerId === 'mythic-treasure');
  if (!gift || gift.type !== 'GrantedSticker' || !diamonds.has(gift.stickerId) || !spentTreasure) {
    throw new Error(`mythic treasure should gift a diamond then exhaust, got ${gift && gift.type === 'GrantedSticker' ? gift.stickerId : 'none'}`);
  }
  if (!fangFight.events.some((e) => e.type === 'DamageDealt' && e.kind === 'effect' && e.amount === 3 && e.targetId === 'player:gfBoy')) {
    throw new Error('greed fang should deal 3 to each enemy on its turn');
  }
}
if (huntMonstersFor(1).some((m) => getUnit(m.unitId).rarity === 'diamond')) throw new Error('early hunt diamond');
if (huntMonstersFor(9).some((m) => getUnit(m.unitId).rarity !== 'diamond')) throw new Error('r9 hunt not diamond');
if (!huntMonstersFor(9).some((m) => m.unitId === 'greed-fang')) throw new Error('r9 hunt missing greed fang');
if (huntMonstersFor(1).some((m) => m.unitId !== 'thousand-maws')) throw new Error('early hunt should be thousand maws');
if (shopStickers().some((s) => s.frame === 'monster')) throw new Error('hunt sticker in shop');
if (huntStickerFor('thousand-maws') !== 'endless-hunger') throw new Error('maws hunt sticker');
if (HUNT_MONSTERS.length !== 5) throw new Error('hunt roster size');
for (const id of ['thousand-maws', 'mad-woodsman', 'sewer-lord', 'purple-widows', 'greed-fang'] as const) {
  if (!hasUnitArt(id) || !hasCardFace(id) || !hasPrintedCard(id)) throw new Error(`hunt art ${id}`);
}
{
  const woodsmanCard = renderUnitCard('en', instanceFromDef('mad-woodsman', 1, 'mwArt'));
  if (!usesPrintedCardFace('mad-woodsman') || !woodsmanCard.includes('printed-card') || woodsmanCard.includes('is-hunt-card')) {
    throw new Error('mad woodsman printed hunt card');
  }
}
if (shopStickers().some((s) => s.id === 'endless-hunger')) throw new Error('hunger in shop');
{
  const bite = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('farm-boy', 1, 'ap1'), 'endless-hunger')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'apFoe')],
    }),
    19,
  );
  if (!bite.events.some((e) => e.type === 'UnitDied' && e.unitId === 'enemy:apFoe')) {
    throw new Error('hunger should get a kill');
  }
  if (!bite.events.some((e) => e.type === 'StatChanged' && e.unitId === 'player:ap1' && e.stat === 'atk' && e.amount === 2 && e.permanent)) {
    throw new Error('hunger should grow ATK permanently');
  }
  if (bite.events.some((e) => e.type === 'Healed' && e.unitId === 'player:ap1')) {
    throw new Error('hunger should not heal');
  }
}
if (huntStickerFor('mad-woodsman') !== 'woodsmans-axe') throw new Error('woodsman hunt sticker');
if (shopStickers().some((s) => s.id === 'woodsmans-axe')) throw new Error('axe in shop');
{
  const glued = applySticker(instanceFromDef('mad-woodsman', 1, 'axeCard'), 'woodsmans-axe');
  if (computedStats(glued).atk !== 6) throw new Error('axe should print +3 ATK');
  const chop = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('mad-woodsman', 1, 'ap1'), 'woodsmans-axe')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'apFoe'), instanceFromDef('paper-dove', 2, 'apFoe2'), instanceFromDef('paper-dove', 3, 'apFoe3')],
    }),
    21,
  );
  const turnStart = chop.events.findIndex((e) => e.type === 'TurnStarted' && e.unitId === 'player:ap1');
  const turnEnd = chop.events.findIndex((e, i) => i > turnStart && e.type === 'TurnEnded' && e.unitId === 'player:ap1');
  const swings = chop.events
    .slice(turnStart, turnEnd)
    .filter((e) => e.type === 'AttackStarted' && e.unitId === 'player:ap1');
  if (swings.length < 3) throw new Error(`axe kill should attack again and stack, got ${swings.length}`);
}
{
  const silk = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('sprung-mimic', 1, 'skFront'), instanceFromDef('ogre-king', 2, 'skBack')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('purple-widows', 1, 'skWidow'), 'cocoon')],
    }),
    4,
  );
  const wrapAt = silk.events.findIndex(
    (e) => e.type === 'Transformed' && e.fromId === 'ogre-king' && e.unit.defId === 'silk-cocoon',
  );
  const wrapped = silk.events[wrapAt];
  if (!wrapped || wrapped.type !== 'Transformed' || !wrapped.combat || wrapped.unit.hp !== 13) {
    throw new Error(`widow should wrap the survivor hp=${wrapped && wrapped.type === 'Transformed' ? wrapped.unit.hp : 'none'}`);
  }
  const cocoonCard = renderBattleCard('en', wrapped.unit);
  if (cocoonCard.includes('Taunt') || cocoonCard.includes('Same HP')) {
    throw new Error('a plain cocoon should not show Taunt or the HP line');
  }
  const bossCard = renderBattleCard('en', { ...wrapped.unit, provoke: true });
  if (!bossCard.includes('Taunt') || bossCard.includes('Same HP')) {
    throw new Error('boss-granted cocoon should show Taunt and not the HP line');
  }
  const cocoonCardIt = renderBattleCard('it', wrapped.unit);
  if (cocoonCardIt.includes('Taunt') || cocoonCardIt.includes('Stessi HP')) {
    throw new Error('plain cocoon IT should not show Taunt or the HP line');
  }
  const bossCardIt = renderBattleCard('it', { ...wrapped.unit, provoke: true });
  if (!bossCardIt.includes('Taunt') || bossCardIt.includes('Stessi HP')) {
    throw new Error('boss-granted cocoon IT should show Taunt and not the HP line');
  }
  if (!silk.events.some((e, i) => i > wrapAt && e.type === 'TauntGranted' && e.unitId === wrapped.unit.uid)) {
    throw new Error('widow ability should grant Taunt after the cocoon forms');
  }
  const pulled = silk.events.find(
    (e, i) =>
      i > wrapAt && e.type === 'SwitchedSides' && e.unitId === 'player:skBack' && e.team === 'enemy' && e.slot === 1,
  );
  if (!pulled) throw new Error('cocoon should move to the widow slot 1');
  if (!silk.events.some((e) => e.type === 'MovedForward' && e.unitId === 'enemy:skWidow' && e.toSlot === 2)) {
    throw new Error('widow should step back to slot 2');
  }
  const sneak = silk.events.find(
    (e, i) => i > wrapAt && e.type === 'AttackStarted' && e.unitId === 'player:skFront',
  );
  if (!sneak || sneak.type !== 'AttackStarted' || sneak.targetId !== 'player:skBack') {
    throw new Error('taunt should pull the sneak onto the cocoon');
  }
  const sneakAt = silk.events.indexOf(sneak);
  const back = silk.events.find(
    (e, i) => i > sneakAt && e.type === 'Transformed' && e.fromId === 'silk-cocoon' && e.unit.defId === 'ogre-king',
  );
  if (!back || back.type !== 'Transformed' || back.unit.atk !== 6 || back.unit.hp !== 9) {
    throw new Error(
      `cocoon should come back when damaged hp/atk=${back && back.type === 'Transformed' ? `${back.unit.hp}/${back.unit.atk}` : 'none'}`,
    );
  }
  const backAt = silk.events.indexOf(back);
  if (silk.events.some((e, i) => i > sneakAt && i < backAt && e.type === 'TurnEnded' && e.unitId === 'player:skBack')) {
    throw new Error('cocoon should transform back when it takes damage');
  }
  if (
    !silk.events.some(
      (e, i) => i > backAt && e.type === 'SwitchedSides' && e.unitId === 'player:skBack' && e.team === 'player',
    )
  ) {
    throw new Error('living cocoon should return to its own field');
  }
  const slain = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('paper-dove', 1, 'skDove')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('purple-widows', 1, 'skWidow'), 'cocoon')],
    }),
    5,
  );
  if (slain.events.some((e) => e.type === 'Transformed' && e.unit.defId === 'silk-cocoon')) {
    throw new Error('a killing blow should not leave a cocoon');
  }
  const gate = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'skA'), instanceFromDef('ogre-king', 2, 'skB')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('purple-widows', 1, 'skW1'), 'cocoon'), applySticker(instanceFromDef('purple-widows', 2, 'skW2'), 'cocoon')],
    }),
    6,
  );
  const homeAgain = gate.events.findIndex((e) => e.type === 'Transformed' && e.fromId === 'silk-cocoon');
  const spun = gate.events
    .slice(0, homeAgain < 0 ? gate.events.length : homeAgain)
    .filter((e) => e.type === 'Transformed' && e.unit.defId === 'silk-cocoon');
  if (spun.length !== 1) throw new Error(`only one cocoon while one is out, got ${spun.length}`);
  const wiped = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('farm-boy', 1, 'lastBoy')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [applySticker(instanceFromDef('purple-widows', 1, 'soloWidow'), 'cocoon')],
    }),
    11,
  );
  if (wiped.winner !== 'enemy' || wiped.durationCycles >= 48 || wiped.timedOut) {
    throw new Error(`cocooning the last figure should end the scrap winner=${wiped.winner} cycles=${wiped.durationCycles}`);
  }
  const held = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [
        applySticker(instanceFromDef('hunter', 1, 'wrap'), 'cocoon'),
        instanceFromDef('paper-dove', 2, 'dove'),
      ],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('ogre-king', 1, 'ogFront'), instanceFromDef('ogre-king', 2, 'ogBack')],
    }),
    8,
  );
  const playerCocoon = held.events.find((e) => e.type === 'Transformed' && e.unit.defId === 'silk-cocoon');
  if (!playerCocoon || playerCocoon.type !== 'Transformed' || playerCocoon.unit.team !== 'enemy' || playerCocoon.unit.provoke) {
    throw new Error('a player sticker should leave a plain cocoon on the enemy side');
  }
  if (held.events.some((e) => e.type === 'TauntGranted' || (e.type === 'SwitchedSides' && e.unitId === playerCocoon.unit.uid))) {
    throw new Error('a player sticker should not grant Taunt or pull the cocoon');
  }
  const doveHit = held.events.find((e) => e.type === 'AttackStarted' && e.unitId === 'player:dove');
  if (!doveHit || doveHit.type !== 'AttackStarted' || doveHit.targetId !== 'enemy:ogBack') {
    throw new Error(`sneak should ignore a plain cocoon and hit the back, got ${doveHit && doveHit.type === 'AttackStarted' ? doveHit.targetId : 'none'}`);
  }
}

let ev = createRun('ai', 'tester', 'Event Mae', 0xee11);
for (const id of ev.draftOffers.slice(0, 2)) ev = toggleDraftPick(ev, id);
ev = confirmDraft(ev);
if (ev.phase === 'stickerAssign') ev = skipStickers(ev);
ev = resolveFight(ev, buildOpponent(1, mixSeed(0xee11, 1, 99), 0.6));
ev = afterResult(ev);
const base = { ...ev, alleyDone: ['recruit' as const] };
{
  let huntDie: RunState = {
    ...base,
    phase: 'event',
    eventId: 'monster-hunt',
    eventStep: 'preview',
    huntMonsterId: 'greed-fang',
    team: [instanceFromDef('cursed-doll', 1, 'hd1')],
  };
  huntDie = resolveHuntFight(huntDie);
  const huntDead = huntDie.lastBonusBattle?.events.some((e) => e.type === 'UnitDied' && e.unitId === 'player:hd1');
  if (!huntDead) throw new Error('hunt exhaust fixture should die');
  if (huntDie.team.some((u) => u.instanceId === 'hd1')) throw new Error('hunt death should exhaust');
}
ev = { ...base, phase: 'event', eventId: 'monster-hunt', eventStep: 'preview', huntMonsterId: 'thousand-maws' };
ev = resolveHuntFight(ev);
{
  const maws = ev.lastBonusBattle?.events.find((e) => e.type === 'UnitSpawned' && e.unit.defId === 'thousand-maws');
  if (!maws || maws.type !== 'UnitSpawned' || !maws.unit.stickers.includes('endless-hunger') || maws.unit.atk !== 5 || maws.unit.speed !== 8) {
    throw new Error('maws should enter with endless hunger, 5 ATK, speed 8');
  }
}
{
  const wood = resolveHuntFight({
    ...base,
    phase: 'event',
    eventId: 'monster-hunt',
    eventStep: 'preview',
    huntMonsterId: 'mad-woodsman',
    round: 8,
    team: [instanceFromDef('cursed-doll', 1, 'wd1')],
  });
  const spawned = wood.lastBonusBattle?.events.find((e) => e.type === 'UnitSpawned' && e.unit.defId === 'mad-woodsman');
  if (!spawned || spawned.type !== 'UnitSpawned' || !spawned.unit.stickers.includes('woodsmans-axe') || spawned.unit.atk !== 9) {
    throw new Error('woodsman should enter with his axe, 9 ATK');
  }
}
ev = claimHunt(ev);
if (ev.lastBonusBattle?.winner === 'player') {
  if (ev.phase !== 'stickerAssign' || ev.pendingStickerIds[0] !== 'endless-hunger') throw new Error('hunt-win-sticker');
} else if (ev.phase !== 'formation' || ev.pendingStickerIds.length) {
  throw new Error('hunt-lose-reward');
}

{
  let oven: RunState = {
    ...base,
    phase: 'event',
    eventId: 'witch-oven',
    eventStep: 'preview',
    team: [applySticker(instanceFromDef('farm-boy', 1, 'ov1'), 'fur-armor'), instanceFromDef('hunter', 2, 'ov2')],
  };
  oven = eventSelectUnit(oven, 'ov1');
  if (oven.phase !== 'stickerAssign' || oven.pendingStickerIds[0] !== 'fur-armor' || oven.team.some((u) => u.instanceId === 'ov1')) {
    throw new Error(`oven failed phase=${oven.phase} step=${oven.eventStep} pending=${oven.pendingStickerIds.join(',')}`);
  }
  oven = assignPendingSticker(oven, 'ov2');
  if (oven.phase !== 'formation' || !oven.team.some((u) => u.instanceId === 'ov2' && u.stickerIds.includes('fur-armor'))) {
    throw new Error(`oven apply failed phase=${oven.phase}`);
  }
}

{
  let ovenDup: RunState = {
    ...base,
    phase: 'event',
    eventId: 'witch-oven',
    eventStep: 'preview',
    team: [
      { ...applySticker(instanceFromDef('farm-boy', 1, 'od1'), 'fur-armor'), stickerIds: ['fur-armor', 'fur-armor'] },
      instanceFromDef('hunter', 2, 'od2'),
    ],
  };
  ovenDup = eventSelectUnit(ovenDup, 'od1');
  if (ovenDup.phase !== 'stickerAssign' || ovenDup.pendingStickerIds.join(',') !== 'fur-armor,fur-armor') {
    throw new Error(`oven dup pending=${ovenDup.pendingStickerIds.join(',')}`);
  }
  ovenDup = assignPendingSticker(ovenDup, 'od2', undefined, 'fur-armor', { settle: false });
  if (ovenDup.phase !== 'stickerAssign' || ovenDup.pendingStickerIds.join(',') !== 'fur-armor') {
    throw new Error(`oven dup after one phase=${ovenDup.phase} pending=${ovenDup.pendingStickerIds.join(',')}`);
  }
  ovenDup = assignPendingSticker(ovenDup, 'od2', undefined, 'fur-armor');
  const glued = ovenDup.team.find((u) => u.instanceId === 'od2')?.stickerIds.filter((id) => id === 'fur-armor').length;
  if (ovenDup.phase !== 'formation' || glued !== 2) {
    throw new Error(`oven dup apply-all phase=${ovenDup.phase} glued=${glued}`);
  }
}

{
  let clone: RunState = {
    ...base,
    phase: 'event',
    eventId: 'cloning-chamber',
    eventStep: 'preview',
    team: [applySticker(instanceFromDef('farm-boy', 1, 'cl1'), 'fur-armor')],
  };
  clone = eventSelectUnit(clone, 'cl1');
  if (clone.phase !== 'event' || clone.eventStep !== 'reward-unit' || clone.team.length !== 1) {
    throw new Error(`clone reward step phase=${clone.phase} step=${clone.eventStep} n=${clone.team.length}`);
  }
  const offer = eventUnitReward(clone);
  if (!offer || offer.defId !== 'farm-boy' || offer.stickerIds.length) {
    throw new Error(`clone offer bad stk=${offer?.stickerIds.join(',')}`);
  }
  clone = placeEventUnit(clone, 2);
  if (clone.phase !== 'formation' || clone.team.length !== 2) {
    throw new Error(`clone place phase=${clone.phase} n=${clone.team.length}`);
  }
  const copy = clone.team.find((u) => u.instanceId !== 'cl1');
  if (!copy || copy.stickerIds.length) throw new Error('clone copy kept stickers');
}

{
  let book: RunState = {
    ...base,
    phase: 'event',
    eventId: 'book-of-lost-tales',
    eventStep: 'book-kind',
    losses: 3,
    team: [instanceFromDef('farm-boy', 1, 'bk1')],
  };
  book = pickEventKind(book, 'unit');
  if (book.phase !== 'event' || book.eventStep !== 'reward-unit' || book.team.length !== 1) {
    throw new Error(`book unit failed phase=${book.phase} step=${book.eventStep} n=${book.team.length}`);
  }
  const offer = eventUnitReward(book);
  if (!offer || getUnit(offer.defId).rarity !== 'gold') {
    throw new Error(`book rarity ${offer ? getUnit(offer.defId).rarity : 'none'}`);
  }
  book = placeEventUnit(book, 2);
  if (book.phase !== 'formation' || book.team.length !== 2) throw new Error(`book place phase=${book.phase}`);
}

{
  const spread = ensureBookOffers({
    ...base,
    phase: 'event',
    eventId: 'book-of-lost-tales',
    eventStep: 'book-kind',
    losses: 2,
    eventOffers: [],
    team: [instanceFromDef('farm-boy', 1, 'bk2')],
  });
  const unitId = spread.eventOffers.find((o) => o.startsWith('book-unit:'))?.slice('book-unit:'.length);
  const stickerId = spread.eventOffers.find((o) => o.startsWith('book-sticker:'))?.slice('book-sticker:'.length);
  if (!unitId || getUnit(unitId).rarity !== 'silver') throw new Error(`book spread unit ${unitId}`);
  if (!stickerId || getSticker(stickerId).rarity !== 'silver') throw new Error(`book spread sticker ${stickerId}`);
  const taken = pickEventKind(spread, 'sticker');
  if (!taken.pendingStickerIds.includes(stickerId)) throw new Error(`book took ${taken.pendingStickerIds.join(',')}`);
  const fullBook = ensureBookOffers({
    ...spread,
    team: [
      applySticker(
        applySticker(applySticker(instanceFromDef('farm-boy', 1, 'bkFull'), 'fur-armor'), 'rusty-knife'),
        'trash',
      ),
    ],
  });
  const bookSticker = fullBook.eventOffers.find((o) => o.startsWith('book-sticker:'))?.slice('book-sticker:'.length);
  if (!bookSticker) throw new Error('book sticker missing');
  if (claimBookSticker(fullBook, 'bkFull') !== fullBook) throw new Error('a full book target should wait for a choice');
  const swapped = claimBookSticker(fullBook, 'bkFull', 1);
  const host = swapped.team.find((u) => u.instanceId === 'bkFull');
  if (!host || host.stickerIds[1] !== bookSticker || host.stickerIds[0] !== 'fur-armor' || host.stickerIds[2] !== 'trash') {
    throw new Error(`book replace stk=${host?.stickerIds.join(',')}`);
  }
}

{
  let wellUnit: RunState = {
    ...base,
    phase: 'event',
    eventId: 'wishing-well',
    eventStep: 'well-kind',
    team: [instanceFromDef('farm-boy', 1, 'wu1'), instanceFromDef('hunter', 2, 'wu2')],
  };
  wellUnit = eventSelectUnit(wellUnit, 'wu1');
  if (wellUnit.phase !== 'recruit' || wellUnit.recruitOffers.length !== 1 || wellUnit.team.some((u) => u.instanceId === 'wu1')) {
    throw new Error(`well unit sacrifice phase=${wellUnit.phase} offers=${wellUnit.recruitOffers.length}`);
  }
  const wellOffer = wellUnit.recruitOffers[0];
  if (!wellOffer || getUnit(wellOffer).rarity !== 'silver') {
    throw new Error(`well unit rarity ${wellOffer ? getUnit(wellOffer).rarity : 'none'}`);
  }
  wellUnit = skipRecruit(wellUnit);
  if (wellUnit.phase === 'event' || wellUnit.phase === 'recruit' || wellUnit.team.length !== 1) {
    throw new Error(`well skip phase=${wellUnit.phase} n=${wellUnit.team.length}`);
  }
}

{
  // Event rewards must close the event, never the Market Square recruit plate.
  let fresh = createRun('ai', 'tester', 'Alley', 0x51);
  fresh = {
    ...fresh,
    phase: 'postFight',
    alleyDone: [],
    eventId: 'wishing-well',
    eventStep: null,
    round: 2,
    team: [instanceFromDef('hunter', 1, 'h1')],
  };
  let well = beginEvent(fresh);
  well = pickEventKind(well, 'unit');
  well = eventSelectUnit(well, 'h1');
  well = skipRecruit(well);
  if (well.phase !== 'postFight' || well.alleyDone.join(',') !== 'event') {
    throw new Error(`well unit marked ${well.alleyDone.join(',')} phase=${well.phase}`);
  }

  let stick = beginEvent({
    ...fresh,
    team: [applySticker(instanceFromDef('hunter', 1, 'h2'), 'fur-armor')],
  });
  stick = pickEventKind(stick, 'sticker');
  stick = eventSelectSticker(stick, 'h2', 'fur-armor');
  stick = skipStickers(stick);
  if (stick.phase !== 'postFight' || stick.alleyDone.join(',') !== 'event') {
    throw new Error(`well sticker marked ${stick.alleyDone.join(',')} phase=${stick.phase}`);
  }

  let oven = beginEvent({
    ...fresh,
    eventId: 'witch-oven',
    team: [applySticker(instanceFromDef('hunter', 1, 'h3'), 'fur-armor')],
  });
  oven = eventSelectUnit(oven, 'h3');
  oven = skipStickers(oven);
  if (oven.phase !== 'postFight' || oven.alleyDone.join(',') !== 'event') {
    throw new Error(`oven sticker marked ${oven.alleyDone.join(',')} phase=${oven.phase}`);
  }

  let shop = chooseAlley({ ...fresh, eventId: 'wishing-well' }, 'recruit');
  if (shop.phase !== 'recruit' || recruitPickLimit(shop.recruitPicks, shop.eventId, shop.eventStep) !== 2) {
    throw new Error(`well plate should not cap recruit phase=${shop.phase} step=${shop.eventStep}`);
  }
  if (recruitPickLimit([], 'wishing-well', 'reward') !== 1) throw new Error('well reward should stay one figure');
  shop = skipRecruit(shop);
  if (shop.phase !== 'postFight' || shop.alleyDone.join(',') !== 'recruit') {
    throw new Error(`recruit shop marked ${shop.alleyDone.join(',')} phase=${shop.phase}`);
  }

  let gift = chooseAlley({ ...fresh, eventId: 'witch-oven', team: [] }, 'recruit');
  gift = { ...gift, recruitOffers: ['farm-boy'], recruitPicks: [] };
  gift = placeRecruit(gift, 'farm-boy', 1);
  gift = finishRecruit(gift);
  if (gift.phase !== 'stickerAssign') throw new Error(`farm gift phase=${gift.phase}`);
  gift = skipStickers(gift);
  if (gift.phase !== 'postFight' || gift.alleyDone.join(',') !== 'recruit') {
    throw new Error(`recruit gift marked ${gift.alleyDone.join(',')} phase=${gift.phase}`);
  }
}

{
  let well: RunState = {
    ...base,
    phase: 'event',
    eventId: 'wishing-well',
    eventStep: 'well-kind',
    team: [applySticker(instanceFromDef('farm-boy', 1, 'wl1'), 'hearth-spirit')],
  };
  well = eventSelectSticker(well, 'wl1', 'hearth-spirit');
  if (well.phase !== 'stickerAssign' || getSticker(well.pendingStickerIds[0]!).rarity !== 'diamond') {
    throw new Error(`well pick phase=${well.phase} rar=${well.pendingStickerIds[0] && getSticker(well.pendingStickerIds[0]!).rarity}`);
  }
}

{
  let pick: RunState = { ...base, phase: 'postFight', eventId: 'monster-hunt', eventStep: null, huntMonsterId: 'thousand-maws' };
  pick = beginEvent(pick);
  if (pick.eventId !== 'monster-hunt' || pick.eventStep !== 'hunt-lineup' || pick.huntMonsterId !== 'thousand-maws') {
    throw new Error('event begin hunt');
  }
  let wellStart: RunState = { ...base, phase: 'postFight', eventId: 'wishing-well', eventStep: null };
  wellStart = beginEvent(wellStart);
  if (wellStart.eventId !== 'wishing-well' || wellStart.eventStep !== 'preview') {
    throw new Error('event begin well');
  }
}
console.log('OK event smoke');

{
  // Cards that will never hit each other end as a draw before the first turn.
  const more = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'a1'), instanceFromDef('village-fool', 2, 'a2')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'b1')],
    }),
    11,
  );
  if (more.winner !== 'draw' || more.durationCycles !== 0 || more.events.some((e) => e.type === 'TurnStarted')) {
    throw new Error(`pacifist stall win=${more.winner} cycles=${more.durationCycles}`);
  }

  const tied = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('old-gatekeeper', 1, 'g1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'f1')],
    }),
    13,
  );
  if (tied.winner !== 'draw' || tied.durationCycles !== 0) {
    throw new Error(`pacifist tie win=${tied.winner} cycles=${tied.durationCycles}`);
  }

  const quiet = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('black-duckling', 1, 'd1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('patchwork-monster', 1, 'm1')],
    }),
    3,
  );
  if (quiet.winner !== 'draw' || quiet.durationCycles !== 0) {
    throw new Error(`zero-atk stall win=${quiet.winner} cycles=${quiet.durationCycles}`);
  }

  const flock = simulateBattle(
    makeSnapshot({
      playerId: 'p',
      playerName: 'p',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('flock-of-ravens', 1, 'r1')],
    }),
    makeSnapshot({
      playerId: 'e',
      playerName: 'e',
      runId: 'r',
      round: 1,
      team: [instanceFromDef('village-fool', 1, 'f2')],
    }),
    5,
  );
  if (flock.winner !== 'player' || flock.durationCycles === 0) {
    throw new Error(`flock should still fight win=${flock.winner} cycles=${flock.durationCycles}`);
  }
}
console.log('OK pacifist stalemate');

const run = autoPlayRun(0x51a711);
if (run.phase !== 'final' || run.history.length !== 10) {
  throw new Error(`autoplay failed phase=${run.phase} hist=${run.history.length}`);
}
if (!run.circuit || run.circuit.length !== 9) throw new Error('circuit should be you plus 9');
{
  const names = new Set([run.playerName, ...run.circuit.map((rival) => rival.playerName)]);
  if (names.size !== 10) throw new Error('circuit names should be ten distinct players');
  const firstNine = run.history.slice(0, 9).map((h) => h.opponentId);
  if (firstNine.join('|') !== run.circuit.map((rival) => rival.playerId).join('|')) {
    throw new Error('the first nine scraps should meet each rival once');
  }
  const rematch = run.history[9]?.opponentId;
  if (!run.circuit.some((rival) => rival.playerId === rematch)) throw new Error('round 10 should be a rematch');
  for (const rival of run.circuit) {
    if (rival.wins + rival.losses + rival.draws !== 10) {
      throw new Error(`rival ${rival.playerName} played ${rival.wins + rival.losses + rival.draws} scraps`);
    }
  }
}
console.log(`OK deterministic + autoplay ${run.wins}/10`);
