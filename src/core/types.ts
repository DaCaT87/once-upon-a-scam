export const DATA_VERSION = '1.6.90';
export const SIMULATOR_VERSION = '1.0.6';
export const MAX_TEAM = 4;
export const MAX_STICKERS = 3;
export const RUN_ROUNDS = 10;
export const DRAFT_OFFER = 4;
export const DRAFT_PICK = 2;
export const RECRUIT_OFFER = 4;
export const RECRUIT_PICK = 2;
export const STICKER_OFFER = 3;
export const STICKER_PICK = 1;
export const ALLEY_PICK = 2;

export type Rarity = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type ShopLevel = 1 | 2 | 3 | 4 | 5;
export type AlleyChoice = 'recruit' | 'sticker' | 'event';
export type EventCategory = 'safe' | 'risky' | 'challenge' | 'special';
export type EventId =
  | 'monster-hunt'
  | 'wishing-well'
  | 'witch-oven'
  | 'cloning-chamber'
  | 'book-of-lost-tales';
export type EventStep =
  | 'pick'
  | 'preview'
  | 'hunt-lineup'
  | 'hunt-result'
  | 'well-kind'
  | 'well-sticker'
  | 'well-pick'
  | 'oven-apply'
  | 'book-kind'
  | 'roster-cut'
  | 'reward'
  | 'reward-unit';
export type StickerFamily = 'stat' | 'keyword' | 'trigger' | 'targeting';
export type TeamId = 'player' | 'enemy';
export type RunMode = 'ai' | 'async';
export type DeathStyle = 'flatten' | 'puff' | 'spirit' | 'ink' | 'stars' | 'theatrical';
export type Locale = 'en' | 'it';

/** How a unit picks the target of its basic attack. Not a class or role. */
export type TargetingType = 'brawler' | 'sneak' | 'hitman' | 'pacifist' | 'flock';
export type TargetingMode = TargetingType;

export type TriggerKind =
  | 'battleStart'
  | 'beforeAttack'
  | 'attackStarted'
  | 'damageDealt'
  | 'damageReceived'
  | 'afterAttack'
  | 'unitKilled'
  | 'onDeath'
  | 'allyDied'
  | 'enemyDied'
  | 'anyDied'
  | 'turnStarted'
  | 'turnEnded'
  | 'battleEnded'
  | 'scrapEnded'
  | 'whenTargeted'
  | 'onRecruit'
  | 'onApply';

/** Player-facing when-label. Same words on units and stickers. */
export type AbilityTiming =
  | 'onAttack'
  | 'onHit'
  | 'afterAttack'
  | 'firstAttack'
  | 'onDeath'
  | 'battleStart'
  | 'battleEnd'
  | 'scrapEnd'
  | 'whenHit'
  | 'onKill'
  | 'allyDied'
  | 'anyDied'
  | 'ambush'
  | 'onRecruit'
  | 'whenAttacked'
  | 'onSticker'
  | 'turnEnd'
  | 'turnStart';

export type EffectTarget =
  | 'self'
  | 'attackTarget'
  | 'attacker'
  | 'lastTarget'
  | 'leftAlly'
  | 'rightAlly'
  | 'adjacentAllies'
  | 'allAllies'
  | 'allEnemies'
  | 'team'
  | 'randomEnemy'
  | 'mirrorEnemy'
  | 'highestAtkEnemy'
  | 'lowestHpAlly'
  | 'allOthers';

export type AbilityCondition =
  | { kind: 'always' }
  | { kind: 'isAttackDamage' }
  | { kind: 'hpFull' }
  | { kind: 'hpBelowPct'; pct: number }
  | { kind: 'isLastAlly' }
  | { kind: 'firstAttack' }
  | { kind: 'firstNTurns'; n: number }
  | { kind: 'sourceIsAttack' }
  | { kind: 'adjacentGold' }
  | { kind: 'survivedAttack' }
  | { kind: 'targetHasHigherAtk' }
  | { kind: 'targetHasStickers' };

