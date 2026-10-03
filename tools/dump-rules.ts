import { writeFileSync } from 'node:fs';
import { UNITS, STARTING_BRONZE_IDS } from '../src/data/units';
import { STICKERS } from '../src/data/stickers';
import { EVENTS, HUNT_MONSTERS } from '../src/data/events';
import { translate } from '../src/data/i18n';
import { abilityRule } from '../src/ui/cards';
import { resolveAbilityTiming } from '../src/core/catalog';
import { MAX_STICKERS, MAX_TEAM, RUN_ROUNDS } from '../src/core/types';
import type { Locale, UnitDef } from '../src/core/types';

const en = (key: string) => translate('en' as Locale, key);
const it = (key: string) => translate('it' as Locale, key);

const RARITY = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;

const KEYWORDS = [
  'keywordPrinceCharming', 'keywordFlockOfRavens', 'keywordKingOfRavens', 'keywordBigBadWolf',
  'keywordWokenBear', 'keywordJackInTheBox', 'keywordMimic', 'keywordGuardian', 'keywordBecome',
  'keywordTransform', 'keywordExhaust', 'keywordSteal', 'keywordAdjacent', 'keywordGold',
  'keywordThorns', 'keywordReflect', 'keywordFear', 'keywordMelt', 'keywordRevenge', 'keywordRevive',
  'keywordProvoke', 'keywordSpawn', 'keywordSneak', 'keywordHitman', 'keywordDoubleAttack',
  'keywordTripleAttack', 'keywordQuadrupleAttack', 'keywordSteadfast', 'keywordEvade', 'keywordDrunk',
  'keywordAmbush', 'keywordCurse', 'keywordSilence', 'keywordPig', 'keywordCocoon',
  'keywordGarbagePiles', 'keywordRewind', 'keywordCooldown', 'keywordSticker',
];

const TARGETS = ['brawler', 'slinger', 'sneak', 'hitman', 'pacifist', 'flock'];
const TIMINGS = [
  'onAttack', 'onHit', 'afterAttack', 'firstAttack', 'onDeath', 'battleStart', 'whenHit',
  'onKill', 'allyDied', 'anyDied', 'onRecruit', 'battleEnd', 'scrapEnd', 'ambush',
  'whenAttacked', 'onSticker', 'turnEnd', 'turnStart',
];

function both(key: string): string {
  const a = en(key);
  const b = it(key);
  if (!a || a === key) return '';
  if (a === b) return a;
  return `${a}\n  IT: ${b}`;
}

function abilityText(def: UnitDef): string {
  const uses = def.passives?.rewindUses;
  const fill = (s: string) => (uses != null ? s.replaceAll('{n}', String(uses)) : s);
  const rule = fill(abilityRule('en', def.id));
  const ruleIt = fill(abilityRule('it', def.id));
  if (!rule.trim()) return 'No ability.';
  if (rule === ruleIt) return rule;
  return `${rule}\n  IT: ${ruleIt}`;
}

const lines: string[] = [];
const push = (...xs: string[]) => lines.push(...xs);

