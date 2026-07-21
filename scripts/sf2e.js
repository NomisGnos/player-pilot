import { PF2eModel } from "./pf2e.js";
import { mergeTabs, numberText } from "./utils.js";

export class SF2eModel extends PF2eModel {
  static id = "sf2e";
  static label = "SF2e";
  static rulesFamily = "paizo2e";

  static TABS = mergeTabs(PF2eModel.TABS, [
    {
      key: "stats",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/sf2e/stats-view.hbs",
    },
    {
      key: "actions",
      viewTemplate: "modules/player-pilot/templates/player-pilot-shell/views/sf2e/actions-view.hbs",
    },
    { key: "rolls" },
    { key: "spells" },
    { key: "inventory" },
    { key: "chat" },
    { key: "settings" },
    { key: "map" },
  ]);

  refreshSummary() {
    super.refreshSummary();
    if (!this.actor) return;
    this.summary.resource = "SF2e";
    const stamina = this.actor.system?.attributes?.hp?.sp ?? this.actor.system?.attributes?.sp ?? null;
    const value = Number(stamina?.value ?? 0);
    const max = Number(stamina?.max ?? value);
    this.summary.stamina = stamina ? {
      value: numberText(value),
      max: numberText(max),
      display: `${numberText(value)} / ${numberText(max)}`,
      pct: max > 0 ? (value / max) * 100 : 0
    } : null;
    const resolve = this.actor.system?.resources?.resolve ?? null;
    this.summary.resolve = resolve ? {
      value: numberText(resolve.value),
      max: numberText(resolve.max ?? resolve.value)
    } : null;
    this.refreshStatCards();
  }
}
