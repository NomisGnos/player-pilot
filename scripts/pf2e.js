import { BaseModel } from "./base-model.js";
import {
  activeGmIds,
  actorHasActiveTurn,
  addLog,
  applyTargetsForCurrentUser,
  clearUseTargets,
  closeModal,
  displayedTargetTokens,
  executePlayerFirst,
  openModal,
  pilotPaused,
  queueRender,
  renderInterfaceIcon,
  renderModalTargetPicker,
  renderRollInstructions,
  selectedTargetSet,
  sendSocket,
  setSelectedTargetSet,
  setting,
  showResultToast,
  state,
  targetInstructionText,
  updateModalTargetCount,
  warnPaused
} from "./player-pilot.js";
import {
  asArray,
  capitalizeWords,
  clamp,
  cleanRulesText,
  d20Formula,
  escapeHtml,
  fieldText,
  formatRangeInfo,
  hasItemProperty,
  htmlToPlain,
  itemDisplayName,
  localize,
  localizedFieldLabel,
  mergeTabs,
  numberText,
  signedMod
} from "./utils.js";


const PF2E_CURRENCY_LABELS = [
  ["pp", "Platinum"],
  ["gp", "Gold"],
  ["sp", "Silver"],
  ["cp", "Copper"]
];

export class PF2eModel extends BaseModel {

  static id = "pf2e";
  static label = "PF2e";

