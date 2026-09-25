import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/';
const OUT = 'C:/Users/copan/Desktop/Once Upon a Scam/assets/recruit-stickers';

const NAMES = [
  'woodland-girl',
  'hunter',
  'gingerbread-man',
  'tin-soldier',
  'drunken-giant',
  'frog-prince',
  'pied-piper',
  'puss-in-boots',
  'little-fairy',
  'golden-goose',
  'village-fool',
  'royal-herald',
  'farm-boy',
  'prince-charming',
  'tiny-brave-mouse',
];

function isNavy(r, g, b) {
  return b > 68 && r < 55 && g < 95 && b > r + 32 && b > g + 18;
}

function floodNavy(img) {
  const { width: w, height: h, data } = img;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if ((r + g + b) / 3 < 32 && b < r + 18) ink[i] = 1;
  }
  const bar = new Uint8Array(ink);
  const rad = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          bar[yy * w + xx] = 1;
        }
      }
    }
  }
  const mask = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i] || bar[i]) return;
    const o = i * 4;
    if (!isNavy(data[o], data[o + 1], data[o + 2])) return;
    mask[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const x = p % w;
    const y = ((p - x) / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return mask;
}

function nearOutside(mask, w, h, x, y) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || mask[yy * w + xx]) return true;
    }
  }
  return false;
}

mkdirSync(OUT, { recursive: true });

for (const name of NAMES) {
  const buf = readFileSync(ROOT + 'draw-' + name + '.png');
  const jpg = decodeJpeg(buf, { useTArray: true });
  const img = { width: jpg.width, height: jpg.height, data: jpg.data };
  const bg = floodNavy(img);
  const { width: w, height: h, data } = img;
  let l = w;
  let t = h;
  let r = 0;
  let b = 0;
  const keep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const R = data[o];
      const G = data[o + 1];
      const B = data[o + 2];
      if (bg[i]) continue;
      if (isNavy(R, G, B) && nearOutside(bg, w, h, x, y)) continue;
      keep[i] = 1;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  const pad = 8;
  l = Math.max(0, l - pad);
  t = Math.max(0, t - pad);
  r = Math.min(w - 1, r + pad);
  b = Math.min(h - 1, b + pad);
  const pw = r - l + 1;
  const ph = b - t + 1;
  const png = new PNG({ width: pw, height: ph });
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = x + l;
      const sy = y + t;
      const si = sy * w + sx;
      const o = (y * pw + x) * 4;
      if (!keep[si]) {
        png.data[o + 3] = 0;
        continue;
      }
      let R = data[si * 4];
      let G = data[si * 4 + 1];
      let B = data[si * 4 + 2];
      if (isNavy(R, G, B)) {
        R = 24;
        G = 58;
        B = 145;
      }
      png.data[o] = R;
      png.data[o + 1] = G;
      png.data[o + 2] = B;
      png.data[o + 3] = 255;
    }
  }
  writeFileSync(OUT + '/' + name + '.png', PNG.sync.write(png));
  console.log(name, pw + 'x' + ph);
}
console.log('wrote', OUT);
