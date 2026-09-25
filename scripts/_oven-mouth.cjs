const fs = require('fs');
const { PNG } = require('pngjs');

const srcDir = 'scripts/oven-mouth-src/';
const load = (f) => PNG.sync.read(fs.readFileSync(srcDir + f));

function at(p, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= p.width || y1 >= p.height) return null;
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * p.width + x0) * 4;
  const i10 = (y0 * p.width + x1) * 4;
  const i01 = (y1 * p.width + x0) * 4;
  const i11 = (y1 * p.width + x1) * 4;
  const o = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    o[k] =
      p.data[i00 + k] * (1 - fx) * (1 - fy) +
      p.data[i10 + k] * fx * (1 - fy) +
      p.data[i01 + k] * (1 - fx) * fy +
      p.data[i11 + k] * fx * fy;
  }
  return o;
}

// The open mouth, including teeth and the iron lip. Outside this, pixels stay
// exactly the first frame (the open oven).
function mouthMask(x, y) {
  const left = 118;
  const right = 712;
  const top = 628;
  const bottom = 892;
  const rad = 36;
  const ix = Math.max(left + rad, Math.min(x, right - rad));
  const iy = Math.max(top + rad, Math.min(y, bottom - rad));
  const dx = x - ix;
  const dy = y - iy;
  const dist = Math.sqrt(dx * dx + dy * dy) - rad;
  if (dist <= 0) return 1;
  const feather = 10;
  if (dist >= feather) return 0;
  return 1 - dist / feather;
}

function paint(base, src, fit) {
  const out = new PNG({ width: base.width, height: base.height });
  let changed = 0;
  let kept = 0;
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const j = (y * base.width + x) * 4;
      const m = mouthMask(x, y);
      if (m <= 0) {
        out.data[j] = base.data[j];
        out.data[j + 1] = base.data[j + 1];
        out.data[j + 2] = base.data[j + 2];
        out.data[j + 3] = base.data[j + 3];
        kept++;
        continue;
      }
      const c = at(src, (x - fit.ox) / fit.scale, (y - fit.oy) / fit.scale);
      if (!c || c[3] < 20) {
        out.data[j] = base.data[j];
        out.data[j + 1] = base.data[j + 1];
        out.data[j + 2] = base.data[j + 2];
        out.data[j + 3] = base.data[j + 3];
        kept++;
        continue;
      }
      for (let k = 0; k < 4; k++) out.data[j + k] = Math.round(base.data[j + k] * (1 - m) + c[k] * m);
      changed++;
    }
  }
  console.log('changed', changed, 'kept', kept);
  return out;
}

const open = load('event-witch-oven-open-object.png');
const chew1 = load('event-witch-oven-chew-1.png');
const chew2 = load('event-witch-oven-chew-2.png');
const a = paint(open, chew1, { scale: 0.96, ox: 1, oy: 8 });
const b = paint(open, chew2, { scale: 0.98, ox: 0, oy: 4 });

function identicalOutside(out) {
  let bad = 0;
  for (let y = 0; y < open.height; y++) {
    for (let x = 0; x < open.width; x++) {
      if (mouthMask(x, y) > 0) continue;
      const j = (y * open.width + x) * 4;
      for (let k = 0; k < 4; k++) if (out.data[j + k] !== open.data[j + k]) bad++;
    }
  }
  return bad;
}

console.log('chew1 body diffs', identicalOutside(a));
console.log('chew2 body diffs', identicalOutside(b));
fs.writeFileSync('scripts/_chew1-preview.png', PNG.sync.write(a));
fs.writeFileSync('scripts/_chew2-preview.png', PNG.sync.write(b));

const x0 = 90;
const y0 = 500;
const w = 650;
const h = 430;
const sheet = new PNG({ width: w * 3 + 16, height: h });
function blit(src, dx) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * src.width + (x + x0)) * 4;
      const d = (y * sheet.width + (x + dx)) * 4;
      sheet.data[d] = src.data[s];
      sheet.data[d + 1] = src.data[s + 1];
      sheet.data[d + 2] = src.data[s + 2];
      sheet.data[d + 3] = 255;
    }
  }
}
blit(open, 0);
blit(a, w + 8);
blit(b, (w + 8) * 2);
fs.writeFileSync('scripts/_mouth-strip.png', PNG.sync.write(sheet));
console.log('wrote previews');
