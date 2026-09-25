const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const open = PNG.sync.read(fs.readFileSync('public/art/ui/event-witch-oven-open-object.png'));

function bounds(w, h, getA) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (getA(x, y) > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const openBox = bounds(open.width, open.height, (x, y) => open.data[(y * open.width + x) * 4 + 3]);

function isGreen(r, g, b) {
  return g > 90 && g > r + 35 && g > b + 35;
}

function decodeKeyed(file) {
  const jpg = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  const { width, height, data } = jpg;
  const corner = (0) * 4;
  console.log(file.split('/').pop(), width + 'x' + height, 'corner', data[corner], data[corner + 1], data[corner + 2]);
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      if (isGreen(r, g, b)) continue;
      const spill = g - Math.max(r, b);
      if (spill > 18) g = Math.max(r, b);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function sample(src, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= src.width || y1 >= src.height) return null;
  const fx = sx - x0;
  const fy = sy - y0;
  const i00 = (y0 * src.width + x0) * 4;
  const i10 = (y0 * src.width + x1) * 4;
  const i01 = (y1 * src.width + x0) * 4;
  const i11 = (y1 * src.width + x1) * 4;
  const o = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    o[k] =
      src.data[i00 + k] * (1 - fx) * (1 - fy) +
      src.data[i10 + k] * fx * (1 - fy) +
      src.data[i01 + k] * (1 - fx) * fy +
      src.data[i11 + k] * fx * fy;
  }
  return o;
}

function place(src, file) {
  const box = bounds(src.width, src.height, (x, y) => src.data[(y * src.width + x) * 4 + 3]);
  const scale = Math.min(openBox.w / box.w, openBox.h / box.h);
  const dw = box.w * scale;
  const dh = box.h * scale;
  const dx = openBox.minX + (openBox.w - dw) / 2;
  const dy = openBox.minY + (openBox.h - dh) / 2;
  const out = new PNG({ width: open.width, height: open.height });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const c = sample(src, box.minX + (x - dx) / scale, box.minY + (y - dy) / scale);
      if (!c || c[3] < 8) continue;
      const j = (y * out.width + x) * 4;
      out.data[j] = Math.round(c[0]);
      out.data[j + 1] = Math.round(c[1]);
      out.data[j + 2] = Math.round(c[2]);
      out.data[j + 3] = c[3] > 200 ? 255 : Math.round(c[3]);
    }
  }
  let holes = 0;
  for (let y = 8; y < out.height - 8; y++) {
    for (let x = 8; x < out.width - 8; x++) {
      const a = out.data[(y * out.width + x) * 4 + 3];
      if (a > 16) continue;
      let n = 0;
      for (const [ox, oy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
        if (out.data[((y + oy) * out.width + (x + ox)) * 4 + 3] > 200) n++;
      }
      if (n >= 3) holes++;
    }
  }
  fs.writeFileSync(file, PNG.sync.write(out));
  console.log('wrote', file, 'scale', scale.toFixed(3), 'interiorHoles', holes);
}

const root = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/';
place(decodeKeyed(root + 'oven-chew-1-clean.png'), 'public/art/ui/event-witch-oven-chew-1.png');
place(decodeKeyed(root + 'oven-chew-2-clean.png'), 'public/art/ui/event-witch-oven-chew-2.png');
