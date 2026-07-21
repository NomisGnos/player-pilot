import {
  SUPPORT_URL,
  applySearchFilter,
  isMultiFilterKey,
  queueRender,
  renderDieGlyph,
  renderInterfaceIcon,
  rollCheck,
  selectedQuickFilters,
  setting,
  showResultToast,
  state,
} from "./player-pilot.js";
import { chatViewContext, sendPlayerChat, setChatDraft, setChatRecipient } from "./chat-feed.js";
import { diceViewContext, previewDiceTheme, saveDiceSettings } from "./dice-overlay.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export class PlayerPilotShell extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "player-pilot-shell",
    classes: ["player-pilot-shell"],
    window: {
      frame: false,
      positioned: false
    },
    actions: {
      changeTab: function (_event, button) {
        const tab = button.dataset.tab;
        state.scrollBodyToTop = tab !== state.activeTab;
        state.activeTab = tab;
        state.search = "";
        state.navOpen = false;

        for (const t of this.element.querySelectorAll(`.pp-tab`)) {
          t.classList.toggle("active", t.dataset.tab === tab);
          if (foundry.utils.isElementInstanceOf(t, "button")) t.ariaSelected = `${t.dataset.tab === tab}`;
        }

        for (const section of this.element.querySelectorAll(`.tab`)) {
          section.classList.toggle("active", section.dataset.tab === tab);
        }

        this.render(true);
      },
      quickFilter: function (_event, button) {
        const key = button.dataset.filterKey ?? state.activeTab;
        const value = button.dataset.filter ?? "all";
        if (button.dataset.multi === "true" || isMultiFilterKey(key)) {
          const selected = new Set(selectedQuickFilters(key));
          if (value === "all") selected.clear();
          else if (selected.has(value)) selected.delete(value);
          else selected.add(value);
          state.quickFilters[key] = Array.from(selected);
        } else {
          state.quickFilters[key] = value;
        }
        queueRender();
      },
      rollCheck: async function (_event, button) {
        await rollCheck(button.dataset.kind ?? "", button.dataset.key ?? "");
      },
      saveDiceSettings: async function (event, button) {
        event.preventDefault();
        const form = button.closest("form");
        if (!form) return;
        await saveDiceSettings(form);
        showResultToast("Player dice updated");
        this.render(true);
      },
      previewDice: async function (event, button) {
        event.preventDefault();
        const form = button.closest("form");
        if (form) await saveDiceSettings(form);
        previewDiceTheme();
      }
    },
  };

  static PARTS = {
    header: { template: "modules/player-pilot/templates/player-pilot-shell/header.hbs" },
    tabs: { template: 'modules/player-pilot/templates/player-pilot-shell/tab-navigation.hbs' },
    body: { scrollable: [""] },
    footer: { template: "modules/player-pilot/templates/player-pilot-shell/footer.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this._onShellScroll = this.updateScrollTopButton.bind(this);
    this._onChatSubmit = this.handleChatSubmit.bind(this);
    this._onChatKeydown = this.handleChatKeydown.bind(this);
    this._onChatInput = this.handleChatInput.bind(this);
    this._onChatRecipientChange = this.handleChatRecipientChange.bind(this);
    this._onDicePlayerColorChange = this.handleDicePlayerColorChange.bind(this);
    this._scrollListenerElement = null;
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);

    const ownedActors = game.actors.filter(a => a.isOwner);
    this.currentActor = this.getCurrentActor(ownedActors);

    if (this.currentActor || ["chat", "settings"].includes(state.activeTab)) {
      const activeTab = game.playerPilot.model.getTab(state.activeTab);
      parts.body.template = activeTab.viewTemplate;
    } else {
      parts.body.template = "modules/player-pilot/templates/player-pilot-shell/views/no-player-view.hbs";
    }
    return parts;
  }

  prepareTabs(availableTabs) {
    return availableTabs.reduce((tabs, tab) => {
      const isActive = state.activeTab === tab.key;
      tabs[tab.key] = {
        id: tab.key,
        label: tab.label,
        icon: renderInterfaceIcon(tab.icon),
        active: isActive,
      };
      return tabs;
    }, {});
  }

  async _prepareContext(options) {
    await super._prepareContext(options);

    const ownedActors = game.actors.filter(a => a.isOwner);

    const model = game.playerPilot.model;
    model.refreshCache(this.currentActor);

    const availableTabs = model.filterAvailableTabs();
    let activeTab = model.getTab(state.activeTab);
    if (!activeTab) {
      state.activeTab = "actions";
      activeTab = model.getTab(state.activeTab);
    }

    const initiativeRollText = model.usesSpellRanks ? "Choose an initiative skill and roll" : "Roll initiative";

    const activeFilter = model.quickFilterFor(state.activeTab);
    const selectedFilters = new Set(model.selectedQuickFilters(state.activeTab));

    return {
      availableTabs,
      tabs: this.prepareTabs(availableTabs),
      activeTab,
      showActorSelect: ownedActors.length > 1,
      ownedActors,
      currentActor: this.currentActor,
      state,
      model,
      summary: model.summary,
      supportUrl: SUPPORT_URL,
      activeFilter,
      selectedFilters,
      initiativeRollText,
      d20Icon: renderDieGlyph(20),
      statCards: model.summary.statCards,
      ...chatViewContext(),
      ...diceViewContext(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    this.element.classList.toggle("pp-paused", !!game.paused);

    if (this._scrollListenerElement !== this.element) {
      this._scrollListenerElement?.removeEventListener("scroll", this._onShellScroll, true);
      this.element.addEventListener("scroll", this._onShellScroll, true);
      this._scrollListenerElement = this.element;
    }

    this.updateScrollTopButton();
    applySearchFilter();
    const chatForm = this.element.querySelector("[data-chat-composer]");
    chatForm?.addEventListener("submit", this._onChatSubmit);
    chatForm?.querySelector("textarea")?.addEventListener("keydown", this._onChatKeydown);
    chatForm?.querySelector("textarea")?.addEventListener("input", this._onChatInput);
    chatForm?.querySelector("select[name='recipient']")?.addEventListener("change", this._onChatRecipientChange);
    const diceForm = this.element.querySelector(".pp-dice-settings-page");
    diceForm?.querySelector("[name='usePlayerColor']")?.addEventListener("change", this._onDicePlayerColorChange);
    this.syncDiceColorLock(diceForm);
    if (state.activeTab === "chat" && state.chatScrollToBottom) {
      state.chatScrollToBottom = false;
      window.requestAnimationFrame(() => {
        const feed = this.element.querySelector("[data-chat-feed]");
        if (feed) feed.scrollTop = feed.scrollHeight;
      });
    }
  }

  _onClose(options) {
    this._scrollListenerElement?.removeEventListener("scroll", this._onShellScroll, true);
    this._scrollListenerElement = null;
    return super._onClose(options);
  }

  async handleChatSubmit(event) {
    event.preventDefault();
    await this.sendChatFromForm(event.currentTarget);
  }

  handleChatKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    event.currentTarget.closest("form")?.requestSubmit?.();
  }

  handleChatInput(event) {
    setChatDraft(event.currentTarget.value);
  }

  handleChatRecipientChange(event) {
    setChatRecipient(event.currentTarget.value);
  }

  handleDicePlayerColorChange(event) {
    this.syncDiceColorLock(event.currentTarget.closest("form"));
  }

  syncDiceColorLock(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const checkbox = form.querySelector("[name='usePlayerColor']");
    const color = form.querySelector("[name='diceColor']");
    const lock = form.querySelector("[data-dice-color-lock]");
    const locked = checkbox?.checked === true;
    if (color instanceof HTMLInputElement) {
      color.disabled = locked;
      color.ariaDisabled = String(locked);
      if (locked && /^#[0-9a-f]{6}$/i.test(color.dataset.playerColor ?? "")) color.value = color.dataset.playerColor;
    }
    if (lock instanceof HTMLElement) lock.hidden = !locked;
  }

  async sendChatFromForm(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const textarea = form.querySelector("textarea[name='message']");
    const recipient = form.querySelector("select[name='recipient']")?.value ?? "everyone";
    const sent = await sendPlayerChat({ text: textarea?.value, recipient, actor: this.currentActor });
    if (!sent || !(textarea instanceof HTMLTextAreaElement)) return;
    textarea.value = "";
    textarea.focus();
  }

  getCurrentActor(ownedActors) {
    if (!ownedActors.length) return null;
    if (!state.actorId) state.actorId = setting("lastActorId", "");
    if (state.actorId) {
      const current = ownedActors.find((actor) => actor.id === state.actorId);
      if (current) return current;
    }
    const representative = ownedActors.find((actor) => actor.id === game.user.character?.id);
    state.actorId = representative?.id ?? ownedActors[0].id;
    return representative ?? ownedActors[0];
  }

  updateScrollTopButton(_event) {
    //TODO: Add scroll to top button
    const body = this.element.querySelector(".pp-body");
    const button = this.element.querySelector(".pp-scroll-top");
    button?.classList.toggle("visible", (body?.scrollTop ?? 0) > 280);
  }
}
