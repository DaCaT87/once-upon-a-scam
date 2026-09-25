import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

const SRC =
  'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/art-witch-oven-oval.png';
const DEST = 'C:/Users/copan/Desktop/Once Upon a Scam/assets/oven-style-preview.jpg';

function luma(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const buf = readFileSync(SRC);
const decoded =
  buf[0] === 0x89
    ? PNG.sync.read(buf)
    : decodeJpeg(buf, { useTArray: true });
const { width: w, height: h } = decoded;
const src = Buffer.from(decoded.data);
const out = Buffer.alloc(w * h * 4);

const levels = 10;

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let r = src[o];
    let g = src[o + 1];
    let b = src[o + 2];
    const L = luma(r, g, b);

    // leave pure void alone
    if (L < 14) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      out[o + 3] = 255;
      continue;
    }

    const fire = r > 140 && r > g + 25 && r > b + 20;
    const c = fire ? 1.05 : 1.12;
    r = (r - 118) * c + 118;
    g = (g - 118) * c + 112;
    b = (b - 118) * c + 108;

    if (!fire && L > 40) {
      const q = 255 / (levels - 1);
      r = Math.round(r / q) * q;
      g = Math.round(g / q) * q;
      b = Math.round(b / q) * q;
    }

    out[o] = clamp(r);
    out[o + 1] = clamp(g);
    out[o + 2] = clamp(b);
    out[o + 3] = 255;
  }
}

// Sobel on original luma, ink the strong edges
const mag = new Float32Array(w * h);
for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const at = (xx, yy) => {
      const o = (yy * w + xx) * 4;
      return luma(src[o], src[o + 1], src[o + 2]);
    };
    const gx =
      -at(x - 1, y - 1) + at(x + 1, y - 1) +
      -2 * at(x - 1, y) + 2 * at(x + 1, y) +
      -at(x - 1, y + 1) + at(x + 1, y + 1);
    const gy =
      -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
      at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
    mag[y * w + x] = Math.hypot(gx, gy);
  }
}

for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const m = mag[y * w + x];
    if (m < 140) continue;
    const o = (y * w + x) * 4;
    const ink = Math.min(0.55, (m - 140) / 380);
    out[o] = clamp(out[o] * (1 - ink));
    out[o + 1] = clamp(out[o + 1] * (1 - ink));
    out[o + 2] = clamp(out[o + 2] * (1 - ink));
  }
}

writeFileSync(DEST, encodeJpeg({ data: out, width: w, height: h }, 92).data);
console.log('wrote', DEST, `${w}x${h}`);
