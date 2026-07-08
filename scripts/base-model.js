import { closeModal, openModal, renderInterfaceIcon, setting, state } from "./player-pilot.js";
import { escapeHtml, htmlToPlain, itemDisplayName, resolveNumericFormula } from "./utils.js";


export class BaseModel {

  static id = "base";
  static label = "Generic";

  get id() {
    return this.constructor.id;
  }

  get label() {
    return this.constructor.label;
  }

  summary = {};
  groups = {};

  static TABS = [
    {
      key: "stats",
      label: "Details",
      icon: "fa-chart-simple",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/stats-view.hbs",
      sectionHeader: { title: "Details", icon: renderInterfaceIcon("fa-chart-simple") },
    },
    {
      key: "actions",
      label: "Actions",
      icon: "fa-bolt",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/actions-view.hbs",
    },
    {
      key: "rolls",
      label: "Rolls",
      icon: "pp-die-d20",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/rolls-view.hbs",
    },
    {
      key: "spells",
      label: "Spells",
      icon: "fa-wand-magic-sparkles",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/spells-view.hbs",
    },
    {
      key: "inventory",
      label: "Inventory",
      icon: "fa-sack-xmark",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/inventory-view.hbs",
    },
    {
      key: "map",
      label: "Controls",
      icon: "fa-gamepad",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/map-view.hbs",
    },
  ];

  static SHELL_ACTIONS = {
    currencyDialog: function (_event, button) {
      game.playerPilot.model.openCurrencyDialog(button.dataset.denom);
    },
    toggleEquipped: function (_event, button) {
      game.playerPilot.model.toggleEquipped(button.dataset.itemId);
    },
  }

  setActor(actor) {
    if (this.actor === actor) return;
    this.actor = actor;
    this.refreshSummary();
  }

  refreshCache(actor) {
    this.actor = actor;

    const signature = this.actorModelSignature();
    if (this.cache && this.cache.signature === signature && this.cache.actorId === actor?.id) {
      return;
    }

    this.refreshGroups();
    this.refreshSummary();

    this.cache = { actorId: actor?.id, signature };
  }

  invalidateModelCache() {
    this.cache = null;
  }

  actorModelSignature() {
    if (!this.actor) return "";

    const actor = this.actor;
    const actorStamp = actor._stats?.modifiedTime ?? actor._source?._stats?.modifiedTime ?? actor._source?._stats?.lastModifiedTime ?? "";
    const itemStamps =
      actor.items.map((item) => `${item.id}:${item._stats?.modifiedTime ?? item._source?._stats?.modifiedTime ?? item._source?._stats?.lastModifiedTime ?? ""}`)
        .join("|");
    const effectsFingerprint = `${Array.from(actor.statuses).join(",")}:${(actor.effects).map((e) => `${e.id}:${e.img}`)}`;

    return `${actor.id}:${actorStamp}:${itemStamps}:${effectsFingerprint}`;
  }

  refreshSummary() {
    if (!this.actor) {
      this.summary = {
        name: "Actor",
        img: "icons/svg/mystery-man.svg",
      };
      return;
    }

    this.summary.name = this.actor.name;
    this.summary.type = this.actor.type;
    this.summary.img = this.actor.img;
  }

  refreshGroups() {
    const items = this.actor.items.map((item) => this.normalizeItem(item, item.type || "items"));
    this.refreshGroupsImpl(items);
  }

  refreshGroupsImpl(items) {
    this.refreshInventoryGroups(items);
    this.groups.actions = items.filter(this.itemBelongsInActions).sort((a, b) => a.name.localeCompare(b.name));
  }

