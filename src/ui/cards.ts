import { computedStats, getSticker, getUnit, hasCardFace, hasStickerArt, hasUnitArt, isScenicArt, nextFormOf, prevFormOf, resolveAbilityTiming, resolveTargeting, stickerArtFile, teamLaneOrder, unitArtFolder, usesPrintedCardFace, type StatContext } from '../core/catalog';
import { translate } from '../data/i18n';
import type { AbilityTiming, Locale, PublicUnitView, TargetingType, TeamId, UnitInstance } from '../core/types';

export function t(locale: Locale, key: string): string {
  return translate(locale, key);
}

export function rarityLabel(locale: Locale, r: string): string {
  return t(locale, r);
}

function rarityMark(locale: Locale, rarity: string, hunt = false): string {
  const name = rarityLabel(locale, rarity);
  const gem = hunt
    ? `<img class="hunt-rarity" src="./art/ui/rarity-corner-${rarity}.png?v=gem1" alt="" draggable="false" />`
    : '';
  return `${gem}<div class="rarity-mark rule-tip" data-rarity="${rarity}" aria-expanded="false" aria-label="${escapeHtml(name)}">
    <img src="./art/ui/rarity-${rarity}.png?v=metal" alt="" draggable="false" />
    <span class="targeting-tip" role="tooltip">${escapeHtml(name)}</span>
  </div>`;
}

function renderStickerRarity(locale: Locale, rarity: string): string {
  const name = rarityLabel(locale, rarity);
  return `<button type="button" class="sticker-rarity rule-tip" data-rarity="${rarity}" aria-expanded="false" aria-label="${escapeHtml(name)}">
    <strong>${escapeHtml(name)}</strong>
    <span class="targeting-tip" role="tooltip">${escapeHtml(name)}</span>
  </button>`;
}

function statIcon(locale: Locale, kind: 'atk' | 'hp' | 'spd'): string {
  const tip = t(locale, `stat.${kind}`);
  return `<span class="stat-ico-wrap rule-tip" aria-expanded="false" aria-label="${escapeHtml(tip)}">
    <img class="stat-ico" src="./art/ui/stat-${kind}.png?v=swords10" alt="" draggable="false" />
    <span class="targeting-tip" role="tooltip">${escapeHtml(tip)}</span>
  </span>`;
}

