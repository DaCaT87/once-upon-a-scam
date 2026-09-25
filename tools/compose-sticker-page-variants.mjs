import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const ASSETS_CURSOR = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const OUT = `${ROOT}/assets/sticker-page-variants`;
const TEMPLATE = `${ASSETS_CURSOR}/plate-sticker-page-empty.png`;
const STICKERS = `${ROOT}/assets/sticker-straight`;

mkdirSync(OUT, { recursive: true });

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
  console.log('wrote', dest);
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

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Find cream parchment regions: top book page + bottom panel. */
function findRegions(img) {
  const { width: w, height: h, data } = img;
  const cream = (o) => {
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const L = luma(r, g, b);
    return L > 145 && r > 150 && g > 130 && b > 90 && r >= b;
  };

  // Top half book page
  let tl = w;
  let tt = h;
  let tr = -1;
  let tb = -1;
  const yTopEnd = Math.round(h * 0.52);
  for (let y = Math.round(h * 0.04); y < yTopEnd; y++) {
    for (let x = Math.round(w * 0.08); x < Math.round(w * 0.92); x++) {
      if (!cream((y * w + x) * 4)) continue;
      if (x < tl) tl = x;
      if (y < tt) tt = y;
      if (x > tr) tr = x;
      if (y > tb) tb = y;
    }
  }

  // Bottom panel
  let bl = w;
  let bt = h;
  let br = -1;
  let bb = -1;
  for (let y = Math.round(h * 0.52); y < Math.round(h * 0.96); y++) {
    for (let x = Math.round(w * 0.04); x < Math.round(w * 0.96); x++) {
      if (!cream((y * w + x) * 4)) continue;
      if (x < bl) bl = x;
      if (y < bt) bt = y;
      if (x > br) br = x;
      if (y > bb) bb = y;
    }
  }

  const pad = (box, p) => ({
    l: box.l + p,
    t: box.t + p,
    r: box.r - p,
    b: box.b - p,
    w: box.r - box.l - 2 * p,
    h: box.b - box.t - 2 * p,
  });

  const top = pad({ l: tl, t: tt, r: tr, b: tb }, 18);
  const bot = pad({ l: bl, t: bt, r: br, b: bb }, 22);
  console.log('top', top, 'bot', bot);
  return { top, bot };
}

function setPixel(dst, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
  const o = (y * dst.width + x) * 4;
  const aa = a / 255;
  dst.data[o] = Math.round(r * aa + dst.data[o] * (1 - aa));
  dst.data[o + 1] = Math.round(g * aa + dst.data[o + 1] * (1 - aa));
  dst.data[o + 2] = Math.round(b * aa + dst.data[o + 2] * (1 - aa));
  dst.data[o + 3] = 255;
}

function blitRotated(dst, src, cx, cy, scale, deg, opts = {}) {
  const box = contentBox(src);
  const sw = box.w * scale;
  const sh = box.h * scale;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const shadow = opts.shadow ?? false;
  const ox = shadow ? (opts.sx ?? 4) : 0;
  const oy = shadow ? (opts.sy ?? 6) : 0;
  const pad = Math.ceil(Math.hypot(sw, sh) / 2) + 12;

  for (let py = -pad; py <= pad; py++) {
    for (let px = -pad; px <= pad; px++) {
      const x = Math.round(cx + ox + px);
      const y = Math.round(cy + oy + py);
      if (opts.clip) {
        if (x < opts.clip.l || x >= opts.clip.r || y < opts.clip.t || y >= opts.clip.b) continue;
      }
      // inverse rotate into sticker local
      const lx = px * cos + py * sin;
      const ly = -px * sin + py * cos;
      const u = lx / sw + 0.5;
      const v = ly / sh + 0.5;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      const pix = sample(src, box.l + u * box.w, box.t + v * box.h);
      if (pix[3] < (shadow ? 24 : 10)) continue;
      if (shadow) {
        const a = (pix[3] / 255) * (opts.shadowA ?? 0.28);
        const o = (y * dst.width + x) * 4;
        if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
        dst.data[o] = Math.round(dst.data[o] * (1 - a));
        dst.data[o + 1] = Math.round(dst.data[o + 1] * (1 - a));
        dst.data[o + 2] = Math.round(dst.data[o + 2] * (1 - a));
        continue;
      }
      const a = pix[3] / 255;
      const o = (y * dst.width + x) * 4;
      if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
      dst.data[o] = Math.round(pix[0] * a + dst.data[o] * (1 - a));
      dst.data[o + 1] = Math.round(pix[1] * a + dst.data[o + 1] * (1 - a));
      dst.data[o + 2] = Math.round(pix[2] * a + dst.data[o + 2] * (1 - a));
      dst.data[o + 3] = 255;
    }
  }
}

