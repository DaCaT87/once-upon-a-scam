import { readFileSync, writeFileSync } from 'node:fs';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';

const ROOT = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets/';
const SQUARE = ROOT + 'draw-recruit-square.png';
const DEST = ROOT + 'art-recruit-market-8.png';

function decode(path) {
  const buf = readFileSync(path);
  const jpg = decodeJpeg(buf, { useTArray: true });
  return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
}

function isNavy(r, g, b) {
  return b > 68 && r < 55 && g < 95 && b > r + 32 && b > g + 18;
}

function floodNavy(img) {
  const { width: w, height: h, data } = img;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if ((r + g + b) / 3 < 32 && b < r + 18) ink[i] = 1;
  }
  const bar = new Uint8Array(ink);
  const rad = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          bar[yy * w + xx] = 1;
        }
      }
    }
  }
  const mask = new Uint8Array(w * h);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (mask[i] || bar[i]) return;
    const o = i * 4;
    if (!isNavy(data[o], data[o + 1], data[o + 2])) return;
    mask[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const x = p % w;
    const y = ((p - x) / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return mask;
}

function contentBox(img, navy) {
  const { width: w, height: h } = img;
  let l = w;
  let t = h;
  let r = 0;
  let b = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (navy[y * w + x]) continue;
      if (x < l) l = x;
      if (y < t) t = y;
      if (x > r) r = x;
      if (y > b) b = y;
    }
  }
  return { l, t, r, b };
}

const square = decode(SQUARE);
const out = Buffer.from(square.data);

function shadow(cx, feet, width) {
  const rx = width * 0.38;
  const ry = 14;
  for (let y = feet - ry; y <= feet + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= square.width || iy >= square.height) continue;
      const nx = (x - cx) / rx;
      const ny = (y - feet) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const a = (1 - d) * 0.45;
      const o = (iy * square.width + ix) * 4;
      out[o] = Math.round(out[o] * (1 - a));
      out[o + 1] = Math.round(out[o + 1] * (1 - a));
      out[o + 2] = Math.round(out[o + 2] * (1 - a));
    }
  }
}

function paste(file, cx, feet, targetH) {
  const img = decode(ROOT + file);
  const navy = floodNavy(img);
  const box = contentBox(img, navy);
  const scale = targetH / (box.b - box.t + 1);
  const destW = (box.r - box.l + 1) * scale;
  const destLeft = Math.round(cx - destW / 2);
  const destTop = Math.round(feet - targetH);
  shadow(cx, feet, destW);
  for (let y = destTop; y < destTop + targetH; y++) {
    for (let x = destLeft; x < destLeft + destW; x++) {
      if (x < 0 || y < 0 || x >= square.width || y >= square.height) continue;
      const sx = box.l + (x - destLeft) / scale;
      const sy = box.t + (y - destTop) / scale;
      const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(sy)));
      if (navy[y0 * img.width + x0]) continue;
      const o = (y0 * img.width + x0) * 4;
      let R = img.data[o];
      let G = img.data[o + 1];
      let B = img.data[o + 2];
      if (isNavy(R, G, B)) {
        let outside = false;
        for (let dy = -4; dy <= 4 && !outside; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const xx = x0 + dx;
            const yy = y0 + dy;
            if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height || navy[yy * img.width + xx]) {
              outside = true;
              break;
            }
          }
        }
        if (outside) continue;
        R = 24;
        G = 58;
        B = 145;
      }
      const oo = (y * square.width + x) * 4;
      out[oo] = R;
      out[oo + 1] = G;
      out[oo + 2] = B;
      out[oo + 3] = 255;
    }
  }
  console.log(file, 'box', box.r - box.l + 1, 'x', box.b - box.t + 1, 'at', destLeft, destTop);
}

function dot(x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= square.width || iy >= square.height) return;
  const o = (iy * square.width + ix) * 4;
  out[o] = 10;
  out[o + 1] = 10;
  out[o + 2] = 12;
}

function line(x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
}

function stick(x, feet, h, lean) {
  const hr = Math.max(3, h * 0.12);
  const headY = feet - h + hr;
  for (let yy = -hr; yy <= hr; yy++) {
    for (let xx = -hr; xx <= hr; xx++) {
      if (xx * xx + yy * yy <= hr * hr) dot(x + xx, headY + yy);
    }
  }
  const neck = headY + hr;
  const hip = feet - h * 0.4;
  line(x, neck, x + lean, hip);
  line(x, neck + 2, x - h * 0.22, hip);
  line(x, neck + 2, x + h * 0.22, hip);
  line(x + lean, hip, x - h * 0.14, feet);
  line(x + lean, hip, x + h * 0.14, feet);
}

function rnd(i) {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

for (let i = 0; i < 48; i++) {
  const col = i % 16;
  const row = (i / 16) | 0;
  const x = 70 + col * 58 + (rnd(i) - 0.5) * 18;
  const feet = 640 + row * 36 + rnd(i + 5) * 18;
  const h = 70 + rnd(i + 9) * 40;
  stick(x, feet, h, (rnd(i + 3) - 0.5) * 8);
}

paste('draw-little-fairy.png', 390, 640, 200);
paste('draw-farm-boy.png', 90, 860, 300);
paste('draw-royal-herald.png', 960, 860, 320);
paste('draw-village-fool.png', 200, 820, 270);
paste('draw-prince-charming.png', 690, 840, 280);
paste('draw-golden-goose.png', 250, 990, 170);
paste('draw-tiny-brave-mouse.png', 730, 1000, 150);
paste('draw-drunken-giant.png', 512, 900, 700);
paste('draw-hunter.png', 230, 930, 360);
paste('draw-pied-piper.png', 800, 930, 360);
paste('draw-tin-soldier.png', 430, 1005, 340);
paste('draw-woodland-girl.png', 145, 1020, 310);
paste('draw-puss-in-boots.png', 890, 1020, 330);
paste('draw-gingerbread-man.png', 310, 1024, 230);
paste('draw-frog-prince.png', 560, 1024, 200);

const cropT = 150;
const cropH = square.height - cropT;
const cropped = Buffer.alloc(square.width * cropH * 4);
for (let y = 0; y < cropH; y++) {
  out.copy(cropped, y * square.width * 4, ((y + cropT) * square.width) * 4, ((y + cropT + 1) * square.width) * 4);
}
const jpg = encodeJpeg({ data: cropped, width: square.width, height: cropH }, 92);
writeFileSync(DEST, jpg.data);
console.log('wrote', DEST, square.width, cropH);
