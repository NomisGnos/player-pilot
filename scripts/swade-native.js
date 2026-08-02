// Integration with SWADE's native roll flow

import { openModal, selectedTargetSet, state } from "./player-pilot.js";

const activeHooks = new Set();

function addHook(name, fn) {
  const hookId = Hooks.on(name, fn);
  activeHooks.add({ name, id: hookId });
}

function removeAllHooks() {
  for (const hook of activeHooks) {
    Hooks.off(hook.name, hook.id);
  };
  activeHooks.clear();
}

export async function openSwadeSkillRoll(actor, skillId) {
  const skill = actor.items.find(i => i.id === skillId);
  await runTraitRoll(skill.name, () => actor.rollSkill(skillId, {}));
}

export async function openSwadeAttributeRoll(actor, attribute) {
  const traitName = foundry.CONFIG.SWADE.attributes[attribute].long;
  await runTraitRoll(traitName, () => actor.rollAttribute(attribute, {}));
}

/**
 * Shows an item's chat card in a player-pilot modal.
 * The card stays open the whole time and each roll's result is appended below it
 * so the player can keep rolling without losing the card.
 */
export async function openSwadeItemCard(item) {
  const message = await item.show();
  if (!message) return;

  removeAllHooks();

  const modalRoot = openSwadeRollShell(`
    <div class="pp-swade-item-card-host"></div>
    <div class="pp-swade-result-list"></div>
  `);

  const cardHost = modalRoot.querySelector(".pp-swade-item-card-host");
  const resultsList = modalRoot.querySelector(".pp-swade-result-list");
  if (!cardHost || !resultsList) return;

  await renderItemCardInto(cardHost, modalRoot, message);

  addHook("createChatMessage", onCreateChatMessage);
  addHook("renderRollDialog", onRenderRollDialog);
  addHook("closeRollDialog", onCloseRollDialog);
  addHook("swadeCalculateDefaultAttackMods", onCalculateDefaultAttackMods);
}

async function renderItemCardInto(host, modalRoot, message) {
  const html = await message.system.renderHTML();

  // Move the item name into our modal header
  const itemNameHeading = html.querySelector(".item-name h3");
  const modalTitle = modalRoot.querySelector(".pp-swade-modal-title");
  if (itemNameHeading && modalTitle) {
    modalTitle.textContent = itemNameHeading.textContent;
  }

  host.innerHTML = "";
  host.appendChild(html);
}

function openSwadeRollShell(bodyHtml) {
  openModal(`
    <div class="pp-swade-modal">
      <div class="pp-swade-modal-header">
        <span class="pp-swade-modal-title"></span>
        <button class="pp-icon-button" type="button" data-modal-action="close" title="Close">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
      <div class="pp-swade-modal-content">
      ${bodyHtml}
      </div>
    </div>
  `, {}, { closeOnOutsideClick: false, onCloseModal });

  return document.querySelector(".pp-swade-modal");
}

export function onCloseModal() {
  removeAllHooks();
}

async function runTraitRoll(traitName, performRoll) {
  addHook("renderRollDialog", onRenderRollDialog);
  addHook("closeRollDialog", onCloseRollDialog);

  const roll = await performRoll();
  if (!roll?.messageId) {
    removeAllHooks();
    return; // Dialog was cancelled
  }

  const message = game.messages?.get(roll.messageId);
  if (!message) {
    removeAllHooks();
    return;
  }

  const modalRoot = openSwadeRollShell('<div class="pp-swade-result-list"></div>');
  const modalTitle = modalRoot.querySelector(".pp-swade-modal-title");
  if (modalTitle) {
    modalTitle.textContent = traitName;
  }

  const resultList = modalRoot.querySelector(".pp-swade-result-list");
  if (!resultList) return;
  await addRollResult(resultList, message);

  addHook("createChatMessage", onCreateChatMessage);
}

function onCreateChatMessage(message) {
  if (message.author !== game.user) return;
  if (!message.isRoll) return; // We only care about rolls
  const resultsList = document.querySelector(".pp-swade-result-list");
  if (resultsList) addRollResult(resultsList, message);
}

function onRenderRollDialog(app) {
  const oldClose = app.close.bind(app);
  app.close = (options) => oldClose({ ...options, animate: false });

  // When rendering the dialog, we want to make it modal
  // To do this, we insert a backdrop to block interaction
  if (!app._ppBackdrop || !document.body.contains(app._ppBackdrop)) {
    const backdrop = document.createElement("div");
    backdrop.classList.add("pp-br2-dialog-backdrop");
    document.body.appendChild(backdrop);
    app._ppBackdrop = backdrop;
  }

  positionModifiersDropdown(app);
  createToggleObserver(app);
}

