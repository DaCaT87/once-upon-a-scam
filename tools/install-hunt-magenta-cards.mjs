import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CARD_W = 642;
const CARD_H = 972;
const IDLE_W = 768;
const IDLE_H = 1024;
const KEY = [255, 0, 253];
const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';

const CARDS = [
  ['thousand-maws', `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Thousand_Maws-df0fc9a4-bc6e-4773-a27c-eda8ce11abf9.jpg`],
  ['purple-widows', `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Purple_Widow-b4947c06-20ea-453f-bb83-a04c92ec03c1.jpg`],
  ['sewer-lord', `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Sewer_Lord-d6b9bdd5-3600-4033-866a-ab745e03cd74.jpg`],
  ['mad-woodsman', `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Mad_Woodsman-1d77d38a-0491-47d3-a5c3-d2710738dafb.jpg`],
  ['greed-fang', `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Avarice_Wyrm-95561364-92c6-46f1-af65-bf69b57726aa.jpg`],
];

function decodeImage(buf) {
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

function excessMagenta(r, g, b) {
  return Math.min(r, b) - g;
}

function isRealBlack(r, g, b) {
  return luma(r, g, b) < 52 && excessMagenta(r, g, b) < 22;
}

function isFlatMagenta(r, g, b) {
  if (isRealBlack(r, g, b)) return false;
  const d = keyDist(r, g, b);
  if (d < 55) return true;
  const e = excessMagenta(r, g, b);
  return r > 190 && b > 180 && g < 90 && e > 80;
}

function floodKey(src) {
  const { width: w, height: h, data } = src;
  const mask = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i]) return;
    const o = i * 4;
    if (!isFlatMagenta(data[o], data[o + 1], data[o + 2])) return;
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
    const e = excessMagenta(r, g, b);
    const d = keyDist(r, g, b);
    if (e > 18 || d < 90) {
      if (luma(r, g, b) < 95 && e < 50) {
        const cut = Math.max(e, 0);
        out[o] = Math.max(0, r - cut);
        out[o + 2] = Math.max(0, b - cut);
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

function innerCardBox(img) {
  const { width: w, height: h, data } = img;
  const row = new Float64Array(h);
  const col = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 40) continue;
      row[y] += 1;
      col[x] += 1;
    }
  }
  const rowCut = w * 0.42;
  const colCut = h * 0.42;
  let t = 0;
  let b = h - 1;
  let l = 0;
  let r = w - 1;
  while (t < h && row[t] < rowCut) t++;
  while (b > t && row[b] < rowCut) b--;
  while (l < w && col[l] < colCut) l++;
  while (r > l && col[r] < colCut) r--;
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

function scaleXY(src, dw, dh) {
  return scaleTo(src, dw, dh);
}

function fitInner(cropped, inner, tw, th) {
  const iw = inner.r - inner.l + 1;
  const ih = inner.b - inner.t + 1;
  const dw = Math.max(1, Math.round((cropped.width * tw) / iw));
  const dh = Math.max(1, Math.round((cropped.height * th) / ih));
  const scaled = scaleXY(cropped, dw, dh);
  const box = {
    l: Math.round((inner.l * dw) / cropped.width),
    t: Math.round((inner.t * dh) / cropped.height),
  };
  box.r = box.l + tw - 1;
  box.b = box.t + th - 1;
  return { img: scaled, box };
}

function blank(w, h) {
  return { width: w, height: h, data: Buffer.alloc(w * h * 4) };
}

function blit(dest, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dest.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dest.width) continue;
      const so = (y * src.width + x) * 4;
      if (src.data[so + 3] < 8) continue;
      const o = (ty * dest.width + tx) * 4;
      dest.data[o] = src.data[so];
      dest.data[o + 1] = src.data[so + 1];
      dest.data[o + 2] = src.data[so + 2];
      dest.data[o + 3] = src.data[so + 3];
    }
  }
}

function centerOnCanvas(fitted, canvasW, canvasH) {
  const out = blank(canvasW, canvasH);
  const dx = Math.round((canvasW - CARD_W) / 2 - fitted.box.l);
  const dy = Math.round((canvasH - CARD_H) / 2 - fitted.box.t);
  blit(out, fitted.img, dx, dy);
  return out;
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

function checker(img) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = data[o + 3] / 255;
      const cell = ((x >> 4) + (y >> 4)) & 1;
      const bg = cell ? 210 : 150;
      out[o] = Math.round(data[o] * a + bg * (1 - a));
      out[o + 1] = Math.round(data[o + 1] * a + (cell ? 80 : 40) * (1 - a));
      out[o + 2] = Math.round(data[o + 2] * a + (cell ? 210 : 160) * (1 - a));
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

const prepared = CARDS.map(([folder, srcPath]) => {
  const buf = readFileSync(srcPath);
  const framed = decodeImage(buf);
  const keyed = cutout(framed, floodKey(framed));
  const full = contentBox(keyed);
  const inner = innerCardBox(keyed);
  const cropped = crop(keyed, full);
  const localInner = {
    l: inner.l - full.l,
    t: inner.t - full.t,
    r: inner.r - full.l,
    b: inner.b - full.t,
  };
  const fitted = fitInner(cropped, localInner, CARD_W, CARD_H);
  const padL = fitted.box.l;
  const padT = fitted.box.t;
  const padR = fitted.img.width - 1 - fitted.box.r;
  const padB = fitted.img.height - 1 - fitted.box.b;
  const scene = crop(keyed, {
    l: inner.l + Math.round((inner.r - inner.l + 1) * 0.04),
    t: inner.t + Math.round((inner.b - inner.t + 1) * 0.035),
    r: inner.r - Math.round((inner.r - inner.l + 1) * 0.04),
    b: inner.t + Math.round((inner.b - inner.t + 1) * 0.52),
  });
  return { folder, buf, framed, fitted, padL, padT, padR, padB, idle: coverTo(scene, IDLE_W, IDLE_H) };
});

const canvasW = CARD_W + 2 * Math.max(...prepared.map((p) => Math.max(p.padL, p.padR)));
const canvasH = CARD_H + 2 * Math.max(...prepared.map((p) => Math.max(p.padT, p.padB)));

for (const item of prepared) {
  const card = centerOnCanvas(item.fitted, canvasW, canvasH);
  const dest = `${ROOT}/${item.folder}`;
  writeFileSync(`${dest}/card.png.src.jpg`, item.buf);
  writePng(card, `${dest}/card.png`);
  writePng(item.idle, `${dest}/idle.png`);
  for (const clip of ['idle2', 'attack', 'hit', 'death']) {
    copyFileSync(`${dest}/idle.png`, `${dest}/${clip}.png`);
  }
  console.log(
    item.folder,
    `${item.framed.width}x${item.framed.height}`,
    `pads ${item.padL},${item.padT},${item.padR},${item.padB}`,
    `out ${card.width}x${card.height}`,
  );
}
console.log(`shared ${canvasW}x${canvasH}`);
