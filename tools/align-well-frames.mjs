import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';
const FILES = [
  'event-wishing-well.jpg',
  'event-wishing-well-open.jpg',
  'event-wishing-well-fed.jpg',
];

const CANVAS_W = 864;
const CANVAS_H = 1152;

function decodeImage(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpg = decodeJpeg(buf, { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  }
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: Buffer.from(png.data) };
}

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function isBg(r, g, b) {
  const L = luma(r, g, b);
  if (L < 22) return true;
  if (L < 38 && Math.max(r, g, b) - Math.min(r, g, b) < 18) return true;
  return false;
}

function contentBox(img) {
  const { width: w, height: h, data } = img;
  let l = w;
  let t = h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (isBg(data[o], data[o + 1], data[o + 2])) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b, w: r - l + 1, h: b - t + 1, cx: (l + r) / 2, cy: (t + b) / 2 };
}

function sample(img, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return [0, 0, 0, 255];
    const o = (iy * img.width + ix) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0, 255];
  for (let k = 0; k < 3; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bot = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
  return out;
}

/** Scale by content width; pin horizontal center + bottom edge (oval stays locked). */
function alignBottomCenter(src, box, targetWidth, destCx, destBottom) {
  const scale = targetWidth / box.w;
  const dw = box.w * scale;
  const dh = box.h * scale;
  const destL = destCx - dw / 2;
  const destT = destBottom - dh;

  const out = {
    width: CANVAS_W,
    height: CANVAS_H,
    data: Buffer.alloc(CANVAS_W * CANVAS_H * 4, 0),
  };
  for (let i = 0; i < CANVAS_W * CANVAS_H; i++) out.data[i * 4 + 3] = 255;

  // If magic overflows top, shift down? Better clip top than jump bottom.
  const x0 = Math.max(0, Math.floor(destL));
  const y0 = Math.max(0, Math.floor(destT));
  const x1 = Math.min(CANVAS_W, Math.ceil(destL + dw));
  const y1 = Math.min(CANVAS_H, Math.ceil(destT + dh));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - destL) / dw;
      const v = (y + 0.5 - destT) / dh;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      const pix = sample(src, box.l + u * box.w, box.t + v * box.h);
      const o = (y * CANVAS_W + x) * 4;
      out.data[o] = Math.round(pix[0]);
      out.data[o + 1] = Math.round(pix[1]);
      out.data[o + 2] = Math.round(pix[2]);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

const imgs = FILES.map((name) => {
  const img = decodeImage(`${UI}/${name}`);
  return { name, img, box: contentBox(img) };
});

for (const item of imgs) {
  console.log('before', item.name, {
    canvas: `${item.img.width}x${item.img.height}`,
    w: item.box.w,
    h: item.box.h,
    cx: +item.box.cx.toFixed(1),
    bottom: item.box.b,
  });
}

const ref = imgs[0];
const targetWidth = ref.box.w;
const destCx = CANVAS_W / 2;
// Keep shut's bottom, but ensure tallest frame still fits: if open taller, keep bottom and allow top clip OR nudge bottom down
const scales = imgs.map((i) => targetWidth / i.box.w);
const heights = imgs.map((i, idx) => i.box.h * scales[idx]);
const maxH = Math.max(...heights);
let destBottom = Math.round(ref.box.b * (CANVAS_H / ref.img.height));
if (destBottom - maxH < 8) destBottom = Math.round(maxH + 8);
if (destBottom > CANVAS_H - 24) destBottom = CANVAS_H - 24;

console.log({ targetWidth, destCx, destBottom, heights: heights.map((h) => +h.toFixed(1)) });

for (const item of imgs) {
  const aligned = alignBottomCenter(item.img, item.box, targetWidth, destCx, destBottom);
  writeFileSync(
    `${UI}/${item.name}`,
    encodeJpeg({ data: aligned.data, width: CANVAS_W, height: CANVAS_H }, 92).data,
  );
  const check = contentBox(aligned);
  console.log('after', item.name, {
    size: `${CANVAS_W}x${CANVAS_H}`,
    w: check.w,
    h: check.h,
    cx: +check.cx.toFixed(1),
    bottom: check.b,
    top: check.t,
  });
}
