import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const DEST = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/sticker-paper.png';
const w = 512;
const h = 640;
const png = new PNG({ width: w, height: h });

function hex(n) {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const a = hex(0xf7e7b8);
const b = hex(0xe0b86a);

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const t = (x * 0.34 + y) / (w * 0.34 + h);
    const o = (y * w + x) * 4;
    png.data[o] = Math.round(a[0] + (b[0] - a[0]) * t);
    png.data[o + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
    png.data[o + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
    png.data[o + 3] = 255;
  }
}
writeFileSync(DEST, PNG.sync.write(png));
console.log('wrote', DEST);
