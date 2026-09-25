import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const SRC = `${ROOT}/public/art/stickers`;
const DEST = `${ROOT}/assets/sticker-straight`;
const TARGET = 560;

const IDS = readdirSync(SRC)
  .filter((name) => name.endsWith('.png'))
  .map((name) => name.replace(/\.png$/, ''))
  .sort();

function decodePng(path) {
  const png = PNG.sync.read(readFileSync(path));
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

function scaleFit(src) {
  const box = contentBox(src);
  const scale = TARGET / Math.max(box.w, box.h);
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const dst = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pix = sample(src, box.l + ((x + 0.5) / w) * box.w - 0.5, box.t + ((y + 0.5) / h) * box.h - 0.5);
      if (pix[3] < 8) continue;
      const o = (y * w + x) * 4;
      dst.data[o] = Math.round(pix[0]);
      dst.data[o + 1] = Math.round(pix[1]);
      dst.data[o + 2] = Math.round(pix[2]);
      dst.data[o + 3] = Math.round(pix[3]);
    }
  }
  return dst;
}

mkdirSync(DEST, { recursive: true });
for (const id of IDS) {
  const out = scaleFit(decodePng(`${SRC}/${id}.png`));
  writePng(out, `${DEST}/${id}.png`);
  console.log(id, `${out.width}x${out.height}`);
}
console.log('dest', DEST, IDS.length);
