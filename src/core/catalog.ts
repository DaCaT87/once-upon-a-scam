import { STICKER_BY_ID, grantableStickers, shopStickers } from '../data/stickers';
import { UNIT_BY_ID, lampUnits, recruitableUnits, unitsByRarity } from '../data/units';
import { RARITY_ORDER, nextShopRarity, rarityForRound, recruitRarityMix, shopMaxRarity, stickerRarityMix } from '../data/rarity';
import type {
  AbilityDef,
  AbilityTiming,
  Passives,
  Rarity,
  StickerDef,
  TargetingType,
  UnitDef,
  UnitInstance,
  SnapshotUnit,
  TeamSnapshot,
} from './types';
import { DATA_VERSION, DRAFT_PICK, MAX_TEAM, SIMULATOR_VERSION } from './types';
import type { SeededRng } from './rng';
import { SeededRng as Rng, hashString } from './rng';
import { detId } from './ids';

export function getUnit(id: string): UnitDef {
  const u = UNIT_BY_ID.get(id);
  if (!u) throw new Error(`Unknown unit: ${id}`);
  return u;
}

export function getSticker(id: string) {
  const s = STICKER_BY_ID.get(id);
  if (!s) throw new Error(`Unknown sticker: ${id}`);
  return s;
}

/** ATK, Speed, and current HP cannot go below 0. Max HP stays at least 1. */
export function clampStat(stat: 'atk' | 'speed' | 'hp' | 'maxHp', value: number): number {
  if (stat === 'maxHp') return Math.max(1, value);
  return Math.max(0, value);
}

export function mirrorStacks(inst: UnitInstance | SnapshotUnit): number {
  return inst.stickerIds.filter((id) => getSticker(id).passives?.doubleStats).length;
}

export function hasDoubleStats(inst: UnitInstance | SnapshotUnit): boolean {
  return mirrorStacks(inst) > 0;
}

export function stickerEffectScale(_inst: UnitInstance | SnapshotUnit, _stickerId: string): number {
  return 1;
}

export function scaleStickerAbility(ab: AbilityDef, n: number): AbilityDef {
  if (n === 1) return ab;
  return { ...ab, effects: ab.effects.map((op) => scaleStickerOp(op, n)) };
}

function scaleStickerOp(op: AbilityDef['effects'][number], n: number): AbilityDef['effects'][number] {
  switch (op.op) {
    case 'modStat':
    case 'damage':
    case 'heal':
    case 'stealStat':
    case 'modRandomStat':
      return { ...op, amount: op.amount * n };
    case 'poison':
      return { ...op, stacks: op.stacks * n };
    case 'shield':
      return { ...op, charges: op.charges * n };
    default:
      return op;
  }
}

export type StatContext = { stickersGained?: number; deathsThisRun?: number };

export function computedStats(
  inst: UnitInstance | SnapshotUnit,
  ctx?: StatContext,
): { atk: number; hp: number; speed: number } {
  const def = getUnit(inst.defId);
  let atk = def.atk + inst.permanentMods.atk;
  let hp = def.hp + inst.permanentMods.hp;
  let speed = def.speed + inst.permanentMods.speed;
  for (const sid of inst.stickerIds) {
    const st = getSticker(sid);
    atk += st.statMods?.atk ?? 0;
    hp += st.statMods?.hp ?? 0;
    speed += st.statMods?.speed ?? 0;
  }
  const per = def.passives?.perStickerGained;
  const gained = ctx?.stickersGained ?? 0;
  if (per && gained > 0) {
    atk += (per.atk ?? 0) * gained;
    hp += (per.hp ?? 0) * gained;
  }
  const perDeath = def.passives?.atkPerGameDeath ?? 0;
  if (perDeath && (ctx?.deathsThisRun ?? 0) > 0) {
    atk += perDeath * (ctx!.deathsThisRun ?? 0);
  }
  const triple = Boolean(def.passives?.buffTriple);
  const mirrors = mirrorStacks(inst);
  const mirror = mirrors > 0 ? 2 ** mirrors : 1;
  // Each Mirror, Mirror doubles the card. Chimps then ×3.
  if (mirrors && triple) {
    atk *= mirror * 3;
    hp *= mirror * 3;
    speed *= mirror * 3;
  } else {
    if (triple) {
      const extraAtk = atk - def.atk - inst.permanentMods.atk;
      const extraHp = hp - def.hp - inst.permanentMods.hp;
      const extraSpeed = speed - def.speed - inst.permanentMods.speed;
      atk = def.atk + inst.permanentMods.atk + (extraAtk > 0 ? extraAtk * 3 : extraAtk);
      hp = def.hp + inst.permanentMods.hp + (extraHp > 0 ? extraHp * 3 : extraHp);
      speed = def.speed + inst.permanentMods.speed + (extraSpeed > 0 ? extraSpeed * 3 : extraSpeed);
    }
    if (mirrors) {
      atk *= mirror;
      hp *= mirror;
      speed *= mirror;
    }
  }
  return { atk: clampStat('atk', atk), hp: clampStat('maxHp', hp), speed: clampStat('speed', speed) };
}

