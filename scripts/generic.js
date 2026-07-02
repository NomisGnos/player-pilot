import {
  asArray,
  capitalizeWords,
  cleanRulesText,
  escapeHtml,
  fieldText,
  formatActionTime,
  formatDurationInfo,
  formatRangeInfo,
  formatTargetInfo,
  hasItemProperty,
  htmlToPlain,
  localizedFieldLabel,
  numberText,
  resolveNumericFormula,
  signedMod
} from "./utils.js";

export const GENERIC_ADAPTER = {
  id: "generic",
  label: "Generic",
  summary(actor) {
    const system = actor?.system ?? {};
    const hp = system.attributes?.hp ?? system.hp ?? {};
    return {
      name: actor?.name ?? "Actor",
      type: actor?.type ?? "",
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      hp: `${numberText(hp.value)} / ${numberText(hp.max)}`,
      hpValue: Number(hp.value ?? 0),
      hpMax: Number(hp.max ?? 0),
      hpTemp: Number(hp.temp ?? hp.temporary ?? 0),
      ac: numberText(system.attributes?.ac?.value ?? system.ac?.value ?? system.ac),
      speed: fieldText(system.attributes?.movement?.walk, system.speed?.value, system.speed) || "-",
      initiative: signedMod(system.attributes?.init?.total ?? system.attributes?.init?.mod ?? 0),
      resource: fieldText(game.system?.title, game.system?.id),
      abilities: genericAbilityScores(actor)
    };
  },
  groups(actor) {
    const items = asArray(actor?.items).map((item) => normalizeGenericItem(item, item.type || "items"));
    return {
      actions: items.filter(itemBelongsInActions),
      spells: items.filter((item) => item.type === "spell"),
      features: items.filter(itemIsFeatureType),
      inventory: items.filter((item) => item.type !== "spell" && !itemIsFeatureType(item)),
      checks: []
    };
  },
  canUseItem() {
    return true;
  },
  async useItem(actor, item, options = {}) {
    const selected = selectedItemActivity(item, options.activityId);
    if (selected?.activity && typeof selected.activity.use === "function") return selected.activity.use({ legacy: false });
    if (typeof item?.use === "function") return item.use({ legacy: false });
    if (typeof item?.roll === "function") return item.roll();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> uses <strong>${escapeHtml(item.name)}</strong>.</p>`
    });
  },
  async rollCheck(actor, kind, key) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> requested ${escapeHtml(kind)} ${escapeHtml(key)}.</p>`
    });
  }
};

export const CURRENCY_LABELS = [
  ["pp", "Platinum"],
  ["gp", "Gold"],
  ["ep", "Electrum"],
  ["sp", "Silver"],
  ["cp", "Copper"]
];

export function genericAbilityScores(actor) {
  const source = actor?.system?.abilities ?? actor?.abilities ?? {};
  return Object.entries(source).slice(0, 6).map(([key, data]) => ({
    key,
    label: localizedFieldLabel(data?.label, key),
    score: numberText(data?.value ?? data?.score),
    mod: signedMod(data?.mod ?? data?.modifier ?? 0)
  }));
}

export function normalizeItem(item, group = "items") {
  const system = item?.system ?? {};
  const level = Number(system.level ?? system.rank ?? 0);
  const prepared = spellPreparedValue(item);
  const preparationMode = spellMethod(item);
  const preparationLocked = item?.type === "spell"
    && (level === 0 || spellAlwaysPrepared(item) || ["always", "atwill", "innate"].includes(preparationMode));
  const canPrepare = item?.type === "spell" && preparationMode && !preparationLocked;
  const activation = getItemActivationType(item);
  const rangeFeet = getItemRangeFeet(item);
  const quantity = system.quantity === undefined ? null : Number(system.quantity);
  const equippable = itemIsEquippable(item);
  const equipped = itemIsEquipped(item);
  const usesText = itemUsesText(item);
  return {
    id: item.id,
    name: itemDisplayName(item),
    type: item.type ?? "",
    group,
    img: item.img ?? "icons/svg/item-bag.svg",
    level: Number.isFinite(level) ? level : 0,
    prepared: prepared === true,
    preparationMode,
    preparationLocked,
    canPrepare,
    activation,
    rangeFeet,
    quantity: Number.isFinite(quantity) ? quantity : null,
    equippable,
    equipped,
    usable: itemCanBeUsed(item),
    containerId: String(system.container ?? system.containerId ?? system.location?.value ?? ""),
    ritual: !!(system.components?.ritual || hasItemProperty(item, "ritual")),
    concentration: itemRequiresConcentration(item),
    special: itemIsSpecialFeature(item),
    ammoRequired: itemNeedsAmmo(item),
    targetInfo: itemTargetInfo(item),
    description: htmlToPlain(system.description?.value ?? system.description ?? ""),
    spellDetails: spellDetailRows(item),
    usesText,
    badges: itemBadges(item)
  };
}

