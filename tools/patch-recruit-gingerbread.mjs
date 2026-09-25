import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';

const MARKET =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/art-recruit-market-4.png';
const MAN =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/art-recruit-gingerbread.png';
const DEST =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/art-recruit-market-5.png';
const KEY = [0, 254, 102];

function decodeImage(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  throw new Error('expected jpeg ' + path);
}

function keyDist(r, g, b) {
  return Math.hypot(r - KEY[0], g - KEY[1], b - KEY[2]);
}

function isFlatGreen(r, g, b) {
  const d = keyDist(r, g, b);
  const e = g - Math.max(r, b);
  if (d < 70) return true;
  return e > 40 && g > 140 && g > r + 30;
}

function floodGreen(src) {
  const { width: w, height: h, data } = src;
  const mask = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i]) return;
    const o = i * 4;
    if (!isFlatGreen(data[o], data[o + 1], data[o + 2])) return;
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

function oldCookieMask(img) {
  const { width: w, height: h, data } = img;
  const cookie = (R, G, B) => R > 95 && G > 35 && B < 150 && R > G + 8 && R > B + 15 && R < 240 && G < 190;
  const seen = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  const q = [
    [288, 840],
    [360, 760],
    [300, 780],
    [250, 880],
  ];
  while (q.length) {
    const [x, y] = q.pop();
    if (x < 180 || y < 680 || x > 460 || y > 1000) continue;
    const i = y * w + x;
    if (seen[i]) continue;
    seen[i] = 1;
    const o = i * 4;
    const R = data[o];
    const G = data[o + 1];
    const B = data[o + 2];
    const red = R > 140 && G < 120 && B < 100 && R > G + 30 && R > B + 30;
    if (!cookie(R, G, B) && !red) continue;
    mask[i] = 1;
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const dil = new Uint8Array(mask);
  const rad = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          dil[yy * w + xx] = 1;
        }
      }
    }
  }
  return dil;
}

function contentBox(img, green) {
  const { width: w, height: h } = img;
  let l = w;
  let t = h;
  let r = 0;
  let b = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (green[y * w + x]) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b };
}

const market = decodeImage(MARKET);
const man = decodeImage(MAN);
const green = floodGreen(man);
const box = contentBox(man, green);
console.log('man box', box, `${box.r - box.l}x${box.b - box.t}`);

const mask = oldCookieMask(market);
let n = 0;
let ml = market.width;
let mt = market.height;
let mr = 0;
let mb = 0;
for (let i = 0; i < mask.length; i++) {
  if (!mask[i]) continue;
  n++;
  const x = i % market.width;
  const y = (i / market.width) | 0;
  if (x < ml) ml = x;
  if (y < mt) mt = y;
  if (x > mr) mr = x;
  if (y > mb) mb = y;
}
console.log('old cookie', n, ml, mt, mr, mb);

const out = Buffer.from(market.data);
const covered = new Uint8Array(market.width * market.height);
const targetH = 300;
const scale = targetH / (box.b - box.t + 1);
const destBottom = 978;
const destCx = 318;
const destTop = destBottom - targetH;
const destW = (box.r - box.l + 1) * scale;
const destLeft = Math.round(destCx - destW / 2);

function sampleMan(sx, sy) {
  const x0 = Math.max(0, Math.min(man.width - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(man.height - 1, Math.floor(sy)));
  const o = (y0 * man.width + x0) * 4;
  return [man.data[o], man.data[o + 1], man.data[o + 2], y0 * man.width + x0];
}

for (let y = destTop; y < destBottom; y++) {
  for (let x = destLeft; x < destLeft + Math.ceil(destW); x++) {
    if (x < 0 || y < 0 || x >= market.width || y >= market.height) continue;
    const sx = box.l + (x - destLeft) / scale;
    const sy = box.t + (y - destTop) / scale;
    const [R, G, B, mi] = sampleMan(sx, sy);
    if (green[mi] || isFlatGreen(R, G, B)) continue;
    const d = keyDist(R, G, B);
    if (d < 70) continue;
    covered[y * market.width + x] = 1;
  }
}

const stone = { x: 40, y: 948, w: 150, h: 72 };
const holes = [];
for (let y = 0; y < market.height; y++) {
  for (let x = 0; x < market.width; x++) {
    const i = y * market.width + x;
    if (!mask[i] || covered[i]) continue;
    holes.push(i);
    const sx = stone.x + ((x * 7 + y * 3) % stone.w);
    const sy = stone.y + ((y * 5 + x * 2) % stone.h);
    const so = (sy * market.width + sx) * 4;
    const o = i * 4;
    out[o] = market.data[so];
    out[o + 1] = market.data[so + 1];
    out[o + 2] = market.data[so + 2];
  }
}
console.log('leftover filled', holes.length);

for (let y = destTop; y < destBottom; y++) {
  for (let x = destLeft; x < destLeft + Math.ceil(destW); x++) {
    if (x < 0 || y < 0 || x >= market.width || y >= market.height) continue;
    const sx = box.l + (x - destLeft) / scale;
    const sy = box.t + (y - destTop) / scale;
    const [R, G, B, mi] = sampleMan(sx, sy);
    if (green[mi] || isFlatGreen(R, G, B)) continue;
    const d = keyDist(R, G, B);
    const a = d > 110 ? 1 : Math.max(0, (d - 55) / 55);
    if (a <= 0) continue;
    const oo = (y * market.width + x) * 4;
    out[oo] = Math.round(out[oo] * (1 - a) + R * 0.94 * a);
    out[oo + 1] = Math.round(out[oo + 1] * (1 - a) + G * 0.86 * a);
    out[oo + 2] = Math.round(out[oo + 2] * (1 - a) + B * 0.74 * a);
    out[oo + 3] = 255;
  }
}

const jpg = encodeJpeg({ data: out, width: market.width, height: market.height }, 92);
writeFileSync(DEST, jpg.data);
console.log('wrote', DEST);
