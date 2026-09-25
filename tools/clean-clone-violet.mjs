import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

function magentaExcess(r, g, b) {
  return Math.min(r, b) - g;
}

function isGold(r, g, b) {
  return r > 80 && g > 40 && r - b > 14 && r >= g - 4;
}

function cleanFrame(src) {
  const png = PNG.sync.read(readFileSync(src));
  const { width: w, height: h, data } = png;
  let cut = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    if (a < 6) continue;
    const mag = magentaExcess(r, g, b);
    if (mag <= 10) continue;
    if (isGold(r, g, b) && mag < 28) {
      data[o + 2] = Math.max(0, b - mag);
      data[o] = Math.max(g, r - Math.round(mag * 0.35));
      continue;
    }
    data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
    cut++;
  }
  writeFileSync(src, PNG.sync.write(png));
  console.log('frame-gold-full cleaned', cut);
}

function cleanArt(src) {
  const buf = readFileSync(src);
  const jpg = decodeJpeg(buf, { useTArray: true });
  const { width: w, height: h } = jpg;
  const data = Buffer.from(jpg.data);
  const edge = 18;
  let fixed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x < edge || x >= w - edge || y < edge || y >= h - edge;
      if (!border) continue;
      const o = (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const mag = magentaExcess(r, g, b);
      const violet = b - Math.max(r, g);
      if (mag < 12 && violet < 14) continue;
      const cut = Math.max(mag, violet, 0);
      data[o] = Math.max(0, r - Math.round(cut * 0.55));
      data[o + 1] = g;
      data[o + 2] = Math.max(0, b - cut);
      data[o + 3] = 255;
      fixed++;
    }
  }
  writePng({ width: w, height: h, data }, src);
  console.log(src.split('/').pop(), 'edge pixels', fixed);
}

cleanFrame(`${UI}/frame-gold-full.png`);
for (const name of [
  'event-cloning-chamber.png',
  'event-cloning-chamber-inside.png',
  'event-cloning-chamber-exit.png',
]) {
  cleanArt(`${UI}/${name}`);
}
