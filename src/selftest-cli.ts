import { bestSquad, formLine, linePower } from './ai/brain';
import { assertAbilityTiming, assertCompactSlots, instanceFromDef, makeSnapshot } from './core/catalog';
import { assertShopCurve } from './data/rarity';
import { assertRivalCurve } from './run/circuit';
import { simulateBattle } from './sim/simulation';
import { assertTargetingRules } from './sim/targeting';

function combos(items: string[], k: number): string[][] {
  if (k === 0) return [[]];
  const out: string[][] = [];
  const walk = (start: number, acc: string[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/** Among every roster this shop can field, the computer keeps the one that wins the fights. */
function assertBestSquadFights(): void {
  const pool = ['village-fool', 'puss-in-boots', 'magic-mirror', 'farm-boy', 'hunter', 'drunken-giant'];
  const sets = combos(pool, 4).filter((ids) => linePower(ids) > -1e8);
  const snap = (ids: string[], name: string) =>
    makeSnapshot({
      playerId: name,
      playerName: name,
      runId: name,
      round: 6,
      team: formLine(ids.map((id, i) => instanceFromDef(id, i + 1, `${name}${i}`))),
    });
  const wins = sets.map(() => 0);
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const fight = simulateBattle(snap(sets[i]!, 'a'), snap(sets[j]!, 'b'), 11);
      if (fight.winner === 'player') wins[i] += 1;
      else if (fight.winner === 'enemy') wins[j] += 1;
    }
  }
  let champ = 0;
  for (let i = 1; i < wins.length; i++) if (wins[i]! > wins[champ]!) champ = i;
  const chosen = bestSquad([], pool, 4, 4).slice().sort();
  const want = sets[champ]!.slice().sort();
  if (chosen.join(',') !== want.join(',')) {
    throw new Error(`best-squad ${chosen.join(',')} wanted ${want.join(',')}`);
  }
}

assertTargetingRules();
assertAbilityTiming();
assertCompactSlots();
assertShopCurve();
assertBestSquadFights();
assertRivalCurve();
console.info('[Patch & Fable] best squad, rival curve, and rules ok');