export function normalizeGenericItem(item, group = "items") {
  return {
    ...normalizeItem(item, group),
    canPrepare: false,
    preparationLocked: true,
    equippable: false,
    equipped: false,
    usable: true
  };
}

export function itemNeedsAmmo(item) {
  const system = item?.system ?? {};
  const text = `${item?.name ?? ""} ${system.type?.value ?? ""} ${system.type?.subtype ?? ""} ${system.weaponType ?? ""}`.toLowerCase();
  if (hasItemProperty(item, "ammunition") || hasItemProperty(item, "amm")) return true;
  if (system.ammunition || system.consume?.type === "ammo" || system.consume?.target) return true;
  if (/\b(bow|crossbow|firearm|sling|blowgun|pistol|rifle|musket)\b/.test(text)) return true;
  return getItemActivities(item).some((activity) => {
    const consumption = activity?.consumption ?? {};
    const targets = Array.isArray(consumption.targets) ? consumption.targets : Object.values(consumption.targets ?? {});
    return String(consumption.type ?? "").toLowerCase().includes("ammo")
      || targets.some((target) => String(target?.type ?? target?.kind ?? "").toLowerCase().includes("ammo"));
  });
}

export function activitySystem(activity) {
  if (!activity || typeof activity !== "object") return {};
  return activity.system && typeof activity.system === "object" ? activity.system : activity;
}

export function itemIsSpecialFeature(item) {
  if (!itemIsFeatureType(item)) return false;
  const sources = [item?.system, ...getItemActivities(item).map(activitySystem)];
  return sources.some((source) => {
    const activation = String(source?.activation?.type ?? source?.actionType ?? source?.type ?? "").toLowerCase();
    const rangeUnits = String(source?.range?.units ?? source?.range?.unit ?? source?.range?.type ?? "").toLowerCase();
    return activation === "special"
      || ["spec", "special"].includes(rangeUnits)
      || source?.special === true;
  }) || hasItemProperty(item, "special");
}

export function spellIsReady(item) {
  if (item?.type !== "spell") return true;
  const level = Number(item.system?.level ?? item.system?.rank ?? 0);
  const mode = spellMethod(item);
  const hasPreparedFlag = Object.prototype.hasOwnProperty.call(item.system ?? {}, "prepared")
    || Object.prototype.hasOwnProperty.call(legacySpellPreparation(item), "prepared");
  const prepared = spellPreparedValue(item);
  if (level === 0) return true;
  if (["always", "atwill", "innate", "pact"].includes(mode)) return true;
  if (!mode && !hasPreparedFlag) return true;
  return prepared;
}

export function spellPreparedValue(item) {
  const system = item?.system ?? {};
  if (Object.prototype.hasOwnProperty.call(system, "prepared")) return Number(system.prepared) > 0 || system.prepared === true;
  return legacySpellPreparation(item)?.prepared === true;
}

export function spellAlwaysPrepared(item) {
  const system = item?.system ?? {};
  const configuredValue = Number(CONFIG?.DND5E?.spellPreparationStates?.always?.value ?? 2);
  if (Number(system.prepared) === configuredValue) return true;
  return String(legacySpellPreparation(item)?.mode ?? "").toLowerCase() === "always";
}

export function spellMethod(item) {
  const system = item?.system ?? {};
  if (Object.prototype.hasOwnProperty.call(system, "method")) return String(system.method ?? "").toLowerCase();
  const legacy = legacySpellPreparation(item);
  return String(legacy?.mode ?? legacy?.preparedMode ?? "").toLowerCase();
}

export function legacySpellPreparation(item) {
  return item?._source?.system?.preparation ?? {};
}

export function itemIsEquippable(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const system = item?.system ?? {};
  if (!["weapon", "equipment", "armor", "tool"].includes(type)) return false;
  return Object.prototype.hasOwnProperty.call(system, "equipped");
}

