import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const TEMPLATE = `${ASSETS}/plate-sticker-page-empty.png`;
const TABLE = `${ROOT}/public/art/ui/plate-sticker.jpg`;
const STICKERS = `${ROOT}/public/art/stickers`;

const PICKS = [
  { id: 'lucky-charm', x: 0.28, y: 0.34, s: 0.22, r: -14 },
  { id: 'life-potion', x: 0.62, y: 0.32, s: 0.22, r: 8 },
  { id: 'fireball', x: 0.17, y: 0.42, s: 0.24, r: -12 },
  { id: 'lightning-bolt', x: 0.40, y: 0.38, s: 0.22, r: 12 },
  { id: 'painted-target', x: 0.78, y: 0.44, s: 0.22, r: 10 },
  { id: 'steel-sword', x: 0.20, y: 0.54, s: 0.24, r: -34 },
  { id: 'bloodied-crown', x: 0.42, y: 0.52, s: 0.24, r: -4 },
  { id: 'cyclops-eye', x: 0.60, y: 0.50, s: 0.22, r: 8 },
  { id: 'fur-armor', x: 0.78, y: 0.56, s: 0.23, r: 6 },
  { id: 'boom-stick', x: 0.18, y: 0.70, s: 0.26, r: 8 },
  { id: 'dragons-breath', x: 0.42, y: 0.74, s: 0.30, r: 5 },
  { id: 'rabbits-foot', x: 0.74, y: 0.66, s: 0.24, r: -10 },
];

function decodeImage(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function cloneImg(img) {
  return { width: img.width, height: img.height, data: Buffer.from(img.data) };
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

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
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

function artBox(img) {
  const { width: w, height: h, data } = img;
  let gap = -1;
  for (let y = Math.round(h * 0.46); y < Math.round(h * 0.58); y++) {
    let dark = 0;
    const x0 = Math.round(w * 0.12);
    const x1 = Math.round(w * 0.88);
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4;
      if (luma(data[o], data[o + 1], data[o + 2]) < 48) dark++;
    }
    if (dark / (x1 - x0) > 0.62) {
      gap = y;
      break;
    }
  }
  let split = gap > 0 ? gap : Math.round(h * 0.5);
  if (gap > 0) {
    for (let y = gap; y < Math.round(h * 0.64); y++) {
      let cream = 0;
      const x0 = Math.round(w * 0.12);
      const x1 = Math.round(w * 0.88);
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        if (luma(data[o], data[o + 1], data[o + 2]) > 170) cream++;
      }
      if (cream / (x1 - x0) > 0.7) {
        split = y;
        break;
      }
    }
  }
  return { l: Math.round(w * 0.042), t: Math.round(h * 0.026), r: Math.round(w * 0.958), b: split - 6 };
}

function crop(src, box) {
  const w = box.r - box.l;
  const h = box.b - box.t;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    src.data.copy(data, y * w * 4, ((box.t + y) * src.width + box.l) * 4, ((box.t + y) * src.width + box.l + w) * 4);
  }
  return { width: w, height: h, data };
}

function isLantern(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  return ny < 0.2 && (nx < 0.2 || nx > 0.78);
}

function isWax(r, g, b) {
  return r > 70 && r > g + 22 && r > b + 18 && luma(r, g, b) < 110;
}

function isWood(r, g, b) {
  const L = luma(r, g, b);
  if (L < 12 || L > 92) return false;
  if (isWax(r, g, b)) return false;
  return r > b + 8 && r >= g - 4 && g >= b - 6 && r - b < 90;
}

function isOldSticker(r, g, b) {
  if (isWax(r, g, b)) return false;
  const L = luma(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (g > r + 10 && g > 58 && L > 42) return true;
  if (L > 72) return true;
  if (L > 58 && chroma < 78 && r > 70) return true;
  if (r > 150 && g > 120 && b < 140) return true;
  return false;
}

function cleanTable(src) {
  const { width: w, height: h, data } = src;
  const wood = [];
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (isLantern(x, y, w, h) || isWax(r, g, b)) continue;
      if (isWood(r, g, b) && (x + y) % 2 === 0) wood.push([r, g, b]);
      if (isOldSticker(r, g, b)) mask[y * w + x] = 1;
    }
  }
  const grown = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (isLantern(x, y, w, h)) continue;
      if (
        mask[y * w + x] ||
        mask[y * w + x - 1] ||
        mask[y * w + x + 1] ||
        mask[(y - 1) * w + x] ||
        mask[(y + 1) * w + x]
      ) {
        grown[y * w + x] = 1;
      }
    }
  }
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grown[y * w + x] || !wood.length) continue;
      const o = (y * w + x) * 4;
      const s = wood[(x * 17 + y * 29 + ((x * y) >> 3)) % wood.length];
      const t = wood[(x * 11 + y * 41 + 83) % wood.length];
      out[o] = (s[0] * 3 + t[0]) >> 2;
      out[o + 1] = (s[1] * 3 + t[1]) >> 2;
      out[o + 2] = (s[2] * 3 + t[2]) >> 2;
    }
  }
  return { width: w, height: h, data: out };
}

