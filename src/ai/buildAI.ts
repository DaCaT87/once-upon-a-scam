import {
  idlePacifist,
  instanceFromDef,
  makeSnapshot,
  offerStickers,
  offerUnits,
  teamSizeForRound,
} from '../core/catalog';
import { detId } from '../core/ids';
import { SeededRng, mixSeed } from '../core/rng';
import type { TeamSnapshot } from '../core/types';
import { ensureFullLine, placeStickers, scoreUnit, viceAt } from './brain';

/**
 * Build AI plays by the same rules: rarity table, sticker count ≈ rounds played,
 * no extra stats. Quality only changes pick greed vs. synergy, not illegal power.
 */
export function buildOpponent(round: number, seed: number, quality = 0.65): TeamSnapshot {
  const rng = new SeededRng(mixSeed(seed, round, 0xb1d));
  const vice = viceAt(seed);
  const unitCount = teamSizeForRound(round);
  const offers = offerUnits(round, Math.max(5, unitCount + 2), rng);
  const ranked = offers
    .map((id) => ({ id, score: scoreUnit(id, [], vice) + rng.next() * (1.2 - quality) * 8 }))
    .sort((a, b) => b.score - a.score);
  const pickedIds: string[] = [];
  for (const r of ranked) {
    if (pickedIds.length >= unitCount) break;
    const idle = pickedIds.filter((id) => idlePacifist(id)).length;
    if (idlePacifist(r.id) && idle >= 1) continue;
    pickedIds.push(r.id);
  }
  const picked = pickedIds.map((id, i) => instanceFromDef(id, i + 1, detId('ai', seed, i)));

  const stickerRounds = Math.max(0, round - 1);
  const bag: string[] = [];
  for (let i = 0; i < stickerRounds; i++) {
    bag.push(...offerStickers(1, rng.fork(i + 11), round));
  }
  const chosen = bag.slice(0, Math.min(bag.length, unitCount * 3));
  const formed = placeStickers(ensureFullLine(picked, { seed, round, vice }), chosen, vice);

  const names = [
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