export function itemIsEquipped(item) {
  const equipped = item?.system?.equipped;
  if (typeof equipped === "boolean") return equipped;
  if (equipped && typeof equipped === "object") {
    if (typeof equipped.value === "boolean") return equipped.value;
    if (typeof equipped.carryType === "string") return equipped.carryType.toLowerCase() === "equipped";
  }
  return false;
}

export function itemCanBeUsed(item) {
  if (!item) return false;
  if (item.type === "spell") return spellIsReady(item);
  if (itemIsEquippable(item)) return itemIsEquipped(item);
  return true;
}

export function itemHasActionTiming(item) {
  const activation = String(item?.activation ?? "").toLowerCase();
  return ACTION_TIMING_TYPES.has(activation) || activation === "bonus action";
}

export function itemBelongsInActions(item) {
  if (!item) return false;
  if (item.type === "spell") return item.usable === true;
  if (item.equippable) return item.equipped === true;
  if (itemIsFeatureType(item)) return item.special === true || item.ammoRequired === true || !!item.usesText || itemHasActionTiming(item);
  return ["consumable", "tool", "equipment"].includes(item.type);
}

const FEATURE_ITEM_TYPES = new Set(["feat", "action", "class", "subclass", "classfeature", "race", "background", "ancestry", "heritage"]);
const ACTION_TIMING_TYPES = new Set(["action", "bonus", "reaction"]);

export function itemIsFeatureType(item) {
  return FEATURE_ITEM_TYPES.has(item?.type);
}

export function spellDetailRows(item) {
  if (item?.type !== "spell") return [];
  const system = item.system ?? {};
  const rows = [];
  const activity = getItemActivities(item)[0] ?? {};
  const activityData = activitySystem(activity);
  const activation = system.activation ?? activityData.activation ?? activity.activation ?? {};
  const activityActivation = activityData.activation ?? activity.activation ?? {};
  const activityRange = activityData.range ?? activity.range ?? {};
  const activityTarget = activityData.target ?? activity.target ?? {};
  const activityDuration = activityData.duration ?? activity.duration ?? {};
  const casting = fieldText(
    formatActionTime(activation),
    formatActionTime(activityActivation),
    system.time?.value && `${system.time.value} ${system.time.unit ?? ""}`,
    system.actionType,
    activityData.actionType
  );
  const range = fieldText(
    formatRangeInfo(system.range ?? {}),
    formatRangeInfo(activityRange),
    system.range?.label,
    activityRange?.label
  );
  const targetInfo = itemTargetInfo(item);
  const target = fieldText(
    targetInfo.text,
    system.target?.affects?.count && system.target?.affects?.type ? `${system.target.affects.count} ${system.target.affects.type}` : "",
    activityTarget?.affects?.count && activityTarget?.affects?.type ? `${activityTarget.affects.count} ${activityTarget.affects.type}` : "",
    formatTargetInfo(system.target ?? {}),
    formatTargetInfo(activityTarget),
    system.target?.value && `${system.target.value} ${system.target.type ?? ""}`,
    activityTarget?.value && `${activityTarget.value} ${activityTarget.type ?? ""}`,
    system.target?.type,
    activityTarget?.type,
    system.target?.area?.type
  );
  const components = spellComponentsLabel(item);
  const duration = fieldText(
    formatDurationInfo(system.duration ?? {}),
    formatDurationInfo(activityDuration),
    system.duration?.value && `${system.duration.value} ${system.duration.units ?? ""}`,
    activityDuration?.value && `${activityDuration.value} ${activityDuration.units ?? ""}`,
    system.duration?.units,
    activityDuration?.units,
    system.time?.duration
  );
  if (casting) rows.push(["Casting Time", casting]);
  if (range) rows.push(["Range", range]);
  if (target) rows.push(["Target", target]);
  if (components) rows.push(["Components", components]);
  if (duration) rows.push(["Duration", duration]);
  return rows;
}


export function itemUsesText(item) {
  const system = item?.system ?? {};
  const uses = system.uses;
  if (!uses || typeof uses !== "object") return "";
  const spent = Number(uses.spent ?? NaN);
  const max = resolveNumericFormula(uses.max, item);
  const explicitValue = Number(uses.value ?? NaN);
  const value = Number.isFinite(explicitValue)
    ? explicitValue
    : (Number.isFinite(max) && Number.isFinite(spent) ? Math.max(0, max - spent) : NaN);
  const recovery = restRecoveryLabel(
    uses.per
    ?? uses.recovery?.period
    ?? uses.recovery?.[0]?.period
    ?? uses.recovery?.find?.((entry) => entry?.period)?.period
    ?? ""
  );
  if (Number.isFinite(max) && max > 0) {
    const base = `Uses Available ${Number.isFinite(value) ? value : max} / ${max}`;
    return `${base}${recovery ? `, resets on ${recovery}` : ""}`;
  }
  if (Number.isFinite(value) && value > 0) {
    const base = `Uses Available ${value}`;
    return `${base}${recovery ? `, resets on ${recovery}` : ""}`;
  }
  return "";
}