  static TABS = mergeTabs(BaseModel.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/pf2e/stats-view.hbs",
    },
    { key: "actions" },
    { key: "rolls" },
    { key: "spells" },
    { key: "inventory" },
    { key: "map" },
  ]);

  static SHELL_ACTIONS = {
    ...BaseModel.SHELL_ACTIONS,
    pf2eRest: function () {
      game.playerPilot.model.requestRest();
    },
    rollInitiative: function (_event, _button) {
      game.playerPilot.model.openPf2eInitiativeDialog();
    },
    pf2eStrike: function (_event, button) {
      game.playerPilot.model.runPf2eStrike(button.dataset);
    },
  };

  constructor() {
    super();
  }

  refreshSummary() {
    super.refreshSummary();

    if (!this.actor) {
      return;
    }

    const system = this.actor.system;

    const hp = system.attributes.hp;
    this.summary.hp = {
      display: `${numberText(hp.value)} / ${numberText(hp.max)}`,
      value: hp.value,
      max: hp.max,
      temp: hp.temp,
      tempWidth: clamp((hp.temp / Math.max(hp.max || hp.temp, 1)) * 100, 5, 100),
      pct: hp.max > 0 ? (hp.value / hp.max) * 100 : 0,
    };

    this.summary.ac = numberText(this.actor.attributes?.ac?.value ?? system.attributes?.ac?.value);
    this.summary.initiative = signedMod(this.actor.initiative?.statistic?.mod ?? this.actor.initiative?.mod ?? system.attributes?.initiative?.totalModifier ?? this.actor.perception?.mod ?? system.attributes?.perception?.mod ?? 0);
    this.summary.initiativeStatistic = String(system.initiative?.statistic ?? "perception");
    this.summary.level = numberText(this.actor.level ?? system.details?.level?.value ?? system.details?.level);
    this.summary.resource = "PF2e";
    this.summary.heroPointsValue = Number(this.actor.heroPoints?.value ?? system.resources?.heroPoints?.value ?? 0);
    this.summary.heroPointsMax = Number(this.actor.heroPoints?.max ?? system.resources?.heroPoints?.max ?? 3);
    this.summary.focusValue = Number(system.resources?.focus?.value ?? 0);
    this.summary.focusMax = Number(system.resources?.focus?.max ?? 0);
    this.summary.dyingValue = Number(this.actor.attributes?.dying?.value ?? 0);
    this.summary.dyingMax = Number(this.actor.attributes?.dying?.max ?? 4);
    this.summary.recoveryDc = Number(this.actor.attributes?.dying?.recoveryDC ?? 10) + Number(this.actor.attributes?.dying?.value ?? 0);
    this.summary.woundedValue = Number(this.actor.attributes?.wounded?.value ?? 0);
    this.summary.woundedMax = Number(this.actor.attributes?.wounded?.max ?? 3);
    this.summary.doomedValue = Number(this.actor.attributes?.doomed?.value ?? 0);
    this.summary.doomedMax = Number(this.actor.attributes?.doomed?.max ?? 4);

    this.refreshAbilityScores();
    this.refreshProfSummary();
    this.refreshSpeedSummary();

    this.refreshStatCards();
  }

  refreshAbilityScores(actor) {
    const source = actor?.system?.abilities ?? actor?.abilities ?? {};
    return Object.entries(source).slice(0, 6).map(([key, data]) => ({
      key,
      label: localizedFieldLabel(data?.label ?? globalThis.CONFIG?.PF2E?.abilities?.[key], key),
      score: numberText(data?.value ?? data?.score),
      mod: signedMod(data?.mod ?? data?.modifier ?? 0),
      icon: this.abilityDisplayIcon(key),
    }));
  }

  refreshStatCards() {
    this.summary.statCards = [
      { key: "ac", icon: "fa-shield-halved", label: "Armor Class", value: this.summary.ac },
      { key: "speed", icon: "fa-person-running", label: "Speed", value: this.summary.speed },
      { key: "level", icon: "fa-star", label: "Level", value: this.summary.level ?? this.summary.resource ?? "-" },
      { key: "prof", icon: "pp-die-d20", label: "Modifiers", value: this.summary.prof ?? this.summary.resource ?? "-" },
    ];
  }

  refreshGroupsImpl(items) {
    super.refreshGroupsImpl(items);

    this.groups.spells = items.filter((item) => item.type === "spell");

    this.refreshActionsGroup(items);
    this.refreshFeaturesGroup(items);
    this.refreshSpellSlotsGroup();
    this.refreshChecksGroup();
    this.refreshCurrencyGroup();
  }

  refreshActionsGroup(items) {
    const strikes = asArray(this.actor?.system?.actions).map((item, index) => this.normalizePf2eStrike(item, index));
    const actionItems = items.filter((item) => {
      if (item.type === "spell") return item.usable === true;
      if (["action", "feat"].includes(item.type)) return item.activation !== "passive";
      return false;
    });

    this.groups.actions = [...strikes, ...actionItems];
    this.groups.actionGroups = {
      action1: [],
      action2: [],
      action3: [],
      reaction: [],
      free: [],
      passive: [],
      other: []
    };

    for (const action of this.groups.actions) {
      const key = action.activation;
      if (this.groups.actionGroups[key]) this.groups.actionGroups[key].push(action);
      else this.groups.other.push(action);
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
    const actor = this.actor;
    const totals = new Map();
    for (const entry of actor?.spellcasting?.contents ?? actor?.spellcasting ?? []) {
      if (!entry?.system?.slots || entry.isFocusPool || entry.isRitual) continue;
      for (let rank = 1; rank <= 10; rank += 1) {
        const slot = entry.system.slots[`slot${rank}`];
        if (!slot) continue;
        let value = Number(slot.value ?? 0);
        let max = Number(slot.max ?? value);
        if (entry.isPrepared && !entry.isFlexible) {
          const prepared = this.pf2eSpellSlotEntries(entry, rank).filter(Boolean);
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
    this.groups.spellSlots = Array.from(totals.entries()).map(([rank, slot]) => ({
      key: `rank${rank}`,
      level: rank,
      label: `Rank ${rank}`,
      value: slot.value,
      max: slot.max
    }));
  }

  refreshChecksGroup() {
    this.groups.checks = [];

    const actor = this.actor;
    for (const [key, skill] of Object.entries(actor?.skills ?? actor?.system?.skills ?? {})) {
      this.groups.checks.push({
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
      this.groups.checks.push({
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
      this.groups.checks.unshift({ kind: "perception", key: "perception", name: "Perception", badge: "Perception", category: "checks", formula: d20Formula(actor.perception.mod ?? 0), ability: "wis" });
    }
  }

  refreshCurrencyGroup() {
    this.groups.currency = [];
    const currency = this.actor?.inventory.currency;
    if (!currency) return;
    this.groups.currency = PF2E_CURRENCY_LABELS
      .map(([key, label]) => ({
        key,
        label,
        icon: renderInterfaceIcon(this.currencyIcon(key)),
        value: Number(currency[key] ?? 0)
      }))
      .filter((entry) => Number.isFinite(entry.value));
  }

  normalizeItem(item, group = "items") {
    const normalized = super.normalizeItem(item, group);

    const system = item?.system ?? {};
    const rank = item?.type === "spell" ? (this.pf2eIsCantrip(item) ? 0 : this.pf2eSpellRank(item)) : Number(item?.level ?? system.level?.value ?? system.level ?? 0);
    const entry = item?.type === "spell" ? this.pf2eSpellcastingEntry(item.actor, item) : null;
    const preparationMode = String(entry?.category ?? entry?.system?.prepared?.value ?? "");
    const slotChoices = item?.type === "spell" ? this.spellSlotChoices(item.actor, item) : [];
    const prepared = preparationMode === "prepared"
      ? slotChoices.length > 0
      : item?.type === "spell";
    const consumable = item?.type === "consumable";
    const actionLike = item?.type === "spell"
      || (["action", "feat"].includes(item?.type) && (!!this.pf2eActionCost(item) || !!system.selfEffect));
    const usable = item?.type === "spell" ? this.pf2eSpellCanCast(item.actor, item) : (consumable ? Number(system.quantity ?? 1) > 0 : actionLike);
    if (item?.type === "spell" && prepared && !usable) normalized.badges.push("Expended");

    normalized.level = Number.isFinite(rank) ? rank : 0;
    normalized.prepared = prepared;
    normalized.preparationMode = preparationMode;
    normalized.activation = this.pf2eActivationKey(item);
    normalized.actionCostLabel = this.pf2eActionCostLabel(item);
    normalized.rangeFeet = this.getItemRangeFeet(item);
    normalized.usesText = this.itemUsesText(item);
    normalized.containerId = String(system.containerId ?? "");
    normalized.ritual = this.pf2eIsRitual(item);
    normalized.sustained = system.duration?.sustained === true;
    normalized.spellDetails = this.spellDetailRows(item);
    normalized.pf2e = {
      entryId: String(entry?.id ?? system.location?.value ?? ""),
      category: preparationMode,
      itemCategory: String(system.category ?? ""),
      traits: this.pf2eTraits(item),
      carry: this.pf2eCarryState(item),
    };

    return normalized;
  }

  itemIsEquippable(item) {
    const physical = item?.isOfType?.("physical") === true
      || ["weapon", "armor", "shield", "equipment", "consumable", "backpack", "treasure", "ammo"].includes(item?.type);
    return physical && !!item?.system?.equipped;
  }

  itemIsEquipped(item) {
    if (item?.isEquipped === true) return true;
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

    const target = fieldText(item.system.target?.value, item.system.target);
    const area = item.system.area ?? {};
    const areaText = fieldText(
      area?.value && area?.type ? `${area.value}-foot ${area.type}` : "",
      area?.type
    );
    const text = fieldText(target, areaText);
    const description = htmlToPlain(item.system.description?.value ?? item.system.description ?? "");
    const lowered = `${text} ${description}`.toLowerCase();
    const numeric = String(target).match(/\b(\d+)\s+(?:willing\s+)?(?:creature|target|ally|enemy|object)s?\b/i);
    targetInfo.count = Number(numeric?.[1] ?? 0);
    const isAttack = item.isAttack === true || this.pf2eTraits(item).includes("attack") || item.type === "weapon" || item.type === "melee";
    if (isAttack && targetInfo.count <= 0) targetInfo.count = 1;

    targetInfo.selfOnly = /\bself\b/.test(String(target).toLowerCase());
    targetInfo.allowSelf = targetInfo.selfOnly || (/\bally\b|\bwilling creature\b/.test(lowered) && !/\bother\b|\banother\b/.test(lowered));
    targetInfo.needsTarget = !targetInfo.selfOnly && (isAttack || !!target || /\btarget\b|\bcreature\b|\benemy\b|\bally\b/.test(lowered));
    targetInfo.text = text;
    targetInfo.type = target || (isAttack ? "creature" : areaText);

    return targetInfo;
  }

  itemBadges(item) {
    const badges = [];
    const cost = this.pf2eActionCostLabel(item);
    if (cost && (item.type === "action" || item.type === "feat" || item.type === "spell")) badges.push(cost);
    const traits = this.pf2eTraits(item).filter((trait) => !["common", "uncommon", "rare", "unique"].includes(trait));
    badges.push(...traits.slice(0, 2).map(capitalizeWords));
    const range = fieldText(item?.system?.range?.value, Number(item?.system?.range) > 0 ? `${item.system.range} ft` : "");
    if (range) badges.push(range);
    const uses = this.pf2eUsesText(item);
    if (uses) badges.push(uses);
    const quantity = Number(item?.system?.quantity ?? NaN);
    if (Number.isFinite(quantity) && quantity !== 1) badges.push(`qty ${quantity}`);
    return Array.from(new Set(badges.filter(Boolean))).slice(0, 5);
  }

  itemUsesText(item) {
    if (item?.type === "spell" && (item.spellcasting?.isInnate || this.pf2eSpellcastingEntry(item.actor, item)?.isInnate)) {
      const uses = item.system?.location?.uses ?? {};
      const value = Number(uses.value ?? 0);
      const max = Number(uses.max ?? value);
      if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max}`;
    }
    if (item?.type === "spell") {
      const focusCost = Number(item.system?.cast?.focusPoints ?? (this.pf2eIsFocusSpell(item) ? 1 : 0));
      if (focusCost > 0) {
        const focus = item.actor?.system?.resources?.focus ?? {};
        const value = Number(focus.value ?? 0);
        const max = Number(focus.max ?? value);
        if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max} Focus`;
      }
      const slots = this.spellSlotChoices(item.actor, item);
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
    return super.itemUsesText(item);
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
    if (!["weapon", "armor", "shield", "equipment", "consumable", "backpack", "treasure", "ammo"].includes(item.type)) return false;
    return !(item.type === "treasure" && item.pf2e?.itemCategory === "coin");
  }

  getItemRangeFeet(item) {
    const direct = Number(item?.maxRange ?? item?.system?.range?.max ?? item?.system?.range);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const text = fieldText(item?.system?.range?.value, item?.system?.range, item?.range);
    const match = String(text).match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i);
    return match ? Number(match[1]) : 0;
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
      actionTiming: [
        ["all", "All Actions", "fa-layer-group"],
        ["action1", "1 Action", "fa-1"],
        ["action2", "2 Actions", "fa-2"],
        ["action3", "3 Actions", "fa-3"],
        ["reaction", "Reaction", "fa-reply"],
        ["free", "Free Action", "fa-feather"],
        ["passive", "Passive", "fa-eye"]
      ],
      actionSpellTraits: [
        ["all", "All Spells", "fa-wand-magic-sparkles"],
        ["focus", "Focus", "fa-bullseye"],
        ["sustained", "Sustained", "fa-arrows-rotate"],
        ["ritual", "Ritual", "fa-book-open"]
      ],
      spells: [
        ["all", "All"],
        ["cantrip", "Cantrip"],
        ["focus", "Focus"],
        ["prepared", "Prepared"],
        ["spontaneous", "Spontaneous"],
        ["innate", "Innate"],
        ["ritual", "Ritual"]
      ],
      features: [
        ["all", "All", "fa-layer-group"],
        ["class", "Class", "fa-graduation-cap"],
        ["ancestry", "Ancestry", "fa-users"],
        ["skill", "Skill", "fa-hand-sparkles"],
        ["general", "General", "fa-star"],
        ["action", "Actions", "fa-bolt"]
      ],
      inventory: [
        ["all", "All", "fa-layer-group"],
        ["weapon", "Weapons", "fa-sword"],
        ["equipment", "Armor & Equipment", "fa-shield-halved"],
        ["consumable", "Consumables", "fa-flask"],
        ["ammo", "Ammunition", "fa-bullseye"],
        ["backpack", "Containers", "fa-box-open"],
        ["quantity", "Has Quantity", "fa-hashtag"]
      ]
    };
    return quickFilters[view] ?? [];
  }

  matchesOneQuickFilter(key, filter, item) {
    if (filter === "cantrip") return item.type === "spell" && Number(item.level ?? 0) === 0;
    if (filter === "prepared") { return item.type === "spell" && item.preparationMode === "prepared" && item.prepared; }
    if (filter === "focus") return item.type === "spell" && (item.pf2e?.traits?.includes("focus") || item.preparationMode === "focus");
    if (filter === "spontaneous") return item.type === "spell" && item.preparationMode === "spontaneous";
    if (filter === "innate") return item.type === "spell" && item.preparationMode === "innate";
    if (filter === "sustained") return item.sustained === true;
    if (filter === "concentration") return item.concentration === true;
    if (filter === "ritual") return item.ritual === true;
    if (key === "actionTiming") return item.activation === filter;
    if (key === "actionSpellTraits") {
      if (filter === "concentration") return item.concentration === true;
      if (filter === "sustained") return item.sustained === true;
      if (filter === "focus") return item.pf2e?.traits?.includes("focus");
      return item.ritual === true;
    }
    if (filter === "equipment") return ["equipment", "armor", "shield"].includes(item.type);
    if (filter === "ammo") return item.type === "ammo" || item.pf2e?.itemCategory === "ammo" || item.pf2e?.traits?.includes("ammunition");
    if (filter === "backpack") return ["backpack", "container"].includes(item.type) || !!item.containerName;
    if (key === "features" && ["class", "ancestry", "skill", "general"].includes(filter)) {
      const category = String(item.pf2e?.itemCategory ?? "");
      return item.type === filter
        || category === filter
        || (filter === "class" && category === "classfeature")
        || (filter === "ancestry" && category === "ancestryfeature")
        || item.pf2e?.traits?.includes(filter)
        || (filter === "ancestry" && item.type === "heritage");
    }
    if (key === "actions" && filter === "item") return ["consumable", "tool", "equipment", "loot"].includes(item.type);
    if (key === "actions" && filter === "feature") return ["feat", "class", "subclass", "classfeature", "action", "race", "background"].includes(item.type);
    if (item.activation === filter) return true;
    return super.matchesOneQuickFilter(key, filter, item);
  }

  isTabAvailable(tab) {
    if (tab.key === "spells") {
      return this.groups.spells.length;
    }
    return super.isTabAvailable(tab);
  }

  canUseItem(item) {
    if (!item) return false;
    return item.type === "spell" ? this.pf2eSpellCanCast(this.actor, item) : this.normalizeItem(item).usable !== false;
  }

  async useItem(actor, item, options = {}) {
    if (item?.type === "spell") {
      const entry = this.pf2eSpellcastingEntry(actor, item);
      const rank = Number(options.castLevel ?? this.pf2eSpellRank(item));
      if (entry && typeof entry.cast === "function") return entry.cast(item, { rank: Number.isFinite(rank) ? rank : this.pf2eSpellRank(item) });
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

    const selected = this.selectedItemActivity(item, options.activityId);
    if (selected?.activity && typeof selected.activity.use === "function") return selected.activity.use({ legacy: false });
    if (typeof item?.use === "function") return item.use({ legacy: false });
    if (typeof item?.roll === "function") return item.roll();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> uses <strong>${escapeHtml(item.name)}</strong>.</p>`
    });
  }

  refreshSpeedSummary() {
    const actor = this.actor;
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
    this.summary.speed = entries.map(([type, speed]) => {
      const rawLabel = speed?.label ?? `PF2E.Actor.Speed.Type.${capitalizeWords(type)}`;
      const label = localizedFieldLabel(rawLabel, type === "land" ? "Land" : type);
      return `${label} ${Number(speed?.value ?? speed)} ft`;
    }).join(" | ") || "-";
  }

  refreshProfSummary() {
    const actor = this.actor;
    const perception = actor?.perception?.mod ?? actor?.system?.perception?.mod;
    const classDc = actor?.getStatistic?.("class")?.dc?.value
      ?? actor?.system?.attributes?.classDC?.value
      ?? actor?.system?.attributes?.classOrSpellDC?.value;
    const parts = [];
    if (Number.isFinite(Number(perception))) parts.push(`Perception ${signedMod(perception)}`);
    if (Number.isFinite(Number(classDc))) parts.push(`Class DC ${Number(classDc)}`);
    this.summary.prof = parts.join("  ") || "PF2e";
  }

  spellSlotChoices(item) {
    const actor = this.actor;
    if (!actor || item?.type !== "spell") return [];
    const entry = this.pf2eSpellcastingEntry(actor, item);
    const baseRank = Math.max(0, Number(item.baseRank ?? this.pf2eSpellRank(item)) || 0);
    const castRank = Math.max(baseRank, this.pf2eSpellRank(item));
    const focusCost = Number(item.system?.cast?.focusPoints ?? 0);
    if (this.pf2eIsCantrip(item) || this.pf2eIsRitual(item) || item.atWill || focusCost > 0 || this.pf2eIsFocusSpell(item)) return [];
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
        const matching = this.pf2eSpellSlotEntries(entry, rank).filter((prepared) => String(prepared?.id ?? "") === String(item.id));
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

  spellPreparedValue(item) {
    const system = item?.system ?? {};
    if (Object.prototype.hasOwnProperty.call(system, "prepared")) return Number(system.prepared) > 0 || system.prepared === true;
    return this.legacySpellPreparation(item)?.prepared === true;
  }

  legacySpellPreparation(item) {
    return item?._source?.system?.preparation ?? {};
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
    if (!item || !actor) return [];
    const entries = [];
    const castRank = Number(options.castLevel ?? this.pf2eSpellRank(item));
    const entry = this.pf2eSpellcastingEntry(actor, item);
    const statistic = entry?.statistic;
    if (item.type === "spell" && (item.isAttack || this.pf2eTraits(item).includes("attack"))) {
      const modifier = statistic?.check?.mod ?? statistic?.mod;
      const nativeChoices = [];
      for (let attackNumber = 1; attackNumber <= 3; attackNumber += 1) {
        const mapPenalty = (attackNumber - 1) * 5;
        const adjustedModifier = Number(modifier) - mapPenalty;
        nativeChoices.push({
          label: attackNumber === 1
            ? (Number.isFinite(adjustedModifier) ? signedMod(adjustedModifier) : "Attack")
            : (Number.isFinite(adjustedModifier) ? `${signedMod(adjustedModifier)} (MAP -${mapPenalty})` : `MAP -${mapPenalty}`),
          formula: Number.isFinite(Number(modifier)) ? d20Formula(Number(modifier) - mapPenalty) : "",
          nativeAction: "spellAttack",
          attackNumber
        });
      }
      entries.push({
        kind: "attack",
        label: "Spell Attack",
        formula: Number.isFinite(Number(modifier)) ? d20Formula(Number(modifier)) : "",
        detail: "Choose the attack that matches your current multiple attack penalty.",
        nativeAction: "spellAttack",
        nativeChoices,
        castRank
      });
    }
    if (item.type === "spell") {
      const damageParts = [];
      for (const [damageId, damage] of Object.entries(item.system?.damage ?? {})) {
        const raw = this.pf2eHeightenedDamageFormula(item, damageId, damage?.formula ?? "", castRank);
        const formula = this.resolvePf2eFormula(raw, actor, item, castRank);
        if (!formula) continue;
        const type = capitalizeWords(damage?.type ?? damage?.category ?? "Damage");
        damageParts.push({
          kind: (asArray(damage?.kinds).includes("healing") || String(damage?.kind ?? damage?.type ?? "").toLowerCase() === "healing") ? "healing" : "damage",
          type,
          formula
        });
      }
      if (damageParts.length) {
        const types = Array.from(new Set(damageParts.map((part) => part.type).filter((type) => type && type !== "Damage")));
        const allHealing = damageParts.every((part) => part.kind === "healing");
        const label = types.length === 1
          ? `${types[0]} ${allHealing ? "Healing" : "Damage"}`
          : `Spell ${allHealing ? "Healing" : "Damage"}`;
        entries.push({
          kind: allHealing ? "healing" : "damage",
          label,
          formula: damageParts.map((part) => part.formula).join(" + "),
          detail: damageParts.length > 1
            ? `PF2e rolls all ${damageParts.length} spell components together at rank ${castRank || this.pf2eSpellRank(item)}.`
            : `PF2e spell ${allHealing ? "healing" : "damage"} at rank ${castRank || this.pf2eSpellRank(item)}.`,
          nativeAction: "spellDamage",
          castRank
        });
      }
      const save = item.system?.defense?.save ?? item.system?.defense;
      const saveType = fieldText(save?.statistic, save?.type);
      const dc = statistic?.dc?.value;
      if (saveType) {
        entries.push({
          kind: "save",
          label: `${capitalizeWords(saveType)} Save`,
          formula: "",
          detail: Number.isFinite(Number(dc)) ? `Target rolls against DC ${Number(dc)}.` : "Resolve using the spellcasting DC."
        });
      }
    }
    return entries.slice(0, 10);
  }

  async rollCheck(kind, key) {
    const actor = this.actor;
    const event = this.pf2eSyntheticRollEvent();
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
    return super.rollCheck(kind, key);
  }

  async toggleEquipped(itemId) {
    const actor = this.actor;
    const item = actor?.items.get(itemId);
    if (!item) return;

    const equippable = this.normalizeItem(item).equippable;
    if (!equippable) return;

    const usage = item.system?.usage ?? {};
    const current = this.pf2eCarryState(item);
    const hasStowingContainer = asArray(actor.itemTypes?.backpack).some((container) => container !== item && container.system?.stowing && !container.isInContainer);
    const choices = [
      { carryType: "held", handsHeld: 1, inSlot: false, label: "Held (1 hand)", icon: "fa-hand-fist" },
      { carryType: "held", handsHeld: 2, inSlot: false, label: "Held (2 hands)", icon: "fa-hands" }
    ];
    if (String(usage.type ?? "") === "implanted") choices.push({ carryType: "implanted", handsHeld: 0, inSlot: false, label: "Implanted", icon: "fa-plug" });
    if (usage.where) choices.push({ carryType: "worn", handsHeld: 0, inSlot: true, label: `Worn / Equipped (${localizedFieldLabel(`PF2E.Item.Physical.Usage.WornSlot.${usage.where}`, usage.where)})`, icon: "fa-shirt" });
    choices.push({ carryType: "worn", handsHeld: 0, inSlot: false, label: "Carried", icon: "fa-shirt" });
    if (hasStowingContainer) choices.push({ carryType: "stowed", handsHeld: 0, inSlot: false, label: "Stowed", icon: "fa-box" });
    choices.push({ carryType: "dropped", handsHeld: 0, inSlot: false, label: "Dropped", icon: "fa-grip-lines" });
    const isCurrent = (choice) => choice.carryType === current.carryType
      && (choice.carryType !== "held" || choice.handsHeld === current.handsHeld)
      && (choice.carryType !== "worn" || choice.inSlot === current.inSlot);
    openModal(`
      <h2>Carry ${escapeHtml(item.name)}</h2>
      <p>PF2e tracks whether an item is held in one or two hands, worn, carried, stowed, or dropped. It does not distinguish left hand from right hand.</p>
      <div class="pp-choice-list pp-carry-choices">
        ${choices.map((choice) => `
          <button class="pp-button ${isCurrent(choice) ? "primary" : ""}" type="button" data-modal-action="setCarry" data-carry-type="${escapeHtml(choice.carryType)}" data-hands-held="${escapeHtml(choice.handsHeld)}" data-in-slot="${choice.inSlot ? "true" : "false"}">
            <i class="fas ${escapeHtml(choice.icon)}"></i>
            <span>${escapeHtml(choice.label)}</span>
          </button>
        `).join("")}
      </div>
      <div class="pp-dialog-actions">
        <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      </div>
    `, {
      setCarry: async (_modal, button) => {
        closeModal();
        const options = {
          carryType: button.dataset.carryType ?? "worn",
          handsHeld: Number(button.dataset.handsHeld ?? 0),
          inSlot: button.dataset.inSlot === "true"
        };
        const label = options.carryType === "held"
          ? `Held in ${Number(options.handsHeld) === 2 ? "2 hands" : "1 hand"}`
          : capitalizeWords(options.carryType ?? "carried");
        await executePlayerFirst(
          label,
          async () => this.setCarry(actor, item, options),
          "pf2eToggleEquipped",
          { actorId: actor.id, ...options, itemId, label }
        );
        this.invalidateModelCache();
        queueRender();
      }
    });
  }

  async requestRest() {
    const actor = this.actor;
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
          async () => { this.rest(actor, { skipDialog: true }); },
          "rest",
          { actorId: actor.id, restType: "night" }
        );
      }
    });
  }

  rest(actor, options = {}) {
    const rest = game.pf2e?.actions?.restForTheNight;
    if (typeof rest !== "function") throw new Error("PF2e Rest for the Night is unavailable.");
    return rest({ actors: [actor], ...options });
  }

  async setCarry(actor, item, options = {}) {
    if (typeof actor?.changeCarryType !== "function") throw new Error("PF2e carry controls are unavailable.");
    return actor.changeCarryType(item, {
      carryType: String(options.carryType ?? "worn"),
      handsHeld: clamp(Number(options.handsHeld ?? 0) || 0, 0, 2),
      inSlot: options.inSlot === true
    });
  };

  async updateCurrency(key, delta) {
    delta = Math.floor(delta);
    const actor = this.actor;
    if (!actor || !key || !Number.isFinite(delta) || delta === 0) return;
    const currency = this.groups.currency.find(c => c.key === key);
    const current = currency.value;
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, current + delta);
    const appliedDelta = next - current;
    if (!appliedDelta) return;
    const coins = { [key]: Math.abs(Number(appliedDelta ?? 0)) };
    if (appliedDelta > 0) return actor.inventory.addCoins(coins);
    if (appliedDelta < 0) {
      const removed = await actor.inventory.removeCoins(coins);
      if (!removed) ui.notifications?.warn?.("Not enough currency.");
      return removed;
    }
    queueRender();
  }

  async executeStrike(actor, data = {}) {
    const strike = this.pf2eFindStrike(actor, data);
    if (!strike) throw new Error("PF2e strike not found.");
    const operation = String(data.operation ?? "attack");
    const event = this.pf2eSyntheticRollEvent({ dialogType: operation === "attack" ? "check" : "damage" });
    if (operation === "damage" && typeof strike.damage === "function") return strike.damage({ event });
    if (operation === "critical" && typeof strike.critical === "function") return strike.critical({ event });
    const variant = strike.variants?.[Number(data.variantIndex ?? 0)] ?? strike.variants?.[0];
    if (typeof variant?.roll !== "function") throw new Error("PF2e strike attack is unavailable.");
    return variant.roll({ event, skipDialog: true });
  };

  async nativeItemRoll(_actor, item, action, options = {}) {
    const castRank = Number(options.castRank ?? this.pf2eSpellRank(item));
    const variant = Number.isFinite(castRank) && typeof item?.loadVariant === "function"
      ? item.loadVariant({ castRank }) ?? item
      : item;
    const event = this.pf2eSyntheticRollEvent({ castRank, dialogType: action === "spellDamage" ? "damage" : "check" });
    if (action === "spellAttack" && typeof variant?.rollAttack === "function") return variant.rollAttack(event, Number(options.attackNumber ?? 1) || 1);
    if (action === "spellDamage" && typeof variant?.rollDamage === "function") return variant.rollDamage(event);
    throw new Error("PF2e item roll is unavailable.");
  };


  openPf2eInitiativeDialog() {
    const actor = this.actor;
    if (!actor) return;
    const selected = String(actor.system?.initiative?.statistic ?? "perception");
    const options = this.pf2eInitiativeOptions(actor);
    openModal(`
    <h2>Choose Initiative</h2>
    <p>PF2e can roll initiative with Perception or a skill appropriate to what your character was doing when the encounter began.</p>
    <div class="pp-choice-list pp-initiative-choices">
      ${options.map((option) => `
        <button class="pp-button ${option.key === selected ? "primary" : ""}" type="button" data-modal-action="rollInitiative" data-statistic="${escapeHtml(option.key)}">
          <span>${escapeHtml(option.label)}</span>
          <strong>${escapeHtml(signedMod(option.mod))}</strong>
        </button>
      `).join("")}
    </div>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
    </div>
  `, {
      rollInitiative: async (_modal, button) => {
        const statistic = String(button.dataset.statistic ?? "perception");
        closeModal();
        await this.rollCheck("initiative", statistic);
      }
    });
  }

  pf2eSyntheticRollEvent(dataset = {}) {
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

  pf2eFindStrike(actor, data = {}) {
    const strikes = asArray(actor?.system?.actions);
    const itemId = String(data.itemId ?? "");
    const slug = String(data.strikeSlug ?? "");
    const index = Number(data.strikeIndex ?? NaN);
    return strikes.find((strike) => itemId && String(strike?.item?.id ?? "") === itemId && (!slug || String(strike?.slug ?? strike?.item?.slug ?? "") === slug))
      ?? (Number.isInteger(index) ? strikes[index] : null)
      ?? null;
  }


  async runPf2eStrike(data = {}) {
    if (pilotPaused()) {
      warnPaused();
      return;
    }
    const actor = this.actor;
    if (!actor) return;
    const operation = String(data.operation ?? "attack");
    if (operation === "flow") {
      const strikeModel = this.findPf2eStrikeModel(actor, data);
      if (strikeModel) await this.openPf2eStrikeFlowDialog(strikeModel, data);
      return;
    }
    const currentTargets = selectedTargetSet(state.scene?.id ?? "");
    if (operation === "attack" && !currentTargets.size && data.skipTargetPrompt !== true && data.skipTargetPrompt !== "true") {
      const strikeModel = this.findPf2eStrikeModel(actor, data);
      if (strikeModel && displayedTargetTokens(state.scene).some((token) => token.actorId !== actor.id)) {
        await this.openPf2eStrikeFlowDialog(strikeModel, data);
        return;
      }
    }
    const targetIds = Array.from(selectedTargetSet(state.scene?.id ?? ""));
    const payload = {
      actorId: actor.id,
      itemId: String(data.itemId ?? ""),
      strikeIndex: Number(data.strikeIndex ?? 0),
      strikeSlug: String(data.strikeSlug ?? ""),
      variantIndex: Number(data.variantIndex ?? 0),
      operation,
      sceneId: state.scene?.id ?? "",
      targetIds
    };
    if (activeGmIds().length && sendSocket("pf2eStrike", payload)) {
      showResultToast(`${capitalizeWords(payload.operation)} sent`, targetIds.length ? `${targetIds.length} target${targetIds.length === 1 ? "" : "s"}` : "");
      return;
    }
    await executePlayerFirst(
      `PF2e ${payload.operation}`,
      async () => this.executeStrike(actor, payload),
      "pf2eStrike",
      payload
    );
  }

  async pf2eStrikeDamageFormula(actor, strikeModel, operation = "damage") {
    const strike = this.pf2eFindStrike(actor, {
      itemId: strikeModel?.pf2eStrike?.itemId,
      strikeSlug: strikeModel?.pf2eStrike?.slug,
      strikeIndex: strikeModel?.pf2eStrike?.index
    });
    const rollFn = operation === "critical" ? strike?.critical : strike?.damage;
    if (typeof rollFn === "function") {
      try {
        const formula = await rollFn({ getFormula: true });
        if (formula) return cleanRulesText(formula);
      } catch (err) {
        console.warn(`Player Pilot could not preview PF2e strike ${operation} formula.`, err);
      }
    }
    const item = strike?.item ?? actor.items.get(strikeModel?.pf2eStrike?.itemId);
    const damage = item?.system?.damage ?? {};
    const dice = Number(damage.dice ?? 0);
    const die = String(damage.die ?? "").trim();
    const modifier = Number(damage.modifier ?? 0);
    if (dice > 0 && /^d\d+$/i.test(die)) {
      const base = `${dice}${die}`;
      const formula = modifier ? `${base} ${signedMod(modifier)}` : base;
      return operation === "critical" ? `2 * (${formula})` : formula;
    }
    return "";
  }

  async renderPf2eStrikeRollInstructions(strikeModel, strikeData = {}) {
    const actor = this.actor;
    const strike = strikeModel?.pf2eStrike ?? {};
    const variants = strike.variants?.length ? strike.variants : [{ index: 0, label: "Attack", modifier: NaN }];
    const firstModifier = Number(variants[0]?.modifier);
    const damageFormula = strike.hasDamage && actor ? await this.pf2eStrikeDamageFormula(actor, strikeModel, "damage") : "";
    const criticalFormula = strike.hasCritical && actor ? await this.pf2eStrikeDamageFormula(actor, strikeModel, "critical") : "";
    const instructions = [{
      kind: "attack",
      label: "Attack Roll",
      formula: Number.isFinite(firstModifier) ? d20Formula(firstModifier) : "",
      detail: "Choose the attack that matches your current multiple attack penalty.",
      nativeAction: "pf2eStrike",
      modalAction: "rollPf2eStrike",
      operation: "attack",
      nativeChoices: variants.map((variant, idx) => {
        const modifier = Number(variant.modifier);
        const label = variant.label || (idx === 0 ? "Attack" : `MAP ${idx + 1}`);
        return {
          label: Number.isFinite(modifier) ? `${label} ${signedMod(modifier)}` : label,
          buttonLabel: Number.isFinite(modifier) ? `${label} ${signedMod(modifier)}` : label,
          formula: Number.isFinite(modifier) ? d20Formula(modifier) : label,
          modalAction: "rollPf2eStrike",
          operation: "attack",
          variantIndex: Number(variant.index ?? idx),
          primary: idx === 0
        };
      })
    }];
    if (strike.hasDamage) instructions.push({
      kind: "damage",
      label: "Damage",
      formula: damageFormula,
      detail: damageFormula ? "Normal strike damage after a hit." : "PF2e will calculate weapon, rune, trait, and effect damage when rolled.",
      nativeAction: "pf2eStrike",
      modalAction: "rollPf2eStrike",
      operation: "damage",
      variantIndex: Number(strikeData.variantIndex ?? 0),
      buttonLabel: "Roll Damage"
    });
    if (strike.hasCritical) instructions.push({
      kind: "damage",
      label: "Critical Damage",
      formula: criticalFormula,
      detail: criticalFormula ? "Critical strike damage." : "PF2e will calculate critical damage when rolled.",
      nativeAction: "pf2eStrike",
      modalAction: "rollPf2eStrike",
      operation: "critical",
      variantIndex: Number(strikeData.variantIndex ?? 0),
      buttonLabel: "Roll Critical"
    });
    return renderRollInstructions(instructions, true);
  }

  findPf2eStrikeModel(actor, data = {}) {
    return this.groups.actions.find((item) => {
      if (!item.pf2eStrike) return false;
      return String(item.pf2eStrike.itemId) === String(data.itemId ?? "")
        && (!data.strikeSlug || String(item.pf2eStrike.slug) === String(data.strikeSlug));
    }) ?? null;
  }

  async openPf2eStrikeFlowDialog(strikeModel, strikeData) {
    const targetInfo = strikeModel.targetInfo;
    clearUseTargets();
    const canPickTargets = displayedTargetTokens(state.scene).some((token) => targetInfo.allowSelf || token.actorId !== state.actorId);
    const targetStep = (targetInfo.needsTarget || targetInfo.canTarget) && canPickTargets;
    const rollInstructions = await this.renderPf2eStrikeRollInstructions(strikeModel, strikeData);
    openModal(`
    <h2>Strike with ${escapeHtml(strikeModel.name)}</h2>
    <div class="pp-use-step ${targetStep ? "" : "hidden"}" data-use-step="targets">
      <p data-modal-target-summary>${escapeHtml(targetInstructionText(targetInfo))}</p>
      <div data-modal-target-picker>${renderModalTargetPicker(strikeModel)}</div>
    </div>
    <div class="pp-use-step ${targetStep ? "hidden" : ""}" data-use-step="rolls">
      <div class="pp-rolls-required-heading">
        <i class="fas fa-list-check"></i>
        <div>
          <strong>Rolls Still Required</strong>
          <span>Choose the MAP attack that applies, then roll damage or critical damage after the result.</span>
        </div>
      </div>
      ${rollInstructions}
    </div>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      <button class="pp-button primary ${targetStep ? "" : "hidden"}" type="button" data-modal-action="nextTargetStep">Next</button>
      <button class="pp-button primary ${targetStep ? "hidden" : ""}" type="button" data-modal-action="close" data-final-done>Done</button>
    </div>
  `, {
      modalToggleTarget: async (_modal, button) => {
        if (button?.disabled || button?.dataset?.disabled === "true") return;
        const tokenId = button?.dataset?.tokenId ?? "";
        const sceneId = state.scene?.id ?? "";
        const selected = selectedTargetSet(sceneId);
        if (selected.has(tokenId)) selected.delete(tokenId);
        else {
          const limit = Number(targetInfo.count ?? 0);
          if (Number.isFinite(limit) && limit > 0 && selected.size >= limit) {
            ui.notifications?.warn?.(`Select up to ${limit} target${limit === 1 ? "" : "s"}.`);
            return;
          }
          selected.add(tokenId);
        }
        setSelectedTargetSet(sceneId, selected);
        applyTargetsForCurrentUser(Array.from(selected), sceneId);
        state.modal?.querySelectorAll?.(".pp-token-row").forEach((row) => {
          const rowButton = row.querySelector?.("[data-token-id]");
          const active = rowButton && selected.has(rowButton.dataset.tokenId);
          row.classList?.toggle?.("selected", active);
          rowButton?.classList?.toggle?.("primary", active);
          if (rowButton) rowButton.textContent = active ? "Targeted" : "Target";
        });
        updateModalTargetCount(selected.size, targetInfo);
        sendSocket("targetUpdate", { actorId: state.actorId, sceneId, targetIds: Array.from(selected) });
      },
      nextTargetStep: async (modal) => {
        if (!selectedTargetSet(state.scene?.id ?? "").size) {
          ui.notifications?.warn?.("Choose a target first.");
          return;
        }
        modal.querySelector("[data-use-step='targets']")?.classList?.add?.("hidden");
        modal.querySelector("[data-use-step='rolls']")?.classList?.remove?.("hidden");
        modal.querySelector("[data-modal-action='nextTargetStep']")?.classList?.add?.("hidden");
        modal.querySelector("[data-final-done]")?.classList?.remove?.("hidden");
      },
      rollPf2eStrike: async (_modal, button) => {
        const operation = String(button?.dataset?.operation ?? "attack");
        await this.runPf2eStrike({
          ...strikeData,
          operation,
          variantIndex: Number(button?.dataset?.variantIndex ?? strikeData.variantIndex ?? 0),
          skipTargetPrompt: true
        });
      }
    });
  }

  pf2eInitiativeOptions(actor) {
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

  pf2eActionCost(item) {
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

  pf2eActivationKey(item) {
    const cost = this.pf2eActionCost(item);
    if (!cost) return "passive";
    if (cost.type === "reaction") return "reaction";
    if (cost.type === "free") return "free";
    return `action${clamp(Number(cost.value ?? 1), 1, 3)}`;
  }

  pf2eActionCostLabel(item) {
    const cost = this.pf2eActionCost(item);
    if (!cost) return "Passive";
    if (cost.type === "reaction") return "Reaction";
    if (cost.type === "free") return "Free Action";
    const value = clamp(Number(cost.value ?? 1), 1, 3);
    return `${value} Action${value === 1 ? "" : "s"}`;
  }

  pf2eUsesText(item) {
    if (item?.type === "spell" && (item.spellcasting?.isInnate || this.pf2eSpellcastingEntry(item.actor, item)?.isInnate)) {
      const uses = item.system?.location?.uses ?? {};
      const value = Number(uses.value ?? 0);
      const max = Number(uses.max ?? value);
      if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max}`;
    }
    if (item?.type === "spell") {
      const focusCost = Number(item.system?.cast?.focusPoints ?? (this.pf2eIsFocusSpell(item) ? 1 : 0));
      if (focusCost > 0) {
        const focus = item.actor?.system?.resources?.focus ?? {};
        const value = Number(focus.value ?? 0);
        const max = Number(focus.max ?? value);
        if (Number.isFinite(max) && max > 0) return `Uses Available ${Number.isFinite(value) ? value : 0} / ${max} Focus`;
      }
      const slots = this.spellSlotChoices(item.actor, item);
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
    return this.itemUsesText(item);
  }

  pf2eTraits(item) {
    const values = item?.system?.traits?.value;
    if (values instanceof Set) return Array.from(values).map(String);
    return asArray(values).map(String);
  }

  pf2eIsCantrip(item) {
    return item?.isCantrip === true || this.pf2eTraits(item).includes("cantrip");
  }

  pf2eIsFocusSpell(item) {
    return item?.isFocusSpell === true || this.pf2eTraits(item).includes("focus");
  }

  pf2eIsRitual(item) {
    return item?.isRitual === true || this.pf2eTraits(item).includes("ritual");
  }

  pf2eSpellRank(item) {
    const rank = Number(item?.rank ?? item?.baseRank ?? item?.system?.level?.value ?? item?.system?.level ?? 0);
    return Number.isFinite(rank) ? rank : 0;
  }

  pf2eSpellcastingEntry(actor, item) {
    if (!actor || !item) return null;
    if (item.spellcasting) return item.spellcasting;
    const entryId = String(item.system?.location?.value ?? "");
    return actor.spellcasting?.get?.(entryId) ?? actor.items?.get?.(entryId) ?? null;
  }

  pf2eSpellSlotEntries(entry, rank) {
    const slot = entry?.system?.slots?.[`slot${Number(rank)}`];
    if (!slot) return [];
    const prepared = slot.prepared;
    if (Array.isArray(prepared)) return prepared;
    if (prepared?.contents && Array.isArray(prepared.contents)) return prepared.contents;
    return Object.values(prepared ?? {});
  }

  pf2eSpellCanCast(actor, item) {
    if (item?.type !== "spell") return true;
    if (!this.pf2eSpellcastingEntry(actor, item) && !this.pf2eIsRitual(item)) return false;
    const focusCost = Number(item.system?.cast?.focusPoints ?? 0);
    if (focusCost > 0) return Number(actor?.system?.resources?.focus?.value ?? 0) >= focusCost;
    if (this.pf2eIsCantrip(item) || this.pf2eIsRitual(item) || item.atWill) return true;
    const choices = this.spellSlotChoices(actor, item);
    return !choices.length || choices.some((choice) => Number(choice.value ?? 0) > 0);
  }

  pf2eCarryState(item) {
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

  normalizePf2eStrike(strike, index) {
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
        ...this.pf2eTraits(item).slice(0, 2).map(capitalizeWords),
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

  pf2eHeightenedDamageFormula(item, damageId, formula, castRank) {
    const rank = Number(castRank ?? this.pf2eSpellRank(item));
    const baseRank = Number(item?.baseRank ?? this.pf2eSpellRank(item));
    const heightening = item?.system?.heightening;
    const interval = Number(heightening?.interval ?? 0);
    const scaling = String(heightening?.damage?.[damageId] ?? "").trim();
    const times = interval > 0 ? Math.floor((rank - baseRank) / interval) : 0;
    if (!scaling || times <= 0) return String(formula ?? "");
    return `${formula} + ${times === 1 ? scaling : `${times} * (${scaling})`}`;
  }

  resolvePf2eFormula(formula, actor, item, castRank) {
    const raw = String(formula ?? "").trim();
    if (!raw || !raw.includes("@")) return raw;
    const data = {
      ...(actor?.getRollData?.() ?? {}),
      ...(item?.getRollData?.({ castRank: Number(castRank) || this.pf2eSpellRank(item) }) ?? {})
    };
    try {
      return Roll.replaceFormulaData?.(raw, data, { missing: 0, warn: false }) ?? raw;
    } catch (_err) {
      return raw;
    }
  }

  spellDetailRows(item) {
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

  equipButton(item) {
    if (!item.equippable) return "";
    return `<button class="pp-carry-button" type="button" data-action="toggleEquipped" data-item-id="${escapeHtml(item.id)}"
    title="Change how ${escapeHtml(item.name)} is carried"><i class="fas fa-hand"></i><span>${escapeHtml(item.pf2e.carry?.label ?? "Carry")}</span></button>`;
  }
}