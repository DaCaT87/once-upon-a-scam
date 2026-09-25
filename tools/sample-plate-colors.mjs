import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const TABLE = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui/plate-sticker.jpg';
const DEST = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/plate-sticker-grid.png';
const jpg = decodeJpeg(readFileSync(TABLE), { useTArray: true });
const { width: w, height: h, data } = jpg;
const png = new PNG({ width: w, height: h });
png.data.set(data);

function setPx(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const o = (y * w + x) * 4;
  png.data[o] = r;
  png.data[o + 1] = g;
  png.data[o + 2] = b;
}

for (let p = 1; p < 10; p++) {
  const x = Math.round((p / 10) * w);
  const y = Math.round((p / 10) * h);
  for (let i = 0; i < h; i++) setPx(x, i, 0, 220, 80);
  for (let i = 0; i < w; i++) setPx(i, y, 0, 220, 80);
}

writeFileSync(DEST, PNG.sync.write(png));
console.log('grid', w, h);
