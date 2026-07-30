// Integration with Better Rolls 2

import { closeModal, openModal } from "./player-pilot.js";

export function br2Available() {
  return !!(game.brsw && game.brsw.activateCardListeners && game.brsw.decorateCardHTML && game.brsw.dialog);
}

let chatCardSync = null; // { messageId, host, updateFn, observer }

function stopChatCardSync() {
  if (chatCardSync) {
    Hooks.off("updateChatMessage", chatCardSync.updateFn);
    chatCardSync.observer?.disconnect();
    chatCardSync = null;
  }
}

async function renderCardContent(message) {
  // Core's own chat log enriches message.content (@UUID links, inline rolls, etc.) as part of rendering it
  // BR2 stores the raw template output on the message, so we mirror that enrichment step here
  try {
    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(message.content, { relativeTo: message });
  } catch (err) {
    console.warn("Player Pilot | Failed to enrich BR2 card content", err);
    return message.content;
  }
}

function syncCardToMessage(brCard, host, message) {
  stopChatCardSync();

  const rebind = async () => {
    if (!document.body.contains(host)) {
      stopChatCardSync();
      return;
    }
    host.innerHTML = await renderCardContent(message);
    if (!document.body.contains(host)) return; // Modal could have closed while awaiting
    const freshCard = new game.brsw.BrCommonCard(message);
    game.brsw.activateCardListeners(freshCard, host, message);
    game.brsw.decorateCardHTML(freshCard, host, message);
  };

  const onUpdateChatMessage = (updatedMessage) => {
    if (updatedMessage.id !== message.id) return;
    rebind();
  };

  Hooks.on("updateChatMessage", onUpdateChatMessage);

  // The modal can also close via the background-click or native close-button paths, which don't call closeBR2RollModal().
  const observer = new MutationObserver(() => {
    if (!document.body.contains(host)) stopChatCardSync();
  });
  observer.observe(document.body, { childList: true });

  chatCardSync = { messageId: message.id, host, updateFn: onUpdateChatMessage, observer };
}

/**
 * @param {BrCommonCard} brCard
 */
export async function showBR2RollModal(brCard) {
  const message = brCard.message;
  if (!message) {
    console.warn("Player Pilot | BR2 card has no parent chat message yet");
    return;
  }

  const content = await renderCardContent(message);

  openModal(`
    <div class="pp-br2-modal">
      <div class="pp-br2-modal-header">
        <button class="pp-br2-icon-button" type="button" data-modal-action="close" title="Close">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
      <div class="pp-br2-card-host">${content}</div>
    </div>
  `, {}, { closeOnOutsideClick: false });

  const host = document.querySelector(".pp-br2-card-host");
  if (!host) return;

  game.brsw.activateCardListeners(brCard, host, message);
  game.brsw.decorateCardHTML(brCard, host, message);
  syncCardToMessage(brCard, host, message);
}

/**
 * Rolls an attribute through BR2 and shows it in a player-pilot modal.
 * @param {SwadeActor} actor
 * @param {string} attributeKey e.g. "agility"
 */
export async function openBR2AttributeRoll(actor, attributeKey) {
  const brCard = await game.brsw.createAttributeCard(actor, attributeKey);
  await showBR2RollModal(brCard);
}

/**
 * Rolls a skill through BR2 and shows it in a player-pilot modal.
 * @param {SwadeActor} actor
 * @param {string} skillId
 */
export async function openBR2SkillRoll(actor, skillId) {
  const brCard = await game.brsw.createSkillCardFromId(null, actor.id, skillId);
  await showBR2RollModal(brCard);
}

/**
 * Uses/rolls an item (weapon, power, etc.) through BR2 and shows it in a player-pilot modal.
 * @param {SwadeActor} actor
 * @param {Item} item
 */
export async function openBR2ItemRoll(actor, item) {
  const brCard = await game.brsw.createItemCardFromId(null, actor.id, item.id);
  await showBR2RollModal(brCard);
}

export function closeBR2RollModal() {
  stopChatCardSync();
  closeModal();
}

// When rendering the pp management dialog, we want to make it modal
// To do this, we insert a backdrop to block interaction
Hooks.on("renderApplicationV2", (app) => {
  if (app?.constructor?.name !== "PPManagementDialog") return;
  if (!document.body.classList.contains("player-pilot-modal-open")) return;
  if (app._ppBackdrop && document.body.contains(app._ppBackdrop)) return;

  const backdrop = document.createElement("div");
  backdrop.classList.add("pp-br2-dialog-backdrop");
  document.body.appendChild(backdrop);
  app._ppBackdrop = backdrop;
});

Hooks.on("closeApplicationV2", (app) => {
  if (app?.constructor?.name !== "PPManagementDialog") return;
  app._ppBackdrop?.remove();
  app._ppBackdrop = null;
});
