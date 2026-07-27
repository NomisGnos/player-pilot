function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (collection instanceof Map) return Array.from(collection.values());
  if (typeof collection.values === "function") return Array.from(collection.values());
  return typeof collection === "object" ? Object.values(collection) : [];
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function localize(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const translated = globalThis.game?.i18n?.localize?.(text);
  return translated && translated !== text ? translated : text;
}

function recoveryPeriodLabel(period) {
  const key = String(period ?? "").trim();
  if (!key) return "";
  const configured = globalThis.CONFIG?.DND5E?.limitedUsePeriods?.[key]?.label;
  const configuredLabel = localize(configured);
  if (configuredLabel && configuredLabel !== configured) return configuredLabel;
  return ({
    lr: "Long Rest",
    longrest: "Long Rest",
    "long rest": "Long Rest",
    sr: "Short Rest",
    shortrest: "Short Rest",
    "short rest": "Short Rest",
    day: "Day",
    dawn: "Dawn",
    dusk: "Dusk",
    initiative: "Initiative",
    turnstart: "Start of Turn",
    turnend: "End of Turn",
    turn: "Each Turn",
    recharge: "Recharge"
  })[key.toLowerCase()] ?? titleCase(key);
}

function recoveryText(uses = {}) {
  const recovery = valuesOf(uses.recovery);
  const periods = recovery
    .map((entry) => recoveryPeriodLabel(entry?.period ?? entry))
    .filter(Boolean);
  if (!periods.length && uses.per) periods.push(recoveryPeriodLabel(uses.per));
  const unique = Array.from(new Set(periods));
  if (unique.length === 1 && ["Short Rest", "Long Rest"].includes(unique[0])) {
    return `Reset with ${unique[0]} on the Stats page`;
  }
  return unique.length ? `Resets after ${unique.join(" or ")}` : "";
}

function usePoolEntry(label, uses = {}, kind = "uses") {
  const max = numeric(uses.max);
  const explicitValue = numeric(uses.value);
  const spent = numeric(uses.spent);
  const available = Number.isFinite(explicitValue)
    ? explicitValue
    : (Number.isFinite(max) && Number.isFinite(spent) ? Math.max(0, max - spent) : NaN);
  if ((!Number.isFinite(max) || max <= 0) && !Number.isFinite(available)) return null;
  const value = Number.isFinite(max) && max > 0
    ? `${Number.isFinite(available) ? available : max} / ${max} available`
    : `${available} available`;
  return {
    kind,
    label: String(label ?? "Uses"),
    value,
    reset: recoveryText(uses)
  };
}

function actorItem(actor, id) {
  const wanted = String(id ?? "").trim();
  if (!actor || !wanted) return null;
  const direct = actor.items?.get?.(wanted);
  if (direct) return direct;
  const finalId = wanted.split(".").filter(Boolean).at(-1) ?? wanted;
  return valuesOf(actor.items).find((candidate) => (
    String(candidate?.id ?? candidate?._id ?? "") === wanted
    || String(candidate?.id ?? candidate?._id ?? "") === finalId
    || String(candidate?.uuid ?? "") === wanted
    || String(candidate?.system?.identifier ?? candidate?.identifier ?? "") === wanted
  )) ?? null;
}

function propertyAt(source, path) {
  const parts = String(path ?? "").replace(/^system\./, "").split(".").filter(Boolean);
  let current = source?.system ?? source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function ordinal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const mod100 = number % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[number % 10] ?? "th";
  return `${number}${suffix}`;
}

function activityData(activity) {
  if (!activity || typeof activity !== "object") return {};
  return activity.system && typeof activity.system === "object" ? activity.system : activity;
}

/**
 * Build player-facing resource context strictly from the live D&D5e item,
 * activity, actor resource, and spell-slot data supplied by Foundry.
 */
