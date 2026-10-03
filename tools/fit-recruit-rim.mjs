import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

spawnSync(process.execPath, ['tools/install-alley-recruit-plate.mjs'], { stdio: 'inherit' });

const sticker = PNG.sync.read(readFileSync('public/art/ui/plate-sticker.png'));
const recruitSrc = PNG.sync.read(readFileSync('public/art/ui/plate-recruit.png'));

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function isBlack(r, g, b, a) {
  if (a < 180) return false;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return luma(r, g, b) < 46 && mx - mn < 30;
}

function scaleTo(src, dw, dh) {
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * src.height) / dh - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(src.height - 1, y0 + 1));
    const fy = sy - Math.floor(sy);
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * src.width) / dw - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(src.width - 1, x0 + 1));
      const fx = sx - Math.floor(sx);
      const at = (ix, iy) => {
        const o = (iy * src.width + ix) * 4;
        return [src.data[o], src.data[o + 1], src.data[o + 2], src.data[o + 3]];
      };
      const a = at(x0, y0);
      const b = at(x1, y0);
      const c = at(x0, y1);
      const d = at(x1, y1);
      const o = (y * dw + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = a[k] + (b[k] - a[k]) * fx;
        const bot = c[k] + (d[k] - c[k]) * fx;
        out.data[o + k] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return out;
}

/** Gold-frame start, ignoring the rounded corners (middle 50% of each edge). */
function insets(img) {
  const { width: w, height: h, data } = img;
  const blackAt = (x, y) => {
    const o = (y * w + x) * 4;
    return isBlack(data[o], data[o + 1], data[o + 2], data[o + 3]);
  };
  const opaqueAt = (x, y) => data[(y * w + x) * 4 + 3] > 16;
  const depth = (axis, at, inward) => {
    const n0 = Math.round((axis === 'x' ? h : w) * 0.25);
    const n1 = Math.round((axis === 'x' ? h : w) * 0.75);
    const samples = [];
    for (let i = n0; i < n1; i += 4) {
      let d = 0;
      const limit = axis === 'x' ? w : h;
      while (d < 40) {
        const x = axis === 'x' ? (inward > 0 ? d : w - 1 - d) : i;
        const y = axis === 'y' ? (inward > 0 ? d : h - 1 - d) : i;
        if (opaqueAt(x, y) && !blackAt(x, y)) break;
        d++;
        if (d >= limit) break;
      }
      samples.push(d);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };
  return {
    l: depth('x', 0, 1),
    r: depth('x', 0, -1),
    t: depth('y', 0, 1),
    b: depth('y', 0, -1),
  };
}

const recruit = scaleTo(recruitSrc, sticker.width, sticker.height);
const si = insets(sticker);
const ri = insets(recruit);
console.log('sticker insets', si, sticker.width, sticker.height);
console.log('recruit insets', ri, recruit.width, recruit.height);

const sl = si.l;
const sr = sticker.width - 1 - si.r;
const st = si.t;
const sb = sticker.height - 1 - si.b;
const rl = ri.l;
const rr = recruit.width - 1 - ri.r;
const rt = ri.t;
const rb = recruit.height - 1 - ri.b;

function sampleRecruit(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    const xx = Math.max(0, Math.min(recruit.width - 1, ix));
    const yy = Math.max(0, Math.min(recruit.height - 1, iy));
    const o = (yy * recruit.width + xx) * 4;
    return [recruit.data[o], recruit.data[o + 1], recruit.data[o + 2], recruit.data[o + 3]];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

const out = new PNG({ width: sticker.width, height: sticker.height });
for (let y = 0; y < sticker.height; y++) {
  for (let x = 0; x < sticker.width; x++) {
    const so = (y * sticker.width + x) * 4;
    const sa = sticker.data[so + 3];
    const o = so;
    if (sa < 8) {
      out.data[o] = out.data[o + 1] = out.data[o + 2] = out.data[o + 3] = 0;
      continue;
    }
    const nx = (x - sl) / (sr - sl);
    const ny = (y - st) / (sb - st);
    const sx = rl + nx * (rr - rl);
    const sy = rt + ny * (rb - rt);
    const pix = sampleRecruit(sx, sy);
    if (pix[3] < 200) {
      out.data[o] = 8;
      out.data[o + 1] = 10;
      out.data[o + 2] = 10;
      out.data[o + 3] = sa;
      continue;
    }
    out.data[o] = Math.round(pix[0]);
    out.data[o + 1] = Math.round(pix[1]);
    out.data[o + 2] = Math.round(pix[2]);
    out.data[o + 3] = Math.round(Math.min(255, pix[3]) * (sa / 255));
  }
}

writeFileSync('public/art/ui/plate-recruit.png', PNG.sync.write(out));
console.log('inner map', { sl, st, sr, sb, rl, rt, rr, rb });
console.log('wrote plate-recruit.png');