function placeSticker(dst, cache, id, cx, cy, sizePx, deg, clip) {
  if (!cache[id]) cache[id] = decodeImage(`${STICKERS}/${id}.png`);
  const src = cache[id];
  const box = contentBox(src);
  const scale = sizePx / Math.max(box.w, box.h);
  blitRotated(dst, src, cx, cy, scale, deg, { shadow: true, clip, sx: 3, sy: 5, shadowA: 0.32 });
  blitRotated(dst, src, cx, cy, scale, deg, { shadow: false, clip });
}

function drawDashedSlot(dst, x0, y0, x1, y1, clip) {
  const ink = [92, 58, 32];
  const dash = 7;
  const gap = 5;
  const drawH = (y, xa, xb) => {
    let x = xa;
    let on = true;
    let rem = dash;
    while (x < xb) {
      if (on) setPixel(dst, x, y, ink[0], ink[1], ink[2], 110);
      rem--;
      if (rem <= 0) {
        on = !on;
        rem = on ? dash : gap;
      }
      x++;
    }
  };
  const drawV = (x, ya, yb) => {
    let y = ya;
    let on = true;
    let rem = dash;
    while (y < yb) {
      if (on) setPixel(dst, x, y, ink[0], ink[1], ink[2], 110);
      rem--;
      if (rem <= 0) {
        on = !on;
        rem = on ? dash : gap;
      }
      y++;
    }
  };
  const L = Math.max(clip.l, Math.round(x0));
  const T = Math.max(clip.t, Math.round(y0));
  const R = Math.min(clip.r - 1, Math.round(x1));
  const B = Math.min(clip.b - 1, Math.round(y1));
  drawH(T, L, R);
  drawH(B, L, R);
  drawV(L, T, B);
  drawV(R, T, B);
  // soft fill
  for (let y = T + 2; y < B - 1; y++) {
    for (let x = L + 2; x < R - 1; x++) {
      if (((x + y) & 3) === 0) setPixel(dst, x, y, 120, 90, 55, 18);
    }
  }
}

function drawRule(dst, x0, y, x1, a = 70) {
  for (let x = Math.round(x0); x < Math.round(x1); x++) {
    setPixel(dst, x, Math.round(y), 78, 48, 28, a);
  }
}

function drawDotLabel(dst, cx, cy, filled) {
  const r = 5;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (filled) setPixel(dst, cx + dx, cy + dy, 64, 38, 22, 160);
      else if (dx * dx + dy * dy > (r - 1.4) * (r - 1.4)) setPixel(dst, cx + dx, cy + dy, 64, 38, 22, 140);
    }
  }
}

const cache = {};
const plate = decodeImage(TEMPLATE);
const { top, bot } = findRegions(plate);

// --- V1 Scrapbook ---
{
  const dst = cloneImg(plate);
  const picks = [
    { id: 'fireball', x: 0.22, y: 0.28, s: 0.34, r: -12 },
    { id: 'bloodied-crown', x: 0.52, y: 0.22, s: 0.28, r: 7 },
    { id: 'revenge-bomb', x: 0.78, y: 0.30, s: 0.26, r: 14 },
    { id: 'steel-sword', x: 0.18, y: 0.58, s: 0.36, r: -28 },
    { id: 'dragons-breath', x: 0.48, y: 0.52, s: 0.40, r: 4 },
    { id: 'cyclops-eye', x: 0.76, y: 0.55, s: 0.24, r: -8 },
    { id: 'lucky-charm', x: 0.34, y: 0.78, s: 0.22, r: 11 },
    { id: 'rabbits-foot', x: 0.68, y: 0.78, s: 0.24, r: -15 },
  ];
  for (const p of picks) {
    const cx = top.l + p.x * top.w;
    const cy = top.t + p.y * top.h;
    const size = Math.min(top.w, top.h) * p.s;
    placeSticker(dst, cache, p.id, cx, cy, size, p.r, top);
  }
  // one sticker slightly overlapping into bottom (scrapbook spill)
  placeSticker(dst, cache, 'phoenix-heart', bot.l + bot.w * 0.18, bot.t + bot.h * 0.42, Math.min(bot.w, bot.h) * 0.42, -6, bot);
  // soft horizontal hint line for "notes"
  drawRule(dst, bot.l + bot.w * 0.38, bot.t + bot.h * 0.35, bot.l + bot.w * 0.88, 45);
  drawRule(dst, bot.l + bot.w * 0.38, bot.t + bot.h * 0.52, bot.l + bot.w * 0.88, 40);
  drawRule(dst, bot.l + bot.w * 0.38, bot.t + bot.h * 0.69, bot.l + bot.w * 0.78, 35);
  writePng(dst, `${OUT}/v1-scrapbook.png`);
}

