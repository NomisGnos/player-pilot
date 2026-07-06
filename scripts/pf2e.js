import {
  CURRENCY_LABELS,
  GENERIC_ADAPTER,
  abilityDisplayIcon,
  itemIsEquipped,
  itemIsFeatureType,
  itemUsesText,
  normalizeItem,
} from "./generic.js";
import { activeGmIds, actorHasActiveTurn, addLog, closeModal, executePlayerFirst, openModal, renderInterfaceIcon, sendSocket, setting, showResultToast } from "./player-pilot.js";
import {
  asArray,
  capitalizeWords,
  clamp,
  cleanRulesText,
  d20Formula,
  fieldText,
  htmlToPlain,
  localize,
  localizedFieldLabel,
  mergeTabs,
  numberText,
  signedMod
} from "./utils.js";

export const PF2E_ADAPTER = {
  ...GENERIC_ADAPTER,
  id: "pf2e",
  label: "PF2e",
  summary(actor) {
    const system = actor?.system ?? {};
    const hp = system.attributes?.hp ?? {};
    return {
      name: actor?.name ?? "Actor",
      type: actor?.type ?? "",
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      hp: {
        display: `${numberText(hp.value)} / ${numberText(hp.max)}`,
        value: hp.value,
        max: hp.max,
        temp: hp.temp,
        pct: hp.max > 0 ? (hp.value / hp.max) * 100 : 0,
      },
      ac: numberText(actor?.attributes?.ac?.value ?? system.attributes?.ac?.value),
      speed: pf2eSpeedSummary(actor),
      initiative: signedMod(actor?.initiative?.statistic?.mod ?? actor?.initiative?.mod ?? system.attributes?.initiative?.totalModifier ?? actor?.perception?.mod ?? system.attributes?.perception?.mod ?? 0),
      initiativeStatistic: String(system.initiative?.statistic ?? "perception"),
      level: numberText(actor?.level ?? system.details?.level?.value ?? system.details?.level),
      prof: pf2eStatsSummary(actor),
      resource: "PF2e",
      abilities: pf2eAbilityScores(actor),
      heroPointsValue: Number(actor?.heroPoints?.value ?? system.resources?.heroPoints?.value ?? 0),
      heroPointsMax: Number(actor?.heroPoints?.max ?? system.resources?.heroPoints?.max ?? 3),
      focusValue: Number(system.resources?.focus?.value ?? 0),
      focusMax: Number(system.resources?.focus?.max ?? 0),
      dyingValue: Number(actor?.attributes?.dying?.value ?? 0),
      dyingMax: Number(actor?.attributes?.dying?.max ?? 4),
      recoveryDc: Number(actor?.attributes?.dying?.recoveryDC ?? 10) + Number(actor?.attributes?.dying?.value ?? 0),
      woundedValue: Number(actor?.attributes?.wounded?.value ?? 0),
      woundedMax: Number(actor?.attributes?.wounded?.max ?? 3),
      doomedValue: Number(actor?.attributes?.doomed?.value ?? 0),
      doomedMax: Number(actor?.attributes?.doomed?.max ?? 4)
    };
  },
  groups(actor) {
    const normalized = asArray(actor?.items).map((item) => normalizePf2eItem(item));
    const strikes = asArray(actor?.system?.actions).map(normalizePf2eStrike);
    const checks = [];
    for (const [key, skill] of Object.entries(actor?.skills ?? actor?.system?.skills ?? {})) {
      checks.push({
        kind: "skill",
        key,
        name: skill?.label ?? key.toUpperCase(),
        badge: "Skill",
        category: "skills",
        formula: d20Formula(skill?.mod ?? skill?.total ?? 0),
        ability: String(skill?.attribute ?? skill?.statistic?.attribute ?? skill?.check?.attribute ?? "")
      });
    }
    const saveAbilities = { fortitude: "con", fort: "con", reflex: "dex", ref: "dex", will: "wis" };
    for (const [key, save] of Object.entries(actor?.saves ?? actor?.system?.saves ?? {})) {
      checks.push({
        kind: "save",
        key,
        name: save?.label ?? key.toUpperCase(),
        badge: "Save",
        category: "saves",
        formula: d20Formula(save?.mod ?? save?.total ?? 0),
        ability: String(save?.attribute ?? saveAbilities[String(key).toLowerCase()] ?? "")
      });
    }
    if (actor?.perception) {
      checks.unshift({ kind: "perception", key: "perception", name: "Perception", badge: "Perception", category: "checks", formula: d20Formula(actor.perception.mod ?? 0), ability: "wis" });
    }
    const actionItems = normalized.filter((item) => {
      if (item.type === "spell") return item.usable === true;
      if (["action", "feat"].includes(item.type)) return item.activation !== "passive";
      return false;
    });
    const actions = [...strikes, ...actionItems];
    return {
      actions,
      actionGroups: groupPf2eActions(actions),
      spells: normalized.filter((item) => item.type === "spell"),
      features: normalized.filter(itemIsFeatureType),
      inventory: normalized.filter((item) => {
        if (!["weapon", "armor", "shield", "equipment", "consumable", "backpack", "treasure", "ammo"].includes(item.type)) return false;
        return !(item.type === "treasure" && item.pf2e?.itemCategory === "coin");
      }),
      spellSlots: pf2eSpellSlots(actor),
      checks
    };
  },
  spellSlotChoices(actor, item) {
    return pf2eSpellSlotChoices(actor, item);
  },
  targetInfo(item) {
    return pf2eTargetInfo(item);
  },
  rangeFeet(item) {
    return pf2eRangeFeet(item);
  },
  canUseItem(actor, item) {
    return item?.type === "spell" ? pf2eSpellCanCast(actor, item) : normalizePf2eItem(item).usable !== false;
  },
  currencyEntries(actor) {
    return pf2eCurrencyEntries(actor);
  },
  async useItem(actor, item, options = {}) {
    if (item?.type === "spell") {
      const entry = pf2eSpellcastingEntry(actor, item);
      const rank = Number(options.castLevel ?? pf2eSpellRank(item));
      if (entry && typeof entry.cast === "function") return entry.cast(item, { rank: Number.isFinite(rank) ? rank : pf2eSpellRank(item) });
      if (typeof item?.toMessage === "function") return item.toMessage(null, { data: { castRank: rank } });
    }
    if (item?.type === "consumable" && typeof item?.consume === "function") return item.consume();
    const slug = String(item?.slug ?? item?.system?.slug ?? "");
    const systemAction = slug ? game.pf2e?.actions?.[slug] ?? game.pf2e?.actions?.get?.(slug) : null;
    if (typeof systemAction === "function") return systemAction({ actors: [actor] });
    if (typeof item?.use === "function") return item.use();
    if (["action", "feat"].includes(item?.type) && Number(item.system?.frequency?.value ?? 0) > 0) {
      await item.update({ "system.frequency.value": Number(item.system.frequency.value) - 1 });
    }
    if (typeof item?.toMessage === "function") return item.toMessage();
    if (typeof item?.roll === "function") return item.roll();
    return GENERIC_ADAPTER.useItem(actor, item);
  },
  async rollCheck(actor, kind, key) {
    const event = pf2eSyntheticRollEvent();
    const rollArgs = { event, skipDialog: true };
    if (kind === "initiative" && typeof actor?.initiative?.roll === "function") {
      const statistic = String(key || actor.system?.initiative?.statistic || "perception");
      if (statistic !== String(actor.system?.initiative?.statistic ?? "perception")) {
        await actor.update({ "system.initiative.statistic": statistic });
      }
      return actor.initiative.roll(rollArgs);
    }
    if (kind === "perception" && typeof actor?.perception?.roll === "function") return actor.perception.roll(rollArgs);
    if (kind === "recovery" && typeof actor?.rollRecovery === "function") return actor.rollRecovery(event);
    const source = kind === "save" ? (actor.saves ?? actor.system?.saves) : (actor.skills ?? actor.system?.skills);
    const entry = source?.[key];
    if (typeof entry?.roll === "function") return entry.roll(rollArgs);
    if (typeof entry?.check?.roll === "function") return entry.check.roll(rollArgs);
    const statistic = actor?.getStatistic?.(key);
    if (typeof statistic?.roll === "function") return statistic.roll(rollArgs);
    if (typeof statistic?.check?.roll === "function") return statistic.check.roll(rollArgs);
    return GENERIC_ADAPTER.rollCheck(actor, kind, key);
  },
  async rest(actor, options = {}) {
    const rest = game.pf2e?.actions?.restForTheNight;
    if (typeof rest !== "function") throw new Error("PF2e Rest for the Night is unavailable.");
    return rest({ actors: [actor], ...options });
  },
  async toggleEquipped(actor, item, equipped) {
    if (typeof actor?.changeCarryType !== "function") throw new Error("PF2e carry controls are unavailable.");
    const usage = item?.system?.usage ?? {};
    if (equipped) {
      const carryType = usage.type === "held" ? "held" : "worn";
      return actor.changeCarryType(item, {
        carryType,
        handsHeld: carryType === "held" ? Number(usage.hands ?? 1) || 1 : 0,
        inSlot: carryType === "worn" && !!usage.where
      });
    }
    return actor.changeCarryType(item, { carryType: "worn", handsHeld: 0, inSlot: false });
  },
  async setCarry(actor, item, options = {}) {
    if (typeof actor?.changeCarryType !== "function") throw new Error("PF2e carry controls are unavailable.");
    return actor.changeCarryType(item, {
      carryType: String(options.carryType ?? "worn"),
      handsHeld: clamp(Number(options.handsHeld ?? 0) || 0, 0, 2),
      inSlot: options.inSlot === true
    });
  },
  async updateCurrency(actor, denomination, delta) {
    const coins = { [denomination]: Math.abs(Number(delta ?? 0)) };
    if (delta > 0 && typeof actor?.inventory?.addCoins === "function") return actor.inventory.addCoins(coins);
    if (delta < 0 && typeof actor?.inventory?.removeCoins === "function") {
      const removed = await actor.inventory.removeCoins(coins);
      if (!removed) ui.notifications?.warn?.("Not enough currency.");
      return removed;
    }
  },
  async executeStrike(actor, data = {}) {
    const strike = pf2eFindStrike(actor, data);
    if (!strike) throw new Error("PF2e strike not found.");
    const operation = String(data.operation ?? "attack");
    const event = pf2eSyntheticRollEvent({ dialogType: operation === "attack" ? "check" : "damage" });
    if (operation === "damage" && typeof strike.damage === "function") return strike.damage({ event });
    if (operation === "critical" && typeof strike.critical === "function") return strike.critical({ event });
    const variant = strike.variants?.[Number(data.variantIndex ?? 0)] ?? strike.variants?.[0];
    if (typeof variant?.roll !== "function") throw new Error("PF2e strike attack is unavailable.");
    return variant.roll({ event, skipDialog: true });
  },
  async nativeItemRoll(_actor, item, action, options = {}) {
    const castRank = Number(options.castRank ?? pf2eSpellRank(item));
    const variant = Number.isFinite(castRank) && typeof item?.loadVariant === "function"
      ? item.loadVariant({ castRank }) ?? item
      : item;
    const event = pf2eSyntheticRollEvent({ castRank, dialogType: action === "spellDamage" ? "damage" : "check" });
    if (action === "spellAttack" && typeof variant?.rollAttack === "function") return variant.rollAttack(event, Number(options.attackNumber ?? 1) || 1);
    if (action === "spellDamage" && typeof variant?.rollDamage === "function") return variant.rollDamage(event);
    throw new Error("PF2e item roll is unavailable.");
  },
  TABS: mergeTabs(GENERIC_ADAPTER.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/pf2e/stats-view.hbs",
    },
    { key: "actions" },
    { key: "rolls" },
    { key: "spells" },
    { key: "inventory" },
    { key: "map" },
  ]),
};

