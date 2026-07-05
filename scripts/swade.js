import {
  GENERIC_ADAPTER,
  normalizeItem,
} from "./generic.js";
import { renderDieGlyph, renderInterfaceIcon } from "./player-pilot.js";
import {
  asArray,
  capitalizeWords,
  escapeHtml,
  localize,
  mergeTabs,
  numberText,
} from "./utils.js";

export const SWADE_ADAPTER = {
  ...GENERIC_ADAPTER,
  id: "swade",
  label: "SWADE",
  summary(actor) {
    if (!actor) {
      return {
        name: "Actor",
        img: "icons/svg/mystery-man.svg",
      };
    }
    const system = actor.system;
    const wounds = system.wounds;
    const fatigue = system.fatigue;

    let powersCount = 0;
    const powers = new Map();
    const powerFilters = [
      { key: "all", label: "All", icon: "fa-layer-group" },
    ];

    const items = actor.items.map((item) => normalizeSwadeItem(item, item.type || "powers"));
    for (const item of items) {
      if (item.type !== "power") continue;

      const arcane = item.arcane || "General";
      const key = arcane.toLowerCase();

      //Add to our powers list
      if (!powers.has(key)) {
        powers.set(key, { arcane, icon: "fa-wand-magic", count: 0, powers: [] });
      }
      const powerGroup = powers.get(key);
      powerGroup.powers.push(item);
      powerGroup.count = powerGroup.powers.length;

      ++powersCount;

      //Add a filter if we haven't yet
      if (!powerFilters.find(f => f.key === arcane.toLowerCase())) {
        powerFilters.push({
          key: arcane.toLowerCase(),
          label: arcane,
          icon: "fa-wand-magic",
        });
      }
    }

    return {
      name: actor?.name ?? "Actor",
      type: actor?.type ?? "",
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      wounds: {
        display: `${numberText(wounds.value)} / ${numberText(wounds.max)}`,
        value: wounds.value,
        max: wounds.max,
        pct: wounds.max > 0 ? (wounds.value / wounds.max) * 100 : 0,
      },
      fatigue: {
        display: `${numberText(fatigue.value)} / ${numberText(fatigue.max)}`,
        value: fatigue.value,
        max: fatigue.max,
        pct: fatigue.max > 0 ? (fatigue.value / fatigue.max) * 100 : 0,
      },
      statuses: {
        shaken: {
          label: "Shaken",
          value: system.status.isShaken,
        },
        distracted: {
          label: "Distracted",
          value: system.status.isDistracted,
        },
        vulnerable: {
          label: "Vulnerable",
          value: system.status.isVulnerable,
        },
        stunned: {
          label: "Stunned",
          value: system.status.isStunned,
        },
        entangled: {
          label: "Entangled",
          value: system.status.isEntangled,
        },
        bound: {
          label: "Bound",
          value: system.status.isBound,
        },
      },
      pace: swadePaceSummary(actor),
      parry: system.stats.parry.value,
      toughness: actor.system.stats.toughness.value,
      armor: actor.system.stats.toughness.armor,
      attributes: attributes(actor),
      bennies: system.bennies,
      bennyImage: game.settings.get('swade', 'bennyImageSheet'),
      powers: Array.from(powers.values()),
      powersCount,
      powerFilters: powerFilters,
    };
  },
  groups(actor) {
    const items = asArray(actor?.items).map((item) => normalizeSwadeItem(item, item.type || "items"));
    return {
      actions: items.filter(itemBelongsInActions),
      skills: items.filter(i => i.type === "skill"),
      powers: items.filter((item) => item.type === "power"),
      inventory: items.filter(isInventoryItem),
    };
  },
  canUseItem() {
    return true;
  },
  async useItem(actor, item, options = {}) {
    await game.brsw.create_item_card(actor, item.id);
  },
  async rollCheck(actor, kind, key) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> requested ${escapeHtml(kind)} ${escapeHtml(key)}.</p>`
    });
  },
  statCards(model) {
    if (!model) return [];
    const cards = [
      { key: "pace", icon: "fa-person-running", label: "Pace", value: model.summary.pace },
      { key: "parry", icon: "fa-swords", label: "Parry", value: model.summary.parry },
      { key: "toughness", icon: "fa-shield", label: "Toughness", value: `${model.summary.toughness}(${model.summary.armor})` },
    ];

    if (model.summary.bennies.value || model.summary.bennies.max) {
      cards.push({
        key: "bennies",
        icon: game.settings.get('swade', 'bennyImageSheet'),
        label: "Bennies",
        bennyValue: model.summary.bennies.value,
        controls: "modules/player-pilot/templates/player-pilot-shell/partials/benny-controls.hbs"
      });
    }
    return cards;
  },
  inventoryGroups(model) {
    const swadeConstants = foundry.CONFIG.SWADE.CONST;
    const inHandStates = [
      swadeConstants.EQUIP_STATE.MAIN_HAND,
      swadeConstants.EQUIP_STATE.OFF_HAND,
      swadeConstants.EQUIP_STATE.TWO_HANDS,
    ];
    const equipNames = {
      [swadeConstants.EQUIP_STATE.STORED]: game.i18n.localize('SWADE.ItemEquipStatus.Stored'),
      [swadeConstants.EQUIP_STATE.CARRIED]: game.i18n.localize('SWADE.ItemEquipStatus.Carried'),
      [swadeConstants.EQUIP_STATE.EQUIPPED]: game.i18n.localize('SWADE.ItemEquipStatus.Equipped'),
      [swadeConstants.EQUIP_STATE.MAIN_HAND]: game.i18n.localize('SWADE.ItemEquipStatus.Equipped'),
    };
    const groupOrder = [
      swadeConstants.EQUIP_STATE.MAIN_HAND,
      swadeConstants.EQUIP_STATE.EQUIPPED,
      swadeConstants.EQUIP_STATE.CARRIED,
      swadeConstants.EQUIP_STATE.STORED,
    ];

    const items = model.groups.inventory.filter(isInventoryItem);
    const groups = new Map();
    for (const item of items) {
      const equipState = inHandStates.includes(item.equipStatus) ? swadeConstants.EQUIP_STATE.MAIN_HAND : item.equipStatus;
      if (!groups.has(equipState)) {
        groups.set(equipState, {
          name: equipNames[equipState],
          icon: swadeConstants.EQUIP_STATE_ICONS[equipState],
          count: 0,
          equipState,
          items: [],
        });
      }
      const group = groups.get(equipState);
      group.items.push(item);
      group.count = group.items.length;
    }
    const sortedGroups = [...groups.values()].sort((a, b) => {
      return groupOrder.indexOf(a.equipState) - groupOrder.indexOf(b.equipState);
    });
    sortedGroups.forEach(g => g.items.sort((a, b) => {
      return a.name.localeCompare(b.name);
    }));
    return sortedGroups;
  },
  TABS: mergeTabs(GENERIC_ADAPTER.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/swade/stats-view.hbs",
    },
    { key: "actions" },
    { key: "rolls" },
    {
      key: "powers",
      label: "Powers",
      icon: "fa-wand-magic-sparkles",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/swade/powers-view.hbs",
      sectionHeader: { title: "Powers", icon: renderInterfaceIcon("fa-wand-magic-sparkles") },
    },
    { key: "inventory" },
    { key: "map" },
  ]),
  filterAvailableTabs(tabs, summary) {
    return GENERIC_ADAPTER.filterAvailableTabs(tabs, summary).filter(t => isTabAvailable(t, summary));
  },
};

function isTabAvailable(tab, summary) {
  if (tab.key === "powers") {
    return summary.powers.length;
  }
  return true;
}

export const SWADE_ACTIONS = {
  toggleStatusEffect: function (event, button) {
    this.currentActor.toggleActiveEffect(button.dataset.id);
  },
  benny: async function (event, button) {
    const actor = this.currentActor;
    if (!actor) return;

    if (button.dataset.delta > 0) {
      await this.actor.getBenny();
    } else {
      await this.actor.spendBenny();
    }
  },
};

export const SWADE_QUICK_FILTERS = {
  actions: [
    ["all", "All", "fa-layer-group"],
    ["weapon", "Weapons", "fa-sword"],
    ["power", "Powers", "fa-wand-magic-sparkles"],
    ["consumable", "Consumables", "fa-flask"],
  ],
};

function swadePaceSummary(actor) {
  const paces = actor?.system?.pace ?? {};
  const order = ["ground", "fly", "swim", "burrow"];
  const entries = Object.entries(paces)
    .filter(([type, pace]) => order.includes(type) && pace !== null)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
    });
  return new Handlebars.SafeString(entries.map(([type, pace], i, arr) => {
    const label = localize(`SWADE.Movement.Pace.${capitalizeWords(type)}.Label`);
    const text = `${label} ${Number(pace)}`;
    if (i === arr.length - 1) return text;
    return text + (i % 2 === 1 ? "<br>" : " | ");
  }).join("") || "-");
}

function attributes(actor) {
  const source = actor?.system?.attributes ?? {};
  return Object.entries(source).slice(0, 6).map(([key, data]) => ({
    key,
    label: globalThis.CONFIG?.SWADE?.attributes?.[key].short,
    die: renderDieGlyph(data.die.sides, "pp-swade-die"),
    mod: data.die.modifier < 0 ? String(data.die.modifier) : `+${data.die.modifier}`,
  }));
}

function itemIsEquipped(item) {
  const equipStatus = item?.system?.equipStatus;
  return equipStatus === foundry.CONFIG.SWADE.CONST.EQUIP_STATE.MAIN_HAND ||
    equipStatus === foundry.CONFIG.SWADE.CONST.EQUIP_STATE.OFF_HAND ||
    equipStatus === foundry.CONFIG.SWADE.CONST.EQUIP_STATE.TWO_HANDS ||
    equipStatus === foundry.CONFIG.SWADE.CONST.EQUIP_STATE.EQUIPPED;
}

export function normalizeSwadeItem(item, group = "items") {
  const normalized = normalizeItem(item, group);
  normalized.equipped = itemIsEquipped(item);
  normalized.equipStatus = item.system.equipStatus;
  normalized.badges = swadeItemBadges(item);
  if (item.type === "power") {
    normalized.arcane = item.system.arcane;
  }
  return normalized;
}

function isInventoryItem(item) {
  return item.type === "gear" ||
    item.type === "weapon" ||
    item.type === "armor" ||
    item.type === "shield" ||
    item.type === "consumable";
}

function itemBelongsInActions(item) {
  if (!item) return false;
  if (item.type === "power") return true;
  if (item.type === "consumable") return true;
  if (item.type === "weapon") {
    return item.equipStatus == foundry.CONFIG.SWADE.CONST.EQUIP_STATE.MAIN_HAND ||
      item.equipStatus == foundry.CONFIG.SWADE.CONST.EQUIP_STATE.OFF_HAND ||
      item.equipStatus == foundry.CONFIG.SWADE.CONST.EQUIP_STATE.TWO_HANDS;
  }
  return false;
}

export function swadeItemBadges(item) {
  const badges = [];
  badges.push(capitalizeWords(item.type));
  if (item.type === "weapon") {
    if (item.system.range) {
      badges.push("Ranged " + item.system.range);
    } else {
      badges.push("Melee");
    }
  }
  if (item.system.charges?.hasCharges) {
    item.system.charges.charges.forEach(c => badges.push(`${c.name}:${c.value}/${c.max}`));
  }
  return Array.from(new Set(badges.filter(Boolean))).slice(0, 5);
}