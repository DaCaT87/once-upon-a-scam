import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const BLACK_LUMA = 42;
const WHITE_LUMA = 246;
const TARGET = 1024;

function sample(data, width, height, x, y) {
  const ix = Math.max(0, Math.min(width - 1, x));
  const iy = Math.max(0, Math.min(height - 1, y));
  const o = (iy * width + ix) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function resizeSquare(src, target) {
  const out = new PNG({ width: target, height: target });
  const scale = src.width / target;
  for (let y = 0; y < target; y++) {
    const sy = (y + 0.5) * scale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < target; x++) {
      const sx = (x + 0.5) * scale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const a = sample(src.data, src.width, src.height, x0, y0);
      const b = sample(src.data, src.width, src.height, x0 + 1, y0);
      const c = sample(src.data, src.width, src.height, x0, y0 + 1);
      const d = sample(src.data, src.width, src.height, x0 + 1, y0 + 1);
      const o = (y * target + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = a[k] + (b[k] - a[k]) * fx;
        const bot = c[k] + (d[k] - c[k]) * fx;
        out.data[o + k] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return out;
}

function decodeImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function luma(data, o) {
  return (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
}

function isBlackKey(data, o) {
  const a = data[o + 3] ?? 255;
  if (a < 8) return true;
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return luma(data, o) <= BLACK_LUMA && max - min <= 36;
}

function isWhiteKey(data, o) {
  const a = data[o + 3] ?? 255;
  if (a < 8) return true;
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return luma(data, o) >= WHITE_LUMA && max - min <= 22;
}

function punchThickInteriorHoles(data, width, height, isKey) {
  const n = width * height;
  const keyMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 10) continue;
    if (isKey(data, i * 4)) keyMask[i] = 1;
  }
  const seen = new Uint8Array(n);
  const stack = [];
  for (let start = 0; start < n; start++) {
    if (!keyMask[start] || seen[start]) continue;
    const comp = [];
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x + 1 < width) {
        const j = i + 1;
        if (keyMask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
      if (x > 0) {
        const j = i - 1;
        if (keyMask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
      if (y + 1 < height) {
        const j = i + width;
        if (keyMask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
      if (y > 0) {
        const j = i - width;
        if (keyMask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    let hasCore = false;
    for (const p of comp) {
      const x = p % width;
      const y = (p - x) / width;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!keyMask[(y + dy) * width + (x + dx)]) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        hasCore = true;
        break;
      }
    }
    if (!hasCore) continue;
    for (const p of comp) data[p * 4 + 3] = 0;
  }
}

function cleanHoleFringe(data, width, height, isKey) {
  const n = width * height;
  const exterior = new Uint8Array(n);
  const q = [];
  const push = (i) => {
    if (i < 0 || i >= n || exterior[i]) return;
    if (data[i * 4 + 3] >= 10) return;
    exterior[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (q.length) {
    const i = q.pop();
    const x = i % width;
    if (x + 1 < width) push(i + 1);
    if (x > 0) push(i - 1);
    if (i + width < n) push(i + width);
    if (i - width >= 0) push(i - width);
  }
  const punch = [];
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] >= 10) continue;
    if (exterior[i]) continue;
    const x = i % width;
    const nbs = [];
    if (x + 1 < width) nbs.push(i + 1);
    if (x > 0) nbs.push(i - 1);
    if (i + width < n) nbs.push(i + width);
    if (i - width >= 0) nbs.push(i - width);
    for (const j of nbs) {
      if (data[j * 4 + 3] < 10) continue;
      if (isKey(data, j * 4)) punch.push(j);
    }
  }
  for (const j of punch) data[j * 4 + 3] = 0;
}

function cutSticker(src, dest, key = 'black', punchHoles = false) {
  const { width, height, data } = decodeImage(readFileSync(src));
  const isKey = key === 'white' ? isWhiteKey : isBlackKey;
  const seen = new Uint8Array(width * height);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    if (!isKey(data, i * 4)) return;
    seen[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (q.length) {
    const i = q.pop();
    data[i * 4 + 3] = 0;
    const x = i % width;
    const y = (i - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  if (punchHoles) punchThickInteriorHoles(data, width, height, isKey);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 10) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) throw new Error(`no opaque pixels in ${src}`);
  const pad = Math.max(4, Math.round(Math.max(maxX - minX, maxY - minY) * 0.04));
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const side = Math.max(w, h);
  const square = new PNG({ width: side, height: side });
  square.data.fill(0);
  const ox = Math.floor((side - w) / 2);
  const oy = Math.floor((side - h) / 2);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y0 + y) * width + x0) * 4;
    const dstOff = ((oy + y) * side + ox) * 4;
    data.copy(square.data, dstOff, srcOff, srcOff + w * 4);
  }
  const out = side === TARGET ? square : resizeSquare(square, TARGET);
  if (punchHoles) {
    punchThickInteriorHoles(out.data, out.width, out.height, isKey);
    cleanHoleFringe(out.data, out.width, out.height, isKey);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, PNG.sync.write(out));
  console.log(`${basename(src)} -> ${basename(dest)} ${out.width}x${out.height}`);
}

function fitPng(src) {
  const png = PNG.sync.read(readFileSync(src));
  if (png.width <= 256 && png.height <= 256) return false;
  if (png.width === TARGET && png.height === TARGET) return false;
  let square = png;
  if (png.width !== png.height) {
    const side = Math.max(png.width, png.height);
    square = new PNG({ width: side, height: side });
    square.data.fill(0);
    const ox = Math.floor((side - png.width) / 2);
    const oy = Math.floor((side - png.height) / 2);
    for (let y = 0; y < png.height; y++) {
      png.data.copy(
        square.data,
        ((oy + y) * side + ox) * 4,
        y * png.width * 4,
        (y + 1) * png.width * 4,
      );
    }
  }
  const out = square.width === TARGET ? square : resizeSquare(square, TARGET);
  writeFileSync(src, PNG.sync.write(out));
  return true;
}

const raw = process.argv.slice(2);
const key = raw.includes('--white') ? 'white' : 'black';
const punchHoles = raw.includes('--holes');
const args = raw.filter((a) => a !== '--white' && a !== '--black' && a !== '--holes');
if (args.length === 0) {
  console.error('usage: node tools/cut-sticker.mjs [--white] [--holes] <src> <dest> | --dir <srcDir> <destDir> | --fit-dir <dir>');
  process.exit(1);
}
if (args[0] === '--fit-dir') {
  const { readdirSync } = await import('node:fs');
  const srcDir = args[1];
  let n = 0;
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.png')) continue;
    const src = join(srcDir, name);
    if (fitPng(src)) {
      n += 1;
      console.log(`fit ${name} -> ${TARGET}x${TARGET}`);
    }
  }
  console.log(`fitted ${n} stickers`);
} else if (args[0] === '--dir') {
  const srcDir = args[1];
  const destDir = args[2];
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(srcDir)) {
    if (!/\.(png|jpg|jpeg)$/i.test(name)) continue;
    const id = name.replace(/\.(png|jpg|jpeg)$/i, '');
    cutSticker(join(srcDir, name), join(destDir, `${id}.png`), key, punchHoles);
  }
} else {
  cutSticker(args[0], args[1], key, punchHoles);
}