export type EffectOp =
  | { op: 'modStat'; stat: 'atk' | 'maxHp' | 'hp' | 'speed'; amount: number; duration: 'combat' | 'permanent' }
  | { op: 'damage'; amount: number; trueDamage?: boolean; pctOf?: 'hp' | 'maxHp'; pct?: number; roundUp?: boolean }
  | { op: 'heal'; amount: number }
  | { op: 'healToFull' }
  | { op: 'summon'; unitId: string }
  | { op: 'summonFront'; unitId: string }
  | { op: 'summonFallen' }
  | { op: 'stealStat'; stat: 'atk' | 'speed'; amount: number }
  | { op: 'transform'; unitId?: string; randomShop?: boolean; randomShopUp?: boolean; randomRarity?: Rarity; duration?: 'combat' | 'permanent'; untilTurnEnd?: boolean; revive?: boolean }
  | { op: 'exhaustSticker'; stickerId: string }
  | { op: 'grantDiamondStickers' }
  | { op: 'exhaustUnit'; giftBehind?: boolean }
  | { op: 'copyHighestAllyAtk' }
  | { op: 'grantCombatSticker'; source: 'shop' | 'behind' | 'mirrorEnemy'; permanent?: boolean }
  | { op: 'stealCombatSticker' }
  | { op: 'copyOneCombatSticker' }
  | { op: 'peelCombatSticker' }
  | { op: 'exhaustAllStickers' }
  | { op: 'trashStickers' }
  | { op: 'applyPoison' }
  | { op: 'earnSticker'; rarity: Rarity }
  | { op: 'moveForward' }
  | { op: 'moveBack' }
  | { op: 'moveToLastSlot' }
  | { op: 'charmAttack' }
  | { op: 'switchSides' }
  | { op: 'wrapCocoon' }
  | { op: 'becomeCocoon' }
  | { op: 'pullCocoon' }
  | { op: 'ambush'; copyStickers?: boolean; into?: string }
  | { op: 'modRandomStat'; stats: Array<'atk' | 'hp' | 'speed'>; amount: number; duration: 'combat' | 'permanent' }
  | { op: 'copyCombatStickers' }
  | { op: 'revertToBase' }
  | { op: 'counterAttack' }
  | { op: 'extraAttack'; noChain?: boolean }
  | { op: 'doubleAtkHp' }
  | { op: 'damageFromAtk' }
  | { op: 'silence' };

export interface AbilityDef {
  id: string;
  trigger: TriggerKind;
  target: EffectTarget;
  effects: EffectOp[];
  once?: boolean;
  condition?: AbilityCondition;
}

export interface Passives {
  thorns?: number;
  lifesteal?: number;
  provoke?: boolean;
  ignoreProvoke?: boolean;
  firstHitReduce?: number;
  buffTriple?: boolean;
  evade?: boolean;
  evadeReflect?: boolean;
  drunkChance?: number;
  steadfast?: boolean;
  bonusIfTargetHigherAtk?: number;
  atkPerTargetSticker?: number;
  bonusVsLowHp?: number;
  cheatDeath?: boolean;
  healBelowHalf?: number;
  eatStickers?: { atk: number; hp: number };
  gainOnLoss?: { atk: number; hp: number };
  gainOnDeath?: { atk: number; hp: number };
  gainOnAnyDeath?: { atk: number; hp: number };
  alliesGainOnDeath?: { atk: number; hp: number };
  /** Battle Start: every other living card is Silenced for this scrap. */
  silence?: boolean;
  perStickerGained?: { atk: number; hp: number };
  atkPerGameDeath?: number;
  championAtk?: boolean;
  /** Additional full attacks after the first this turn. 1 = Double, 2 = Triple, 3 = Quadruple. */
  extraAttacks?: number;
  /** Extra attacks granted only if this team lost the previous scrap. */
  extraAttacksIfLostLastRound?: number;
  heartseeker?: boolean;
  grantGoldUnitOnRecruit?: boolean;
  grantShopStickerOnRecruit?: boolean;
  grantStickerOnRecruit?: Rarity;
  reflectDamageTaken?: boolean;
  doubleStats?: boolean;
  shareStickerOnApply?: boolean;
  guardian?: boolean;
  forgetStickersAfterScrap?: boolean;
  /** When this attacks a unit, that unit loses this much ATK for the scrap. Stacks. */
  curseAtk?: number;
  /** While living, this team’s cards all act before the other team on the first cycle. */
  teamActsFirst?: boolean;
  /** When a figure on this team is knocked out, that figure returns at full HP. */
  rewind?: boolean;
  /** After Rewind, this many of this figure’s own turn-ends must pass before it can happen again. */
  cooldown?: number;
}

