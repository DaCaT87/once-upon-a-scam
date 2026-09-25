import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const STICKER_DIR = 'public/art/stickers';
const A_IN = 20;
const apply = process.argv.includes('--apply');
const only = new Set(
  process.argv
    .filter((a) => a.startsWith('--only='))
    .flatMap((a) => a.slice('--only='.length).split(',').filter(Boolean)),
);

const NEED_RIM = new Set([
  'big-hammer',
  'bloodied-crown',
  'revenge-bomb',
  'giant-strength',
  'reapers-scythe',
  'lightning-bolt',
  'hermes-boots',
  'dragon-scale',
  'ogres-club',
  'knights-crest',
  'thiefs-hood',
  'painted-target',
  'spiked-shield',
  'steel-sword',
  'war-banner',
  'wind-spirit',
]);

const OFFICIAL = new Set([
  'rusty-knife',
  'fur-armor',
  'rabbits-foot',
  'fireball',
  'big-hammer',
  'lead-armor',
  'spiked-shield',
  'life-potion',
  'revenge-bomb',
  'bat-fang',
  'painted-target',
  'silver-plated',
  'steel-sword',
  'chain-mail',
  'water-spirit',
  'knights-crest',
  'butchers-cleave',
  'blood-leech',
  'thiefs-hood',
  'war-banner',
  'lightning-bolt',
  'gold-plated',
  'giant-strength',
  'troll-hide',
  'wind-spirit',
  'fire-spirit',
  'shower-of-arrows',
  'bloodied-crown',
  'lucky-charm',
  'vampires-appetite',
  'heartseeker-arrow',
  'snipers-sight',
  'platinum-plated',
  'hearth-spirit',
  'dragons-breath',
  'hermes-boots',
  'phoenix-heart',
  'reapers-scythe',
  'cursed-armor',
  'mirror-mirror',
  'diamond-plated',
  'excalibur',
  'void-heart',
  'fire-spirit',
  'insatiable-hunger',
  'dragon-scale',
  'cyclops-eye',
  'spider-silk',
  'ogres-club',
]);

const CREAM = { r: 236, g: 226, b: 200 };

function loadPng(path) {
  return PNG.sync.read(readFileSync(path));
}

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isPaper(r, g, b) {
  const L = luma(r, g, b);
  const c = chroma(r, g, b);
  if (L >= 220 && c <= 42 && r >= 208 && g >= 202 && b >= 188) return true;
  return L >= 186 && r >= g - 6 && g >= b - 4 && r - b >= 10 && c <= 88 && b >= 118;
}

function exteriorDistance(png) {
  const { width: w, height: h, data } = png;
  const dist = new Int16Array(w * h);
  dist.fill(32767);
  const q = [];
  let head = 0;
  const push = (i, d) => {
    if (d >= dist[i]) return;
    dist[i] = d;
    q.push(i);
  };
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < A_IN) push(i, 0);
  }
  while (head < q.length) {
    const i = q[head++];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    if (x + 1 < w) push(i + 1, d);
    if (x > 0) push(i - 1, d);
    if (y + 1 < h) push(i + w, d);
    if (y > 0) push(i - w, d);
  }
  return dist;
}

function opaqueDistance(png) {
  const { width: w, height: h, data } = png;
  const dist = new Int16Array(w * h);
  dist.fill(32767);
  const q = [];
  let head = 0;
  const push = (i, d) => {
    if (d >= dist[i]) return;
    dist[i] = d;
    q.push(i);
  };
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] >= A_IN) push(i, 0);
  }
  while (head < q.length) {
    const i = q[head++];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    if (x + 1 < w) push(i + 1, d);
    if (x > 0) push(i - 1, d);
    if (y + 1 < h) push(i + w, d);
    if (y > 0) push(i - w, d);
  }
  return dist;
}

function cutStats(png) {
  const { width: w, height: h, data } = png;
  const dist = exteriorDistance(png);
  let n = 0;
  let paper = 0;
  const rgb = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 160) continue;
    if (dist[i] < 1 || dist[i] > 8) continue;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    n += 1;
    rgb[0] += r;
    rgb[1] += g;
    rgb[2] += b;
    if (isPaper(r, g, b)) paper += 1;
  }
  const avg = n ? { r: Math.round(rgb[0] / n), g: Math.round(rgb[1] / n), b: Math.round(rgb[2] / n) } : null;
  return {
    n,
    paperPct: n ? paper / n : 0,
    rgb: avg,
    L: avg ? Math.round(luma(avg.r, avg.g, avg.b)) : 0,
    w,
    h,
  };
}