export function mergePassives(inst: UnitInstance | SnapshotUnit): Passives {
  const def = getUnit(inst.defId);
  const out: Passives = { ...def.passives };
  for (const sid of inst.stickerIds) {
    const p = getSticker(sid).passives;
    if (!p) continue;
    out.thorns = (out.thorns ?? 0) + (p.thorns ?? 0);
    out.lifesteal = (out.lifesteal ?? 0) + (p.lifesteal ?? 0);
    out.provoke = Boolean(out.provoke || p.provoke);
    out.guardian = Boolean(out.guardian || p.guardian);
    out.ignoreProvoke = Boolean(out.ignoreProvoke || p.ignoreProvoke);
    out.firstHitReduce = (out.firstHitReduce ?? 0) + (p.firstHitReduce ?? 0);
    out.buffTriple = Boolean(out.buffTriple || p.buffTriple);
    out.evade = Boolean(out.evade || p.evade);
    out.evadeReflect = Boolean(out.evadeReflect || p.evadeReflect);
    out.drunkChance = Math.max(out.drunkChance ?? 0, p.drunkChance ?? 0);
    out.steadfast = Boolean(out.steadfast || p.steadfast);
    out.bonusIfTargetHigherAtk = (out.bonusIfTargetHigherAtk ?? 0) + (p.bonusIfTargetHigherAtk ?? 0);
    out.atkPerTargetSticker = (out.atkPerTargetSticker ?? 0) + (p.atkPerTargetSticker ?? 0);
    out.bonusVsLowHp = (out.bonusVsLowHp ?? 0) + (p.bonusVsLowHp ?? 0);
    out.cheatDeath = Boolean(out.cheatDeath || p.cheatDeath);
    out.reflectDamageTaken = Boolean(out.reflectDamageTaken || p.reflectDamageTaken);
    out.doubleStats = Boolean(out.doubleStats || p.doubleStats);
    out.healBelowHalf = (out.healBelowHalf ?? 0) + (p.healBelowHalf ?? 0);
    out.extraAttacks = (out.extraAttacks ?? 0) + (p.extraAttacks ?? 0);
    out.extraAttacksIfLostLastRound = (out.extraAttacksIfLostLastRound ?? 0) + (p.extraAttacksIfLostLastRound ?? 0);
    out.heartseeker = Boolean(out.heartseeker || p.heartseeker);
    out.curseAtk = (out.curseAtk ?? 0) + (p.curseAtk ?? 0);
    out.teamActsFirst = Boolean(out.teamActsFirst || p.teamActsFirst);
    out.silence = Boolean(out.silence || p.silence);
  }
  return out;
}

function timingFromAbility(ability: AbilityDef): AbilityTiming | null {
  if (ability.trigger === 'afterAttack' && (ability.once || ability.condition?.kind === 'firstAttack')) {
    return 'firstAttack';
  }
  switch (ability.trigger) {
    case 'onDeath':
      return 'onDeath';
    case 'battleStart':
      return 'battleStart';
    case 'afterAttack':
      return 'afterAttack';
    case 'allyDied':
      return 'allyDied';
    case 'anyDied':
      return 'anyDied';
    case 'unitKilled':
      return 'onKill';
    case 'damageReceived':
      return 'whenHit';
    case 'onRecruit':
      return 'onRecruit';
    case 'onApply':
      return 'onSticker';
    case 'battleEnded':
      return 'battleEnd';
    case 'scrapEnded':
      return 'scrapEnd';
    case 'turnEnded':
      return 'turnEnd';
    case 'turnStarted':
      return 'turnStart';
    case 'whenTargeted':
      if (ability.effects.length === 1 && ability.effects[0]?.op === 'ambush') return null;
      return 'whenAttacked';
    case 'beforeAttack':
    case 'attackStarted':
      return 'onAttack';
    case 'damageDealt':
      return 'onHit';
    default:
      return null;
  }
}

