import './style.css';
import { computedStats, getUnit } from './core/catalog';
import type { PublicUnitView, TeamId, UnitInstance } from './core/types';
import { loadSettings } from './persist/settings';
import { bindViewportScale } from './ui/scale';
import { bindTargetingTips, renderBattleCard, t } from './ui/cards';

/** Front (slot 1) sits against the center line, same as a real scrap. */
const PLAYER = ['farm-boy', 'hunter', 'golden-goose', 'time-master'] as const;
const ENEMY = ['puss-in-boots', 'prince-charming', 'village-fool', 'big-bad-wolf'] as const;

const HOLD_MS = 1000;

const style = document.createElement('style');
style.textContent = `
  .proof-note {
    position: absolute;
    top: 36px;
    left: 40px;
    z-index: 9;
    margin: 0;
    color: #f7edd0;
    font-family: "Rye", serif;
    font-size: 22px;
    text-shadow: 0 2px 0 #1a1410, 0 0 12px rgba(0, 0, 0, 0.65);
    pointer-events: none;
  }
  .battle-card .scrap-readout { display: none !important; }
  .battle-card.is-held .scrap-readout { display: block !important; }
  .battle-wrap .battle-card .scrap-readout {
    width: max-content;
    max-width: min(360px, calc(100vw - 32px));
  }
  .battle-slot:has(.battle-card.is-held) { z-index: 20; }
  .battle-wrap .battle-slot,
  .battle-wrap .battle-card {
    aspect-ratio: 641 / 973;
    background: transparent !important;
    border-radius: 0;
  }
  .battle-wrap .battle-card.printed-card::after { display: block !important; }
  .battle-wrap .battle-card.rarity-bronze::after,
  .battle-wrap .battle-card.rarity-silver::after,
  .battle-wrap .battle-card.rarity-gold::after,
  .battle-wrap .battle-card.rarity-platinum::after,
  .battle-wrap .battle-card.rarity-diamond::after {
    z-index: 8 !important;
    background: url('/art/ui/frame-scrap.png?v=6') center / 100% 100% no-repeat;
  }
  .battle-wrap .battle-card .card-art,
  .battle-wrap .battle-card.printed-card > .card-art {
    z-index: 0 !important;
    left: 3.3%;
    top: 2.1%;
    width: 93.4%;
    height: 70.4%;
    overflow: hidden !important;
    background: transparent !important;
    border-radius: 0;
  }
  .battle-wrap .battle-card.printed-card > .card-art > .portrait-art,
  .battle-wrap .battle-card.printed-card > .card-art > .portrait-art.scenic {
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    object-position: center 42% !important;
    transform: none !important;
  }
  .battle-wrap .battle-card[data-def="time-master"] .portrait-art {
    transform: scale(1.26) !important;
    transform-origin: center 42% !important;
  }
  .battle-wrap .battle-card .card-name {
    display: block;
    font-size: 7.6cqi;
    line-height: 1;
    white-space: nowrap;
    margin: 0;
  }
  .battle-wrap .battle-card .card-slab {
    left: 10%;
    top: 74.6%;
    width: 80%;
    height: 20.4%;
    bottom: auto;
    padding: 1% 2% 2%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 0;
    overflow: hidden;
  }
  .battle-wrap .battle-card .rule-row { order: 2; margin: 0; }
  .battle-wrap .battle-card .stats { order: 3; margin: 0; }
  .battle-wrap .battle-card .targeting-type {
    height: auto;
    font-size: 5.2cqi;
    line-height: 1.1;
    padding: 0.12em 0.5em;
  }
  .battle-wrap .battle-card .stat { font-size: 4.6cqi; gap: 0.18em; }
  .battle-wrap .battle-card .stat-ico { width: 8.8cqi; height: 8.8cqi; }
  .battle-wrap .battle-card .stat b { font-size: 6.6cqi; }
  .battle-wrap .battle-card .rarity-mark { display: none; }
`;
document.head.appendChild(style);

function instance(defId: string): UnitInstance {
  return {
    instanceId: defId,
    defId,
    slot: 1,
    stickerIds: [],
    permanentMods: { atk: 0, hp: 0, speed: 0 },
  };
}

function battleOf(defId: string, team: TeamId, slot: number): PublicUnitView {
  const def = getUnit(defId);
  const stats = computedStats(instance(defId));
  return {
    uid: `${team}:${defId}`,
    defId,
    team,
    slot,
    nameKey: def.nameKey,
    rarity: def.rarity,
    atk: stats.atk,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    stickers: [],
    targeting: def.targeting,
    art: def.art,
    summoned: false,
    rewindLeft: def.passives?.rewindUses,
  };
}

bindViewportScale();

const locale = loadSettings().locale;
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app missing');

