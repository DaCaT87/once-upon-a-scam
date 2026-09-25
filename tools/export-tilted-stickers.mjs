import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const SRC = `${ROOT}/public/art/stickers`;
const DEST = `${ROOT}/assets/sticker-tilts`;
const SHEET = `${ROOT}/assets/sticker-tilts-sheet.png`;
const TARGET = 560;
const FLATTEN = 0.46;
const KEYSTONE = 0.42;

const IDS = readdirSync(SRC)
  .filter((name) => name.endsWith('.png'))
  .map((name) => name.replace(/\.png$/, ''))
  .sort();

function decodeImage(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

function sample(img, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    const xx = Math.max(0, Math.min(img.width - 1, ix));
    const yy = Math.max(0, Math.min(img.height - 1, iy));
    const o = (yy * img.width + xx) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

function contentBox(img) {
  const { width: w, height: h, data } = img;
  let l = w;
  let t = h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 12) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b, w: r - l + 1, h: b - t + 1 };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function inverseBilinear(px, py, p0, p1, p2, p3) {
  const e = sub(p1, p0);
  const f = sub(p3, p0);
  const g = sub(sub(add(p0, p2), p1), p3);
  const h = { x: px - p0.x, y: py - p0.y };
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  let v;
  if (Math.abs(k2) < 1e-5) {
    if (Math.abs(k1) < 1e-5) return null;
    v = -k0 / k1;
  } else {
    const disc = k1 * k1 - 4 * k2 * k0;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const v1 = (-k1 - root) / (2 * k2);
    const v2 = (-k1 + root) / (2 * k2);
    v = v1 >= -0.04 && v1 <= 1.04 ? v1 : v2;
  }
  if (v < -0.04 || v > 1.04) return null;
  const den = e.x + g.x * v;
  const u = Math.abs(den) > Math.abs(e.y + g.y * v) ? (h.x - f.x * v) / den : (h.y - f.y * v) / (e.y + g.y * v);
  if (u < -0.04 || u > 1.04) return null;
  return { u, v };
}

function tableQuad(cx, cy, sw, sh) {
  const flatten = FLATTEN;
  const keystone = KEYSTONE;
  const corners = [];
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const lx = (u - 0.5) * sw;
    const ly = (v - 0.5) * sh;
    const p = 1 / (1 + keystone * (1 - v));
    corners.push({
      x: cx + lx * p,
      y: cy + ly * p * flatten,
    });
  }
  return corners;
}

function crop(src, box) {
  const w = box.r - box.l + 1;
  const h = box.b - box.t + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    src.data.copy(data, y * w * 4, ((box.t + y) * src.width + box.l) * 4, ((box.t + y) * src.width + box.l + w) * 4);
  }
  return { width: w, height: h, data };
}

function tiltSticker(src) {
  const box = contentBox(src);
  const scale = TARGET / Math.max(box.w, box.h);
  const sw = box.w * scale;
  const sh = box.h * scale;
  const pad = 64;
  const w = Math.ceil(sw * 1.4 + pad * 2);
  const h = Math.ceil(sh * 1.1 + pad * 2);
  const dst = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  const cx = w / 2;
  const cy = h / 2;
  const [p0, p1, p2, p3] = tableQuad(cx, cy, sw, sh);
  const xs = [p0, p1, p2, p3].map((p) => p.x);
  const ys = [p0, p1, p2, p3].map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs) - 4));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs) + 4));
  const minY = Math.max(0, Math.floor(Math.min(...ys) - 4));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys) + 4));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const uv = inverseBilinear(x, y, p0, p1, p2, p3);
      if (!uv || uv.u < 0 || uv.v < 0 || uv.u > 1 || uv.v > 1) continue;
      const pix = sample(src, box.l + uv.u * box.w, box.t + uv.v * box.h);
      if (pix[3] < 8) continue;
      const o = (y * w + x) * 4;
      dst.data[o] = Math.round(pix[0]);
      dst.data[o + 1] = Math.round(pix[1]);
      dst.data[o + 2] = Math.round(pix[2]);
      dst.data[o + 3] = Math.round(pix[3]);
    }
  }
  return crop(dst, contentBox(dst));
}

function fitCell(src, cw, ch) {
  const scale = Math.min((cw - 24) / src.width, (ch - 24) / src.height);
  const dw = Math.max(1, Math.round(src.width * scale));
  const dh = Math.max(1, Math.round(src.height * scale));
  const ox = Math.round((cw - dw) / 2);
  const oy = Math.round((ch - dh) / 2);
  return { src, dw, dh, ox, oy };
}

function blitFit(dst, placed, x0, y0) {
  const { src, dw, dh, ox, oy } = placed;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const pix = sample(src, ((x + 0.5) * src.width) / dw - 0.5, ((y + 0.5) * src.height) / dh - 0.5);
      if (pix[3] < 8) continue;
      const o = ((y0 + oy + y) * dst.width + (x0 + ox + x)) * 4;
      const a = pix[3] / 255;
      dst.data[o] = Math.round(pix[0] * a + dst.data[o] * (1 - a));
      dst.data[o + 1] = Math.round(pix[1] * a + dst.data[o + 1] * (1 - a));
      dst.data[o + 2] = Math.round(pix[2] * a + dst.data[o + 2] * (1 - a));
      dst.data[o + 3] = 255;
    }
  }
}

mkdirSync(DEST, { recursive: true });
const tilted = [];
for (const id of IDS) {
  const out = tiltSticker(decodeImage(`${SRC}/${id}.png`));
  const dest = `${DEST}/${id}.png`;
  writePng(out, dest);
  tilted.push(out);
  console.log(id, `${out.width}x${out.height}`);
}

const cols = 7;
const rows = Math.ceil(tilted.length / cols);
const cell = 180;
const sheet = { width: cols * cell, height: rows * cell, data: Buffer.alloc(cols * cell * rows * cell * 4) };
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 36;
  sheet.data[i + 1] = 24;
  sheet.data[i + 2] = 16;
  sheet.data[i + 3] = 255;
}
tilted.forEach((img, i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  blitFit(sheet, fitCell(img, cell, cell), col * cell, row * cell);
});
writePng(sheet, SHEET);
console.log('sheet', SHEET);
