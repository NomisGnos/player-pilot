import { escapeHtml } from "./utils.js";

const MAX_CHAT_MESSAGES = 40;

const chatState = {
  entries: [],
  selectedRecipient: "everyone",
  draft: "",
  onChange: null,
  onRollMessage: null,
  renderVersions: new Map()
};

function usersArray() {
  return Array.from(game.users ?? []);
}

function visibleMessage(message) {
  return !!message && message.visible !== false;
}

function sanitizeRenderedMessage(html) {
  const root = html instanceof HTMLElement ? html.cloneNode(true) : document.createElement("article");
  root.classList.add("pp-chat-card-copy");
  root.setAttribute("inert", "");
  root.setAttribute("aria-disabled", "true");
  root.removeAttribute("id");

  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes ?? [])) {
      const name = attribute.name.toLowerCase();
      if (name === "id" || name === "contenteditable" || name === "draggable" || name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
      if (["data-action", "data-control", "data-event", "formaction"].includes(name)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      element.removeAttribute("href");
      element.removeAttribute("target");
      element.setAttribute("role", "text");
    }
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.disabled = true;
      element.tabIndex = -1;
      element.removeAttribute("name");
    }
  }
  return root.outerHTML;
}

async function renderEntry(message) {
  const id = String(message?.id ?? "");
  if (!id || !visibleMessage(message)) return null;
  const version = Number(chatState.renderVersions.get(id) ?? 0) + 1;
  chatState.renderVersions.set(id, version);
  try {
    const html = await message.renderHTML({ canClose: false, canDelete: false });
    if (chatState.renderVersions.get(id) !== version) return null;
    return {
      id,
      timestamp: Number(message.timestamp ?? Date.now()),
      html: sanitizeRenderedMessage(html)
    };
  } catch (err) {
    console.warn("Player Pilot could not render a chat message.", err);
    return {
      id,
      timestamp: Number(message.timestamp ?? Date.now()),
      html: `<article class="message pp-chat-card-copy" inert aria-disabled="true"><div class="message-content">${escapeHtml(message.alias ?? "Chat message")}</div></article>`
    };
  }
}

function notifyChanged({ scrollToBottom = false } = {}) {
  chatState.onChange?.({ scrollToBottom });
}

export function configureChatFeed({ onChange, onRollMessage } = {}) {
  chatState.onChange = typeof onChange === "function" ? onChange : null;
  chatState.onRollMessage = typeof onRollMessage === "function" ? onRollMessage : null;
}

export async function hydrateChatFeed() {
  const messages = Array.from(game.messages ?? [])
    .filter(visibleMessage)
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0))
    .slice(-MAX_CHAT_MESSAGES);
  const entries = (await Promise.all(messages.map(renderEntry))).filter(Boolean);
  chatState.entries = entries.slice(-MAX_CHAT_MESSAGES);
  notifyChanged({ scrollToBottom: true });
}

export async function captureChatMessage(message, { scrollToBottom = true } = {}) {
  if (!visibleMessage(message)) return;
  chatState.onRollMessage?.(message);
  const entry = await renderEntry(message);
  if (!entry) return;
  const current = chatState.entries.findIndex((candidate) => candidate.id === entry.id);
  if (current >= 0) chatState.entries[current] = entry;
  else chatState.entries.push(entry);
  chatState.entries.sort((a, b) => a.timestamp - b.timestamp);
  chatState.entries = chatState.entries.slice(-MAX_CHAT_MESSAGES);
  notifyChanged({ scrollToBottom });
}

export function removeChatMessage(message) {
  const id = String(message?.id ?? message ?? "");
  chatState.renderVersions.delete(id);
  const next = chatState.entries.filter((entry) => entry.id !== id);
  if (next.length === chatState.entries.length) return;
  chatState.entries = next;
  notifyChanged();
}

export function chatViewContext() {
  const activeUsers = usersArray().filter((user) => user.active);
  const activeGms = activeUsers.filter((user) => user.isGM);
  const directUsers = activeUsers
    .filter((user) => user.id !== game.user?.id)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const validValues = new Set(["everyone", "gm", ...directUsers.map((user) => `user:${user.id}`)]);
  if (!validValues.has(chatState.selectedRecipient)) chatState.selectedRecipient = "everyone";
  const recipients = [
    { value: "everyone", label: "Everyone", selected: chatState.selectedRecipient === "everyone", disabled: false },
    { value: "gm", label: activeGms.length === 1 ? `GM: ${activeGms[0].name}` : `All online GMs (${activeGms.length})`, selected: chatState.selectedRecipient === "gm", disabled: activeGms.length === 0 },
    ...directUsers.map((user) => ({
      value: `user:${user.id}`,
      label: `${user.isGM ? "GM" : "Player"}: ${user.name}`,
      selected: chatState.selectedRecipient === `user:${user.id}`,
      disabled: false
    }))
  ];
  return {
    chatMessages: chatState.entries,
    chatRecipients: recipients,
    chatDraft: chatState.draft,
    chatHasMessages: chatState.entries.length > 0
  };
}

export function setChatDraft(value = "") {
  chatState.draft = String(value ?? "").slice(0, 2000);
}

export function setChatRecipient(value = "everyone") {
  chatState.selectedRecipient = String(value || "everyone");
}

export async function sendPlayerChat({ text, recipient = "everyone", actor = null } = {}) {
  const contentText = String(text ?? "").trim().slice(0, 2000);
  if (!contentText) return false;
  const activeUsers = usersArray().filter((user) => user.active);
  let whisper = [];
  let recipientLabel = "Everyone";

  if (recipient === "gm") {
    const gms = activeUsers.filter((user) => user.isGM);
    if (!gms.length) {
      ui.notifications?.warn?.("No GM is online.");
      return false;
    }
    whisper = gms.map((user) => user.id);
    recipientLabel = gms.length === 1 ? gms[0].name : "Online GMs";
  } else if (String(recipient).startsWith("user:")) {
    const userId = String(recipient).slice(5);
    const target = activeUsers.find((user) => user.id === userId);
    if (!target) {
      ui.notifications?.warn?.("That user is no longer online.");
      return false;
    }
    whisper = [target.id];
    recipientLabel = target.name;
  }

  chatState.selectedRecipient = String(recipient);
  const content = `<p class="pp-player-chat-text">${escapeHtml(contentText).replace(/\r?\n/g, "<br>")}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
    content,
    flags: {
      "player-pilot": {
        playerChat: true,
        recipientLabel
      }
    }
  });
  chatState.draft = "";
  return true;
}
