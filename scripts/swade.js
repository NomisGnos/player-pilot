import { BaseModel } from "./base-model.js";
import { closeModal, executePlayerFirst, openModal, renderDieGlyph, renderInterfaceIcon } from "./player-pilot.js";
import {
  capitalizeWords,
  localize,
  mergeTabs,
  numberText,
} from "./utils.js";

export class SwadeModel extends BaseModel {

  static id = "swade";
  static label = "SWADE";

  static TABS = mergeTabs(BaseModel.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/swade/stats-view.hbs",
    },
    { key: "actions" },
    {
      key: "skills",
      label: "Skills",
      icon: "fa-hand-sparkles",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/swade/skills-view.hbs",
      sectionHeader: { title: "Skills", icon: renderInterfaceIcon("fa-hand-sparkles") },
    },
    {
      key: "powers",
      label: "Powers",
      icon: "fa-wand-magic-sparkles",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/swade/powers-view.hbs",
      sectionHeader: { title: "Powers", icon: renderInterfaceIcon("fa-wand-magic-sparkles") },
    },
    { key: "inventory" },
    { key: "map" },
  ]);

  static SHELL_ACTIONS = {
    ...BaseModel.SHELL_ACTIONS,
    toggleStatusEffect: function (event, button) {
      this.currentActor.toggleActiveEffect(button.dataset.id);
    },
    benny: async function (event, button) {
      const actor = this.currentActor;
      if (!actor) return;

      if (button.dataset.delta > 0) {
        await actor.getBenny();
      } else {
        await actor.spendBenny();
      }
    },
    powerPoints: async function (event, button) {
      const actor = this.currentActor;
      if (!actor) return;
      const delta = Number(button.dataset.delta);
      if (!delta) return;

      const currentPP = actor.system.powerPoints[button.dataset.arcane].value;
      const maxPP = actor.system.powerPoints[button.dataset.arcane].max;
      const dataKey = `system.powerPoints.${button.dataset.arcane}.value`;

      if (delta > 0) {
        if (currentPP >= maxPP) return;
        const newPP = Math.min(currentPP + delta, maxPP);
        actor.update({ [dataKey]: newPP });
      } else {
        if (currentPP === 0) return;
        const newPP = Math.max(currentPP + delta, 0);
        actor.update({ [dataKey]: newPP });
      }
    },
    swadeRoll: async function (event, button) {
      const actor = this.currentActor;
      if (!actor) return;

      if (button.dataset.kind === "skill") {
        actor.rollSkill(button.dataset.traitId);
      } else if (button.dataset.kind === "attribute") {
        actor.rollAttribute(button.dataset.traitId);
      }
    },
  };

  static SWADE_EQUIP_STATE = {};
  static SWADE_EQUIP_STATE_ICONS = [];
  static SWADE_EQUIP_STATE_LABELS = {};

  constructor() {
    super();

    SwadeModel.SWADE_EQUIP_STATE = {
      ...CONFIG.SWADE.CONST.EQUIP_STATE,
      MAGIC_BAG: -2,
      BACKPACK: -1,
    };

    SwadeModel.SWADE_EQUIP_STATE_ICONS = Object.assign(
      [...CONFIG.SWADE.CONST.EQUIP_STATE_ICONS],
      {
        [-2]: "fas fa-hat-wizard",
        [-1]: "fas fa-backpack",
      }
    );

    SwadeModel.SWADE_EQUIP_STATE_LABELS = {
      [-2]: "Magic Bag",
      [-1]: "Backpack",
      [SwadeModel.SWADE_EQUIP_STATE.STORED]: game.i18n.localize("SWADE.ItemEquipStatus.Stored"),
      [SwadeModel.SWADE_EQUIP_STATE.CARRIED]: game.i18n.localize("SWADE.ItemEquipStatus.Carried"),
      [SwadeModel.SWADE_EQUIP_STATE.OFF_HAND]: game.i18n.localize("SWADE.ItemEquipStatus.OffHand"),
      [SwadeModel.SWADE_EQUIP_STATE.EQUIPPED]: game.i18n.localize("SWADE.ItemEquipStatus.Equipped"),
      [SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND]: game.i18n.localize("SWADE.ItemEquipStatus.MainHand"),
      [SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS]: game.i18n.localize("SWADE.ItemEquipStatus.TwoHands")
    };
  }


  refreshSummary() {
    super.refreshSummary();

    if (!this.actor) {
      return;
    }

    this.refreshPaceSummary();
    this.refreshAttributesSummary();

    const system = this.actor.system;
    const wounds = system.wounds;
    const fatigue = system.fatigue;

    this.summary.wounds = {
      display: `${numberText(wounds.value)} / ${numberText(wounds.max)}`,
      value: wounds.value,
      max: wounds.max,
      pct: wounds.max > 0 ? (wounds.value / wounds.max) * 100 : 0,
    };

    this.summary.fatigue = {
      display: `${numberText(fatigue.value)} / ${numberText(fatigue.max)}`,
      value: fatigue.value,
      max: fatigue.max,
      pct: fatigue.max > 0 ? (fatigue.value / fatigue.max) * 100 : 0,
    };

    this.summary.statuses = {
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
    };

    this.summary.parry = system.stats.parry.value;
    this.summary.toughness = system.stats.toughness.value;
    this.summary.armor = system.stats.toughness.armor;
    this.summary.bennies = system.bennies;
    this.summary.bennyImage = game.settings.get('swade', 'bennyImageSheet');

    this.refreshStatCards();
  }

  refreshPaceSummary() {
    const order = ["ground", "fly", "swim", "burrow"];

    const entries = Object.entries(this.actor.system.pace)
      .filter(([type, pace]) => order.includes(type) && pace !== null)
      .sort(([a], [b]) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
      });

    //Combine the paces we have into a single string separated by |
    //We create a new line after every second pace to better control the word wrapping
    return new Handlebars.SafeString(entries.map(([type, pace], i, arr) => {
      const label = localize(`SWADE.Movement.Pace.${capitalizeWords(type)}.Label`);
      const text = `${label} ${Number(pace)}`;
      if (i === arr.length - 1) return text;
      return text + (i % 2 === 1 ? "<br>" : " | ");
    }).join(""));
  }

  refreshAttributesSummary() {
    this.summary.attributes = Object.entries(this.actor.system.attributes).slice(0, 6).map(([key, data]) => ({
      key,
      label: CONFIG.SWADE.attributes[key].short,
      die: renderDieGlyph(data.die.sides, "pp-swade-die"),
      mod: data.die.modifier < 0 ? String(data.die.modifier) : `+${data.die.modifier}`,
    }));
  }

  refreshStatCards() {
    this.summary.statCards = [
      { key: "pace", icon: "fa-person-running", label: "Pace", value: this.summary.pace },
      { key: "parry", icon: "fa-swords", label: "Parry", value: this.summary.parry },
      { key: "toughness", icon: "fa-shield", label: "Toughness", value: `${this.summary.toughness}(${this.summary.armor})` },
    ];

    if (this.summary.bennies.value || this.summary.bennies.max) {
      this.summary.statCards.push({
        key: "bennies",
        icon: this.summary.bennyImage,
        label: "Bennies",
        bennyValue: this.summary.bennies.value,
        controls: "modules/player-pilot/templates/player-pilot-shell/partials/benny-controls.hbs"
      });
    }
  }

  refreshGroupsImpl(items) {
    super.refreshGroupsImpl(items);
    this.refreshPowersGroup();
    this.refreshCurrencyGroup();
    this.groups.skills = items.filter(i => i.type === "skill").sort((a, b) => a.name.localeCompare(b.name));
  }

  refreshPowersGroup() {
    this.groups.powers = {};
    this.groups.powers.filters = [{ key: "all", label: "All", icon: "fa-layer-group" }];

    const powers = new Map();
    const items = this.actor.items.filter(i => i.type === "power").map((item) => this.normalizeItem(item, item.type));
    for (const item of items) {
      const arcane = item.arcane || "General";
      const key = arcane.toLowerCase();

      if (!powers.has(key)) {
        powers.set(key, { arcane, icon: "fa-wand-magic", count: 0, powers: [] });
      }

      //Add to our powers list
      const powerGroup = powers.get(key);
      powerGroup.powers.push(item);
      powerGroup.count = powerGroup.powers.length;

      //Add a filter if we haven't yet
      if (!this.groups.powers.filters.find(f => f.key === arcane.toLowerCase())) {
        this.groups.powers.filters.push({
          key: arcane.toLowerCase(),
          label: arcane,
          icon: "fa-wand-magic",
        });
      }
    }

    this.groups.powers.groups = Array.from(powers.values());

    //Modifying summary here to keep the code simpler
    this.summary.powerPoints = Object.entries(this.actor.system.powerPoints).filter(([key, values]) => {
      return values.max > 0 && this.groups.powers.filters.some(f => f.key === key);
    }).map(([key, pp]) => ({
      key,
      name: key === "general" ? "General" : key,
      value: pp.value,
      max: pp.max
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  refreshCurrencyGroup() {
    this.groups.currency = [];
    if (!this.actor) return;
    const currency = this.actor.system.details.currency;
    if (game.sfc?.coinDataMap !== undefined) {
      //Support for SWADE Fantasy Currencies
      const coinDataMap = Object.entries(game.sfc.coinDataMap);
      coinDataMap.sort((a, b) => b[1].value - a[1].value);
      this.groups.currency = coinDataMap.map(([key, coinData]) => ({
          key,
          label: coinData.name,
          icon: renderInterfaceIcon(coinData.img),
          value: this.actor.flags?.sfc?.[coinData.countFlagName] ?? 0
        }));
    } else {
      this.groups.currency = [{
        key: "currency",
        label: game.settings.get("swade", "currencyName"),
        icon: renderInterfaceIcon("fa-dollar-sign"),
        value: currency
      }];
    }
  }

  refreshInventoryGroups(items) {
    const inHandStates = [
      SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND,
      SwadeModel.SWADE_EQUIP_STATE.OFF_HAND,
      SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS,
    ];

    const equipNames = {
      [SwadeModel.SWADE_EQUIP_STATE.STORED]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.STORED],
      [SwadeModel.SWADE_EQUIP_STATE.CARRIED]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.CARRIED],
      [SwadeModel.SWADE_EQUIP_STATE.EQUIPPED]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.EQUIPPED],
      [SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.EQUIPPED],
      [SwadeModel.SWADE_EQUIP_STATE.BACKPACK]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.BACKPACK],
      [SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG]: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG],
    };

    const groupOrder = [
      SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND,
      SwadeModel.SWADE_EQUIP_STATE.EQUIPPED,
      SwadeModel.SWADE_EQUIP_STATE.CARRIED,
      SwadeModel.SWADE_EQUIP_STATE.STORED,
      SwadeModel.SWADE_EQUIP_STATE.BACKPACK,
      SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG,
    ];

    const filteredItems = items.filter(this.isInventoryItem);
    const groups = new Map();
    for (const item of filteredItems) {
      const equipState = inHandStates.includes(item.equipStatus) ? SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND : item.equipStatus;
      if (!groups.has(equipState)) {
        groups.set(equipState, {
          name: equipNames[equipState],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[equipState],
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

    this.groups.inventory = sortedGroups;
  }

  normalizeItem(item, group = "items") {
    const normalized = super.normalizeItem(item, group);

    normalized.equipStatus = item.system.equipStatus;

    if (item.type === "power") {
      normalized.arcane = item.system.arcane;
    }

    if (item.type === "skill") {
      normalized.die = renderDieGlyph(item.system.die.sides, "pp-swade-die");
      normalized.mod = item.system.die.modifier < 0 ? String(item.system.die.modifier) : `+${item.system.die.modifier}`;
      normalized.img = item.img;
      normalized.attribute = capitalizeWords(item.system.attribute);
    }

    return normalized;
  }

  itemIsEquippable(item) {
    if (!item) return false;
    if (!this.isInventoryItem(item)) return false;
    return !!item.system.equippable;
  }

  itemIsEquipped(item) {
    if (!this.itemIsEquippable(item)) return false;
    return item.system.equipStatus != SwadeModel.SWADE_EQUIP_STATE.CARRIED &&
      item.system.equipStatus != SwadeModel.SWADE_EQUIP_STATE.STORED;
  }

  itemCanBeUsed(item) {
    if (!item) return false;
    if (item.type === "weapon" || item.type === "power" || item.type === "consumable") return true;
    if (item.system.actions?.additional) {
      return !!Object.entries(item.system.actions.additional).length;
    }
    return false;
  }

  itemNeedsAmmo(item) {
    if (!item) return false;
    return (item.system.shots ?? 0) > 0 || !!item.system.ammo;
  }

  itemTargetInfo(item, _activityId = "") {
    const targetInfo = {
      count: 0,
      needsTarget: false,
      canTarget: false,
      allowSelf: true,
    };

    if (!item) return targetInfo;

    const hasDamageAction = !!item.system.actions?.additional &&
      Object.values(item.system.actions?.additional).some(a => a.type === "damage" && a.override);

    targetInfo.needsTarget = !!item.system.damage;
    targetInfo.canTarget = hasDamageAction || item.type === "power";

    return targetInfo;
  }

  itemBadges(item) {
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

    return badges.slice(0, 4);
  }

  isInventoryItem(item) {
    return item.type === "gear" ||
      item.type === "weapon" ||
      item.type === "armor" ||
      item.type === "shield" ||
      item.type === "consumable";
  }

  itemBelongsInActions(item) {
    if (item.type === "power") return true;
    if (item.type === "consumable") return true;
    if (item.type === "weapon") {
      return item.equipStatus == SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND ||
        item.equipStatus == SwadeModel.SWADE_EQUIP_STATE.OFF_HAND ||
        item.equipStatus == SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS;
    }
    return false;
  }

  quickFiltersForKey(view) {
    if (view === "actions") {
      return [
        ["all", "All", "fa-layer-group"],
        ["weapon", "Weapons", "fa-sword"],
        ["power", "Powers", "fa-wand-magic-sparkles"],
        ["consumable", "Consumables", "fa-flask"],
      ];
    }
    if (view === "inventory") {
      return [
        ["all", "All", "fa-layer-group"],
        ["weapon", "Weapons", "fa-sword"],
        ["armor", "Armor", "fa-helmet-battle"],
        ["shield", "Shields", "fa-shield"],
        ["gear", "Gear", "fa-box-open"],
        ["consumable", "Consumables", "fa-flask"],
      ];
    }
    return super.quickFiltersForKey(view);
  }

  matchesOneQuickFilter(key, filter, item) {
    if (item.arcane !== undefined) {
      if (item.arcane.toLowerCase() === filter ||
        (!item.arcane && filter === "general")) {
        return true;
      }
    }
    return super.matchesOneQuickFilter(key, filter, item);
  }

  isTabAvailable(tab) {
    if (tab.key === "powers") {
      return this.groups.powers.groups.length;
    }
    return super.isTabAvailable(tab);
  }

  async useItem(actor, item, _options = {}) {
    if (game.brsw) {
      game.brsw.create_item_card(actor, item.id);
    } else {
      await item.show();
    }
  }

  openEquipStatusDialog(actor, item) {
    let choices = [];

    if (item.type === "weapon") {
      choices.push(
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.MAIN_HAND]
        },
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.OFF_HAND,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.OFF_HAND],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.OFF_HAND]
        },
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.TWO_HANDS]
        },
      );

    } else {
      choices.push(
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.EQUIPPED,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.EQUIPPED],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.EQUIPPED]
        },
      );
    }

    choices.push(
      {
        equipStatus: SwadeModel.SWADE_EQUIP_STATE.CARRIED,
        label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.CARRIED],
        icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.CARRIED]
      },
      {
        equipStatus: SwadeModel.SWADE_EQUIP_STATE.STORED,
        label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.STORED],
        icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.STORED]
      },
    );

    if (game.modules.get("swade-fantasy-companion")?.active || game.modules.get("swpf-core-rules")?.active) {
      choices.push(
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.BACKPACK,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.BACKPACK],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.BACKPACK]
        },
        {
          equipStatus: SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG,
          label: SwadeModel.SWADE_EQUIP_STATE_LABELS[SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG],
          icon: SwadeModel.SWADE_EQUIP_STATE_ICONS[SwadeModel.SWADE_EQUIP_STATE.MAGIC_BAG]
        },
      );
    }

    const isCurrent = (choice) => choice.equipStatus === item.system.equipStatus;
    openModal(`
      <h2>Carry ${item.name}</h2>
      <div class="pp-choice-list pp-carry-choices">
        ${choices.map((choice) => `
          <button class="pp-button ${isCurrent(choice) ? "primary" : ""}" type="button" data-modal-action="setCarry" data-equip-status="${choice.equipStatus}">
            <i class="fas ${choice.icon}"></i>
            <span>${choice.label}</span>
          </button>
        `).join("")}
      </div>
      <div class="pp-dialog-actions">
        <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      </div>
    `, {
      setCarry: async (_modal, button) => {
        closeModal();
        item.setEquipState(button.dataset.equipStatus);
      }
    });
  }

  async toggleEquipped(itemId) {
    const actor = this.actor;
    const item = actor?.items.get(itemId);
    if (!actor || !item) return;

    const equippable = this.itemIsEquippable(item);
    if (!equippable) return;
    this.openEquipStatusDialog(actor, item);
  }

  async updateCurrency(key, delta) {
    const actor = this.actor;
    if (!actor || !key || !Number.isFinite(delta) || delta === 0) return;

    if (game.sfc?.coinDataMap !== undefined) {
      const coinData = game.sfc.coinDataMap[key];
      const current = actor.flags?.sfc?.[coinData.countFlagName] ?? 0;
      const newValue = Math.max(0, current + delta);
      if (current !== newValue) {
        await actor.setFlag("sfc", coinData.countFlagName, newValue);
      }
    } else {
      const currency = this.groups.currency.find(c => c.key === key);
      const current = currency.value;
      const newValue = Math.max(0, current + delta);
      const label = currency.label;
      await executePlayerFirst(
        `${label} ${newValue}`,
        async () => actor.update({ [`system.details.currency`]: newValue }),
        "updateActorData",
        { actorId: actor.id, updates: { [`system.details.currency`]: newValue }, label: `${label} ${newValue}` }
      );
    }
  }

  equipButton(item) {
    if (!item.equippable) return "";
    const equipLabel = SwadeModel.SWADE_EQUIP_STATE_LABELS[item.equipStatus];
    const equipIcon = SwadeModel.SWADE_EQUIP_STATE_ICONS[item.equipStatus];
    return `<button class="pp-carry-button" type="button" data-action="toggleEquipped" data-item-id="${item.id}"
    title="Change how ${item.name} is carried"><i class="${equipIcon}"></i><span>${equipLabel}</span></button>`;
  }
}
