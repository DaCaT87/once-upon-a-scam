import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CARD_W = 642;
const CARD_H = 972;
const KEY = [0, 254, 102];
const SRC =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/cloning-chamber-floor.png';
const DEST = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/plate-cloning-chamber.png';

function decodeImage(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: Buffer.from(png.data) };
  }
  const jpg = decodeJpeg(buf, { useTArray: true });
  return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
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

function keyDist(r, g, b) {
  return Math.hypot(r - KEY[0], g - KEY[1], b - KEY[2]);
}

function luma(r, g, b) {
  return (r + g + b) / 3;
}

function excessGreen(r, g, b) {
  return g - Math.max(r, b);
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

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

const framed = decodeImage(readFileSync(SRC));
const keyed = cutout(framed, floodGreen(framed));
const plate = scaleTo(crop(keyed, contentBox(keyed)), CARD_W, CARD_H);
writePng(plate, DEST);
console.log('cloning-chamber', `${framed.width}x${framed.height}`, '->', `${plate.width}x${plate.height}`);
