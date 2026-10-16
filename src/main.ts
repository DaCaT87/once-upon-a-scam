import './style.css';
import { buildOpponent } from './ai/buildAI';
import { autoPlayRun } from './run/autoPlay';
import { assertDeterministic } from './sim/simulation';
import { assertAbilityTiming, assertCompactSlots } from './core/catalog';
import { assertShopCurve } from './data/rarity';
import { assertTargetingRules } from './sim/targeting';
import { preloadArt } from './render/atlas';
import { GameApp } from './ui/app';
import { bindLandscapeHold } from './ui/fullscreen';
import { bindViewportScale } from './ui/scale';

function selfTest(): void {
  try {
    assertTargetingRules();
    assertAbilityTiming();
    assertCompactSlots();
    assertShopCurve();
    const a = buildOpponent(6, 0x51a7e, 0.7);
    const b = buildOpponent(6, 0xC0FFEE, 0.7);
    const ok = assertDeterministic(a, b, 12345);
    if (!ok) console.error('[Patch & Fable] determinism check failed');
    else console.info('[Patch & Fable] battle simulation is deterministic');
    const run = autoPlayRun(0x51a711);
    if (run.phase !== 'final' || run.history.length < 1 || run.history.length > 10) {
      console.error('[Patch & Fable] autoplay failed', run.phase, run.history.length, run);
    } else {
      console.info(`[Patch & Fable] autoplay ${run.wins}/${run.history.length}`);
    }
  } catch (err) {
    console.error('[Patch & Fable] self-test error', err);
  }
}

bindViewportScale();
if (import.meta.env.DEV) selfTest();
bindLandscapeHold();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');
const app = new GameApp(root);
const boot = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');

function paintBoot(done: number, total: number): void {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (bootFill) bootFill.style.width = `${pct}%`;
  boot?.setAttribute('aria-valuenow', String(pct));
}

void preloadArt(paintBoot).finally(() => {
  void app.start().finally(() => {
    document.documentElement.classList.remove('is-booting');
    boot?.remove();
  });
});
