import './style.css';
import { buildOpponent } from './ai/buildAI';
import { autoPlayRun } from './run/autoPlay';
import { assertDeterministic } from './sim/simulation';
import { assertAbilityTiming, assertCompactSlots } from './core/catalog';
import { assertShopCurve } from './data/rarity';
import { assertTargetingRules } from './sim/targeting';
import { preloadArt } from './render/atlas';
import { GameApp } from './ui/app';
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
    if (!ok) console.error('[Once Upon a Scam] determinism check failed');
    else console.info('[Once Upon a Scam] battle simulation is deterministic');
    const run = autoPlayRun(0x51a711);
    if (run.phase !== 'final' || run.history.length !== 10) {
      console.error('[Once Upon a Scam] autoplay failed', run.phase, run.history.length, run);
    } else {
      console.info(`[Once Upon a Scam] autoplay ${run.wins}/10`);
    }
  } catch (err) {
    console.error('[Once Upon a Scam] self-test error', err);
  }
}

selfTest();

bindViewportScale();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');
const app = new GameApp(root);
void preloadArt().finally(() => {
  void app.start();
});
