import type { DeathStyle, TeamId } from '../core/types';

export type AnimClip = 'idle' | 'enter' | 'attack' | 'hit' | 'death' | 'victory';

export function clipDuration(clip: AnimClip, _art?: CharacterArt): number {
  if (clip === 'attack') return 0.62;
  if (clip === 'hit') return 0.36;
  if (clip === 'death') return 0.85;
  if (clip === 'enter') return 0.5;
  return 0.66;
}

export function resolveUnitClip(clip: AnimClip, timeSec: number): UnitClip {
  if (clip === 'idle' || clip === 'victory') return Math.floor(timeSec * 5) % 2 === 0 ? 'idle' : 'idle2';
  if (clip === 'enter') return timeSec < 0.2 ? 'idle2' : 'idle';
  if (clip === 'attack') return timeSec < 0.14 ? 'idle2' : 'attack';
  if (clip === 'hit') return 'hit';
  if (clip === 'death') return 'death';
  return 'idle';
}

export function unitArtSrc(defId: string, clip: UnitClip): string {
  return `./art/units/${unitArtFolder(defId)}/${clip}.png`;
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
  const wobble = 0;
  return { x: 0, y: 0, rot: 0, sx: 1 + wobble, sy: 1 - wobble, opacity: 1, ...still };
}

export function squashFor(clip: AnimClip, timeSec: number): { sx: number; sy: number; y: number; rot: number } {
  const m = cardMotion(clip, timeSec, 'player');
  return { sx: m.sx, sy: m.sy, y: m.y, rot: (m.rot * Math.PI) / 180 };
}

export function drawPaintedUnit(
  ctx: CanvasRenderingContext2D,
  defId: string,
  clip: AnimClip,
  timeSec: number,
  x: number,
  y: number,
  facing: 1 | -1,
  scale = 1,
): void {
  const img = unitFrame(defId, resolveUnitClip(clip, timeSec));
  if (!img) return;
  const xf = squashFor(clip, timeSec);
  const w = 168 * scale;
  const h = 224 * scale;
  ctx.save();
  ctx.translate(x, y + xf.y);
  ctx.scale(facing, 1);
  ctx.rotate(xf.rot * facing);
  ctx.scale(xf.sx, xf.sy);
  ctx.drawImage(img, -w / 2, -h + 18, w, h);
  ctx.restore();
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  art: CharacterArt,
  x: number,
  y: number,
  facing: 1 | -1,
  _pose: unknown,
  _seed = 1,
): void {
  void art;
  void _pose;
  void _seed;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.fillStyle = '#ead7ad';
  ctx.strokeStyle = '#1a1410';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function samplePose(): Record<string, number> {
  return {};
}
