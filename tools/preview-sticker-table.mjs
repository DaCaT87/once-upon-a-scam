import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam';
const DEST = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/plate-sticker-proposal-e.png';
const WOOD = `${ROOT}/public/art/ui/bg-choice-grimm.jpg`;
const FRAME = `${ROOT}/public/art/ui/frame-gold-full.png`;
const SIZE = `${ROOT}/public/art/ui/plate-wishing-well.png`;

function decodeImage(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: Buffer.from(png.data) };
  }
  const jpg = decodeJpeg(buf, { useTArray: true });
  return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
}

function sample(img, x, y) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(img.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(img.height - 1, y0 + 1));
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const at = (ix, iy) => {
    const o = (iy * img.width + ix) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  const a = at(x0, y0);
  const b = at(x1, y0);
  const c = at(x0, y1);
  const d = at(x1, y1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    out[k] = a[k] + (b[k] - a[k]) * fx + ((c[k] + (d[k] - c[k]) * fx) - (a[k] + (b[k] - a[k]) * fx)) * fy;
  }
  return out;
}

const card = decodeImage(readFileSync(SIZE));
const wood = decodeImage(readFileSync(WOOD));
const frame = decodeImage(readFileSync(FRAME));
const w = card.width;
const h = card.height;
const out = Buffer.alloc(w * h * 4);

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const fr = sample(frame, ((x + 0.5) * frame.width) / w - 0.5, ((y + 0.5) * frame.height) / h - 0.5);
    const hole = fr[3] > 8 && fr[0] > 230 && fr[1] > 230 && fr[2] > 230;
    if (hole || fr[3] < 12) {
      const pix = sample(wood, ((x + 0.5) * wood.width) / w - 0.5, ((y + 0.5) * wood.height) / h - 0.5);
      out[o] = Math.round(pix[0]);
      out[o + 1] = Math.round(pix[1]);
      out[o + 2] = Math.round(pix[2]);
      out[o + 3] = 255;
    } else {
      out[o] = Math.round(fr[0]);
      out[o + 1] = Math.round(fr[1]);
      out[o + 2] = Math.round(fr[2]);
      out[o + 3] = 255;
    }
  }
}

const png = new PNG({ width: w, height: h });
png.data.set(out);
writeFileSync(DEST, PNG.sync.write(png));
console.log('wrote', DEST);