function timingFromPassives(passives?: Passives): AbilityTiming | null {
  if (!passives) return null;
  if (passives.lifesteal || passives.bonusIfTargetHigherAtk || passives.atkPerTargetSticker || passives.curseAtk) return 'onAttack';
  if (passives.thorns || passives.firstHitReduce || passives.reflectDamageTaken) return 'whenHit';
  if (passives.silence || passives.teamActsFirst) return 'battleStart';
  if (passives.championAtk) return 'onAttack';
  if (passives.eatStickers || passives.shareStickerOnApply) return 'onSticker';
  return null;
}

export function resolveAbilityTiming(source: UnitDef | StickerDef): AbilityTiming | null {
  if (source.passives?.guardian) return null;
  if (
    !source.ability &&
    source.passives?.provoke &&
    source.passives?.thorns &&
    !source.passives.firstHitReduce
  ) {
    return null;
  }
  if (source.ability) return timingFromAbility(source.ability);
  return timingFromPassives(source.passives);
}

export function assertAbilityTiming(): void {
  const units: Array<[string, AbilityTiming | null]> = [
    ['frog-prince', 'battleStart'],
    ['the-egg', 'battleEnd'],
    ['three-little-pigs', null],
    ['woodland-girl', 'onKill'],
    ['gingerbread-man', null],
    ['tiny-brave-mouse', 'onAttack'],
    ['vampire-bat', 'onHit'],
    ['black-duckling', 'whenHit'],
    ['black-duck', null],
    ['pied-piper', 'onHit'],
    ['little-fairy', 'turnStart'],
    ['cobblers-elves', 'whenHit'],
    ['magic-mirror', null],
    ['village-fool', null],
    ['puss-in-boots', 'onAttack'],
    ['drunken-giant', null],
    ['tin-soldier', 'onDeath'],
    ['wax-knight', 'turnEnd'],
    ['farm-boy', 'onRecruit'],
    ['jack-in-the-box', null],
    ['sprung-jack', null],
    ['happy-rat', 'onSticker'],
    ['hunter', 'onKill'],
    ['witch-hunter', 'onAttack'],
    ['headless-horseman', 'onKill'],
    ['patchwork-princess', 'onSticker'],
    ['sir-forget-a-lot', 'scrapEnd'],
    ['royal-herald', 'onRecruit'],
    ['cursed-doll', 'whenHit'],
    ['miss-misfortune', null],
    ['glass-knight', 'onDeath'],
    ['scary-scarecrow', 'onAttack'],
    ['old-gatekeeper', null],
    ['wish-pinata', 'onDeath'],
    ['aladdin', 'onAttack'],
    ['patchwork-monster', 'anyDied'],
    ['golden-goose', 'battleEnd'],
    ['giving-tree', 'turnStart'],
    ['ice-king', 'battleStart'],
    ['sandman', 'turnStart'],
    ['mimic', null],
    ['sprung-mimic', null],
    ['the-collector', null],
    ['phoenix', 'onDeath'],
    ['king-of-crows', 'onDeath'],
    ['flock-of-ravens', 'turnEnd'],
    ['miss-d', 'onHit'],
    ['time-master', null],
    ['champion-of-the-arena', 'onAttack'],
    ['black-hole', 'onDeath'],
    ['three-headed-snake', null],
    ['anubis', 'turnStart'],
    ['circe', 'onAttack'],
    ['toxic-frog', 'onAttack'],
    ['prince-charming', null],
    ['big-bad-wolf', 'onKill'],
    ['woken-bear', null],
    ['paper-dove', null],
    ['pig', null],
    ['gingerbread-servant', null],
    ['thousand-maws', 'onKill'],
    ['mad-woodsman', 'onKill'],
    ['sewer-lord', 'battleStart'],
    ['garbage-pile', null],
    ['purple-widows', 'afterAttack'],
    ['greed-fang', 'turnStart'],
    ['ogre-king', null],
  ];
  for (const [id, want] of units) {
    const got = resolveAbilityTiming(getUnit(id));
    if (got !== want) throw new Error(`timing ${id}: got ${got}, want ${want}`);
  }
  const stickers: Array<[string, AbilityTiming | null]> = [
    ['rusty-knife', null],
    ['fur-armor', null],
    ['rabbits-foot', null],
    ['fireball', 'turnStart'],
    ['spiked-shield', 'whenHit'],
    ['life-potion', null],
    ['revenge-bomb', 'onDeath'],
    ['bat-fang', 'onAttack'],
    ['painted-target', null],
    ['silver-plated', 'onSticker'],
    ['steel-sword', null],
    ['butchers-cleave', null],
    ['water-spirit', 'onAttack'],
    ['blood-leech', 'onAttack'],
    ['thiefs-hood', null],
    ['knights-crest', null],
    ['war-banner', 'turnStart'],
    ['lightning-bolt', 'turnStart'],
    ['gold-plated', 'onSticker'],
    ['giant-strength', null],
    ['troll-hide', 'turnEnd'],
    ['shower-of-arrows', 'turnStart'],
    ['bloodied-crown', 'onKill'],
    ['lucky-charm', null],
    ['vampires-appetite', 'onKill'],
    ['heartseeker-arrow', null],
    ['snipers-sight', null],
    ['platinum-plated', 'onSticker'],
    ['hearth-spirit', null],
    ['dragons-breath', 'turnStart'],
    ['ares-helm', 'onKill'],
    ['phoenix-heart', 'onDeath'],
    ['reapers-scythe', 'onHit'],
    ['cursed-armor', 'turnEnd'],
    ['mirror-mirror', null],
    ['diamond-plated', 'onSticker'],
    ['excalibur', null],
    ['void-heart', 'onDeath'],
    ['fire-spirit', 'turnStart'],
    ['endless-hunger', 'onKill'],
    ['dragon-scale', null],
    ['cyclops-eye', null],
    ['spider-silk', null],
    ['ogres-club', null],
    ['woodsmans-axe', 'onKill'],
    ['cocoon', 'onHit'],
    ['mythic-treasure', 'battleStart'],
    ['filth', 'onHit'],
    ['poison', 'turnStart'],
    ['trash', null],
  ];
  for (const [id, want] of stickers) {
    const got = resolveAbilityTiming(getSticker(id));
    if (got !== want) throw new Error(`timing ${id}: got ${got}, want ${want}`);
  }
}

