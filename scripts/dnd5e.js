import { BaseModel } from "./base-model.js";
import {
  actorHasActiveTurn,
  addLog,
  attackRollMode,
  executePlayerFirst,
  queueRender,
  renderInterfaceIcon,
  setting
} from "./player-pilot.js";
import {
  asArray,
  capitalizeWords,
  clamp,
  cleanRulesText,
  d20Formula,
  escapeHtml,
  fieldText,
  formatActionTime,
  formatDurationInfo,
  formatRangeInfo,
  formatTargetInfo,
  hasItemProperty,
  htmlToPlain,
  itemDisplayName,
  mergeTabs,
  normalizedFormula,
  numberText,
  resolveNumericFormula,
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

const DND5E_CURRENCY_LABELS = [
  ["pp", "Platinum"],
  ["gp", "Gold"],
  ["ep", "Electrum"],
  ["sp", "Silver"],
  ["cp", "Copper"]
];

export class DnD5eModel extends BaseModel {

  static id = "dnd5e";
  static label = "D&D5e";

  static pendingCastLevels = [];

  static TABS = mergeTabs(BaseModel.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/dnd5e/stats-view.hbs",
    },
    { key: "actions" },
    { key: "rolls" },
    { key: "spells" },
    { key: "inventory" },
    { key: "map" },
  ]);

  static SHELL_ACTIONS = {
    exhaustion: async function (_event, button) {
      await game.playerPilot.model.updateExhaustion(Number(button.dataset.delta ?? 0));
    },
    dnd5eRest: async function (_event, button) {
      await game.playerPilot.model.requestRest(button.dataset.rest);
    },
    rollInitiative: async function (_event, _button) {
      await game.playerPilot.model.rollCheck("initiative", "initiative");
    },
    togglePrepared: async function (_event, button) {
      await game.playerPilot.model.togglePrepared(button.dataset.itemId);
    },
    currencyDialog: function (_event, button) {
      game.playerPilot.model.openCurrencyDialog(button.dataset.denom);
    },
    toggleEquipped: async function (_event, button) {
      const itemId = button.dataset.itemId;
      const actor = this.currentActor;
      const item = actor?.items.get(itemId);
      if (!actor || !item) return;

      const equippable = game.playerPilot.model.itemIsEquippable(item);
      if (!equippable) return;

      const next = !game.playerPilot.model.itemIsEquipped(item);
      await executePlayerFirst(
        next ? "Equipped item" : "Unequipped item",
        async () => item.update({ "system.equipped": next }),
        "updateItemData",
        { actorId: actor.id, itemId, updates: { "system.equipped": next }, label: next ? "Equipped item" : "Unequipped item" }
      );
      queueRender();
    },
  };

  constructor() {
    super();

    Hooks.on("renderDialog", this.applyPendingCastLevel);
  }

  refreshSummary() {
    super.refreshSummary();

    if (!this.actor) {
      return;
    }

    const system = this.actor.system;

    const hp = system.attributes.hp;
    const movement = system.attributes?.movement ?? {};
    const walk = fieldText(movement.walk && `${movement.walk} ft`, movement.fly && `${movement.fly} fly`);
    const level = Number(system.details?.level ?? this.getDndTotalLevel(this.actor) ?? 0);
    const exhaustion = this.readExhaustionValue(this.actor);
    const death = this.actor._source?.system?.attributes?.death ?? system.attributes?.death ?? {};
    const deathText = `Successes ${Number(death.success ?? 0)}, Failures ${Number(death.failure ?? 0)}`;


    this.summary.hp = {
      display: `${numberText(hp.value)} / ${numberText(hp.max)}`,
      value: hp.value,
      max: hp.max,
      temp: hp.temp,
      tempWidth: clamp((hp.temp / Math.max(hp.max || hp.temp, 1)) * 100, 5, 100),
      pct: hp.max > 0 ? (hp.value / hp.max) * 100 : 0,
    };

    this.summary.hitDice = this.hitDiceText();
    this.summary.ac = numberText(system.attributes?.ac?.value);
    this.summary.speed = walk || "-";
    this.summary.initiative = signedMod(system.attributes?.init?.total ?? system.attributes?.init?.mod ?? 0);
    this.summary.level = Number.isFinite(level) && level > 0 ? String(level) : "-";
    this.summary.prof = signedMod(system.attributes?.prof);
    this.summary.exhaustion = Number.isFinite(exhaustion) ? `Level ${exhaustion}` : "Level 0";
    this.summary.exhaustionValue = Number.isFinite(exhaustion) ? exhaustion : 0;
    this.summary.death = deathText;
    this.summary.deathSuccess = Number(death.success ?? 0);
    this.summary.deathFailure = Number(death.failure ?? 0);

    this.refreshAbilityScores();

    this.refreshStatCards();
  }

  hitDiceText() {
    const hd = this.actor.system.attributes.hd;
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

  refreshAbilityScores(actor) {
    const abilities = actor?.system?.abilities ?? {};
    this.summary.abilities = DND5E_ABILITIES.map(([key, label]) => ({
      key,
      label,
      score: numberText(abilities?.[key]?.value),
      mod: signedMod(abilities?.[key]?.mod),
      icon: this.abilityDisplayIcon(key),
    }));
  }

  refreshStatCards() {
    this.summary.statCards = [
      { key: "ac", icon: "fa-shield-halved", label: "Armor Class", value: this.summary.ac },
      { key: "speed", icon: "fa-person-running", label: "Speed", value: this.summary.speed },
      { key: "level", icon: "fa-star", label: "Level", value: this.summary.level ?? this.summary.resource ?? "-" },
      { key: "prof", icon: "pp-die-d20", label: "Proficiency", value: this.summary.prof ?? this.summary.resource ?? "-" },
    ];
  }

  refreshGroupsImpl(items) {
    super.refreshGroupsImpl(items);

    const byId = new Map(items.map((item) => [item.id, item]));
    items.forEach((item) => {
      if (item.containerId && byId.has(item.containerId)) item.containerName = byId.get(item.containerId).name;
    });

    this.groups.spells = items.filter((item) => item.type === "spell").sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

    this.refreshActionsGroup(items);
    this.refreshFeaturesGroup(items);
    this.refreshSpellSlotsGroup();
    this.refreshChecksGroup();
    this.refreshCurrencyGroup();
  }

  refreshActionsGroup(items) {
    this.groups.actions = items.filter(this.itemBelongsInActions);
    this.groups.actionGroups = {
      action: [],
      bonus: [],
      reaction: [],
      passive: [],
      other: []
    };

    for (const action of this.groups.actions) {
      const key = String(action.activation ?? "").toLowerCase();
      if (key === "action") this.groups.actionGroups.action.push(action);
      else if (key === "bonus") this.groups.actionGroups.bonus.push(action);
      else if (key === "reaction") this.groups.actionGroups.reaction.push(action);
      else if (["none", "passive"].includes(key)) this.groups.actionGroups.passive.push(action);
      else this.groups.actionGroups.other.push(action);
    }
  }

  itemIsFeatureType(item) {
    const featureTypes = new Set(["feat", "action", "class", "subclass", "classfeature", "race", "background", "ancestry", "heritage"]);
    return featureTypes.has(item?.type);
  }

  refreshFeaturesGroup(items) {
    this.groups.features = items.filter(this.itemIsFeatureType);
  }

  refreshSpellSlotsGroup() {
    const spells = this.actor.system.spells ?? {};
    this.groups.spellSlots = [];
    for (let level = 1; level <= 9; level += 1) {
      const slot = spells[`spell${level}`];
      const value = Number(slot?.value ?? 0);
      const max = Number(slot?.max ?? slot?.override ?? 0);
      if ((!Number.isFinite(max) || max <= 0) && (!Number.isFinite(value) || value <= 0)) continue;
      this.groups.spellSlots.push({
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
      this.groups.spellSlots.push({
        key: "pact",
        level: Number(pact.level ?? 0),
        label: `Pact Level ${Number(pact.level ?? 0) || "?"}`,
        value: Number(pact.value ?? 0),
        max: pactMax
      });
    }
  }

  refreshChecksGroup() {
    this.groups.checks = [];

    const abilities = this.actor.system.abilities;
    for (const [key, label] of DND5E_ABILITIES) {
      const ability = abilities?.[key] ?? {};
      this.groups.checks.push({ kind: "abilityCheck", key, name: `${label} Check`, label, badge: "Ability", category: "checks", formula: d20Formula(ability.mod), ability: key });
      this.groups.checks.push({
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

    const skills = this.actor.system.skills;
    for (const [key, data] of Object.entries(skills)) {
      this.groups.checks.push({
        kind: "skill",
        key,
        name: data?.label ?? DND5E_SKILL_LABELS[key] ?? key,
        badge: "Skill",
        category: "skills",
        formula: d20Formula(data?.total ?? data?.mod),
        ability: String(data?.ability ?? data?.abilityKey ?? data?.baseAbility ?? "")
      });
    }
  }

  refreshCurrencyGroup() {
    this.groups.currency = [];
    const currency = this.actor?.system?.currency;
    if (!currency) return;
    const ordered = [];
    for (const [key, label] of DND5E_CURRENCY_LABELS) {
      if (Object.prototype.hasOwnProperty.call(currency, key)) ordered.push({
        key,
        label,
        icon: renderInterfaceIcon(this.currencyIcon(key)),
        value: Number(currency[key] ?? 0)
      });
    }
    for (const [key, value] of Object.entries(currency)) {
      if (ordered.some((existing) => existing.key === key)) continue;
      const label = key.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      ordered.push({
        key,
        label,
        icon: renderInterfaceIcon(this.currencyIcon(key)),
        value: Number(value ?? 0)
      });
    }
    this.groups.currency = ordered.filter((entry) => Number.isFinite(entry.value));
  }

  normalizeItem(item, group = "items") {
    const normalized = super.normalizeItem(item, group);

    const system = item.system;
    normalized.level = Number(system.level ?? system.rank ?? 0);
    normalized.prepared = this.spellPreparedValue(item);
    normalized.preparationMode = this.spellMethod(item);
    normalized.preparationLocked = item?.type === "spell"
      && (normalized.level === 0 || this.spellAlwaysPrepared(item) || ["always", "atwill", "innate"].includes(normalized.preparationMode));
    normalized.canPrepare = item.type === "spell" && normalized.preparationMode && !normalized.preparationLocked;
    normalized.activation = this.getItemActivationType(item);
    normalized.rangeFeet = this.getItemRangeFeet(item);
    normalized.usesText = this.itemUsesText(item);
    normalized.containerId = String(system.container ?? system.containerId ?? system.location?.value ?? "");
    normalized.ritual = !!(system.components?.ritual || hasItemProperty(item, "ritual"));
    normalized.concentration = this.itemRequiresConcentration(item);
    normalized.special = this.itemIsSpecialFeature(item);
    normalized.spellDetails = this.spellDetailRows(item);

    return normalized;
  }

  itemIsEquippable(item) {
    const type = String(item?.type ?? "").toLowerCase();
    const system = item?.system ?? {};
    if (!["weapon", "equipment", "armor", "tool"].includes(type)) return false;
    return Object.prototype.hasOwnProperty.call(system, "equipped");
  }

  itemIsEquipped(item) {
    const equipped = item?.system?.equipped;
    if (typeof equipped === "boolean") return equipped;
    if (equipped && typeof equipped === "object") {
      if (typeof equipped.value === "boolean") return equipped.value;
      if (typeof equipped.carryType === "string") return equipped.carryType.toLowerCase() === "equipped";
    }
    return false;
  }

  itemCanBeUsed(item) {
    if (!item) return false;
    if (item.type === "spell") return this.spellIsReady(item);
    if (this.itemIsEquippable(item)) return this.itemIsEquipped(item);
    return true;
  }

  itemNeedsAmmo(item) {
    if (!item) return false;
    const system = item.system;
    const text = `${item.name} ${system.type?.value ?? ""} ${system.type?.subtype ?? ""} ${system.weaponType ?? ""}`.toLowerCase();
    if (hasItemProperty(item, "ammunition") || hasItemProperty(item, "amm")) return true;
    if (system.ammunition || system.consume?.type === "ammo" || system.consume?.target) return true;
    if (/\b(bow|crossbow|firearm|sling|blowgun|pistol|rifle|musket)\b/.test(text)) return true;
    return this.getItemActivities(item).some((activity) => {
      const consumption = activity?.consumption ?? {};
      const targets = Array.isArray(consumption.targets) ? consumption.targets : Object.values(consumption.targets ?? {});
      return String(consumption.type ?? "").toLowerCase().includes("ammo")
        || targets.some((target) => String(target?.type ?? target?.kind ?? "").toLowerCase().includes("ammo"));
    });
  }

  itemTargetInfo(item, activityId = "") {
    const targetInfo = super.itemTargetInfo(item, activityId);
    if (!item) return targetInfo;

    const selected = activityId ? this.selectedItemActivity(item, activityId)?.activity : null;
    const activities = this.getItemActivities(item);
    const candidates = selected
      ? [selected.system, item.system]
      : [item.system, ...activities.map(this.activitySystem)];

    targetInfo.count = 0;
    targetInfo.countSource = "";
    targetInfo.type = "";
    targetInfo.selfOnly = false;
    targetInfo.hasAreaTemplate = false;

    for (const source of candidates) {
      const target = source?.target ?? {};
      const affects = target.affects ?? {};
      const nextType = fieldText(affects.type, target.type, target.template?.type, target.area?.type);
      const nextCount = Number(affects.count ?? target.count ?? target.value ?? 0);
      if (nextType) targetInfo.type = nextType;
      if (Number.isFinite(nextCount) && nextCount > 0) {
        targetInfo.count = Math.max(targetInfo.count, nextCount);
        targetInfo.countSource = "structured";
      }
      const lowered = String(nextType ?? "").toLowerCase();
      if (lowered.includes("self")) targetInfo.selfOnly = true;
      if (fieldText(target.template?.type, target.area?.type)) targetInfo.hasAreaTemplate = true;
    }
    const isWeaponAttack = item.type === "weapon" || this.getItemActivities(item).some((activity) => String(this.activitySystem(activity)?.type ?? activity?.type ?? "").toLowerCase() === "attack");
    if (isWeaponAttack && targetInfo.count <= 0) {
      targetInfo.count = 1;
      targetInfo.countSource = "weapon";
    }
    if (isWeaponAttack && !targetInfo.type) targetInfo.type = "creature";

    const description = htmlToPlain(item.system.description?.value ?? item.system.description ?? "").toLowerCase();
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
    const singularTargetType = new RegExp(`\\b${targetNoun}\\b`, "i").test(targetInfo.type);

    if (targetInfo.count <= 0 && singularTargetType && explicitSingular && !explicitMultiple && !targetCountScales && !targetInfo.hasAreaTemplate) {
      targetInfo.count = 1;
      targetInfo.countSource = "description";
    }

    targetInfo.statedCount = targetInfo.count;

    targetInfo.limitKnown = targetInfo.count > 0 && !targetCountScales;
    if (!targetInfo.limitKnown) targetInfo.count = 0;

    targetInfo.allowSelf = targetInfo.selfOnly || (
      /(creature|ally|willing)/i.test(targetInfo.type)
      && !/(enemy|hostile)/i.test(targetInfo.type)
      && !/\b(other|another) creature\b/i.test(description)
    );

    targetInfo.needsTarget = !targetInfo.selfOnly && (isWeaponAttack || targetInfo.statedCount > 0 || /(creature|enemy|ally|allies|enemies|object|objects|token)/i.test(targetInfo.type));
    targetInfo.text = targetInfo.limitKnown && targetInfo.count > 0 && targetInfo.type ? `${targetInfo.count} ${targetInfo.type}` : capitalizeWords(targetInfo.type);
    targetInfo.limitReason = targetCountScales ? "Target count changes with cast level." : "";

    return targetInfo;
  }

  itemBadges(item) {
    if (!item) return [];
    const system = item.system;
    const badges = [];
    const spellRows = item.type === "spell" ? Object.fromEntries(this.spellDetailRows(item).map(([label, value]) => [label, value])) : {};
    const activation = fieldText(spellRows["Casting Time"], system.activation?.type, system.actionType);
    const range = fieldText(spellRows.Range, this.itemRangeLabel(item));
    const target = fieldText(spellRows.Target, system.target?.affects?.type, system.target?.type, system.target?.value);
    const qty = system.quantity;
    const featureType = ["feat", "class", "subclass", "background", "race", "ancestry", "heritage", "classfeature", "action"].includes(item?.type)
      ? fieldText(system.type?.subtype, system.type?.value, system.category, system.requirements)
      : "";
    if (activation) badges.push(activation);
    else if (item.type && item.type !== "spell" && item.type !== "weapon") badges.push("Passive");
    if (range) badges.push(range);
    if (target) badges.push(target);
    if (featureType) badges.push(featureType);
    const useText = this.itemUsesText(item);
    if (useText) badges.push(useText);
    if (qty !== undefined && Number(qty) !== 1) badges.push(`qty ${qty}`);
    return badges.slice(0, 4);
  }

  itemUsesText(item) {
    if (!item) return "";
    const system = item.system;
    const uses = system.uses;
    if (!uses || typeof uses !== "object") return "";
    const spent = Number(uses.spent ?? NaN);
    const max = resolveNumericFormula(uses.max, item);
    const explicitValue = Number(uses.value ?? NaN);
    const value = Number.isFinite(explicitValue)
      ? explicitValue
      : (Number.isFinite(max) && Number.isFinite(spent) ? Math.max(0, max - spent) : NaN);
    const recovery = this.restRecoveryLabel(
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

  itemHasActionTiming(item) {
    const timingTypes = new Set(["action", "bonus", "reaction", "bonus action"]);
    const activation = String(item?.activation ?? "").toLowerCase();
    return timingTypes.has(activation);
  }

  itemBelongsInActions(item) {
    if (!item) return false;
    if (item.type === "spell") return item.usable === true;
    if (item.equippable) return item.equipped === true;
    if (game.playerPilot.model.itemIsFeatureType(item)) {
      return item.special === true || item.ammoRequired === true || !!item.usesText || game.playerPilot.model.itemHasActionTiming(item);
    }
    return ["consumable", "tool", "equipment"].includes(item.type);
  }

  isInventoryItem(item) {
    return ["weapon", "equipment", "consumable", "tool", "loot", "backpack"].includes(item.type);
  }

  itemIsSpecialFeature(item) {
    if (!this.itemIsFeatureType(item)) return false;
    const sources = [item?.system, ...this.getItemActivities(item).map(this.activitySystem)];
    return sources.some((source) => {
      const activation = String(source?.activation?.type ?? source?.actionType ?? source?.type ?? "").toLowerCase();
      const rangeUnits = String(source?.range?.units ?? source?.range?.unit ?? source?.range?.type ?? "").toLowerCase();
      return activation === "special"
        || ["spec", "special"].includes(rangeUnits)
        || source?.special === true;
    }) || hasItemProperty(item, "special");
  }

  getItemRangeFeet(item, activityId = "") {
    const selected = activityId ? this.selectedItemActivity(item, activityId)?.activity : null;
    const sources = selected ? [this.activitySystem(selected), item?.system] : [item?.system, ...this.getItemActivities(item).map(this.activitySystem)];
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

  itemRangeLabel(item) {
    const sources = [item?.system, ...this.getItemActivities(item).map(this.activitySystem)];
    for (const source of sources) {
      const label = fieldText(formatRangeInfo(source?.range ?? {}), source?.range?.label);
      if (label && !/^(?:ft|feet|foot|mi|mile|miles)$/i.test(label)) return label;
    }
    return "";
  }

  activitySystem(activity) {
    if (!activity || typeof activity !== "object") return {};
    return activity.system && typeof activity.system === "object" ? activity.system : activity;
  }

  getItemActivities(item) {
    const raw = item?.system?.activities;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.contents)) return raw.contents;
    if (typeof raw.values === "function") return Array.from(raw.values());
    return Object.values(raw);
  }

  quickFiltersForKey(view) {
    const quickFilters = {
      actions: [
        ["all", "All", "fa-layer-group"],
        ["weapon", "Weapons", "fa-sword"],
        ["spell", "Spells", "fa-wand-magic-sparkles"],
        ["item", "Items", "fa-flask"],
        ["feature", "Class Features", "fa-star"]
      ],
      actionTiming: [
        ["all", "All Actions", "fa-layer-group"],
        ["action", "Action", "fa-bolt"],
        ["bonus", "Bonus Action", "fa-circle-plus"],
        ["reaction", "Reaction", "fa-reply"]
      ],
      actionSpellTraits: [
        ["all", "All Spells", "fa-wand-magic-sparkles"],
        ["concentration", "Concentration", "fa-brain"],
        ["ritual", "Ritual", "fa-book-open"]
      ],
      spells: [
        ["all", "All"],
        ["cantrip", "Cantrip"],
        ["prepared", "Prepared"],
        ["concentration", "Concentration"],
        ["ritual", "Ritual"]
      ],
      features: [
        ["all", "All", "fa-layer-group"],
        ["feat", "Features", "fa-star"],
        ["class", "Class", "fa-graduation-cap"],
        ["race", "Race", "fa-users"],
        ["background", "Background", "fa-scroll"]
      ],
      inventory: [
        ["all", "All", "fa-layer-group"],
        ["weapon", "Weapons", "fa-sword"],
        ["equipment", "Equipment", "fa-shield-halved"],
        ["consumable", "Consumables", "fa-flask"],
        ["backpack", "Containers", "fa-box-open"],
        ["quantity", "Has Quantity", "fa-hashtag"]
      ]
    };
    return quickFilters[view] ?? [];
  }

  matchesOneQuickFilter(key, filter, item) {
    if (filter === "cantrip") return item.type === "spell" && Number(item.level ?? 0) === 0;
    if (filter === "prepared") { return item.type === "spell" && (item.prepared || Number(item.level ?? 0) === 0 || ["always", "atwill", "innate", "pact"].includes(item.preparationMode)); }
    if (filter === "focus") return item.type === "spell" && item.preparationMode === "focus";
    if (filter === "spontaneous") return item.type === "spell" && item.preparationMode === "spontaneous";
    if (filter === "innate") return item.type === "spell" && item.preparationMode === "innate";
    if (filter === "sustained") return item.sustained === true;
    if (filter === "concentration") return item.concentration === true;
    if (filter === "ritual") return item.ritual === true;
    if (key === "actionTiming") return item.activation === filter;
    if (key === "actionSpellTraits") {
      if (filter === "concentration") return item.concentration === true;
      if (filter === "sustained") return item.sustained === true;
      return item.ritual === true;
    }
    if (filter === "equipment") return ["equipment", "armor", "shield"].includes(item.type);
    if (filter === "ammo") return item.type === "ammo";
    if (filter === "backpack") return ["backpack", "container"].includes(item.type) || !!item.containerName;
    if (key === "features" && ["class", "ancestry", "skill", "general"].includes(filter)) {
      return item.type === filter || (filter === "ancestry" && item.type === "heritage");
    }
    if (key === "actions" && filter === "item") return ["consumable", "tool", "equipment", "loot"].includes(item.type);
    if (key === "actions" && filter === "feature") return ["feat", "class", "subclass", "classfeature", "action", "race", "background"].includes(item.type);
    if (item.activation === filter) return true;
    return super.matchesOneQuickFilter(key, filter, item);
  }

  isTabAvailable(tab) {
    if (tab.key === "powers") {
      return this.groups.powers.groups.length;
    }
    return super.isTabAvailable(tab);
  }

  async useItem(actor, item, options = {}) {
    if (typeof item?.use === "function") {
      const useOptions = { legacy: false };
      const level = Number.parseInt(options.castLevel, 10);
      if (item.type === "spell" && Number.isFinite(level) && level > 0) {
        this.queuePendingCastLevel(item.name, level);
        useOptions.level = level;
        useOptions.spellLevel = level;
        useOptions.slotLevel = level;
        useOptions.castLevel = level;
      }
      const scaling = item.type === "spell" ? this.dndSpellScalingIncrease(actor, item, Number.isFinite(level) ? level : options.castLevel) : 0;
      if (scaling > 0) useOptions.scaling = scaling;
      if (options.ammoItemId) {
        useOptions.ammunition = options.ammoItemId;
        useOptions.ammo = options.ammoItemId;
      }
      if (options.replaceConcentrationEffectId) {
        await this.endActorConcentration(actor, options.replaceConcentrationEffectId);
        useOptions.concentration = {
          begin: true,
          end: String(options.replaceConcentrationEffectId)
        };
      }
      const selected = this.selectedItemActivity(item, options.activityId);
      if (selected?.activity && typeof selected.activity.use === "function") {
        return selected.activity.use(useOptions);
      }
      return item.use(useOptions);
    }

    const selected = this.selectedItemActivity(item, options.activityId);
    if (selected?.activity && typeof selected.activity.use === "function") return selected.activity.use({ legacy: false });
    if (typeof item?.use === "function") return item.use({ legacy: false });
    if (typeof item?.roll === "function") return item.roll();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> uses <strong>${escapeHtml(item.name)}</strong>.</p>`
    });
  }

  spellSlotChoices(item) {
    if (!this.actor || item?.type !== "spell") return [];
    const base = Number(item.system.level ?? 0);
    if (!Number.isFinite(base) || base <= 0) return [];
    const choices = [];
    const spells = this.actor.system.spells ?? {};
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
  }

  concentrationWarning(item) {
    if (item?.type !== "spell" || !this.itemRequiresConcentration(item)) return "";
    const active = this.actorConcentrationEffects(this.actor)[0];
    return active
      ? `This will replace concentration on ${this.concentrationEffectLabel(active)}.`
      : "This uses concentration.";
  }

  actorConcentrationEffects() {
    const tracked = asArray(this.actor?.concentration?.effects)
      .filter((effect) => effect?.disabled !== true && effect?.isSuppressed !== true);
    if (tracked.length) return tracked;
    return asArray(this.actor?.effects).filter(this.isConcentrationEffect);
  }

  isConcentrationEffect(effect) {
    if (!effect || effect.disabled === true || effect.isSuppressed === true) return false;
    const statuses = asArray(effect.statuses).map((status) => String(status ?? "").toLowerCase());
    const statusId = String(effect.flags?.core?.statusId ?? "").toLowerCase();
    const name = String(effect.name ?? effect.label ?? "").toLowerCase();
    return statuses.some((status) => status.includes("concentrat"))
      || statusId.includes("concentrat")
      || name.includes("concentrat");
  }

  itemRequiresConcentration(item) {
    if (!item) return false;
    const system = item.system;
    if (system.components?.concentration === true || system.components?.con === true) return true;
    if (system.duration?.concentration === true || String(system.duration?.units ?? "").toLowerCase() === "concentration") return true;
    if (system.properties?.concentration === true || system.properties?.con === true) return true;
    if (hasItemProperty(item, "concentration") || hasItemProperty(item, "con")) return true;
    return this.getItemActivities(item).some((activity) => {
      const duration = activity?.duration ?? activity?.activation?.duration ?? {};
      return duration?.concentration === true || String(duration?.units ?? "").toLowerCase() === "concentration";
    });
  }

  concentrationEffectLabel(effect) {
    const actor = this.actor;
    if (!actor || !effect) return false;
    const itemData = effect.getFlag("dnd5e", "item");
    const itemName = fieldText(
      itemData?.data?.name,
      actor.items?.get?.(itemData?.id)?.name
    );
    if (itemName) return itemName;
    const effectName = fieldText(effect.name, effect.label, "an active spell");
    return effectName.replace(/^concentrat(?:ing|ion)\s*:\s*/i, "") || "an active spell";
  }

  async endActorConcentration(effectId) {
    const actor = this.actor;
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


  async togglePrepared(itemId) {
    const actor = this.actor;
    const item = actor?.items.get(itemId);
    const model = game.playerPilot.model;
    if (!actor || !item || item.type !== "spell") return;
    if (model.normalizeItem(item).preparationLocked) {
      ui.notifications?.info?.(`${itemDisplayName(item)} is always available and cannot be unprepared.`);
      return;
    }
    const nextPrepared = !model.spellPreparedValue(item);
    if (nextPrepared) {
      const preparation = model.spellPreparationSummary(model.groups.spells ?? []);
      if (preparation && Number.isFinite(preparation.max) && preparation.value >= preparation.max) {
        ui.notifications?.warn?.(`Prepared spell maximum reached: ${preparation.value} / ${preparation.max}. Unprepare a spell before preparing another.`);
        return;
      }
    }
    await executePlayerFirst(
      nextPrepared ? "Prepare spell" : "Unprepare spell",
      async () => item.update(model.preparedUpdateData(item, nextPrepared)),
      "prepareSpell",
      { actorId: actor.id, itemId, prepared: nextPrepared }
    );
    queueRender();
  }

  spellPreparedValue(item) {
    const system = item?.system ?? {};
    if (Object.prototype.hasOwnProperty.call(system, "prepared")) return Number(system.prepared) > 0 || system.prepared === true;
    return this.legacySpellPreparation(item)?.prepared === true;
  }

  legacySpellPreparation(item) {
    return item?._source?.system?.preparation ?? {};
  }

  preparedUpdateData(item, prepared) {
    if (Object.prototype.hasOwnProperty.call(item?.system ?? {}, "prepared")) return { "system.prepared": prepared ? 1 : 0 };
    return { "system.prepared": prepared };
  }

  spellPreparationSummary(normalizedSpells = []) {
    const actor = this.actor;
    if (!actor) return null;
    const classes = asArray(actor.items).filter((item) => item.type === "class");
    const preparationClasses = classes.filter((item) => Number(item.system?.spellcasting?.preparation?.max ?? 0) > 0);
    const max = preparationClasses.reduce((total, item) => total + Number(item.system?.spellcasting?.preparation?.max ?? 0), 0);
    const classValue = preparationClasses.reduce((total, item) => total + Number(item.system?.spellcasting?.preparation?.value ?? 0), 0);
    const fallbackValue = normalizedSpells.filter((spell) => spell.canPrepare && spell.prepared).length;
    const value = Number.isFinite(classValue) && classValue > 0 ? classValue : fallbackValue;
    return {
      value,
      max: Number.isFinite(max) && max > 0 ? max : null
    };
  }

  spellAlwaysPrepared(item) {
    const system = item?.system ?? {};
    const configuredValue = Number(CONFIG?.DND5E?.spellPreparationStates?.always?.value ?? 2);
    if (Number(system.prepared) === configuredValue) return true;
    return String(this.legacySpellPreparation(item)?.mode ?? "").toLowerCase() === "always";
  }

  dndSpellScalingIncrease(actor, item, castLevel = "") {
    const baseLevel = Number(item?.system?.level ?? item?.system?.rank ?? 0);
    if (!Number.isFinite(baseLevel)) return 0;
    if (baseLevel <= 0) return this.dndCantripScalingIncrease(actor, item);
    const level = Number(castLevel ?? 0);
    if (Number.isFinite(level) && level > baseLevel) return level - baseLevel;
    const flagged = Number(item?.getFlag?.("dnd5e", "scaling") ?? item?.flags?.dnd5e?.scaling ?? NaN);
    return Number.isFinite(flagged) && flagged > 0 ? flagged : 0;
  }

  dndCantripScalingIncrease(actor, item) {
    const systemLevel = Number(actor?.system?.cantripLevel?.(item));
    const level = Number.isFinite(systemLevel) && systemLevel > 0
      ? systemLevel
      : Number(actor?.system?.details?.level ?? this.getDndTotalLevel(actor) ?? 0);
    return Math.max(0, Math.floor(((Number.isFinite(level) ? level : 0) + 1) / 6));
  }

  spellMethod(item) {
    const system = item?.system ?? {};
    if (Object.prototype.hasOwnProperty.call(system, "method")) return String(system.method ?? "").toLowerCase();
    const legacy = this.legacySpellPreparation(item);
    return String(legacy?.mode ?? legacy?.preparedMode ?? "").toLowerCase();
  }

  spellIsReady(item) {
    if (item?.type !== "spell") return true;
    const level = Number(item.system?.level ?? item.system?.rank ?? 0);
    const mode = this.spellMethod(item);
    const hasPreparedFlag = Object.prototype.hasOwnProperty.call(item.system ?? {}, "prepared")
      || Object.prototype.hasOwnProperty.call(this.legacySpellPreparation(item), "prepared");
    const prepared = this.spellPreparedValue(item);
    if (level === 0) return true;
    if (["always", "atwill", "innate", "pact"].includes(mode)) return true;
    if (!mode && !hasPreparedFlag) return true;
    return prepared;
  }

  spellDetailRows(item) {
    if (item?.type !== "spell") return [];
    const system = item.system ?? {};
    const rows = [];
    const activity = this.getItemActivities(item)[0] ?? {};
    const activityData = this.activitySystem(activity);
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
    const targetInfo = this.itemTargetInfo(item);
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
    const components = this.spellComponentsLabel(item);
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

  spellComponentsLabel(item) {
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

  getDndTotalLevel() {
    return asArray(this.actor?.items)
      .filter((item) => item.type === "class")
      .reduce((total, item) => total + Number(item.system?.levels ?? 0), 0);
  }

  getItemActivationType(item) {
    const direct = String(item?.system?.activation?.type ?? item?.system?.actionType ?? "").toLowerCase();
    if (direct) return direct;
    for (const activity of this.getItemActivities(item)) {
      const type = String(activity?.activation?.type ?? activity?.actionType ?? activity?.type ?? "").toLowerCase();
      if (["action", "bonus", "reaction", "minute", "hour", "special"].includes(type)) return type;
    }
    return "";
  }

  ammoChoices(item) {
    const actor = this.actor;
    if (!actor || !item) return [];
    if (!this.itemNeedsAmmo(item)) return [];
    const wanted = this.ammoKeywordsForItem(item);
    const ammo = asArray(actor.items).filter((candidate) => {
      if (!["consumable", "loot"].includes(candidate.type)) return false;
      const text = `${candidate.name ?? ""} ${candidate.system?.type?.value ?? ""} ${candidate.system?.type?.subtype ?? ""}`.toLowerCase();
      if (!/\b(ammo|ammunition|arrow|bolt|bullet|shot|dart|stone)\b/.test(text)) return false;
      if (!wanted.length) return true;
      return wanted.some((word) => text.includes(word));
    });
    return ammo.map((item) => ({
      id: item.id,
      label: `${item.name} (${Number(item.system.quantity ?? item.system.uses?.value ?? 0)} left)`
    }));
  }

  ammoKeywordsForItem(item) {
    const text = `${item?.name ?? ""} ${item?.system?.type?.value ?? ""} ${item?.system?.type?.subtype ?? ""}`.toLowerCase();
    if (text.includes("crossbow")) return ["bolt"];
    if (text.includes("bow")) return ["arrow"];
    if (text.includes("sling")) return ["stone", "bullet"];
    if (text.includes("blowgun")) return ["dart"];
    if (/(firearm|pistol|rifle|musket|gun)/.test(text)) return ["bullet", "shot"];
    return [];
  }

  itemPlayerChoice(item) {
    const actor = this.actor;
    if (!actor || !item) return null;
    const name = itemDisplayName(item).toLowerCase();
    const description = htmlToPlain(item.system.description?.value ?? item.system.description ?? "").toLowerCase();
    const asksForSkill = name === "guidance"
      || /\b(?:choose|select)\b.{0,80}\b(?:skill|ability check)\b/i.test(description);
    if (asksForSkill) {
      const skills = Object.entries(actor.system.skills ?? {}).map(([key, skill]) => {
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

  usableItemActivities(item) {
    if (!item) return [];
    const premades = item?.flags?.["chris-premades"] ?? {};
    const hiddenValues = new Set(asArray(premades.hiddenActivities).map((value) => String(value ?? "").toLowerCase()));
    const activityIdentifiers = premades.activityIdentifiers ?? {};
    for (const hidden of Array.from(hiddenValues)) {
      const mapped = activityIdentifiers?.[hidden];
      if (mapped) hiddenValues.add(String(mapped).toLowerCase());
    }
    const riders = new Set(asArray(item?.flags?.dnd5e?.riders?.activity).map((value) => String(value ?? "").toLowerCase()));
    const seen = new Set();
    return this.getItemActivities(item)
      .filter((activity) => activity?.canUse !== false)
      .filter((activity) => {
        const data = this.activitySystem(activity);
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
        const data = this.activitySystem(activity);
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

  selectedItemActivity(item, activityId = "") {
    const activities = this.usableItemActivities(item);
    return activities.find((entry) => entry.id === String(activityId ?? "")) ?? activities[0] ?? null;
  }

  collectRollInstructions(item, options = {}) {
    const actor = this.actor;
    const entries = [];
    const system = item?.system ?? {};
    const labels = item?.labels ?? {};
    const itemActivities = this.getItemActivities(item);
    const chosenActivity = options.activityId ? this.selectedItemActivity(item, options.activityId)?.activity : null;
    const chosenAttackMode = chosenActivity ? attackRollMode(actor, chosenActivity) : {};
    const activityHasEffectRolls = (activity) => {
      const data = this.activitySystem(activity);
      const damage = data?.damage ?? {};
      const healing = data?.healing ?? {};
      return !!fieldText(damage.formula, healing.formula)
        || (Array.isArray(damage.parts) ? damage.parts : Object.values(damage.parts ?? {})).length > 0
        || (Array.isArray(healing.parts) ? healing.parts : Object.values(healing.parts ?? {})).length > 0;
    };
    const preferActivityEffects = item?.type === "spell" && itemActivities.some(activityHasEffectRolls);
    const push = (entry) => {
      const effectKind = this.rollEffectKind(entry.kind, entry.label, entry.effectType, entry.activity);
      const next = {
        kind: effectKind,
        label: cleanRulesText(entry.label ?? "Roll"),
        formula: cleanRulesText(this.resolveDisplayFormula(entry.formula ?? "", actor, item, entry.activity)),
        detail: cleanRulesText(entry.detail ?? ""),
        scaled: entry.scaled === true,
        rollMode: String(entry.rollMode ?? ""),
        rollModeReason: cleanRulesText(entry.rollModeReason ?? "")
      };
      if (next.kind === "attack" && next.formula) next.formula = this.applyAttackRollModeFormula(next.formula, next.rollMode);
      if (!next.label || (!next.formula && !next.detail)) return;
      if (next.kind === "damage") {
        const sameFormula = entries.find((existing) => existing.kind === "damage" && existing.formula && next.formula && existing.formula === next.formula);
        if (sameFormula) {
          if (/^damage roll$/i.test(sameFormula.label) && !/^damage roll$/i.test(next.label)) sameFormula.label = next.label;
          return;
        }
      }
      const key = `${next.label}|${next.formula}|${next.detail}`;
      if (!entries.some((existing) => `${existing.label}|${existing.formula}|${existing.detail}` === key)) entries.push(next);
    };
    if (labels.toHit) push({ kind: "attack", label: "Attack Roll", formula: `d20 ${labels.toHit}`, activity: chosenActivity, ...chosenAttackMode });
    if (!preferActivityEffects && labels.damage) push({
      kind: "damage",
      label: "Damage Roll",
      formula: fieldText(labels.damage?.formula, labels.damage),
      effectType: this.damageTypeLabel(labels.damage),
      activity: chosenActivity
    });
    if (!preferActivityEffects && labels.healing) push({ kind: "healing", label: "Healing Roll", formula: fieldText(labels.healing?.formula, labels.healing), activity: chosenActivity });
    if (!preferActivityEffects && Array.isArray(labels.damages)) {
      labels.damages.forEach((damage) => {
        const type = this.damageTypeLabel(damage);
        push({
          kind: "damage",
          label: `${type || "Damage"} Roll`,
          formula: damage?.formula ?? "",
          effectType: type,
          activity: chosenActivity
        });
      });
    }
    const systemDamage = system.damage ?? {};
    const systemDamageParts = Array.isArray(systemDamage.parts) ? systemDamage.parts : Object.values(systemDamage.parts ?? {});
    if (!preferActivityEffects) systemDamageParts.forEach((part) => {
      const formula = Array.isArray(part) ? part[0] : fieldText(part?.formula);
      const type = Array.isArray(part) ? part[1] : this.damageTypeLabel(part);
      push({ kind: "damage", label: `${capitalizeWords(type) || "Damage"} Roll`, formula, effectType: type, activity: chosenActivity });
    });
    if (system.attackBonus) push({ kind: "attack", label: "Attack Roll", formula: `d20 ${signedMod(system.attackBonus)}`, activity: chosenActivity, ...chosenAttackMode });
    const saveDc = this.readSaveDc(system.save?.dc ?? system.activities?.save?.dc ?? actor?.system?.attributes?.spelldc);
    const saveAbility = fieldText(system.save?.ability, system.save?.dc?.ability, system.save?.dc?.label);
    if (saveDc) push({ kind: "save", label: this.savingThrowLabel(saveAbility), detail: `The target must roll against Difficulty Class ${saveDc}.` });
    const selectedActivityId = String(options.activityId ?? "");
    const selectedActivity = selectedActivityId ? this.selectedItemActivity(item, selectedActivityId)?.activity : null;
    const selectedHasEffectRolls = selectedActivity ? activityHasEffectRolls(selectedActivity) : false;
    const instructionActivities = selectedActivity && (!preferActivityEffects || selectedHasEffectRolls) ? [selectedActivity] : itemActivities;
    for (const activity of instructionActivities) {
      const activityData = this.activitySystem(activity);
      const attack = activityData?.attack ?? {};
      const attackMode = attackRollMode(actor, activity);
      if (attack?.bonus || attack?.toHit) push({
        kind: "attack",
        label: "Attack Roll",
        formula: `d20 ${signedMod(attack.bonus ?? attack.toHit)}`,
        activity,
        ...attackMode
      });
      const damage = activityData?.damage ?? {};
      const parts = Array.isArray(damage.parts) ? damage.parts : Object.values(damage.parts ?? {});
      parts.forEach((part) => {
        const rawFormula = Array.isArray(part)
          ? part[0]
          : fieldText(
            part?.formula,
            Number(part?.number) > 0 && Number(part?.denomination) > 0 ? `${part.number}d${part.denomination}${part.bonus ? ` + ${part.bonus}` : ""}` : ""
          );
        const scaledFormula = this.scaleSpellPartFormula(rawFormula, part?.scaling, item, options.castLevel, actor);
        const type = Array.isArray(part) ? part[1] : this.damageTypeLabel(part);
        push({
          kind: "damage",
          label: `${capitalizeWords(type) || "Damage"} Roll`,
          formula: scaledFormula,
          detail: scaledFormula !== rawFormula ? `Cast at Spell Level ${options.castLevel}` : "",
          scaled: scaledFormula !== rawFormula,
          effectType: type,
          activity
        });
      });
      const healing = activityData?.healing ?? {};
      const healingParts = Array.isArray(healing.parts) ? healing.parts : [];
      const rawHealingFormula = fieldText(
        healing.formula,
        Number(healing.number) > 0 && Number(healing.denomination) > 0
          ? `${healing.number}d${healing.denomination}${healing.bonus ? ` + ${healing.bonus}` : ""}`
          : ""
      );
      const scaledHealingFormula = this.scaleSpellPartFormula(rawHealingFormula, healing.scaling, item, options.castLevel, actor);
      if (scaledHealingFormula) push({
        kind: "healing",
        label: "Healing Roll",
        formula: scaledHealingFormula,
        detail: scaledHealingFormula !== rawHealingFormula ? `Cast at Spell Level ${options.castLevel}` : "",
        scaled: scaledHealingFormula !== rawHealingFormula,
        activity
      });
      healingParts.forEach((part) => {
        const rawFormula = Array.isArray(part)
          ? part[0]
          : fieldText(
            part?.formula,
            Number(part?.number) > 0 && Number(part?.denomination) > 0 ? `${part.number}d${part.denomination}${part.bonus ? ` + ${part.bonus}` : ""}` : ""
          );
        const formula = this.scaleSpellPartFormula(rawFormula, part?.scaling, item, options.castLevel, actor);
        push({
          kind: "healing",
          label: "Healing Roll",
          formula,
          detail: formula !== rawFormula ? `Cast at Spell Level ${options.castLevel}` : "",
          scaled: formula !== rawFormula,
          activity
        });
      });
      const save = activityData?.save ?? {};
      const activityDc = this.readSaveDc(save?.dc?.value ?? save?.dc);
      if (activityDc) push({
        kind: "save",
        label: this.savingThrowLabel(fieldText(save.ability, save.dc?.ability)),
        detail: `The target must roll against Difficulty Class ${activityDc}.`
      });
    }
    if (options.sneakAttackFormula) {
      push({
        kind: "damage",
        label: "Sneak Attack Damage",
        formula: String(options.sneakAttackFormula),
        detail: "Apply this extra damage if the Sneak Attack requirements are met."
      });
    }
    this.applyCastLevelScaling(entries, item, options.castLevel);
    if (this.itemRequiresConcentration(item)) push({ kind: "note", label: "Concentration", detail: "This can require concentration after casting." });
    return this.pruneRollInstructions(entries).slice(0, 10);
  }

  rollEffectKind(kind = "roll", label = "", effectType = "", activity = null) {
    const requested = String(kind || "roll").toLowerCase();
    if (!["damage", "healing"].includes(requested)) return requested;
    const activityType = String(this.activitySystem(activity)?.type ?? activity?.type ?? "").toLowerCase();
    const healingSignal = `${fieldText(effectType)} ${fieldText(label)} ${activityType}`.toLowerCase();
    return /\b(?:heal|healing)\b/.test(healingSignal) ? "healing" : requested;
  }

  resolveDisplayFormula(formula, actor, item, activity = null) {
    const raw = String(formula ?? "").trim();
    if (!raw || !raw.includes("@")) return raw;
    const data = {
      ...(actor?.getRollData?.() ?? {}),
      item: item?.getRollData?.() ?? item?.system ?? {},
      ...(activity?.getRollData?.() ?? this.activitySystem(activity)?.rollData ?? {})
    };
    try {
      const replaced = Roll.replaceFormulaData?.(raw, data, { missing: 0, warn: false });
      if (replaced && !replaced.includes("@")) return replaced;
    } catch (_err) {
      // Use the path replacement fallback below.
    }
    return raw.replace(/@([\w.-]+)/g, (match, path) => {
      const value = foundry.utils.getProperty(data, path);
      if (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) return String(value);
      return match;
    });
  }

  async rollCheck(kind, key) {
    const actor = this.actor;
    if (kind === "initiative" && typeof actor.rollInitiative === "function") {
      return actor.rollInitiative({ createCombatants: true });
    }
    if (kind === "deathSave" && typeof actor.rollDeathSave === "function") {
      return actor.rollDeathSave({ legacy: false }, { configure: false });
    }
    if (kind === "skill") {
      if (typeof actor.rollSkill === "function") return actor.rollSkill({ skill: key }, { configure: false });
      const entry = actor.system?.skills?.[key] ?? actor.skills?.[key];
      if (await this.rollActorEntry(entry)) return;
    }
    if (kind === "abilityCheck") {
      if (typeof actor.rollAbilityCheck === "function") return actor.rollAbilityCheck({ ability: key }, { configure: false });
      if (typeof actor.rollAbilityTest === "function") return actor.rollAbilityTest(key, { configure: false });
      const entry = actor.system?.abilities?.[key] ?? actor.abilities?.[key];
      if (await this.rollActorEntry(entry?.check ?? entry)) return;
    }
    if (kind === "abilitySave") {
      if (typeof actor.rollSavingThrow === "function") return actor.rollSavingThrow({ ability: key }, { configure: false });
      if (typeof actor.rollAbilitySave === "function") return actor.rollAbilitySave(key, { configure: false });
      const entry = actor.system?.abilities?.[key] ?? actor.abilities?.[key];
      if (await this.rollActorEntry(entry?.save ?? entry?.savingThrow ?? entry)) return;
    }
    return super.rollCheck(kind, key);
  }

  applyAttackRollModeFormula(formula, rollMode = "") {
    const text = String(formula ?? "");
    if (rollMode === "advantage") return text.replace(/\b(?:1)?d20\b/i, "2d20kh");
    if (rollMode === "disadvantage") return text.replace(/\b(?:1)?d20\b/i, "2d20kl");
    return text;
  }

  damageTypeLabel(source = {}) {
    const direct = fieldText(source?.damageType, source?.type, source?.flavor);
    if (direct && direct !== "[object Object]") return capitalizeWords(direct);
    const types = source?.types ?? source?.damageTypes;
    if (types?.values && typeof types.values === "function") {
      return Array.from(types.values()).map(capitalizeWords).filter(Boolean).join(" + ");
    }
    if (Array.isArray(types)) return types.map(capitalizeWords).filter(Boolean).join(" + ");
    if (types && typeof types === "object") {
      return Object.entries(types)
        .filter(([, enabled]) => enabled === true)
        .map(([type]) => capitalizeWords(type))
        .join(" + ");
    }
    return "";
  }

  readSaveDc(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number" || typeof value === "string") return String(value);
    if (typeof value === "object") {
      return fieldText(value.value, value.dc, value.formula, value.label);
    }
    return "";
  }

  savingThrowLabel(ability) {
    const raw = String(fieldText(ability, "Saving Throw")).toLowerCase();
    const text = DND5E_ABILITIES.find(([key]) => key === raw)?.[1] ?? capitalizeWords(raw);
    return /saving throw/i.test(text) ? text : `${text} Saving Throw`;
  }

  pruneRollInstructions(entries = []) {
    const output = [];
    for (const entry of entries) {
      if (["damage", "healing"].includes(entry.kind) && entry.formula) {
        const dice = this.formulaDiceSides(entry.formula);
        const duplicateIndex = output.findIndex((existing) => {
          if (existing.kind !== entry.kind || !existing.formula) return false;
          const existingDice = this.formulaDiceSides(existing.formula);
          if (!dice.sides || dice.sides !== existingDice.sides) return false;
          const genericPair = this.isGenericRollInstruction(existing) || this.isGenericRollInstruction(entry);
          const sameLabel = this.normalizedRollInstructionLabel(existing.label) === this.normalizedRollInstructionLabel(entry.label);
          const sameFormula = normalizedFormula(existing.formula) === normalizedFormula(entry.formula);
          const augmentedFormula = this.formulaExtends(existing.formula, entry.formula) || this.formulaExtends(entry.formula, existing.formula);
          const scaledPair = sameLabel && (existing.scaled === true || entry.scaled === true);
          return sameFormula || (genericPair && dice.sides === existingDice.sides) || (sameLabel && (augmentedFormula || scaledPair));
        });
        if (duplicateIndex >= 0) {
          const existing = output[duplicateIndex];
          const preferredFormula = this.rollInstructionScore(entry) > this.rollInstructionScore(existing) ? entry : existing;
          const preferredLabel = this.isGenericRollInstruction(existing) && !this.isGenericRollInstruction(entry)
            ? entry.label
            : (!this.isGenericRollInstruction(existing) ? existing.label : entry.label);
          output[duplicateIndex] = {
            ...preferredFormula,
            label: preferredLabel,
            detail: entry.scaled ? entry.detail : (existing.scaled ? existing.detail : preferredFormula.detail),
            scaled: existing.scaled === true || entry.scaled === true
          };
          continue;
        }
      }
      output.push(entry);
    }
    return output;
  }

  scaleSpellPartFormula(formula, scaling, item, castLevel, actor = null) {
    const base = String(formula ?? "").trim();
    const effectiveScaling = scaling ?? item?.system?.scaling ?? {};
    const rawMode = String(effectiveScaling?.mode ?? "").toLowerCase();
    const scalingMode = rawMode === "cantrip" ? "whole" : rawMode;
    if (!base || item?.type !== "spell" || !["whole", "half"].includes(scalingMode)) return base;
    const increase = this.dndSpellScalingIncrease(actor, item, castLevel);
    if (!Number.isFinite(increase) || increase <= 0) return base;
    const steps = scalingMode === "half" ? Math.floor(increase * 0.5) : increase;
    if (steps <= 0) return base;
    const diceMatch = base.match(/^(\d+)\s*d\s*(\d+)(.*)$/i);
    const scalingNumber = Number(effectiveScaling.number ?? 0);
    if (diceMatch && Number.isFinite(scalingNumber) && scalingNumber > 0) {
      return `${Number(diceMatch[1]) + (scalingNumber * steps)}d${diceMatch[2]}${diceMatch[3] ?? ""}`.trim();
    }
    const scalingFormula = String(effectiveScaling.formula ?? "").trim();
    if (scalingFormula) return `${base} + ${steps === 1 ? scalingFormula : `${steps} * (${scalingFormula})`}`;
    return base;
  }


  applyCastLevelScaling(entries, item, castLevel) {
    if (item?.type !== "spell") return;
    const baseLevel = Number(item.system?.level ?? item.system?.rank ?? 0);
    const level = Number(castLevel ?? 0);
    if (!Number.isFinite(baseLevel) || !Number.isFinite(level) || level <= baseLevel) return;
    const scaling = this.spellScalingFormula(item);
    if (!scaling) return;
    const extraLevels = level - baseLevel;
    const extra = extraLevels === 1 ? scaling : `${extraLevels} * (${scaling})`;
    for (const entry of entries) {
      if (!["damage", "healing"].includes(entry.kind) || !entry.formula || entry.scaled) continue;
      if (entry.formula.includes(scaling) && entry.formula.includes("*")) continue;
      entry.formula = `${entry.formula} + ${extra}`;
      entry.detail = `Cast at Spell Level ${level}`;
    }
  }

  spellScalingFormula(item) {
    const system = item?.system ?? {};
    const direct = fieldText(system.scaling?.formula, system.scaling?.damage, system.scaling?.healing);
    if (direct) return direct;
    for (const activity of this.getItemActivities(item)) {
      const data = this.activitySystem(activity);
      const damage = data.damage ?? {};
      const healing = data.healing ?? {};
      const consumption = data.consumption ?? {};
      const formula = fieldText(
        data.scaling?.formula,
        damage.scaling?.formula,
        healing.scaling?.formula,
        consumption.scaling?.formula
      );
      if (formula) return formula;
      const number = Number(data.scaling?.number ?? damage.scaling?.number ?? healing.scaling?.number ?? 0);
      const denomination = Number(data.scaling?.denomination ?? damage.scaling?.denomination ?? healing.scaling?.denomination ?? 0);
      if (Number.isFinite(number) && number > 0 && Number.isFinite(denomination) && denomination > 0) return `${number}d${denomination}`;
    }
    return "";
  }

  formulaExtends(longer, shorter) {
    const a = normalizedFormula(longer);
    const b = normalizedFormula(shorter);
    return a !== b && a.length > b.length && a.includes(b);
  }

  rollInstructionScore(entry = {}) {
    const formula = normalizedFormula(entry.formula);
    const dice = this.formulaDiceSides(formula);
    const hasExtraTerms = /[+\-*/@]/.test(formula.replace(/^[-+]?\d*d\d+/i, ""));
    return (entry.scaled === true ? 1000 : 0)
      + (hasExtraTerms ? 200 : 0)
      + (!this.isGenericRollInstruction(entry) ? 100 : 0)
      + (dice.count * 10)
      + formula.length;
  }

  normalizedRollInstructionLabel(label) {
    return String(label ?? "")
      .toLowerCase()
      .replace(/\b(damage|healing|roll)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  isGenericRollInstruction(entry = {}) {
    return !this.normalizedRollInstructionLabel(entry.label);
  }

  formulaDiceSides(formula) {
    const text = String(formula ?? "");
    const match = text.match(/(\d*)d(\d+)/i);
    return {
      count: Number(match?.[1] || 1),
      sides: Number(match?.[2] || 0)
    };
  }

  async rollActorEntry(entry) {
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

  readExhaustionValue(actor) {
    const raw = actor?._source?.system?.attributes?.exhaustion ?? actor?.system?.attributes?.exhaustion;
    const value = typeof raw === "object" && raw !== null ? raw.value : raw;
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  exhaustionUpdateData(actor, value) {
    const raw = actor?.system?.attributes?.exhaustion;
    if (typeof raw === "object" && raw !== null && Object.prototype.hasOwnProperty.call(raw, "value")) {
      return { "system.attributes.exhaustion.value": value };
    }
    return { "system.attributes.exhaustion": value };
  }

  async updateExhaustion(delta) {
    const actor = this.actor;
    if (!actor || !Number.isFinite(delta) || delta === 0) return;
    const current = this.readExhaustionValue(actor);
    const next = clamp(current + delta, 0, 6);
    const updated = await executePlayerFirst(
      `Exhaustion ${next}`,
      async () => actor.update(this.exhaustionUpdateData(actor, next)),
      "updateActorData",
      { actorId: actor.id, updates: this.exhaustionUpdateData(actor, next), label: `Exhaustion ${next}` }
    );
    if (updated) {
      this.invalidateModelCache();
      queueRender();
      window.setTimeout(() => {
        this.invalidateModelCache();
        queueRender();
      }, 250);
    }
  }

  async requestRest(restType) {
    const actor = this.actor;
    if (!actor) return;
    if (setting("combatTurnLock", false) === true && !actorHasActiveTurn(actor)) {
      ui.notifications?.warn?.("It is not this actor's turn.");
      addLog("Turn locked");
      return;
    }

    const normalized = String(restType).toLowerCase() === "long" ? "long" : "short";
    await executePlayerFirst(
      `${capitalizeWords(normalized)} rest`,
      async () => { this.rest(actor, { restType: normalized }); },
      "rest",
      { actorId: actor.id, restType: normalized }
    );
  }

  rest(actor, data) {
    if (data.restType === "long") return actor.longRest({ dialog: true, chat: true });
    return actor.shortRest({ dialog: true, chat: true });
  }

  async updateCurrency(key, delta) {
    const actor = this.actor;
    if (!actor || !key || !Number.isFinite(delta) || delta === 0) return;
    const currency = this.groups.currency.find(c => c.key === key);
    const current = currency.value;
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, current + delta);
    const label = currency.label;
    await executePlayerFirst(
      `${label} ${next}`,
      async () => actor.update({ [`system.currency.${key}`]: next }),
      "updateActorData",
      { actorId: actor.id, updates: { [`system.currency.${key}`]: next }, label: `${label} ${next}` }
    );
  }

  restRecoveryLabel(value) {
    const text = String(value ?? "").trim();
    const lower = text.toLowerCase();
    if (["sr", "short", "shortrest", "short rest"].includes(lower)) return "Short Rest";
    if (["lr", "long", "longrest", "long rest"].includes(lower)) return "Long Rest";
    return capitalizeWords(text);
  }

  queuePendingCastLevel(itemName, level) {
    const name = String(itemName ?? "").trim().toLowerCase();
    const castLevel = Number.parseInt(level, 10);
    if (!name || !Number.isFinite(castLevel) || castLevel <= 0) return;
    DnD5eModel.pendingCastLevels.push({ name, level: castLevel, at: Date.now() });
    if (DnD5eModel.pendingCastLevels.length > 20) DnD5eModel.pendingCastLevels.splice(0, DnD5eModel.pendingCastLevels.length - 20);
  }

  applyPendingCastLevel(app, html) {
    if (!game.user?.isGM || !DnD5eModel.pendingCastLevels.length) return;
    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;
    const text = `${app?.title ?? ""} ${root.textContent ?? ""}`.toLowerCase();
    if (!text.includes("cast at level") && !text.includes("spell level")) return;
    const now = Date.now();
    for (let index = DnD5eModel.pendingCastLevels.length - 1; index >= 0; index -= 1) {
      if (now - DnD5eModel.pendingCastLevels[index].at > 30000) DnD5eModel.pendingCastLevels.splice(index, 1);
    }
    const index = DnD5eModel.pendingCastLevels.findIndex((entry) => text.includes(entry.name));
    const pending = DnD5eModel.pendingCastLevels[index >= 0 ? index : DnD5eModel.pendingCastLevels.length - 1];
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
      DnD5eModel.pendingCastLevels.splice(DnD5eModel.pendingCastLevels.indexOf(pending), 1);
      return true;
    };
    [0, 60, 150, 350].forEach((delay) => window.setTimeout(apply, delay));
  }
}