// --- V2 Catalog ---
{
  const dst = cloneImg(plate);
  const ids = ['fireball', 'steel-sword', 'bloodied-crown', 'revenge-bomb', null, null];
  const cols = 3;
  const rows = 2;
  const gapX = top.w * 0.04;
  const gapY = top.h * 0.06;
  const cellW = (top.w - gapX * (cols + 1)) / cols;
  const cellH = (top.h - gapY * (rows + 1)) / rows;
  ids.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = top.l + gapX + col * (cellW + gapX);
    const y0 = top.t + gapY + row * (cellH + gapY);
    const x1 = x0 + cellW;
    const y1 = y0 + cellH;
    drawDashedSlot(dst, x0, y0, x1, y1, top);
    if (id) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2 - cellH * 0.02;
      placeSticker(dst, cache, id, cx, cy, Math.min(cellW, cellH) * 0.72, (i % 2 === 0 ? -3 : 4), top);
    }
  });
  // bottom: legend dots for owned / missing
  const legend = [
    { id: 'fireball', owned: true },
    { id: 'steel-sword', owned: true },
    { id: 'bloodied-crown', owned: true },
    { id: 'revenge-bomb', owned: true },
    { id: '???', owned: false },
    { id: '???', owned: false },
  ];
  legend.forEach((item, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const x = bot.l + bot.w * (0.12 + col * 0.46);
    const y = bot.t + bot.h * (0.28 + row * 0.22);
    drawDotLabel(dst, Math.round(x), Math.round(y), item.owned);
    drawRule(dst, x + 14, y, x + bot.w * 0.28, item.owned ? 90 : 40);
  });
  writePng(dst, `${OUT}/v2-catalog.png`);
}

// --- V3 Showcase ---
{
  const dst = cloneImg(plate);
  // hero center
  placeSticker(
    dst,
    cache,
    'dragons-breath',
    top.l + top.w * 0.5,
    top.t + top.h * 0.48,
    Math.min(top.w, top.h) * 0.58,
    -4,
    top,
  );
  const sats = [
    { id: 'fireball', x: 0.16, y: 0.22, s: 0.22, r: -10 },
    { id: 'bloodied-crown', x: 0.84, y: 0.20, s: 0.20, r: 8 },
    { id: 'revenge-bomb', x: 0.14, y: 0.78, s: 0.20, r: 6 },
    { id: 'steel-sword', x: 0.86, y: 0.76, s: 0.22, r: -18 },
  ];
  for (const p of sats) {
    placeSticker(dst, cache, p.id, top.l + p.x * top.w, top.t + p.y * top.h, Math.min(top.w, top.h) * p.s, p.r, top);
  }
  // bottom: selected preview + title lines
  placeSticker(dst, cache, 'dragons-breath', bot.l + bot.w * 0.22, bot.t + bot.h * 0.5, Math.min(bot.w, bot.h) * 0.62, 3, bot);
  drawRule(dst, bot.l + bot.w * 0.42, bot.t + bot.h * 0.32, bot.l + bot.w * 0.88, 100);
  drawRule(dst, bot.l + bot.w * 0.42, bot.t + bot.h * 0.32 + 3, bot.l + bot.w * 0.72, 55);
  drawRule(dst, bot.l + bot.w * 0.42, bot.t + bot.h * 0.48, bot.l + bot.w * 0.88, 55);
  drawRule(dst, bot.l + bot.w * 0.42, bot.t + bot.h * 0.60, bot.l + bot.w * 0.84, 45);
  drawRule(dst, bot.l + bot.w * 0.42, bot.t + bot.h * 0.72, bot.l + bot.w * 0.78, 40);
  writePng(dst, `${OUT}/v3-showcase.png`);
}

console.log('done');
