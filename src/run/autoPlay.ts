import { firstFreeSlot, teamSizeForRound } from '../core/catalog';
import {
  afterResult,
  chooseAlley,
  confirmDraft,
  createRun,
  finishRecruit,
  placeRecruit,
  replaceRecruit,
  resolveFight,
  skipStickers,
  toggleDraftPick,
} from './runEngine';
import { circuitOpponent } from './circuit';
import { buildOpponent } from '../ai/buildAI';
import { mixSeed } from '../core/rng';
import { DRAFT_PICK, MAX_TEAM } from '../core/types';
import type { RunState } from '../core/types';

/** Headless 10-round playthrough for the same rules the UI uses. */
export function autoPlayRun(seed = 0x51a711): RunState {
  let run = createRun('ai', 'tester', 'Auto Mae', seed);
  for (const id of run.draftOffers.slice(0, DRAFT_PICK)) run = toggleDraftPick(run, id);
  run = confirmDraft(run);
  if (run.phase === 'stickerAssign') run = skipStickers(run);
  if (run.team.length !== teamSizeForRound(1)) throw new Error('autoplay-draft-size');
  for (let r = 1; r <= 10; r++) {
    const enemy = buildOpponent(run.round, mixSeed(seed, run.round, 99), 0.6);
    if (run.team.length < DRAFT_PICK || run.team.length > MAX_TEAM) {
      throw new Error(`autoplay-player-size-${run.round}`);
    }
    if (enemy.units.length !== teamSizeForRound(run.round)) throw new Error(`autoplay-enemy-size-${run.round}`);
    run = resolveFight(run, enemy);
    if (run.round >= 10) {
      run = afterResult(run);
      break;
    }
    run = afterResult(run);
    if (run.phase === 'stickerAssign') run = skipStickers(run);
    if (run.phase !== 'postFight') throw new Error(`autoplay-alley-${run.round}`);
    run = chooseAlley(run, 'recruit');
    if (run.phase === 'recruit') {
      for (const id of run.recruitOffers.slice(0, 2)) {
        const free = firstFreeSlot(run.team);
        if (run.team.length < MAX_TEAM && free >= 1 && free <= MAX_TEAM && !run.team.some((u) => u.slot === free)) {
          run = placeRecruit(run, id, free);
        } else {
          const victim = run.team[0];
          if (victim) run = replaceRecruit(run, id, victim.slot);
        }
      }
      run = finishRecruit(run);
      if (run.phase === 'stickerAssign') run = skipStickers(run);
    }
    if (run.phase !== 'postFight') throw new Error(`autoplay-alley-back-${run.round}`);
    run = chooseAlley(run, 'sticker');
    if (run.phase === 'sticker') run = skipStickers(run);
  }
  return run;
}
