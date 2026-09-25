import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

function decodeImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function sample(data, width, height, x, y) {
  const ix = Math.max(0, Math.min(width - 1, x));
  const iy = Math.max(0, Math.min(height - 1, y));
  const o = (iy * width + ix) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function bilinear(src, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = sample(src.data, src.width, src.height, x0, y0);
  const b = sample(src.data, src.width, src.height, x0 + 1, y0);
  const c = sample(src.data, src.width, src.height, x0, y0 + 1);
  const d = sample(src.data, src.width, src.height, x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = Math.round(top + (bot - top) * fy);
  }
  return out;
}

function inRoundRect(x, y, l, t, r, b, rad) {
  if (x < l || x > r || y < t || y > b) return false;
  const cx = x < l + rad ? l + rad : x > r - rad ? r - rad : x;
  const cy = y < t + rad ? t + rad : y > b - rad ? b - rad : y;
  if (cx === x || cy === y) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function inRarityTriangle(x, y, width) {
  const left = 498;
  const top = 16;
  const right = width - 22;
  const bottom = 140;
  if (x < left || y < top || x > right || y > bottom) return false;
  const yOnHyp = top + ((x - left) / (right - left)) * (bottom - top);
  return y <= yOnHyp + 7;
}

function toPng(src) {
  const png = new PNG({ width: src.width, height: src.height });
  png.data.set(src.data);
  return png;
}

function compileCard(scene, template) {
  const out = new PNG({ width: template.width, height: template.height });
  out.data.set(template.data);
  const l = 24;
  const t = 22;
  const r = template.width - 25;
  const b = 536;
  const rad = 22;
  const aw = r - l + 1;
  const ah = b - t + 1;
  const scale = Math.max(aw / scene.width, ah / scene.height);
  const dw = scene.width * scale;
  const dh = scene.height * scale;
  const ox = l + (aw - dw) / 2;
  const oy = t + (ah - dh) / 2;
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= r; x++) {
      if (!inRoundRect(x, y, l, t, r, b, rad)) continue;
      if (inRarityTriangle(x, y, template.width)) continue;
      const edge = !inRoundRect(x, y, l + 8, t + 8, r - 8, b - 8, Math.max(6, rad - 8));
      if (edge) {
        const o = (y * template.width + x) * 4;
        const tr = template.data[o];
        const tg = template.data[o + 1];
        const tb = template.data[o + 2];
        const dark = tr < 45 && tg < 40 && tb < 40;
        const gold = tr > 90 && tg > 48 && tb < 110 && tr > tb + 25;
        if (dark || gold) continue;
      }
      const sx = (x - ox + 0.5) / scale - 0.5;
      const sy = (y - oy + 0.5) / scale - 0.5;
      const pix = bilinear(scene, sx, sy);
      const o = (y * template.width + x) * 4;
      out.data[o] = pix[0];
      out.data[o + 1] = pix[1];
      out.data[o + 2] = pix[2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function writeScenePng(scene, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, PNG.sync.write(toPng(scene)));
}

function writeClips(idlePath, folder) {
  for (const clip of ['idle2', 'attack', 'hit', 'death']) {
    copyFileSync(idlePath, `${folder}/${clip}.png`);
  }
}

const root = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const template = PNG.sync.read(readFileSync(`${root}/phoenix/card.png`));

for (const id of ['king-of-crows', 'flock-of-ravens']) {
  const scene = decodeImage(readFileSync(`${root}/${id}/idle.png`));
  writeFileSync(`${root}/${id}/card.png`, PNG.sync.write(compileCard(scene, template)));
  console.log(`compiled ${id} onto phoenix frame`);
}
