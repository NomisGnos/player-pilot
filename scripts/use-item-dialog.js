import { itemDisplayName } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class UseItemDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "player-pilot-use-item",
    tag: "section",
    classes: ["pp-modal"],
    window: {
      frame: false,
      positioned: false
    },
    actions: {
      close: function () {
        this.close();
      },
      nextActivityStep: function () {
        return this.nextActivityStep();
      },
      modalToggleTarget: function (_event, button) {
        return this.toggleTarget(button);
      },
      nextTargetStep: function () {
        return this.nextTargetStep();
      },
      castSpell: function () {
        return this.castSpell();
      },
      use: function () {
        return this.use();
      },
      manualInstruction: function (_event, button) {
        this.services.openManualRollDialog(button.dataset);
      },
      autoInstruction: function (_event, button) {
        return this.services.autoRollInstruction(this.item, button.dataset, { button });
      },
      nativeInstruction: function (_event, button) {
        return this.services.runNativeItemRoll(
          this.item,
          button.dataset.nativeAction ?? "",
          button.dataset.castRank,
          button.dataset.attackNumber
        );
      },
      goToPing: function () {
        this.close();
        this.services.openPingOnMap();
      }
    }
  };

  static PARTS = {
    content: {
      template: "modules/player-pilot/templates/use-item-dialog.hbs"
    }
  };

  constructor({ actor, item, model, activeConcentration = null, services }) {
    super();
    this.actor = actor;
    this.item = item;
    this.model = model;
    this.activeConcentration = activeConcentration;
    this.services = services;

    this.slots = model.spellSlotChoices(item);
    this.ammo = model.ammoChoices?.(item) ?? [];
    this.concentration = model.concentrationWarning?.(item) ?? "";
    this.normalized = model.normalizeItem(item);
    this.activities = model.usableItemActivities?.(item) ?? [];
    this.playerChoice = model.itemPlayerChoice?.(item) ?? null;
    this.activityStep = this.activities.length > 1 || !!this.playerChoice;
    this.defaultActivityId = this.activities[0]?.id ?? "";
    this.defaultCastLevel = this.slots[0]?.level
      ?? (item.type === "spell" ? (model.usesSpellRanks ? model.pf2eSpellRank(item) : "") : "");
    this.baseCastLevel = item.type === "spell"
      ? (model.usesSpellRanks ? model.pf2eSpellRank(item) : Number(item.system?.level ?? 0))
      : "";
    this.instructions = this.collectInstructions({
      castLevel: this.defaultCastLevel,
      activityId: this.defaultActivityId
    });
    this.sneakAttack = model.id === "dnd5e" && item.type === "weapon"
      ? services.getSneakAttackOption(actor)
      : null;
    this.targetInfo = this.targetInfoFor(this.defaultActivityId);
    this.targetStep = this.targetInfo.needsTarget || this.targetInfo.canTarget;
    this.spellStep = item.type === "spell" && (!model.usesSpellRanks || this.slots.length > 0);
  }

  get root() {
    return this.element;
  }

  collectInstructions(options = {}) {
    return this.model.collectRollInstructions?.(this.item, options) ?? [];
  }

  baseInstructionsFor(activityId = "") {
    return this.collectInstructions({
      castLevel: this.baseCastLevel,
      activityId
    });
  }

  hasFollowupRolls(entries = []) {
    return entries.some((entry) => entry.formula || entry.nativeAction);
  }

  targetInfoFor(activityId = "") {
    return this.model.itemTargetInfo(this.item, activityId);
  }

  rangeFeetFor(activityId = "") {
    return this.model.getItemRangeFeet?.(this.item, activityId);
  }

  staticCastLabel() {
    if (this.model.usesSpellRanks && this.model.pf2eIsCantrip(this.item)) return "Cantrip";
    if (Number(this.defaultCastLevel ?? 0) > 0) {
      return `${this.model.usesSpellRanks ? "Spell Rank" : "Spell Level"} ${this.defaultCastLevel}`;
    }
    return "Cantrip";
  }

  castPreview(instructions, castLevel, activityId) {
    return this.services.renderCastPreview(
      instructions,
      castLevel,
      this.model.id,
      this.baseInstructionsFor(activityId),
      this.baseCastLevel
    );
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    const initialRolls = !this.activityStep && !this.targetStep && !this.spellStep;
    return {
      itemName: itemDisplayName(this.item),
      activityStep: this.activityStep,
      showActivitySelect: this.activities.length > 1,
      activities: this.activities,
      playerChoice: this.playerChoice,
      targetStep: this.targetStep,
      targetInstruction: this.services.targetInstructionText(this.targetInfo),
      targetPickerHtml: this.services.renderModalTargetPicker({
        ...this.normalized,
        targetInfo: this.targetInfo,
        rangeFeet: this.rangeFeetFor(this.defaultActivityId)
      }, "data-action"),
      spellStep: this.spellStep,
      concentration: this.concentration,
      isPf2e: this.model.usesSpellRanks,
      slots: this.slots,
      defaultCastLevel: this.defaultCastLevel,
      staticCastLabel: this.staticCastLabel(),
      castPreviewHtml: this.castPreview(this.instructions, this.defaultCastLevel, this.defaultActivityId),
      ammo: this.ammo,
      initialRolls,
      sneakAttackHtml: this.sneakAttack
        ? this.services.renderSneakAttackChoice(
          this.sneakAttack,
          this.services.assessSneakAttackApplicability(this.actor, this.item, this.defaultActivityId)
        )
        : "",
      rollInstructionsHtml: this.services.renderRollInstructions(this.instructions, true, "data-action"),
      castButtonLabel: this.hasFollowupRolls(this.instructions)
        ? "Use Spell & Continue to Rolls"
        : "Use Spell",
      outOfTurnWarning: this.services.outOfTurnWarning?.(this.actor) ?? ""
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.services.setActiveModal(this);
    this._onChange = this.handleChange.bind(this);
    this._onBackdropClick = (event) => {
      if (event.target === this.element) this.close();
    };
    this.element.addEventListener("change", this._onChange);
    this.element.addEventListener("click", this._onBackdropClick);
  }

  _onClose(options) {
    this.element?.removeEventListener("change", this._onChange);
    this.element?.removeEventListener("click", this._onBackdropClick);
    this.services.clearActiveModal(this);
    return super._onClose(options);
  }

  ensureNotPaused() {
    if (!this.services.pilotPaused()) return true;
    this.services.warnPaused();
    return false;
  }

  readUseOptions() {
    const useSneakAttack = this.sneakAttack
      && this.root.querySelector("[name='useSneakAttack']")?.checked === true;
    const activityId = this.root.querySelector("[name='activityId']")?.value ?? this.defaultActivityId;
    const activity = this.activities.find((entry) => entry.id === activityId);
    return {
      activityId,
      activityName: activity?.name ?? "",
      playerChoice: this.root.querySelector("[name='playerChoice']")?.value ?? "",
      playerChoiceLabel: this.playerChoice?.label ?? "",
      castLevel: this.root.querySelector("[name='castLevel']")?.value ?? this.defaultCastLevel ?? "",
      ammoItemId: this.root.querySelector("[name='ammoItemId']")?.value ?? "",
      sneakAttackFormula: useSneakAttack ? this.sneakAttack.formula : "",
      replaceConcentrationEffectId: this.activeConcentration?.id ?? ""
    };
  }

  refreshSneakAttackChoice(activityId = this.defaultActivityId) {
    if (!this.sneakAttack) return null;
    const control = this.root.querySelector("[data-sneak-attack-control]");
    if (!(control instanceof HTMLElement)) return null;
    const checked = control.querySelector("[name='useSneakAttack']")?.checked === true;
    const assessment = this.services.assessSneakAttackApplicability(this.actor, this.item, activityId);
    control.innerHTML = this.services.renderSneakAttackChoice(this.sneakAttack, assessment, checked);
    return assessment;
  }

  refreshRollInstructions() {
    const activityId = this.root.querySelector("[name='activityId']")?.value ?? this.defaultActivityId;
    this.refreshSneakAttackChoice(activityId);
    const options = this.readUseOptions();
    const currentInstructions = this.collectInstructions(options);
    const wrap = this.root.querySelector("[data-roll-instructions]");
    if (wrap) {
      wrap.innerHTML = this.services.renderRollInstructions(currentInstructions, true, "data-action");
    }
    const castButton = this.root.querySelector("[data-action='castSpell']");
    if (castButton) {
      castButton.textContent = this.hasFollowupRolls(currentInstructions)
        ? "Use Spell & Continue to Rolls"
        : "Use Spell";
    }
    const preview = this.root.querySelector("[data-cast-preview]");
    if (preview) {
      preview.innerHTML = this.castPreview(currentInstructions, options.castLevel, options.activityId);
    }
    return { options, currentInstructions };
  }

  async finishUseFlow(options, currentInstructions) {
    await this.services.useItem(this.item.id, options, { showReminder: false });
    const placementNeeded = this.services.itemRequiresMapPlacement(this.item, options.activityId);
    if (!this.hasFollowupRolls(currentInstructions) && !placementNeeded) {
      await this.close();
      return;
    }

    this.root.querySelectorAll("[data-use-step]").forEach((step) => step.classList.add("hidden"));
    this.root.querySelector("[data-use-step='rolls']")?.classList.remove("hidden");
    const title = this.root.querySelector("[data-rolls-heading-title]");
    const detail = this.root.querySelector("[data-rolls-heading-detail]");
    if (title && placementNeeded && !this.hasFollowupRolls(currentInstructions)) {
      title.textContent = "Placement Needed";
    }
    if (detail && placementNeeded) {
      detail.textContent = this.hasFollowupRolls(currentInstructions)
        ? "After resolving the rolls below, ping the map so the GM knows where to place the effect."
        : "Ping the map so the GM knows where to place the effect.";
    }
    this.root.querySelector("[data-placement-prompt]")?.classList.toggle("hidden", !placementNeeded);
    this.root.querySelectorAll(".pp-dialog-actions [data-action]:not([data-action='close'])")
      .forEach((button) => button.classList.add("hidden"));
    const finalButton = this.root.querySelector("[data-final-done]");
    if (finalButton instanceof HTMLElement) {
      finalButton.dataset.action = placementNeeded ? "goToPing" : "close";
      finalButton.textContent = placementNeeded ? "Ping On Map" : "Done";
      finalButton.classList.remove("hidden");
    }
  }

  async nextActivityStep() {
    const { options } = this.refreshRollInstructions();
    this.targetInfo = this.targetInfoFor(options.activityId);
    this.targetStep = this.targetInfo.needsTarget || this.targetInfo.canTarget;
    this.root.querySelector("[data-use-step='activity']")?.classList.add("hidden");
    this.root.querySelector("[data-action='nextActivityStep']")?.classList.add("hidden");

    const summary = this.root.querySelector("[data-modal-target-summary]");
    if (summary) summary.textContent = this.services.targetInstructionText(this.targetInfo);
    const picker = this.root.querySelector("[data-modal-target-picker]");
    if (picker) {
      picker.innerHTML = this.services.renderModalTargetPicker({
        ...this.normalized,
        targetInfo: this.targetInfo,
        rangeFeet: this.rangeFeetFor(options.activityId)
      }, "data-action");
    }

    if (this.targetStep) {
      this.root.querySelector("[data-use-step='targets']")?.classList.remove("hidden");
      this.root.querySelector("[data-action='nextTargetStep']")?.classList.remove("hidden");
    } else if (this.spellStep) {
      this.root.querySelector("[data-use-step='cast']")?.classList.remove("hidden");
      this.root.querySelector("[data-action='castSpell']")?.classList.remove("hidden");
    } else {
      await this.finishUseFlow(options, this.collectInstructions(options));
    }
  }

  async toggleTarget(button) {
    if (!this.ensureNotPaused()) return;
    if (button?.disabled || button?.dataset?.disabled === "true") return;

    const tokenId = button?.dataset?.tokenId ?? "";
    const sceneId = this.services.sceneId();
    const selected = this.services.selectedTargetSet(sceneId);
    if (selected.has(tokenId)) {
      selected.delete(tokenId);
    } else {
      const limit = Number(this.targetInfo.count ?? 0);
      if (Number.isFinite(limit) && limit > 0 && selected.size >= limit) {
        if (limit === 1) selected.clear();
        else {
          ui.notifications?.warn?.(`Select up to ${limit} targets.`);
          return;
        }
      }
      selected.add(tokenId);
    }

    this.services.setSelectedTargetSet(sceneId, selected);
    this.services.applyTargetsForCurrentUser(Array.from(selected), sceneId);
    for (const targetButton of this.root.querySelectorAll("[data-action='modalToggleTarget'][data-token-id]")) {
      const selectedNow = selected.has(String(targetButton.dataset.tokenId ?? ""));
      targetButton.closest(".pp-token-row")?.classList.toggle("selected", selectedNow);
      targetButton.classList.toggle("primary", selectedNow);
      targetButton.textContent = selectedNow ? "Targeted" : "Target";
    }
    this.services.updateModalTargetCount(selected.size, this.targetInfo);
    this.refreshSneakAttackChoice(
      this.root.querySelector("[name='activityId']")?.value ?? this.defaultActivityId
    );
    this.services.sendSocket("targetUpdate", {
      actorId: this.services.actorId(),
      sceneId,
      targetIds: Array.from(selected)
    });
  }

  async nextTargetStep() {
    if (!this.ensureNotPaused()) return;
    const current = this.services.selectedTargetSet(this.services.sceneId());
    if (this.targetInfo.needsTarget && current.size <= 0) {
      ui.notifications?.warn?.("Choose a target first.");
      return;
    }
    this.root.querySelector("[data-use-step='targets']")?.classList.add("hidden");
    this.root.querySelector("[data-action='nextTargetStep']")?.classList.add("hidden");
    if (this.spellStep) {
      this.root.querySelector("[data-use-step='cast']")?.classList.remove("hidden");
      this.root.querySelector("[data-action='castSpell']")?.classList.remove("hidden");
    } else {
      const { options, currentInstructions } = this.refreshRollInstructions();
      await this.finishUseFlow(options, currentInstructions);
    }
  }

  async castSpell() {
    if (!this.ensureNotPaused()) return;
    const { options, currentInstructions } = this.refreshRollInstructions();
    await this.finishUseFlow(options, currentInstructions);
  }

  async use() {
    if (!this.ensureNotPaused()) return;
    const { options } = this.refreshRollInstructions();
    await this.finishUseFlow(options, this.collectInstructions(options));
  }

  handleChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === "useSneakAttack") {
      this.refreshRollInstructions();
      return;
    }
    if (target instanceof HTMLSelectElement && ["activityId", "castLevel"].includes(target.name)) {
      this.refreshRollInstructions();
    }
  }
}
