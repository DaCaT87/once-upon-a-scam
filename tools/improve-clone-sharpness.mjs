import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const UI = `${ROOT}/public/art/ui`;
const CARD_W = 642;
const CARD_H = 972;
const KEY = [0, 254, 102];

function decodeImage(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: Buffer.from(png.data) };
  }
  const jpg = decodeJpeg(buf, { useTArray: true });
  return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
  console.log('wrote', dest.split('/').pop(), `${img.width}x${img.height}`);
}

function sample(data, width, height, x, y) {
  const ix = Math.max(0, Math.min(width - 1, x));
  const iy = Math.max(0, Math.min(height - 1, y));
  const o = (iy * width + ix) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function bilinear(src, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = sample(src.data, src.width, src.height, x0, y0);
  const b = sample(src.data, src.width, src.height, x0 + 1, y0);
  const c = sample(src.data, src.width, src.height, x0, y0 + 1);
  const d = sample(src.data, src.width, src.height, x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function excessGreen(r, g, b) {
  return g - Math.max(r, b);
}

function keyDist(r, g, b) {
  return Math.hypot(r - KEY[0], g - KEY[1], b - KEY[2]);
}

function isRealBlack(r, g, b) {
  return luma(r, g, b) < 52 && excessGreen(r, g, b) < 18;
}

function isFlatGreen(r, g, b) {
  if (isRealBlack(r, g, b)) return false;
  const d = keyDist(r, g, b);
  const e = excessGreen(r, g, b);
  if (d < 52) return true;
  return e > 26 && g > 130 && g > r + 18;
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

function cutout(src, mask) {
  const { width: w, height: h, data } = src;
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = out[o];
    const g = out[o + 1];
    const b = out[o + 2];
    if (mask[i]) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    if (isRealBlack(r, g, b)) {
      out[o + 3] = 255;
      continue;
    }
    let near = false;
    const x = i % w;
    const y = ((i - x) / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (mask[ny * w + nx]) near = true;
    }
    if (!near) {
      out[o + 3] = 255;
      continue;
    }
    const e = excessGreen(r, g, b);
    const d = keyDist(r, g, b);
    if (e > 14 || d < 90) {
      if (luma(r, g, b) < 95 && e < 40) {
        const cut = Math.max(e, 0);
        out[o + 1] = Math.max(0, g - cut);
        out[o + 2] = Math.max(0, b - Math.round(cut * 0.25));
        out[o + 3] = 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      }
      continue;
    }
    out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

function contentBox(img) {
  const { width: w, height: h, data } = img;
  let l = w;
  let t = h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 8) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b };
}

function crop(src, box) {
  const w = box.r - box.l + 1;
  const h = box.b - box.t + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    src.data.copy(
      data,
      y * w * 4,
      ((box.t + y) * src.width + box.l) * 4,
      ((box.t + y) * src.width + box.l + w) * 4,
    );
  }
  return { width: w, height: h, data };
}

function scaleTo(src, dw, dh) {
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * src.width) / dw - 0.5;
      const sy = ((y + 0.5) * src.height) / dh - 0.5;
      const pix = bilinear(src, sx, sy);
      const o = (y * dw + x) * 4;
      out.data[o] = Math.round(pix[0]);
      out.data[o + 1] = Math.round(pix[1]);
      out.data[o + 2] = Math.round(pix[2]);
      out.data[o + 3] = Math.round(pix[3]);
    }
  }
  return out;
}

function clamp(v, lo = 0, hi = 255) {
  return Math.max(lo, Math.min(hi, v));
}

/** Separable box blur of luma. */
function blurLuma(img, radius) {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = Math.max(1, radius | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        const o = (y * w + xx) * 4;
        sum += luma(data[o], data[o + 1], data[o + 2]);
        n++;
      }
      tmp[y * w + x] = sum / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        sum += tmp[yy * w + x];
        n++;
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

function unsharp(img, { amount = 0.85, radius = 1, threshold = 4, y0 = 0, y1 = null } = {}) {
  const { width: w, height: h, data } = img;
  const bot = y1 == null ? h : y1;
  const blurred = blurLuma(img, radius);
  const out = Buffer.from(data);
  for (let y = y0; y < bot; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (out[o + 3] < 16) continue;
      const L = luma(out[o], out[o + 1], out[o + 2]);
      const diff = L - blurred[i];
      if (Math.abs(diff) < threshold) continue;
      const boost = diff * amount;
      out[o] = clamp(out[o] + boost);
      out[o + 1] = clamp(out[o + 1] + boost);
      out[o + 2] = clamp(out[o + 2] + boost);
    }
  }
  return { width: w, height: h, data: out };
}