/**
 * We want the modifiers dropdown to be anchored to the bottom of the header
 * This requires us to do a bit of shuffling to properly calculate and apply the position
 */
function positionModifiersDropdown(app) {
  const header = app.window?.header;
  const dropdown = app.element?.querySelector(".presets .dropdown");
  if (!header || !dropdown) return;

  //Zero the top so we can get the proper offset
  const previousTop = dropdown.style.top;
  dropdown.style.top = "0px";
  const actualOrigin = dropdown.getBoundingClientRect().top;
  dropdown.style.top = previousTop;

  const headerBottom = header.getBoundingClientRect().bottom;
  app.element.style.setProperty("--pp-roll-dialog-header-bottom", `${headerBottom - actualOrigin}px`);
}

/**
 * The dropdown is a full-height overlay which covers the toggle button that's normally used to open/close it
 * While the dropdown is open, move the button inside the dropdown so it's still usable
 */
function createToggleObserver(app) {
  const presets = app.element.querySelector(".presets");
  const dropdown = presets?.querySelector(".dropdown");
  const toggleButton = presets?.querySelector(".toggle-list");
  if (!dropdown || !toggleButton) return;
  if (dropdown._ppToggleConfigured) return;
  dropdown._ppToggleConfigured = true;

  const positionToggleButton = () => {
    if (dropdown.classList.contains("collapsed")) {
      presets.insertBefore(toggleButton, dropdown);
    } else {
      dropdown.insertBefore(toggleButton, dropdown.firstElementChild);
    }
  };

  app._ppToggleObserver?.disconnect();
  app._ppToggleObserver = new MutationObserver(positionToggleButton).observe(dropdown, {
    attributes: true,
    attributeFilter: ["class"]
  });
}

function onCloseRollDialog(app) {
  app._ppBackdrop?.remove();
  app._ppBackdrop = null;
  app._ppToggleObserver?.disconnect();
  app._ppToggleObserver = null;
}

async function addRollResult(resultsList, message) {
  await setTargetsFlag(message);
  const block = document.createElement("div");
  block.className = "pp-swade-result-block";
  resultsList.appendChild(block);

  const html = await message.renderHTML();
  block.innerHTML = "";
  block.appendChild(html);

  //Scroll to the bottom so we can see the new result
  window.requestAnimationFrame(() => {
    const modalContent = document.querySelector(".pp-dialog");
    if (modalContent) modalContent.scrollTop = modalContent.scrollHeight;
  });
}

/**
 * Native SWADE messages contain a flag that stores the selected targets
 * Grab our selected targets, convert it into that flag, and set it on our message
 */
async function setTargetsFlag(message) {
  if ((message.getFlag("swade", "targets") ?? []).length) return;

  const sceneId = state.scene?.id ?? "";
  if (!sceneId) return;

  const targetUuids = selectedTargetSet(sceneId);
  if (!targetUuids.size) return;

  const targets = (state.scene?.tokens ?? [])
    .filter((token) => targetUuids.has(String(token.uuid)))
    .map((token) => ({ name: token.name, uuid: token.uuid }));

  if (!targets.length) return;
  await message.setFlag("swade", "targets", targets);
}


function resolveOurTargetTokenDocument() {
  const sceneId = state.scene?.id ?? "";
  if (!sceneId) return undefined;
  const ids = selectedTargetSet(sceneId);
  const tokenId = ids.values().next().value; // matches game.user.targets.first()
  if (!tokenId) return undefined;
  return fromUuidSync(tokenId);
}

function onCalculateDefaultAttackMods(sourceToken, targetToken, _skill, item, isRangedAttack, isMeleeAttack, additionalMods, bestNonStackingMods) {
  if (targetToken) return;
  const ourTarget = resolveOurTargetTokenDocument();
  if (!ourTarget) return;

  const sceneId = state.scene?.id ?? "";
  const ourSource = sourceToken ?? game.scenes?.get(sceneId)?.tokens?.find((t) => t.actorId === item?.actor?.id);

  const computed = game.swade.util.getDefaultAttackModifiers(ourSource, ourTarget, item, isRangedAttack, isMeleeAttack);
  additionalMods.push(...computed.additionalMods);
  Object.assign(bestNonStackingMods, computed.bestNonStackingMods);
}
