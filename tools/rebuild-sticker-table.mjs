import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const TABLE = `${ROOT}/public/art/ui/plate-sticker.jpg`;
const TEMPLATE = `${ASSETS}/plate-sticker-page-empty.png`;
const DEST = `${ASSETS}/plate-sticker-on-table.png`;
const MASK_DEST = `${ASSETS}/plate-sticker-table-mask.png`;
const CLEAN_DEST = `${ASSETS}/plate-sticker-table-clean.png`;

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

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isLantern(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  const left = (nx - 0.09) ** 2 / 0.09 ** 2 + (ny - 0.1) ** 2 / 0.14 ** 2;
  const right = (nx - 0.91) ** 2 / 0.09 ** 2 + (ny - 0.11) ** 2 / 0.14 ** 2;
  return left < 1 || right < 1;
}

function isWall(x, y, h) {
  return y < h * 0.05;
}

function isWax(r, g, b) {
  const L = luma(r, g, b);
  return r > 62 && r > g + 20 && r > b + 14 && L < 118 && g < 80;
}

function isCream(r, g, b) {
  const L = luma(r, g, b);
  const c = chroma(r, g, b);
  if (L > 175) return true;
  if (L > 145 && c < 70 && r > 130) return true;
  if (r > 175 && g > 145 && b < 135 && L > 140) return true;
  return false;
}

function isWood(r, g, b) {
  const L = luma(r, g, b);
  if (L < 8 || L > 125) return false;
  if (isWax(r, g, b)) return false;
  if (g > r + 8 && g > 48) return false;
  return r >= g - 14 && r > b && g >= b - 12;
}

function canFlood(r, g, b) {
  if (isWood(r, g, b)) return false;
  if (isCream(r, g, b) || isWax(r, g, b)) return true;
  if (g > r + 8 && g > 55 && luma(r, g, b) > 48) return true;
  if (r > 150 && g > 118 && b < 140 && luma(r, g, b) > 118) return true;
  const L = luma(r, g, b);
  const c = chroma(r, g, b);
  if (L > 95 && c < 32) return true;
  if (L > 88 && r > g && g > b && r - b > 18 && r > 95 && L < 190) return true;
  return false;
}

function buildMask(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const mask = new Uint8Array(n);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (isLantern(x, y, w, h) || isWall(x, y, h)) return;
    const i = y * w + x;
    if (mask[i]) return;
    mask[i] = 1;
    q.push(i);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isLantern(x, y, w, h) || isWall(x, y, h)) continue;
      const o = (y * w + x) * 4;
      if (isCream(data[o], data[o + 1], data[o + 2]) || isWax(data[o], data[o + 1], data[o + 2])) push(x, y);
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isLantern(nx, ny, w, h) || isWall(nx, ny, h)) continue;
      const j = ny * w + nx;
      if (mask[j]) continue;
      const o = j * 4;
      if (!canFlood(data[o], data[o + 1], data[o + 2])) continue;
      mask[j] = 1;
      q.push(j);
    }
  }

  const grown = new Uint8Array(n);
  const rad = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isLantern(x, y, w, h) || isWall(x, y, h)) continue;
      let hit = 0;
      for (let dy = -rad; dy <= rad && !hit; dy++) {
        for (let dx = -rad; dx <= rad && !hit; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) hit = 1;
        }
      }
      grown[y * w + x] = hit;
    }
  }
  return grown;
}

function writeMaskPreview(img, mask, dest) {
  const out = Buffer.from(img.data);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    out[o] = Math.min(255, out[o] + 90);
    out[o + 1] = Math.round(out[o + 1] * 0.35);
    out[o + 2] = Math.round(out[o + 2] * 0.35);
  }
  writePng({ width: img.width, height: img.height, data: out }, dest);
}

function tileKnown(mask, w, h, x, y, tw, th) {
  for (let dy = 0; dy < th; dy++) {
    for (let dx = 0; dx < tw; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      if (mask[yy * w + xx]) return false;
      if (isLantern(xx, yy, w, h) || isWall(xx, yy, h)) return false;
    }
  }
  return true;
}

