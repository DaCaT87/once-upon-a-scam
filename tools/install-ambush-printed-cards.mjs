import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CARD_W = 635;
const CARD_H = 967;
const IDLE_W = 768;
const IDLE_H = 1024;
const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';

const JOBS = [
  {
    id: 'jack-in-the-box',
    src: `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Toy_Box-0f5bab3a-dad3-45a9-bd2e-764fd0e5f9b5.jpg`,
  },
  {
    id: 'sprung-jack',
    src: `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Jack_in_the_box-55900c8b-9d7b-435c-9239-c3140fdc9197.jpg`,
  },
  {
    id: 'mimic',
    src: `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Tresaure_Chest-d07df538-14b3-40a4-a0b2-bd265979c54f.jpg`,
  },
  {
    id: 'sprung-mimic',
    src: `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Mimic-823fc75a-cce4-4fb1-9139-96632fbb033c.jpg`,
  },
];

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
    out[k] = Math.round(top + (bot - top) * fy);
  }
  return out;
}

function isInk(r, g, b) {
  return r > 14 || g > 14 || b > 14;
}

function bbox(src) {
  let l = src.width;
  let t = src.height;
  let r = 0;
  let b = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (!isInk(src.data[o], src.data[o + 1], src.data[o + 2])) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  const pad = 1;
  return {
    l: Math.max(0, l - pad),
    t: Math.max(0, t - pad),
    r: Math.min(src.width - 1, r + pad),
    b: Math.min(src.height - 1, b + pad),
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
      out.data[o] = pix[0];
      out.data[o + 1] = pix[1];
      out.data[o + 2] = pix[2];
      out.data[o + 3] = 255;
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
      out.data[o] = pix[0];
      out.data[o + 1] = pix[1];
      out.data[o + 2] = pix[2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function inGem(cx, cy) {
  const gx = 0.78;
  const gy = 0.15;
  if (cx < gx || cy > gy) return false;
  return cy <= (gy * (cx - gx)) / (1 - gx) + 0.02;
}

function extractScene(framed, cardBox) {
  const cw = cardBox.r - cardBox.l + 1;
  const ch = cardBox.b - cardBox.t + 1;
  const l = cardBox.l + Math.round((cw * 38) / 635);
  const t = cardBox.t + Math.round((ch * 38) / 967);
  const r = cardBox.l + Math.round((cw * 597) / 635);
  const b = cardBox.t + Math.round((ch * 522) / 967);
  const w = r - l + 1;
  const h = b - t + 1;
  const data = Buffer.alloc(w * h * 4);
  const gemCut = cardBox.l + cw * 0.78;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const absX = l + x;
      const absY = t + y;
      const cx = (absX - cardBox.l) / cw;
      const cy = (absY - cardBox.t) / ch;
      let sx = absX;
      let sy = absY;
      if (inGem(cx, cy)) {
        sx = Math.floor(gemCut - 10 - (absX - gemCut) * 0.35);
        sy = absY + Math.round((gemCut - sx) * 0.08);
      }
      const pix = sample(framed.data, framed.width, framed.height, sx, sy);
      const o = (y * w + x) * 4;
      data[o] = pix[0];
      data[o + 1] = pix[1];
      data[o + 2] = pix[2];
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

for (const job of JOBS) {
  const framed = decodeImage(readFileSync(job.src));
  const cardBox = bbox(framed);
  const card = scaleTo(crop(framed, cardBox), CARD_W, CARD_H);
  const idle = coverTo(extractScene(framed, cardBox), IDLE_W, IDLE_H);
  const dir = `${ROOT}/${job.id}`;
  mkdirSync(dir, { recursive: true });
  writePng(card, `${dir}/card.png`);
  writePng(idle, `${dir}/idle.png`);
  for (const clip of ['idle2', 'attack', 'hit', 'death']) {
    copyFileSync(`${dir}/idle.png`, `${dir}/${clip}.png`);
  }
  console.log(`installed ${job.id}`);
}
