// Integration with SWADE's native roll flow

import { closeModal, openModal, selectedTargetSet, state } from "./player-pilot.js";

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

  unhookCreateListener();
  const modalRoot = openSwadeRollShell(`
    <div class="pp-swade-item-card-host"></div>
    <div class="pp-swade-result-list"></div>
  `);

  const cardHost = modalRoot.querySelector(".pp-swade-item-card-host");
  const resultsList = modalRoot.querySelector(".pp-swade-result-list");
  if (!cardHost || !resultsList) return;

  await renderItemCardInto(cardHost, modalRoot, message);

  Hooks.on("createChatMessage", onCreateChatMessage);
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
  `, {}, { closeOnOutsideClick: false });

  // The modal's own close button/background-click paths call closeModal() directly,
  // so watch for it leaving the DOM instead of relying on a callback.
  const modalRoot = document.querySelector(".pp-swade-modal");
  if (modalRoot) {
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modalRoot)) {
        unhookCreateListener();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }
  return modalRoot;
}

export function closeSwadeRollModal() {
  unhookCreateListener();
  closeModal();
}

async function runTraitRoll(traitName, performRoll) {
  const roll = await performRoll();
  if (!roll?.messageId) return; // dialog was cancelled

  const message = game.messages?.get(roll.messageId);
  if (!message) return;

  unhookCreateListener();

  const modalRoot = openSwadeRollShell('<div class="pp-swade-result-list"></div>');
  const modalTitle = modalRoot.querySelector(".pp-swade-modal-title");
  if (modalTitle) {
    modalTitle.textContent = traitName;
  }

  const resultList = modalRoot.querySelector(".pp-swade-result-list");
  if (!resultList) return;
  await addRollResult(resultList, message);

  Hooks.on("createChatMessage", onCreateChatMessage);
}

function onCreateChatMessage(message) {
  if (message.author !== game.user) return;
  if (!message.isRoll) return; // We only care about rolls
  const resultsList = document.querySelector(".pp-swade-result-list");
  if (resultsList) addRollResult(resultsList, message);
}

function unhookCreateListener() {
  Hooks.off("createChatMessage", onCreateChatMessage);
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
    const modalContent = document.querySelector(".pp-swade-modal-content");
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