push(
  'ONCE UPON A SCRAP',
  'Complete rules and every card. English is the game text. Italian follows on the next line when it differs.',
  '',
  'RULES',
  en('howToBody'),
  `IT: ${it('howToBody')}`,
  '',
  `A run is ${RUN_ROUNDS} scraps. Each side fields up to ${MAX_TEAM} figures. Each figure holds up to ${MAX_STICKERS} stickers.`,
  'You open the night by signing 2 bronze figures. The opening bronze pool is:',
  STARTING_BRONZE_IDS.map((id) => en(UNITS.find((u) => u.id === id)!.nameKey)).join(', ') + '.',
  'After each scrap the square offers three doors: Recruit, Sticker, Event. Take two, leave one.',
  `${en('alleyRecruit')}: ${en('alleyRecruitD')}`,
  `${en('alleySticker')}: ${en('alleyStickerD')}`,
  `${en('alleyEvent')}: ${en('alleyEventD')}`,
  'Recruit offers 4 figures. You sign figures into the lineup (up to 4). Sticker offers are glued now, or discarded.',
  'A sticker stays glued for the rest of the run unless an event says otherwise. If a figure is destroyed, its stickers burn with it, unless the Witch\'s Oven gives them back.',
  'Shop level rises on its own after each scrap. Later shops offer higher rarities. Rarities, low to high: Bronze, Silver, Gold, Platinum, Diamond.',
  'Slots are 1 to 4. Slot 1 is the front. Figures act in Speed order; higher Speed goes first. Equal Speed is settled by the game, not by the player.',
  'A figure is knocked out at 0 HP. Knocked out is the scrap word for defeated. Destroy, from the oven or a full lineup, removes a figure from the run.',
  'Score: each win is worth 3. A draw is worth 1. Standings break ties by wins, then by who had more bodies left, then by remaining HP.',
  'The phone and the computer play the same game, landscape only.',
  '',
  'TARGETING',
);
for (const id of TARGETS) {
  push(`${en(`tgt.${id}`)}: ${en(`tgt.${id}.d`)}`);
  const d = it(`tgt.${id}.d`);
  if (d !== en(`tgt.${id}.d`)) push(`  IT: ${it(`tgt.${id}`)} — ${d}`);
}
push('', 'TIMING');
for (const id of TIMINGS) {
  const label = en(`timing.${id}`);
  const desc = en(`timing.${id}.d`);
  if (label === `timing.${id}`) continue;
  push(`${label}: ${desc === `timing.${id}.d` ? '' : desc}`);
}
push('', 'KEYWORDS');
for (const key of KEYWORDS) {
  push(`${en(key)}: ${en(`${key}D`)}`);
  const d = it(`${key}D`);
  if (d !== en(`${key}D`)) push(`  IT: ${it(key)} — ${d}`);
}

push('', 'EVENTS');
for (const ev of EVENTS) {
  push(`${en(ev.nameKey)} (${ev.category})`);
  push(both(ev.descKey));
  push('');
}
push('Monster Hunt bosses and the sticker you get for beating them:');
for (const h of HUNT_MONSTERS) {
  const unit = UNITS.find((u) => u.id === h.unitId);
  const sticker = h.stickerId ? STICKERS.find((s) => s.id === h.stickerId) : null;
  push(`- ${unit ? en(unit.nameKey) : h.unitId} (${h.rarity})${sticker ? `: ${en(sticker.nameKey)}` : ''}`);
}

push('', 'FIGURES');
const order = [...UNITS].sort((a, b) => RARITY.indexOf(a.rarity) - RARITY.indexOf(b.rarity) || en(a.nameKey).localeCompare(en(b.nameKey)));
for (const u of order) {
  const timing = resolveAbilityTiming(u);
  const when = timing ? en(`timing.${timing}`) : '';
  push(`${en(u.nameKey)} — ${u.rarity}`);
  const itName = it(u.nameKey);
  if (itName !== en(u.nameKey)) push(`IT: ${itName}`);
  push(`HP ${u.hp}  ATK ${u.atk}  SPD ${u.speed}`);
  push(`Targeting: ${en(`tgt.${u.targeting}`)}`);
  if (when) push(`Timing: ${when}`);
  push(abilityText(u));
  if (!u.recruitable) push('Not in the recruit shop.');
  if (u.tags.length) push(`Tags: ${u.tags.join(', ')}`);
  push('');
}

push('STICKERS');
const stickers = [...STICKERS].sort((a, b) => RARITY.indexOf(a.rarity) - RARITY.indexOf(b.rarity) || en(a.nameKey).localeCompare(en(b.nameKey)));
for (const s of stickers) {
  push(`${en(s.nameKey)} — ${s.rarity}`);
  const itName = it(s.nameKey);
  if (itName !== en(s.nameKey)) push(`IT: ${itName}`);
  const mods = s.statMods;
  if (mods && (mods.atk || mods.hp || mods.speed)) {
    const bits = [];
    if (mods.atk) bits.push(`${mods.atk > 0 ? '+' : ''}${mods.atk} ATK`);
    if (mods.hp) bits.push(`${mods.hp > 0 ? '+' : ''}${mods.hp} HP`);
    if (mods.speed) bits.push(`${mods.speed > 0 ? '+' : ''}${mods.speed} Speed`);
    push(bits.join(', '));
  }
  push(both(s.descKey));
  push('');
}

const out = 'C:/Users/copan/Desktop/Once Upon a Scrap - rules for ChatGPT.txt';
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`${lines.length} lines -> ${out}`);