export function resolveTargeting(inst: UnitInstance | SnapshotUnit): TargetingType {
  const def = getUnit(inst.defId);
  let mode: TargetingType = def.targeting;
  for (const sid of inst.stickerIds) {
    const t = getSticker(sid).targeting;
    if (t) mode = t;
  }
  return mode;
}

export function instanceFromDef(defId: string, slot: number, instanceId: string): UnitInstance {
  const def = getUnit(defId);
  return {
    instanceId,
    defId,
    slot,
    stickerIds: [...(def.startingStickers ?? [])],
    permanentMods: { atk: 0, hp: 0, speed: 0 },
  };
}

export function toSnapshotUnit(inst: UnitInstance): SnapshotUnit {
  const def = getUnit(inst.defId);
  const stats = computedStats(inst);
  return {
    instanceId: inst.instanceId,
    defId: inst.defId,
    slot: inst.slot,
    stickerIds: [...inst.stickerIds],
    permanentMods: { ...inst.permanentMods },
    baseStats: { atk: def.atk, hp: def.hp, speed: def.speed },
    currentStats: stats,
  } as SnapshotUnit & { currentStats: { atk: number; hp: number; speed: number } };
}

export function makeSnapshot(args: {
  playerId: string;
  playerName: string;
  runId: string;
  round: number;
  team: UnitInstance[];
  lostLastRound?: boolean;
  lossesThisRun?: number;
  stickersGained?: number;
  deathsThisRun?: number;
}): TeamSnapshot {
  return {
    schemaVersion: 1,
    dataVersion: DATA_VERSION,
    simulatorVersion: SIMULATOR_VERSION,
    playerId: args.playerId,
    playerName: args.playerName,
    runId: args.runId,
    round: args.round,
    units: capTeam(args.team)
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((u) => {
        const def = getUnit(u.defId);
        return {
          instanceId: u.instanceId,
          defId: u.defId,
          slot: u.slot,
          stickerIds: [...u.stickerIds],
          permanentMods: { ...u.permanentMods },
          baseStats: { atk: def.atk, hp: def.hp, speed: def.speed },
        };
      }),
    createdAt: 0,
    lostLastRound: Boolean(args.lostLastRound),
    lossesThisRun: args.lossesThisRun ?? 0,
    stickersGained: args.stickersGained ?? 0,
    deathsThisRun: args.deathsThisRun ?? 0,
  };
}

