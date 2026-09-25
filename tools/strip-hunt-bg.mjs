import fs from 'fs';
import { PNG } from 'pngjs';

const root = new URL('../public/art/units/', import.meta.url);
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('usage: node tools/strip-hunt-bg.mjs <unit-id>...');
  process.exit(1);
}

for (const id of ids) {
  for (const file of ['card.png', 'idle.png', 'idle2.png', 'attack.png', 'hit.png', 'death.png']) {
    const p = new URL(`${id}/${file}`, root);
    if (!fs.existsSync(p)) continue;
    const png = PNG.sync.read(fs.readFileSync(p));
    const { width: w, height: h, data } = png;
    const idx = (x, y) => (w * y + x) << 2;
    const isBg = (r, g, b) => r < 18 && g < 18 && b < 18;
    const seen = new Uint8Array(w * h);
    const q = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (seen[i]) return;
      const o = idx(x, y);
      if (!isBg(data[o], data[o + 1], data[o + 2])) return;
      seen[i] = 1;
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
      const p0 = q[i];
      const x = p0 % w;
      const y = ((p0 - x) / w) | 0;
      data[idx(x, y) + 3] = 0;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[idx(x, y) + 3] > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const tw = maxX - minX + 1;
      const th = maxY - minY + 1;
      const out = new PNG({ width: tw, height: th });
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const s = idx(minX + x, minY + y);
          const d = (tw * y + x) << 2;
          out.data[d] = data[s];
          out.data[d + 1] = data[s + 1];
          out.data[d + 2] = data[s + 2];
          out.data[d + 3] = data[s + 3];
        }
      }
      fs.writeFileSync(p, PNG.sync.write(out));
      if (file === 'card.png') console.log(id, `${w}x${h}`, '->', `${tw}x${th}`);
    } else {
      fs.writeFileSync(p, PNG.sync.write(png));
    }
  }
}