export const PF2E_ACTIONS = {
  pf2eRest: requestRest,
};

export function pf2eAbilityScores(actor) {
  const source = actor?.system?.abilities ?? actor?.abilities ?? {};
  return Object.entries(source).slice(0, 6).map(([key, data]) => ({
    key,
    label: localizedFieldLabel(data?.label ?? globalThis.CONFIG?.PF2E?.abilities?.[key], key),
    score: numberText(data?.value ?? data?.score),
    mod: signedMod(data?.mod ?? data?.modifier ?? 0),
    icon: abilityDisplayIcon(key),
  }));
}

export function pf2eSpeedSummary(actor) {
  const speeds = actor?.system?.movement?.speeds ?? {};
  const order = ["land", "burrow", "climb", "fly", "swim"];
  const entries = Object.entries(speeds)
    .filter(([type, speed]) => type !== "travel" && Number(speed?.value ?? speed) > 0)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
    });
  if (!entries.length) {
    const legacy = actor?.system?.attributes?.speed;
    const land = Number(legacy?.value ?? legacy?.total ?? 0);
    if (land > 0) entries.push(["land", { value: land }]);
    for (const speed of asArray(legacy?.otherSpeeds)) {
      if (Number(speed?.value ?? 0) > 0) entries.push([String(speed.type ?? "other"), speed]);
    }
  }
  return entries.map(([type, speed]) => {
    const rawLabel = speed?.label ?? `PF2E.Actor.Speed.Type.${capitalizeWords(type)}`;
    const label = localizedFieldLabel(rawLabel, type === "land" ? "Land" : type);
    return `${label} ${Number(speed?.value ?? speed)} ft`;
  }).join(" | ") || "-";
}