  refreshInventoryGroups(items) {
    const filteredItems = items.filter(this.isInventoryItem);

    const groups = new Map();
    for (const item of filteredItems) {
      const key = item.containerName || (item.type === "backpack" ? item.name : "Carried");
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          icon: key === "Carried" ? "fas fa-hand" : "fas fa-box-open",
          count: 0,
          items: [],
        });
      }

      const group = groups.get(key);
      group.items.push(item);
      group.count = group.items.length;
    }

    const sortedGroups = [...groups.values()];
    sortedGroups.forEach(g => g.items.sort((a, b) => {
      return a.name.localeCompare(b.name);
    }));

    this.groups.inventory = sortedGroups;
  }

  normalizeItem(item, group = "items") {
    const system = item?.system ?? {};
    const quantity = system.quantity === undefined ? null : Number(system.quantity);
    return {
      id: item.id,
      name: itemDisplayName(item),
      type: item.type,
      group,
      img: item.img ?? "icons/svg/item-bag.svg",
      quantity: Number.isFinite(quantity) ? quantity : null,
      equippable: this.itemIsEquippable(item),
      equipped: this.itemIsEquipped(item),
      usable: this.itemCanBeUsed(item),
      ammoRequired: this.itemNeedsAmmo(item),
      targetInfo: this.itemTargetInfo(item),
      description: htmlToPlain(system.description?.value ?? system.description ?? ""),
      badges: this.itemBadges(item)
    };
  }

  itemIsEquippable(_item) {
    return false;
  }

  itemIsEquipped(_item) {
    return false;
  }

  itemCanBeUsed(item) {
    return !!item;
  }

  itemNeedsAmmo(_item) {
    return false;
  }

  itemTargetInfo(_item, _activityId = "") {
    return {
      count: 0,
      needsTarget: false,
      canTarget: true,
      allowSelf: true,
    };
  }

  itemBadges(item) {
    if (!item) return [];
    const badges = [];
    const qty = item.system.quantity;
    if (qty !== undefined && Number(qty) !== 1) badges.push(`qty ${qty}`);
    return badges.slice(0, 4);
  }

  isInventoryItem(_item) {
    return true;
  }

  itemBelongsInActions(_item) {
    return false;
  }

  quickFiltersForKey(view) {
    const quickFilters = {
      actions: [["all", "All", "fa-layer-group"]],
      inventory: [["all", "All", "fa-layer-group"]]
    };
    return quickFilters[view] ?? [];
  }

  filterAvailableTabs() {
    return this.constructor.TABS.filter(t => this.isTabAvailable(t));
  }

  isTabAvailable(tab) {
    return tab.key !== "map" || (state.scene?.mapControlsEnabled ?? setting("mapControlsEnabled", true)) === true;
  }

  getTab(key) {
    return this.constructor.TABS.find(t => t.key === key);
  }

  filterItemsForView(key, items = []) {
    return items.filter((item) => {
      if (!this.matchesSearch(item) || !this.matchesQuickFilter(key, item)) return false;
      return true;
    });
  }

  quickFilterFor(key) {
    const value = state.quickFilters?.[key];
    return Array.isArray(value) ? (value[0] ?? "all") : (value ?? "all");
  }

  selectedQuickFilters(key) {
    const value = state.quickFilters?.[key];
    if (Array.isArray(value)) return value.filter((entry) => entry && entry !== "all");
    return value && value !== "all" ? [value] : [];
  }

  isMultiFilterKey(key) {
    return ["inventory"].includes(key);
  }

  matchesSearch(item) {
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.type} ${item.badges?.join(" ") ?? ""}`.toLowerCase().includes(q);
  }

  matchesQuickFilter(key, item) {
    const filters = this.isMultiFilterKey(key) ? this.selectedQuickFilters(key) : [this.quickFilterFor(key)];
    if (!filters.length || filters.includes("all")) return true;
    return filters.some((filter) => this.matchesOneQuickFilter(key, filter, item));
  }

  matchesOneQuickFilter(_key, filter, item) {
    if (filter === "quantity") return item.quantity !== null;
    return item.type === filter || item.group === filter;
  }

  canUseItem() {
    return true;
  }

  async useItem(_actor, _item, _options = {}) {
  }

  abilityDisplayIcon(key) {
    return ({
      str: "fa-dumbbell",
      strength: "fa-dumbbell",
      dex: "fa-person-running",
      dexterity: "fa-person-running",
      con: "fa-heart-pulse",
      constitution: "fa-heart-pulse",
      int: "fa-brain",
      intelligence: "fa-brain",
      wis: "fa-eye",
      wisdom: "fa-eye",
      cha: "fa-masks-theater",
      charisma: "fa-masks-theater",
      perception: "fa-binoculars"
    })[String(key ?? "").toLowerCase()] ?? "fa-circle";
  }

  spellSlotChoices(_item) {
    return [];
  }

  spellPreparationSummary(_normalizedSpells = []) {
    return null;
  }

  concentrationWarning(_item) {
    return "";
  }

  ammoChoices(_item) {
    return [];
  }

  async rollCheck(kind, key) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<p><strong>${escapeHtml(this.actor.name)}</strong> requested ${escapeHtml(kind)} ${escapeHtml(key)}.</p>`
    });
  }

  restRecoveryLabel(_value) {
    return "";
  }

  itemUsesText(item) {
    const system = item?.system ?? {};
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

  currencyIcon(key) {
    return ({
      pp: "fa-gem",
      gp: "fa-coins",
      ep: "fa-circle",
      sp: "fa-coins",
      cp: "fa-circle-dot"
    })[String(key ?? "").toLowerCase()] ?? "fa-coins";
  }

  openCurrencyDialog(denom) {
    const actor = this.actor;
    const key = String(denom ?? "").trim();
    const currency = this.groups.currency.find(c => c.key === key);
    if (!actor || !currency) return;
    openModal(`
      <h2>${escapeHtml(currency.label)}</h2>
      <p>Current amount: ${escapeHtml(currency.current)}</p>
      <label>Change</label>
      <select class="pp-select" name="currencyMode">
        <option value="add">Add</option>
        <option value="subtract">Subtract</option>
      </select>
      <label>Amount</label>
      <input class="pp-search" type="number" min="0" step="1" inputmode="numeric" name="currencyAmount" placeholder="0">
      <div class="pp-dialog-actions">
        <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
        <button class="pp-button primary" type="button" data-modal-action="applyCurrency">Apply</button>
      </div>
    `, {
      applyCurrency: async (modal) => {
        const amount = Number(modal.querySelector("[name='currencyAmount']")?.value ?? NaN);
        if (!Number.isFinite(amount) || amount <= 0) {
          ui.notifications?.warn?.("Enter an amount greater than 0.");
          return;
        }
        const mode = modal.querySelector("[name='currencyMode']")?.value ?? "add";
        closeModal();
        await this.updateCurrency(currency.key, mode === "subtract" ? -amount : amount);
      }
    });
  }

  async updateCurrency(_key, _delta) {
  }

  equipButton(item) {
    if (!item.equippable) return "";
    return `<button class="pp-state-switch pp-equip-switch ${item.equipped ? "is-on" : "is-off"}"
    type="button" role="switch" aria-checked="${item.equipped ? "true" : "false"}"
    data-action="toggleEquipped" data-item-id="${escapeHtml(item.id)}" title="${item.equipped ? "Unequip" : "Equip"} ${escapeHtml(item.name)}"
    aria-label="${item.equipped ? "Unequip" : "Equip"} ${escapeHtml(item.name)}"><span class="pp-switch-knob"></span></button>`;
  }
}
