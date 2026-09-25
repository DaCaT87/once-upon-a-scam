import type { EventCategory, EventId, Rarity, ShopLevel } from '../core/types';

export interface EventDef {
  id: EventId;
  category: EventCategory;
  nameKey: string;
  descKey: string;
  /** Tall card art shown on the event pick table. Hunt uses the monster unit card instead. */
  art?: string;
}

export const EVENTS: EventDef[] = [
  { id: 'monster-hunt', category: 'challenge', nameKey: 'evt.monsterHunt', descKey: 'evt.monsterHunt.d' },
  {
    id: 'wishing-well',
    category: 'safe',
    nameKey: 'evt.wishingWell',
    descKey: 'evt.wishingWell.d',
    art: './art/ui/event-wishing-well.jpg?v=well16',
  },
  {
    id: 'witch-oven',
    category: 'risky',
    nameKey: 'evt.witchOven',
    descKey: 'evt.witchOven.d',
    art: './art/ui/event-witch-oven.jpg?v=oven14',
  },
  {
    id: 'cloning-chamber',
    category: 'special',
    nameKey: 'evt.cloningChamber',
    descKey: 'evt.cloningChamber.d',
    art: './art/ui/plate-cloning-chamber.png?v=alley30',
  },
  {
    id: 'book-of-lost-tales',
    category: 'special',
    nameKey: 'evt.bookOfLostTales',
    descKey: 'evt.bookOfLostTales.d',
    art: './art/ui/event-book-of-lost-tales.jpg?v=book9',
  },
];

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

const NO_RARITY_EVENTS: readonly EventId[] = [
  'wishing-well',
  'witch-oven',
  'cloning-chamber',
  'book-of-lost-tales',
];

/** These events always do the same thing; do not show a rarity gem on the event card. */
export function eventHidesRarity(id: EventId | null | undefined): boolean {
  return id != null && (NO_RARITY_EVENTS as readonly string[]).includes(id);
}

export type EventPlate = 'challenge' | 'bargain' | 'gift';

/** Alley fork plate while Event is still unopened. */
export function eventPlate(_id: EventId | null | undefined): EventPlate {
  return 'gift';
}

export interface HuntMonster {
  unitId: string;
  rarity: Rarity;
  stickerId: string | null;
}

/** One challenge boss per rarity. Silk Cocoon is part of Purple Widows and not in the trifork. */
export const HUNT_MONSTERS: HuntMonster[] = [
  { unitId: 'thousand-maws', rarity: 'bronze', stickerId: 'endless-hunger' },
  { unitId: 'mad-woodsman', rarity: 'platinum', stickerId: 'woodsmans-axe' },
  { unitId: 'sewer-lord', rarity: 'gold', stickerId: 'filth' },
  { unitId: 'purple-widows', rarity: 'silver', stickerId: 'cocoon' },
  { unitId: 'greed-fang', rarity: 'diamond', stickerId: 'mythic-treasure' },
];

const HUNT_RARITY_BY_LEVEL: Rarity[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

export function huntMonstersFor(round: number): HuntMonster[] {
  const rarity = HUNT_RARITY_BY_LEVEL[huntLevelForRound(round) - 1] ?? 'bronze';
  return HUNT_MONSTERS.filter((m) => m.rarity === rarity);
}

export function huntStickerFor(unitId: string): string | null {
  return HUNT_MONSTERS.find((m) => m.unitId === unitId)?.stickerId ?? null;
}

/** Book of Lost Tales: losses vs players → reward rarity. */
export function lossRewardRarity(losses: number): Rarity {
  if (losses <= 1) return 'bronze';
  if (losses === 2) return 'silver';
  if (losses === 3) return 'gold';
  if (losses === 4) return 'platinum';
  return 'diamond';
}

export function huntPower(level: ShopLevel): { atk: number; hp: number; speed: number } {
  if (level <= 1) return { atk: 0, hp: 0, speed: 0 };
  if (level === 2) return { atk: 1, hp: 1, speed: 0 };
  if (level === 3) return { atk: 2, hp: 3, speed: 0 };
  if (level === 4) return { atk: 3, hp: 5, speed: 0 };
  return { atk: 4, hp: 7, speed: 1 };
}

export function huntLevelForRound(round: number): ShopLevel {
  if (round >= 9) return 5;
  if (round <= 2) return 1;
  if (round <= 5) return 2;
  if (round <= 7) return 3;
  return 4;
}
