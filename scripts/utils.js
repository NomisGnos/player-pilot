
export function numberText(value, fallback = "-") {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : fallback;
}

export function fieldText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    let text = "";
    if (value instanceof Set) text = Array.from(value).map((entry) => fieldText(entry)).filter(Boolean).join(", ");
    else if (Array.isArray(value)) text = value.map((entry) => fieldText(entry)).filter(Boolean).join(", ");
    else if (typeof value === "object") text = fieldText(value.label, value.value, value.name, value.type, value.id);
    else text = String(value).trim();
    if (/^\[object\s/i.test(text)) continue;
    if (text) return text;
  }
  return "";
}

export function signedMod(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "+0";
  return n > 0 ? `+${n}` : String(n);
}

export function d20Formula(mod) {
  return `d20 ${signedMod(mod)}`;
}

export function localize(key) {
  return game.i18n?.localize?.(key) ?? key;
}

export function localizedFieldLabel(value, fallback = "") {
  const raw = fieldText(value, fallback);
  if (!raw) return "";
  const translated = localize(raw);
  if (translated && translated !== raw) return translated;
  if (/^[A-Z0-9_.-]+$/i.test(raw) && raw.includes(".")) return capitalizeWords(fallback || raw.split(".").pop());
  return capitalizeWords(raw);
}

export function formatUnitValue(value, units = "") {
  const amount = fieldText(value);
  const unit = String(units ?? "").trim();
  if (!amount) return "";
  return `${amount}${unit ? ` ${unit}` : ""}`.trim();
}

export function capitalizeWords(value) {
  return String(value ?? "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function resolveNumericFormula(value, item = null) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const formula = String(value ?? "").trim();
  if (!formula) return NaN;
  try {
    const data = {
      ...(item?.actor?.getRollData?.() ?? {}),
      item: item?.getRollData?.() ?? item?.system ?? {}
    };
    const roll = Roll.create ? Roll.create(formula, data) : new Roll(formula, data);
    const evaluated = roll.evaluateSync ? roll.evaluateSync() : null;
    const total = Number(evaluated?.total ?? NaN);
    if (Number.isFinite(total)) return total;
  } catch (_err) {
    // Leave formula-backed uses hidden if the system cannot evaluate them synchronously.
  }
  return NaN;
}

export function unitLabel(unit) {
  const text = String(unit ?? "").trim();
  if (!text) return "";
  return ({
    action: "Action",
    bonus: "Bonus Action",
    reaction: "Reaction",
    minute: "Minute",
    minutes: "Minutes",
    hour: "Hour",
    hours: "Hours",
    day: "Day",
    days: "Days",
    ft: "Feet",
    feet: "Feet",
    mi: "Miles",
    mile: "Mile",
    miles: "Miles",
    self: "Self",
    touch: "Touch",
    spec: "Special",
    special: "Special",
    inst: "Instantaneous",
    instantaneous: "Instantaneous",
    round: "Round",
    rounds: "Rounds",
    turn: "Turn",
    turns: "Turns",
    perm: "Permanent"
  })[text.toLowerCase()] ?? capitalizeWords(text);
}

export function formatActionTime(source = {}) {
  const cost = fieldText(source.cost, source.value, source.number);
  const type = unitLabel(fieldText(source.type, source.unit, source.units));
  if (cost && type) return `${cost} ${type}`;
  return fieldText(source.label, type);
}

export function formatRangeInfo(source = {}) {
  const value = fieldText(source.value, source.distance, source.normal);
  const unit = unitLabel(fieldText(source.units, source.unit));
  const special = fieldText(source.special, source.label);
  if (value && unit) return `${value} ${unit}`;
  return fieldText(special, source.type);
}

export function formatTargetInfo(source = {}) {
  const affects = source.affects ?? {};
  const template = source.template ?? source.area ?? {};
  const count = fieldText(affects.count, source.count, source.value, source.quantity);
  const type = fieldText(affects.type, source.type, template.type);
  const templateSize = fieldText(template.size, template.value, template.distance);
  const templateUnits = unitLabel(fieldText(template.units, template.unit));
  const templateText = templateSize && templateUnits ? `${templateSize} ${templateUnits} ${unitLabel(template.type)}` : "";
  if (count && type) return `${count} ${unitLabel(type)}`;
  return fieldText(templateText, unitLabel(type), source.label, source.special);
}

export function formatDurationInfo(source = {}) {
  const value = fieldText(source.value, source.duration);
  const unit = unitLabel(fieldText(source.units, source.unit, source.type));
  const special = fieldText(source.special, source.label);
  if (source.concentration === true && value && unit) return `Concentration, up to ${value} ${unit}`;
  if (value && unit) return `${value} ${unit}`;
  if (source.concentration === true) return "Concentration";
  return fieldText(special, unit);
}

export function asArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (collection instanceof Map) return Array.from(collection.values());
  if (typeof collection.values === "function") return Array.from(collection.values());
  return Object.values(collection);
}

export function hasItemProperty(item, key) {
  const props = item?.system?.properties;
  const wanted = String(key ?? "").toLowerCase();
  if (!props || !wanted) return false;
  if (typeof props.has === "function") return props.has(wanted);
  if (Array.isArray(props)) return props.some((entry) => String(entry).toLowerCase() === wanted);
  if (typeof props === "object") return props[wanted] === true;
  return false;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function htmlToPlain(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value ?? "");
  return cleanRulesText(div.textContent ?? "");
}

export function readableReferenceLabel(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "Linked Reference";
  const last = text.split(/[.#]/).filter(Boolean).pop() ?? text;
  const cleaned = decodeURIComponent(last).replace(/[-_]/g, " ").trim();
  if (!cleaned || /^[a-z0-9]{12,}$/i.test(cleaned)) return "Linked Reference";
  return cleaned;
}

export function cleanFoundrySyntax(value) {
  return String(value ?? "")
    .replace(/\[\[(?:\/[a-z]+\s+)?([^\]]+)\]\]/gi, (_m, formula) => String(formula ?? "").replace(/\s+#.*$/, "").trim())
    .replace(/@[A-Za-z][A-Za-z0-9.]*\[([^\]]+)\](?:\{([^}]+)\})?/g, (_m, raw, label) => label || readableReferenceLabel(raw))
    .replace(/\{[a-z]+:[^}]+\}/gi, "");
}

export function cleanRulesText(value) {
  return cleanFoundrySyntax(value)
    .replace(/\s+/g, " ")
    .trim();
}

export function mergeTabs(baseTabs, overrideTabs) {
  const baseMap = new Map(baseTabs.map(t => [t.key, foundry.utils.deepClone(t)]));
  return overrideTabs.map(override => {
    const base = baseMap.get(override.key);
    if (!base) {
      return foundry.utils.deepClone(override);
    }

    return foundry.utils.mergeObject(override, base, { overwrite: false });
  });
}