export type Archetype =
  | 'rat'
  | 'kid'
  | 'cop'
  | 'cat'
  | 'vendor'
  | 'boxer'
  | 'dame'
  | 'assistant'
  | 'driver'
  | 'bouncer'
  | 'cigarette'
  | 'acrobat'
  | 'strongman'
  | 'fortune'
  | 'projectionist'
  | 'bootlegger'
  | 'barker'
  | 'contortionist'
  | 'pianist'
  | 'shadow'
  | 'ironjaw'
  | 'impresario'
  | 'ghost'
  | 'dynamite'
  | 'fixer'
  | 'ringmaster'
  | 'midnight'
  | 'devil'
  | 'louis'
  | 'mutt'
  | 'bellhop'
  | 'usher'
  | 'chalk'
  | 'dove'
  | 'imp'
  | 'smoke'
  | 'soda'
  | 'pickpocket'
  | 'newsie'
  | 'balloon'
  | 'stagehand'
  | 'hotdog'
  | 'hatcheck'
  | 'frog';

export interface CharacterArt {
  archetype: Archetype;
  primary: string;
  secondary: string;
  tertiary: string;
  glove: string;
  size: number;
  death: DeathStyle;
}

export interface UnitDef {
  id: string;
  nameKey: string;
  rarity: Rarity;
  /** Folder under /art/units when this unit reuses another portrait. */
  artId?: string;
  hp: number;
  atk: number;
  speed: number;
  ability?: AbilityDef;
  passives?: Passives;
  targeting: TargetingType;
  art: CharacterArt;
  tags: string[];
  recruitable: boolean;
  startingStickers?: string[];
  anim: {
    idle: string;
    enter: string;
    attack: string;
    hit: string;
    death: string;
    victory: string;
  };
}

export interface StickerDef {
  id: string;
  nameKey: string;
  descKey: string;
  family: StickerFamily;
  rarity: Rarity;
  icon: string;
  /** File under /art/stickers when this sticker reuses another drawing. */
  artId?: string;
  frame?: 'monster';
  statMods?: { atk?: number; hp?: number; speed?: number };
  targeting?: TargetingType;
  passives?: Passives;
  ability?: AbilityDef;
  archetypes: string[];
}

export interface RarityWeights {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  diamond: number;
}

export interface SnapshotUnit {
  instanceId: string;
  defId: string;
  slot: number;
  stickerIds: string[];
  permanentMods: { atk: number; hp: number; speed: number };
  baseStats: { atk: number; hp: number; speed: number };
}

export interface TeamSnapshot {
  schemaVersion: 1;
  dataVersion: string;
  simulatorVersion: string;
  playerId: string;
  playerName: string;
  runId: string;
  round: number;
  units: SnapshotUnit[];
  createdAt: number;
  /** True if this team lost its previous scrap (not a draw). */
  lostLastRound?: boolean;
  /** Scraps lost this run before this fight. */
  lossesThisRun?: number;
  /** Stickers obtained this run (shop, gifts, steal, events). */
  stickersGained?: number;
  /** Cards that have died this run, both sides, before this scrap. */
  deathsThisRun?: number;
}

