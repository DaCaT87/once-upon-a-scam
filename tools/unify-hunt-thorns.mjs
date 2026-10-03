import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const SPINES =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_image-7e6e1570-e106-4562-b0bc-c4c731d97a28.png';

const CARDS = [
  ['thousand-maws', 0.42],
  ['mad-woodsman', 0.0],
  ['sewer-lord', 0.16],
  ['purple-widows', 0.04],
  ['greed-fang', 0.28],
  ['silk-cocoon', 0.12],
];

const RARITY = {
  'thousand-maws': 'bronze',
  'mad-woodsman': 'platinum',
  'sewer-lord': 'gold',
  'purple-widows': 'silver',
  'greed-fang': 'diamond',
  'silk-cocoon': 'silver',
};

const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';
const TARGET_W = 684;
const TARGET_H = 1030;

function decodePng(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
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
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

function scaleTo(src, dw, dh) {
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * src.width) / dw - 0.5;
      const sy = ((y + 0.5) * src.height) / dh - 0.5;
      const pix = bilinear(src, sx, sy);
      const o = (y * dw + x) * 4;
      out.data[o] = Math.round(pix[0]);
      out.data[o + 1] = Math.round(pix[1]);
      out.data[o + 2] = Math.round(pix[2]);
      out.data[o + 3] = Math.round(pix[3]);
    }
  }
  return out;
}

function luma(r, g, b) {
  return (r + g + b) / 3;
}

function isLeaf(r, g, b) {
  return g > r + 12 && g > b + 8 && g > 40 && g < 210 && luma(r, g, b) < 170;
}

function isThornish(r, g, b) {
  const l = luma(r, g, b);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return l < 62 && spread < 48;
}

function distToEdge(x, y, w, h) {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

function dilateAlpha(src, radius) {
  const { width: w, height: h, data } = src;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const xx = Math.max(0, Math.min(w - 1, x + dx));
          const yy = Math.max(0, Math.min(h - 1, y + dy));
          const a = data[(yy * w + xx) * 4 + 3] / 255;
          if (a > best) best = a;
        }
      }
      out[y * w + x] = best;
    }
  }
  return out;
}

function clearUnderOverlay(card, cover) {
  const { width: w, height: h, data } = card;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const d = distToEdge(x, y, w, h);
      const under = cover[i] > 0.18;
      const outer = d < 28;
      const strayLeaf = d < 92 && isLeaf(r, g, b);
      const strayThorn = d < 44 && isThornish(r, g, b);
      if (!(under || outer || strayLeaf || strayThorn)) continue;
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return card;
}

function charcoalLeaves(spines) {
  const { data } = spines;
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] < 12) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (!isLeaf(r, g, b)) continue;
    const gray = Math.round(0.22 * r + 0.48 * g + 0.3 * b);
    data[o] = Math.round(gray * 0.28);
    data[o + 1] = Math.round(gray * 0.26);
    data[o + 2] = Math.round(gray * 0.24);
  }
  return spines;
}

const ART = { l: 46, t: 42, r: 638, b: 512 };

function coverBlit(dest, src, box, ay = 0.38) {
  const dw = box.r - box.l + 1;
  const dh = box.b - box.t + 1;
  const scale = Math.max(dw / src.width, dh / src.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const ox = (src.width - sw) / 2;
  const oy = (src.height - sh) * ay;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const tx = box.l + x;
      const ty = box.t + y;
      const sx = ox + ((x + 0.5) * sw) / dw - 0.5;
      const sy = oy + ((y + 0.5) * sh) / dh - 0.5;
      const pix = bilinear(src, sx, sy);
      const o = (ty * dest.width + tx) * 4;
      dest.data[o] = Math.round(pix[0]);
      dest.data[o + 1] = Math.round(pix[1]);
      dest.data[o + 2] = Math.round(pix[2]);
      dest.data[o + 3] = 255;
    }
  }
}

function blit(dest, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dest.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dest.width) continue;
      const so = (y * src.width + x) * 4;
      const sa = src.data[so + 3] / 255;
      if (sa <= 0.02) continue;
      const doff = (ty * dest.width + tx) * 4;
      const da = dest.data[doff + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) {
        const s = src.data[so + k];
        const d = dest.data[doff + k];
        dest.data[doff + k] = Math.round((s * sa + d * da * (1 - sa)) / (outA || 1));
      }
      dest.data[doff + 3] = Math.round(outA * 255);
    }
  }
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png));
}

const rawSpines = charcoalLeaves(decodePng(readFileSync(SPINES)));
const spines = scaleTo(rawSpines, TARGET_W, TARGET_H);

for (const [folder, ay] of CARDS) {
  const path = `${ROOT}/${folder}/card.png`;
  let card = decodePng(readFileSync(path));
  if (card.width !== TARGET_W || card.height !== TARGET_H) {
    card = scaleTo(card, TARGET_W, TARGET_H);
  }
  const idle = decodePng(readFileSync(`${ROOT}/${folder}/idle.png`));
  coverBlit(card, idle, ART, ay);
  const gem = scaleTo(decodePng(readFileSync(`${UI}/rarity-corner-${RARITY[folder]}.png`)), TARGET_W, TARGET_H);
  blit(card, gem, 0, 0);
  blit(card, spines, 0, 0);
  writePng(card, path);
  console.log(`unified ${folder} ${TARGET_W}x${TARGET_H}`);
}

writePng(spines, `${UI}/spines.png`);
