import {
  GENERIC_ADAPTER,
  abilityDisplayIcon,
  isConcentrationEffect,
  itemBelongsInActions,
  itemIsFeatureType,
  itemNeedsAmmo,
  itemRequiresConcentration,
  normalizeItem,
  selectedItemActivity
} from "./generic.js";
import {
  asArray,
  d20Formula,
  fieldText,
  numberText,
  signedMod
} from "./utils.js";

export const DND5E_ABILITIES = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]
];

const DND5E_SKILL_LABELS = {
  acr: "Acrobatics",
  ani: "Animal Handling",
  arc: "Arcana",
  ath: "Athletics",
  dec: "Deception",
  his: "History",
  ins: "Insight",
  itm: "Intimidation",
  inv: "Investigation",
  med: "Medicine",
  nat: "Nature",
  prc: "Perception",
  prf: "Performance",
  per: "Persuasion",
  rel: "Religion",
  slt: "Sleight of Hand",
  ste: "Stealth",
  sur: "Survival"
};

export const DND5E_ADAPTER = {
  ...GENERIC_ADAPTER,
  id: "dnd5e",
  label: "D&D5e",
  summary(actor) {
    const system = actor?.system ?? {};
    const hp = system.attributes?.hp ?? {};
    const movement = system.attributes?.movement ?? {};
    const walk = fieldText(movement.walk && `${movement.walk} ft`, movement.fly && `${movement.fly} fly`);
    const spells = system.spells ?? {};
    const pact = spells.pact;
    const level = Number(system.details?.level ?? getDndTotalLevel(actor) ?? 0);
    const exhaustion = readExhaustionValue(actor);
    const death = actor?._source?.system?.attributes?.death ?? system.attributes?.death ?? {};
    const deathText = `Successes ${Number(death.success ?? 0)}, Failures ${Number(death.failure ?? 0)}`;
    return {
      name: actor?.name ?? "Actor",
      type: actor?.type ?? "",
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      hp: `${numberText(hp.value)} / ${numberText(hp.max)}`,
      hpValue: Number(hp.value ?? 0),
      hpMax: Number(hp.max ?? 0),
      hpTemp: Number(hp.temp ?? hp.temporary ?? 0),
      hitDice: dndHitDiceText(actor),
      ac: numberText(system.attributes?.ac?.value),
      speed: walk || "-",
      initiative: signedMod(system.attributes?.init?.total ?? system.attributes?.init?.mod ?? 0),
      level: Number.isFinite(level) && level > 0 ? String(level) : "-",
      prof: signedMod(system.attributes?.prof),
      exhaustion: Number.isFinite(exhaustion) ? `Level ${exhaustion}` : "Level 0",
      exhaustionValue: Number.isFinite(exhaustion) ? exhaustion : 0,
      death: deathText,
      deathSuccess: Number(death.success ?? 0),
      deathFailure: Number(death.failure ?? 0),
      abilities: dndAbilityScores(actor)
    };
  },
  groups(actor) {
    const items = asArray(actor?.items);
    const normalized = items.map((item) => normalizeItem(item));
    const byId = new Map(normalized.map((item) => [item.id, item]));
    normalized.forEach((item) => {
      if (item.containerId && byId.has(item.containerId)) item.containerName = byId.get(item.containerId).name;
    });
    const checks = [];
    const abilities = actor?.system?.abilities ?? {};
    for (const [key, label] of DND5E_ABILITIES) {
      const ability = abilities?.[key] ?? {};
      checks.push({ kind: "abilityCheck", key, name: `${label} Check`, label, badge: "Ability", category: "checks", formula: d20Formula(ability.mod), ability: key });
      checks.push({
        kind: "abilitySave",
        key,
        name: `${label} Save`,
        label,
        badge: "Save",
        category: "saves",
        formula: d20Formula(ability.save?.value ?? ability.save?.mod ?? ability.saveTotal ?? ability.mod),
        ability: key
      });
    }
    const skills = actor?.system?.skills ?? {};
    for (const [key, data] of Object.entries(skills)) {
      checks.push({
        kind: "skill",
        key,
        name: data?.label ?? DND5E_SKILL_LABELS[key] ?? key,
        badge: "Skill",
        category: "skills",
        formula: d20Formula(data?.total ?? data?.mod),
        ability: String(data?.ability ?? data?.abilityKey ?? data?.baseAbility ?? "")
      });
    }
    const actions = normalized.filter(itemBelongsInActions);
    return {
      actions,
      actionGroups: groupDndActions(actions),
      spells: normalized.filter((item) => item.type === "spell").sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      features: normalized.filter(itemIsFeatureType),
      inventory: normalized.filter((item) => ["weapon", "equipment", "consumable", "tool", "loot", "backpack"].includes(item.type)),
      spellSlots: dndSpellSlots(actor),
      checks
    };
  },
  spellSlotChoices(actor, item) {
    if (!actor || item?.type !== "spell") return [];
    const base = Number(item.system?.level ?? 0);
    if (!Number.isFinite(base) || base <= 0) return [];
    const choices = [];
    const spells = actor.system?.spells ?? {};
    for (let level = base; level <= 9; level += 1) {
      const slot = spells[`spell${level}`];
      if (!slot) continue;
      const value = Number(slot.value ?? 0);
      const max = Number(slot.max ?? 0);
      if (!Number.isFinite(max) || max <= 0) continue;
      choices.push({ level, value, max, label: `Level ${level} (${value}/${max})` });
    }
    const pact = spells.pact;
    const pactLevel = Number(pact?.level ?? 0);
    if (pact && pactLevel >= base) {
      choices.push({
        level: pactLevel,
        value: Number(pact.value ?? 0),
        max: Number(pact.max ?? 0),
        label: `Pact ${pactLevel} (${pact.value ?? 0}/${pact.max ?? 0})`
      });
    }
    return choices;
  },
  concentrationWarning(actor, item) {
    if (item?.type !== "spell" || !itemRequiresConcentration(item)) return "";
    const active = actorConcentrationEffects(actor)[0];
    return active
      ? `This will replace concentration on ${concentrationEffectLabel(actor, active)}.`
      : "This uses concentration.";
  },
  ammoChoices(actor, item) {
    if (!actor || !item) return [];
    if (!itemNeedsAmmo(item)) return [];
    const wanted = ammoKeywordsForItem(item);
    const ammo = asArray(actor.items).filter((candidate) => {
      if (!["consumable", "loot"].includes(candidate.type)) return false;
      const text = `${candidate.name ?? ""} ${candidate.system?.type?.value ?? ""} ${candidate.system?.type?.subtype ?? ""}`.toLowerCase();
      if (!/\b(ammo|ammunition|arrow|bolt|bullet|shot|dart|stone)\b/.test(text)) return false;
      if (!wanted.length) return true;
      return wanted.some((word) => text.includes(word));
    });
    return ammo.map((item) => ({
      id: item.id,
      label: `${item.name} (${Number(item.system?.quantity ?? item.system?.uses?.value ?? 0)} left)`
    }));
  },
  async useItem(actor, item, options = {}) {
    if (typeof item?.use === "function") {
      const useOptions = { legacy: false };
      const level = Number.parseInt(options.castLevel, 10);
      if (item.type === "spell" && Number.isFinite(level) && level > 0) {
        queuePendingCastLevel(item.name, level);
        useOptions.level = level;
        useOptions.spellLevel = level;
        useOptions.slotLevel = level;
        useOptions.castLevel = level;
      }
      const scaling = item.type === "spell" ? dndSpellScalingIncrease(actor, item, Number.isFinite(level) ? level : options.castLevel) : 0;
      if (scaling > 0) useOptions.scaling = scaling;
      if (options.ammoItemId) {
        useOptions.ammunition = options.ammoItemId;
        useOptions.ammo = options.ammoItemId;
      }
      if (options.replaceConcentrationEffectId) {
        await endActorConcentration(actor, options.replaceConcentrationEffectId);
        useOptions.concentration = {
          begin: true,
          end: String(options.replaceConcentrationEffectId)
        };
      }
      const selected = selectedItemActivity(item, options.activityId);
      if (selected?.activity && typeof selected.activity.use === "function") {
        return selected.activity.use(useOptions);
      }
      return item.use(useOptions);
    }
    return GENERIC_ADAPTER.useItem(actor, item);
  },
  async rollCheck(actor, kind, key) {
    if (kind === "initiative" && typeof actor.rollInitiative === "function") {
      return actor.rollInitiative({ createCombatants: true });
    }
    if (kind === "deathSave" && typeof actor.rollDeathSave === "function") {
      return actor.rollDeathSave({ legacy: false }, { configure: false });
    }
    if (kind === "skill") {
      if (typeof actor.rollSkill === "function") return actor.rollSkill({ skill: key }, { configure: false });
      const entry = actor.system?.skills?.[key] ?? actor.skills?.[key];
      if (await rollActorEntry(entry)) return;
    }
    if (kind === "abilityCheck") {
      if (typeof actor.rollAbilityCheck === "function") return actor.rollAbilityCheck({ ability: key }, { configure: false });
      if (typeof actor.rollAbilityTest === "function") return actor.rollAbilityTest(key, { configure: false });
      const entry = actor.system?.abilities?.[key] ?? actor.abilities?.[key];
      if (await rollActorEntry(entry?.check ?? entry)) return;
    }
    if (kind === "abilitySave") {
      if (typeof actor.rollSavingThrow === "function") return actor.rollSavingThrow({ ability: key }, { configure: false });
      if (typeof actor.rollAbilitySave === "function") return actor.rollAbilitySave(key, { configure: false });
      const entry = actor.system?.abilities?.[key] ?? actor.abilities?.[key];
      if (await rollActorEntry(entry?.save ?? entry?.savingThrow ?? entry)) return;
    }
    return GENERIC_ADAPTER.rollCheck(actor, kind, key);
  }
};