export function snapshotToTeam(snap: TeamSnapshot): UnitInstance[] {
  return snap.units.map((u) => ({
    instanceId: u.instanceId,
    defId: u.defId,
    slot: u.slot,
    stickerIds: [...u.stickerIds],
    permanentMods: { ...u.permanentMods },
  }));
}

const UNIT_ART_FOLDERS = new Set([
  'frog-prince',
  'the-egg',
  'three-little-pigs',
  'woodland-girl',
  'gingerbread-man',
  'tiny-brave-mouse',
  'black-duckling',
  'black-duck',
  'pied-piper',
  'little-fairy',
  'cobblers-elves',
  'woken-bear',
  'big-bad-wolf',
  'drunken-giant',
  'village-fool',
  'prince-charming',
  'tin-soldier',
  'wax-knight',
  'magic-mirror',
  'farm-boy',
  'puss-in-boots',
  'jack-in-the-box',
  'sprung-jack',
  'happy-rat',
  'hunter',
  'sir-forget-a-lot',
  'scary-scarecrow',
  'miss-misfortune',
  'cursed-doll',
  'glass-knight',
  'headless-horseman',
  'patchwork-princess',
  'patchwork-monster',
  'the-collector',
  'sandman',
  'giving-tree',
  'old-gatekeeper',
  'toxic-frog',
  'royal-herald',
  'wish-pinata',
  'witch-hunter',
  'aladdin',
  'golden-goose',
  'mimic',
  'sprung-mimic',
  'vampire-bat',
  'miss-d',
  'ice-king',
  'champion-of-the-arena',
  'king-of-crows',
  'flock-of-ravens',
  'phoenix',
  'anubis',
  'black-hole',
  'circe',
  'pig',
  'time-master',
  'three-headed-snake',
  'thousand-maws',
  'mad-woodsman',
  'sewer-lord',
  'garbage-pile',
  'purple-widows',
  'silk-cocoon',
  'greed-fang',
]);

export function unitArtFolder(defId: string): string {
  return getUnit(defId).artId ?? defId;
}

export function hasUnitArt(defId: string): boolean {
  return UNIT_ART_FOLDERS.has(unitArtFolder(defId));
}

/** Card-aspect `card.png` face; dossier still uses the full 3:4 `idle.png`. */
const CARD_FACE_FOLDERS = new Set([
  'wax-knight',
  'woken-bear',
  'tin-soldier',
  'woodland-girl',
  'magic-mirror',
  'hunter',
  'village-fool',
  'toxic-frog',
  'cursed-doll',
  'cobblers-elves',
  'old-gatekeeper',
  'tiny-brave-mouse',
  'wish-pinata',
  'glass-knight',
  'headless-horseman',
  'gingerbread-man',
  'prince-charming',
  'witch-hunter',
  'aladdin',
  'golden-goose',
  'royal-herald',
  'mimic',
  'sprung-mimic',
  'jack-in-the-box',
  'sprung-jack',
  'patchwork-monster',
  'the-collector',
  'sandman',
  'giving-tree',
  'sir-forget-a-lot',
  'scary-scarecrow',
  'miss-misfortune',
  'vampire-bat',
  'miss-d',
  'ice-king',
  'black-duck',
  'champion-of-the-arena',
  'king-of-crows',
  'flock-of-ravens',
  'phoenix',
  'anubis',
  'black-hole',
  'circe',
  'time-master',
  'three-headed-snake',
  'thousand-maws',
  'mad-woodsman',
  'sewer-lord',
  'garbage-pile',
  'purple-widows',
  'silk-cocoon',
  'greed-fang',
]);

export function hasCardFace(defId: string): boolean {
  return CARD_FACE_FOLDERS.has(unitArtFolder(defId));
}

const PRINTED_CARD_FOLDERS = new Set([
  'champion-of-the-arena',
  'royal-herald',
  'king-of-crows',
  'flock-of-ravens',
  'circe',
  'miss-d',
  'phoenix',
  'giving-tree',
  'jack-in-the-box',
  'sprung-jack',
  'mimic',
  'sprung-mimic',
  'time-master',
  'three-headed-snake',
  'thousand-maws',
  'mad-woodsman',
  'sewer-lord',
  'purple-widows',
  'silk-cocoon',
  'greed-fang',
]);

