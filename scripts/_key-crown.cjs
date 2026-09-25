const fs = require('fs');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const src = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/crown-oven-ink.png';
const j = jpeg.decode(fs.readFileSync(src), { useTArray: true, maxResolutionInMP: 40 });
const w = j.width;
const h = j.height;
const data = Buffer.from(j.data);
const isBg = (i) => {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return g > 170 && g > r + 50 && g > b + 40 && r < 90 && b < 120;
};
const seen = new Uint8Array(w * h);
const q = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const p = y * w + x;
  if (seen[p]) return;
  const i = p * 4;
  if (!isBg(i)) return;
  seen[p] = 1;
  data[i + 3] = 0;
  q.push(p);
};
for (let x = 0; x < w; x++) {
  push(x, 0);
  push(x, h - 1);
}
for (let y = 0; y < h; y++) {
  push(0, y);
  push(w - 1, y);
}
while (q.length) {
  const p = q.pop();
  const x = p % w;
  const y = (p - x) / w;
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}
// One fringe pass: only pixels already touching transparency, still green, low red.
for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!(g > r + 28 && g > b + 18 && r < 95 && g > 80)) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (data[((y + dy) * w + (x + dx)) * 4 + 3] === 0) edge = true;
    }
    if (edge) data[i + 3] = 0;
  }
}
let minX = w, minY = h, maxX = 0, maxY = 0, vis = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] === 0) continue;
    vis++;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}
const pad = 8;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(w - 1, maxX + pad);
maxY = Math.min(h - 1, maxY + pad);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const png = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((y + minY) * w + (x + minX)) * 4;
    const di = (y * cw + x) * 4;
    png.data[di] = data[si];
    png.data[di + 1] = data[si + 1];
    png.data[di + 2] = data[si + 2];
    png.data[di + 3] = data[si + 3];
  }
}
fs.writeFileSync('public/art/ui/crown-wins.png', PNG.sync.write(png));
console.log({ vis, crop: [cw, ch], box: [minX, minY, maxX, maxY] });