export function pf2eInitiativeOptions(actor) {
  const options = [{
    key: "perception",
    label: localize("PF2E.PerceptionLabel"),
    mod: Number(actor?.perception?.mod ?? actor?.getStatistic?.("perception")?.mod ?? 0)
  }];
  for (const skill of Object.values(actor?.skills ?? {})) {
    const key = String(skill?.slug ?? "").trim();
    if (!key || options.some((option) => option.key === key)) continue;
    options.push({
      key,
      label: localizedFieldLabel(skill?.label, key),
      mod: Number(skill?.mod ?? skill?.check?.mod ?? 0)
    });
  }
  return options.sort((a, b) => {
    if (a.key === "perception") return -1;
    if (b.key === "perception") return 1;
    return a.label.localeCompare(b.label);
  });
}


export function pf2eStatsSummary(actor) {
  const perception = actor?.perception?.mod ?? actor?.system?.perception?.mod;
  const classDc = actor?.getStatistic?.("class")?.dc?.value
    ?? actor?.system?.attributes?.classDC?.value
    ?? actor?.system?.attributes?.classOrSpellDC?.value;
  const parts = [];
  if (Number.isFinite(Number(perception))) parts.push(`Perception ${signedMod(perception)}`);
  if (Number.isFinite(Number(classDc))) parts.push(`Class DC ${Number(classDc)}`);
  return parts.join("  ") || "PF2e";
}