export function hasPrintedCard(defId: string): boolean {
  return PRINTED_CARD_FOLDERS.has(unitArtFolder(defId));
}

const FRAMED_HUNT_CARDS = new Set(['thousand-maws', 'purple-widows', 'sewer-lord', 'mad-woodsman', 'greed-fang']);

export function usesPrintedCardFace(defId: string): boolean {
  if (!hasPrintedCard(defId)) return false;
  if (!getUnit(defId).tags.includes('hunt')) return true;
  return FRAMED_HUNT_CARDS.has(unitArtFolder(defId));
}

export function isScenicArt(defId: string): boolean {
  return hasUnitArt(defId);
}

/** Fixed next form when this card becomes / transforms into a known card. */
export function nextFormOf(defId: string): string | null {
  const def = getUnit(defId);
  if (!def.recruitable) return null;
  const ability = def.ability;
  if (!ability) return null;
  const ambush = ability.effects.find((e) => e.op === 'ambush' && e.into);
  if (ambush?.op === 'ambush' && ambush.into) return ambush.into;
  if (ability.target !== 'self') return null;
  const fx = ability.effects.find((e) => e.op === 'transform' && e.unitId);
  return fx?.op === 'transform' && fx.unitId ? fx.unitId : null;
}

const PREV_FORM = new Map<string, string>();
for (const id of UNIT_BY_ID.keys()) {
  const next = nextFormOf(id);
  if (next) PREV_FORM.set(next, id);
}

export function prevFormOf(defId: string): string | null {
  return PREV_FORM.get(defId) ?? null;
}

/** Walk the become/transform chain back to the printed starter form. */
export function baseFormOf(defId: string): string {
  let id = defId;
  const seen = new Set<string>([id]);
  let prev = prevFormOf(id);
  while (prev && !seen.has(prev)) {
    id = prev;
    seen.add(id);
    prev = prevFormOf(id);
  }
  return id;
}

export function stickerArtFile(id: string): string {
  const s = getSticker(id);
  return s.artId ?? s.id;
}

const STICKER_ART_FILES = new Set([
  'rusty-knife',
  'fur-armor',
  'rabbits-foot',
  'fireball',
  'big-hammer',
  'lead-armor',
  'spiked-shield',
  'life-potion',
  'revenge-bomb',
  'bat-fang',
  'painted-target',
  'silver-plated',
  'steel-sword',
  'chain-mail',
  'water-spirit',
  'knights-crest',
  'butchers-cleave',
  'blood-leech',
  'thiefs-hood',
  'war-banner',
  'lightning-bolt',
  'gold-plated',
  'giant-strength',
  'troll-hide',
  'wind-spirit',
  'fire-spirit',
  'shower-of-arrows',
  'bloodied-crown',
  'lucky-charm',
  'vampires-appetite',
  'heartseeker-arrow',
  'snipers-sight',
  'platinum-plated',
  'hearth-spirit',
  'dragons-breath',
  'hermes-boots',
  'ares-helm',
  'phoenix-heart',
  'reapers-scythe',
  'cursed-armor',
  'mirror-mirror',
  'diamond-plated',
  'excalibur',
  'void-heart',
  'endless-hunger',
  'dragon-scale',
  'cyclops-eye',
  'spider-silk',
  'ogres-club',
  'woodsmans-axe',
  'mythic-treasure',
  'trash',
  'poison',
  'filth',
  'cocoon',
]);

export function hasStickerArt(id: string): boolean {
  return STICKER_ART_FILES.has(stickerArtFile(id));
}

export function rollRarity(round: number, rng: SeededRng): Rarity {
  const weights = rarityForRound(round);
  const live = Object.fromEntries(
    (Object.entries(weights) as Array<[Rarity, number]>).filter(([, w]) => w > 0),
  ) as Record<Rarity, number>;
  return rng.weighted(live);
}

function slotsFromMix(mix: Rarity[], count: number, rng: SeededRng): Rarity[] {
  if (count === mix.length) return rng.shuffle([...mix]);
  const out: Rarity[] = [];
  while (out.length < count) out.push(...rng.shuffle([...mix]));
  return out.slice(0, count);
}

