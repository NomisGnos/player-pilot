import { SUPPORT_URL, TABS, cachedModel, renderDieGlyph, renderInterfaceIcon, requestRest, rollCheck, setting, state, updateExhaustion } from "./player-pilot.js";
import { clamp } from "./utils.js";

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
      changeTab: function (event, button) {
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
      rollInitiative: async function (event, button) {
        const model = cachedModel(this.currentActor);
        if (model.adapter.id === "pf2e") {
          openPf2eInitiativeDialog();
        } else {
          await rollCheck("initiative", "initiative");
        }
      },
      exhaustion: async function (event, button) {
        await updateExhaustion(Number(button.dataset.delta ?? 0));
      },
      rest: async function (event, button) {
        await requestRest(button.dataset.rest ?? "short");
      },
    },
  };

  static PARTS = {
    header: { template: "modules/player-pilot/templates/player-pilot-shell/header.hbs" },
    tabs: { template: 'modules/player-pilot/templates/player-pilot-shell/tab-navigation.hbs' },
    body: { template: "modules/player-pilot/templates/player-pilot-shell/body.hbs" },
    footer: { template: "modules/player-pilot/templates/player-pilot-shell/footer.hbs" },
  };

  constructor(options = {}) {
    super(options);
  }


  prepareTabs(availableTabs) {
    return availableTabs.reduce((tabs, [key, label, icon]) => {
      const isActive = state.activeTab === key;
      tabs[key] = {
        id: key,
        label: label,
        icon: renderInterfaceIcon(icon),
        active: isActive,
      };
      return tabs;
    }, {});
  }

  async _prepareContext(options) {
    await super._prepareContext(options);

    const availableTabs = TABS.filter(([key]) => key !== "map" || (state.scene?.mapControlsEnabled ?? setting("mapControlsEnabled", true)) === true);
    if (!availableTabs.some(([key]) => key === state.activeTab)) state.activeTab = "actions";

    const ownedActors = game.actors.filter(a => a.isOwner);
    this.currentActor = this.getCurrentActor(ownedActors);

    const model = cachedModel(this.currentActor);
    const summary = model.summary;

    const initiativeRollText = model.adapter.id === " pf2e" ? "Choose an initiative skill and roll" : "Roll initiative";

    const sectionData = {
      stats: {
        title: "Details",
        icon: renderInterfaceIcon("fa-chart-simple"),
        count: model.adapter.label
      }
    };

    const statCards = [
      { key: "ac", icon: "fa-shield-halved", label: "Armor Class", value: summary.ac },
      { key: "speed", icon: "fa-person-running", label: "Speed", value: summary.speed },
      { key: "level", icon: "fa-star", label: "Level", value: summary.level ?? summary.resource ?? "-" },
      {
        key: "prof",
        icon: "pp-die-d20",
        label: model.adapter.id === "pf2e" ? "Modifiers" : (model.adapter.id === "dnd5e" ? "Proficiency" : "System"),
        value: summary.prof ?? summary.resource ?? "-"
      },
    ];

    const hpCurrent = Number(summary.hpValue ?? NaN);
    const hpMax = Number(summary.hpMax ?? NaN);
    const hpTemp = Math.max(0, Number(summary.hpTemp ?? 0) || 0);
    const hpData = {
      current: hpCurrent,
      max: hpMax,
      temp: hpTemp,
      tempWidth: clamp((hpTemp / Math.max(hpMax || hpTemp, 1)) * 100, 5, 100),
      pct: Number.isFinite(hpCurrent) && Number.isFinite(hpMax) && hpMax > 0 ? clamp((hpCurrent / hpMax) * 100, 0, 100) : 0,
      label: Number.isFinite(hpCurrent) && Number.isFinite(hpMax) ? `${hpCurrent} / ${hpMax}` : (summary.hp ?? "-"),
    };

    return {
      availableTabs,
      tabs: this.prepareTabs(availableTabs),
      showActorSelect: ownedActors.length > 1,
      ownedActors,
      currentActor: this.currentActor,
      state,
      model,
      summary,
      supportUrl: SUPPORT_URL,
      initiativeRollText,
      d20Icon: renderDieGlyph(20),
      statCards,
      activeTab: state.activeTab,
      sectionData,
      hpData,
    };
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
}