/** Flatten soft graded void to clean near-black; keep subject + green glow. */
function crispVoid(img, { artTop, artBot, left = 16, right = null } = {}) {
  const { width: w, height: h, data } = img;
  const out = Buffer.from(data);
  const x1 = right == null ? w - 16 : right;
  for (let y = artTop; y < artBot; y++) {
    const ny = (y - artTop) / Math.max(1, artBot - artTop);
    for (let x = left; x < x1; x++) {
      const o = (y * w + x) * 4;
      if (out[o + 3] < 16) continue;
      const r = out[o];
      const g = out[o + 1];
      const b = out[o + 2];
      // protect tank glow / subject chroma
      if (excessGreen(r, g, b) > 14) continue;
      if (chroma(r, g, b) > 28 && luma(r, g, b) > 40) continue;
      const L = luma(r, g, b);
      if (L > 58) continue;
      // soft floor only near bottom center, subtle and sharp (no grain fog)
      const cx = w * 0.5;
      const floorBand = Math.max(0, (ny - 0.72) / 0.28);
      const radial = Math.exp(-((x - cx) ** 2) / (2 * (w * 0.22) ** 2));
      const floor = floorBand * radial * 18;
      const target = 10 + floor;
      const mix = L < 38 ? 0.92 : 0.7;
      out[o] = Math.round(r * (1 - mix) + target * mix);
      out[o + 1] = Math.round(g * (1 - mix) + (target * 0.92) * mix);
      out[o + 2] = Math.round(b * (1 - mix) + (target * 0.88) * mix);
    }
  }
  return { width: w, height: h, data: out };
}

function localContrast(img, { amount = 0.18, y0 = 0, y1 = null } = {}) {
  const { width: w, height: h, data } = img;
  const bot = y1 == null ? h : y1;
  const out = Buffer.from(data);
  for (let y = y0; y < bot; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (out[o + 3] < 16) continue;
      const L = luma(out[o], out[o + 1], out[o + 2]);
      if (L < 28 || L > 245) continue;
      const t = (L - 128) * amount;
      out[o] = clamp(out[o] + t);
      out[o + 1] = clamp(out[o + 1] + t);
      out[o + 2] = clamp(out[o + 2] + t);
    }
  }
  return { width: w, height: h, data: out };
}

// --- Plate from clean floor source (no soft grade) ---
{
  const framed = decodeImage(readFileSync(`${ASSETS}/cloning-chamber-floor.png`));
  const keyed = cutout(framed, floodGreen(framed));
  let plate = scaleTo(crop(keyed, contentBox(keyed)), CARD_W, CARD_H);
  const artTop = Math.round(CARD_H * 0.03);
  const artBot = Math.round(CARD_H * 0.565);
  plate = crispVoid(plate, { artTop, artBot });
  plate = unsharp(plate, { amount: 1.05, radius: 1, threshold: 3, y0: artTop, y1: artBot });
  plate = localContrast(plate, { amount: 0.22, y0: artTop, y1: artBot });
  writePng(plate, `${UI}/plate-cloning-chamber.png`);
}

// --- Event frames: crisp void + sharpen ---
const FRAMES = [
  ['clone-event-idle-lit.png', 'event-cloning-chamber.png'],
  ['clone-event-inside-lit.png', 'event-cloning-chamber-inside.png'],
  ['clone-event-exit-lit.png', 'event-cloning-chamber-exit.png'],
];

for (const [src, dest] of FRAMES) {
  let img = decodeImage(readFileSync(`${ASSETS}/${src}`));
  img = crispVoid(img, { artTop: 0, artBot: img.height, left: 0, right: img.width });
  img = unsharp(img, { amount: 0.95, radius: 1, threshold: 3 });
  img = localContrast(img, { amount: 0.2 });
  writePng(img, `${UI}/${dest}`);
}

console.log('done');