function nearestUnitPool(rarity: Rarity, shop: boolean): UnitDef[] {
  const source = shop ? recruitableUnits().filter((u) => u.rarity !== 'diamond') : lampUnits();
  const start = Math.max(0, RARITY_ORDER.indexOf(rarity));
  for (let i = start; i >= 0; i--) {
    if (shop && RARITY_ORDER[i] === 'diamond') continue;
    const pool = source.filter((u) => u.rarity === RARITY_ORDER[i]);
    if (pool.length) return pool;
  }
  for (let i = start + 1; i < RARITY_ORDER.length; i++) {
    if (shop && RARITY_ORDER[i] === 'diamond') continue;
    const pool = source.filter((u) => u.rarity === RARITY_ORDER[i]);
    if (pool.length) return pool;
  }
  return source;
}

export function offerUnits(
  round: number,
  count: number,
  rng: SeededRng,
  exclude: Set<string> = new Set(),
  bumpOne = false,
): string[] {
  const out: string[] = [];
  for (const rarity of slotsFromMix(recruitRarityMix(round), count, rng)) {
    const pool = unitsByRarity(rarity).filter(
      (u) => u.rarity !== 'diamond' && (!exclude.has(u.id) || rng.chance(0.35)),
    );
    const pickFrom = pool.length ? pool : nearestUnitPool(rarity, true);
    if (!pickFrom.length) continue;
    const fresh = pickFrom.filter((u) => !out.includes(u.id));
    const u = rng.pick(fresh.length ? fresh : pickFrom);
    out.push(u.id);
  }
  while (out.length < count) {
    const fallback = rng.pick(recruitableUnits().filter((u) => u.rarity !== 'diamond'));
    out.push(fallback.id);
  }
  if (bumpOne && out.length) {
    const up = offerUnitsOfRarity(nextShopRarity(shopMaxRarity(round)), 1, rng);
    if (up[0]) out[0] = up[0];
  }
  return out.slice(0, count);
}

export function offerStickers(count: number, rng: SeededRng, round?: number): string[] {
  const shop = shopStickers();
  if (round == null) return rng.pickN(shop, count).map((s) => s.id);
  const out: string[] = [];
  for (const rarity of slotsFromMix(stickerRarityMix(round), count, rng)) {
    const pool = shop.filter((s) => s.rarity === rarity && !out.includes(s.id));
    const pickFrom = pool.length ? pool : shop.filter((s) => s.rarity === rarity);
    const any = pickFrom.length ? pickFrom : shop.filter((s) => !out.includes(s.id));
    if (!any.length) break;
    out.push(rng.pick(any).id);
  }
  return out;
}

export function offerUnitsOfRarity(rarity: Rarity, count: number, rng: SeededRng, shop = true): string[] {
  const pool = nearestUnitPool(rarity, shop);
  return rng.pickN(pool, count).map((u) => u.id);
}

export function randomUnitOfRarity(rarity: Rarity, rng: SeededRng, exclude?: string): string | null {
  const shop = rarity !== 'diamond';
  const pool = nearestUnitPool(rarity, shop).filter((u) => u.id !== exclude);
  const exact = pool.filter((u) => u.rarity === rarity);
  const pickFrom = exact.length ? exact : pool;
  if (!pickFrom.length) return null;
  return rng.pick(pickFrom).id;
}

export function offerStickersOfRarity(rarity: Rarity, count: number, rng: SeededRng): string[] {
  const all = grantableStickers();
  const start = Math.max(0, RARITY_ORDER.indexOf(rarity));
  let pool = all.filter((s) => s.rarity === rarity);
  if (!pool.length) {
    for (let i = start; i >= 0; i--) {
      pool = all.filter((s) => s.rarity === RARITY_ORDER[i]);
      if (pool.length) break;
    }
  }
  if (!pool.length) pool = shopStickers();
  return rng.pickN(pool, count).map((s) => s.id);
}

export function eatsStickers(defId: string): boolean {
  return Boolean(getUnit(defId).passives?.eatStickers);
}

export function canAcceptSticker(inst: UnitInstance): boolean {
  return eatsStickers(inst.defId) || inst.stickerIds.length < 3;
}

function onApplyRng(inst: UnitInstance, stickerId: string, rng?: SeededRng): SeededRng {
  return rng ?? new Rng(hashString(`${inst.instanceId}:${stickerId}:${inst.defId}`));
}

