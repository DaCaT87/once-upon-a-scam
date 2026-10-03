export type UnitClip = 'idle';

let ready = false;
let readyPromise: Promise<void> | null = null;

const UNIT_IDS = [
  'frog-prince',
  'the-egg',
  'three-little-pigs',
  'woodland-girl',
  'gingerbread-man',
  'tiny-brave-mouse',
  'black-duckling',
  'black-duck',
  'pied-piper',
  'little-fairy',
  'cobblers-elves',
  'woken-bear',
  'big-bad-wolf',
  'drunken-giant',
  'village-fool',
  'prince-charming',
  'tin-soldier',
  'wax-knight',
  'magic-mirror',
  'farm-boy',
  'puss-in-boots',
  'jack-in-the-box',
  'sprung-jack',
  'happy-rat',
  'hunter',
  'sir-forget-a-lot',
  'scary-scarecrow',
  'miss-misfortune',
  'cursed-doll',
  'glass-knight',
  'headless-horseman',
  'cursed-horseman',
  'patchwork-princess',
  'patchwork-monster',
  'the-collector',
  'sandman',
  'giving-tree',
  'old-gatekeeper',
  'toxic-frog',
  'royal-herald',
  'wish-pinata',
  'witch-hunter',
  'aladdin',
  'golden-goose',
  'mimic',
  'sprung-mimic',
  'vampire-bat',
  'miss-d',
  'time-master',
  'ice-king',
  'champion-of-the-arena',
  'king-of-crows',
  'flock-of-ravens',
  'phoenix',
  'anubis',
  'black-hole',
  'circe',
  'pig',
  'three-headed-snake',
  'thousand-maws',
  'mad-woodsman',
  'sewer-lord',
  'garbage-pile',
  'purple-widows',
  'silk-cocoon',
  'greed-fang',
] as const;
const CLIPS: UnitClip[] = ['idle'];
const STICKERS = [
  'rusty-knife',
  'fur-armor',
  'rabbits-foot',
  'fireball',
  'big-hammer',
  'lead-armor',
  'spiked-shield',
  'life-potion',
  'revenge-bomb',
  'bat-fang',
  'painted-target',
  'silver-plated',
  'steel-sword',
  'chain-mail',
  'water-spirit',
  'knights-crest',
  'butchers-cleave',
  'blood-leech',
  'thiefs-hood',
  'war-banner',
  'lightning-bolt',
  'gold-plated',
  'giant-strength',
  'troll-hide',
  'wind-spirit',
  'fire-spirit',
  'shower-of-arrows',
  'bloodied-crown',
  'lucky-charm',
  'vampires-appetite',
  'heartseeker-arrow',
  'scales-of-balance',
  'snipers-sight',
  'platinum-plated',
  'hearth-spirit',
  'dragons-breath',
  'hermes-boots',
  'ares-helm',
  'phoenix-heart',
  'reapers-scythe',
  'cursed-armor',
  'mirror-mirror',
  'diamond-plated',
  'excalibur',
  'void-heart',
  'endless-hunger',
  'dragon-scale',
  'cyclops-eye',
  'spider-silk',
  'ogres-club',
  'woodsmans-axe',
  'mythic-treasure',
  'trash',
  'poison',
  'filth',
  'cocoon',
];
const UI = [
  'arena',
  'frame-bronze',
  'frame-silver',
  'frame-gold',
  'frame-platinum',
  'frame-diamond',
  'stat-atk',
  'stat-hp',
  'stat-spd',
  'seal-bronze',
  'seal-silver',
  'seal-gold',
  'seal-platinum',
  'seal-diamond',
  'btn-fight',
];
const VFX = ['impact', 'ink', 'smoke-1', 'smoke-2', 'smoke-3', 'smoke-4'];

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export function preloadArt(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (ready) {
    onProgress?.(1, 1);
    return Promise.resolve();
  }
  if (readyPromise) return readyPromise;
  const srcs: string[] = [];
  for (const id of UNIT_IDS) {
    for (const clip of CLIPS) srcs.push(`./art/units/${id}/${clip}.png?v=cast200`);
  }
  for (const id of STICKERS) srcs.push(`./art/stickers/${id}.png?v=cast179`);
  for (const id of UI) srcs.push(`./art/ui/${id}.png${id === 'arena' ? '?v=court2' : ''}`);
  for (const id of VFX) srcs.push(`./art/vfx/${id}.png`);
  let done = 0;
  const total = srcs.length;
  onProgress?.(0, total);
  readyPromise = Promise.all(
    srcs.map((src) =>
      load(src)
        .then(() => {})
        .catch(() => {})
        .finally(() => {
          done += 1;
          onProgress?.(done, total);
        }),
    ),
  ).then(() => {
    ready = true;
  });
  return readyPromise;
}
