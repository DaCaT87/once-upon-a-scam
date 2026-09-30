import type { DeathStyle, TeamId } from '../core/types';

export type AnimClip = 'idle' | 'enter' | 'attack' | 'hit' | 'death' | 'victory';

export function clipDuration(clip: AnimClip): number {
  if (clip === 'attack') return 0.62;
  if (clip === 'hit') return 0.36;
  if (clip === 'death') return 0.85;
  if (clip === 'enter') return 0.5;
  return 0.66;
}

export interface CardMotion {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  opacity: number;
  foldX: number;
  foldY: number;
}

const still: Pick<CardMotion, 'foldX' | 'foldY'> = { foldX: 0, foldY: 0 };

/** Motion of the CARD itself — characters never leave the portrait. */
export function cardMotion(
  clip: AnimClip,
  timeSec: number,
  team: TeamId,
  death: DeathStyle = 'flatten',
): CardMotion {
  const toward = team === 'player' ? 1 : -1;
  if (clip === 'enter') {
    const t = Math.min(1, timeSec / 0.5);
    const e = 1 - (1 - t) ** 3;
    return { x: 0, y: (1 - e) * -28, rot: (1 - e) * -6 * toward, sx: 0.86 + e * 0.14, sy: 0.72 + e * 0.28, opacity: e, ...still };
  }
  if (clip === 'attack') {
    if (timeSec < 0.12) {
      const t = timeSec / 0.12;
      return { x: -14 * toward * t, y: 8 * t, rot: -6 * toward * t, sx: 1.12, sy: 0.86, opacity: 1, ...still };
    }
    if (timeSec < 0.36) {
      const t = (timeSec - 0.12) / 0.24;
      const hop = 58 * Math.sin(t * Math.PI);
      return { x: hop * toward, y: -18 * Math.sin(t * Math.PI), rot: 5 * toward, sx: 0.84, sy: 1.16, opacity: 1, ...still };
    }
    const t = Math.min(1, (timeSec - 0.36) / 0.26);
    const over = Math.sin(t * Math.PI) * -8;
    return { x: over * toward, y: 0, rot: (1 - t) * 3 * toward, sx: 1, sy: 1, opacity: 1, ...still };
  }
  if (clip === 'hit') {
    const shake = Math.sin(timeSec * 70) * 10 * (1 - timeSec / 0.36);
    return { x: shake, y: 6, rot: shake * 0.5, sx: 1.18, sy: 0.8, opacity: 1, ...still };
  }
  if (clip === 'death') {
    const t = Math.min(1, timeSec / 0.85);
    if (death === 'theatrical' || death === 'spirit') {
      return { x: 10 * toward, y: t * 8, rot: t * 8 * toward, sx: 1 - t * 0.06, sy: 1, opacity: 1 - t, foldX: 0, foldY: t * 88 };
    }
    if (death === 'puff' || death === 'ink' || death === 'stars') {
      return { x: 6 * toward, y: t * 16, rot: t * 16 * toward, sx: 1 - t * 0.12, sy: 1 - t * 0.2, opacity: 1 - t, foldX: t * 28, foldY: t * 12 };
    }
    return { x: 8 * toward, y: t * 36, rot: t * 22 * toward, sx: 1.06, sy: 1 - t * 0.78, opacity: 1 - t, foldX: t * 62, foldY: 0 };
  }
  if (clip === 'victory') {
    const bounce = Math.abs(Math.sin(timeSec * 6)) * 8;
    return { x: 0, y: -bounce, rot: Math.sin(timeSec * 5) * 2, sx: 1, sy: 1 + bounce * 0.01, opacity: 1, ...still };
  }
  return { x: 0, y: 0, rot: 0, sx: 1, sy: 1, opacity: 1, ...still };
}