export function restRecoveryLabel(value) {
  const text = String(value ?? "").trim();
  const lower = text.toLowerCase();
  if (["sr", "short", "shortrest", "short rest"].includes(lower)) return "Short Rest";
  if (["lr", "long", "longrest", "long rest"].includes(lower)) return "Long Rest";
  return capitalizeWords(text);
}

export function itemBadges(item) {
  const system = item?.system ?? {};
  const badges = [];
  const spellRows = item?.type === "spell" ? Object.fromEntries(spellDetailRows(item).map(([label, value]) => [label, value])) : {};
  const activation = fieldText(spellRows["Casting Time"], system.activation?.type, system.actionType);
  const range = fieldText(spellRows.Range, itemRangeLabel(item));
  const target = fieldText(spellRows.Target, system.target?.affects?.type, system.target?.type, system.target?.value);
  const qty = system.quantity;
  const featureType = ["feat", "class", "subclass", "background", "race", "ancestry", "heritage", "classfeature", "action"].includes(item?.type)
    ? fieldText(system.type?.subtype, system.type?.value, system.category, system.requirements)
    : "";
  if (activation) badges.push(activation);
  else if (item?.type && item.type !== "spell" && item.type !== "weapon") badges.push("Passive");
  if (range) badges.push(range);
  if (target) badges.push(target);
  if (featureType) badges.push(featureType);
  const useText = itemUsesText(item);
  if (useText) badges.push(useText);
  if (qty !== undefined && Number(qty) !== 1) badges.push(`qty ${qty}`);
  return badges.slice(0, 4);
}

export function itemRangeLabel(item) {
  const sources = [item?.system, ...getItemActivities(item).map(activitySystem)];
  for (const source of sources) {
    const label = fieldText(formatRangeInfo(source?.range ?? {}), source?.range?.label);
    if (label && !/^(?:ft|feet|foot|mi|mile|miles)$/i.test(label)) return label;
  }
  return "";
}

export function spellComponentsLabel(item) {
  const system = item?.system ?? {};
  const components = system.components ?? {};
  const materials = system.materials ?? {};
  const values = [];
  if (components.vocal || components.v) values.push("V");
  if (components.somatic || components.s) values.push("S");
  if (components.material || components.m) values.push("M");
  if (components.value && typeof components.value === "string") values.push(components.value);
  if (materials.value) values.push(`M: ${materials.value}`);
  if (hasItemProperty(item, "vocal") || hasItemProperty(item, "v")) values.push("V");
  if (hasItemProperty(item, "somatic") || hasItemProperty(item, "s")) values.push("S");
  if (hasItemProperty(item, "material") || hasItemProperty(item, "m")) values.push("M");
  const unique = Array.from(new Set(values.map((entry) => String(entry).trim()).filter(Boolean)));
  return unique.join(", ");
}

export function getItemActivities(item) {
  const raw = item?.system?.activities;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.contents)) return raw.contents;
  if (typeof raw.values === "function") return Array.from(raw.values());
  return Object.values(raw);
}