const playerSlots = PLAYER.map((id, i) => {
  const slot = PLAYER.length - i;
  return `<div class="battle-slot" data-def="${id}" data-team="player">${renderBattleCard(locale, battleOf(id, 'player', slot))}</div>`;
});
const enemySlots = ENEMY.map((id, i) => {
  const slot = i + 1;
  return `<div class="battle-slot" data-def="${id}" data-team="enemy">${renderBattleCard(locale, battleOf(id, 'enemy', slot))}</div>`;
});

app.innerHTML = `
  <section class="screen screen-battle">
    <div class="battle-wrap is-field-up is-hunt" id="battlefield">
      <p class="proof-note">Tieni il mouse fermo un secondo.</p>
      <div class="battle-hud" aria-hidden="true">
        <span class="recruit-round">
          <span class="recruit-round-line">${t(locale, 'round')} <span class="recruit-round-count"><b>1</b><i>/</i><b>10</b></span></span>
          <span class="line-crown"><img src="./art/ui/crown-wins.png?v=crown7" alt="" draggable="false" /><b><span class="vp-face">6</span></b></span>
        </span>
      </div>
      <div class="battle-line">
        <div class="battle-fit">
          <div class="battle-board">
            <div class="battle-side is-player">${playerSlots.join('')}</div>
            <div class="battle-side is-enemy">${enemySlots.join('')}</div>
          </div>
        </div>
      </div>
    </div>
  </section>`;

for (const img of app.querySelectorAll<HTMLImageElement>('.battle-card.printed-card .portrait-art')) {
  img.src = img.src.replace('card.png', 'idle.png');
}
function fitScrapNames(): void {
  for (const name of app.querySelectorAll<HTMLElement>('.battle-card .card-name')) {
    name.style.fontSize = '';
    const box = name.parentElement;
    if (!box || box.clientWidth < 8) continue;
    let guard = 14;
    while (name.scrollWidth > box.clientWidth - 6 && guard > 0) {
      const size = parseFloat(getComputedStyle(name).fontSize);
      if (!Number.isFinite(size) || size <= 9) break;
      name.style.fontSize = `${size * 0.92}px`;
      guard -= 1;
    }
  }
}
requestAnimationFrame(fitScrapNames);
document.fonts?.ready.then(fitScrapNames);

const wrap = document.querySelector<HTMLElement>('#battlefield');
if (!wrap) throw new Error('#battlefield missing');

bindTargetingTips(document.body, () => locale);

let timer = 0;
let current: HTMLElement | null = null;

/** Under the card when the text fits. Above it when the text is too tall. Slide sideways only to stay on screen. */
function placeReadout(card: HTMLElement): void {
  const box = card.querySelector<HTMLElement>('.scrap-readout');
  if (!box) return;
  box.style.top = '';
  box.style.transform = 'translateX(-50%)';

  const cardRect = card.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const scale = boxRect.width / box.offsetWidth || 1;
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = boxRect.left;
  if (boxRect.width >= vw - margin * 2) left = margin;
  else left = Math.min(Math.max(left, margin), vw - margin - boxRect.width);

  const gap = boxRect.top - cardRect.bottom;
  const belowTop = boxRect.top;
  const aboveTop = cardRect.top - gap - boxRect.height;
  const roomBelow = vh - margin - belowTop;
  const roomAbove = cardRect.top - gap - margin;
  let top = belowTop;
  if (boxRect.height <= roomBelow) top = belowTop;
  else if (boxRect.height <= roomAbove) top = aboveTop;
  else if (roomAbove > roomBelow) top = Math.max(margin, aboveTop);
  else top = Math.min(belowTop, Math.max(margin, vh - margin - boxRect.height));

  const shiftX = (left - boxRect.left) / scale;
  const shiftY = (top - boxRect.top) / scale;
  box.style.transform = `translateX(calc(-50% + ${shiftX}px))`;
  if (shiftY !== 0) box.style.top = `calc(100% + 12px + ${shiftY}px)`;
}

function close(): void {
  window.clearTimeout(timer);
  const card = current?.querySelector<HTMLElement>('.battle-card');
  card?.classList.remove('is-held');
  const box = card?.querySelector<HTMLElement>('.scrap-readout');
  if (box) {
    box.style.transform = '';
    box.style.top = '';
  }
  current = null;
}

for (const slot of wrap.querySelectorAll<HTMLElement>('.battle-slot')) {
  slot.addEventListener('pointerenter', () => {
    if (current === slot && slot.querySelector('.battle-card')?.classList.contains('is-held')) return;
    close();
    current = slot;
    timer = window.setTimeout(() => {
      const card = slot.querySelector<HTMLElement>('.battle-card');
      if (current !== slot || !card) return;
      card.classList.add('is-held');
      placeReadout(card);
    }, HOLD_MS);
  });
  slot.addEventListener('pointerleave', () => {
    if (current !== slot) return;
    close();
  });
}

window.addEventListener('resize', () => {
  const card = current?.querySelector<HTMLElement>('.battle-card.is-held');
  if (card) placeReadout(card);
});
