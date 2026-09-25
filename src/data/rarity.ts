import type { Rarity, RarityWeights, ShopLevel } from '../core/types';

export const RARITY_ORDER: Rarity[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

/** Draft before round 1. */
export const DRAFT_UNIT_MIX: readonly Rarity[] = ['bronze', 'bronze', 'bronze', 'bronze'];

/**
 * Recruit offers after fighting that round (R1…R9). Round 0 is draft.
 * Round 10 has no shop; it reuses R9 if asked.
 */
const RECRUIT_MIX: Record<number, readonly Rarity[]> = {
  1: ['bronze', 'bronze', 'bronze', 'bronze'],
  2: ['bronze', 'bronze', 'bronze', 'silver'],
  3: ['bronze', 'bronze', 'silver', 'silver'],
  4: ['bronze', 'silver', 'silver', 'silver'],
  5: ['bronze', 'silver', 'silver', 'gold'],
  6: ['silver', 'silver', 'gold', 'gold'],
  7: ['silver', 'gold', 'gold', 'platinum'],
  8: ['silver', 'gold', 'platinum', 'platinum'],
  9: ['gold', 'gold', 'platinum', 'platinum'],
  10: ['gold', 'gold', 'platinum', 'platinum'],
};

/** Sticker shop after fighting that round. */
const STICKER_MIX: Record<number, readonly Rarity[]> = {
  1: ['bronze', 'bronze', 'bronze'],
  2: ['bronze', 'bronze', 'bronze'],
  3: ['bronze', 'bronze', 'silver'],
  4: ['bronze', 'silver', 'silver'],
  5: ['bronze', 'silver', 'gold'],
  6: ['silver', 'silver', 'gold'],
  7: ['silver', 'gold', 'gold'],
  8: ['silver', 'gold', 'platinum'],
  9: ['gold', 'platinum', 'platinum'],
  10: ['gold', 'platinum', 'platinum'],
};

function clampRound(round: number): number {
  return Math.max(1, Math.min(10, Math.round(round)));
}

export function recruitRarityMix(round: number): Rarity[] {
  return [...(RECRUIT_MIX[clampRound(round)] ?? RECRUIT_MIX[9]!)];
}

export function stickerRarityMix(round: number): Rarity[] {
  return [...(STICKER_MIX[clampRound(round)] ?? STICKER_MIX[9]!)];
}

function maxInMix(mix: readonly Rarity[]): Rarity {
  return mix.reduce((best, r) => (RARITY_ORDER.indexOf(r) > RARITY_ORDER.indexOf(best) ? r : best), 'bronze');
}

export function shopMaxRarity(round: number): Rarity {
  return maxInMix(recruitRarityMix(round));
}

export function mixToWeights(mix: readonly Rarity[]): RarityWeights {
  const w: RarityWeights = { bronze: 0, silver: 0, gold: 0, platinum: 0, diamond: 0 };
  for (const r of mix) w[r] += 1;
  return w;
}

export function rarityForRound(round: number): RarityWeights {
  return mixToWeights(recruitRarityMix(round));
}

export function shopLevelForRound(round: number): ShopLevel {
  const max = shopMaxRarity(round);
  if (max === 'bronze') return 1;
  if (max === 'silver') return 2;
  if (max === 'gold') return 3;
  return 4;
}

/** One step up in the shop, never Diamond. */
export function nextShopRarity(rarity: Rarity): Rarity {
  if (rarity === 'bronze') return 'silver';
  if (rarity === 'silver') return 'gold';
  if (rarity === 'gold') return 'platinum';
  return 'platinum';
}

/** Magic Lamp: one rarity above the current shop's ceiling. Platinum shop → Diamond. */
export function lampRarity(level: ShopLevel): Rarity {
  if (level <= 1) return 'silver';
  if (level === 2) return 'gold';
  if (level === 3) return 'platinum';
  return 'diamond';
}

export function nextWellRarity(rarity: Rarity): Rarity {
  if (rarity === 'bronze') return 'silver';
  if (rarity === 'silver') return 'gold';
  if (rarity === 'gold') return 'platinum';
  if (rarity === 'platinum') return 'diamond';
  return 'diamond';
}

/** Mystery Egg: one rarity above the shop ceiling, including Diamond. */
export function nextHatchRarity(round: number): Rarity {
  return nextWellRarity(shopMaxRarity(round));
}

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

function countMix(table: Record<number, readonly Rarity[]>, rounds: number[]): Record<Rarity, number> {
  const w: Record<Rarity, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0, diamond: 0 };
  for (const n of rounds) {
    for (const r of table[n] ?? []) w[r] += 1;
  }
  return w;
}

export function assertShopCurve(): void {
  const draft = DRAFT_UNIT_MIX;
  if (draft.length !== 4 || draft.some((r) => r !== 'bronze')) throw new Error('shop-draft');
  if (shopLevelForRound(1) !== 1) throw new Error('shop-l1');
  if (shopLevelForRound(2) !== 2 || shopLevelForRound(4) !== 2) throw new Error('shop-l2');
  if (shopLevelForRound(5) !== 3 || shopLevelForRound(6) !== 3) throw new Error('shop-l3');
  if (shopLevelForRound(7) !== 4 || shopLevelForRound(9) !== 4) throw new Error('shop-l4');
  if (shopMaxRarity(1) !== 'bronze' || shopMaxRarity(2) !== 'silver' || shopMaxRarity(5) !== 'gold' || shopMaxRarity(7) !== 'platinum') {
    throw new Error('shop-max');
  }
  const units = countMix(RECRUIT_MIX, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  units.bronze += DRAFT_UNIT_MIX.length;
  if (units.bronze !== 15 || units.silver !== 12 || units.gold !== 8 || units.platinum !== 5 || units.diamond !== 0) {
    throw new Error(`shop-unit-totals b=${units.bronze} s=${units.silver} g=${units.gold} p=${units.platinum}`);
  }
  const stickers = countMix(STICKER_MIX, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  if (stickers.bronze !== 10 || stickers.silver !== 8 || stickers.gold !== 6 || stickers.platinum !== 3 || stickers.diamond !== 0) {
    throw new Error(`shop-sticker-totals b=${stickers.bronze} s=${stickers.silver} g=${stickers.gold} p=${stickers.platinum}`);
  }
  if (lampRarity(1) !== 'silver' || lampRarity(4) !== 'diamond') throw new Error('lamp-rarity');
  if (nextShopRarity('platinum') !== 'platinum' || nextShopRarity('gold') !== 'platinum') throw new Error('shop-cap');
  if (nextWellRarity('platinum') !== 'diamond' || nextWellRarity('diamond') !== 'diamond') throw new Error('well-cap');
}