export function pf2eActionCost(item) {
  const direct = item?.actionCost;
  if (direct && typeof direct === "object") {
    const type = String(direct.type ?? "action").toLowerCase();
    const value = type === "free" ? 0 : Number(direct.value ?? 1);
    return { type, value: Number.isFinite(value) ? value : 1 };
  }
  if (item?.type === "spell") {
    const time = String(item?.actionGlyph ?? item?.system?.time?.value ?? "").trim().toLowerCase();
    if (/^[1-3]$/.test(time)) return { type: "action", value: Number(time) };
    if (["r", "reaction"].includes(time)) return { type: "reaction", value: 1 };
    if (["f", "free"].includes(time)) return { type: "free", value: 0 };
  }
  const type = String(item?.system?.actionType?.value ?? item?.system?.actionType ?? "").toLowerCase();
  if (!type || type === "passive") return null;
  const value = type === "free" ? 0 : Number(item?.system?.actions?.value ?? item?.system?.actions ?? 1);
  return { type, value: Number.isFinite(value) ? value : 1 };
}

export function pf2eActivationKey(item) {
  const cost = pf2eActionCost(item);
  if (!cost) return "passive";
  if (cost.type === "reaction") return "reaction";
  if (cost.type === "free") return "free";
  return `action${clamp(Number(cost.value ?? 1), 1, 3)}`;
}

export function pf2eActionCostLabel(item) {
  const cost = pf2eActionCost(item);
  if (!cost) return "Passive";
  if (cost.type === "reaction") return "Reaction";
  if (cost.type === "free") return "Free Action";
  const value = clamp(Number(cost.value ?? 1), 1, 3);
  return `${value} Action${value === 1 ? "" : "s"}`;
}

export function pf2eTraits(item) {
  const values = item?.system?.traits?.value;
  if (values instanceof Set) return Array.from(values).map(String);
  return asArray(values).map(String);
}

export function pf2eIsCantrip(item) {
  return item?.isCantrip === true || pf2eTraits(item).includes("cantrip");
}

export function pf2eIsFocusSpell(item) {
  return item?.isFocusSpell === true || pf2eTraits(item).includes("focus");
}

export function pf2eIsRitual(item) {
  return item?.isRitual === true || pf2eTraits(item).includes("ritual");
}

export function pf2eSpellRank(item) {
  const rank = Number(item?.rank ?? item?.baseRank ?? item?.system?.level?.value ?? item?.system?.level ?? 0);
  return Number.isFinite(rank) ? rank : 0;
}

export function pf2eSpellcastingEntry(actor, item) {
  if (!actor || !item) return null;
  if (item.spellcasting) return item.spellcasting;
  const entryId = String(item.system?.location?.value ?? "");
  return actor.spellcasting?.get?.(entryId) ?? actor.items?.get?.(entryId) ?? null;
}

export function pf2eSpellSlotEntries(entry, rank) {
  const slot = entry?.system?.slots?.[`slot${Number(rank)}`];
  if (!slot) return [];
  const prepared = slot.prepared;
  if (Array.isArray(prepared)) return prepared;
  if (prepared?.contents && Array.isArray(prepared.contents)) return prepared.contents;
  return Object.values(prepared ?? {});
}

