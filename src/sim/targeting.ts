import type { TargetingType } from '../core/types';

export interface Targetable {
  uid: string;
  slot: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  dead: boolean;
}

/** Slot 1 is the front of the line (closest to the opposite team). The highest slot is the back. */
export function living(units: Targetable[]): Targetable[] {
  return units.filter((u) => !u.dead && u.hp > 0);
}

export function nearestBySlot(candidates: Targetable[], slot: number): Targetable | null {
  if (!candidates.length) return null;
  const sorted = candidates.slice().sort((a, b) => {
    const da = Math.abs(a.slot - slot);
    const db = Math.abs(b.slot - slot);
    if (da !== db) return da - db;
    if (a.slot !== b.slot) return a.slot - b.slot;
    return a.uid.localeCompare(b.uid);
  });
  return sorted[0] ?? null;
}

function byUid(a: Targetable, b: Targetable): number {
  return a.uid.localeCompare(b.uid);
}

export function pickTarget(
  mode: TargetingType,
  self: Targetable,
  enemies: Targetable[],
  opts?: { ignoreProvoke?: boolean; provoked?: string[]; avoid?: string[] },
): Targetable | null {
  let foes = living(enemies);
  if (!foes.length) return null;
  if (opts?.avoid?.length) {
    const rest = foes.filter((e) => !opts.avoid!.includes(e.uid));
    if (rest.length) foes = rest;
  }
  const taunts = opts?.provoked?.length
    ? foes.filter((e) => opts.provoked!.includes(e.uid))
    : [];
  if (!opts?.ignoreProvoke && taunts.length) {
    foes = foes.filter((e) => taunts.some((t) => t.uid === e.uid) || !taunts.some((t) => t.slot < e.slot));
  }

  switch (mode) {
    case 'pacifist':
      return null;
    case 'brawler':
      return foes.slice().sort((a, b) => a.slot - b.slot || byUid(a, b))[0] ?? null;
    case 'sneak':
      return foes.slice().sort((a, b) => b.slot - a.slot || byUid(a, b))[0] ?? null;
    case 'hitman':
      return (
        foes.slice().sort((a, b) => {
          if (a.hp !== b.hp) return a.hp - b.hp;
          if (a.slot !== b.slot) return a.slot - b.slot;
          return byUid(a, b);
        })[0] ?? null
      );
    case 'flock':
      return foes.slice().sort((a, b) => a.slot - b.slot || byUid(a, b))[0] ?? null;
  }
}

export function assertTargetingRules(): void {
  const foes: Targetable[] = [
    { uid: 'e1', slot: 1, hp: 6, maxHp: 6, atk: 1, speed: 1, dead: false },
    { uid: 'e3', slot: 3, hp: 2, maxHp: 5, atk: 1, speed: 1, dead: false },
    { uid: 'e5', slot: 5, hp: 2, maxHp: 5, atk: 1, speed: 1, dead: false },
  ];
  const self: Targetable = { uid: 'p', slot: 3, hp: 4, maxHp: 4, atk: 1, speed: 1, dead: false };
  if (pickTarget('brawler', self, foes)?.uid !== 'e1') throw new Error('brawler');
  if (pickTarget('sneak', self, foes)?.uid !== 'e5') throw new Error('sneak');
  if (pickTarget('hitman', self, foes)?.uid !== 'e3') throw new Error('hitman');
  if (pickTarget('pacifist', self, foes) !== null) throw new Error('pacifist');
  if (pickTarget('flock', self, foes)?.uid !== 'e1') throw new Error('flock');
  const deadFront = foes.map((f) => (f.slot === 1 ? { ...f, dead: true, hp: 0 } : f));
  if (pickTarget('brawler', self, deadFront)?.uid !== 'e3') throw new Error('brawler-skip-dead');
  if (pickTarget('sneak', self, foes, { provoked: ['e1'] })?.uid !== 'e1') throw new Error('provoke');
  if (pickTarget('sneak', self, foes, { provoked: ['e1'], ignoreProvoke: true })?.uid !== 'e5') {
    throw new Error('ignore-provoke');
  }
  if (pickTarget('brawler', self, foes, { provoked: ['e5'] })?.uid !== 'e1') throw new Error('taunt-last-noop');
  if (pickTarget('sneak', self, foes, { provoked: ['e3'] })?.uid !== 'e3') throw new Error('taunt-mid-blocks-back');
  if (pickTarget('brawler', self, foes, { provoked: ['e3'] })?.uid !== 'e1') throw new Error('taunt-mid-front-ok');
  if (pickTarget('sneak', self, foes, { avoid: ['e5'] })?.uid !== 'e3') throw new Error('avoid-back');
  if (pickTarget('brawler', self, foes, { avoid: ['e1'] })?.uid !== 'e3') throw new Error('avoid-front');
  if (pickTarget('brawler', self, [foes[0]!], { avoid: ['e1'] })?.uid !== 'e1') throw new Error('avoid-only-target');
}