export interface PublicUnitView {
  uid: string;
  defId: string;
  team: TeamId;
  slot: number;
  nameKey: string;
  rarity: Rarity;
  atk: number;
  hp: number;
  maxHp: number;
  speed: number;
  stickers: string[];
  targeting: TargetingType;
  art: CharacterArt;
  summoned: boolean;
  silenced?: boolean;
  /** Set when a boss ability has given this figure Taunt. A plain Cocoon does not have it. */
  provoke?: boolean;
}

export type BattleEvent =
  | { type: 'BattleStarted'; seed: number }
  | { type: 'UnitSpawned'; unit: PublicUnitView }
  | { type: 'BattleEffectsResolved' }
  | { type: 'TurnStarted'; unitId: string; cycle: number }
  | { type: 'BeforeAttack'; unitId: string; targetId: string }
  | { type: 'AttackStarted'; unitId: string; targetId: string; cancelled?: boolean }
  | { type: 'Ambushed'; unitId: string; attackerId: string }
  | { type: 'DamageDealt'; sourceId: string; targetId: string; amount: number; lethal: boolean; kind: 'attack' | 'effect' | 'thorns' | 'reflect' }
  | { type: 'DamageReceived'; unitId: string; amount: number; sourceId: string | null; absorbed: boolean }
  | { type: 'Healed'; unitId: string; amount: number }
  | { type: 'StatChanged'; unitId: string; stat: 'atk' | 'hp' | 'maxHp' | 'speed'; amount: number; now: number; permanent?: boolean }
  | { type: 'UnitKilled'; killerId: string; victimId: string }
  | { type: 'UnitDied'; unitId: string; death: DeathStyle }
  | { type: 'AllyDied'; watcherId: string; deadId: string }
  | { type: 'EnemyDied'; watcherId: string; deadId: string }
  | { type: 'Summoned'; unit: PublicUnitView }
  | { type: 'TurnEnded'; unitId: string }
  | { type: 'BattleEnded'; winner: TeamId | 'draw'; survivors: number; hpRemaining: number; hpPct: number }
  | { type: 'Transformed'; unit: PublicUnitView; fromId: string; combat?: boolean }
  | { type: 'SlotsSwapped'; aId: string; bId: string }
  | { type: 'MovedForward'; unitId: string; fromSlot: number; toSlot: number }
  | { type: 'MovedToBack'; unitId: string; fromSlot: number; toSlot: number }
  | { type: 'SwitchedSides'; unitId: string; fromTeam: TeamId; team: TeamId; slot: number }
  | { type: 'TauntGranted'; unitId: string }
  | { type: 'AteSticker'; unitId: string; stickerId: string; atk: number; hp: number }
  | { type: 'StoleSticker'; thiefId: string; victimId: string; stickerId: string; applied: boolean }
  | { type: 'EarnedSticker'; unitId: string; stickerId: string }
  | { type: 'GrantedSticker'; unitId: string; stickerId: string }
  | { type: 'GainedCombatSticker'; unitId: string; stickerId: string; sourceId: string }
  | { type: 'PeeledSticker'; unitId: string; stickerId: string; stickerSlot?: number }
  | { type: 'ExhaustedSticker'; unitId: string; stickerId: string }
  | { type: 'TrashedStickers'; unitId: string; removed: string[]; stickers: string[] }
  | { type: 'PoisonApplied'; unitId: string; added: boolean; removed: string | null; stickers: string[] }
  | { type: 'StickerSpent'; unitId: string; stickerId: string; stickerSlot?: number }
  | { type: 'ExhaustedUnit'; unitId: string; recipientId?: string | null; atk: number; hp: number }
  | { type: 'GiftedStat'; unitId: string; recipientId: string; stat: 'atk' | 'hp' | 'speed'; amount: number }
  | { type: 'Revived'; unitId: string; hp: number }
  | { type: 'Rewound'; unitId: string; death: DeathStyle; hp: number }
  | { type: 'ConfusedSkip'; unitId: string }
  | { type: 'Evaded'; unitId: string; sourceId: string | null; reflected: boolean }
  | { type: 'BattleStartAct'; unitId: string }
  | { type: 'Silenced'; sourceId: string; unitId: string }
  | { type: 'Log'; message: string };