export function pf2eSpellSlotChoices(actor, item) {
  if (!actor || item?.type !== "spell") return [];
  const entry = pf2eSpellcastingEntry(actor, item);
  const baseRank = Math.max(0, Number(item.baseRank ?? pf2eSpellRank(item)) || 0);
  const castRank = Math.max(baseRank, pf2eSpellRank(item));
  const focusCost = Number(item.system?.cast?.focusPoints ?? 0);
  if (pf2eIsCantrip(item) || pf2eIsRitual(item) || item.atWill || focusCost > 0 || pf2eIsFocusSpell(item)) return [];
  if (!entry) return castRank > 0 ? [{ level: castRank, value: 1, max: 1, label: `Rank ${castRank}` }] : [];

  if (entry.isInnate) {
    const uses = item.system?.location?.uses ?? {};
    const value = Number(uses.value ?? 0);
    const max = Number(uses.max ?? value);
    return [{
      level: castRank,
      value: Number.isFinite(value) ? value : 0,
      max: Number.isFinite(max) ? max : value,
      label: `Rank ${castRank} (${Number.isFinite(value) ? value : 0}/${Number.isFinite(max) ? max : value})`
    }];
  }

  const choices = [];
  const slots = entry.system?.slots ?? {};
  for (let rank = Math.max(1, baseRank); rank <= 10; rank += 1) {
    if (entry.isSpontaneous && item.system?.location?.signature !== true && rank !== castRank) continue;
    const slot = slots[`slot${rank}`];
    if (!slot) continue;
    if (entry.isPrepared && !entry.isFlexible) {
      const matching = pf2eSpellSlotEntries(entry, rank).filter((prepared) => String(prepared?.id ?? "") === String(item.id));
      if (!matching.length) continue;
      const value = matching.filter((prepared) => prepared?.expended !== true).length;
      choices.push({ level: rank, value, max: matching.length, label: `Rank ${rank} (${value}/${matching.length} prepared)` });
      continue;
    }
    const value = Number(slot.value ?? 0);
    const max = Number(slot.max ?? value);
    if ((!Number.isFinite(value) || value <= 0) && (!Number.isFinite(max) || max <= 0)) continue;
    choices.push({
      level: rank,
      value: Number.isFinite(value) ? value : 0,
      max: Number.isFinite(max) ? max : value,
      label: `Rank ${rank} (${Number.isFinite(value) ? value : 0}/${Number.isFinite(max) ? max : value})`
    });
  }
  return choices.sort((a, b) => Number(b.value > 0) - Number(a.value > 0) || a.level - b.level);
}

export function pf2eSpellCanCast(actor, item) {
  if (item?.type !== "spell") return true;
  if (!pf2eSpellcastingEntry(actor, item) && !pf2eIsRitual(item)) return false;
  const focusCost = Number(item.system?.cast?.focusPoints ?? 0);
  if (focusCost > 0) return Number(actor?.system?.resources?.focus?.value ?? 0) >= focusCost;
  if (pf2eIsCantrip(item) || pf2eIsRitual(item) || item.atWill) return true;
  const choices = pf2eSpellSlotChoices(actor, item);
  return !choices.length || choices.some((choice) => Number(choice.value ?? 0) > 0);
}

export function pf2eRangeFeet(item) {
  const direct = Number(item?.maxRange ?? item?.system?.range?.max ?? item?.system?.range);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const text = fieldText(item?.system?.range?.value, item?.system?.range, item?.range);
  const match = String(text).match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i);
  return match ? Number(match[1]) : 0;
}

export function pf2eTargetInfo(item) {
  const target = fieldText(item?.system?.target?.value, item?.system?.target);
  const area = item?.system?.area ?? {};
  const areaText = fieldText(
    area?.value && area?.type ? `${area.value}-foot ${area.type}` : "",
    area?.type
  );
  const description = htmlToPlain(item?.system?.description?.value ?? item?.system?.description ?? "");
  const text = fieldText(target, areaText);
  const lowered = `${text} ${description}`.toLowerCase();
  const selfOnly = /\bself\b/.test(String(target).toLowerCase());
  const numeric = String(target).match(/\b(\d+)\s+(?:willing\s+)?(?:creature|target|ally|enemy|object)s?\b/i);
  let count = Number(numeric?.[1] ?? 0);
  const isAttack = item?.isAttack === true || pf2eTraits(item).includes("attack") || item?.type === "weapon" || item?.type === "melee";
  if (isAttack && count <= 0) count = 1;
  const needsTarget = !selfOnly && (isAttack || !!target || /\btarget\b|\bcreature\b|\benemy\b|\bally\b/.test(lowered));
  const allowSelf = selfOnly || (/\bally\b|\bwilling creature\b/.test(lowered) && !/\bother\b|\banother\b/.test(lowered));
  return {
    count,
    type: target || (isAttack ? "creature" : areaText),
    text,
    needsTarget,
    selfOnly,
    allowSelf
  };
}