function fillArt(dst, box, src) {
  const dw = box.r - box.l;
  const dh = box.b - box.t;
  for (let y = box.t; y < box.b; y++) {
    for (let x = box.l; x < box.r; x++) {
      const pix = sample(src, ((x - box.l + 0.5) * src.width) / dw - 0.5, ((y - box.t + 0.5) * src.height) / dh - 0.5);
      const o = (y * dst.width + x) * 4;
      dst.data[o] = Math.round(pix[0]);
      dst.data[o + 1] = Math.round(pix[1]);
      dst.data[o + 2] = Math.round(pix[2]);
      dst.data[o + 3] = 255;
    }
  }
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

function tableQuad(cx, cy, sw, sh, deg, y01) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const flatten = 0.50 + 0.26 * y01;
  const keystone = 0.26 + 0.16 * (1 - y01);
  const corners = [];
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const lx = (u - 0.5) * sw;
    const ly = (v - 0.5) * sh;
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    const p = 1 / (1 + keystone * (1 - v));
    corners.push({
      x: cx + rx * p,
      y: cy + ry * p * flatten,
    });
  }
  return corners;
}

function quadBounds(quad, pad = 8) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of quad) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: Math.floor(minX - pad),
    minY: Math.floor(minY - pad),
    maxX: Math.ceil(maxX + pad),
    maxY: Math.ceil(maxY + pad),
  };
}

function blitOnTable(dst, src, cx, cy, scale, deg, y01, shadow, clip) {
  const box = contentBox(src);
  const sw = box.w * scale;
  const sh = box.h * scale;
  const ox = shadow ? -5 : 0;
  const oy = shadow ? 7 : 0;
  const quad = tableQuad(cx + ox, cy + oy, sw, sh, deg, y01);
  const b = quadBounds(quad, 10);
  const [p0, p1, p2, p3] = quad;

  for (let y = b.minY; y <= b.maxY; y++) {
    if (y < clip.t || y >= clip.b) continue;
    for (let x = b.minX; x <= b.maxX; x++) {
      if (x < clip.l || x >= clip.r) continue;
      const uv = inverseBilinear(x, y, p0, p1, p2, p3);
      if (!uv || uv.u < 0 || uv.v < 0 || uv.u > 1 || uv.v > 1) continue;
      const pix = sample(src, box.l + uv.u * box.w, box.t + uv.v * box.h);
      if (pix[3] < (shadow ? 20 : 8)) continue;
      const o = (y * dst.width + x) * 4;
      if (shadow) {
        const a = (pix[3] / 255) * 0.3;
        dst.data[o] = Math.round(dst.data[o] * (1 - a));
        dst.data[o + 1] = Math.round(dst.data[o + 1] * (1 - a));
        dst.data[o + 2] = Math.round(dst.data[o + 2] * (1 - a));
        continue;
      }
      const a = pix[3] / 255;
      dst.data[o] = Math.round(pix[0] * a + dst.data[o] * (1 - a));
      dst.data[o + 1] = Math.round(pix[1] * a + dst.data[o + 1] * (1 - a));
      dst.data[o + 2] = Math.round(pix[2] * a + dst.data[o + 2] * (1 - a));
      dst.data[o + 3] = 255;
    }
  }
}

function glueStickers(plate, box) {
  const pw = box.r - box.l;
  const ph = box.b - box.t;
  for (const pick of PICKS) {
    const src = decodeImage(`${STICKERS}/${pick.id}.png`);
    const bounds = contentBox(src);
    const cx = box.l + pick.x * pw;
    const cy = box.t + pick.y * ph;
    const persp = 0.9 + 0.22 * pick.y;
    const scale = (Math.min(pw, ph) * pick.s * persp) / Math.max(bounds.w, bounds.h);
    blitOnTable(plate, src, cx, cy, scale, pick.r, pick.y, true, box);
    blitOnTable(plate, src, cx, cy, scale, pick.r, pick.y, false, box);
  }
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
  console.log('wrote', dest);
}

const chrome = decodeImage(TEMPLATE);
const box = artBox(chrome);
console.log('art', box, `${box.r - box.l}x${box.b - box.t}`);

const emptyTable = decodeImage(`${ASSETS}/plate-sticker-table-empty-raw.png`);
const tableCrop = crop(emptyTable, {
  l: Math.round(emptyTable.width * 0.02),
  t: Math.round(emptyTable.height * 0.1),
  r: Math.round(emptyTable.width * 0.98),
  b: Math.round(emptyTable.height * 0.66),
});
const tablePlate = cloneImg(chrome);
fillArt(tablePlate, box, tableCrop);
glueStickers(tablePlate, box);
writePng(tablePlate, `${ASSETS}/plate-sticker-on-table.png`);