export function abilityText(locale: Locale, defId: string): string {
  const def = getUnit(defId);
  const timing = resolveAbilityTiming(def);
  const rule = abilityRule(locale, defId);
  if (!timing) return rule;
  return `${t(locale, `timing.${timing}`)}: ${rule}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function abilityRule(locale: Locale, defId: string): string {
  const rule = t(locale, `ab.${defId}.d`);
  if (rule !== `ab.${defId}.d`) return rule;
  const raw = t(locale, `ab.${defId}`);
  const split = raw.indexOf(': ');
  if (split > 0 && split < 28) return raw.slice(split + 2);
  return raw;
}

export function parseAbility(locale: Locale, defId: string): { name: string | null; rule: string } {
  const def = getUnit(defId);
  const timing = resolveAbilityTiming(def);
  return {
    name: timing ? t(locale, `timing.${timing}`) : null,
    rule: abilityRule(locale, defId),
  };
}

function renderTerm(
  locale: Locale,
  name: string,
  tip: string,
  extraClass = '',
  previewUnit?: string,
  previewSticker?: string,
): string {
  const preview = previewUnit
    ? ` data-preview-unit="${escapeHtml(previewUnit)}"`
    : previewSticker
      ? ` data-preview-sticker="${escapeHtml(previewSticker)}"`
      : '';
  const isPeek = Boolean(previewUnit || previewSticker);
  const hover = isPeek ? t(locale, 'keywordPeekHint') : tip;
  const cls = isPeek ? `${extraClass} is-peek-link`.trim() : extraClass;
  const spoken = isPeek ? `${hover}. ${tip}` : tip;
  return `<button type="button" class="rule-tip ${cls}"${preview} aria-expanded="false" aria-label="${escapeHtml(name)}. ${escapeHtml(spoken)}">
      <strong>${escapeHtml(name)}</strong>
      <span class="targeting-tip" role="tooltip">${escapeHtml(hover)}</span>
    </button>`;
}

function linkKeywords(locale: Locale, text: string): string {
  let out = escapeHtml(text);
  const terms: Array<[string, string, string?, string?]> = [
    ['keywordPrinceCharming', 'keywordPrinceCharmingD', 'prince-charming'],
    ['keywordFlockOfRavens', 'keywordFlockOfRavensD', 'flock-of-ravens'],
    ['keywordKingOfRavens', 'keywordKingOfRavensD', 'king-of-crows'],
    ['keywordBigBadWolf', 'keywordBigBadWolfD', 'big-bad-wolf'],
    ['keywordWokenBear', 'keywordWokenBearD', 'woken-bear'],
    ['keywordJackInTheBox', 'keywordJackInTheBoxD', 'sprung-jack'],
    ['keywordMimic', 'keywordMimicD', 'sprung-mimic'],
    ['keywordGuardian', 'keywordGuardianD'],
    ['keywordBecome', 'keywordBecomeD'],
    ['keywordTransform', 'keywordTransformD'],
    ['keywordExhaust', 'keywordExhaustD'],
    ['keywordSteal', 'keywordStealD'],
    ['keywordAdjacent', 'keywordAdjacentD'],
    ['keywordGold', 'keywordGoldD'],
    ['keywordThorns', 'keywordThornsD'],
    ['keywordReflect', 'keywordReflectD'],
    ['keywordFear', 'keywordFearD'],
    ['keywordMelt', 'keywordMeltD'],
    ['keywordRevenge', 'keywordRevengeD'],
    ['keywordRevive', 'keywordReviveD'],
    ['keywordProvoke', 'keywordProvokeD'],
    ['keywordSneak', 'keywordSneakD'],
    ['keywordHitman', 'keywordHitmanD'],
    ['keywordDoubleAttack', 'keywordDoubleAttackD'],
    ['keywordTripleAttack', 'keywordTripleAttackD'],
    ['keywordQuadrupleAttack', 'keywordQuadrupleAttackD'],
    ['keywordSteadfast', 'keywordSteadfastD'],
    ['keywordEvade', 'keywordEvadeD'],
    ['keywordDrunk', 'keywordDrunkD'],
    ['keywordAmbush', 'keywordAmbushD'],
    ['keywordCurse', 'keywordCurseD'],
    ['keywordSilence', 'keywordSilenceD'],
    ['keywordPig', 'keywordPigD', 'pig'],
    ['keywordCocoon', 'keywordCocoonD', 'silk-cocoon'],
    ['keywordGarbagePiles', 'keywordGarbagePilesD', 'garbage-pile'],
    ['stk.poison', 'stk.poison.d', undefined, 'poison'],
    ['stk.trash', 'stk.trash.d', undefined, 'trash'],
    ['keywordRewind', 'keywordRewindD'],
    ['keywordCooldown', 'keywordCooldownD'],
    ['keywordSticker', 'keywordStickerD'],
  ];
  terms.sort((a, b) => t(locale, b[0]).length - t(locale, a[0]).length);
  const tokens: string[] = [];
  for (const [nameKey, tipKey, previewUnit, previewSticker] of terms) {
    const name = t(locale, nameKey);
    const tip = t(locale, tipKey);
    const flags = nameKey === 'keywordSticker' ? 'gi' : 'g';
    const re = new RegExp(`\\b${escapeRegExp(name)}(?:\\s+\\d+)?\\b`, flags);
    out = out.replace(re, (matched) => {
      const i = tokens.length;
      tokens.push(renderTerm(locale, matched, tip, 'keyword-term', previewUnit, previewSticker));
      return `\u0000${i}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] ?? '').replace(
    /\b(into|in) (<button[^>]*\bis-peek-link\b[\s\S]*?<\/button>)/g,
    '<span class="keep-with">$1 $2</span>',
  );
}

export function renderRuleRow(locale: Locale, targeting: TargetingType, defId: string): string {
  const timing = resolveAbilityTiming(getUnit(defId));
  return `<div class="rule-row">${renderTargetingLabel(locale, targeting)}${timing ? renderTimingLabel(locale, timing) : ''}</div>`;
}

function renderAbilityText(locale: Locale, rule: string): string {
  if (!rule.trim()) return '';
  return `<div class="ability"><p class="ability-rule">${linkKeywords(locale, rule)}</p></div>`;
}

/** Scrap cocoon line. Taunt is only on the sentence when a boss ability granted it. */
export function renderCocoonBattleAbility(locale: Locale, provoke: boolean): string {
  const rule = t(locale, 'ab.silk-cocoon.battle');
  const text = provoke ? `${t(locale, 'keywordProvoke')}. ${rule}` : rule;
  return renderAbilityText(locale, text);
}

export function renderAbility(locale: Locale, defId: string): string {
  return renderAbilityText(locale, abilityRule(locale, defId));
}