function measureRefRim(png) {
  const { width: w, height: h, data } = png;
  const dist = exteriorDistance(png);
  const widths = [];
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 180 || dist[i] !== 1) continue;
      let best = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let d = 0;
        let xx = x;
        let yy = y;
        while (d < 48) {
          xx += dx;
          yy += dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
          const j = yy * w + xx;
          const r = data[j * 4];
          const g = data[j * 4 + 1];
          const b = data[j * 4 + 2];
          if (data[j * 4 + 3] < 80) break;
          if (!isPaper(r, g, b) && luma(r, g, b) < 140) break;
          if (!isPaper(r, g, b) && chroma(r, g, b) > 55) break;
          d += 1;
        }
        if (d > best) best = d;
      }
      if (best >= 6 && best <= 40) widths.push(best);
    }
  }
  widths.sort((a, b) => a - b);
  if (!widths.length) return 22;
  return widths[Math.floor(widths.length * 0.45)];
}

function padPng(png, pad) {
  const out = new PNG({ width: png.width + pad * 2, height: png.height + pad * 2 });
  out.data.fill(0);
  for (let y = 0; y < png.height; y++) {
    png.data.copy(out.data, ((y + pad) * out.width + pad) * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return out;
}

function addRim(png, rim) {
  const fringe = 3;
  const need = rim + 4;
  const { data, width: w0, height: h0 } = png;
  let minX = w0;
  let minY = h0;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      if (data[(y * w0 + x) * 4 + 3] < A_IN) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const pad = Math.max(0, need - minX, need - minY, need - (w0 - 1 - maxX), need - (h0 - 1 - maxY));
  const work = pad ? padPng(png, pad) : png;
  const { width: w, height: h, data: px } = work;
  const distExt = exteriorDistance(work);
  const distOut = opaqueDistance(work);
  const aa = 2;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = px[o + 3];
    if (a >= A_IN && distExt[i] > 0 && distExt[i] <= fringe && !isPaper(px[o], px[o + 1], px[o + 2])) {
      px[o] = CREAM.r;
      px[o + 1] = CREAM.g;
      px[o + 2] = CREAM.b;
    }
    if (distOut[i] > 0 && distOut[i] <= rim) {
      const edge = rim - distOut[i];
      const aaA = edge >= aa ? 255 : Math.round(255 * ((edge + 0.5) / aa));
      if (aaA > a) {
        px[o] = CREAM.r;
        px[o + 1] = CREAM.g;
        px[o + 2] = CREAM.b;
        px[o + 3] = aaA;
      }
    }
  }
  return work;
}

const ref = loadPng(join(STICKER_DIR, 'snipers-sight.png'));
const refRim = Math.max(18, Math.round(measureRefRim(ref)));
console.log(`Sniper rim ${refRim}px cream ${CREAM.r},${CREAM.g},${CREAM.b} ${ref.width}x${ref.height}`);

const names = readdirSync(STICKER_DIR)
  .filter((n) => n.endsWith('.png'))
  .map((n) => n.replace(/\.png$/i, ''))
  .filter((id) => OFFICIAL.has(id) && (!only.size || only.has(id)))
  .sort();

let needN = 0;
let okN = 0;
for (const id of names) {
  const src = join(STICKER_DIR, `${id}.png`);
  const png = loadPng(src);
  const before = cutStats(png);
  const rim = Math.max(16, Math.round(refRim * Math.min(png.width, png.height) / Math.min(ref.width, ref.height)));
  const needs = NEED_RIM.has(id);
  if (needs) needN += 1;
  else okN += 1;
  console.log(
    `${id.padEnd(22)} ${String(png.width).padStart(4)}x${String(png.height).padStart(4)} paper=${(before.paperPct * 100).toFixed(0).padStart(3)}% L=${String(before.L).padStart(3)} cut=${before.rgb ? `${before.rgb.r},${before.rgb.g},${before.rgb.b}` : '—'} rim=${String(rim).padStart(2)} ${needs ? 'RIM' : 'ok'}`,
  );
  if (!apply || !needs) continue;
  writeFileSync(src, PNG.sync.write(addRim(png, rim)));
}

console.log(`\n${okN} already die-cut, ${needN} need cream rim.`);
if (!apply) console.log('Re-run with --apply to write rims.');