export function pf2eSpellDetailRows(item) {
  if (item?.type !== "spell") return [];
  const system = item.system ?? {};
  const rows = [];
  const casting = fieldText(item.actionGlyph && `${item.actionGlyph} actions`, system.time?.value);
  const range = fieldText(system.range?.value, system.range);
  const target = fieldText(system.target?.value, system.target);
  const area = system.area?.value && system.area?.type ? `${system.area.value}-foot ${capitalizeWords(system.area.type)}` : "";
  const duration = fieldText(system.duration?.value, system.duration, system.duration?.sustained ? "Sustained" : "");
  const defense = fieldText(system.defense?.save?.statistic, system.defense?.statistic, system.defense?.label);
  if (casting) rows.push(["Cast", casting]);
  if (range) rows.push(["Range", range]);
  if (target) rows.push(["Targets", target]);
  if (area) rows.push(["Area", area]);
  if (defense) rows.push(["Defense", capitalizeWords(defense)]);
  if (duration) rows.push(["Duration", duration]);
  return rows;
}

export function pf2eUsesText(item) {
  if (item?.type === "spell" && (item.spellcasting?.isInnate || pf2eSpellcastingEntry(item.actor, item)?.isInnate)) {
    const uses = item.system?.location?.uses ?? {};
    const value = Number(uses.value ?? 0);
    const max = Number(uses.max ?? value);
    if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max}`;
  }
  if (item?.type === "spell") {
    const focusCost = Number(item.system?.cast?.focusPoints ?? (pf2eIsFocusSpell(item) ? 1 : 0));
    if (focusCost > 0) {
      const focus = item.actor?.system?.resources?.focus ?? {};
      const value = Number(focus.value ?? 0);
      const max = Number(focus.max ?? value);
      if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max} Focus`;
    }
    const slots = pf2eSpellSlotChoices(item.actor, item);
    if (slots.length) {
      const value = slots.reduce((total, slot) => total + Math.max(0, Number(slot.value ?? 0) || 0), 0);
      const max = slots.reduce((total, slot) => total + Math.max(0, Number(slot.max ?? 0) || 0), 0);
      if (max > 0) return `Uses Available ${value} / ${max} slots`;
    }
  }
  const frequency = item?.system?.frequency;
  if (frequency && Number(frequency.max ?? 0) > 0) {
    const value = Number(frequency.value ?? 0);
    const max = Number(frequency.max ?? 0);
    const interval = fieldText(frequency.per, frequency.interval);
    return `Uses Available ${value} / ${max}${interval ? `, resets ${capitalizeWords(interval)}` : ""}`;
  }
  return itemUsesText(item);
}

export function pf2eCarryState(item) {
  const equipped = item?.system?.equipped ?? {};
  const carryType = String(equipped.carryType ?? "worn");
  const handsHeld = Number(equipped.handsHeld ?? 0);
  const inSlot = equipped.inSlot === true;
  let label = localizedFieldLabel(`PF2E.CarryType.${carryType}`, carryType);
  if (carryType === "held") label = handsHeld === 2 ? "Held (2 hands)" : "Held (1 hand)";
  else if (carryType === "worn" && inSlot) label = "Worn / Equipped";
  else if (carryType === "worn") label = "Carried";
  return { carryType, handsHeld, inSlot, label };
}

export function pf2eItemBadges(item) {
  const badges = [];
  const cost = pf2eActionCostLabel(item);
  if (cost && (item.type === "action" || item.type === "feat" || item.type === "spell")) badges.push(cost);
  const traits = pf2eTraits(item).filter((trait) => !["common", "uncommon", "rare", "unique"].includes(trait));
  badges.push(...traits.slice(0, 2).map(capitalizeWords));
  const range = fieldText(item?.system?.range?.value, Number(item?.system?.range) > 0 ? `${item.system.range} ft` : "");
  if (range) badges.push(range);
  const uses = pf2eUsesText(item);
  if (uses) badges.push(uses);
  const quantity = Number(item?.system?.quantity ?? NaN);
  if (Number.isFinite(quantity) && quantity !== 1) badges.push(`qty ${quantity}`);
  return Array.from(new Set(badges.filter(Boolean))).slice(0, 5);
}