export function dnd5eResourceDetails(subject, { actor = null, item = null } = {}) {
  const activity = subject?.item || subject?.consumption || subject?.system?.consumption ? subject : null;
  item ??= activity?.item ?? (subject?.system ? subject : null);
  actor ??= activity?.actor ?? item?.actor ?? null;
  const data = activityData(activity);
  const details = [];
  const consumedTypes = new Set();
  const add = (entry) => {
    if (!entry?.label || !entry?.value) return;
    const key = `${entry.kind}|${entry.label}|${entry.value}|${entry.reset ?? ""}`;
    if (!details.some((existing) => existing._key === key)) details.push({ ...entry, _key: key });
  };

  const targets = valuesOf(data?.consumption?.targets);
  const legacyConsume = data?.consume ?? item?.system?.consume;
  if (!targets.length && legacyConsume?.type) {
    const legacyType = ({
      charges: "itemUses",
      attribute: "attribute"
    })[String(legacyConsume.type).toLowerCase()] ?? legacyConsume.type;
    targets.push({
      type: legacyType,
      target: legacyConsume.target ?? "",
      value: legacyConsume.amount ?? "1"
    });
  }
  for (const target of targets) {
    const type = String(target?.type ?? target?.kind ?? "").toLowerCase();
    consumedTypes.add(type);
    if (type === "activityuses") {
      add(usePoolEntry(activity?.name ?? data?.name ?? item?.name ?? "Activity uses", data.uses ?? activity?.uses, "activity"));
    } else if (type === "itemuses") {
      const resourceItem = target?.target ? actorItem(actor, target.target) : item;
      add(usePoolEntry(resourceItem?.name ?? item?.name ?? "Item uses", resourceItem?.system?.uses, "item"));
    } else if (type === "material") {
      const resourceItem = actorItem(actor, target?.target);
      const quantity = numeric(resourceItem?.system?.quantity);
      if (resourceItem && Number.isFinite(quantity)) {
        add({ kind: "material", label: resourceItem.name, value: `${quantity} available`, reset: "" });
      }
    } else if (type === "attribute") {
      const targetPath = String(target?.target ?? "");
      const pathParts = targetPath.replace(/^system\./, "").split(".").filter(Boolean);
      const leaf = pathParts.at(-1);
      const parentPath = pathParts.slice(0, -1).join(".");
      const parent = parentPath ? propertyAt(actor, parentPath) : null;
      const current = propertyAt(actor, targetPath);
      const value = numeric(current?.value ?? current);
      const max = numeric(current?.max ?? (leaf === "value" ? parent?.max : NaN));
      const labelKey = ["value", "max", "spent"].includes(leaf) ? pathParts.at(-2) : leaf;
      if (Number.isFinite(value)) {
        add({
          kind: "attribute",
          label: String(parent?.label ?? titleCase(labelKey || "Resource")),
          value: Number.isFinite(max) && max > 0 ? `${value} / ${max} available` : `${value} available`,
          reset: ""
        });
      }
    }
  }

  if (!consumedTypes.has("activityuses")) {
    add(usePoolEntry(activity?.name ?? data?.name ?? item?.name ?? "Activity uses", data?.uses ?? activity?.uses, "activity"));
  }
  if (!consumedTypes.has("itemuses")) add(usePoolEntry(item?.name ?? "Item uses", item?.system?.uses, "item"));

  const itemType = String(item?.type ?? "").toLowerCase();
  const spellLevel = numeric(item?.system?.level ?? item?.system?.rank);
  const preparationMode = String(
    item?.system?.method
    ?? item?.system?.preparation?.mode
    ?? item?.system?.preparation?.preparedMode
    ?? ""
  ).toLowerCase();
  const hasLimitedPool = details.some((entry) => ["activity", "item", "attribute", "material"].includes(entry.kind));
  if (itemType === "spell" && spellLevel === 0 && !hasLimitedPool) {
    add({ kind: "cantrip", label: "Cantrip", value: "Unlimited casting", reset: "No spell slot required" });
  } else if (itemType === "spell" && ["atwill", "at-will"].includes(preparationMode) && !hasLimitedPool) {
    add({ kind: "spell", label: "At-will spell", value: "Unlimited casting", reset: "No spell slot required" });
  }

  if (itemType === "spell" && spellLevel > 0 && consumedTypes.has("spellslots")) {
    const slots = actor?.system?.spells?.[`spell${spellLevel}`];
    const value = numeric(slots?.value);
    const max = numeric(slots?.max);
    if (Number.isFinite(value) || Number.isFinite(max)) {
      add({
        kind: "slot",
        label: `${ordinal(spellLevel)}-level spell slot`,
        value: Number.isFinite(max) && max > 0 ? `${Number.isFinite(value) ? value : 0} / ${max} available` : `${value} available`,
        reset: "Reset with Long Rest on the Stats page"
      });
    }
  }

  const activation = String(
    data?.activation?.type
    ?? activity?.activation?.type
    ?? item?.system?.activation?.type
    ?? item?.system?.actionType
    ?? ""
  ).toLowerCase();
  if (activation === "reaction") {
    add({ kind: "reaction", label: "Timing", value: "Reaction", reset: "This is an out-of-turn action" });
  }

  return details.map(({ _key, ...entry }) => entry);
}
