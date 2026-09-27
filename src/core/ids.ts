let n = 0;

/** Alias length kept short so standings stay on one line. */
export const PLAYER_NAME_MAX = 10;

export function clampPlayerName(name: string): string {
  return name.trim().slice(0, PLAYER_NAME_MAX);
}

export function makeId(prefix: string): string {
  n += 1;
  return `${prefix}_${Date.now().toString(36)}_${n.toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function resetIdCounter(): void {
  n = 0;
}

/** Deterministic instance ids for simulation / AI (never use in UI uniqueness alone). */
export function detId(prefix: string, seed: number, i: number): string {
  return `${prefix}_${(seed >>> 0).toString(16)}_${i}`;
}