export function normalizePf2eItem(item, group = "items") {
  const normalized = normalizeItem(item, group);
  const system = item?.system ?? {};
  const rank = item?.type === "spell" ? (pf2eIsCantrip(item) ? 0 : pf2eSpellRank(item)) : Number(item?.level ?? system.level?.value ?? system.level ?? 0);
  const entry = item?.type === "spell" ? pf2eSpellcastingEntry(item.actor, item) : null;
  const preparationMode = String(entry?.category ?? entry?.system?.prepared?.value ?? "");
  const slotChoices = item?.type === "spell" ? pf2eSpellSlotChoices(item.actor, item) : [];
  const prepared = preparationMode === "prepared"
    ? slotChoices.length > 0
    : item?.type === "spell";
  const physical = item?.isOfType?.("physical") === true
    || ["weapon", "armor", "shield", "equipment", "consumable", "backpack", "treasure", "ammo"].includes(item?.type);
  const consumable = item?.type === "consumable";
  const actionLike = item?.type === "spell"
    || (["action", "feat"].includes(item?.type) && (!!pf2eActionCost(item) || !!system.selfEffect));
  const usable = item?.type === "spell" ? pf2eSpellCanCast(item.actor, item) : (consumable ? Number(system.quantity ?? 1) > 0 : actionLike);
  const badges = pf2eItemBadges(item);
  const carry = pf2eCarryState(item);
  if (item?.type === "spell" && prepared && !usable) badges.push("Expended");
  return {
    ...normalized,
    level: Number.isFinite(rank) ? rank : 0,
    prepared,
    preparationMode,
    preparationLocked: false,
    canPrepare: false,
    activation: pf2eActivationKey(item),
    actionCostLabel: pf2eActionCostLabel(item),
    rangeFeet: pf2eRangeFeet(item),
    quantity: system.quantity === undefined ? null : Number(system.quantity),
    equippable: physical && !!item?.system?.equipped,
    equipped: item?.isEquipped === true || itemIsEquipped(item),
    usable,
    containerId: String(system.containerId ?? ""),
    ritual: pf2eIsRitual(item),
    concentration: false,
    sustained: system.duration?.sustained === true,
    special: false,
    targetInfo: pf2eTargetInfo(item),
    description: htmlToPlain(system.description?.value ?? system.description ?? ""),
    spellDetails: pf2eSpellDetailRows(item),
    usesText: pf2eUsesText(item),
    badges,
    pf2e: {
      entryId: String(entry?.id ?? system.location?.value ?? ""),
      category: preparationMode,
      itemCategory: String(system.category ?? ""),
      traits: pf2eTraits(item),
      carry
    }
  };
}

export function normalizePf2eStrike(strike, index) {
  const item = strike?.item;
  const variants = asArray(strike?.variants).slice(0, 3).map((variant, variantIndex) => ({
    index: variantIndex,
    label: cleanRulesText(variant?.label ?? (variantIndex === 0 ? "Attack" : `Attack ${variantIndex + 1}`)),
    modifier: Number(variant?.modifier ?? variant?.mod ?? NaN)
  }));
  const rangeFeet = Number(
    item?.maxRange
    ?? (Number(item?.system?.range) > 0 ? Number(item.system.range) * 6 : null)
    ?? item?.actor?.getReach?.({ weapon: item })
    ?? 5
  );
  return {
    id: String(item?.id ?? `strike-${index}`),
    name: cleanRulesText(strike?.label ?? item?.name ?? "Strike"),
    type: "weapon",
    group: "weapon",
    img: item?.img ?? "icons/svg/sword.svg",
    level: 0,
    prepared: true,
    preparationMode: "",
    preparationLocked: false,
    canPrepare: false,
    activation: "action1",
    actionCostLabel: "1 Action",
    rangeFeet: Number.isFinite(rangeFeet) ? rangeFeet : 0,
    quantity: null,
    equippable: false,
    equipped: item?.isEquipped === true,
    usable: strike?.ready !== false,
    containerId: "",
    ritual: false,
    concentration: false,
    sustained: false,
    special: false,
    targetInfo: { count: 1, type: "creature", text: "1 creature", needsTarget: true, selfOnly: false, allowSelf: false },
    description: cleanRulesText(strike?.description ?? item?.system?.description?.value ?? ""),
    spellDetails: [],
    usesText: "",
    badges: [
      "1 Action",
      ...pf2eTraits(item).slice(0, 2).map(capitalizeWords),
      rangeFeet > 0 ? `${rangeFeet} ft` : ""
    ].filter(Boolean),
    pf2eStrike: {
      index,
      slug: String(strike?.slug ?? item?.slug ?? ""),
      itemId: String(item?.id ?? ""),
      variants,
      hasDamage: typeof strike?.damage === "function",
      hasCritical: typeof strike?.critical === "function"
    }
  };
}

