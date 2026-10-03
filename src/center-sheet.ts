import { hasUnitArt, unitArtFolder } from './core/catalog';
import { UNITS } from './data/units';
import { loadSettings } from './persist/settings';
import { t } from './ui/cards';

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; background: #1a1410; color: #f3e6c4; }
  body { padding: 22px 18px 40px; }
  h1 {
    margin: 0 0 6px;
    font-family: "Berkshire Swash", serif;
    font-size: 28px;
    font-weight: 400;
  }
  p { margin: 0 0 18px; font: 15px/1.4 Georgia, serif; color: #e8d2a0; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 22px 14px;
  }
  figure { margin: 0; }
  .card {
    position: relative;
    aspect-ratio: 641 / 973;
    background: transparent;
    overflow: hidden;
  }
  .card img {
    position: absolute;
    z-index: 0;
    left: 3.3%;
    top: 2.1%;
    width: 93.4%;
    height: 70.4%;
    object-fit: contain;
    object-position: center center;
    background: #140e0c;
    transform: scale(1.17);
    transform-origin: center center;
  }
  .card::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    background: url('/art/ui/frame-scrap.png?v=6') center / 100% 100% no-repeat;
    pointer-events: none;
  }
  figcaption {
    margin-top: 6px;
    text-align: center;
    font-family: "Berkshire Swash", serif;
    font-size: 15px;
    line-height: 1.15;
  }
`;
document.head.appendChild(style);

const locale = loadSettings().locale;
const seen = new Set<string>();
const figures = UNITS.filter((unit) => {
  if (!hasUnitArt(unit.id)) return false;
  const folder = unitArtFolder(unit.id);
  if (seen.has(folder)) return false;
  seen.add(folder);
  return true;
});

const root = document.querySelector('#sheet');
if (!root) throw new Error('#sheet missing');

root.innerHTML = `
  <h1>Figure nello scrap</h1>
  <p>Stesso zoom per tutte, 1.17. Il disegno riempie il buco.</p>
  <div class="grid">
    ${figures.map((unit) => {
      const folder = unitArtFolder(unit.id);
      const name = t(locale, unit.nameKey);
      return `<figure>
        <div class="card">
          <img src="./art/units/${folder}/idle.png?v=cast210" alt="${name}" draggable="false" />
        </div>
        <figcaption>${name}</figcaption>
      </figure>`;
    }).join('')}
  </div>
`;
