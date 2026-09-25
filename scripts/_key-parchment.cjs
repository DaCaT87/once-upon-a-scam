const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const src = path.resolve('assets/../') && process.argv[2];
const input = process.argv[2];
const output = process.argv[3];
const raw = jpeg.decode(fs.readFileSync(input), { useTArray: true });
const { width, height, data } = raw;
const png = new PNG({ width, height });
png.data.set(data);

function isGreen(i) {
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  return g > 140 && g > r + 35 && g > b + 35;
}

const seen = new Uint8Array(width * height);
const stack = [];
function push(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  if (seen[p]) return;
  const i = p * 4;
  if (!isGreen(i)) return;
  seen[p] = 1;
  stack.push(p);
}
for (let x = 0; x < width; x++) {
  push(x, 0);
  push(x, height - 1);
}
for (let y = 0; y < height; y++) {
  push(0, y);
  push(width - 1, y);
}
while (stack.length) {
  const p = stack.pop();
  const i = p * 4;
  png.data[i + 3] = 0;
  const x = p % width;
  const y = (p - x) / width;
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (png.data[(y * width + x) * 4 + 3] === 0) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}
const pad = 2;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(width - 1, maxX + pad);
maxY = Math.min(height - 1, maxY + pad);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const cropped = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((y + minY) * width + (x + minX)) * 4;
    const di = (y * cw + x) * 4;
    cropped.data[di] = png.data[si];
    cropped.data[di + 1] = png.data[si + 1];
    cropped.data[di + 2] = png.data[si + 2];
    cropped.data[di + 3] = png.data[si + 3];
  }
}
fs.writeFileSync(output, PNG.sync.write(cropped));
console.log(`${cw}x${ch}`);
