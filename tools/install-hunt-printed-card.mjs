import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CARD_W = 642;
const CARD_H = 972;
const IDLE_W = 768;
const IDLE_H = 1024;
const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';

const SPINES_SRC = `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_image-7e6e1570-e106-4562-b0bc-c4c731d97a28.png`;
const CARD_SRC = `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_4-9a9237ca-0579-4d82-8f11-7a751eecb7f9.jpg`;

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

function bbox(src, isInk) {
  let l = src.width;
  let t = src.height;
  let r = 0;
  let b = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (!isInk(src.data[o], src.data[o + 1], src.data[o + 2], src.data[o + 3])) continue;
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
      const sa = src.data[so + 3] / 255;
      if (sa <= 0) continue;
      const doff = (ty * dest.width + tx) * 4;
      const da = dest.data[doff + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) {
        const s = src.data[so + k];
        const d = dest.data[doff + k];
        dest.data[doff + k] = Math.round((s * sa + d * da * (1 - sa)) / (outA || 1));
      }
      dest.data[doff + 3] = Math.round(outA * 255);
    }
  }
}

function extractScene(card) {
  const l = Math.round((card.width * 28) / 636);
  const t = Math.round((card.height * 28) / 967);
  const r = Math.round((card.width * 608) / 636);
  const b = Math.round((card.height * 530) / 967);
  return crop(card, { l, t, r, b });
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

const framed = decodeImage(readFileSync(CARD_SRC));
const cardBox = bbox(framed, (r, g, b) => r > 14 || g > 14 || b > 14);
const cropped = crop(framed, cardBox);

const spines = decodeImage(readFileSync(SPINES_SRC));
writePng(spines, `${UI}/spines.png`);

const canvas = blank(CARD_W, CARD_H);
const faceW = Math.round(CARD_W / 1.05);
const faceH = Math.round(CARD_H / 1.05);
const face = scaleTo(cropped, faceW, faceH);
for (let i = 3; i < face.data.length; i += 4) face.data[i] = 255;
blit(canvas, face, Math.round((CARD_W - faceW) / 2), Math.round((CARD_H - faceH) / 2));

const rarity = decodeImage(readFileSync(`${UI}/rarity-platinum.png`));
const innerRight = 563;
const innerTop = 74;
const rw = 118;
const rh = Math.round((rw * rarity.height) / rarity.width);
const gem = scaleTo(rarity, rw, rh);
blit(canvas, gem, innerRight - rw + 6, innerTop - 4);
blit(canvas, spines, 0, 0);

const dir = `${ROOT}/mad-woodsman`;
mkdirSync(dir, { recursive: true });
writePng(canvas, `${dir}/card.png`);
writeFileSync(`${dir}/card.png.src.jpg`, readFileSync(CARD_SRC));
const idle = coverTo(extractScene(cropped), IDLE_W, IDLE_H);
writePng(idle, `${dir}/idle.png`);
for (const clip of ['idle2', 'attack', 'hit', 'death']) {
  copyFileSync(`${dir}/idle.png`, `${dir}/${clip}.png`);
}

console.log(`woodsman ${cropped.width}x${cropped.height} + spines ${spines.width}x${spines.height} -> ${CARD_W}x${CARD_H}`);
