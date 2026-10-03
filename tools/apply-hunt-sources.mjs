import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const ASSETS =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const ROOT = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/units';
const TARGET_W = 684;
const TARGET_H = 1030;
const ART = { l: 46, t: 42, r: 638, b: 512 };

const SOURCES = [
  [
    'purple-widows',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Purple_Widow-20ac5b91-0fc7-4fd9-ab35-24e74354b26a.png`,
  ],
  [
    'mad-woodsman',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Mad_Woodsman-6bbef2eb-822e-48ab-bbbf-c1fd255b358b.jpg`,
  ],
  [
    'thousand-maws',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Thousand_Maws-4b0e2126-1634-44a7-a77f-77cc50d43054.jpg`,
  ],
  [
    'greed-fang',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Avarice_Wyrm-98c3077a-694e-4f28-98e9-c92f4d1971d3.png`,
  ],
  [
    'silk-cocoon',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Cocoon-41a8aab1-5179-4ca9-9dbd-e4320bb92e53.png`,
  ],
  [
    'sewer-lord',
    `${ASSETS}/c__Users_copan_AppData_Roaming_Cursor_User_workspaceStorage_39f0117879db467f92618b6dc4c58c15_images_Sewer_Lord-cca1780c-8185-41b0-82ff-280267030514.png`,
  ],
];

function decode(path) {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg')) {
    const raw = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    return { width: raw.width, height: raw.height, data: Buffer.from(raw.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function chromaAlpha(r, g, b) {
  const greenness = g - Math.max(r, b);
  if (g >= 90 && greenness >= 28 && r < 190 && b < 190) return 0;
  if (g >= 70 && greenness >= 16 && r < 210 && b < 210) {
    return Math.round(255 * Math.min(1, (28 - greenness) / 12));
  }
  return 255;
}

function bboxOpaque(img) {
  const { width: w, height: h, data } = img;
  let l = w;
  let t = h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = chromaAlpha(data[o], data[o + 1], data[o + 2]);
      if (a < 16) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b };
}

function cropKeyed(img, box) {
  const dw = box.r - box.l + 1;
  const dh = box.b - box.t + 1;
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    const sy = box.t + y;
    for (let x = 0; x < dw; x++) {
      const sx = box.l + x;
      const so = (sy * img.width + sx) * 4;
      const o = (y * dw + x) * 4;
      const r = img.data[so];
      const g = img.data[so + 1];
      const b = img.data[so + 2];
      const a = chromaAlpha(r, g, b);
      if (a <= 0) {
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 0;
        continue;
      }
      const spill = Math.max(0, g - Math.max(r, b));
      const cut = Math.min(g, spill * 0.55);
      out.data[o] = r;
      out.data[o + 1] = Math.max(0, Math.round(g - cut));
      out.data[o + 2] = b;
      out.data[o + 3] = a;
    }
  }
  return out;
}

function sample(data, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return [0, 0, 0, 0];
  const o = (y * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function bilinear(src, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const p = [
    sample(src.data, src.width, src.height, x0, y0),
    sample(src.data, src.width, src.height, x0 + 1, y0),
    sample(src.data, src.width, src.height, x0, y0 + 1),
    sample(src.data, src.width, src.height, x0 + 1, y0 + 1),
  ];
  const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const aa = (p[i][3] / 255) * wts[i];
    r += p[i][0] * aa;
    g += p[i][1] * aa;
    b += p[i][2] * aa;
    a += aa;
  }
  if (a <= 0.0001) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, a * 255];
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

function extractArt(card) {
  const dw = ART.r - ART.l + 1;
  const dh = ART.b - ART.t + 1;
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const so = ((ART.t + y) * card.width + (ART.l + x)) * 4;
      const o = (y * dw + x) * 4;
      out.data[o] = card.data[so];
      out.data[o + 1] = card.data[so + 1];
      out.data[o + 2] = card.data[so + 2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function writePng(img, dest) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  writeFileSync(dest, PNG.sync.write(png, { colorType: 6 }));
}

function countAlpha(img) {
  let transparent = 0;
  let opaque = 0;
  for (let o = 3; o < img.data.length; o += 4) {
    if (img.data[o] < 16) transparent += 1;
    else if (img.data[o] > 240) opaque += 1;
  }
  return { transparent, opaque, total: img.width * img.height };
}

for (const [folder, path] of SOURCES) {
  const img = decode(path);
  const box = bboxOpaque(img);
  let card = cropKeyed(img, box);
  if (card.width !== TARGET_W || card.height !== TARGET_H) {
    card = scaleTo(card, TARGET_W, TARGET_H);
  }
  const stats = countAlpha(card);
  writePng(card, `${ROOT}/${folder}/card.png`);
  writePng(extractArt(card), `${ROOT}/${folder}/idle.png`);
  console.log(
    `${folder} src ${img.width}x${img.height} box ${JSON.stringify(box)} ` +
      `alpha t=${stats.transparent} o=${stats.opaque} / ${stats.total}`,
  );
}
