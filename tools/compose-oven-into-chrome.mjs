import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const CHROME = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/plate-sticker.png';
const ART =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/art-witch-oven-oval.png';
const DEST = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/plate-witch-oven.png';
const EVENT_DEST = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/event-witch-oven.jpg';

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

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
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

/** Art window of alley full-plate chrome (top panel inside frame, above parchment). */
function artBox(chrome) {
  const { width: w, height: h, data } = chrome;
  // parchment cream starts ~552 on sticker chrome; cover all scenic area above it
  let parch = Math.round(h * 0.57);
  for (let y = Math.round(h * 0.48); y < Math.round(h * 0.62); y++) {
    let cream = 0;
    const x0 = Math.round(w * 0.15);
    const x1 = Math.round(w * 0.85);
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (luma(r, g, b) > 165 && r > 150 && g > 130) cream++;
    }
    if (cream / (x1 - x0) > 0.7) {
      parch = y;
      break;
    }
  }
  return {
    l: Math.round(w * 0.042),
    t: Math.round(h * 0.028),
    r: Math.round(w * 0.958),
    b: parch - 2,
  };
}

function fillArt(dst, box, src) {
  const dw = box.r - box.l;
  const dh = box.b - box.t;
  for (let y = box.t; y < box.b; y++) {
    for (let x = box.l; x < box.r; x++) {
      const pix = sample(
        src,
        ((x - box.l + 0.5) * src.width) / dw - 0.5,
        ((y - box.t + 0.5) * src.height) / dh - 0.5,
      );
      const o = (y * dst.width + x) * 4;
      dst.data[o] = Math.round(pix[0]);
      dst.data[o + 1] = Math.round(pix[1]);
      dst.data[o + 2] = Math.round(pix[2]);
      dst.data[o + 3] = 255;
    }
  }
}

const chrome = decodeImage(CHROME);
const art = decodeImage(ART);
const box = artBox(chrome);
console.log('art box', box, `${box.r - box.l}x${box.b - box.t}`);

const plate = {
  width: chrome.width,
  height: chrome.height,
  data: Buffer.from(chrome.data),
};
fillArt(plate, box, art);
writePng(plate, DEST);
console.log('wrote', DEST);

const jpg = encodeJpeg({ data: art.data, width: art.width, height: art.height }, 92);
writeFileSync(EVENT_DEST, jpg.data);
console.log('wrote', EVENT_DEST, `${art.width}x${art.height}`);
