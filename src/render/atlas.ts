import { stickerArtFile, unitArtFolder } from '../core/catalog';

export type UnitClip = 'idle';

const images = new Map<string, HTMLImageElement>();
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

export function preloadArt(): Promise<void> {
  if (ready) return Promise.resolve();
  if (readyPromise) return readyPromise;
  const jobs: Promise<void>[] = [];
  const put = (key: string, src: string) => {
    jobs.push(
      load(src)
        .then((img) => {
          images.set(key, img);
        })
        .catch(() => {
          /* missing clip is fine — cards fall back to idle */
        }),
    );
  };
  for (const id of UNIT_IDS) {
    for (const clip of CLIPS) put(`unit:${id}:${clip}`, `./art/units/${id}/${clip}.png?v=cast176`);
  }
  for (const id of STICKERS) put(`sticker:${id}`, `./art/stickers/${id}.png?v=cast173`);
  for (const id of UI) put(`ui:${id}`, `./art/ui/${id}.png${id === 'arena' ? '?v=court2' : ''}`);
  for (const id of VFX) put(`vfx:${id}`, `./art/vfx/${id}.png`);
  readyPromise = Promise.all(jobs).then(() => {
    ready = true;
  });
  return readyPromise;
}

export function art(key: string): HTMLImageElement | null {
  return images.get(key) ?? null;
}

export function unitFrame(defId: string, clip: UnitClip): HTMLImageElement | null {
  const folder = unitArtFolder(defId);
  return art(`unit:${folder}:${clip}`) ?? art(`unit:${folder}:idle`);
}

export function stickerArt(id: string): HTMLImageElement | null {
  return art(`sticker:${stickerArtFile(id)}`);
}

export function uiArt(id: string): HTMLImageElement | null {
  return art(`ui:${id}`);
}

export function vfxArt(id: string): HTMLImageElement | null {
  return art(`vfx:${id}`);
}

export const SLICE_UNIT_IDS = UNIT_IDS;
export const SLICE_STICKER_IDS = STICKERS;
