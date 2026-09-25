import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';

const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';
const FILES = [
  'event-witch-oven.jpg',
  'event-witch-oven-open.jpg',
  'event-witch-oven-fed.jpg',
];
const CANVAS_W = 864;
const CANVAS_H = 1152;

function decodeImage(path) {
  const jpg = decodeJpeg(readFileSync(path), { useTArray: true });
  return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
}

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function isMetal(r, g, b) {
  const L = luma(r, g, b);
  if (L < 36) return false;
  if (r > 155 && r > g + 28 && r > b + 28) return false;
  return true;
}

/** Widest iron row in the body band — ignores chimney fire and the floor oval. */
function bodyMeasure(img) {
  const { width: w, height: h, data } = img;
  const y0 = Math.round(h * 0.32);
  const y1 = Math.round(h * 0.82);
  let bestW = 0;
  let bestY = 0;
  let bestL = 0;
  let bestR = 0;
  let top = h;
  let bot = 0;
  for (let y = y0; y < y1; y++) {
    let l = w;
    let r = -1;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!isMetal(data[o], data[o + 1], data[o + 2])) continue;
      if (x < l) l = x;
      if (x > r) r = x;
    }
    const ww = r >= 0 ? r - l + 1 : 0;
    if (ww > bestW) {
      bestW = ww;
      bestY = y;
      bestL = l;
      bestR = r;
    }
    if (ww > 280) {
      if (y < top) top = y;
      if (y > bot) bot = y;
    }
  }
  return {
    w: bestW,
    y: bestY,
    cx: (bestL + bestR) / 2,
    top,
    bot,
    cy: (top + bot) / 2,
  };
}

function sample(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width - 1 || y >= img.height - 1) return [0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    const o = (iy * img.width + ix) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

function place(src, measure, scale, destCx, destCy) {
  const out = Buffer.alloc(CANVAS_W * CANVAS_H * 4, 0);
  for (let i = 0; i < CANVAS_W * CANVAS_H; i++) out[i * 4 + 3] = 255;
  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) {
      const sx = measure.cx + (x + 0.5 - destCx) / scale;
      const sy = measure.cy + (y + 0.5 - destCy) / scale;
      const pix = sample(src, sx - 0.5, sy - 0.5);
      const o = (y * CANVAS_W + x) * 4;
      out[o] = Math.round(pix[0]);
      out[o + 1] = Math.round(pix[1]);
      out[o + 2] = Math.round(pix[2]);
    }
  }
  return { width: CANVAS_W, height: CANVAS_H, data: out };
}

const imgs = FILES.map((name) => {
  const img = decodeImage(`${UI}/${name}`);
  return { name, img, measure: bodyMeasure(img) };
});

for (const item of imgs) {
  console.log('before', item.name, item.measure);
}

const ref = imgs[0].measure;
const destCx = CANVAS_W / 2;
const destCy = CANVAS_H * 0.58;

for (const item of imgs) {
  const scale = ref.w / item.measure.w;
  const aligned = place(item.img, item.measure, scale, destCx, destCy);
  writeFileSync(
    `${UI}/${item.name}`,
    encodeJpeg({ data: aligned.data, width: CANVAS_W, height: CANVAS_H }, 92).data,
  );
  const check = bodyMeasure(aligned);
  console.log('after', item.name, { scale: +scale.toFixed(3), ...check, dw: check.w - ref.w });
}
