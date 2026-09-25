import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SRC = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/plate-cloning-chamber.png';
const DEST = SRC;

function luma(r, g, b) {
  return (r + g + b) / 3;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clamp(v, lo = 0, hi = 255) {
  return Math.max(lo, Math.min(hi, v));
}

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const png = PNG.sync.read(readFileSync(SRC));
const { width: w, height: h, data } = png;
const artTop = Math.round(h * 0.03);
const artBot = Math.round(h * 0.565);
const cx = w * 0.5;
const tankY = artTop + (artBot - artTop) * 0.42;
const floorY = artTop + (artBot - artTop) * 0.88;

for (let y = artTop; y < artBot; y++) {
  const ny = (y - artTop) / Math.max(1, artBot - artTop);
  for (let x = 18; x < w - 18; x++) {
    const o = (y * w + x) * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    if (a < 16) continue;
    if (g - Math.max(r, b) > 18) continue;
    const L = luma(r, g, b);
    const C = chroma(r, g, b);
    const voidDark = L < 46 && C < 22;
    const floorDark = L < 52 && C < 32 && r >= g - 2;
    if (!voidDark && !floorDark) continue;

    const nx = (x - cx) / (w * 0.5);
    const vignette = Math.min(1, nx * nx * 1.15 + (ny - 0.28) * (ny - 0.28) * 0.85);
    const centerOpen = Math.exp(-((x - cx) ** 2) / (2 * (w * 0.22) ** 2) - ((y - tankY) ** 2) / (2 * ((artBot - artTop) * 0.38) ** 2));
    const ground = Math.exp(-((x - cx) ** 2) / (2 * (w * 0.28) ** 2) - ((y - floorY) ** 2) / (2 * ((artBot - artTop) * 0.1) ** 2)) * Math.max(0, (ny - 0.62) / 0.38);
    const grain = (hash(x, y) - 0.5) * 7;

    let nr = 18 + centerOpen * 16 - vignette * 10 + ground * 22 + grain;
    let ng = 16 + centerOpen * 12 - vignette * 9 + ground * 20 + grain;
    let nb = 20 + centerOpen * 10 - vignette * 8 + ground * 16 + grain * 0.6;
    nr += ground * 6;
    ng += ground * 18;
    nb += ground * 4;

    const mix = voidDark ? 0.88 : 0.62;
    data[o] = Math.round(clamp(r * (1 - mix) + nr * mix));
    data[o + 1] = Math.round(clamp(g * (1 - mix) + ng * mix));
    data[o + 2] = Math.round(clamp(b * (1 - mix) + nb * mix));
  }
}

writeFileSync(DEST, PNG.sync.write(png));
console.log('shaped', w + 'x' + h);