export function groupPf2eActions(items) {
  const groups = { action1: [], action2: [], action3: [], reaction: [], free: [], passive: [], other: [] };
  for (const item of items) {
    const key = item.activation;
    if (groups[key]) groups[key].push(item);
    else groups.other.push(item);
  }
  return groups;
}

export function pf2eSpellSlots(actor) {
  const totals = new Map();
  for (const entry of actor?.spellcasting?.contents ?? actor?.spellcasting ?? []) {
    if (!entry?.system?.slots || entry.isFocusPool || entry.isRitual) continue;
    for (let rank = 1; rank <= 10; rank += 1) {
      const slot = entry.system.slots[`slot${rank}`];
      if (!slot) continue;
      let value = Number(slot.value ?? 0);
      let max = Number(slot.max ?? value);
      if (entry.isPrepared && !entry.isFlexible) {
        const prepared = pf2eSpellSlotEntries(entry, rank).filter(Boolean);
        value = prepared.filter((spell) => spell.expended !== true).length;
        max = prepared.length;
      }
      if ((!Number.isFinite(value) || value <= 0) && (!Number.isFinite(max) || max <= 0)) continue;
      const current = totals.get(rank) ?? { value: 0, max: 0 };
      current.value += Number.isFinite(value) ? value : 0;
      current.max += Number.isFinite(max) ? max : 0;
      totals.set(rank, current);
    }
  }
  return Array.from(totals.entries()).map(([rank, slot]) => ({
    key: `rank${rank}`,
    level: rank,
    label: `Rank ${rank}`,
    value: slot.value,
    max: slot.max
  }));
}

export function pf2eCurrencyEntries(actor) {
  const currency = actor?.inventory?.currency;
  if (!currency || typeof currency !== "object") return [];
  return CURRENCY_LABELS
    .filter(([key]) => key !== "ep")
    .map(([key, label]) => [key, label, Number(currency[key] ?? 0)])
    .filter((entry) => Number.isFinite(entry[2]));
}

export function pf2eFindStrike(actor, data = {}) {
  const strikes = asArray(actor?.system?.actions);
  const itemId = String(data.itemId ?? "");
  const slug = String(data.strikeSlug ?? "");
  const index = Number(data.strikeIndex ?? NaN);
  return strikes.find((strike) => itemId && String(strike?.item?.id ?? "") === itemId && (!slug || String(strike?.slug ?? strike?.item?.slug ?? "") === slug))
    ?? (Number.isInteger(index) ? strikes[index] : null)
    ?? null;
}

export function pf2eSyntheticRollEvent(dataset = {}) {
  const target = document.createElement("button");
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined && value !== "") target.dataset[key] = String(value);
  }
  const dialogType = String(dataset.dialogType ?? "check");
  const settings = game.user?.settings ?? {};
  const showDialogs = dialogType === "damage" ? settings.showDamageDialogs === true : settings.showCheckDialogs === true;
  return {
    target,
    currentTarget: target,
    shiftKey: showDialogs,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() { },
    stopPropagation() { }
  };
}

async function requestRest() {
  const actor = this.currentActor;
  if (!actor) return;
  if (setting("combatTurnLock", false) === true && !actorHasActiveTurn(actor)) {
    ui.notifications?.warn?.("It is not this actor's turn.");
    addLog("Turn locked");
    return;
  }

  if (game.users.activeGM) {
    sendSocket("rest", {
      targetUserIds: [game.users.activeGM.id],
      actorId: actor.id,
      restType: "night"
    });
    addLog("Rest for the Night sent to GM");
    showResultToast("Rest request sent", "The GM has the PF2e confirmation.");
    return;
  }

  openModal(`
    <h2>Rest for the Night?</h2>
    <p>PF2e will recover the character according to its Rest for the Night rules.</p>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      <button class="pp-button primary" type="button" data-modal-action="confirmRest">Rest</button>
    </div>
  `, {
    confirmRest: async () => {
      closeModal();
      await executePlayerFirst(
        "Rest for the Night",
        async () => PF2E_ADAPTER.rest(actor, { skipDialog: true }),
        "rest",
        { actorId: actor.id, restType: "night" }
      );
    }
  });
}