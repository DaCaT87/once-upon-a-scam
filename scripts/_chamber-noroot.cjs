const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const root = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/';

function loadJpg(file) {
  return jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
}

function isChroma(r, g, b) {
  return g > 150 && r < 110 && b < 110 && g > r + 45 && g > b + 45;
}

function isBrown(r, g, b) {
  return r > 75 && r + 8 > g && g > 28 && b < r - 8 && r < 210 && b < 140 && !isChroma(r, g, b);
}

function isGlass(r, g, b) {
  return !isChroma(r, g, b) && g > 70 && g > b && g + 5 > r;
}

function isRoot(r, g, b) {
  return r > 40 && r > g && g > 12 && b < 70 && r < 150 && g < 100 && !isChroma(r, g, b);
}

function stripRoot(src) {
  const { width, height, data } = src;
  const out = new Uint8Array(data);
  const cleanY = 690;
  for (let y = 530; y <= 640; y++) {
    for (let x = 160; x <= 260; x++) {
      const i = (y * width + x) * 4;
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      if (!isBrown(r, g, b) && !isRoot(r, g, b)) continue;
      const s = (cleanY * width + x) * 4;
      out[i] = data[s];
      out[i + 1] = data[s + 1];
      out[i + 2] = data[s + 2];
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function keyGreen(src) {
  const { width, height, data } = src;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isChroma(r, g, b)) continue;
    let gg = g;
    const spill = g - Math.max(r, b);
    if (spill > 20) gg = Math.max(r, b);
    out[i] = r;
    out[i + 1] = gg;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}

function keyBlack(src) {
  const { width, height, data } = src;
  const bg = new Uint8Array(width * height);
  const q = [];
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] < 14 && data[i + 1] < 14 && data[i + 2] < 14;
  };
  for (let x = 0; x < width; x++) q.push(x, 0, x, height - 1);
  for (let y = 0; y < height; y++) q.push(0, y, width - 1, y);
  for (let k = 0; k < q.length; k += 2) {
    const x = q[k];
    const y = q[k + 1];
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (bg[p] || !dark(x, y)) continue;
    bg[p] = 1;
    q.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (bg[y * width + x]) continue;
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function contentBox(src) {
  let minX = src.width;
  let minY = src.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.data[(y * src.width + x) * 4 + 3] < 20) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const target = PNG.sync.read(fs.readFileSync('public/art/ui/event-cloning-chamber-object.png'));

function place(src, file) {
  const box = contentBox(src);
  const scale = Math.min(target.width / box.w, target.height / box.h);
  const dw = box.w * scale;
  const dh = box.h * scale;
  const dx = (target.width - dw) / 2;
  const dy = (target.height - dh) / 2;
  const out = new PNG({ width: target.width, height: target.height });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = box.minX + (x - dx) / scale;
      const sy = box.minY + (y - dy) / scale;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      if (x0 < 0 || y0 < 0 || x1 >= src.width || y1 >= src.height) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * src.width + x0) * 4;
      const i10 = (y0 * src.width + x1) * 4;
      const i01 = (y1 * src.width + x0) * 4;
      const i11 = (y1 * src.width + x1) * 4;
      const a =
        src.data[i00 + 3] * (1 - fx) * (1 - fy) +
        src.data[i10 + 3] * fx * (1 - fy) +
        src.data[i01 + 3] * (1 - fx) * fy +
        src.data[i11 + 3] * fx * fy;
      if (a < 16) continue;
      const j = (y * out.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        out.data[j + k] = Math.round(
          src.data[i00 + k] * (1 - fx) * (1 - fy) +
          src.data[i10 + k] * fx * (1 - fy) +
          src.data[i01 + k] * (1 - fx) * fy +
          src.data[i11 + k] * fx * fy
        );
      }
      out.data[j + 3] = a > 200 ? 255 : Math.round(a);
    }
  }
  fs.writeFileSync(file, PNG.sync.write(out));
  console.log('wrote', file, 'scale', scale.toFixed(3));
}

const shut = stripRoot(loadJpg(root + 'chamber-shut-noroot.png'));
const shutKeyed = keyGreen(shut);
place(shutKeyed, 'public/art/ui/event-cloning-chamber-object.png');
place(keyBlack(loadJpg(root + 'chamber-inside-nostrap.png')), 'public/art/ui/event-cloning-chamber-inside-object.png');
place(keyBlack(loadJpg(root + 'chamber-exit-nostrap.png')), 'public/art/ui/event-cloning-chamber-exit-object.png');

const preview = new PNG({ width: 220, height: 420 });
const placed = PNG.sync.read(fs.readFileSync('public/art/ui/event-cloning-chamber-object.png'));
for (let y = 0; y < 420; y++) {
  for (let x = 0; x < 220; x++) {
    const s = ((y + 300) * placed.width + (x + 40)) * 4;
    const d = (y * 220 + x) * 4;
    preview.data[d] = placed.data[s];
    preview.data[d + 1] = placed.data[s + 1];
    preview.data[d + 2] = placed.data[s + 2];
    preview.data[d + 3] = 255;
  }
}
fs.writeFileSync('scripts/_shut-left-fixed.png', PNG.sync.write(preview));
