const fs = require('fs');
const { PNG } = require('pngjs');

const src = PNG.sync.read(fs.readFileSync('public/art/ui/event-cloning-chamber-inside-object.png'));
const w = src.width;
const h = src.height;
const mask = new Uint8Array(w * h);

function sil(x, y) {
  if (x < 230 || y < 490 || x > 530 || y > 760) return false;
  const i = (y * w + x) * 4;
  const r = src.data[i];
  const g = src.data[i + 1];
  const b = src.data[i + 2];
  const a = src.data[i + 3];
  return a > 200 && g < 42 && r < 32 && b < 24;
}

const q = [360, 640];
mask[640 * w + 360] = 1;
for (let k = 0; k < q.length; k += 2) {
  const x = q[k];
  const y = q[k + 1];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx;
    const yy = y + dy;
    const pi = yy * w + xx;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h || mask[pi] || !sil(xx, yy)) continue;
    mask[pi] = 1;
    q.push(xx, yy);
  }
}

const mask2 = new Uint8Array(mask);
let minX = w;
let maxX = 0;
let minY = h;
let maxY = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
minX = Math.max(0, minX - 14);
maxX = Math.min(w - 1, maxX + 14);
minY = Math.max(0, minY - 8);
maxY = Math.min(h - 1, maxY + 10);
for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    const i = (y * w + x) * 4;
    const r = src.data[i];
    const g = src.data[i + 1];
    const b = src.data[i + 2];
    if (src.data[i + 3] > 200 && g < 78 && r < 70 && b < 55) mask2[y * w + x] = 1;
  }
}

const out = new PNG({ width: w, height: h });
out.data.set(src.data);
for (let y = minY; y <= maxY; y++) {
  let lx = -1;
  let rx = -1;
  for (let x = minX; x <= maxX; x++) {
    if (mask2[y * w + x]) continue;
    const g = src.data[(y * w + x) * 4 + 1];
    if (g < 100) continue;
    if (lx < 0) lx = x;
    rx = x;
  }
  if (lx < 0) continue;
  const il = (y * w + lx) * 4;
  const ir = (y * w + rx) * 4;
  for (let x = minX; x <= maxX; x++) {
    if (!mask2[y * w + x]) continue;
    const t = rx === lx ? 0 : (x - lx) / (rx - lx);
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) {
      out.data[i + k] = Math.round(src.data[il + k] * (1 - t) + src.data[ir + k] * t);
    }
    out.data[i + 3] = 255;
  }
}

fs.writeFileSync('public/art/ui/event-cloning-chamber-object.png', PNG.sync.write(out));
const x0 = 200;
const y0 = 460;
const cw = 360;
const ch = 360;
const crop = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const s = ((y + y0) * w + (x + x0)) * 4;
    const d = (y * cw + x) * 4;
    crop.data[d] = out.data[s];
    crop.data[d + 1] = out.data[s + 1];
    crop.data[d + 2] = out.data[s + 2];
    crop.data[d + 3] = 255;
  }
}
fs.writeFileSync('scripts/_frame1-empty.png', PNG.sync.write(crop));
console.log('wrote frame 1 from frame 2');