function tileCost(data, mask, w, h, tx, ty, sx, sy, tw, th) {
  let cost = 0;
  let n = 0;
  for (let dy = 0; dy < th; dy++) {
    for (let dx = 0; dx < tw; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (mask[y * w + x]) continue;
      const ox = sx + dx;
      const oy = sy + dy;
      const a = (y * w + x) * 4;
      const b = (oy * w + ox) * 4;
      const dr = data[a] - data[b];
      const dg = data[a + 1] - data[b + 1];
      const db = data[a + 2] - data[b + 2];
      cost += dr * dr + dg * dg + db * db;
      n++;
    }
  }
  return n < 8 ? 1e12 : cost / n;
}

function inpaint(img, mask) {
  const { width: w, height: h, data } = img;
  const out = Buffer.from(data);
  const hole = Uint8Array.from(mask);
  const TILE = 36;
  const STEP = 18;
  const sources = [];
  for (let y = 0; y <= h - TILE; y += 8) {
    for (let x = 0; x <= w - TILE; x += 8) {
      if (tileKnown(hole, w, h, x, y, TILE, TILE)) sources.push(x, y);
    }
  }
  console.log('wood tiles', sources.length / 2);
  if (sources.length < 4) throw new Error('not enough wood tiles');

  for (let ty = 0; ty < h; ty += STEP) {
    for (let tx = 0; tx < w; tx += STEP) {
      const tw = Math.min(TILE, w - tx);
      const th = Math.min(TILE, h - ty);
      let need = false;
      for (let dy = 0; dy < th && !need; dy++) {
        for (let dx = 0; dx < tw && !need; dx++) {
          if (hole[(ty + dy) * w + (tx + dx)]) need = true;
        }
      }
      if (!need) continue;

      let best = 1e12;
      let bx = sources[0];
      let by = sources[1];
      const local = [];
      for (let i = 0; i < sources.length; i += 2) {
        const sx = sources[i];
        const sy = sources[i + 1];
        if (Math.abs(sx - tx) > 260 || Math.abs(sy - ty) > 220) continue;
        local.push(sx, sy);
      }
      const pool = local.length ? local : sources;
      for (let i = 0; i < pool.length; i += 2) {
        const sx = pool[i];
        const sy = pool[i + 1];
        const cost = tileCost(out, hole, w, h, tx, ty, sx, sy, tw, th);
        if (cost < best) {
          best = cost;
          bx = sx;
          by = sy;
        }
      }
      for (let dy = 0; dy < th; dy++) {
        for (let dx = 0; dx < tw; dx++) {
          const x = tx + dx;
          const y = ty + dy;
          const i = y * w + x;
          if (!hole[i]) continue;
          const fadeX = dx < 8 ? dx / 8 : dx > tw - 9 ? (tw - 1 - dx) / 8 : 1;
          const fadeY = dy < 8 ? dy / 8 : dy > th - 9 ? (th - 1 - dy) / 8 : 1;
          const fade = Math.max(0.35, fadeX * fadeY);
          const so = ((by + dy) * w + (bx + dx)) * 4;
          const o = i * 4;
          out[o] = Math.round(out[so] * fade + out[o] * (1 - fade));
          out[o + 1] = Math.round(out[so + 1] * fade + out[o + 1] * (1 - fade));
          out[o + 2] = Math.round(out[so + 2] * fade + out[o + 2] * (1 - fade));
          hole[i] = 0;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
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

function artBox(img) {
  const { width: w, height: h, data } = img;
  let gap = -1;
  for (let y = Math.round(h * 0.46); y < Math.round(h * 0.58); y++) {
    let dark = 0;
    const x0 = Math.round(w * 0.12);
    const x1 = Math.round(w * 0.88);
    for (let x = x0; x < x1; x++) {
      if (luma(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]) < 48) dark++;
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
        if (luma(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]) > 170) cream++;
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

const table = decodeImage(TABLE);
const mask = buildMask(table);
let masked = 0;
for (const v of mask) if (v) masked++;
console.log('table', table.width, table.height, 'mask', masked);
writeMaskPreview(table, mask, MASK_DEST);

const clean = inpaint(table, mask);
writePng(clean, CLEAN_DEST);

const chrome = decodeImage(TEMPLATE);
const box = artBox(chrome);
const plate = { width: chrome.width, height: chrome.height, data: Buffer.from(chrome.data) };
fillArt(
  plate,
  box,
  crop(clean, {
    l: Math.round(clean.width * 0.02),
    t: 0,
    r: Math.round(clean.width * 0.98),
    b: Math.round(clean.height * 0.7),
  }),
);
writePng(plate, DEST);