export function usableItemActivities(item) {
  const premades = item?.flags?.["chris-premades"] ?? {};
  const hiddenValues = new Set(asArray(premades.hiddenActivities).map((value) => String(value ?? "").toLowerCase()));
  const activityIdentifiers = premades.activityIdentifiers ?? {};
  for (const hidden of Array.from(hiddenValues)) {
    const mapped = activityIdentifiers?.[hidden];
    if (mapped) hiddenValues.add(String(mapped).toLowerCase());
  }
  const riders = new Set(asArray(item?.flags?.dnd5e?.riders?.activity).map((value) => String(value ?? "").toLowerCase()));
  const seen = new Set();
  return getItemActivities(item)
    .filter((activity) => activity?.canUse !== false)
    .filter((activity) => {
      const data = activitySystem(activity);
      const id = String(activity.id ?? activity._id ?? "").toLowerCase();
      const identifier = String(data.identifier ?? activity.identifier ?? "").toLowerCase();
      const name = cleanRulesText(activity.name ?? data.name ?? "").toLowerCase();
      const midi = data.midiProperties ?? activity.midiProperties ?? {};
      if (midi.automationOnly === true || data.automationOnly === true) return false;
      if (hiddenValues.has(id) || hiddenValues.has(identifier) || hiddenValues.has(name)) return false;
      if (riders.has(id) || riders.has(identifier)) return false;
      return true;
    })
    .map((activity, index) => {
      const data = activitySystem(activity);
      const type = String(data.type ?? activity.type ?? "activity").toLowerCase();
      return {
        id: String(activity.id ?? activity._id ?? index),
        name: cleanRulesText(activity.name ?? data.name ?? capitalizeWords(type) ?? `Option ${index + 1}`),
        type,
        img: activity.img ?? data.img ?? item?.img ?? "",
        activity
      };
    })
    .filter((entry) => {
      const normalizedName = entry.name.toLowerCase().replace(/\s+/g, " ").trim();
      const key = normalizedName === "midi use" ? normalizedName : `${normalizedName}|${entry.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function itemPlayerChoice(item, actor) {
  if (String(game.system?.id ?? "").toLowerCase() !== "dnd5e") return null;
  const name = itemDisplayName(item).toLowerCase();
  const description = htmlToPlain(item?.system?.description?.value ?? item?.system?.description ?? "").toLowerCase();
  const asksForSkill = name === "guidance"
    || /\b(?:choose|select)\b.{0,80}\b(?:skill|ability check)\b/i.test(description);
  if (asksForSkill) {
    const skills = Object.entries(actor?.system?.skills ?? {}).map(([key, skill]) => {
      const label = fieldText(skill?.label, CONFIG?.DND5E?.skills?.[key]?.label, CONFIG?.DND5E?.skills?.[key], key.toUpperCase());
      return { value: label, label };
    });
    if (skills.length) return {
      label: "Skill choice",
      prompt: "Choose the skill the GM should apply for this use.",
      options: skills
    };
  }
  const asksForAbility = /\b(?:choose|select)\b.{0,80}\bability\b/i.test(description);
  if (asksForAbility) {
    const abilities = Object.entries(CONFIG?.DND5E?.abilities ?? {}).map(([key, ability]) => {
      const label = fieldText(ability?.label, ability, key.toUpperCase());
      return { value: label, label };
    });
    if (abilities.length) return {
      label: "Ability choice",
      prompt: "Choose the ability the GM should apply for this use.",
      options: abilities
    };
  }
  return null;
}

export function selectedItemActivity(item, activityId = "") {
  const activities = usableItemActivities(item);
  return activities.find((entry) => entry.id === String(activityId ?? "")) ?? activities[0] ?? null;
}

export function getItemActivationType(item) {
  const direct = String(item?.system?.activation?.type ?? item?.system?.actionType ?? "").toLowerCase();
  if (direct) return direct;
  for (const activity of getItemActivities(item)) {
    const type = String(activity?.activation?.type ?? activity?.actionType ?? activity?.type ?? "").toLowerCase();
    if (["action", "bonus", "reaction", "minute", "hour", "special"].includes(type)) return type;
  }
  return "";
}

export function getItemRangeFeet(item, activityId = "") {
  const selected = activityId ? selectedItemActivity(item, activityId)?.activity : null;
  const sources = selected ? [activitySystem(selected), item?.system] : [item?.system, ...getItemActivities(item).map(activitySystem)];
  for (const source of sources) {
    const range = source?.range ?? {};
    const value = Number(range.value ?? range.distance ?? range.normal ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const units = String(range.units ?? range.unit ?? "ft").toLowerCase();
    if (["mi", "mile", "miles"].includes(units)) return value * 5280;
    if (["m", "meter", "meters"].includes(units)) return value * 3.28084;
    if (["km", "kilometer", "kilometers"].includes(units)) return value * 3280.84;
    return value;
  }
  return 0;
}

export function itemRequiresConcentration(item) {
  const system = item?.system ?? {};
  if (system.components?.concentration === true || system.components?.con === true) return true;
  if (system.duration?.concentration === true || String(system.duration?.units ?? "").toLowerCase() === "concentration") return true;
  if (system.properties?.concentration === true || system.properties?.con === true) return true;
  if (hasItemProperty(item, "concentration") || hasItemProperty(item, "con")) return true;
  return getItemActivities(item).some((activity) => {
    const duration = activity?.duration ?? activity?.activation?.duration ?? {};
    return duration?.concentration === true || String(duration?.units ?? "").toLowerCase() === "concentration";
  });
}

export function isConcentrationEffect(effect) {
  if (!effect || effect.disabled === true || effect.isSuppressed === true) return false;
  const statuses = asArray(effect.statuses).map((status) => String(status ?? "").toLowerCase());
  const statusId = String(effect.flags?.core?.statusId ?? "").toLowerCase();
  const name = String(effect.name ?? effect.label ?? "").toLowerCase();
  return statuses.some((status) => status.includes("concentrat"))
    || statusId.includes("concentrat")
    || name.includes("concentrat");
}

export function itemDisplayName(item) {
  return cleanRulesText(item?.name ?? "Item") || "Item";
}

export function itemTargetInfo(item, activityId = "") {
  const selected = activityId ? selectedItemActivity(item, activityId)?.activity : null;
  const candidates = selected
    ? [activitySystem(selected), item?.system]
    : [item?.system, ...getItemActivities(item).map(activitySystem)];
  let count = 0;
  let countSource = "";
  let type = "";
  let selfOnly = false;
  let hasAreaTemplate = false;
  for (const source of candidates) {
    const target = source?.target ?? {};
    const affects = target.affects ?? {};
    const nextType = fieldText(affects.type, target.type, target.template?.type, target.area?.type);
    const nextCount = Number(affects.count ?? target.count ?? target.value ?? 0);
    if (nextType) type = nextType;
    if (Number.isFinite(nextCount) && nextCount > 0) {
      count = Math.max(count, nextCount);
      countSource = "structured";
    }
    const lowered = String(nextType ?? "").toLowerCase();
    if (lowered.includes("self")) selfOnly = true;
    if (fieldText(target.template?.type, target.area?.type)) hasAreaTemplate = true;
  }
  const isWeaponAttack = item?.type === "weapon" || getItemActivities(item).some((activity) => String(activitySystem(activity)?.type ?? activity?.type ?? "").toLowerCase() === "attack");
  if (isWeaponAttack && count <= 0) {
    count = 1;
    countSource = "weapon";
  }
  if (isWeaponAttack && !type) type = "creature";
  const description = htmlToPlain(item?.system?.description?.value ?? item?.system?.description ?? "").toLowerCase();
  const targetNoun = "(?:creature|target|ally|enemy|object|token)";
  const targetCountScales = new RegExp(
    `\\b(?:one|an?|\\d+)\\s+additional\\s+${targetNoun}s?\\b|\\badditional\\s+${targetNoun}s?\\b[^.]{0,100}\\b(?:spell slot|slot level|cast level|rank)\\b`,
    "i"
  ).test(description);
  const explicitMultiple = new RegExp(
    `\\b(?:up to|any number of|one or more|two|three|four|five|six|seven|eight|nine|ten|each|all)\\s+(?:(?:willing|hostile|different|other)\\s+)?${targetNoun}s?\\b`,
    "i"
  ).test(description);
  const singularPattern = new RegExp(
    `\\b(?:a|an|one)\\s+(?:(?:willing|hostile|unconscious|different|other)\\s+)?${targetNoun}\\b`,
    "gi"
  );
  const singularMentions = Array.from(description.matchAll(singularPattern)).length;
  const explicitSingular = singularMentions === 1;
  const singularTargetType = new RegExp(`\\b${targetNoun}\\b`, "i").test(type);
  if (count <= 0 && singularTargetType && explicitSingular && !explicitMultiple && !targetCountScales && !hasAreaTemplate) {
    count = 1;
    countSource = "description";
  }
  const limitKnown = count > 0 && !targetCountScales;
  const statedCount = count;
  if (!limitKnown) count = 0;
  const allowSelf = selfOnly || (
    /(creature|ally|willing)/i.test(type)
    && !/(enemy|hostile)/i.test(type)
    && !/\b(other|another) creature\b/i.test(description)
  );
  const needsTarget = !selfOnly && (isWeaponAttack || statedCount > 0 || /(creature|enemy|ally|allies|enemies|object|objects|token)/i.test(type));
  return {
    count,
    statedCount,
    countSource,
    limitKnown,
    limitReason: targetCountScales ? "Target count changes with cast level." : "",
    type,
    text: limitKnown && count > 0 && type ? `${count} ${type}` : capitalizeWords(type),
    needsTarget,
    selfOnly,
    allowSelf,
    hasAreaTemplate
  };
}
