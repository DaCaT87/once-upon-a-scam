import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';
const FILES = [
  ['clone-idle.png', 'event-cloning-chamber.png'],
  ['clone-inside.png', 'event-cloning-chamber-inside.png'],
  ['clone-exit.png', 'event-cloning-chamber-exit.png'],
];
const CANVAS_W = 864;
const CANVAS_H = 1152;

function decodeImage(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function isTank(r, g, b) {
  return g > 90 && g > r + 35 && g > b + 15;
}

function isBone(r, g, b) {
  return r > 155 && g > 125 && b < 145 && r > b + 35 && g > b + 20 && Math.abs(r - g) < 55;
}

function boneMeasure(img) {
  const { width: w, height: h, data } = img;
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  let n = 0;
  const topLimit = 220;
  for (let y = 0; y < topLimit; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!isBone(data[o], data[o + 1], data[o + 2])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
  }
  return { l: minX, t: minY, r: maxX, b: maxY, w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, n };
}

function tankMeasure(img) {
  const { width: w, height: h, data } = img;
  const rows = [];
  let maxCount = 0;
  for (let y = 0; y < h; y++) {
    let l = w;
    let r = -1;
    let n = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!isTank(data[o], data[o + 1], data[o + 2])) continue;
      if (x < l) l = x;
      if (x > r) r = x;
      n++;
    }
    rows.push({ l, r, n });
    if (n > maxCount) maxCount = n;
  }
  let bottom = 0;
  for (let y = h - 1; y >= 0; y--) {
    if (rows[y].n > maxCount * 0.35) {
      bottom = y;
      break;
    }
  }
  const yBand = Math.max(0, bottom - 24);
  let best = rows[bottom];
  for (let y = yBand; y <= bottom; y++) {
    const ww = rows[y].r - rows[y].l;
    const bestW = best.r - best.l;
    if (rows[y].n > maxCount * 0.25 && ww > bestW) best = rows[y];
  }
  return {
    l: best.l,
    t: yBand,
    r: best.r,
    b: bottom,
    w: best.r - best.l + 1,
    h: bottom - yBand + 1,
    cx: (best.l + best.r) / 2,
    cy: bottom,
    n: maxCount,
  };
}

function sample(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width - 1 || y >= img.height - 1) return [0, 0, 0, 255];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    const o = (iy * img.width + ix) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3] ?? 255];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0, 255];
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

function place(src, measure, scale, destCx, destCy) {
  const data = Buffer.alloc(CANVAS_W * CANVAS_H * 4, 0);
  for (let i = 0; i < CANVAS_W * CANVAS_H; i++) data[i * 4 + 3] = 255;
  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) {
      const sx = measure.cx + (x + 0.5 - destCx) / scale - 0.5;
      const sy = measure.cy + (y + 0.5 - destCy) / scale - 0.5;
      const pix = sample(src, sx, sy);
      const o = (y * CANVAS_W + x) * 4;
      data[o] = Math.round(pix[0]);
      data[o + 1] = Math.round(pix[1]);
      data[o + 2] = Math.round(pix[2]);
      data[o + 3] = 255;
    }
  }
  return { width: CANVAS_W, height: CANVAS_H, data };
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

const imgs = FILES.map(([src]) => {
  const img = decodeImage(`${ASSETS}/${src}`);
  return { src, img, measure: boneMeasure(img), tank: tankMeasure(img) };
});
for (const item of imgs) console.log('before', item.src, item.img.width + 'x' + item.img.height, 'bone', item.measure, 'tank', item.tank);

const ref = imgs[0].measure;
const destCx = ref.cx;
const destCy = ref.cy;

for (let i = 0; i < imgs.length; i++) {
  const item = imgs[i];
  const scale = ref.w / item.measure.w;
  const aligned = place(item.img, item.measure, scale, destCx, destCy);
  writePng(aligned, `${UI}/${FILES[i][1]}`);
  const check = tankMeasure(aligned);
  console.log('after', FILES[i][1], { scale: +scale.toFixed(3), w: check.w, h: check.h, cx: +check.cx.toFixed(1), cy: +check.cy.toFixed(1) });
}