const pendingCastLevels = globalThis.__PLAYER_PILOT_PENDING_CAST_LEVELS__ ?? (globalThis.__PLAYER_PILOT_PENDING_CAST_LEVELS__ = []);

export function queuePendingCastLevel(itemName, level) {
  const name = String(itemName ?? "").trim().toLowerCase();
  const castLevel = Number.parseInt(level, 10);
  if (!name || !Number.isFinite(castLevel) || castLevel <= 0) return;
  pendingCastLevels.push({ name, level: castLevel, at: Date.now() });
  if (pendingCastLevels.length > 20) pendingCastLevels.splice(0, pendingCastLevels.length - 20);
}

export function applyPendingCastLevel(app, html) {
  if (!game.user?.isGM || !pendingCastLevels.length) return;
  const root = html?.[0] ?? html;
  if (!(root instanceof HTMLElement)) return;
  const text = `${app?.title ?? ""} ${root.textContent ?? ""}`.toLowerCase();
  if (!text.includes("cast at level") && !text.includes("spell level")) return;
  const now = Date.now();
  for (let index = pendingCastLevels.length - 1; index >= 0; index -= 1) {
    if (now - pendingCastLevels[index].at > 30000) pendingCastLevels.splice(index, 1);
  }
  const index = pendingCastLevels.findIndex((entry) => text.includes(entry.name));
  const pending = pendingCastLevels[index >= 0 ? index : pendingCastLevels.length - 1];
  if (!pending) return;
  const apply = () => {
    const selects = Array.from(root.querySelectorAll("select"));
    const select = root.querySelector("select[name='castLevel'], select[name='spellLevel'], select[name='slotLevel'], select[data-action='castLevel']")
      ?? selects.find((candidate) => Array.from(candidate.options ?? []).some((option) => String(option.value) === String(pending.level)));
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = Array.from(select.options).find((entry) => String(entry.value) === String(pending.level)
      || String(entry.textContent ?? "").toLowerCase().includes(`level ${pending.level}`));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    pendingCastLevels.splice(pendingCastLevels.indexOf(pending), 1);
    return true;
  };
  [0, 60, 150, 350].forEach((delay) => window.setTimeout(apply, delay));
}

