import { DRAW_EXTINGUISH_FROM_ROUND, STARTING_CANDLES } from '../core/types';
import type { RunState } from '../core/types';

/** You + nine rivals. */
export const FIELD_SIZE = 10;

/** How many candles a scrap result snuffs (from that fighter's view of the scrap). */
export function candleCost(winner: 'player' | 'enemy' | 'draw', round: number): number {
  if (winner === 'player') return 0;
  if (winner === 'draw' && round < DRAW_EXTINGUISH_FROM_ROUND) return 0;
  return 1;
}

export function candlesOf(run: { candles?: number; losses?: number; victoryPoints?: number }): number {
  if (typeof run.candles === 'number') {
    return Math.max(0, Math.min(STARTING_CANDLES, Math.floor(run.candles)));
  }
  // Old saves stored the same count as victoryPoints.
  if (typeof run.victoryPoints === 'number') {
    return Math.max(0, Math.min(STARTING_CANDLES, Math.floor(run.victoryPoints)));
  }
  return Math.max(0, STARTING_CANDLES - (run.losses ?? 0));
}

/** Candles shown during a scrap/hunt: count before this fight's snuff. */
export function scrapCandles(run: RunState): number {
  const total = candlesOf(run);
  if (run.eventId === 'monster-hunt') {
    if (run.lastBattle?.winner === 'enemy') return Math.min(STARTING_CANDLES, total + 1);
    return total;
  }
  const winner = run.lastBattle?.winner;
  if (!winner || winner === 'player') return total;
  return Math.min(STARTING_CANDLES, total + candleCost(winner, run.round));
}

export function livingIds(run: RunState): string[] {
  const ids: string[] = [];
  if (candlesOf(run) > 0) ids.push(run.playerId);
  for (const rival of run.circuit ?? []) {
    if (candlesOf(rival) > 0) ids.push(rival.playerId);
  }
  return ids;
}

export function snapshotCandles(run: RunState): Array<{ id: string; candles: number }> {
  return [
    { id: run.playerId, candles: candlesOf(run) },
    ...(run.circuit ?? []).map((rival) => ({ id: rival.playerId, candles: candlesOf(rival) })),
  ];
}

export function withEliminations(
  run: RunState,
  before: Array<{ id: string; candles: number }>,
): RunState {
  const after = snapshotCandles(run);
  const order = [...(run.eliminatedIds ?? [])];
  const afterMap = new Map(after.map((row) => [row.id, row.candles]));
  for (const row of before) {
    const next = afterMap.get(row.id) ?? 0;
    if (row.candles > 0 && next <= 0 && !order.includes(row.id)) order.push(row.id);
  }
  for (const row of after) {
    if (row.candles <= 0 && !order.includes(row.id)) order.push(row.id);
  }
  return { ...run, eliminatedIds: order };
}

/** Final place: first out = 10th, sole survivor = 1st. */
export function placeOf(run: RunState, playerId: string): number {
  const order = run.eliminatedIds ?? [];
  const idx = order.indexOf(playerId);
  if (idx >= 0) return FIELD_SIZE - idx;
  const living = livingIds(run);
  if (living.length === 1 && living[0] === playerId) return 1;
  if (!living.includes(playerId)) return FIELD_SIZE;
  const ranked = living
    .map((id) => {
      if (id === run.playerId) {
        return { id, candles: candlesOf(run), wins: run.wins, name: run.playerName };
      }
      const rival = (run.circuit ?? []).find((r) => r.playerId === id)!;
      return { id, candles: candlesOf(rival), wins: rival.wins, name: rival.playerName };
    })
    .sort((a, b) => b.candles - a.candles || b.wins - a.wins || a.name.localeCompare(b.name));
  const rank = ranked.findIndex((row) => row.id === playerId);
  return rank >= 0 ? rank + 1 : FIELD_SIZE;
}