export function renderTargetingLabel(locale: Locale, type: TargetingType): string {
  const label = t(locale, `tgt.${type}`);
  const tip = t(locale, `tgt.${type}.d`);
  return `<button type="button" class="rule-tip targeting-type" data-targeting="${type}" aria-expanded="false" aria-label="${escapeHtml(label)}. ${escapeHtml(tip)}">
    <strong>${escapeHtml(label)}</strong>
    <span class="targeting-tip" role="tooltip">${escapeHtml(tip)}</span>
  </button>`;
}

export function renderTimingLabel(locale: Locale, timing: AbilityTiming): string {
  const label = t(locale, `timing.${timing}`);
  const tip = t(locale, `timing.${timing}.d`);
  return `<button type="button" class="rule-tip timing-type" data-timing="${timing}" aria-expanded="false" aria-label="${escapeHtml(label)}. ${escapeHtml(tip)}">
    <strong>${escapeHtml(label)}</strong>
    <span class="targeting-tip" role="tooltip">${escapeHtml(tip)}</span>
  </button>`;
}

export function bindTargetingTips(root: HTMLElement, localeOf?: () => Locale): void {
  if (root.dataset.tgtBound === '1') return;
  root.dataset.tgtBound = '1';

  const floater = document.createElement('div');
  floater.className = 'targeting-float';
  floater.setAttribute('role', 'tooltip');
  document.body.appendChild(floater);

  let pinned: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;

  const tipText = (label: HTMLElement) =>
    label.querySelector('.targeting-tip')?.textContent?.trim() ?? label.getAttribute('aria-label') ?? '';

  const fill = (label: HTMLElement) => {
    floater.classList.remove('is-card', 'is-spent', 'is-peek');
    const structured = label.querySelector('.targeting-tip.tip-sticker');
    if (structured) {
      floater.innerHTML = structured.innerHTML;
      floater.classList.toggle('is-spent', label.classList.contains('is-spent'));
      return;
    }
    if (label.classList.contains('is-peek-link')) {
      floater.classList.add('is-peek');
      floater.innerHTML = `<span class="peek-float-mark" aria-hidden="true"><i class="peek-arrow"></i><b>?</b></span>${escapeHtml(tipText(label))}`;
      return;
    }
    floater.textContent = tipText(label);
  };

  const place = (label: HTMLElement) => {
    fill(label);
    floater.classList.add('is-on');
    const r = label.getBoundingClientRect();
    const tip = floater.getBoundingClientRect();
    const gap = label.querySelector('.is-peek-link') ? -4 : 10;
    let left = r.left;
    let top = r.top - tip.height - gap;
    if (top < 8) top = r.bottom + gap;
    if (left + tip.width > window.innerWidth - 8) left = window.innerWidth - tip.width - 8;
    if (left < 8) left = 8;
    if (top + tip.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - tip.height - 8);
    floater.style.left = `${left}px`;
    floater.style.top = `${top}px`;
  };

  const hide = () => {
    if (pinned || hovered) return;
    floater.classList.remove('is-on');
  };

  let peekHost: HTMLElement | null = null;

  const peekOrigin = (el: HTMLElement | null): HTMLElement | null =>
    el?.closest('.unit-card:not(.tip-preview), .sticker-card:not(.tip-preview)') ?? null;

  const stickersOnCard = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>(':scope > .sticker-rail .sticker-slot.filled')]
      .map((slot) => slot.dataset.sticker)
      .filter((id): id is string => Boolean(id));

  const onPeekLeave = () => {
    hidePeek();
  };

  const hidePeek = () => {
    if (!peekHost) return;
    peekHost.removeEventListener('pointerleave', onPeekLeave);
    peekHost.classList.remove('is-peeking');
    peekHost.querySelector(':scope > .form-peek')?.remove();
    peekHost = null;
  };

  const showPeek = (host: HTMLElement, previewId: string) => {
    const existing = host.querySelector<HTMLElement>(':scope > .form-peek');
    if (peekHost === host && existing?.dataset.peek === previewId) return;
    hidePeek();
    const loc = localeOf?.() ?? 'en';
    const fake: UnitInstance = {
      instanceId: `preview-${previewId}`,
      defId: previewId,
      slot: Number(host.dataset.slot) || 1,
      stickerIds: stickersOnCard(host),
      permanentMods: { atk: 0, hp: 0, speed: 0 },
    };
    const wrap = document.createElement('div');
    wrap.className = 'form-peek';
    wrap.dataset.peek = previewId;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = renderUnitCard(loc, fake, { extraClass: 'tip-preview' });
    host.appendChild(wrap);
    host.classList.add('is-peeking');
    host.addEventListener('pointerleave', onPeekLeave);
    peekHost = host;
    hovered = null;
    floater.classList.remove('is-on', 'is-peek');
  };

  const showStickerPeek = (host: HTMLElement, stickerId: string) => {
    const peekId = `sticker:${stickerId}`;
    const existing = host.querySelector<HTMLElement>(':scope > .form-peek');
    if (peekHost === host && existing?.dataset.peek === peekId) return;
    hidePeek();
    const loc = localeOf?.() ?? 'en';
    const wrap = document.createElement('div');
    wrap.className = 'form-peek';
    wrap.dataset.peek = peekId;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = renderStickerCard(loc, stickerId, false, 'tip-preview');
    host.appendChild(wrap);
    host.classList.add('is-peeking');
    host.addEventListener('pointerleave', onPeekLeave);
    peekHost = host;
    hovered = null;
    floater.classList.remove('is-on', 'is-peek');
  };

  const openPreview = (label: HTMLElement, host: HTMLElement | null) => {
    if (!host) return false;
    if (label.dataset.previewSticker) {
      showStickerPeek(host, label.dataset.previewSticker);
      return true;
    }
    if (label.dataset.previewUnit) {
      showPeek(host, label.dataset.previewUnit);
      return true;
    }
    return false;
  };

  const closeAll = (except?: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('.rule-tip.is-open').forEach((el) => {
      if (el !== except) {
        el.classList.remove('is-open');
        el.setAttribute('aria-expanded', 'false');
      }
    });
    if (!except) pinned = null;
  };

  const show = (label: HTMLElement, pin: boolean) => {
    if (openPreview(label, peekOrigin(label))) return;
    if (pin) {
      const open = pinned !== label;
      closeAll(label);
      pinned = open ? label : null;
      label.classList.toggle('is-open', open);
      label.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        hide();
        return;
      }
    }
    place(label);
  };

  floater.addEventListener('pointerleave', () => {
    if (pinned) {
      place(pinned);
      return;
    }
    hovered = null;
    hide();
  });
  floater.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-preview-sticker], [data-preview-unit]');
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    openPreview(link, peekOrigin(hovered));
  });

  root.addEventListener(
    'pointerdown',
    (e) => {
      const tip = (e.target as HTMLElement).closest('.rule-tip');
      if (
        tip &&
        !tip.classList.contains('sticker-slot') &&
        !tip.closest('#lineup') &&
        !tip.closest('.sticker-card')
      ) {
        e.stopPropagation();
      }
    },
    true,
  );

  root.addEventListener(
    'click',
    (e) => {
      const label = (e.target as HTMLElement).closest<HTMLElement>('.rule-tip');
      if (label && root.contains(label)) {
        if (label.classList.contains('sticker-slot')) {
          if (label.closest('.is-replace-pick')) return;
          place(label);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        show(label, true);
        return;
      }
      closeAll();
      hidePeek();
      hide();
    },
    true,
  );

  root.addEventListener('pointerover', (e) => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    const label = (e.target as HTMLElement).closest<HTMLElement>('.rule-tip');
    if (!label || !root.contains(label)) return;
    hovered = label;
    if (label.dataset.previewUnit || label.dataset.previewSticker) {
      const host = peekOrigin(label);
      const openPeek = host?.querySelector<HTMLElement>(':scope > .form-peek');
      const want = label.dataset.previewSticker ? `sticker:${label.dataset.previewSticker}` : label.dataset.previewUnit;
      if (host && peekHost === host && openPeek?.dataset.peek === want) {
        hovered = null;
        floater.classList.remove('is-on', 'is-peek');
        return;
      }
    }
    place(label);
  });

  root.addEventListener('pointerout', (e) => {
    const label = (e.target as HTMLElement).closest<HTMLElement>('.rule-tip');
    if (!label) return;
    const next = (e.relatedTarget as HTMLElement | null)?.closest?.('.rule-tip');
    if (next === label) return;
    if (e.relatedTarget instanceof Node && floater.contains(e.relatedTarget)) return;
    if (hovered === label) hovered = null;
    if (pinned) place(pinned);
    else hide();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeAll();
    hidePeek();
    hide();
  });

  window.addEventListener('scroll', () => {
    const active = pinned ?? hovered;
    if (active) place(active);
  }, true);
}