export function dndHitDiceText(actor) {
  const hd = actor?.system?.attributes?.hd;
  if (!hd) return "";
  const value = Number(hd.value ?? NaN);
  const max = Number(hd.max ?? NaN);
  const bySize = hd.bySize && typeof hd.bySize === "object"
    ? Object.entries(hd.bySize)
      .filter(([, count]) => Number(count) > 0)
      .map(([size, count]) => `${Number(count)}${size}`)
      .join(", ")
    : "";
  if (Number.isFinite(value) && Number.isFinite(max)) return bySize ? `${value} / ${max} left (${bySize})` : `${value} / ${max} left`;
  if (Number.isFinite(value)) return `${value} left`;
  return bySize;
}

export async function rollActorEntry(entry) {
  if (!entry) return false;
  if (typeof entry.roll === "function") {
    await entry.roll({ configure: false, event: null });
    return true;
  }
  if (typeof entry.check?.roll === "function") {
    await entry.check.roll({ configure: false, event: null });
    return true;
  }
  if (typeof entry.save?.roll === "function") {
    await entry.save.roll({ configure: false, event: null });
    return true;
  }
  return false;
}

export function ammoKeywordsForItem(item) {
  const text = `${item?.name ?? ""} ${item?.system?.type?.value ?? ""} ${item?.system?.type?.subtype ?? ""}`.toLowerCase();
  if (text.includes("crossbow")) return ["bolt"];
  if (text.includes("bow")) return ["arrow"];
  if (text.includes("sling")) return ["stone", "bullet"];
  if (text.includes("blowgun")) return ["dart"];
  if (/(firearm|pistol|rifle|musket|gun)/.test(text)) return ["bullet", "shot"];
  return [];
}

export function getDndTotalLevel(actor) {
  return asArray(actor?.items)
    .filter((item) => item.type === "class")
    .reduce((total, item) => total + Number(item.system?.levels ?? 0), 0);
}

