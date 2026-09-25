import {
  applySticker,
  shareStickerOnApply,
  computedStats,
  getSticker,
  getUnit,
  instanceFromDef,
  makeSnapshot,
  offerStickers,
  offerUnits,
  teamSizeForRound,
} from '../core/catalog';
import { detId } from '../core/ids';
import { SeededRng, mixSeed } from '../core/rng';
import type { TeamSnapshot, UnitInstance } from '../core/types';

function scoreUnit(defId: string, stickers: string[]): number {
  const def = getUnit(defId);
  const fake: UnitInstance = {
    instanceId: 'x',
    defId,
    slot: 1,
    stickerIds: stickers,
    permanentMods: { atk: 0, hp: 0, speed: 0 },
  };
  const s = computedStats(fake);
  const rarity = { bronze: 0, silver: 8, gold: 18, platinum: 26, diamond: 40 }[def.rarity];
  return s.atk * 3 + s.hp * 2 + s.speed * 2 + rarity + stickers.length * 4 + (def.ability ? 5 : 0);
}

function stickerFit(defId: string, stickerId: string): number {
  const def = getUnit(defId);
  const st = getSticker(stickerId);
  let score = 1;
  for (const tag of def.tags) {
    if (st.archetypes.includes(tag)) score += 6;
  }
  if (st.family === 'stat') score += 2;
  if (st.statMods?.atk && def.tags.includes('attack')) score += 3;
  if (st.statMods?.hp && def.tags.includes('tank')) score += 3;
  if (st.targeting && def.tags.includes('target')) score += 2;
  return score;
}

function placeStickers(team: UnitInstance[], stickerIds: string[]): UnitInstance[] {
  let next = team.map((u) => ({ ...u, stickerIds: [...u.stickerIds] }));
  for (const sid of stickerIds) {
    const ranked = next
      .map((u, i) => ({ i, fit: stickerFit(u.defId, sid), n: u.stickerIds.length }))
      .sort((a, b) => {
        const af = a.n >= 3 ? a.fit - 8 : a.fit;
        const bf = b.n >= 3 ? b.fit - 8 : b.fit;
        return bf - af;
      });
    const best = ranked[0];
    if (!best) continue;
    const fromId = next[best.i]!.defId;
    next[best.i] = applySticker(next[best.i]!, sid, next[best.i]!.stickerIds.length >= 3 ? 0 : undefined);
    next = shareStickerOnApply(next, next[best.i]!.instanceId, sid, fromId);
  }
  return next;
}

function formUp(team: UnitInstance[]): UnitInstance[] {
  const scored = team
    .map((u) => ({ u, s: computedStats(u) }))
    .sort((a, b) => b.s.hp - a.s.hp || b.s.atk - a.s.atk);
  return scored.map((row, i) => ({ ...row.u, slot: i + 1 }));
}

/**
 * Build AI plays by the same rules: rarity table, sticker count ≈ rounds played,
 * no extra stats. Quality only changes pick greed vs. synergy, not illegal power.
 */
export function buildOpponent(round: number, seed: number, quality = 0.65): TeamSnapshot {
  const rng = new SeededRng(mixSeed(seed, round, 0xb1d));
  const unitCount = teamSizeForRound(round);
  const offers = offerUnits(round, Math.max(5, unitCount + 2), rng);
  const ranked = offers
    .map((id) => ({ id, score: scoreUnit(id, []) + rng.next() * (1.2 - quality) * 8 }))
    .sort((a, b) => b.score - a.score);
  const picked = ranked.slice(0, unitCount).map((r, i) => instanceFromDef(r.id, i + 1, detId('ai', seed, i)));

  const stickerRounds = Math.max(0, round - 1);
  const bag: string[] = [];
  for (let i = 0; i < stickerRounds; i++) {
    bag.push(...offerStickers(1, rng.fork(i + 11), round));
  }
  const chosen = bag.slice(0, Math.min(bag.length, unitCount * 3));
  const withStickers = placeStickers(picked, chosen);
  const formed = formUp(withStickers);

  const names = [
    'Dolly Two-Time',
    'Ink-Stained Pete',
    'Velvet Mae',
    'Lefty Calhoun',
    'Miss Ribbon',
    'Porkpie Joe',
    'The Midnight Clerk',
    'Hattie No-Last-Name',
    'Cinder Sid',
    'Brass Nell',
    'Quiet Irving',
    'Marquee Bess',
  ];
  const playerName = names[seed % names.length]!;

  const snap = makeSnapshot({
    playerId: `ai_${seed.toString(16)}`,
    playerName,
    runId: `airun_${seed.toString(16)}`,
    round,
    team: formed,
  });
  snap.createdAt = seed;
  return snap;
}
