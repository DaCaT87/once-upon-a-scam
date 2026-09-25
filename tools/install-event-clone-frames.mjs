import { copyFileSync } from 'node:fs';

const ASSETS = 'C:/Users/copan/.cursor/projects/c-Users-copan-Desktop-Once-Upon-a-Scam/assets';
const UI = 'C:/Users/copan/Desktop/Once Upon a Scam/public/art/ui';

const FRAMES = [
  ['clone-event-idle-lit.png', 'event-cloning-chamber.png'],
  ['clone-event-inside-lit.png', 'event-cloning-chamber-inside.png'],
  ['clone-event-exit-lit.png', 'event-cloning-chamber-exit.png'],
];

for (const [src, dest] of FRAMES) {
  copyFileSync(`${ASSETS}/${src}`, `${UI}/${dest}`);
  console.log(dest);
}