export function dndCantripScalingIncrease(actor, item) {
  const systemLevel = Number(actor?.system?.cantripLevel?.(item));
  const level = Number.isFinite(systemLevel) && systemLevel > 0
    ? systemLevel
    : Number(actor?.system?.details?.level ?? getDndTotalLevel(actor) ?? 0);
  return Math.max(0, Math.floor(((Number.isFinite(level) ? level : 0) + 1) / 6));
}

export function dndSpellScalingIncrease(actor, item, castLevel = "") {
  const baseLevel = Number(item?.system?.level ?? item?.system?.rank ?? 0);
  if (!Number.isFinite(baseLevel)) return 0;
  if (baseLevel <= 0) return dndCantripScalingIncrease(actor, item);
  const level = Number(castLevel ?? 0);
  if (Number.isFinite(level) && level > baseLevel) return level - baseLevel;
  const flagged = Number(item?.getFlag?.("dnd5e", "scaling") ?? item?.flags?.dnd5e?.scaling ?? NaN);
  return Number.isFinite(flagged) && flagged > 0 ? flagged : 0;
}

export function dndAbilityScores(actor) {
  const abilities = actor?.system?.abilities ?? {};
  return DND5E_ABILITIES.map(([key, label]) => ({
    key,
    label,
    score: numberText(abilities?.[key]?.value),
    mod: signedMod(abilities?.[key]?.mod),
    icon: abilityDisplayIcon(key),
  }));
}


export function groupDndActions(items) {
  const groups = {
    action: [],
    bonus: [],
    reaction: [],
    passive: [],
    other: []
  };
  for (const item of items) {
    const key = String(item.activation ?? "").toLowerCase();
    if (key === "action") groups.action.push(item);
    else if (key === "bonus") groups.bonus.push(item);
    else if (key === "reaction") groups.reaction.push(item);
    else if (["none", "passive"].includes(key)) groups.passive.push(item);
    else groups.other.push(item);
  }
  return groups;
}

export function dndSpellSlots(actor) {
  const spells = actor?.system?.spells ?? {};
  const slots = [];
  for (let level = 1; level <= 9; level += 1) {
    const slot = spells[`spell${level}`];
    const value = Number(slot?.value ?? 0);
    const max = Number(slot?.max ?? slot?.override ?? 0);
    if ((!Number.isFinite(max) || max <= 0) && (!Number.isFinite(value) || value <= 0)) continue;
    slots.push({
      key: `spell${level}`,
      level,
      label: `Level ${level}`,
      value: Number.isFinite(value) ? value : 0,
      max: Number.isFinite(max) && max > 0 ? max : value
    });
  }
  const pact = spells.pact;
  const pactMax = Number(pact?.max ?? 0);
  if (Number.isFinite(pactMax) && pactMax > 0) {
    slots.push({
      key: "pact",
      level: Number(pact.level ?? 0),
      label: `Pact Level ${Number(pact.level ?? 0) || "?"}`,
      value: Number(pact.value ?? 0),
      max: pactMax
    });
  }
  return slots;
}

export async function endActorConcentration(actor, effectId) {
  const id = String(effectId ?? "");
  if (!actor || !id) return false;
  if (typeof actor.endConcentration === "function") {
    try {
      await actor.endConcentration(id);
      return true;
    } catch (err) {
      console.warn("Player Pilot could not end concentration through D&D5e.", err);
    }
  }
  const effect = actor.effects?.get?.(id) ?? asArray(actor.effects).find((entry) => String(entry?.id ?? "") === id);
  if (!effect) return false;
  if (typeof effect.delete === "function") {
    await effect.delete();
    return true;
  }
  if (typeof actor.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
    return true;
  }
  return false;
}

export function actorConcentrationEffects(actor) {
  const tracked = asArray(actor?.concentration?.effects)
    .filter((effect) => effect?.disabled !== true && effect?.isSuppressed !== true);
  if (tracked.length) return tracked;
  return asArray(actor?.effects).filter(isConcentrationEffect);
}

export function concentrationEffectLabel(actor, effect) {
  const itemData = effect?.getFlag?.("dnd5e", "item") ?? effect?.flags?.dnd5e?.item ?? {};
  const itemName = fieldText(
    itemData?.data?.name,
    actor?.items?.get?.(itemData?.id)?.name
  );
  if (itemName) return itemName;
  const effectName = fieldText(effect?.name, effect?.label, "an active spell");
  return effectName.replace(/^concentrat(?:ing|ion)\s*:\s*/i, "") || "an active spell";
}

export function readExhaustionValue(actor) {
  const raw = actor?._source?.system?.attributes?.exhaustion ?? actor?.system?.attributes?.exhaustion;
  const value = typeof raw === "object" && raw !== null ? raw.value : raw;
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