function resolveOnApplySticker(inst: UnitInstance, stickerId: string, rng: SeededRng): UnitInstance {
  const st = getSticker(stickerId);
  const ab = st.ability;
  if (!ab || ab.trigger !== 'onApply') return inst;
  let next = inst;
  let transformed = false;
  for (const op of ab.effects) {
    if (op.op === 'transform' && op.randomRarity) {
      const nextId = randomUnitOfRarity(op.randomRarity, rng, next.defId);
      if (nextId && nextId !== next.defId) {
        next = { ...next, defId: nextId };
        transformed = true;
      }
    }
  }
  if (transformed) {
    next = { ...next, stickerIds: next.stickerIds.filter((id) => id !== stickerId) };
  }
  return next;
}

export function applySticker(inst: UnitInstance, stickerId: string, replaceIndex?: number, rng?: SeededRng): UnitInstance {
  const def = getUnit(inst.defId);
  const eat = def.passives?.eatStickers;
  if (eat) {
    void stickerId;
    return {
      ...inst,
      stickerIds: [...inst.stickerIds],
      permanentMods: {
        atk: inst.permanentMods.atk + eat.atk,
        hp: inst.permanentMods.hp + eat.hp,
        speed: inst.permanentMods.speed,
      },
    };
  }
  const next = { ...inst, stickerIds: [...inst.stickerIds], permanentMods: { ...inst.permanentMods } };
  if (next.stickerIds.length < 3) {
    next.stickerIds.push(stickerId);
  } else {
    const idx = replaceIndex ?? 2;
    next.stickerIds[idx] = stickerId;
  }
  return resolveOnApplySticker(next, stickerId, onApplyRng(next, stickerId, rng));
}

export function shareStickerOnApply(
  team: UnitInstance[],
  sourceId: string,
  stickerId: string,
  sourceDefId?: string,
): UnitInstance[] {
  const source = team.find((u) => u.instanceId === sourceId);
  if (!source || !getUnit(sourceDefId ?? source.defId).passives?.shareStickerOnApply) return team;
  const ally = team
    .filter((u) => u.instanceId !== sourceId && canAcceptSticker(u))
    .sort((a, b) => a.slot - b.slot || a.instanceId.localeCompare(b.instanceId))[0];
  if (!ally) return team;
  return team.map((u) => (u.instanceId === ally.instanceId ? applySticker(u, stickerId) : u));
}

export function abilityKey(defId: string): string {
  return `ab.${defId}`;
}

export function cloneTeam(team: UnitInstance[]): UnitInstance[] {
  return team.map((u) => ({
    ...u,
    stickerIds: [...u.stickerIds],
    permanentMods: { ...u.permanentMods },
  }));
}

export function teamBySlot<T extends { slot: number }>(team: T[]): T[] {
  return team.slice().sort((a, b) => a.slot - b.slot);
}

/** Outside scrap: front (slot 1) sits on the right, matching the player scrap row. */
export function teamLaneOrder(): number[] {
  return slotRange().slice().reverse();
}

export function compactSlots<T extends { slot: number }>(team: T[]): T[] {
  return teamBySlot(team).map((u, i) => ({ ...u, slot: i + 1 }));
}

export function slotRange(): number[] {
  return Array.from({ length: MAX_TEAM }, (_, i) => i + 1);
}

/** Field cap. Round 1 is the draft of 2. From round 2 the line can already be 4. */
export function teamSizeForRound(round: number): number {
  return round <= 1 ? DRAFT_PICK : MAX_TEAM;
}

export function firstFreeSlot(team: { slot: number }[]): number {
  const used = new Set(team.map((u) => u.slot));
  return slotRange().find((s) => !used.has(s)) ?? team.length + 1;
}

export function capTeam<T extends { slot: number }>(team: T[], cap = MAX_TEAM): T[] {
  return compactSlots(team).slice(0, Math.max(0, cap));
}

export function assertCompactSlots(): void {
  const packed = compactSlots([{ slot: 5 }, { slot: 1 }, { slot: 3 }]);
  if (packed.map((u) => u.slot).join(',') !== '1,2,3') throw new Error('compact-slots');
  if (teamSizeForRound(1) !== 2 || teamSizeForRound(2) !== 4 || teamSizeForRound(3) !== 4 || teamSizeForRound(10) !== 4) {
    throw new Error('team-size-curve');
  }
  if (capTeam([{ slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }, { slot: 5 }]).length !== 4) {
    throw new Error('cap-team');
  }
}

export function makeAiInstance(defId: string, slot: number, seed: number, i: number): UnitInstance {
  return instanceFromDef(defId, slot, detId('aiu', seed, i));
}
