import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CARD_W = 635;
const CARD_H = 967;
const IDLE_W = 768;
const IDLE_H = 1024;
const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units/mad-woodsman';
const SRC =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Mad_Woodsman-48504e72-38f0-43db-bacc-4863e1b6cee9.jpg';

const KEY = [0, 254, 102];
const KEY_CUT = 28;
const KEY_SOFT = 72;

function decodeImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
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

function floodKey(src) {
  const { width: w, height: h, data } = src;
  const seen = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    const o = i * 4;
    if (keyDist(data[o], data[o + 1], data[o + 2]) >= KEY_CUT) return;
    seen[i] = 1;
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
  return seen;
}

function despill(r, g, b, alpha) {
  if (alpha >= 250) return [r, g, b, alpha];
  const spill = Math.max(0, g - Math.max(r, b));
  const cut = Math.min(spill, (255 - alpha) * 0.85);
  const ng = Math.max(0, g - cut);
  const nb = Math.max(0, b - cut * 0.4);
  return [r, ng, nb, alpha];
}

function cutout(src, keyMask) {
  const { width: w, height: h, data } = src;
  const out = Buffer.alloc(w * h * 4);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      let alpha = 255;
      if (keyMask[i]) {
        alpha = 0;
      } else {
        const d = keyDist(r, g, b);
        if (d < KEY_SOFT) {
          alpha = Math.round(255 * Math.max(0, (d - KEY_CUT) / (KEY_SOFT - KEY_CUT)));
        }
        let nearKey = false;
        if (alpha < 255) {
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (keyMask[ny * w + nx]) nearKey = true;
          }
          if (!nearKey && d >= KEY_CUT) alpha = 255;
        }
      }
      const pix = despill(r, g, b, alpha);
      out[o] = pix[0];
      out[o + 1] = pix[1];
      out[o + 2] = pix[2];
      out[o + 3] = pix[3];
      if (pix[3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    width: w,
    height: h,
    data: out,
    box: { l: minX, t: minY, r: maxX, b: maxY },
  };
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

function coverTo(src, dw, dh) {
  const scale = Math.max(dw / src.width, dh / src.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const ox = (src.width - sw) / 2;
  const oy = (src.height - sh) / 2;
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = ox + ((x + 0.5) * sw) / dw - 0.5;
      const sy = oy + ((y + 0.5) * sh) / dh - 0.5;
      const pix = bilinear(src, sx, sy);
      const o = (y * dw + x) * 4;
      out.data[o] = Math.round(pix[0]);
      out.data[o + 1] = Math.round(pix[1]);
      out.data[o + 2] = Math.round(pix[2]);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function extractScene(framed) {
  const l = Math.round((framed.width * 52) / 635);
  const t = Math.round((framed.height * 92) / 967);
  const r = Math.round((framed.width * 583) / 635);
  const b = Math.round((framed.height * 518) / 967);
  return crop(framed, { l, t, r, b });
}

function scrubGreen(img) {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  const q = [];
  const excess = (r, g, b) => g - Math.max(r, b);
  const keyish = (r, g, b) => {
    const e = excess(r, g, b);
    const d = keyDist(r, g, b);
    return d < 95 || (e > 22 && g > 70 && r < 170 && g > b + 8);
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i]) return;
    const o = i * 4;
    if (data[o + 3] < 12 || keyish(data[o], data[o + 1], data[o + 2])) {
      mask[i] = 1;
      q.push(i);
    }
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (mask[i] || data[o + 3] < 10) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      let near = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (mask[ny * w + nx]) near = true;
      }
      const e = excess(data[o], data[o + 1], data[o + 2]);
      if (near || e > 4) {
        const cut = near ? Math.max(e, Math.round((255 - data[o + 3]) * 0.9)) : e;
        if (cut > 0) {
          data[o + 1] = Math.max(0, data[o + 1] - cut);
          data[o + 2] = Math.max(0, data[o + 2] - Math.round(cut * 0.35));
        }
      }
    }
  }
}

function cleanRim(img) {
  const { width: w, height: h, data } = img;
  const dist = new Uint8Array(w * h);
  dist.fill(255);
  const q = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 16) {
      dist[i] = 0;
      q.push(i);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const x = p % w;
    const y = ((p - x) / w) | 0;
    const d = dist[p];
    if (d >= 8) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] <= d + 1) continue;
      dist[ni] = d + 1;
      q.push(ni);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const d = dist[i];
      let r = data[o];
      let g = data[o + 1];
      let b = data[o + 2];
      const a = data[o + 3];
      if (a < 8) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      if (d > 8) continue;
      const L = (r + g + b) / 3;
      const cream = r > 170 && g > 145 && b > 100 && r > b + 15;
      if (cream) continue;
      const tint = Math.max(Math.abs(g - r), Math.abs(b - r), Math.abs(g - b));
      const olive = g >= r - 2 && g > b + 2 && L > 35;
      const fringe = L > 48 || tint > 8 || olive;
      if ((d <= 2 && fringe) || (d <= 4 && (olive || (L > 55 && tint > 6)))) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      if (g > r + 2) {
        data[o + 1] = Math.min(r, b);
        if (b > r + 4) data[o + 2] = r;
      }
      if (d <= 4 && L < 80) {
        const n = Math.min(data[o], data[o + 1], data[o + 2]);
        data[o] = n;
        data[o + 1] = n;
        data[o + 2] = n;
      }
    }
  }
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

const framed = decodeImage(readFileSync(SRC));
const keyed = cutout(framed, floodKey(framed));
const cropped = crop(keyed, keyed.box);
const card = scaleTo(cropped, CARD_W, CARD_H);
scrubGreen(card);
cleanRim(card);
const idle = coverTo(extractScene(cropped), IDLE_W, IDLE_H);

mkdirSync(ROOT, { recursive: true });
writeFileSync(`${ROOT}/card.png.src.jpg`, readFileSync(SRC));
writePng(card, `${ROOT}/card.png`);
writePng(idle, `${ROOT}/idle.png`);
for (const clip of ['idle2', 'attack', 'hit', 'death']) {
  copyFileSync(`${ROOT}/idle.png`, `${ROOT}/${clip}.png`);
}

console.log(
  `cut ${framed.width}x${framed.height} -> bbox ${keyed.box.l},${keyed.box.t}-${keyed.box.r},${keyed.box.b} (${cropped.width}x${cropped.height}) -> card ${CARD_W}x${CARD_H}`,
);
