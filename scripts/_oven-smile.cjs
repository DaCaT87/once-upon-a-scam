const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const chew = PNG.sync.read(fs.readFileSync('public/art/ui/event-witch-oven-chew-2.png'));

function bounds(src, alpha) {
  let minX = src.width;
  let minY = src.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const a = alpha(x, y);
      if (a < 24) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function isGreen(r, g, b) {
  return g > 90 && g > r + 35 && g > b + 35;
}

const jpg = jpeg.decode(
  fs.readFileSync('C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/oven-smile.png'),
  { useTArray: true, formatAsRGBA: true }
);
const keyed = { width: jpg.width, height: jpg.height, data: new Uint8Array(jpg.data.length) };
for (let i = 0; i < jpg.data.length; i += 4) {
  const r = jpg.data[i];
  const g = jpg.data[i + 1];
  const b = jpg.data[i + 2];
  if (isGreen(r, g, b)) continue;
  let gg = g;
  if (g - Math.max(r, b) > 18) gg = Math.max(r, b);
  keyed.data[i] = r;
  keyed.data[i + 1] = gg;
  keyed.data[i + 2] = b;
  keyed.data[i + 3] = 255;
}

const dest = bounds(chew, (x, y) => chew.data[(y * chew.width + x) * 4 + 3]);
const srcBox = bounds(keyed, (x, y) => keyed.data[(y * keyed.width + x) * 4 + 3]);
const scale = Math.min(dest.w / srcBox.w, dest.h / srcBox.h);
const dw = srcBox.w * scale;
const dh = srcBox.h * scale;
const dx = dest.minX + (dest.w - dw) / 2;
const dy = dest.minY + (dest.h - dh) / 2;
const out = new PNG({ width: chew.width, height: chew.height });

function sample(sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= keyed.width || y1 >= keyed.height) return null;
  const fx = sx - x0;
  const fy = sy - y0;
  const i00 = (y0 * keyed.width + x0) * 4;
  const i10 = (y0 * keyed.width + x1) * 4;
  const i01 = (y1 * keyed.width + x0) * 4;
  const i11 = (y1 * keyed.width + x1) * 4;
  const o = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    o[k] =
      keyed.data[i00 + k] * (1 - fx) * (1 - fy) +
      keyed.data[i10 + k] * fx * (1 - fy) +
      keyed.data[i01 + k] * (1 - fx) * fy +
      keyed.data[i11 + k] * fx * fy;
  }
  return o;
}

for (let y = 0; y < out.height; y++) {
  for (let x = 0; x < out.width; x++) {
    const c = sample(srcBox.minX + (x - dx) / scale, srcBox.minY + (y - dy) / scale);
    if (!c || c[3] < 8) continue;
    const j = (y * out.width + x) * 4;
    out.data[j] = Math.round(c[0]);
    out.data[j + 1] = Math.round(c[1]);
    out.data[j + 2] = Math.round(c[2]);
    out.data[j + 3] = c[3] > 200 ? 255 : Math.round(c[3]);
  }
}

fs.writeFileSync('public/art/ui/event-witch-oven-fed-object.png', PNG.sync.write(out));
console.log('smile placed', 'scale', scale.toFixed(3));