export interface BattleResult {
  winner: TeamId | 'draw';
  survivorCount: { player: number; enemy: number };
  hpRemaining: { player: number; enemy: number };
  hpPct: { player: number; enemy: number };
  totalAtkAlive: { player: number; enemy: number };
  durationCycles: number;
  seed: number;
  events: BattleEvent[];
  snapshots: { a: TeamSnapshot; b: TeamSnapshot };
  timedOut: boolean;
}

export interface UnitInstance {
  instanceId: string;
  defId: string;
  slot: number;
  stickerIds: string[];
  permanentMods: { atk: number; hp: number; speed: number };
}

export type RunPhase =
  | 'draft'
  | 'formation'
  | 'battle'
  | 'result'
  | 'postFight'
  | 'sticker'
  | 'stickerAssign'
  | 'recruit'
  | 'event'
  | 'final';

export interface RoundRecord {
  round: number;
  win: boolean;
  winner?: 'player' | 'enemy' | 'draw';
  opponentName: string;
  opponentId: string;
  survivorDiff: number;
  hpPctPlayer: number;
  hpPctEnemy: number;
  seed: number;
  events: BattleEvent[];
  playerSnap: TeamSnapshot;
  enemySnap: TeamSnapshot;
}

export interface RunState {
  runId: string;
  mode: RunMode;
  playerId: string;
  playerName: string;
  round: number;
  wins: number;
  losses: number;
  phase: RunPhase;
  team: UnitInstance[];
  pendingStickerIds: string[];
  stickerOffers: string[];
  stickerPickCount: number;
  recruitOffers: string[];
  recruitPicks: string[];
  draftOffers: string[];
  draftPicks: string[];
  lastBattle: BattleResult | null;
  lastBonusBattle: BattleResult | null;
  history: RoundRecord[];
  seed: number;
  offerCounter: number;
  dataVersion: string;
  startedAt: number;
  stickerBag: string[];
  eventId: EventId | null;
  eventStep: EventStep | null;
  eventOffers: string[];
  eventPicks: string[];
  huntMonsterId: string | null;
  recruitRarityBump: boolean;
  alleyPicks: AlleyChoice[];
  alleyQueue: AlleyChoice[];
  alleyDone: AlleyChoice[];
  stickersGained: number;
  deathsThisRun: number;
  /** Crown total. A win adds 3, a draw adds 1, a loss adds 0. */
  victoryPoints?: number;
  lostTales: LostTale[];
  /** The other nine players. Chosen once; their teams last the whole run. */
  circuit?: CircuitRival[];
  /** Last round whose off-screen scraps have been played. */
  circuitPlayed?: number;
  /** Last round whose off-screen alleys have been taken. */
  circuitGrown?: number;
}

export interface LostTale {
  defId: string;
  stickerIds: string[];
  permanentMods: { atk: number; hp: number; speed: number };
}

/** One of the nine rivals who share the run with you. */
export interface CircuitRival {
  playerId: string;
  playerName: string;
  seed: number;
  wins: number;
  losses: number;
  draws: number;
  victoryPoints: number;
  team: UnitInstance[];
  offerCounter: number;
  stickerBag: string[];
  stickersGained: number;
  deathsThisRun: number;
  lostTales: LostTale[];
  lostLastRound: boolean;
  pendingStickerIds: string[];
}

export interface CompletedRun {
  runId: string;
  playerId: string;
  playerName: string;
  mode: RunMode;
  wins: number;
  survivorDiff: number;
  hpPctTotal: number;
  finishedAt: number;
}

export interface Settings {
  locale: Locale;
  music: number;
  sfx: number;
  ui: number;
  reduceShake: boolean;
  reduceFlash: boolean;
  battleSpeed: 1 | 2;
  showCombatLog: boolean;
  preferFullscreen: boolean;
}

export interface CodexState {
  units: string[];
  stickers: string[];
}