function portraitHtml(locale: Locale, defId: string, opts?: { clip?: string; locked?: boolean }): string {
  if (!hasUnitArt(defId)) return '';
  const folder = unitArtFolder(defId);
  const clip = opts?.clip ?? 'idle';
  const file = clip === 'idle' && hasCardFace(defId) ? 'card' : clip;
  const locked = opts?.locked ? ' data-locked="true"' : '';
  const scenic = isScenicArt(defId) ? ' scenic' : '';
  const src = `./art/units/${folder}/${file}.png?v=cast176`;
  return `<img class="portrait-art${scenic}" data-unit="${folder}"${locked} src="${src}" alt="${t(locale, getUnit(defId).nameKey)}" draggable="false" />`;
}

export function renderDossierOverlay(locale: Locale, defId: string): string {
  const def = getUnit(defId);
  const name = t(locale, def.nameKey);
  const lore = t(locale, `lore.${defId}`);
  const folder = unitArtFolder(defId);
  const nextId = nextFormOf(defId);
  const prevId = prevFormOf(defId);
  const exit = `<button type="button" class="btn ghost" data-act="close-dossier">${escapeHtml(t(locale, 'exit'))}</button>`;
  const back = prevId
    ? `<button type="button" class="btn ghost" data-act="prev-dossier" data-def="${escapeHtml(prevId)}">${escapeHtml(t(locale, 'back'))}</button>`
    : '';
  const next = nextId
    ? `<button type="button" class="btn ghost" data-act="next-dossier" data-def="${escapeHtml(nextId)}">${escapeHtml(t(locale, 'next'))}</button>`
    : '';
  const art = hasUnitArt(defId)
    ? `<img class="dossier-portrait" data-unit="${folder}" src="./art/units/${folder}/idle.png?v=cast176" alt="${escapeHtml(name)}" draggable="false" />`
    : `<div class="dossier-art-empty" aria-hidden="true"></div>`;
  return `
    <div class="dossier-overlay" role="presentation">
      <button type="button" class="dossier-scrim" data-act="close-dossier" aria-label="${escapeHtml(t(locale, 'exit'))}"></button>
      <div class="dossier-sheet" role="dialog" aria-labelledby="dossier-title">
        <div class="dossier-art rarity-${def.rarity}">${art}</div>
        <div class="dossier-tale">
          <p class="dossier-kicker">${escapeHtml(t(locale, 'dossierStory'))}</p>
          <h2 id="dossier-title" class="sign">${escapeHtml(name)}</h2>
          <p class="dossier-story">${escapeHtml(lore)}</p>
          <div class="dossier-actions">
            ${prevId ? `${back}${exit}` : `${exit}${next}`}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderUnitCard(
  locale: Locale,
  inst: UnitInstance,
  opts?: { selected?: boolean; extraClass?: string; clip?: string; locked?: boolean } & StatContext,
): string {
  const def = getUnit(inst.defId);
  const stats = computedStats(inst, { stickersGained: opts?.stickersGained, deathsThisRun: opts?.deathsThisRun });
  const slots = stickerSlots(locale, inst.stickerIds);
  const alleyHunt = Boolean(opts?.extraClass?.includes('is-alley-hunt'));
  const huntPlate = alleyHunt || Boolean(opts?.extraClass?.includes('is-hunt-plate'));
  const huntCard = huntPlate || def.tags.includes('hunt');
  const printed = usesPrintedCardFace(def.id);
  const rules = `${renderRuleRow(locale, resolveTargeting(inst), def.id)}${renderAbility(locale, def.id)}`;
  const plateClass = huntPlate && !printed ? ' is-hunt-plate' : '';
  const huntClass = huntCard && !printed ? ' is-hunt-card' : '';
  const form = def.id === 'pig' || def.id === 'silk-cocoon';
  const extra = (opts?.extraClass ?? '')
    .split(/\s+/)
    .filter((c) => c && !(printed && (c === 'is-hunt-plate' || c === 'is-hunt-card' || c === 'is-alley-hunt')))
    .join(' ');
  return `
    <article class="unit-card rarity-${def.rarity}${form ? ' is-form' : ''}${printed ? ' printed-card' : ''}${printed && (def.tags.includes('hunt') || def.id === 'silk-cocoon') ? ' is-cutout' : ''} ${opts?.selected ? 'selected' : ''} ${extra}${plateClass}${huntClass}"
      role="button" tabindex="0"
      data-instance="${inst.instanceId}" data-def="${inst.defId}" data-slot="${inst.slot}">
      <div class="card-art">${portraitHtml(locale, def.id, opts)}</div>
      ${form ? '' : rarityMark(locale, def.rarity, huntCard && !printed)}
      <div class="card-slab">
        <h3 class="card-name">${t(locale, def.nameKey)}</h3>
        <div class="stats">
          <div class="stat">${statIcon(locale, 'hp')}<b>${form ? '?' : stats.hp}</b></div>
          <div class="stat">${statIcon(locale, 'atk')}<b>${stats.atk}</b></div>
          <div class="stat">${statIcon(locale, 'spd')}<b>${stats.speed}</b></div>
        </div>
        ${rules}
      </div>
      <div class="sticker-rail">${slots}</div>
    </article>
  `;
}

export function renderVacantTeamSlot(_locale: Locale, slot: number): string {
  return `
    <article class="unit-card team-slot-empty is-empty" data-slot="${slot}" data-empty="1" aria-label="${slot}">
      <div class="empty-back"><span>${slot}</span></div>
    </article>`;
}

/** Team row outside scrap: slot 1 on the right. Optionally pads empty slots up to MAX_TEAM. */
export function renderTeamLane(
  locale: Locale,
  team: UnitInstance[],
  opts?: {
    showEmpty?: boolean;
    /** Numeral above every slot, filled or empty. */
    slotBadge?: boolean;
    cardOpts?: (u: UnitInstance) => { selected?: boolean; extraClass?: string } | undefined;
  } & StatContext,
): string {
  const bySlot = new Map(team.map((u) => [u.slot, u]));
  const statOpts = { stickersGained: opts?.stickersGained, deathsThisRun: opts?.deathsThisRun };
  return teamLaneOrder()
    .map((slot) => {
      const u = bySlot.get(slot);
      const badge = opts?.slotBadge ? `<span class="slot-no">${slot}</span>` : '';
      if (u) {
        const card = renderUnitCard(locale, u, { ...statOpts, ...opts?.cardOpts?.(u) });
        if (!opts?.showEmpty && !opts?.slotBadge) return card;
        return `<div class="team-slot" data-slot="${slot}">${badge}${opts?.showEmpty ? renderVacantTeamSlot(locale, slot) : ''}${card}</div>`;
      }
      if (opts?.showEmpty && opts?.slotBadge) {
        return `<div class="team-slot is-vacant" data-slot="${slot}">${badge}${renderVacantTeamSlot(locale, slot)}</div>`;
      }
      if (opts?.showEmpty) return renderVacantTeamSlot(locale, slot);
      return '';
    })
    .join('');
}

export function renderLineup(locale: Locale, team: UnitInstance[], ctx?: StatContext): string {
  return renderTeamLane(locale, team, ctx);
}

export function renderOfferCard(
  locale: Locale,
  defId: string,
  selected: boolean,
  extraClass = '',
  ctx?: StatContext,
): string {
  const fake: UnitInstance = {
    instanceId: defId,
    defId,
    slot: 1,
    stickerIds: [],
    permanentMods: { atk: 0, hp: 0, speed: 0 },
  };
  const spent = extraClass.includes('is-spent-offer');
  return renderUnitCard(locale, fake, {
    selected: selected && !spent,
    extraClass: `offer ${extraClass}`.trim(),
    locked: spent,
    stickersGained: ctx?.stickersGained,
    deathsThisRun: ctx?.deathsThisRun,
  });
}

function poisonRules(locale: Locale): string {
  const line = (whenKey: string, effectKey: string) =>
    `<p class="poison-rule"><span class="timing-type">${escapeHtml(t(locale, whenKey))}</span>: ${linkKeywords(locale, t(locale, effectKey))}</p>`;
  return `${line('stk.poison.when', 'stk.poison.hit')}${line('stk.poison.then', 'stk.poison.out')}`;
}

function stickerSlots(locale: Locale, stickerIds: string[], opts?: { spent?: boolean }): string {
  const stickers = stickerIds.map((id) => getSticker(id));
  const allSpent = Boolean(opts?.spent);
  return [0, 1, 2]
    .map((i) => {
      const s = stickers[i];
      if (!s) return `<div class="sticker-slot" data-sticker-slot="${i}" aria-hidden="true"></div>`;
      const name = t(locale, s.nameKey);
      const rarityName = rarityLabel(locale, s.rarity);
      const desc = t(locale, s.descKey);
      const splitAt = s.id === 'woodsmans-axe' ? desc.indexOf('. ') : -1;
      const grant = splitAt > 0 ? desc.slice(0, splitAt + 1) : '';
      const effect = splitAt > 0 ? desc.slice(splitAt + 2) : desc;
      const timing = splitAt > 0 ? resolveAbilityTiming(s) : null;
      const poison = s.id === 'poison';
      const timed = s.id === 'filth' || s.id === 'mythic-treasure' || s.id === 'cocoon' ? resolveAbilityTiming(s) : null;
      const tip = poison
        ? `${t(locale, 'stk.poison.when')}: ${t(locale, 'stk.poison.hit')} ${t(locale, 'stk.poison.then')}: ${t(locale, 'stk.poison.out')}`
        : grant
          ? `${grant} ${t(locale, `timing.${timing}`)}. ${effect}`
          : timed
            ? `${t(locale, `timing.${timed}`)}. ${desc}`
            : desc;
      const spent = t(locale, 'stickerSpent');
      const img = hasStickerArt(s.id)
        ? `<img src="./art/stickers/${stickerArtFile(s.id)}.png?v=cast173" alt="${escapeHtml(name)}" draggable="false" />`
        : '';
      const aria = allSpent
        ? `${escapeHtml(name)}. ${escapeHtml(rarityName)}. ${escapeHtml(tip)}. ${escapeHtml(spent)}`
        : `${escapeHtml(name)}. ${escapeHtml(rarityName)}. ${escapeHtml(tip)}`;
      const effectHtml = poison
        ? poisonRules(locale)
        : grant
          ? `<span class="tip-effect">${escapeHtml(grant)}</span>${timing ? renderTimingLabel(locale, timing) : ''}<span class="tip-effect">${linkKeywords(locale, effect)}</span>`
          : timed
            ? `${renderTimingLabel(locale, timed)}<span class="tip-effect">${linkKeywords(locale, desc)}</span>`
            : `<span class="tip-effect">${escapeHtml(desc)}</span>`;
      return `<div class="sticker-slot filled rule-tip${allSpent ? ' is-spent' : ''}" data-sticker-slot="${i}" data-sticker="${s.id}" aria-expanded="false" aria-label="${aria}">
      ${img}
      <span class="targeting-tip tip-sticker" role="tooltip">
        <span class="tip-name">${escapeHtml(name)}</span>
        <span class="tip-rarity" data-rarity="${escapeHtml(s.rarity)}">${escapeHtml(rarityName)}</span>
        ${effectHtml}
        <span class="tip-spent">${escapeHtml(spent)}</span>
      </span>
    </div>`;
    })
    .join('');
}

export function renderStickerRail(locale: Locale, stickerIds: string[], opts?: { spent?: boolean }): string {
  return stickerSlots(locale, stickerIds, opts);
}

export function renderBattleCard(locale: Locale, unit: PublicUnitView): string {
  const def = getUnit(unit.defId);
  const silenced = Boolean(unit.silenced);
  const rules = silenced
    ? `<div class="rule-row">${renderTargetingLabel(locale, unit.targeting)}</div>`
    : def.id === 'pig'
      ? renderRuleRow(locale, unit.targeting, def.id)
      : def.id === 'silk-cocoon'
        ? `${renderRuleRow(locale, unit.targeting, def.id)}${renderCocoonBattleAbility(locale, Boolean(unit.provoke))}`
        : `${renderRuleRow(locale, unit.targeting, def.id)}${renderAbility(locale, def.id)}`;
  const huntCard = def.tags.includes('hunt');
  const printed = usesPrintedCardFace(def.id);
  const rarity = def.id === 'pig' ? unit.rarity : def.rarity;
  return `
    <article class="unit-card battle-card rarity-${rarity}${printed ? ' printed-card' : ''}${printed && (def.tags.includes('hunt') || def.id === 'silk-cocoon') ? ' is-cutout' : ''}${huntCard && !printed ? ' is-hunt-card' : ''}${unit.summoned ? ' is-summon' : ''}${silenced ? ' is-silenced' : ''}"
      data-uid="${unit.uid}" data-def="${unit.defId}" data-team="${unit.team}" data-slot="${unit.slot}">
      <div class="card-art">${portraitHtml(locale, def.id)}</div>
      ${rarityMark(locale, rarity, huntCard && !printed)}
      <div class="card-slab">
        <h3 class="card-name">${t(locale, def.nameKey)}</h3>
        <div class="stats">
          <div class="stat">${statIcon(locale, 'hp')}<b data-stat="hp">${unit.hp}</b></div>
          <div class="stat">${statIcon(locale, 'atk')}<b data-stat="atk">${unit.atk}</b></div>
          <div class="stat">${statIcon(locale, 'spd')}<b data-stat="spd">${unit.speed}</b></div>
        </div>
        ${rules}
      </div>
      <div class="sticker-rail">${stickerSlots(locale, unit.stickers, { spent: silenced })}</div>
    </article>`;
}

export function renderEmptySlot(locale: Locale, team: TeamId, slot: number): string {
  return `<div class="battle-slot" data-battle-slot="${team}-${slot}">
    <article class="unit-card battle-card is-empty" data-team="${team}" data-slot="${slot}">
      <div class="empty-back"><span>${slot}</span><em>${t(locale, 'vacant')}</em></div>
    </article>
  </div>`;
}

export function renderStickerCard(locale: Locale, id: string, picked: boolean, extraClass = ''): string {
  const s = getSticker(id);
  const art = hasStickerArt(id)
    ? `<img class="sticker-art" src="./art/stickers/${stickerArtFile(id)}.png?v=cast173" alt="${t(locale, s.nameKey)}" draggable="false" />`
    : '<div class="sticker-art is-empty" aria-hidden="true"></div>';
  const timing = resolveAbilityTiming(s);
  const title = timing ? renderTimingLabel(locale, timing) : '';
  const monster = s.frame === 'monster' ? ' monster' : '';
  if (s.id === 'poison') {
    return `
    <article class="sticker-card rarity-${s.rarity} ${picked ? 'picked' : ''} ${extraClass}${monster}" data-sticker="${id}" data-rarity="${s.rarity}">
      ${renderStickerRarity(locale, s.rarity)}
      ${art}
      <h4>${t(locale, s.nameKey)}</h4>
      ${poisonRules(locale)}
    </article>
  `;
  }
  const desc = t(locale, s.descKey);
  const splitAt = s.id === 'woodsmans-axe' ? desc.indexOf('. ') : -1;
  const grant = splitAt > 0 ? desc.slice(0, splitAt + 1) : '';
  const effect = splitAt > 0 ? desc.slice(splitAt + 2) : desc;
  return `
    <article class="sticker-card rarity-${s.rarity} ${picked ? 'picked' : ''} ${extraClass}${monster}" data-sticker="${id}" data-rarity="${s.rarity}">
      ${renderStickerRarity(locale, s.rarity)}
      ${art}
      <h4>${t(locale, s.nameKey)}</h4>
      ${grant ? `<p>${escapeHtml(grant)}</p>` : ''}
      ${title}
      <p>${linkKeywords(locale, effect)}</p>
    </article>
  `;
}

export function paintPortraits(root: HTMLElement): void {
  requestAnimationFrame(() => {
    fitCardSlabs(root);
    fitBookStickers(root);
  });
}

/** Keep a book-page sticker, including a long rule, inside the parchment. */
function fitBookStickers(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.book-page .sticker-card').forEach((card) => {
    const name = card.querySelector<HTMLElement>('h4');
    const timing = card.querySelector<HTMLElement>('.timing-type');
    const body = card.querySelector<HTMLElement>('p');
    for (const el of [name, timing, body]) {
      if (!el) continue;
      el.style.fontSize = '';
      el.style.lineHeight = '';
    }
    const overflows = () => card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1;
    let guard = 24;
    while (overflows() && guard > 0) {
      guard -= 1;
      for (const el of [body, timing, name]) {
        if (!el) continue;
        const cur = parseFloat(getComputedStyle(el).fontSize);
        const floor = el === name ? 9 : 8;
        if (!Number.isFinite(cur) || cur <= floor) continue;
        el.style.fontSize = `${Math.max(floor, cur * 0.92)}px`;
      }
      if (body && parseFloat(getComputedStyle(body).fontSize) <= 8) body.style.lineHeight = '1.05';
    }
  });
}

/** Shrink ability text so it stays inside the fixed parchment box. */
export function fitCardSlabs(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.unit-card:not(.is-empty) .card-slab').forEach(fitOneSlab);
}

function fitOneSlab(slab: HTMLElement): void {
  const rule = slab.querySelector<HTMLElement>('.ability-rule');
  const row = slab.querySelector<HTMLElement>('.rule-row');
  const name = slab.querySelector<HTMLElement>('.card-name');
  if (rule) {
    rule.style.fontSize = '';
    rule.style.lineHeight = '';
  }
  if (row) row.style.fontSize = '';
  if (name) name.style.fontSize = '';

  const overflows = () => slab.scrollHeight > slab.clientHeight + 1 || slab.scrollWidth > slab.clientWidth + 1;
  if (!overflows()) return;

  const shrink = (el: HTMLElement | null, factor: number, floor: number): number => {
    if (!el) return floor;
    const cur = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(cur) || cur <= floor) return floor;
    const next = Math.max(floor, cur * factor);
    el.style.fontSize = `${next}px`;
    return next;
  };

  let guard = 28;
  while (overflows() && guard > 0) {
    guard -= 1;
    const ruleSize = shrink(rule, 0.94, 5.5);
    shrink(row, 0.96, 5.5);
    if (guard < 12) shrink(name, 0.97, 9);
    if (rule && ruleSize <= 7) rule.style.lineHeight = '1.12';
    if (rule && ruleSize <= 5.5 && row && parseFloat(getComputedStyle(row).fontSize) <= 5.5) break;
  }
}
