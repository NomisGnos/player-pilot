import { BaseModel } from "./base-model.js";
import { DND5E_ABILITIES, DnD5eModel } from "./dnd5e.js";
import { PF2eModel } from "./pf2e.js";
import { PlayerPilotShell } from "./player-pilot-shell.js";
import { SwadeModel } from "./swade.js";
import { UseItemDialog } from "./use-item-dialog.js";
import {
  asArray,
  capitalizeWords,
  clamp,
  cleanFoundrySyntax,
  cleanRulesText,
  escapeHtml,
  fieldText,
  formatActionTime,
  hasItemProperty,
  htmlToPlain,
  itemDisplayName,
  localize,
  signedMod,
  unitLabel
} from "./utils.js";

const MODULE_ID = "player-pilot";
const SOCKET = `module.${MODULE_ID}`;
const OWNER = 3;
const CORE_ICON_ROOT = "icons/svg";
const GAME_ICON_DICE_ROOT = `modules/${MODULE_ID}/assets/game-icons/dice`;
const MANAGED_NO_CANVAS_KEY = `${MODULE_ID}.managedCoreNoCanvas`;
const MANAGED_NO_CANVAS_RELOAD_KEY = `${MODULE_ID}.managedCoreNoCanvasReloadAt`;
const GM_MAP_TOGGLE_POSITION_KEY = `${MODULE_ID}.gmMapTogglePosition`;
export const SUPPORT_URL = "https://www.patreon.com/cw/nomisDM";
const BOOT_MIN_VISIBLE_MS = 1800;
const BOOT_READY_HOLD_MS = 1200;
const BOOT_PROGRESS_INTERVAL_MS = 250;
const BOOT_INITIAL_DRIFT_MS = 18000;
const BOOT_MIN_DRIFT_MS = 30000;
const BOOT_MAX_DRIFT_MS = 60000;
const STARTUP_NOTICE_LIFETIME_MS = 10000;
const MOVEMENT_DIRECTIONS = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];
const PLAYER_SEATS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const PLAYER_SEAT_LABELS = {
  n: "Top",
  ne: "Top right",
  e: "Right",
  se: "Bottom right",
  s: "Bottom",
  sw: "Bottom left",
  w: "Left",
  nw: "Top left"
};
const PLAYER_SEAT_UP_STEPS = {
  n: 4,
  ne: 5,
  e: 6,
  se: 7,
  s: 0,
  sw: 1,
  w: 2,
  nw: 3
};
let noCanvasNeedsReload = false;

const bootState = {
  enabled: false,
  screen: null,
  progress: 6,
  displayedProgress: 6,
  fakeCeiling: 31,
  label: 'Starting Foundry...',
  mountedAt: 0,
  lastStageAt: 0,
  driftStart: 6,
  driftTarget: 31,
  driftStartedAt: 0,
  driftDurationMs: BOOT_INITIAL_DRIFT_MS,
  driftVersion: 0,
  timer: null,
  mountTimer: null,
  revealTimer: null,
  finishing: false,
  observer: null
};

function parseStoredSettingValue(source, fallback) {
  let value = source?._source?.value ?? source?.value ?? source;
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (_err) {
      // Plain strings such as activation modes are valid stored values.
    }
  }
  return value;
}

function storedWorldSetting(key, fallback) {
  try {
    const storage = globalThis.game?.settings?.storage?.get?.('world');
    const id = `${MODULE_ID}.${key}`;
    const document = storage?.getSetting?.(id, null) ?? storage?.get?.(id);
    return parseStoredSettingValue(document, fallback);
  } catch (_err) {
    return fallback;
  }
}

function clientSettingStorage() {
  return globalThis.game?.settings?.storage?.get?.('client') ?? globalThis.window?.localStorage ?? null;
}

function readClientStorageValue(storage, key, fallback = null) {
  try {
    const value = storage?.getItem?.(key);
    return parseStoredSettingValue(value, fallback);
  } catch (_err) {
    return fallback;
  }
}

function writeClientStorageValue(storage, key, value) {
  try {
    storage?.setItem?.(key, String(value));
    return true;
  } catch (_err) {
    return false;
  }
}

function removeClientStorageValue(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch (_err) {
    // best effort
  }
}

export function renderDieGlyph(sides, extraClass = "") {
  const die = String(sides ?? "").replace(/\D/g, "");
  const classes = ["pp-die-glyph", String(extraClass ?? "").trim()].filter(Boolean).join(" ");
  return `<img class="${escapeHtml(classes)}" src="${escapeHtml(`${GAME_ICON_DICE_ROOT}/d${die}.svg`)}" alt="" aria-hidden="true">`;
}

export function renderImage(path, extraClass = "") {
  return `<img class="${escapeHtml(extraClass)}" src="${path}">`;
}

export function renderInterfaceIcon(icon, extraClass = "") {
  if (icon === "pp-die-d20") return renderDieGlyph(20, extraClass);
  if (/[\\/]/.test(icon) || /\.[a-z0-9]+$/i.test(icon)) {
    //icon looks like a file path so assume this is an img
    return renderImage(icon);
  }
  const classes = ["fas", String(icon ?? ""), String(extraClass ?? "")].filter(Boolean).join(" ");
  return `<i class="${escapeHtml(classes)}" aria-hidden="true"></i>`;
}

function earlyCurrentUser() {
  const foundryGame = globalThis.game;
  if (foundryGame?.user) return foundryGame.user;
  const userId = String(foundryGame?.userId ?? foundryGame?.data?.userId ?? "");
  if (!userId) return null;
  const users = foundryGame?.data?.users;
  if (Array.isArray(users)) {
    return users.find((user) => String(user?._id ?? user?.id ?? "") === userId) ?? null;
  }
  return users?.get?.(userId) ?? null;
}

function earlyUserIsGm(user) {
  if (!user) return null;
  if (typeof user.isGM === "boolean") return user.isGM;
  const role = Number(user.role ?? user?._source?.role);
  if (!Number.isFinite(role)) return null;
  const assistantRole = Number(globalThis.CONST?.USER_ROLES?.ASSISTANT ?? 3);
  return role >= assistantRole;
}

function earlyUserIsPilot(user = earlyCurrentUser()) {
  if (!user || earlyUserIsGm(user) !== false) return false;
  const storedMode = storedWorldSetting('activationMode', null);
  if (storedMode === null || storedMode === undefined) return true;
  const mode = String(storedMode);
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  const enabled = storedWorldSetting('enabledUsers', null);
  if (!enabled || typeof enabled !== 'object') return true;
  const userId = String(user.id ?? user._id ?? globalThis.game?.userId ?? "");
  return enabled?.[userId] === true;
}

function syncManagedNoCanvas(enabled) {
  try {
    const storage = clientSettingStorage();
    if (!storage) return;
    const managed = readClientStorageValue(storage, MANAGED_NO_CANVAS_KEY, false) === true;
    if (enabled) {
      if (readClientStorageValue(storage, 'core.noCanvas', false) !== true) {
        writeClientStorageValue(storage, 'core.noCanvas', true);
        writeClientStorageValue(storage, MANAGED_NO_CANVAS_KEY, true);
        noCanvasNeedsReload = true;
      } else if (!managed) {
        writeClientStorageValue(storage, MANAGED_NO_CANVAS_KEY, true);
      }
    } else if (managed) {
      writeClientStorageValue(storage, 'core.noCanvas', false);
      removeClientStorageValue(storage, MANAGED_NO_CANVAS_KEY);
      removeClientStorageValue(storage, MANAGED_NO_CANVAS_RELOAD_KEY);
    }
  } catch (_err) {
    // The ready hook retains a registered-setting fallback.
  }
}

function bootSystemLogo() {
  return `${GAME_ICON_DICE_ROOT}/d20.svg`;
}

function updateBootBranding(screen = bootState.screen) {
  if (!(screen instanceof HTMLElement)) return;
  const foundryGame = globalThis.game;
  const system = foundryGame?.system;
  const systemId = String(system?.id ?? "");
  const systemTitle = String(system?.title ?? systemId.toUpperCase() ?? "").trim();
  const worldTitle = String(foundryGame?.world?.title ?? foundryGame?.world?.name ?? "").trim();
  const logo = screen.querySelector("[data-pp-system-logo]");
  const systemName = screen.querySelector("[data-pp-system-name]");
  const worldName = screen.querySelector("[data-pp-world-name]");
  const logoSrc = bootSystemLogo(systemId);
  if (logo instanceof HTMLImageElement) {
    logo.hidden = !logoSrc;
    if (logoSrc) {
      logo.src = logoSrc;
      logo.alt = "Player Pilot d20";
    }
  }
  if (systemName) systemName.textContent = systemTitle || "Foundry VTT";
  if (worldName) worldName.textContent = worldTitle || "Loading world...";
}

function bootClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function estimatedBootProgress(now = bootClock()) {
  const start = Number(bootState.driftStart ?? bootState.progress);
  const target = Math.max(start, Number(bootState.driftTarget ?? start));
  const duration = Math.max(1, Number(bootState.driftDurationMs ?? 1));
  const elapsed = Math.max(0, now - Number(bootState.driftStartedAt || now));
  const ratio = clamp(elapsed / duration, 0, 1);
  return Math.max(bootState.progress, start + ((target - start) * ratio));
}

function paintBootProgress(screen, current, label = "", target = current, durationMs = 0, version = bootState.driftVersion) {
  if (!(screen instanceof HTMLElement)) return;
  const safeCurrent = clamp(Number(current) || 0, 0, 100);
  const safeTarget = clamp(Math.max(safeCurrent, Number(target) || safeCurrent), 0, 100);
  const fill = screen.querySelector("[data-pp-boot-fill]");
  const track = screen.querySelector(".pp-boot-track");
  const percent = screen.querySelector("[data-pp-boot-percent]");
  const text = screen.querySelector("[data-pp-boot-label]");
  const setAnimatedTransform = (element, currentTransform, targetTransform) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.transition = "none";
    element.style.transform = currentTransform;
    if (safeTarget > safeCurrent && durationMs > 0) {
      element.getBoundingClientRect();
      if (element.isConnected && version === bootState.driftVersion) {
        element.style.transition = `transform ${Math.round(durationMs)}ms linear`;
        element.style.transform = targetTransform;
      }
    }
  };
  if (fill instanceof HTMLElement) {
    const shownProgress = safeCurrent >= 100
      ? Math.max(bootState.displayedProgress, 99)
      : bootState.displayedProgress;
    setAnimatedTransform(fill, `scaleX(${clamp(shownProgress, 0, 100) / 100})`, `scaleX(${clamp(shownProgress, 0, 100) / 100})`);
  }
  if (percent instanceof HTMLElement) {
    const shown = clamp(Math.round(bootState.displayedProgress), 0, 100);
    percent.textContent = `${shown}%`;
    percent.setAttribute("aria-label", `${shown} percent`);
  }
  if (track) track.setAttribute("aria-valuenow", String(Math.round(bootState.displayedProgress)));
  if (text && label) text.textContent = label;
}

function refreshBootEstimate() {
  const screen = bootState.screen;
  if (!(screen instanceof HTMLElement) || !screen.isConnected) return;
  const estimate = estimatedBootProgress();
  const fill = screen.querySelector("[data-pp-boot-fill]");
  const track = screen.querySelector(".pp-boot-track");
  const percent = screen.querySelector("[data-pp-boot-percent]");
  const desired = bootState.driftTarget >= 100 ? Math.floor(estimate) : Math.min(99, Math.floor(estimate));
  if (bootState.displayedProgress < desired) {
    const gap = desired - bootState.displayedProgress;
    const step = gap >= 16 ? 3 : (gap >= 7 ? 2 : 1);
    bootState.displayedProgress = Math.min(desired, bootState.displayedProgress + step);
  }
  if (fill instanceof HTMLElement) {
    fill.style.transition = `transform ${Math.max(180, BOOT_PROGRESS_INTERVAL_MS - 20)}ms linear`;
    fill.style.transform = `scaleX(${clamp(bootState.displayedProgress, 0, 100) / 100})`;
  }
  if (track) track.setAttribute("aria-valuenow", String(Math.round(bootState.displayedProgress)));
  if (percent) {
    const shown = clamp(Math.round(bootState.displayedProgress), 0, 100);
    percent.textContent = `${shown}%`;
    percent.setAttribute("aria-label", `${shown} percent`);
  }
}

function ensureBootScreen() {
  if (!bootState.enabled) return null;
  if (bootState.screen?.isConnected) return bootState.screen;
  const mountRoot = document.documentElement ?? document.body;
  if (!mountRoot) {
    document.addEventListener("DOMContentLoaded", ensureBootScreen, { once: true });
    return null;
  }
  const screen = document.createElement("section");
  screen.className = "pp-boot-screen";
  screen.setAttribute("role", "status");
  screen.setAttribute("aria-live", "polite");
  screen.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;width:100vw;height:100vh;z-index:2147483000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;color:#e7eef2;background:#071017;font-family:Signika,Arial,sans-serif;';
  screen.innerHTML = `
    <div class="pp-boot-card" style="display:grid;justify-items:center;gap:10px;width:min(390px,100%);box-sizing:border-box;padding:28px 24px;text-align:center;background:#111d26;border:1px solid rgba(126,225,205,.34);border-radius:10px;box-shadow:0 22px 70px rgba(0,0,0,.48)">
      <img class="pp-boot-system-logo" data-pp-system-logo hidden alt="" style="display:block;width:min(250px,76vw);max-height:92px;object-fit:contain">
      <div class="pp-boot-mark"><i class="fas fa-paper-plane"></i></div>
      <h1>Player Pilot</h1>
      <div class="pp-boot-world">
        <strong data-pp-world-name>Loading world...</strong>
        <span data-pp-system-name>Foundry VTT</span>
      </div>
      <p data-pp-boot-label>Starting Foundry...</p>
      <p class="pp-boot-note">The screen may briefly go blank while Foundry finishes loading.</p>
      <div class="pp-boot-track" aria-label="Loading progress">
        <div class="pp-boot-fill" data-pp-boot-fill></div>
      </div>
      <strong class="pp-boot-percent" data-pp-boot-percent aria-label="6 percent">6%</strong>
    </div>
  `;
  mountRoot.appendChild(screen);
  bootState.screen = screen;
  bootState.mountedAt = Date.now();
  const now = bootClock();
  if (!bootState.driftStartedAt) {
    bootState.driftStartedAt = now;
    bootState.lastStageAt = now;
  }
  updateBootBranding(screen);
  const estimate = estimatedBootProgress(now);
  const remainingDuration = Math.max(0, bootState.driftDurationMs - (now - bootState.driftStartedAt));
  paintBootProgress(screen, estimate, bootState.label, bootState.driftTarget, remainingDuration);
  if (bootState.timer) window.clearInterval(bootState.timer);
  bootState.timer = window.setInterval(() => {
    if (!bootState.screen?.isConnected || bootState.finishing) return;
    refreshBootEstimate();
  }, BOOT_PROGRESS_INTERVAL_MS);
  return screen;
}

function keepBootScreenAttached() {
  if (!bootState.enabled || bootState.observer || !document.documentElement) return;
  const observeTargets = () => {
    bootState.observer?.observe?.(document.documentElement, { childList: true });
    if (document.body) bootState.observer?.observe?.(document.body, { childList: true });
  };
  bootState.observer = new MutationObserver(() => {
    if (!bootState.enabled || !document.documentElement.classList.contains("player-pilot-booting")) return;
    if (bootState.screen?.isConnected) return;
    Promise.resolve().then(() => {
      ensureBootScreen();
      observeTargets();
    });
  });
  observeTargets();
}

function startBootScreen() {
  bootState.enabled = true;
  document.documentElement?.classList?.add?.("player-pilot-booting");
  const screen = ensureBootScreen();
  keepBootScreenAttached();
  if (!bootState.mountTimer) {
    bootState.mountTimer = window.setInterval(() => {
      if (!bootState.enabled) return;
      document.documentElement?.classList?.add?.('player-pilot-booting');
      ensureBootScreen();
    }, 150);
  }
  return screen;
}

function setBootStage(progress, label, fakeCeiling) {
  const now = bootClock();
  const milestone = clamp(Number(progress) || 0, 0, 100);
  const ceiling = clamp(Number(fakeCeiling) || milestone, milestone, 100);
  const previousEstimate = estimatedBootProgress(now);
  const stageElapsed = bootState.lastStageAt ? now - bootState.lastStageAt : BOOT_INITIAL_DRIFT_MS;
  const duration = clamp(stageElapsed * 2.4, BOOT_MIN_DRIFT_MS, BOOT_MAX_DRIFT_MS);
  bootState.progress = Math.max(bootState.progress, previousEstimate, milestone);
  if (milestone >= 100) bootState.displayedProgress = 100;
  bootState.fakeCeiling = Math.max(bootState.fakeCeiling, ceiling);
  bootState.driftStart = bootState.progress;
  bootState.driftTarget = bootState.fakeCeiling;
  bootState.driftStartedAt = now;
  bootState.driftDurationMs = duration;
  bootState.lastStageAt = now;
  bootState.driftVersion += 1;
  if (label) bootState.label = label;
  const screen = ensureBootScreen();
  if (!screen) return;
  paintBootProgress(screen, bootState.progress, bootState.label, bootState.driftTarget, duration, bootState.driftVersion);
}

function removeBootScreen() {
  bootState.enabled = false;
  if (bootState.timer) window.clearInterval(bootState.timer);
  if (bootState.mountTimer) window.clearInterval(bootState.mountTimer);
  if (bootState.revealTimer) window.clearTimeout(bootState.revealTimer);
  bootState.timer = null;
  bootState.mountTimer = null;
  bootState.revealTimer = null;
  bootState.finishing = false;
  bootState.progress = 6;
  bootState.displayedProgress = 6;
  bootState.fakeCeiling = 31;
  bootState.label = "Starting Foundry...";
  bootState.lastStageAt = 0;
  bootState.driftStart = 6;
  bootState.driftTarget = 31;
  bootState.driftStartedAt = 0;
  bootState.driftDurationMs = BOOT_INITIAL_DRIFT_MS;
  bootState.driftVersion += 1;
  bootState.observer?.disconnect?.();
  bootState.observer = null;
  bootState.screen?.remove();
  bootState.screen = null;
  bootState.mountedAt = 0;
  document.documentElement?.classList?.remove?.("player-pilot-booting");
}

const initialUser = earlyCurrentUser();
if (initialUser) {
  if (earlyUserIsPilot(initialUser)) {
    syncManagedNoCanvas(storedWorldSetting('useNoCanvas', true) === true);
    startBootScreen();
  } else {
    syncManagedNoCanvas(false);
  }
}

export const state = {
  shell: null,
  actorId: "",
  activeTab: "actions",
  search: "",
  quickFilters: {},
  filterMenuOpen: "",
  scene: null,
  selectedTargets: {},
  selectedTokenId: "",
  mapSnapshot: null,
  mapZoom: 1,
  mapPanX: 0,
  mapPanY: 0,
  mapDrag: null,
  mapPointers: new Map(),
  mapPinch: null,
  mapSuppressClickUntil: 0,
  navOpen: false,
  scrollBodyToTop: false,
  lastMoveLabel: "",
  lastMoveDir: "",
  movementBurst: {
    lastAt: 0,
    total: 0,
    sceneId: "",
    tokenId: "",
    points: [],
    timer: null
  },
  modal: null,
  modalApp: null,
  sharedImage: null,
  log: [],
  renderQueued: false,
  lastSceneRequestAt: 0,
  sceneFingerprint: "",
  suppressSceneRenderUntil: 0,
  lastSceneReceivedAt: 0,
  modelCache: null,
  startupNoticeObserver: null,
  nativePromptObserver: null
};

const BLOCKED_WHILE_PAUSED = new Set([
  "use-item",
  "toggle-prep",
  "toggle-equipped",
  "roll-check",
  "manual-roll",
  "qty",
  "currency",
  "currencyDialog",
  "target-toggle",
  "apply-targets",
  "ping-targets",
  "move",
  "ping-token",
  "request-map",
  "map-zoom",
  "map-reset",
  "map-click",
  "rest",
  "exhaustion",
  "death-save",
  "pf2e-resource",
  "pf2e-strike",
  "pf2e-item-roll"
]);

export function setting(key, fallback = null) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value === undefined ? fallback : value;
  } catch (_err) {
    return fallback;
  }
}

function normalizedDisplayRotation(value) {
  const rotation = Math.round(Number(value ?? 0) / 90) * 90;
  return ((rotation % 360) + 360) % 360;
}

function normalizedPlayerSeat(value) {
  const seat = String(value ?? "s").toLowerCase();
  return PLAYER_SEATS.includes(seat) ? seat : "s";
}

function playerSeatForUser(userId = game.user?.id) {
  const seats = setting("playerSeatOrientations", {});
  return normalizedPlayerSeat(seats?.[String(userId ?? "")]);
}

function directionLabel(direction) {
  return capitalizeWords(String(direction ?? "up").replaceAll("-", " "));
}

function movementOrientationForUser(userId = game.user?.id, seatOverride = null, rotationOverride = null) {
  const seat = normalizedPlayerSeat(seatOverride ?? playerSeatForUser(userId));
  const displayRotation = normalizedDisplayRotation(rotationOverride ?? setting("partyDisplayRotation", 0));
  const upStep = ((Number(PLAYER_SEAT_UP_STEPS[seat] ?? 0) - (displayRotation / 45)) % 8 + 8) % 8;
  const direction = MOVEMENT_DIRECTIONS[upStep] ?? "up";
  return {
    seat,
    seatLabel: PLAYER_SEAT_LABELS[seat] ?? "Bottom",
    displayRotation,
    upStep,
    direction,
    directionLabel: directionLabel(direction)
  };
}

function orientedMovementDirection(direction, userId = game.user?.id) {
  const inputStep = MOVEMENT_DIRECTIONS.indexOf(String(direction ?? "").toLowerCase());
  if (inputStep < 0) return direction;
  const orientation = movementOrientationForUser(userId);
  return MOVEMENT_DIRECTIONS[(inputStep + orientation.upStep) % MOVEMENT_DIRECTIONS.length];
}

function seatPositionStyle(seat) {
  const index = PLAYER_SEATS.indexOf(normalizedPlayerSeat(seat));
  const angle = ((index * 45) - 90) * (Math.PI / 180);
  const left = 50 + (43 * Math.cos(angle));
  const top = 50 + (42 * Math.sin(angle));
  return `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;`;
}

function userIsPilot(user = game.user) {
  if (!user || user.isGM) return false;
  const mode = String(setting("activationMode", "selected"));
  if (mode === "off") return false;
  if (mode === "all") return true;
  const enabled = setting("enabledUsers", {});
  return enabled?.[user.id] === true;
}

function userIdsForPilots(activeOnly = true) {
  const mode = String(setting("activationMode", "selected"));
  if (mode === "off") return [];
  return asArray(game.users)
    .filter((user) => !user.isGM)
    .filter((user) => !activeOnly || user.active)
    .filter((user) => mode === "all" || setting("enabledUsers", {})?.[user.id] === true)
    .map((user) => user.id);
}

export function pilotPaused() {
  return game.paused === true && !game.user?.isGM;
}

export function warnPaused() {
  ui.notifications?.warn?.("The game is paused.");
  addLog("Game paused");
}

export function activeGmIds() {
  return asArray(game.users)
    .filter((user) => user.isGM && user.active)
    .map((user) => user.id);
}

const manualTargetLists = globalThis.__PLAYER_PILOT_MANUAL_TARGET_LISTS__ ?? (globalThis.__PLAYER_PILOT_MANUAL_TARGET_LISTS__ = {});

function manualTargetList(sceneId = "") {
  const sid = String(sceneId || getSceneDoc()?.id || "").trim();
  if (!sid) return { tokenIds: [], actorIds: [] };
  const current = manualTargetLists[sid] ?? {};
  const tokenIds = Array.from(new Set((Array.isArray(current.tokenIds) ? current.tokenIds : []).map(String).filter(Boolean)));
  const actorIds = Array.from(new Set((Array.isArray(current.actorIds) ? current.actorIds : []).map(String).filter(Boolean)));
  manualTargetLists[sid] = { tokenIds, actorIds };
  return manualTargetLists[sid];
}

function setManualTargetMembership(sceneId, tokenDoc, enabled) {
  const list = manualTargetList(sceneId);
  const tokenId = String(tokenDoc?.id ?? "").trim();
  const actorId = String(tokenDoc?.actorId ?? tokenDoc?.actor?.id ?? "").trim();
  const update = (items, value) => {
    if (!value) return items;
    const next = new Set(items);
    if (enabled) next.add(value);
    else next.delete(value);
    return Array.from(next);
  };
  list.tokenIds = update(list.tokenIds, tokenId);
  list.actorIds = update(list.actorIds, actorId);
}

function manualTargetIncluded(sceneId, tokenDoc) {
  const list = manualTargetList(sceneId);
  const tokenId = String(tokenDoc?.id ?? "").trim();
  const actorId = String(tokenDoc?.actorId ?? tokenDoc?.actor?.id ?? "").trim();
  return (!!tokenId && list.tokenIds.includes(tokenId)) || (!!actorId && list.actorIds.includes(actorId));
}

export function sendSocket(type, payload = {}) {
  if (!game.socket?.emit) return false;
  try {
    game.socket.emit(SOCKET, {
      type,
      userId: game.user?.id ?? "",
      at: Date.now(),
      ...payload
    });
    return true;
  } catch (err) {
    console.error("Player Pilot socket send failed:", err);
    return false;
  }
}

export function addLog(text, details = {}) {
  state.log.unshift({
    text: String(text ?? ""),
    total: details.total ?? null,
    formula: details.formula ?? "",
    at: Date.now()
  });
  state.log = state.log.slice(0, 10);
  if (state.shell && text) showResultToast(String(text), details.formula ?? "");
}

function getOwnedActors() {
  return asArray(game.actors).filter((actor) => {
    if (!actor) return false;
    if (actor.isOwner === true) return true;
    return Number(actor.ownership?.[game.user?.id] ?? 0) >= OWNER;
  });
}

export function currentActor() {
  const actors = getOwnedActors();
  if (!actors.length) return null;
  if (!state.actorId) state.actorId = setting("lastActorId", "");
  if (state.actorId) {
    const current = actors.find((actor) => actor.id === state.actorId);
    if (current) return current;
  }
  state.actorId = actors[0].id;
  return actors[0];
}

function getSceneDoc(sceneId = "") {
  const id = String(sceneId ?? "").trim();
  if (id) return game.scenes?.get?.(id) ?? null;
  return canvas?.scene ?? game.scenes?.viewed ?? null;
}

function tokenImg(tokenDoc) {
  return tokenDoc?.texture?.src ?? tokenDoc?.img ?? tokenDoc?.actor?.img ?? "icons/svg/mystery-man.svg";
}

function tokenDocumentFromCanvasToken(token) {
  return token?.document ?? token ?? null;
}

function canvasTokenIsViewed(token) {
  const tokenDoc = tokenDocumentFromCanvasToken(token);
  if (!tokenDoc || tokenDoc.hidden) return false;
  if (token !== tokenDoc) {
    if (token?.destroyed === true) return false;
    if ("visible" in token && token.visible === false) return false;
    if ("renderable" in token && token.renderable === false) return false;
    if (Number(token?.alpha) === 0) return false;
  }
  return true;
}

function viewedTokenDocumentsForScene(scene = getSceneDoc()) {
  const sceneId = String(scene?.id ?? "");
  const placeables = asArray(canvas?.tokens?.placeables)
    .filter(canvasTokenIsViewed)
    .map(tokenDocumentFromCanvasToken)
    .filter((tokenDoc) => tokenDoc && !tokenDoc.hidden)
    .filter((tokenDoc) => !sceneId || String(tokenDoc.parent?.id ?? sceneId) === sceneId);
  if (placeables.length) {
    const seen = new Set();
    return placeables.filter((tokenDoc) => {
      const id = String(tokenDoc.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return asArray(scene?.tokens).filter((tokenDoc) => !tokenDoc.hidden);
}

function actorOwnedByUser(actor, userId = game.user?.id) {
  if (!actor) return false;
  const uid = String(userId ?? "").trim();
  if (!uid) return actor.isOwner === true;
  const direct = Number(actor.ownership?.[uid] ?? NaN);
  if (Number.isFinite(direct)) return direct >= OWNER;
  const fallback = Number(actor.ownership?.default ?? NaN);
  if (Number.isFinite(fallback)) return fallback >= OWNER;
  return uid === String(game.user?.id ?? "") && !game.user?.isGM && actor.isOwner === true;
}

function actorOwnedByAnyPlayer(actor) {
  if (!actor) return false;
  return asArray(game.users)
    .filter((user) => !user.isGM)
    .some((user) => actorOwnedByUser(actor, user.id));
}

function combatTokenIdsForScene(sceneId) {
  const combat = game.combat;
  const combatSceneId = String(combat?.scene?.id ?? combat?.sceneId ?? "");
  if (!combat || (combatSceneId && combatSceneId !== String(sceneId ?? ""))) return [];
  return asArray(combat.combatants)
    .filter((combatant) => {
      if (!combatant) return false;
      if (combatant.defeated === true || combatant.isDefeated === true) return false;
      const tokenDoc = combatant.token
        ?? getSceneDoc(sceneId)?.tokens?.get?.(combatant.tokenId)
        ?? asArray(getSceneDoc(sceneId)?.tokens).find((token) => String(token?.id ?? "") === String(combatant.tokenId ?? ""))
        ?? null;
      return tokenDoc?.hidden !== true;
    })
    .map((combatant) => String(combatant.token?.id ?? combatant.tokenId ?? ""))
    .filter(Boolean);
}

function buildLocalSceneState(viewerUserId = game.user?.id) {
  const scene = getSceneDoc();
  if (!scene) return null;
  const sceneId = String(scene.id ?? "");
  const combatTokenIds = combatTokenIdsForScene(sceneId);
  const controlledTokenIds = asArray(canvas?.tokens?.controlled)
    .map((token) => String(token.id ?? token.document?.id ?? ""))
    .filter(Boolean);
  const manualTargets = manualTargetList(sceneId);
  const tokens = viewedTokenDocumentsForScene(scene)
    .map((td) => ({
      id: td.id,
      name: td.name ?? td.actor?.name ?? "Token",
      img: tokenImg(td),
      actorId: td.actor?.id ?? td.actorId ?? "",
      x: Number(td.x ?? 0),
      y: Number(td.y ?? 0),
      width: Number(td.width ?? 1),
      height: Number(td.height ?? 1),
      disposition: Number(td.disposition ?? 0),
      statuses: tokenConditionKeys(td),
      effects: targetStateBadges(td),
      owned: actorOwnedByUser(td.actor, viewerUserId),
      playerOwned: actorOwnedByAnyPlayer(td.actor)
    }));
  return {
    id: scene.id,
    name: scene.name ?? "Scene",
    gridSize: Number(canvas?.grid?.size ?? scene.grid?.size ?? 100),
    gridDistance: Number(canvas?.scene?.grid?.distance ?? scene.grid?.distance ?? 5),
    gridUnits: String(canvas?.scene?.grid?.units ?? scene.grid?.units ?? "ft"),
    width: Number(canvas?.dimensions?.width ?? scene.dimensions?.width ?? scene.width ?? 0),
    height: Number(canvas?.dimensions?.height ?? scene.dimensions?.height ?? scene.height ?? 0),
    controlledTokenIds,
    combatTokenIds,
    manualTargetIds: manualTargets.tokenIds,
    manualTargetActorIds: manualTargets.actorIds,
    mapControlsEnabled: setting("mapControlsEnabled", true) === true,
    tokens
  };
}

export function selectedTargetSet(sceneId = state.scene?.id ?? "") {
  const id = String(sceneId ?? "");
  if (!state.selectedTargets[id]) state.selectedTargets[id] = [];
  return new Set(state.selectedTargets[id]);
}

export function setSelectedTargetSet(sceneId, set) {
  state.selectedTargets[String(sceneId ?? "")] = Array.from(set);
}

export function clearUseTargets() {
  const sceneId = String(state.scene?.id ?? "");
  setSelectedTargetSet(sceneId, new Set());
  applyTargetsForCurrentUser([], sceneId);
  sendSocket("targetUpdate", { actorId: state.actorId, sceneId, targetIds: [] });
}

function getActorTokenCandidates(actorId = state.actorId) {
  const scene = state.scene ?? buildLocalSceneState();
  const actor = String(actorId ?? "");
  const actorMatches = (scene?.tokens ?? []).filter((token) => token.actorId === actor);
  return actorMatches.length ? actorMatches : (scene?.tokens ?? []).filter((token) => token.owned);
}

function activeTokenForActor(actorId = state.actorId) {
  const tokens = getActorTokenCandidates(actorId);
  if (!tokens.length) return null;
  if (state.selectedTokenId) {
    const selected = tokens.find((token) => token.id === state.selectedTokenId);
    if (selected) return selected;
  }
  const controlledIds = new Set((state.scene?.controlledTokenIds ?? []).map(String));
  const actorToken = tokens.find((token) => controlledIds.has(token.id))
    ?? tokens.find((token) => token.actorId === actorId)
    ?? tokens[0];
  state.selectedTokenId = actorToken.id;
  return actorToken;
}

function actorConditionKeys(actor) {
  const values = [
    ...asArray(actor?.statuses),
    ...asArray(actor?.effects)
      .filter((effect) => effect?.disabled !== true && effect?.isSuppressed !== true)
      .flatMap((effect) => [effect.name, effect.label, ...asArray(effect.statuses)])
  ];
  return Array.from(new Set(values
    .map((value) => fieldText(value).toLowerCase().replace(/[_\s]+/g, "-"))
    .filter(Boolean)));
}

function tokenConditionKeys(tokenDoc) {
  return Array.from(new Set([
    ...actorConditionKeys(tokenDoc?.actor),
    ...asArray(tokenDoc?.statuses)
      .map((value) => fieldText(value).toLowerCase().replace(/[_\s]+/g, "-"))
      .filter(Boolean)
  ]));
}

function targetStateBadges(tokenDoc) {
  const actor = tokenDoc?.actor ?? game.actors?.get?.(tokenDoc?.actorId) ?? null;
  const statusIndex = new Map(
    asArray(CONFIG?.statusEffects)
      .map((effect) => [String(effect?.id ?? "").trim().toLowerCase(), effect])
      .filter(([id]) => !!id)
  );
  const seen = new Set();
  const badges = [];
  const pushBadge = (id, label, img = "") => {
    const key = String(id || label || img).toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    badges.push({
      id: key,
      label: cleanRulesText(label || id || "Effect"),
      img: String(img ?? "").trim()
    });
  };
  const defeatedId = String(CONFIG?.specialStatusEffects?.DEFEATED ?? "").trim().toLowerCase();
  const statuses = tokenConditionKeys(tokenDoc)
    .filter((status) => status && status !== "dead" && (!defeatedId || status !== defeatedId));
  for (const status of statuses) {
    const effect = statusIndex.get(status);
    const labelKey = String(effect?.name ?? effect?.label ?? status).trim();
    const label = game.i18n?.has?.(labelKey) ? game.i18n.localize(labelKey) : labelKey;
    pushBadge(status, label, effect?.img ?? effect?.icon ?? "");
  }
  for (const effect of asArray(actor?.effects)) {
    if (!effect || effect.disabled === true || effect.isSuppressed === true) continue;
    const img = String(effect.img ?? effect.icon ?? "").trim();
    if (!img) continue;
    pushBadge(effect.id ?? effect.name ?? effect.label, effect.name ?? effect.label ?? "Effect", img);
  }
  return badges.slice(0, 8);
}

async function enrichRulesHtml(value, relativeTo = null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let html = raw;
  try {
    const TextEditorImplementation = globalThis.foundry?.applications?.ux?.TextEditor?.implementation;
    if (TextEditorImplementation?.enrichHTML) {
      html = await TextEditorImplementation.enrichHTML(raw, {
        async: true,
        secrets: false,
        relativeTo
      });
    }
  } catch (err) {
    console.warn("Player Pilot rich text render failed; using cleaned description.", err);
  }
  const div = document.createElement("div");
  div.innerHTML = String(html ?? raw);
  div.querySelectorAll("script, style").forEach((node) => node.remove());
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) node.nodeValue = cleanFoundrySyntax(node.nodeValue);
  return div.innerHTML.trim();
}

function itemRequiresMapPlacement(item, activityId = "") {
  if (item?.type !== "spell") return false;
  const selected = activityId ? game.playerPilot.model.selectedItemActivity(item, activityId)?.activity : null;
  const sources = selected
    ? [game.playerPilot.model.activitySystem(selected), item?.system]
    : [item?.system, ...game.playerPilot.model.getItemActivities(item).map(game.playerPilot.model.activitySystem)];
  if (sources.some((source) => fieldText(source?.target?.template?.type, source?.target?.area?.type))) return true;
  const text = htmlToPlain(item?.system?.description?.value ?? item?.system?.description ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  if (/\bmisty step\b/.test(name) || /\bteleport(?:s|ed|ing)?\b/.test(text)) return true;
  return /\b(?:point|space|location|spot)\b.{0,90}\b(?:choose|chosen|you can see|within range|unoccupied)\b/i.test(text)
    || /\b(?:choose|chosen|you can see|within range|unoccupied)\b.{0,90}\b(?:point|space|location|spot)\b/i.test(text);
}

function renderSpellDetails(item) {
  const rows = Array.isArray(item?.spellDetails) && item.spellDetails.length ? item.spellDetails : game.playerPilot.model.spellDetailRows(item);
  if (!rows.length) return "";
  return `
    <table class="pp-spell-details">
      <tbody>
      ${rows.map(([label, value]) => `
        <tr>
          <th scope="row">${escapeHtml(label)}</th>
          <td>${escapeHtml(value)}</td>
        </tr>
      `).join("")}
      </tbody>
    </table>
  `;
}

export function cachedModel(actor) {
  game.playerPilot.model.refreshCache(actor);
  return game.playerPilot.model;
}

export function invalidateModelCache() {
  game.playerPilot.model.invalidateModelCache();
}

class PlayerPilotAccessPanel extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "player-pilot-access",
      title: "Player Pilot Access",
      template: "modules/player-pilot/templates/player-access-panel.html",
      width: 620,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    const enabled = setting("enabledUsers", {});
    const displayRotation = normalizedDisplayRotation(setting("partyDisplayRotation", 0));
    return {
      displayOrientations: [
        { value: 0, label: "Top edge", icon: "fa-arrow-up", checked: displayRotation === 0 },
        { value: 90, label: "Right edge", icon: "fa-arrow-right", checked: displayRotation === 90 },
        { value: 180, label: "Bottom edge", icon: "fa-arrow-down", checked: displayRotation === 180 },
        { value: 270, label: "Left edge", icon: "fa-arrow-left", checked: displayRotation === 270 }
      ],
      players: asArray(game.users)
        .filter((user) => !user.isGM)
        .map((user) => ({
          id: user.id,
          name: user.name,
          avatar: user.avatar ?? "icons/svg/mystery-man.svg",
          enabled: enabled?.[user.id] === true,
          seat: movementOrientationForUser(user.id).seatLabel
        }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll("[data-action='configure-orientation']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const userId = String(button.dataset.userId ?? "");
        if (!userId) return;
        const selectedRotation = root.querySelector("input[name='displayRotation']:checked");
        new PlayerMovementOrientationPanel(userId, {
          initialRotation: selectedRotation instanceof HTMLInputElement ? selectedRotation.value : setting("partyDisplayRotation", 0),
          onSaved: (orientation) => {
            root.querySelectorAll("input[name='displayRotation']").forEach((input) => {
              if (input instanceof HTMLInputElement) input.checked = Number(input.value) === orientation.displayRotation;
            });
            const label = button.querySelector("span");
            if (label) label.textContent = orientation.seatLabel;
          }
        }).render(true);
      });
    });
  }

  async _updateObject(_event, formData) {
    const next = {};
    for (const user of asArray(game.users).filter((user) => !user.isGM)) {
      const flat = formData[`enabled.${user.id}`];
      const nested = formData.enabled?.[user.id];
      next[user.id] = flat === true || flat === "on" || nested === true || nested === "on";
    }
    const displayRotation = normalizedDisplayRotation(formData.displayRotation ?? setting("partyDisplayRotation", 0));
    await game.settings.set(MODULE_ID, "partyDisplayRotation", displayRotation);
    await game.settings.set(MODULE_ID, "enabledUsers", next);
    notifyPilotsToRefresh();
  }
}

class PlayerMovementOrientationPanel extends FormApplication {
  constructor(userId, options = {}) {
    const user = game.users?.get?.(userId) ?? asArray(game.users).find((entry) => String(entry.id) === String(userId));
    const {
      initialRotation = setting("partyDisplayRotation", 0),
      onSaved = null,
      ...applicationOptions
    } = options;
    super({}, { ...applicationOptions, title: `${user?.name ?? "Player"} Movement Orientation` });
    this.userId = String(userId ?? "");
    this.user = user ?? null;
    this._seat = playerSeatForUser(this.userId);
    this._displayRotation = normalizedDisplayRotation(initialRotation);
    this._onSaved = typeof onSaved === "function" ? onSaved : null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "player-pilot-movement-orientation",
      title: "Player Movement Orientation",
      template: "modules/player-pilot/templates/player-movement-orientation.html",
      width: 560,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    const orientation = movementOrientationForUser(this.userId, this._seat, this._displayRotation);
    return {
      player: {
        id: this.userId,
        name: this.user?.name ?? "Player",
        avatar: this.user?.avatar ?? "icons/svg/mystery-man.svg"
      },
      seat: orientation.seat,
      seatLabel: orientation.seatLabel,
      seatStyle: seatPositionStyle(orientation.seat),
      displayRotation: orientation.displayRotation,
      directionLabel: orientation.directionLabel,
      directionRotation: orientation.upStep * 45
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;
    const diagram = root.querySelector("[data-orientation-diagram]");
    const dot = root.querySelector("[data-seat-dot]");

    root.querySelectorAll("[data-rotate-display]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this._displayRotation = normalizedDisplayRotation(this._displayRotation + Number(button.dataset.rotateDisplay ?? 0));
        this._paintOrientation(root);
      });
    });

    if (diagram instanceof HTMLElement && dot instanceof HTMLElement) {
      let dragging = false;
      const updateFromPointer = (event, snap = false) => {
        const bounds = diagram.getBoundingClientRect();
        const centerX = bounds.left + (bounds.width / 2);
        const centerY = bounds.top + (bounds.height / 2);
        const radiusX = Math.max(1, (bounds.width / 2) - 20);
        const radiusY = Math.max(1, (bounds.height / 2) - 20);
        const dx = (Number(event.clientX) - centerX) / radiusX;
        const dy = (Number(event.clientY) - centerY) / radiusY;
        const angle = Math.atan2(dy, dx);
        const degreesFromNorth = ((angle * 180 / Math.PI) + 90 + 360) % 360;
        this._seat = PLAYER_SEATS[Math.round(degreesFromNorth / 45) % PLAYER_SEATS.length];
        if (!snap) {
          dot.style.left = `${50 + (43 * Math.cos(angle))}%`;
          dot.style.top = `${50 + (42 * Math.sin(angle))}%`;
          this._paintOrientation(root, { preserveDotPosition: true });
          return;
        }
        this._paintOrientation(root);
      };

      diagram.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        dragging = true;
        diagram.classList.add("dragging");
        diagram.setPointerCapture?.(event.pointerId);
        updateFromPointer(event, false);
        event.preventDefault();
      });
      diagram.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        updateFromPointer(event, false);
        event.preventDefault();
      });
      const finishDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        diagram.classList.remove("dragging");
        updateFromPointer(event, true);
        diagram.releasePointerCapture?.(event.pointerId);
        event.preventDefault();
      };
      diagram.addEventListener("pointerup", finishDrag);
      diagram.addEventListener("pointercancel", (event) => {
        if (!dragging) return;
        dragging = false;
        diagram.classList.remove("dragging");
        diagram.releasePointerCapture?.(event.pointerId);
        this._paintOrientation(root);
      });
      dot.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
        const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const index = PLAYER_SEATS.indexOf(this._seat);
        this._seat = PLAYER_SEATS[(index + delta + PLAYER_SEATS.length) % PLAYER_SEATS.length];
        this._paintOrientation(root);
        event.preventDefault();
      });
    }
  }

  _paintOrientation(root, { preserveDotPosition = false } = {}) {
    const orientation = movementOrientationForUser(this.userId, this._seat, this._displayRotation);
    const seatInput = root.querySelector("input[name='seat']");
    const rotationInput = root.querySelector("input[name='displayRotation']");
    if (seatInput instanceof HTMLInputElement) seatInput.value = orientation.seat;
    if (rotationInput instanceof HTMLInputElement) rotationInput.value = String(orientation.displayRotation);
    const dot = root.querySelector("[data-seat-dot]");
    if (dot instanceof HTMLElement) {
      if (!preserveDotPosition) dot.setAttribute("style", seatPositionStyle(orientation.seat));
      dot.setAttribute("aria-label", `${this.user?.name ?? "Player"} sits at ${orientation.seatLabel}`);
      dot.title = `${this.user?.name ?? "Player"}: ${orientation.seatLabel}`;
    }
    root.querySelectorAll("[data-seat-label]").forEach((element) => { element.textContent = orientation.seatLabel; });
    root.querySelectorAll("[data-direction-label]").forEach((element) => { element.textContent = orientation.directionLabel; });
    root.querySelectorAll("[data-display-rotation-label]").forEach((element) => {
      element.textContent = `${orientation.displayRotation} degrees`;
    });
    root.querySelectorAll("[data-display-top-arrow]").forEach((element) => {
      if (element instanceof HTMLElement) element.style.transform = `rotate(${orientation.displayRotation}deg)`;
    });
    root.querySelectorAll("[data-preview-arrow]").forEach((element) => {
      if (element instanceof HTMLElement) element.style.transform = `rotate(${orientation.upStep * 45}deg)`;
    });
  }

  async _updateObject(_event, formData) {
    const seat = normalizedPlayerSeat(formData.seat ?? this._seat);
    const displayRotation = normalizedDisplayRotation(formData.displayRotation ?? this._displayRotation);
    const seats = { ...setting("playerSeatOrientations", {}) };
    seats[this.userId] = seat;
    await game.settings.set(MODULE_ID, "partyDisplayRotation", displayRotation);
    await game.settings.set(MODULE_ID, "playerSeatOrientations", seats);
    this._onSaved?.(movementOrientationForUser(this.userId, seat, displayRotation));
    notifyPilotsToRefresh();
  }
}

class PlayerPilotSupportPanel extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "player-pilot-support",
      title: "Support Player Pilot",
      template: "modules/player-pilot/templates/support-panel.hbs",
      width: 420,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    return { supportUrl: SUPPORT_URL };
  }

  async _updateObject() { }
}

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "access", {
    name: localize("PlayerPilot.settings.access.name"),
    label: localize("PlayerPilot.settings.access.label"),
    hint: localize("PlayerPilot.settings.access.hint"),
    icon: "fas fa-mobile-screen-button",
    type: PlayerPilotAccessPanel,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "support", {
    name: "Support Player Pilot",
    label: "Open Patreon",
    hint: "Open the Patreon link for supporting Player Pilot.",
    icon: "fab fa-patreon",
    type: PlayerPilotSupportPanel,
    restricted: false
  });

  game.settings.register(MODULE_ID, "enabledUsers", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "partyDisplayRotation", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => {
      if (userIsPilot()) queueRender();
    }
  });

  game.settings.register(MODULE_ID, "playerSeatOrientations", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      if (userIsPilot()) queueRender();
    }
  });

  game.settings.register(MODULE_ID, "lastActorId", {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "lastChangelogVersion", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "activationMode", {
    name: localize("PlayerPilot.settings.mode.name"),
    hint: localize("PlayerPilot.settings.mode.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: localize("PlayerPilot.settings.mode.off"),
      selected: localize("PlayerPilot.settings.mode.selected"),
      all: localize("PlayerPilot.settings.mode.all")
    },
    default: "selected",
    onChange: () => notifyPilotsToRefresh()
  });

  game.settings.register(MODULE_ID, "useNoCanvas", {
    name: localize("PlayerPilot.settings.noCanvas.name"),
    hint: localize("PlayerPilot.settings.noCanvas.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "movementAuthority", {
    name: localize("PlayerPilot.settings.movementAuthority.name"),
    hint: localize("PlayerPilot.settings.movementAuthority.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      playerFirst: localize("PlayerPilot.settings.movementAuthority.playerFirst"),
      gm: localize("PlayerPilot.settings.movementAuthority.gm")
    },
    default: "playerFirst"
  });

  game.settings.register(MODULE_ID, "pingApprovalMode", {
    name: localize("PlayerPilot.settings.pingApproval.name"),
    hint: localize("PlayerPilot.settings.pingApproval.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      manual: localize("PlayerPilot.settings.pingApproval.manual"),
      auto: localize("PlayerPilot.settings.pingApproval.auto")
    },
    default: "manual"
  });

  game.settings.register(MODULE_ID, "sharedDocumentPopups", {
    name: localize("PlayerPilot.settings.sharedDocumentPopups.name"),
    hint: localize("PlayerPilot.settings.sharedDocumentPopups.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      applySharedDocumentPopupMode();
      notifyPilotsToRefresh();
    }
  });

  game.settings.register(MODULE_ID, "suppressPlayerAudio", {
    name: localize("PlayerPilot.settings.suppressAudio.name"),
    hint: localize("PlayerPilot.settings.suppressAudio.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "mapControlsEnabled", {
    name: "Player Pilot controls",
    hint: "Allow player clients to use movement and ping controls.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => {
      notifyPilotsToRefresh();
      sendSceneStateDebounced();
    }
  });

  game.settings.register(MODULE_ID, "showMapControlsToggleButton", {
    name: "Show Player Pilot Controls Button",
    hint: "Shows a button on the GM to toggle Player Pilot controls.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (enabled) => {
      if (game.user.isGM) {
        if (enabled) installGmMapToggleButton();
        else removeGmMapToggleButton();
      }
    }
  });

  game.settings.register(MODULE_ID, "combatTurnLock", {
    name: localize("PlayerPilot.settings.combatLock.name"),
    hint: localize("PlayerPilot.settings.combatLock.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

async function loadTemplates() {
  const templates = [
    "modules/player-pilot/templates/player-pilot-shell/partials/search-input.hbs",
    "modules/player-pilot/templates/player-pilot-shell/partials/section-header.hbs",
    "modules/player-pilot/templates/player-pilot-shell/partials/stat-card.hbs",
  ];

  await foundry.applications.handlebars.loadTemplates(templates);
}

async function registerHandlebarsHelpers() {
  Handlebars.registerHelper({
    renderDieGlyph,
    renderInterfaceIcon,
    renderMapView,
    renderActionGroup,
    renderCheckGroups,
    renderFeatureGroups,
    renderSpellLevelSections,
    renderSectionHeader,
    renderSmartBadge,
    renderBadge,
    filterItemsForView,
    renderFilterMenu,
    renderQuickFilters,
  });

  Handlebars.registerHelper("renderItemCard", function (item, options) {
    return renderItemCard(item, options.hash);
  });

  Handlebars.registerHelper("spellPreparationSummary", function (model) {
    return model.spellPreparationSummary(model.groups.spells ?? []);
  });

  Handlebars.registerHelper("renderActionFilterMenuButton", function () {
    return renderFilterMenuButton(
      "actions",
      ["actionTiming", "actionSpellTraits"],
      "More action filters"
    );
  });

  Handlebars.registerHelper("filteredItemCount", function (key, items) {
    return filterItemsForView(key, items ?? []).length;
  });

  Handlebars.registerHelper("isQuickFilterActive", function (filter, options) {
    return (filter === "all" && !options.data.root.selectedFilters.size) ||
      options.data.root.activeFilter === filter ||
      options.data.root.selectedFilters.has(filter);
  });
}

function notifyPilotsToRefresh() {
  if (!game.user?.isGM) return;
  sendSocket("settingsChanged", { targetUserIds: userIdsForPilots() });
}

function sharedDocumentPopupsEnabled() {
  return setting("sharedDocumentPopups", true) !== false;
}

function moduleVersion() {
  return String(game.modules?.get?.(MODULE_ID)?.version ?? game.data?.modules?.find?.((entry) => entry.id === MODULE_ID)?.version ?? "");
}

function isPrimaryActiveGm() {
  if (!game.user?.isGM) return false;
  const activeGms = asArray(game.users)
    .filter((user) => user?.isGM && user?.active)
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  return !activeGms.length || String(activeGms[0].id ?? "") === String(game.user.id ?? "");
}

function changelogSections(markdown = "") {
  const sections = [];
  const lines = String(markdown ?? "").split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.trim().match(/^##\s+v?([^\s]+)\s*$/i);
    if (heading) {
      if (current) sections.push({ ...current, body: current.lines.join("\n").trim() });
      current = { version: heading[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ ...current, body: current.lines.join("\n").trim() });
  return sections;
}

function changelogSection(markdown = "", version = moduleVersion()) {
  const wanted = String(version ?? "").replace(/^v/i, "");
  if (!wanted) return "";
  return changelogSections(markdown).find((section) => String(section.version ?? "").replace(/^v/i, "") === wanted)?.body ?? "";
}

function safeChangelogUrl(url = "") {
  const text = String(url ?? "").trim();
  return /^(?:https?:|mailto:)/i.test(text) ? text : "";
}

function renderChangelogInlineMarkdown(text = "") {
  const tokens = [];
  const tokenFor = (html) => {
    const token = `%%PPMD${tokens.length}%%`;
    tokens.push([token, html]);
    return token;
  };
  let source = String(text ?? "");
  source = source.replace(/`([^`]+)`/g, (_match, code) => tokenFor(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    const safeUrl = safeChangelogUrl(url);
    if (!safeUrl) return match;
    return tokenFor(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
  });
  let html = escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");
  for (const [token, replacement] of tokens) html = html.replaceAll(token, replacement);
  return html;
}

function parseChangelogItems(markdown = "") {
  const root = [];
  const stack = [{ indent: -1, items: root }];
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (!match) {
      const currentItems = stack[stack.length - 1]?.items ?? root;
      const previous = currentItems[currentItems.length - 1] ?? root[root.length - 1];
      if (previous) previous.text = `${previous.text} ${line.trim()}`;
      continue;
    }
    const indent = match[1].replace(/\t/g, "  ").length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const item = { text: match[2], children: [] };
    stack[stack.length - 1].items.push(item);
    stack.push({ indent, items: item.children });
  }
  return root;
}

function renderChangelogItems(items = []) {
  if (!items.length) return "";
  return `<ul>${items.map((item) => `
    <li>
      ${renderChangelogInlineMarkdown(item.text)}
      ${renderChangelogItems(item.children)}
    </li>
  `).join("")}</ul>`;
}

function renderChangelogList(markdown = "") {
  const html = renderChangelogItems(parseChangelogItems(markdown));
  return html || "<p>Player Pilot has been updated.</p>";
}

async function showGmChangelogOnce() {
  if (!isPrimaryActiveGm()) return;
  const version = moduleVersion();
  if (!version || setting("lastChangelogVersion", "") === version) return;
  let section = "";
  let noticeVersion = version;
  try {
    const response = await fetch(`modules/${MODULE_ID}/CHANGELOG.md`, { cache: "no-store" });
    if (response.ok) {
      const markdown = await response.text();
      section = changelogSection(markdown, version);
      if (!section) {
        const fallback = changelogSections(markdown)[0];
        if (fallback?.body) {
          console.warn(`Player Pilot changelog has no section for module version ${version}; showing v${fallback.version} instead.`);
          section = fallback.body;
          noticeVersion = String(fallback.version ?? version).replace(/^v/i, "");
        }
      }
    }
  } catch (err) {
    console.warn("Player Pilot could not load CHANGELOG.md for the update notice.", err);
  }
  const content = `
    <div class="player-pilot-changelog">
      <h2>Player Pilot ${escapeHtml(noticeVersion)}</h2>
      ${renderChangelogList(section)}
      <hr>
      <p><a href="${escapeHtml(SUPPORT_URL)}" target="_blank" rel="noopener">Please consider supporting Player Pilot so I can continue to improve it!</a></p>
    </div>
  `;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: "Player Pilot" }),
    whisper: asArray(game.users).filter((user) => user.isGM).map((user) => user.id),
    content,
    flags: {
      [MODULE_ID]: {
        changelog: true,
        version
      }
    }
  });
  await game.settings.set(MODULE_ID, "lastChangelogVersion", version);
}

async function enforceNoCanvasIfNeeded() {
  if (!userIsPilot()) return;
  if (setting("useNoCanvas", true) !== true) return;
  document.body?.classList?.add?.("player-pilot-active");
  try {
    const storage = clientSettingStorage();
    const storedNoCanvas = readClientStorageValue(storage, "core.noCanvas", false) === true;
    const foundryNoCanvas = game.settings.get("core", "noCanvas") === true;
    if (foundryNoCanvas || (storedNoCanvas && !noCanvasNeedsReload)) return;
    if (!storedNoCanvas) {
      await game.settings.set("core", "noCanvas", true);
      writeClientStorageValue(storage, MANAGED_NO_CANVAS_KEY, true);
      noCanvasNeedsReload = true;
    }
    const lastReloadAt = Number(readClientStorageValue(storage, MANAGED_NO_CANVAS_RELOAD_KEY, 0) ?? 0);
    if (noCanvasNeedsReload && !lastReloadAt) {
      writeClientStorageValue(storage, MANAGED_NO_CANVAS_RELOAD_KEY, Date.now());
      foundry.utils.debouncedReload();
    }
  } catch (err) {
    console.warn("Player Pilot could not enable no-canvas mode:", err);
  }
}

function isResolutionNotice(notification) {
  const text = String(notification.textContent ?? "").toLowerCase();
  return text.includes("requires usable window dimensions")
    || text.includes("requires a usable window dimensions");
}

function dismissFoundryNotification(notification) {
  if (!(notification instanceof HTMLElement) || !notification.isConnected) return;
  const id = Number(notification.dataset.id);
  if (Number.isInteger(id) && id > 0) ui.notifications?.remove?.(id);
  else notification.remove();
}

function autoCloseFoundryNotification(notification) {
  if (!userIsPilot()) return;
  if (!(notification instanceof HTMLElement) || !notification.matches("#notifications > .notification")) return;
  if (notification.classList.contains("progress") || notification.dataset.ppAutoClose === "1") return;
  notification.dataset.ppAutoClose = "1";
  if (isResolutionNotice(notification)) {
    dismissFoundryNotification(notification);
    return;
  }
  window.setTimeout(() => {
    dismissFoundryNotification(notification);
  }, STARTUP_NOTICE_LIFETIME_MS);
}

function scheduleFoundryNotificationAutoClose(root = document) {
  if (!userIsPilot()) return;
  if (root instanceof HTMLElement && root.matches?.("#notifications > .notification")) {
    autoCloseFoundryNotification(root);
  }
  root.querySelectorAll?.("#notifications > .notification").forEach(autoCloseFoundryNotification);
}

function installFoundryNotificationAutoClose() {
  if (!userIsPilot() || state.startupNoticeObserver) return;
  scheduleFoundryNotificationAutoClose();
  const notifications = document.querySelector("#notifications");
  if (!(notifications instanceof HTMLElement)) return;
  state.startupNoticeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutation.addedNodes.length) continue;
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) scheduleFoundryNotificationAutoClose(node);
      }
    }
  });
  state.startupNoticeObserver.observe(notifications, { childList: true });
}

function applySharedDocumentPopupMode() {
  const active = userIsPilot();
  const enabled = active && sharedDocumentPopupsEnabled();
  document.body?.classList?.toggle?.("player-pilot-shared-popups", enabled);
  document.body?.classList?.toggle?.("player-pilot-shared-popups-disabled", active && !enabled);
}

function mountPilotShell() {
  applySharedDocumentPopupMode();
  if (state.shell) return;
  state.shell = new PlayerPilotShell();
  //state.shell.setAttribute("aria-label", "Player Pilot");
  bindShellEvents();
  requestSceneState();
  queueRender();
}

function pilotShellIsPainted() {
  const shell = state.shell?.element;
  const topbar = shell?.querySelector?.('.pp-topbar');
  if (!(shell instanceof HTMLElement) || !(topbar instanceof HTMLElement)) return false;
  const style = window.getComputedStyle?.(shell);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
  const shellRect = shell.getBoundingClientRect();
  const topbarRect = topbar.getBoundingClientRect();
  return shellRect.width > 0 && shellRect.height > 0 && topbarRect.width > 0 && topbarRect.height > 0;
}

function revealPilotShell() {
  setBootStage(96, "Building your controls...", 99);
  renderShell();
  let attempts = 0;
  const confirmPaint = () => {
    if (!userIsPilot()) {
      removeBootScreen();
      return;
    }
    if (!state.shell?.element.querySelector('.pp-topbar')) {
      try {
        mountPilotShell();
        renderShell();
      } catch (err) {
        console.error('Player Pilot | Failed to mount the player shell while loading', err);
      }
    }
    if (pilotShellIsPainted()) {
      const visibleFor = Date.now() - Number(bootState.mountedAt || Date.now());
      if (visibleFor < BOOT_MIN_VISIBLE_MS) {
        bootState.revealTimer = window.setTimeout(confirmPaint, Math.max(125, BOOT_MIN_VISIBLE_MS - visibleFor));
        return;
      }
      if (bootState.finishing) return;
      bootState.finishing = true;
      setBootStage(100, "Ready", 100);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (!pilotShellIsPainted()) {
          bootState.finishing = false;
          confirmPaint();
          return;
        }
        bootState.revealTimer = window.setTimeout(() => {
          if (pilotShellIsPainted()) removeBootScreen();
          else {
            bootState.finishing = false;
            confirmPaint();
          }
        }, BOOT_READY_HOLD_MS);
      }));
      return;
    }
    bootState.finishing = false;
    attempts += 1;
    if (attempts === 12) setBootStage(97, 'Still preparing your controls...', 99);
    bootState.revealTimer = window.setTimeout(confirmPaint, 125);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(confirmPaint));
}

function unmountPilotShell() {
  document.body.classList.remove("player-pilot-active");
  document.body.classList.remove("player-pilot-modal-open");
  document.body.classList.remove("player-pilot-native-prompt-open");
  document.body.classList.remove("player-pilot-shared-popups");
  document.body.classList.remove("player-pilot-shared-popups-disabled");
  removeBootScreen();
  state.shell?.close();
  state.shell = null;
  state.sharedImage?.remove?.();
  state.sharedImage = null;
  state.startupNoticeObserver?.disconnect?.();
  state.startupNoticeObserver = null;
  state.nativePromptObserver?.disconnect?.();
  state.nativePromptObserver = null;
  invalidateModelCache();
}

export function queueRender() {
  if (!state.shell || state.renderQueued) return;
  state.renderQueued = true;
  window.requestAnimationFrame(() => {
    renderShell();
    state.renderQueued = false;
  });
}

async function renderShell() {
  await state.shell.render(true);
}

export function quickFilterFor(key) {
  const value = state.quickFilters?.[key];
  return Array.isArray(value) ? (value[0] ?? "all") : (value ?? "all");
}

export function selectedQuickFilters(key) {
  const value = state.quickFilters?.[key];
  if (Array.isArray(value)) return value.filter((entry) => entry && entry !== "all");
  return value && value !== "all" ? [value] : [];
}

export function isMultiFilterKey(key) {
  return ["actionTiming", "actionSpellTraits", "inventory", "features"].includes(key);
}

function renderQuickFilters(key) {
  const filters = game.playerPilot.model.quickFiltersForKey(key);
  if (filters.length < 2) return "";
  if (filters.length === 2 && filters[0][0] === "all") return "";
  const active = quickFilterFor(key);
  const selected = new Set(selectedQuickFilters(key));
  const multi = isMultiFilterKey(key);
  return `
    <div class="pp-filter-row" aria-label="Quick filters">
      ${filters.map(([value, label, icon]) => `
        <button class="pp-chip ${(multi ? (value === "all" ? !selected.size : selected.has(value)) : active === value) ? "active" : ""}" type="button" data-action="quickFilter" data-filter-key="${escapeHtml(key)}" data-filter="${escapeHtml(value)}" data-multi="${multi ? "true" : "false"}" aria-pressed="${(multi ? selected.has(value) : active === value) ? "true" : "false"}">${icon ? `<i class="fas ${escapeHtml(icon)}"></i>` : ""}${escapeHtml(label)}</button>
      `).join("")}
    </div>
  `;
}

function matchesSearch(item) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  return `${item.name} ${item.type} ${item.badges?.join(" ") ?? ""}`.toLowerCase().includes(q);
}

function matchesQuickFilter(key, item) {
  const filters = isMultiFilterKey(key) ? selectedQuickFilters(key) : [quickFilterFor(key)];
  if (!filters.length || filters.includes("all")) return true;
  return filters.some((filter) => matchesOneQuickFilter(key, filter, item));
}

function matchesOneQuickFilter(key, filter, item) {
  if (filter === "cantrip") return item.type === "spell" && Number(item.level ?? 0) === 0;
  if (filter === "prepared") {
    if (String(game.system?.id ?? "").toLowerCase() === "pf2e") return item.type === "spell" && item.preparationMode === "prepared" && item.prepared;
    return item.type === "spell" && (item.prepared || Number(item.level ?? 0) === 0 || ["always", "atwill", "innate", "pact"].includes(item.preparationMode));
  }
  if (filter === "focus") return item.type === "spell" && (item.pf2e?.traits?.includes("focus") || item.preparationMode === "focus");
  if (filter === "spontaneous") return item.type === "spell" && item.preparationMode === "spontaneous";
  if (filter === "innate") return item.type === "spell" && item.preparationMode === "innate";
  if (filter === "sustained") return item.sustained === true;
  if (filter === "concentration") return item.concentration === true;
  if (filter === "ritual") return item.ritual === true;
  if (key === "actionTiming") return item.activation === filter;
  if (key === "actionSpellTraits") {
    if (filter === "concentration") return item.concentration === true;
    if (filter === "sustained") return item.sustained === true;
    if (filter === "focus") return item.pf2e?.traits?.includes("focus");
    return item.ritual === true;
  }
  if (filter === "quantity") return item.quantity !== null;
  if (filter === "equipment") return ["equipment", "armor", "shield"].includes(item.type);
  if (filter === "ammo") return item.type === "ammo" || item.pf2e?.itemCategory === "ammo" || item.pf2e?.traits?.includes("ammunition");
  if (filter === "backpack") return ["backpack", "container"].includes(item.type) || !!item.containerName;
  if (key === "features" && ["class", "ancestry", "skill", "general"].includes(filter)) {
    const category = String(item.pf2e?.itemCategory ?? "");
    return item.type === filter
      || category === filter
      || (filter === "class" && category === "classfeature")
      || (filter === "ancestry" && category === "ancestryfeature")
      || item.pf2e?.traits?.includes(filter)
      || (filter === "ancestry" && item.type === "heritage");
  }
  if (key === "actions" && filter === "item") return ["consumable", "tool", "equipment", "loot"].includes(item.type);
  if (key === "actions" && filter === "feature") return ["feat", "class", "subclass", "classfeature", "action", "race", "background"].includes(item.type);
  if (item.arcane !== undefined) {
    if (item.arcane.toLowerCase() === filter ||
      (!item.arcane && filter === "general")) {
      return true;
    }
  }
  return item.type === filter || item.activation === filter || item.group === filter;
}

export function filterItemsForView(key, items = []) {
  return items.filter((item) => {
    if (!matchesSearch(item) || !matchesQuickFilter(key, item)) return false;
    if (key !== "actions") return true;
    if (!matchesQuickFilter("actionTiming", item)) return false;
    if (quickFilterFor("actions") === "spell" && !matchesQuickFilter("actionSpellTraits", item)) return false;
    return true;
  });
}

function filterSelectionCount(keys = []) {
  return keys.reduce((total, key) => total + selectedQuickFilters(key).length, 0);
}

function renderFilterMenu(menu, key, label = "Filters") {
  const filters = game.playerPilot.model.quickFiltersForKey(key);
  if (filters.length < 2) return "";
  if (filters.length === 2 && filters[0][0] === "all") return "";
  const open = state.filterMenuOpen === menu;
  return `
    ${renderFilterMenuButton(menu, key, label)}
    <div class="pp-action-filter-popover ${open ? "open" : ""}">
      <strong>${escapeHtml(label)}</strong>
      ${renderQuickFilters(menu)}
    </div>
  `;
}

function renderFilterMenuButton(menu, key, label = "Filters") {
  const count = filterSelectionCount([key]);
  const open = state.filterMenuOpen === menu;
  return `
    <button class="pp-filter-menu-btn ${open ? "active" : ""}" type="button" data-action="toggle-filter-menu" data-filter-menu="${escapeHtml(menu)}" title="${escapeHtml(label)}" aria-expanded="${open ? "true" : "false"}">
      <i class="fas fa-filter"></i>
      ${count ? `<span class="pp-filter-count">${escapeHtml(count)}</span>` : ""}
    </button>
  `;
}

function renderActionGroup(title, items = [], adapterId = "") {
  const filtered = filterItemsForView("actions", items);
  if (!filtered.length) return "";
  const loweredTitle = title.toLowerCase();
  const key = adapterId === "pf2e"
    ? (loweredTitle.includes("reaction") ? "reaction"
      : loweredTitle.includes("free") ? "free"
        : loweredTitle.includes("passive") ? "passive"
          : loweredTitle.includes("two") ? "action2"
            : loweredTitle.includes("three") ? "action3"
              : loweredTitle.includes("other") ? "other" : "action1")
    : (loweredTitle.includes("bonus") ? "bonus" : loweredTitle.includes("reaction") ? "reaction" : loweredTitle.includes("other") ? "other" : "action");
  const categories = [
    ["weapon", "Weapons", "sword.svg"],
    ["spell", "Spells", "book.svg"],
    ["power", "Powers", "book.svg"],
    ["item", "Items", "item-bag.svg"],
    ["feature", "Class Features", "upgrade.svg"]
  ];
  return `
    <div class="pp-section pp-action-section">
      ${categories.map(([category, label, icon]) => {
    const list = filtered.filter((item) => actionItemCategory(item) === category);
    if (!list.length) return "";
    return `
          <div class="pp-action-subsection">
            <div class="pp-section-header pp-big-header pp-combined-header">
              <h2>
                <i class="fas ${escapeHtml(sectionIcon(key))}"></i>
                ${title ? `<span>${escapeHtml(title)}</span><b>-</b>` : ""}
                <img src="${escapeHtml(`${CORE_ICON_ROOT}/${icon}`)}" alt="">
                <span>${escapeHtml(label)}</span>
              </h2>
              <span class="pp-header-count">${escapeHtml(list.length)}</span>
            </div>
            <div class="pp-card-list">${list.map((item) => renderItemCard(item, { usesInControls: adapterId === "pf2e" || category === "feature" })).join("")}</div>
          </div>
        `;
  }).join("")}
    </div>
  `;
}

function actionItemCategory(item) {
  if (item?.type === "weapon") return "weapon";
  if (item?.type === "spell") return "spell";
  if (item?.type === "power") return "power";
  if (["consumable", "tool", "gear", "equipment", "loot"].includes(item?.type)) return "item";
  return "feature";
}

function sectionIcon(key) {
  return ({
    initiative: "fa-flag-checkered",
    abilities: "fa-scale-balanced",
    checks: "fa-user-check",
    saves: "fa-shield-heart",
    skills: "fa-hand-sparkles",
    action: "fa-bolt",
    bonus: "fa-circle-plus",
    reaction: "fa-reply",
    action1: "fa-1",
    action2: "fa-2",
    action3: "fa-3",
    free: "fa-feather",
    passive: "fa-eye",
    other: "fa-layer-group",
    movement: "fa-person-running",
    map: "fa-map-location-dot",
    targets: "fa-crosshairs"
  })[key] ?? "fa-diamond";
}

function renderSectionHeader(title, icon = "fa-diamond", count = null) {
  return `
    <div class="pp-section-header pp-big-header">
      <h2>${renderInterfaceIcon(icon)}<span>${escapeHtml(title)}</span></h2>
      ${count === null ? "" : `<span class="pp-header-count">${escapeHtml(count)}</span>`}
    </div>
  `;
}

function renderCheckGroups(checks = []) {
  if (!checks.length) return `<div class="pp-empty">No quick rolls available for this system yet.</div>`;
  const abilityChecks = checks.filter((check) => check.kind === "abilityCheck");
  const abilitySaves = checks.filter((check) => check.kind === "abilitySave");
  const pairedAbilities = abilityChecks.length && abilitySaves.length
    ? DND5E_ABILITIES.map(([key, label]) => ({
      key,
      label,
      check: abilityChecks.find((entry) => entry.key === key),
      save: abilitySaves.find((entry) => entry.key === key),
      icon: game.playerPilot.model.abilityDisplayIcon(key),
    })).filter((entry) => entry.check || entry.save)
    : [];
  const buckets = [
    ["abilities", "Ability Checks and Saving Throws", pairedAbilities],
    ["saves", "Saving Throws", pairedAbilities.length ? checks.filter((check) => check.category === "saves" && check.kind !== "abilitySave") : checks.filter((check) => check.category === "saves")],
    ["checks", "Ability Checks", pairedAbilities.length ? [] : checks.filter((check) => check.category === "checks")],
    ["skills", "Skills", checks.filter((check) => check.category === "skills")]
  ];
  return buckets.map(([key, title, list]) => {
    if (!list.length) return "";
    return `
      <details class="pp-roll-group" ${key === "skills" ? "open" : ""}>
        <summary class="pp-subtitle pp-big-header"><i class="fas ${escapeHtml(sectionIcon(key))}"></i><span>${escapeHtml(title)}</span><em>${escapeHtml(list.length)}</em></summary>
        <div class="pp-card-list">${key === "abilities" ? list.map(renderAbilityRollCard).join("") : list.map(renderCheckCard).join("")}</div>
      </details>
    `;
  }).join("");
}

function spellLevelLabel(level) {
  const n = Number(level ?? 0);
  if (String(game.system?.id ?? "").toLowerCase() === "pf2e") return Number.isFinite(n) && n > 0 ? `Spell Rank ${n}` : "Cantrips";
  return Number.isFinite(n) && n > 0 ? `Spell Level ${n}` : "Cantrips";
}

function slotForSpellLevel(slots = [], level = 0) {
  const n = Number(level ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return slots.find((slot) => Number(slot.level ?? 0) === n && slot.key !== "pact") ?? null;
}

function renderLevelSlot(slot) {
  if (!slot) return "";
  const value = Number(slot.value ?? 0);
  const max = Number(slot.max ?? 0);
  const icons = Array.from({ length: Math.min(Math.max(max, 0), 8) }).map((_entry, index) => `
    <i class="fas fa-diamond pp-slot-pip ${index < value ? "filled" : ""}"></i>
  `).join("");
  return `
    <div class="pp-level-slot">
      <span>${escapeHtml(slot.label)}</span>
      <strong>Slots Available ${escapeHtml(value)} / ${escapeHtml(max)}</strong>
      <div class="pp-slot-pips">${icons}</div>
    </div>
  `;
}

function renderSpellHeaderSlot(level, slots = [], items = []) {
  const n = Number(level ?? 0);
  if (!Number.isFinite(n) || n <= 0) {
    return `
      <div class="pp-level-slot pp-level-slot-empty">
        <span>Cantrips</span>
        <strong>At Will</strong>
      </div>
    `;
  }
  const slot = slotForSpellLevel(slots, n);
  if (slot) return renderLevelSlot(slot);
  if (String(game.system?.id ?? "").toLowerCase() === "pf2e") {
    if (items.some((item) => item.pf2e?.traits?.includes("focus"))) {
      return `<div class="pp-level-slot pp-level-slot-empty"><span>Focus Spells</span><strong>Uses Focus Points</strong></div>`;
    }
    if (items.some((item) => item.preparationMode === "innate")) {
      return `<div class="pp-level-slot pp-level-slot-empty"><span>Innate Spells</span><strong>Uses shown per spell</strong></div>`;
    }
  }
  const rankOrLevel = String(game.system?.id ?? "").toLowerCase() === "pf2e" ? "Rank" : "Spell Level";
  return `
    <div class="pp-level-slot pp-level-slot-empty">
      <span>${rankOrLevel} ${escapeHtml(n)}</span>
      <strong>No slot data</strong>
    </div>
  `;
}

function renderSpellLevelSections(items = [], slots = [], preparation = null) {
  if (!items.length) return `<div class="pp-empty">No spells found.</div>`;
  const byLevel = new Map();
  for (const item of items) {
    const level = Number(item.level ?? 0) || 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(item);
  }
  const pactSlots = slots.filter((slot) => slot.key === "pact");
  const pact = pactSlots.length ? `<div class="pp-pact-slots">${pactSlots.map(renderLevelSlot).join("")}</div>` : "";
  return `
    ${pact}
    ${Array.from(byLevel.keys()).sort((a, b) => a - b).map((level) => {
    const list = byLevel.get(level).sort((a, b) => a.name.localeCompare(b.name));
    return `
        <div class="pp-spell-section">
          <div class="pp-spell-level-header">
            <div>
              <h3>${escapeHtml(spellLevelLabel(level))}</h3>
              <span>${escapeHtml(list.length)} spell${list.length === 1 ? "" : "s"}</span>
            </div>
            ${preparation ? `
              <div class="pp-sticky-preparation ${Number.isFinite(preparation.max) && preparation.value >= preparation.max ? "at-max" : ""}">
                <span>Prepared</span>
                <strong>${escapeHtml(preparation.value)}${Number.isFinite(preparation.max) ? `/${escapeHtml(preparation.max)}` : ""}</strong>
              </div>
            ` : ""}
            ${renderSpellHeaderSlot(level, slots, list)}
          </div>
          <div class="pp-card-list">${list.map((item) => renderItemCard(item, { showSpellLevel: false, usesInControls: String(game.system?.id ?? "").toLowerCase() === "pf2e" })).join("")}</div>
        </div>
      `;
  }).join("")}
  `;
}

function featureGroupName(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const group = String(item?.group ?? "").toLowerCase();
  const pf2eCategory = String(item?.pf2e?.itemCategory ?? "").toLowerCase();
  const text = `${type} ${group} ${item?.badges?.join(" ") ?? ""} ${item?.description ?? ""}`.toLowerCase();
  if (["class", "classfeature"].includes(pf2eCategory)) return "Class Features";
  if (["ancestry", "ancestryfeature"].includes(pf2eCategory)) return "Ancestry and Lineage";
  if (pf2eCategory === "background") return "Background";
  if (type === "class" || text.includes("class")) return "Class Features";
  if (type === "subclass" || text.includes("subclass")) return "Subclass Features";
  if (type === "race" || type === "ancestry" || text.includes("race") || text.includes("ancestry")) return "Ancestry and Lineage";
  if (type === "background" || text.includes("background")) return "Background";
  if (type === "feat") return "Feats";
  if (type === "action") return "Actions";
  return "Other Features";
}

function renderFeatureGroups(items = [], empty = "No features found.") {
  if (!items.length) return `<div class="pp-empty">${escapeHtml(empty)}</div>`;
  const order = ["Class Features", "Subclass Features", "Ancestry and Lineage", "Background", "Feats", "Actions", "Other Features"];
  const groups = new Map();
  for (const item of items) {
    const key = featureGroupName(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return order.filter((name) => groups.has(name)).map((name) => {
    const list = groups.get(name);
    return `
      <div class="pp-subsection">
        <div class="pp-section-header pp-big-header pp-combined-header">
          <h2><i class="fas fa-star"></i><span>Features</span><b>-</b><i class="fas fa-book"></i><span>${escapeHtml(name)}</span></h2>
          <span class="pp-header-count">${escapeHtml(list.length)}</span>
        </div>
        <div class="pp-card-list">${list.map((item) => renderItemCard(item, { usesInControls: true })).join("")}</div>
      </div>
    `;
  }).join("");
}

function renderItemCard(item, { showSpellLevel = true, usesInControls = false } = {}) {
  if (item?.pf2eStrike) return renderPf2eStrikeCard(item);
  const ready = item.type !== "spell" || item.usable === true;
  const canUse = item.usable !== false;
  const spellRankOrLevel = String(game.system?.id ?? "").toLowerCase() === "pf2e" ? "Spell Rank" : "Spell Level";
  const level = showSpellLevel && item.type === "spell" ? renderBadge(Number(item.level ?? 0) > 0 ? `${spellRankOrLevel} ${item.level}` : "Cantrip", "level", "fa-layer-group") : "";
  const preparationLock = item.type === "spell" && item.preparationLocked
    ? `<span class="pp-card-state-icon" title="Always available; cannot be unprepared" aria-label="Always available"><i class="fas fa-lock"></i></span>`
    : "";
  const ritual = item.ritual ? renderBadge("Ritual", "ritual", "fa-book-open") : "";
  const concentration = item.concentration ? renderBadge("Concentration", "concentration", "fa-brain") : "";
  const special = item.special ? renderBadge("Special Feature", "special-feature", "fa-sparkles") : "";
  const qtyControls = item.quantity !== null
    ? `<div class="pp-qty pp-qty-compact" aria-label="Quantity">
        <button type="button" data-action="qty" data-item-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="Decrease quantity">&minus;</button>
        <span>${escapeHtml(item.quantity)}</span>
        <button type="button" data-action="qty" data-item-id="${escapeHtml(item.id)}" data-delta="1" aria-label="Increase quantity">+</button>
      </div>`
    : "";
  const usesControl = usesInControls && item.usesText
    ? `<div class="pp-uses-control"><i class="fas fa-battery-three-quarters"></i><span>${escapeHtml(item.usesText.replace(/^Uses Available\s*/i, "").split(",")[0].replace(/\s*\/\s*/g, "/"))}</span></div>`
    : "";
  const prepButton = item.canPrepare
    ? `<button class="pp-state-switch pp-prep-switch ${item.prepared ? "is-on" : "is-off"}" type="button" role="switch" aria-checked="${item.prepared ? "true" : "false"}" data-action="togglePrepared" data-item-id="${escapeHtml(item.id)}" title="${item.prepared ? "Unprepare" : "Prepare"} ${escapeHtml(item.name)}" aria-label="${item.prepared ? "Unprepare" : "Prepare"} ${escapeHtml(item.name)}"><span class="pp-switch-knob"></span></button>`
    : "";
  const equipButton = game.playerPilot.model.equipButton(item);
  const useButton = canUse
    ? `<button class="pp-action-btn primary pp-use-compact" type="button" data-action="use-item" data-item-id="${escapeHtml(item.id)}">Use</button>`
    : "";
  const leftControl = usesControl || qtyControls;
  const primaryControls = leftControl || useButton
    ? `<div class="pp-card-primary-controls"><div>${leftControl}</div><div>${useButton}</div></div>`
    : "";
  const badges = usesInControls
    ? (item.badges ?? []).filter((badge) => !String(badge).toLowerCase().includes("uses available"))
    : (item.badges ?? []);
  const searchText = `${item.name} ${item.type} ${item.activation} ${item.badges?.join(" ") ?? ""} ${item.containerName ?? ""}`;
  return `
    <article class="pp-card pp-searchable ${item.type === "spell" ? (ready ? "pp-spell-ready" : "pp-spell-unprepared") : ""} ${item.equippable ? (item.equipped ? "pp-item-equipped" : "pp-item-unequipped") : ""} ${item.special ? "pp-special-feature" : ""}" data-item-id="${escapeHtml(item.id)}" data-search="${escapeHtml(searchText)}" data-filter="${escapeHtml(`${item.type} ${item.activation} ${item.preparationMode} ${item.ritual ? "ritual" : ""} ${item.concentration ? "concentration" : ""}`)}">
      <button class="pp-card-img pp-card-info-btn" type="button" data-action="item-info" data-item-id="${escapeHtml(item.id)}" style="background-image:url('${escapeHtml(item.img)}')" aria-label="View ${escapeHtml(item.name)}"></button>
      <div class="pp-card-main">
        <div class="pp-card-title"><button class="pp-card-title-btn" type="button" data-action="item-info" data-item-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>${preparationLock}${prepButton}${equipButton}</div>
        <div class="pp-card-meta">
          ${level}${ritual}${concentration}${special}
          ${badges.map(renderSmartBadge).join("")}
          ${item.containerName ? renderBadge(`in ${item.containerName}`, "container", "fa-box-open") : ""}
        </div>
      </div>
      ${primaryControls}
    </article>
  `;
}

function renderPf2eStrikeCard(item) {
  const strike = item.pf2eStrike;
  const searchText = `${item.name} strike weapon ${item.badges?.join(" ") ?? ""}`;
  return `
    <article class="pp-card pp-searchable ${item.usable ? "" : "pp-item-unequipped"}" data-search="${escapeHtml(searchText)}">
      <button class="pp-card-img pp-card-info-btn" type="button" data-action="item-info" data-item-id="${escapeHtml(strike.itemId)}" style="background-image:url('${escapeHtml(item.img)}')" aria-label="View ${escapeHtml(item.name)}"></button>
      <div class="pp-card-main">
        <div class="pp-card-title"><button class="pp-card-title-btn" type="button" data-action="item-info" data-item-id="${escapeHtml(strike.itemId)}">${escapeHtml(item.name)}</button></div>
        <div class="pp-card-meta">${(item.badges ?? []).map(renderSmartBadge).join("")}</div>
      </div>
      <div class="pp-card-primary-controls">
        <div></div>
        <div>
          <button class="pp-use-compact" type="button" data-action="pf2eStrike" data-operation="flow" data-item-id="${escapeHtml(strike.itemId)}" data-strike-index="${escapeHtml(strike.index)}" data-strike-slug="${escapeHtml(strike.slug)}" ${item.usable ? "" : "disabled"}>
            <i class="fas fa-burst"></i><span>Strike</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderBadge(text, kind = "", icon = "") {
  return `<span class="pp-badge ${escapeHtml(kind)}">${icon ? `<i class="fas ${escapeHtml(icon)}"></i>` : ""}${escapeHtml(text)}</span>`;
}

function renderSmartBadge(text) {
  const label = String(text ?? "");
  const lower = label.toLowerCase();
  if (!label) return "";
  if (lower.includes("uses available")) return renderBadge(label, "uses", "fa-battery-three-quarters");
  if (lower.includes("ft") || lower.includes("mile") || lower.includes("touch")) return renderBadge(label, "range", "fa-ruler");
  if (/(action|bonus|reaction|minute|hour|special)/i.test(label)) return renderBadge(capitalizeWords(label), "action", "fa-bolt");
  if (lower.includes("target") || lower.includes("creature") || lower.includes("enemy") || lower.includes("ally")) return renderBadge(capitalizeWords(label), "target", "fa-crosshairs");
  return renderBadge(label);
}

function renderCheckCard(check) {
  const searchText = `${check.name} ${check.badge} ${check.formula ?? ""}`;
  const mod = signedMod(parseD20Mod(check.formula ?? "d20"));
  return `
    <article class="pp-card pp-roll-card pp-searchable" data-search="${escapeHtml(searchText)}">
      ${renderInterfaceIcon(rollCardIcon(check), "pp-roll-type-icon")}
      <div class="pp-card-main">
        <div class="pp-card-title"><span>${escapeHtml(check.name)}</span></div>
        <div class="pp-roll-line">
          <span>${escapeHtml(check.badge || "Roll")} <strong>${escapeHtml(mod)}</strong></span>
          ${renderD20RollButton(check)}
        </div>
      </div>
    </article>
  `;
}

function renderAbilityRollCard(entry) {
  const searchText = `${entry.label} check saving throw ${entry.check?.formula ?? ""} ${entry.save?.formula ?? ""}`;
  return `
    <article class="pp-card pp-roll-card pp-ability-roll-card pp-searchable" data-search="${escapeHtml(searchText)}">
      <i class="fas ${escapeHtml(entry.icon)} pp-roll-type-icon" aria-hidden="true"></i>
      <div class="pp-card-main">
        <div class="pp-card-title"><span>${escapeHtml(entry.label)}</span></div>
        ${entry.check ? renderAbilityRollLine("Check", entry.check) : ""}
        ${entry.save ? renderAbilityRollLine("Saving Throw", entry.save) : ""}
      </div>
    </article>
  `;
}

function renderAbilityRollLine(label, check) {
  return `
    <div class="pp-roll-line">
      <span>${escapeHtml(label)} <strong>${escapeHtml(signedMod(parseD20Mod(check.formula ?? "d20")))}</strong></span>
      ${renderD20RollButton(check)}
    </div>
  `;
}

function renderD20RollButton(check) {
  return `
    <button class="pp-roll-die-btn" type="button" data-action="roll-check" data-kind="${escapeHtml(check.kind)}" data-key="${escapeHtml(check.key)}" title="Roll ${escapeHtml(check.name)}">
      ${renderDieGlyph(20)}
    </button>
  `;
}

function rollCardIcon(check = {}) {
  const skillIcons = {
    acr: "fa-person-running",
    acrobatics: "fa-person-running",
    ani: "fa-paw",
    arc: "fa-hat-wizard",
    arcana: "fa-hat-wizard",
    ath: "fa-dumbbell",
    athletics: "fa-dumbbell",
    crafting: "fa-hammer",
    dec: "fa-masks-theater",
    deception: "fa-masks-theater",
    diplomacy: "fa-handshake",
    his: "fa-landmark",
    ins: "fa-eye",
    itm: "fa-face-angry",
    intimidation: "fa-face-angry",
    inv: "fa-magnifying-glass",
    med: "fa-kit-medical",
    medicine: "fa-kit-medical",
    nat: "fa-leaf",
    nature: "fa-leaf",
    occultism: "fa-eye",
    prc: "fa-binoculars",
    prf: "fa-music",
    performance: "fa-music",
    per: "fa-comments",
    perception: "fa-binoculars",
    rel: "fa-book",
    religion: "fa-book",
    society: "fa-landmark",
    slt: "fa-hand",
    ste: "fa-user-ninja",
    stealth: "fa-user-ninja",
    sur: "fa-compass",
    survival: "fa-compass",
    thievery: "fa-hand"
  };
  const key = String(check.key ?? "").toLowerCase();
  const skill = skillIcons[key];
  if (skill) return skill;
  if (["fortitude", "fort"].includes(key)) return "fa-heart-pulse";
  if (["reflex", "ref"].includes(key)) return "fa-person-running";
  if (key === "will") return "fa-brain";
  if (check.ability) return game.playerPilot.model.abilityDisplayIcon(check.ability);
  if (String(check.kind ?? "").toLowerCase().includes("save")) return "fa-shield-halved";
  return "pp-die-d20";
}

function describeFormula(formula) {
  const text = String(formula ?? "d20").replace(/\s+/g, " ").trim();
  const mod = parseD20Mod(text);
  if (/\bd20\b/i.test(text)) return `Roll a d20, then add ${signedMod(mod)}`;
  return `Roll ${text}`;
}

export function displayedTargetTokens(scene = state.scene) {
  const tokens = scene?.tokens ?? [];
  if (!tokens.length) return [];
  const combatIds = new Set(scene?.combatTokenIds ?? []);
  const manualIds = new Set(scene?.manualTargetIds ?? []);
  const manualActorIds = new Set(scene?.manualTargetActorIds ?? []);
  return tokens.filter((token) => {
    const baseAllowed = token.owned || token.playerOwned || manualIds.has(token.id) || manualActorIds.has(token.actorId);
    return baseAllowed || combatIds.has(token.id);
  });
}

function renderTargetStateBadges(token = {}) {
  const effects = Array.isArray(token.effects) ? token.effects : [];
  if (!effects.length) return "";
  return `
    <span class="pp-target-states" aria-label="Target effects">
      ${effects.map((effect) => {
    const label = cleanRulesText(effect?.label ?? effect?.id ?? "Effect");
    const img = String(effect?.img ?? "").trim();
    return img
      ? `<img class="pp-target-state-badge" src="${escapeHtml(img)}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}">`
      : `<span class="pp-target-state-badge pp-target-state-text" title="${escapeHtml(label)}">${escapeHtml(label.slice(0, 2).toUpperCase())}</span>`;
  }).join("")}
    </span>
  `;
}

function renderMapView() {
  return `
    <section class="pp-view active">
      <div class="pp-dpad-wrap">
        <div class="pp-section pp-movement-section">
          ${renderSectionHeader("Movement", "fa-person-running")}
          <div class="pp-dpad">
            <button class="up-left" type="button" data-action="move" data-dir="up-left" aria-label="Move up left"><i class="fas fa-arrow-up"></i></button>
            <button class="up" type="button" data-action="move" data-dir="up"><i class="fas fa-arrow-up"></i></button>
            <button class="up-right" type="button" data-action="move" data-dir="up-right" aria-label="Move up right"><i class="fas fa-arrow-up"></i></button>
            <button class="left" type="button" data-action="move" data-dir="left"><i class="fas fa-arrow-left"></i></button>
            <button class="center" type="button" data-action="ping-token"><i class="fas fa-location-dot"></i></button>
            <button class="right" type="button" data-action="move" data-dir="right"><i class="fas fa-arrow-right"></i></button>
            <button class="down-left" type="button" data-action="move" data-dir="down-left" aria-label="Move down left"><i class="fas fa-arrow-down"></i></button>
            <button class="down" type="button" data-action="move" data-dir="down"><i class="fas fa-arrow-down"></i></button>
            <button class="down-right" type="button" data-action="move" data-dir="down-right" aria-label="Move down right"><i class="fas fa-arrow-down"></i></button>
          </div>
          ${renderMovementStatus()}
        </div>
      </div>
      <div class="pp-section">
        ${renderSectionHeader("Ping On Map", "fa-map-location-dot")}
        <div class="pp-two-col">
          <button class="pp-button primary" type="button" data-action="request-map">Request Snapshot</button>
          <button class="pp-button" type="button" data-action="clear-map">Clear</button>
        </div>
        <div class="pp-map-tools">
          <button class="pp-button" type="button" data-action="map-zoom" data-delta="-0.25"><i class="fas fa-magnifying-glass-minus"></i></button>
          <button class="pp-button" type="button" data-action="map-reset"><i class="fas fa-arrows-rotate"></i></button>
          <button class="pp-button" type="button" data-action="map-zoom" data-delta="0.25"><i class="fas fa-magnifying-glass-plus"></i></button>
        </div>
        <div class="pp-map-img" data-action="map-click" style="--pp-map-zoom:${state.mapZoom};--pp-map-pan-x:${state.mapPanX}px;--pp-map-pan-y:${state.mapPanY}px;">
          ${state.mapSnapshot?.image
      ? `<img src="${escapeHtml(state.mapSnapshot.image)}" alt="Map snapshot">`
      : `<div class="pp-map-placeholder">Request a snapshot from the GM. Pinch or use the zoom buttons, drag the image to pan, then tap the place you want to ping.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderMovementStatus() {
  if (!state.lastMoveLabel) return "";
  const icon = ({
    up: "fa-arrow-up",
    down: "fa-arrow-down",
    left: "fa-arrow-left",
    right: "fa-arrow-right",
    "up-left": "fa-route",
    "up-right": "fa-route",
    "down-left": "fa-route",
    "down-right": "fa-route"
  })[state.lastMoveDir] ?? "fa-route";
  return `
    <div class="pp-move-status">
      <span class="pp-move-line"><i class="fas ${escapeHtml(icon)}"></i></span>
      <strong>${escapeHtml(state.lastMoveLabel)}</strong>
    </div>
  `;
}

function bindShellEvents() {
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("change", handleDocumentChange, true);
  document.addEventListener("input", handleDocumentInput, true);
  document.addEventListener("search", handleDocumentInput, true);
  document.addEventListener("scroll", handleDocumentScroll, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("pointercancel", handlePointerUp, true);
  document.addEventListener("touchmove", markPilotInteracting, { capture: true, passive: true });
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
}

function handleDocumentScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains("pp-body") || !isInShell(target)) return;
  updateScrollTopButton(target);
}

function updateScrollTopButton(body = state.shell?.element.querySelector(".pp-body")) {
  const button = state.shell?.element.querySelector(".pp-scroll-top");
  if (!(button instanceof HTMLElement)) return;
  button.classList.toggle("visible", Number(body?.scrollTop ?? 0) > 280);
}

function handleWheel(event) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const map = target?.closest?.(".pp-map-img");
  if (map instanceof HTMLElement && isInShell(map) && state.mapSnapshot?.image) {
    event.preventDefault();
    markPilotInteracting();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    state.mapZoom = clamp(Number(state.mapZoom ?? 1) + delta, 0.75, 3);
    map.style.setProperty("--pp-map-zoom", `${state.mapZoom}`);
    return;
  }
  if (isInShell(target)) markPilotInteracting();
}

function setMapTransform(map = state.shell?.element.querySelector(".pp-map-img")) {
  if (!(map instanceof HTMLElement)) return;
  map.style.setProperty("--pp-map-zoom", `${state.mapZoom}`);
  map.style.setProperty("--pp-map-pan-x", `${state.mapPanX}px`);
  map.style.setProperty("--pp-map-pan-y", `${state.mapPanY}px`);
}

function mapPointerList() {
  return Array.from(state.mapPointers?.values?.() ?? []);
}

function pointerDistance(a, b) {
  return Math.hypot(Number(a?.x ?? 0) - Number(b?.x ?? 0), Number(a?.y ?? 0) - Number(b?.y ?? 0));
}

function beginMapPinch() {
  const points = mapPointerList();
  if (points.length < 2) return;
  state.mapPinch = {
    distance: Math.max(1, pointerDistance(points[0], points[1])),
    zoom: Number(state.mapZoom ?? 1),
    panX: Number(state.mapPanX ?? 0),
    panY: Number(state.mapPanY ?? 0),
    moved: false
  };
  state.mapDrag = null;
}

function handlePointerDown(event) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const map = target?.closest?.(".pp-map-img");
  if (!(map instanceof HTMLElement) || !isInShell(map) || !state.mapSnapshot?.image) return;
  event.preventDefault();
  markPilotInteracting();
  state.mapPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  map.setPointerCapture?.(event.pointerId);
  if (state.mapPointers.size >= 2) {
    beginMapPinch();
    return;
  }
  state.mapDrag = Number(state.mapZoom ?? 1) > 1 ? {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: Number(state.mapPanX ?? 0),
    panY: Number(state.mapPanY ?? 0),
    moved: false
  } : null;
}

function handlePointerMove(event) {
  if (state.mapPointers?.has?.(event.pointerId)) {
    state.mapPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  }
  if (state.mapPinch && state.mapPointers.size >= 2) {
    event.preventDefault();
    markPilotInteracting();
    const points = mapPointerList();
    const distance = Math.max(1, pointerDistance(points[0], points[1]));
    const nextZoom = clamp(Number(state.mapPinch.zoom ?? 1) * (distance / Math.max(1, Number(state.mapPinch.distance ?? 1))), 0.75, 3);
    if (Math.abs(nextZoom - Number(state.mapPinch.zoom ?? 1)) > 0.01) state.mapPinch.moved = true;
    state.mapZoom = nextZoom;
    setMapTransform();
    return;
  }
  if (!state.mapDrag || state.mapDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - state.mapDrag.x;
  const dy = event.clientY - state.mapDrag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) state.mapDrag.moved = true;
  state.mapPanX = state.mapDrag.panX + dx;
  state.mapPanY = state.mapDrag.panY + dy;
  setMapTransform();
}

function handlePointerUp(event) {
  if (state.mapPointers?.has?.(event.pointerId)) state.mapPointers.delete(event.pointerId);
  if (state.mapPinch && state.mapPointers.size < 2) {
    if (state.mapPinch.moved === true) state.mapSuppressClickUntil = Date.now() + 450;
    if (state.mapPointers.size === 1 && Number(state.mapZoom ?? 1) > 1) {
      const point = mapPointerList()[0];
      state.mapDrag = {
        pointerId: Number(point?.id ?? event.pointerId),
        x: Number(point?.x ?? event.clientX),
        y: Number(point?.y ?? event.clientY),
        panX: Number(state.mapPanX ?? 0),
        panY: Number(state.mapPanY ?? 0),
        moved: state.mapPinch.moved === true
      };
    }
    state.mapPinch = null;
  }
  window.setTimeout(() => {
    if (!state.mapPointers?.size) {
      state.mapDrag = null;
      state.mapPinch = null;
    }
  }, 0);
}

function isInShell(target) {
  return !!state.shell && target instanceof Node && state.shell.element.contains(target);
}

function handleDocumentInput(event) {
  const target = event.target;
  if (!isInShell(target)) return;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.action === "search") {
    markPilotInteracting();
    state.search = target.value ?? "";
    target.closest(".pp-search-wrap")?.querySelector(".pp-search-clear")?.classList?.toggle("hidden", !state.search);
    applySearchFilter();
  }
}

function markPilotInteracting() {
  state.suppressSceneRenderUntil = Date.now() + 5500;
}

function shouldDelaySceneRender() {
  if (Date.now() < Number(state.suppressSceneRenderUntil ?? 0)) return true;
  return isInShell(document.activeElement) && document.activeElement?.classList?.contains?.("pp-search");
}

export function applySearchFilter() {
  const q = state.search.trim().toLowerCase();
  const shell = state.shell.element;
  if (!shell) return;
  shell.querySelectorAll(".pp-searchable").forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    const haystack = String(card.dataset.search ?? "").toLowerCase();
    card.hidden = !!q && !haystack.includes(q);
  });
}

function handleDocumentChange(event) {
  const target = event.target;
  if (!isInShell(target)) return;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.dataset.action === "actor-select") {
    state.actorId = target.value;
    game.settings.set(MODULE_ID, "lastActorId", state.actorId);
    state.selectedTokenId = "";
    state.search = "";
    queueRender();
  }
}

async function handleDocumentClick(event) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return;
  if (state.modal?.contains(target)) return;
  if (!isInShell(target)) return;

  const actionEl = target.closest("[data-action]");
  if (!(actionEl instanceof HTMLElement)) return;
  const action = actionEl.dataset.action;
  if (Object.keys(state.shell.options.actions).includes(action)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  if (BLOCKED_WHILE_PAUSED.has(action) && pilotPaused()) {
    warnPaused();
    return;
  }

  if (action === "map-click") {
    handleMapSnapshotClick(event, actionEl);
    return;
  }

  if (action === "tab") {
    const nextTab = actionEl.dataset.tab ?? "actions";
    state.scrollBodyToTop = nextTab !== state.activeTab;
    state.activeTab = nextTab;
    state.search = "";
    state.navOpen = false;
    queueRender();
    return;
  }
  if (action === "toggle-nav") {
    state.navOpen = !state.navOpen;
    queueRender();
    return;
  }
  if (action === "quickFilter") {
    const key = actionEl.dataset.filterKey ?? state.activeTab;
    const value = actionEl.dataset.filter ?? "all";
    if (actionEl.dataset.multi === "true" || isMultiFilterKey(key)) {
      const selected = new Set(selectedQuickFilters(key));
      if (value === "all") selected.clear();
      else if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      state.quickFilters[key] = Array.from(selected);
    } else {
      state.quickFilters[key] = value;
    }
    queueRender();
    return;
  }
  if (action === "toggle-filter-menu") {
    const menu = actionEl.dataset.filterMenu ?? "";
    state.filterMenuOpen = state.filterMenuOpen === menu ? "" : menu;
    queueRender();
    return;
  }
  if (action === "search-clear") {
    state.search = "";
    state.shell?.element.querySelectorAll(".pp-search").forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = "";
    });
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains("pp-search")) {
      document.activeElement.blur();
    }
    applySearchFilter();
    queueRender();
    return;
  }
  if (action === "scroll-top") {
    const body = state.shell?.element.querySelector(".pp-body");
    body?.scrollTo?.({ top: 0, behavior: "smooth" });
    return;
  }
  if (action === "toggle-stats") {
    state.activeTab = "stats";
    state.navOpen = false;
    queueRender();
    return;
  }
  if (action === "refresh" || action === "refresh-scene") {
    state.suppressSceneRenderUntil = 0;
    requestSceneState(true);
    queueRender();
    return;
  }
  if (action === "death-save") {
    await updateDeathSaves(actionEl.dataset.kind ?? "");
    return;
  }
  if (action === "pf2e-resource") {
    await updatePf2eResource(actionEl.dataset.resource ?? "", Number(actionEl.dataset.delta ?? 0));
    return;
  }
  if (action === "use-item") {
    openUseDialog(actionEl.dataset.itemId ?? "");
    return;
  }
  if (action === "item-info") {
    await openItemInfoDialog(actionEl.dataset.itemId ?? "");
    return;
  }
  if (action === "roll-check") {
    await rollCheck(actionEl.dataset.kind ?? "", actionEl.dataset.key ?? "");
    return;
  }
  if (action === "roll-menu") {
    openRollChoiceDialog(actionEl.dataset);
    return;
  }
  if (action === "manual-roll") {
    openManualRollDialog(actionEl.dataset);
    return;
  }
  if (action === "qty") {
    await updateItemQuantity(actionEl.dataset.itemId ?? "", Number(actionEl.dataset.delta ?? 0));
    return;
  }
  if (action === "target-toggle") {
    toggleTarget(actionEl.dataset.tokenId ?? "");
    return;
  }
  if (action === "apply-targets") {
    await applyTargets();
    return;
  }
  if (action === "ping-targets") {
    await pingSelectedTargets();
    return;
  }
  if (action === "select-token") {
    state.selectedTokenId = actionEl.dataset.tokenId ?? "";
    queueRender();
    return;
  }
  if (action === "move") {
    await moveActiveToken(actionEl.dataset.dir ?? "");
    return;
  }
  if (action === "ping-token") {
    await pingActiveToken();
    return;
  }
  if (action === "request-map") {
    requestMapSnapshot();
    return;
  }
  if (action === "clear-map") {
    state.mapSnapshot = null;
    state.mapZoom = 1;
    state.mapPanX = 0;
    state.mapPanY = 0;
    queueRender();
    return;
  }
  if (action === "map-zoom") {
    state.mapZoom = clamp(Number(state.mapZoom ?? 1) + Number(actionEl.dataset.delta ?? 0), 0.75, 3);
    queueRender();
    return;
  }
  if (action === "map-reset") {
    state.mapZoom = 1;
    state.mapPanX = 0;
    state.mapPanY = 0;
    queueRender();
    return;
  }
}

function findItem(itemId) {
  const actor = currentActor();
  return actor?.items?.get?.(itemId) ?? null;
}

export function openModal(content, handlers = {}) {
  closeModal();
  document.querySelector(".pp-result-toast")?.remove();
  const modal = document.createElement("section");
  modal.className = "pp-modal";
  modal.innerHTML = `<div class="pp-dialog">${content}</div>`;
  document.body.appendChild(modal);
  document.body.classList.add("player-pilot-modal-open");
  state.modal = modal;
  modal.addEventListener("click", async (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest?.("[data-modal-action]");
    const action = button?.dataset?.modalAction;
    if (!action) {
      if (target === modal) closeModal();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action === "close") {
      closeModal();
      return;
    }
    if (typeof handlers[action] === "function") {
      await handlers[action](modal, button);
    }
  });
  modal.addEventListener("change", async (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || typeof handlers.change !== "function") return;
    await handlers.change(modal, target, event);
  });
}

export function closeModal() {
  const modalApp = state.modalApp;
  state.modalApp = null;
  if (modalApp) modalApp.close({ animate: false });
  state.modal?.remove();
  state.modal = null;
  document.body.classList.remove("player-pilot-modal-open");
}

async function openItemInfoDialog(itemId) {
  const item = findItem(itemId);
  if (!item) return;
  const normalized = game.playerPilot.model.normalizeItem(item);
  const canUse = normalized.usable !== false;
  const description = await enrichRulesHtml(item.system?.description?.value ?? item.system?.description ?? "", item);
  openModal(`
    <div class="pp-info-title">
      <div class="pp-card-img" style="background-image:url('${escapeHtml(item.img ?? "icons/svg/item-bag.svg")}')"></div>
      <h2>${escapeHtml(item.name)}</h2>
    </div>
    ${renderSpellDetails(normalized)}
    <div class="pp-rich-text">${description || "<p>No description available.</p>"}</div>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Close</button>
      ${canUse ? `<button class="pp-button primary" type="button" data-modal-action="use">Use</button>` : ""}
    </div>
  `, {
    use: async () => {
      closeModal();
      openUseDialog(itemId);
    }
  });
}

function openConcentrationBreakDialog(itemId, item, effect) {
  const currentName = game.playerPilot.model.concentrationEffectLabel(effect);
  openModal(`
    <h2>Break Concentration First</h2>
    <div class="pp-concentration-gate">
      <i class="fas fa-brain"></i>
      <div>
        <span>Currently concentrating on</span>
        <strong>${escapeHtml(currentName)}</strong>
      </div>
    </div>
    <p><strong>${escapeHtml(itemDisplayName(item))}</strong> also requires concentration. End ${escapeHtml(currentName)} before continuing with this use?</p>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      <button class="pp-button primary" type="button" data-modal-action="replaceConcentration">Break &amp; Continue</button>
    </div>
  `, {
    replaceConcentration: async () => {
      closeModal();
      openUseDialog(itemId, { approvedConcentrationId: String(effect.id ?? "") });
    }
  });
}

function openUseDialog(itemId, flowOptions = {}) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  const item = findItem(itemId);
  if (!actor || !item) return;
  const model = game.playerPilot.model;
  const canUseItem = model.canUseItem(item);
  if (!canUseItem) {
    const message = model.id === "pf2e" && item.type === "spell"
      ? "That spell has no available slot, use, or Focus Point."
      : (item.type === "spell" ? "That spell is not prepared." : "Equip that item before using it.");
    ui.notifications?.warn?.(message);
    return;
  }
  const activeConcentration = model.id === "dnd5e" && item.type === "spell" && model.itemRequiresConcentration(item)
    ? model.actorConcentrationEffects(actor)[0] ?? null
    : null;
  if (activeConcentration && String(activeConcentration.id ?? "") !== String(flowOptions.approvedConcentrationId ?? "")) {
    openConcentrationBreakDialog(itemId, item, activeConcentration);
    return;
  }

  closeModal();
  const dialog = new UseItemDialog({
    actor,
    item,
    model,
    activeConcentration,
    services: {
      actorId: () => state.actorId,
      applyTargetsForCurrentUser,
      assessSneakAttackApplicability,
      autoRollInstruction,
      clearActiveModal: (app) => {
        if (state.modalApp === app) state.modalApp = null;
        if (state.modal === app.element) state.modal = null;
        if (!state.modal) document.body.classList.remove("player-pilot-modal-open");
      },
      clearUseTargets,
      getSneakAttackOption,
      itemRequiresMapPlacement,
      openManualRollDialog,
      openPingOnMap,
      pilotPaused,
      renderCastPreview,
      renderModalTargetPicker,
      renderRollInstructions,
      renderSneakAttackChoice,
      runNativeItemRoll,
      sceneId: () => state.scene?.id ?? "",
      selectedTargetSet,
      sendSocket,
      setActiveModal: (app) => {
        state.modalApp = app;
        state.modal = app.element;
        document.body.classList.add("player-pilot-modal-open");
      },
      setSelectedTargetSet,
      targetInstructionText,
      updateModalTargetCount,
      useItem,
      warnPaused
    }
  });
  const openLegacyFallback = (error) => {
    console.error("Player Pilot could not render the AppV2 item-use flow; using the legacy dialog.", error);
    closeModal();
    legacyOpenUseDialog(itemId, flowOptions);
  };
  try {
    Promise.resolve(dialog.render(true)).catch(openLegacyFallback);
  } catch (error) {
    openLegacyFallback(error);
  }
}

function legacyOpenUseDialog(itemId, flowOptions = {}) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  const item = findItem(itemId);
  if (!actor || !item) return;
  const model = game.playerPilot.model;
  const canUseItem = model.canUseItem(item);
  if (!canUseItem) {
    const message = model.id === "pf2e" && item.type === "spell"
      ? "That spell has no available slot, use, or Focus Point."
      : (item.type === "spell" ? "That spell is not prepared." : "Equip that item before using it.");
    ui.notifications?.warn?.(message);
    return;
  }
  const activeConcentration = model.id === "dnd5e" && item.type === "spell" && model.itemRequiresConcentration(item)
    ? model.actorConcentrationEffects(actor)[0] ?? null
    : null;
  if (activeConcentration && String(activeConcentration.id ?? "") !== String(flowOptions.approvedConcentrationId ?? "")) {
    openConcentrationBreakDialog(itemId, item, activeConcentration);
    return;
  }
  const slots = model.spellSlotChoices(item);
  const ammo = model.ammoChoices?.(item) ?? [];
  const concentration = model.concentrationWarning?.(item) ?? "";
  const normalized = model.normalizeItem(item);
  const activities = model.usableItemActivities ? model.usableItemActivities(item) : [];
  const playerChoice = model.itemPlayerChoice?.(item);
  const activityStep = activities.length > 1 || !!playerChoice;
  const defaultActivityId = activities[0]?.id ?? "";
  const defaultCastLevel = slots[0]?.level ?? (item.type === "spell" ? (model.id === "pf2e" ? model.pf2eSpellRank(item) : "") : "");
  const baseCastLevel = item.type === "spell"
    ? (model.id === "pf2e" ? model.pf2eSpellRank(item) : Number(item.system?.level ?? 0))
    : "";
  const instructions = model.collectRollInstructions?.(item, { castLevel: defaultCastLevel, activityId: defaultActivityId });
  const baseInstructionsFor = (activityId = "") => model.collectRollInstructions?.(item, {
    castLevel: baseCastLevel,
    activityId
  });
  const hasFollowupRolls = (entries = []) => entries.some((entry) => entry.formula || entry.nativeAction);
  const sneakAttack = model.id === "dnd5e" && item.type === "weapon" ? getSneakAttackOption(actor) : null;
  const targetInfoFor = (activityId = "") => model.itemTargetInfo(item, activityId);
  const rangeFeetFor = (activityId = "") => model.getItemRangeFeet?.(item, activityId);
  let targetInfo = targetInfoFor(defaultActivityId);
  let targetStep = targetInfo.needsTarget || targetInfo.canTarget;
  const spellStep = item.type === "spell" && (model.id !== "pf2e" || slots.length > 0);
  clearUseTargets();
  const refreshSneakAttackChoice = (modal, activityId = defaultActivityId) => {
    if (!sneakAttack) return null;
    const control = modal.querySelector("[data-sneak-attack-control]");
    if (!(control instanceof HTMLElement)) return null;
    const wasChecked = control.querySelector("[name='useSneakAttack']")?.checked === true;
    const assessment = assessSneakAttackApplicability(actor, item, activityId);
    control.innerHTML = renderSneakAttackChoice(sneakAttack, assessment, wasChecked);
    return assessment;
  };
  const readUseOptions = (modal) => {
    const useSneakAttack = sneakAttack && modal.querySelector("[name='useSneakAttack']")?.checked === true;
    const activityId = modal.querySelector("[name='activityId']")?.value ?? defaultActivityId;
    const activity = activities.find((entry) => entry.id === activityId);
    return {
      activityId,
      activityName: activity?.name ?? "",
      playerChoice: modal.querySelector("[name='playerChoice']")?.value ?? "",
      playerChoiceLabel: playerChoice?.label ?? "",
      castLevel: modal.querySelector("[name='castLevel']")?.value ?? defaultCastLevel ?? "",
      ammoItemId: modal.querySelector("[name='ammoItemId']")?.value ?? "",
      sneakAttackFormula: useSneakAttack ? sneakAttack.formula : "",
      replaceConcentrationEffectId: activeConcentration?.id ?? ""
    };
  };
  const refreshRollInstructions = (modal) => {
    const activityId = modal.querySelector("[name='activityId']")?.value ?? defaultActivityId;
    refreshSneakAttackChoice(modal, activityId);
    const options = readUseOptions(modal);
    const currentInstructions = model.collectRollInstructions?.(item, options);
    const wrap = modal.querySelector("[data-roll-instructions]");
    if (wrap) wrap.innerHTML = renderRollInstructions(currentInstructions, true);
    const castButton = modal.querySelector("[data-modal-action='castSpell']");
    if (castButton) castButton.textContent = hasFollowupRolls(currentInstructions)
      ? "Use Spell & Continue to Rolls"
      : "Use Spell";
    const preview = modal.querySelector("[data-cast-preview]");
    if (preview) preview.innerHTML = renderCastPreview(
      currentInstructions,
      options.castLevel,
      model.id,
      baseInstructionsFor(options.activityId),
      baseCastLevel
    );
    return { options, currentInstructions };
  };
  const finishUseFlow = async (modal, options, currentInstructions) => {
    await useItem(itemId, options, { showReminder: false });
    const placementNeeded = itemRequiresMapPlacement(item, options.activityId);
    if (!hasFollowupRolls(currentInstructions) && !placementNeeded) {
      closeModal();
      return;
    }
    modal.querySelectorAll("[data-use-step]").forEach((step) => step.classList.add("hidden"));
    modal.querySelector("[data-use-step='rolls']")?.classList?.remove?.("hidden");
    const title = modal.querySelector("[data-rolls-heading-title]");
    const detail = modal.querySelector("[data-rolls-heading-detail]");
    if (title && placementNeeded && !hasFollowupRolls(currentInstructions)) title.textContent = "Placement Needed";
    if (detail && placementNeeded) detail.textContent = hasFollowupRolls(currentInstructions)
      ? "After resolving the rolls below, ping the map so the GM knows where to place the effect."
      : "Ping the map so the GM knows where to place the effect.";
    modal.querySelector("[data-placement-prompt]")?.classList?.toggle?.("hidden", !placementNeeded);
    modal.querySelectorAll(".pp-dialog-actions [data-modal-action]:not([data-modal-action='close'])").forEach((button) => button.classList.add("hidden"));
    const finalButton = modal.querySelector("[data-final-done]");
    if (finalButton instanceof HTMLElement) {
      finalButton.dataset.modalAction = placementNeeded ? "goToPing" : "close";
      finalButton.textContent = placementNeeded ? "Ping On Map" : "Done";
      finalButton.classList.remove("hidden");
    }
  };
  openModal(`
    <h2>Use ${escapeHtml(itemDisplayName(item))}</h2>
    <div class="pp-use-step ${activityStep ? "" : "hidden"}" data-use-step="activity">
      <div class="pp-activity-choice-hero">
        <i class="fas fa-list-check"></i>
        <div><strong>Choose how to use this action</strong><span>${escapeHtml(playerChoice?.prompt ?? "Select the exact activity before continuing.")}</span></div>
      </div>
      ${activities.length > 1 ? `
        <label>Activity</label>
        <select class="pp-select" name="activityId">
          ${activities.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}
        </select>
      ` : ""}
      ${playerChoice ? `
        <label>${escapeHtml(playerChoice.label)}</label>
        <select class="pp-select" name="playerChoice">
          ${playerChoice.options.map((entry) => `<option value="${escapeHtml(entry.value)}">${escapeHtml(entry.label)}</option>`).join("")}
        </select>
      ` : ""}
    </div>
    <div class="pp-use-step ${!activityStep && targetStep ? "" : "hidden"}" data-use-step="targets">
      <p data-modal-target-summary>${escapeHtml(targetInstructionText(targetInfo))}</p>
      <div data-modal-target-picker>${renderModalTargetPicker({ ...normalized, targetInfo, rangeFeet: rangeFeetFor(defaultActivityId) })}</div>
    </div>
    <div class="pp-use-step ${!activityStep && !targetStep && spellStep ? "" : "hidden"}" data-use-step="cast">
      ${concentration ? `<p><strong>${escapeHtml(concentration)}</strong></p>` : ""}
      ${slots.length ? `
        <label>${model.id === "pf2e" ? "Cast Rank" : "Cast Level"}</label>
        <select class="pp-select" name="castLevel">
          ${slots.map((slot) => `<option value="${slot.level}">${escapeHtml(slot.label)}</option>`).join("")}
        </select>
      ` : `<div class="pp-cast-level-static"><i class="fas fa-wand-magic-sparkles"></i><strong>${model.id === "pf2e" && model.pf2eIsCantrip(item) ? "Cantrip" : (Number(defaultCastLevel ?? 0) > 0 ? `${model.id === "pf2e" ? "Spell Rank" : "Spell Level"} ${escapeHtml(defaultCastLevel)}` : "Cantrip")}</strong></div>`}
      <div class="pp-cast-preview" data-cast-preview>${renderCastPreview(instructions, defaultCastLevel, model.id, baseInstructionsFor(defaultActivityId), baseCastLevel)}</div>
      ${ammo.length ? `
        <label>Ammo</label>
        <select class="pp-select" name="ammoItemId">
          <option value="">Default</option>
          ${ammo.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join("")}
        </select>
      ` : ""}
    </div>
    <div class="pp-use-step ${activityStep || targetStep || spellStep ? "hidden" : ""}" data-use-step="rolls">
      ${concentration ? `<p><strong>${escapeHtml(concentration)}</strong></p>` : ""}
      <div class="pp-rolls-required-heading">
        <i class="fas fa-list-check"></i>
        <div>
          <strong data-rolls-heading-title>Rolls Still Required</strong>
          <span data-rolls-heading-detail>Complete each applicable attack, save, damage, healing, or system roll step below.</span>
        </div>
      </div>
      <div class="pp-placement-prompt hidden" data-placement-prompt>
        <i class="fas fa-map-location-dot"></i>
        <div><strong>Placement needed</strong><span>Use Ping On Map so the GM can place the template, teleport, or chosen point.</span></div>
      </div>
      ${sneakAttack ? `<div data-sneak-attack-control>${renderSneakAttackChoice(sneakAttack, assessSneakAttackApplicability(actor, item, defaultActivityId))}</div>` : ""}
      <div data-roll-instructions>${renderRollInstructions(instructions, true)}</div>
    </div>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      <button class="pp-button primary ${activityStep ? "" : "hidden"}" type="button" data-modal-action="nextActivityStep">Next</button>
      <button class="pp-button primary ${!activityStep && targetStep ? "" : "hidden"}" type="button" data-modal-action="nextTargetStep">Next</button>
      <button class="pp-button primary ${!activityStep && !targetStep && spellStep ? "" : "hidden"}" type="button" data-modal-action="castSpell">${hasFollowupRolls(instructions) ? "Use Spell &amp; Continue to Rolls" : "Use Spell"}</button>
      <button class="pp-button primary ${activityStep || targetStep || spellStep ? "hidden" : ""}" type="button" data-modal-action="use">Next</button>
      <button class="pp-button primary hidden" type="button" data-modal-action="close" data-final-done>Done</button>
    </div>
  `, {
    nextActivityStep: async (modal) => {
      const { options } = refreshRollInstructions(modal);
      targetInfo = targetInfoFor(options.activityId);
      targetStep = targetInfo.needsTarget || targetInfo.canTarget;
      modal.querySelector("[data-use-step='activity']")?.classList?.add?.("hidden");
      modal.querySelector("[data-modal-action='nextActivityStep']")?.classList?.add?.("hidden");
      const targetSummary = modal.querySelector("[data-modal-target-summary]");
      if (targetSummary) targetSummary.textContent = targetInstructionText(targetInfo);
      const picker = modal.querySelector("[data-modal-target-picker]");
      if (picker) picker.innerHTML = renderModalTargetPicker({ ...normalized, targetInfo, rangeFeet: rangeFeetFor(options.activityId) });
      if (targetStep) {
        modal.querySelector("[data-use-step='targets']")?.classList?.remove?.("hidden");
        modal.querySelector("[data-modal-action='nextTargetStep']")?.classList?.remove?.("hidden");
      } else if (spellStep) {
        modal.querySelector("[data-use-step='cast']")?.classList?.remove?.("hidden");
        modal.querySelector("[data-modal-action='castSpell']")?.classList?.remove?.("hidden");
      } else {
        await finishUseFlow(modal, options, model.collectRollInstructions?.(item, options));
      }
    },
    modalToggleTarget: async (_modal, button) => {
      if (pilotPaused()) {
        warnPaused();
        return;
      }
      if (button?.disabled || button?.dataset?.disabled === "true") return;
      const tokenId = button?.dataset?.tokenId ?? "";
      const sceneId = state.scene?.id ?? "";
      const selected = selectedTargetSet(sceneId);
      if (selected.has(tokenId)) selected.delete(tokenId);
      else {
        const limit = Number(targetInfo.count ?? 0);
        if (Number.isFinite(limit) && limit > 0 && selected.size >= limit) {
          ui.notifications?.warn?.(`Select up to ${limit} target${limit === 1 ? "" : "s"}.`);
          return;
        }
        selected.add(tokenId);
      }
      setSelectedTargetSet(sceneId, selected);
      applyTargetsForCurrentUser(Array.from(selected), sceneId);
      const row = button.closest(".pp-token-row");
      const isSelected = selected.has(tokenId);
      row?.classList?.toggle?.("selected", isSelected);
      button.classList.toggle("primary", isSelected);
      button.textContent = isSelected ? "Targeted" : "Target";
      updateModalTargetCount(selected.size, targetInfo);
      refreshSneakAttackChoice(_modal, _modal.querySelector("[name='activityId']")?.value ?? defaultActivityId);
      sendSocket("targetUpdate", { actorId: state.actorId, sceneId, targetIds: Array.from(selected) });
    },
    nextTargetStep: async (modal) => {
      if (pilotPaused()) {
        warnPaused();
        return;
      }
      const current = selectedTargetSet(state.scene?.id ?? "");
      if (targetInfo.needsTarget && current.size <= 0) {
        ui.notifications?.warn?.("Choose a target first.");
        return;
      }
      modal.querySelector("[data-use-step='targets']")?.classList?.add?.("hidden");
      modal.querySelector("[data-modal-action='nextTargetStep']")?.classList?.add?.("hidden");
      if (spellStep) {
        modal.querySelector("[data-use-step='cast']")?.classList?.remove?.("hidden");
        modal.querySelector("[data-modal-action='castSpell']")?.classList?.remove?.("hidden");
      } else {
        const { options, currentInstructions } = refreshRollInstructions(modal);
        await finishUseFlow(modal, options, currentInstructions);
      }
    },
    castSpell: async (modal) => {
      if (pilotPaused()) {
        warnPaused();
        return;
      }
      const { options, currentInstructions } = refreshRollInstructions(modal);
      await finishUseFlow(modal, options, currentInstructions);
    },
    use: async (modal) => {
      if (pilotPaused()) {
        warnPaused();
        return;
      }
      const { options } = refreshRollInstructions(modal);
      const currentInstructions = model.collectRollInstructions?.(item, options);
      await finishUseFlow(modal, options, currentInstructions);
    },
    manualInstruction: async (_modal, button) => {
      openManualRollDialog(button.dataset);
    },
    autoInstruction: async (_modal, button) => {
      await autoRollInstruction(item, button.dataset);
    },
    nativeInstruction: async (_modal, button) => {
      await runNativeItemRoll(item, button.dataset.nativeAction ?? "", button.dataset.castRank, button.dataset.attackNumber);
    },
    goToPing: async () => {
      closeModal();
      openPingOnMap();
    },
    change: async (modal, target) => {
      if (target instanceof HTMLInputElement && target.name === "useSneakAttack") {
        refreshRollInstructions(modal);
        return;
      }
      if (target instanceof HTMLSelectElement && target.name === "activityId") {
        refreshRollInstructions(modal);
        return;
      }
      if (!(target instanceof HTMLSelectElement) || target.name !== "castLevel") return;
      refreshRollInstructions(modal);
    }
  });
}

function getSneakAttackOption(actor) {
  const feature = asArray(actor?.items).find((item) => {
    const identifier = String(item?.system?.identifier ?? item?.identifier ?? "").toLowerCase();
    return identifier === "sneak-attack" || /\bsneak attack\b/i.test(item?.name ?? "");
  });
  if (!feature) return null;
  const rogueScale = actor?.system?.scale?.rogue ?? {};
  const scale = rogueScale["sneak-attack"] ?? rogueScale.sneakAttack ?? rogueScale.sneak ?? null;
  let formula = scaleValueFormula(scale);
  const damage = game.playerPilot.model.collectRollInstructions(feature).find((entry) => entry.kind === "damage" && entry.formula);
  if (!formula) formula = String(damage?.formula ?? "").trim();
  if (!formula) {
    const description = htmlToPlain(feature.system?.description?.value ?? feature.system?.description ?? "");
    formula = description.match(/\b(\d+d(?:4|6|8|10|12))\b/i)?.[1] ?? "";
  }
  return formula ? { itemId: feature.id, formula } : null;
}

function weaponSupportsSneakAttack(item, activityId = "") {
  const selected = game.playerPilot.model.selectedItemActivity(item, activityId)?.activity ?? null;
  const data = game.playerPilot.model.activitySystem(selected);
  const attackType = fieldText(
    data?.attack?.type?.value,
    data?.attack?.type,
    data?.actionType,
    selected?.actionType,
    item?.system?.actionType
  ).toLowerCase();
  const weaponType = String(item?.system?.type?.value ?? item?.system?.weaponType ?? "").toLowerCase();
  const finesse = hasItemProperty(item, "fin") || hasItemProperty(item, "finesse");
  const ranged = attackType.includes("ranged")
    || ["rwak", "rsak"].includes(attackType)
    || weaponType.endsWith("r")
    || ["simple-ranged", "martial-ranged", "siege"].includes(weaponType);
  return finesse || ranged;
}

function sceneTokenIsIncapacitated(token = {}) {
  const statuses = new Set((token.statuses ?? []).map((value) => String(value).toLowerCase()));
  return ["dead", "incapacitated", "paralyzed", "stunned", "unconscious"]
    .some((condition) => Array.from(statuses).some((status) => status.includes(condition)));
}

function sneakAttackNearbyAlly(actor, target) {
  const scene = state.scene;
  const source = activeTokenForActor(actor?.id);
  if (!scene || !source || !target) return null;
  const sourceDisposition = Number(source.disposition ?? 0);
  const targetDisposition = Number(target.disposition ?? 0);
  const maxDistance = 5;
  return (scene.tokens ?? []).find((token) => {
    if (!token || token.id === source.id || token.id === target.id || token.actorId === actor?.id) return false;
    if (sceneTokenIsIncapacitated(token)) return false;
    const alliedWithSource = sourceDisposition !== 0
      ? Number(token.disposition ?? 0) === sourceDisposition
      : token.playerOwned === true;
    const enemyOfTarget = targetDisposition !== 0
      ? Number(token.disposition ?? 0) !== targetDisposition
      : token.playerOwned !== target.playerOwned;
    if (!alliedWithSource || !enemyOfTarget) return false;
    const distance = tokenDistanceFeet(token, target);
    return Number.isFinite(distance) && distance <= maxDistance + 0.01;
  }) ?? null;
}

function assessSneakAttackApplicability(actor, item, activityId = "") {
  if (!weaponSupportsSneakAttack(item, activityId)) {
    return {
      status: "ineligible",
      reason: "This attack is not using a finesse or ranged weapon."
    };
  }
  const selectedIds = selectedTargetSet(state.scene?.id ?? "");
  const target = (state.scene?.tokens ?? []).find((token) => selectedIds.has(String(token.id)));
  if (!target) {
    return {
      status: "uncertain",
      reason: "Choose a target before confirming whether Sneak Attack applies."
    };
  }
  const activity = game.playerPilot.model.selectedItemActivity(item, activityId)?.activity ?? null;
  const attackMode = attackRollMode(actor, activity);
  if (attackMode.rollMode === "disadvantage") {
    return {
      status: "ineligible",
      reason: `The attack currently has disadvantage${attackMode.rollModeReason ? `: ${attackMode.rollModeReason}` : ""}.`
    };
  }
  if (attackMode.rollMode === "advantage") {
    return {
      status: "applicable",
      reason: `Advantage detected${attackMode.rollModeReason ? `: ${attackMode.rollModeReason}` : ""}.`
    };
  }
  const ally = sneakAttackNearbyAlly(actor, target);
  if (ally) {
    return {
      status: "applicable",
      reason: `${ally.name ?? "An ally"} is within 5 feet of the target and is not incapacitated.`
    };
  }
  return {
    status: "not-detected",
    reason: "No advantage or nearby ally was detected; another feature or table ruling may still allow it."
  };
}

function renderSneakAttackChoice(option, assessment = {}, checked = false) {
  const status = String(assessment.status ?? "uncertain");
  const disabled = status === "ineligible";
  const notDetected = status === "not-detected";
  const title = status === "applicable"
    ? "Apply Sneak Attack"
    : (disabled
      ? "Sneak Attack not applicable"
      : (notDetected ? "Apply anyway only if another rule allows it" : "Apply Sneak Attack (if applicable)"));
  const statusLabel = status === "applicable"
    ? "Sneak Attack qualifier detected"
    : (disabled
      ? "Sneak Attack unavailable"
      : (notDetected ? "No Sneak Attack qualifier detected" : "Sneak Attack not yet confirmed"));
  const note = `${assessment.reason ?? "Confirm the Sneak Attack requirements."} Player Pilot cannot confirm whether Sneak Attack was already used this turn.`;
  return `
    <label class="pp-sneak-attack-choice ${escapeHtml(status)}">
      <input type="checkbox" name="useSneakAttack" ${checked && !disabled ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="pp-sneak-attack-copy">
        <span class="pp-sneak-attack-status"><i class="fas ${status === "applicable" ? "fa-circle-check" : (disabled ? "fa-ban" : "fa-triangle-exclamation")}"></i> ${escapeHtml(statusLabel)}</span>
        <strong><i class="fas fa-user-ninja"></i> ${escapeHtml(title)}</strong>
        <small>${escapeHtml(note)}</small>
      </span>
      <b>${escapeHtml(option.formula)}</b>
    </label>
  `;
}

function scaleValueFormula(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return /\d+d\d+/i.test(text) ? text.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/i)?.[0] ?? text : "";
  }
  if (typeof value !== "object") return "";
  const direct = fieldText(value.formula, value.value?.formula, value.value, value.dice);
  if (/\d+d\d+/i.test(direct)) return direct.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/i)?.[0] ?? direct;
  const number = Number(value.number ?? value.value?.number ?? value.dice?.number ?? 0);
  const denomination = Number(value.denomination ?? value.value?.denomination ?? value.dice?.denomination ?? 0);
  if (number > 0 && denomination > 0) return `${number}d${denomination}`;
  for (const nested of Object.values(value)) {
    const found = scaleValueFormula(nested);
    if (found) return found;
  }
  return "";
}

function formulaDiceCounts(formula = "") {
  const counts = new Map();
  for (const match of String(formula).matchAll(/(\d*)d(4|6|8|10|12|20)/gi)) {
    const sides = Number(match[2]);
    counts.set(sides, (counts.get(sides) ?? 0) + Number(match[1] || 1));
  }
  return counts;
}

function formulaIncrease(baseFormula = "", currentFormula = "") {
  const base = formulaDiceCounts(baseFormula);
  const current = formulaDiceCounts(currentFormula);
  const increases = [];
  for (const [sides, count] of current.entries()) {
    const increase = count - Number(base.get(sides) ?? 0);
    if (increase > 0) increases.push(`+${increase}d${sides}`);
  }
  return increases.join(" + ");
}

function previewInstructionKey(entry = {}) {
  return `${String(entry.kind ?? "")}:${String(entry.label ?? "").toLowerCase().replace(/\s+roll$/i, "").trim()}`;
}

function previewEffectLabel(entry = {}) {
  const label = String(entry.label ?? "").replace(/\s+roll$/i, "").trim();
  if (entry.kind === "healing") return label && !/^healing$/i.test(label) ? label : "Healing";
  return label && !/^damage$/i.test(label) ? label : "Damage";
}

function renderCastPreview(instructions = [], castLevel = "", adapterId = "", baseInstructions = [], baseCastLevel = "") {
  const effects = instructions.filter((entry) => ["damage", "healing"].includes(entry.kind) && entry.formula);
  const rankOrLevel = adapterId === "pf2e" ? "Rank" : "Spell Level";
  const baseByKey = new Map(baseInstructions.map((entry) => [previewInstructionKey(entry), entry]));
  const selectedLevel = Number(castLevel ?? 0);
  const originalLevel = Number(baseCastLevel ?? 0);
  const isUpcast = selectedLevel > originalLevel;
  const levelDisplay = selectedLevel > 0 ? selectedLevel : "Cantrip";
  const rows = effects.map((entry) => {
    const base = baseByKey.get(previewInstructionKey(entry));
    const increase = formulaIncrease(base?.formula, entry.formula);
    const effect = previewEffectLabel(entry);
    const changeText = increase
      ? `${increase} from ${rankOrLevel} ${selectedLevel}`
      : (isUpcast ? `No additional dice shown at ${rankOrLevel} ${selectedLevel}` : "Base spell effect");
    return `
      <div class="pp-upcast-effect">
        <span>${entry.kind === "healing" ? "Healing effect" : "Damage on hit"}</span>
        <strong>${escapeHtml(entry.formula)} <em>${escapeHtml(effect.toLowerCase())}</em></strong>
        <small class="${increase ? "increased" : ""}">${escapeHtml(changeText)}</small>
      </div>
    `;
  }).join("");
  return `
    <div class="pp-upcast-preview-heading">
      <i class="fas fa-arrow-trend-up"></i>
      <div>
        <strong>Upcast Preview</strong>
        <span>Preview only - required attack, save, damage, or healing steps come after you continue.</span>
      </div>
    </div>
    <div class="pp-cast-preview-title">Spell effect at ${selectedLevel > 0 ? `${rankOrLevel} ${escapeHtml(levelDisplay)}` : escapeHtml(levelDisplay)}</div>
    ${rows || `<p>This spell can use the selected ${adapterId === "pf2e" ? "rank" : "slot level"}, but its listed damage or healing does not change.</p>`}
  `;
}

export function targetInstructionText(targetInfo = {}) {
  const count = Number(targetInfo.count ?? 0);
  if (Number.isFinite(count) && count > 1) return `Choose up to ${count} targets.`;
  if (Number.isFinite(count) && count === 1) return "Choose one target.";
  if (targetInfo.limitReason) return `Choose targets for this action. ${targetInfo.limitReason} Verify the final limit after choosing the cast level.`;
  return "Choose targets for this action.";
}

function targetCountText(selected, targetInfo = {}) {
  const count = Number(targetInfo.count ?? 0);
  if (Number.isFinite(count) && count > 0) return `${selected} / ${count} selected`;
  return `${selected} selected`;
}

export function updateModalTargetCount(selected, targetInfo = {}) {
  const count = state.modal?.querySelector("[data-modal-target-count]");
  if (count) count.textContent = targetCountText(selected, targetInfo);
}

export function renderModalTargetPicker(item, actionAttribute = "data-modal-action") {
  if (!item?.targetInfo?.needsTarget && !item?.targetInfo?.canTarget) return "";
  const scene = state.scene;
  const tokens = displayedTargetTokens(scene).filter((token) => item.targetInfo.allowSelf || token.actorId !== state.actorId);
  if (!tokens.length) return `<div class="pp-empty">No available targets. If no GM is connected, Player Pilot can only use the locally available scene data.</div>`;
  const selected = selectedTargetSet(scene?.id ?? "");
  return `
    <div class="pp-modal-targets">
      <div class="pp-subtitle pp-group-title"><i class="fas fa-crosshairs"></i><span>Targets</span><em data-modal-target-count>${escapeHtml(targetCountText(selected.size, item.targetInfo))}</em></div>
      <div class="pp-target-list">
        ${tokens.slice(0, 10).map((token) => renderModalTargetRow(token, selected, item, actionAttribute)).join("")}
      </div>
    </div>
  `;
}

function renderModalTargetRow(token, selected, item, actionAttribute = "data-modal-action") {
  const isSelected = selected.has(token.id);
  const range = targetRangeLabel(token, item);
  const disabled = range?.out === true;
  return `
    <article class="pp-token-row ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}">
      <div class="pp-card-img" style="background-image:url('${escapeHtml(token.img)}')"></div>
      <div class="pp-card-main">
        <div class="pp-card-title"><span>${escapeHtml(token.name)}</span></div>
        <div class="pp-card-meta">
          ${range ? `<span class="pp-badge ${range.out ? "danger" : "good"}">${escapeHtml(range.text)}</span>` : ""}
          ${renderTargetStateBadges(token)}
        </div>
      </div>
      <button class="pp-action-btn ${isSelected ? "primary" : ""}" type="button" ${actionAttribute}="modalToggleTarget" data-token-id="${escapeHtml(token.id)}" data-disabled="${disabled ? "true" : "false"}" ${disabled ? "disabled" : ""}>${disabled ? "Out of Range" : (isSelected ? "Targeted" : "Target")}</button>
    </article>
  `;
}

function targetRangeLabel(targetToken, item) {
  const rangeFeet = Number(item?.rangeFeet ?? 0);
  if (!Number.isFinite(rangeFeet) || rangeFeet <= 0) return null;
  const source = activeTokenForActor();
  if (!source || !targetToken) return null;
  const distance = tokenDistanceFeet(source, targetToken);
  if (!Number.isFinite(distance)) return null;
  const gridStep = Number(state.scene?.gridDistance ?? 5) || 5;
  const rounded = Math.max(0, Math.floor((distance + 1e-6) / gridStep) * gridStep);
  return {
    out: rounded > rangeFeet,
    text: rounded > rangeFeet ? `${rounded} ft, out of ${rangeFeet}` : `${rounded} ft, in range`
  };
}

function tokenDistanceFeet(a, b) {
  const scene = state.scene ?? buildLocalSceneState();
  const gridSize = Number(scene?.gridSize ?? 100) || 100;
  const gridDistance = Number(scene?.gridDistance ?? 5) || 5;
  const ax = Number(a.x ?? 0) + (Number(a.width ?? 1) * gridSize / 2);
  const ay = Number(a.y ?? 0) + (Number(a.height ?? 1) * gridSize / 2);
  const bx = Number(b.x ?? 0) + (Number(b.width ?? 1) * gridSize / 2);
  const by = Number(b.y ?? 0) + (Number(b.height ?? 1) * gridSize / 2);
  return (Math.hypot(ax - bx, ay - by) / gridSize) * gridDistance;
}

export function attackRollMode(actor, activity) {
  const data = game.playerPilot.model.activitySystem(activity);
  const mode = Number(data?.attack?.roll?.mode ?? data?.roll?.mode ?? 0);
  const all = new Set(actorConditionKeys(actor));
  const selectedIds = selectedTargetSet(state.scene?.id ?? "");
  const target = (state.scene?.tokens ?? []).find((token) => selectedIds.has(String(token.id)));
  const targetConditions = new Set((target?.statuses ?? []).map((value) => String(value).toLowerCase()));
  const hasCondition = (set, key) => Array.from(set).some((value) => value.includes(key));
  const disadvantageReasons = [
    ["blinded", "Blinded"],
    ["poisoned", "Poisoned"],
    ["exhaustion-3", "Exhaustion"],
    ["prone", "Prone"],
    ["restrained", "Restrained"]
  ].filter(([key]) => hasCondition(all, key)).map(([, label]) => label);
  const advantageReasons = [
    ["invisible", "Invisible"]
  ].filter(([key]) => hasCondition(all, key)).map(([, label]) => label);

  [
    ["blinded", "Target Blinded"],
    ["paralyzed", "Target Paralyzed"],
    ["restrained", "Target Restrained"],
    ["stunned", "Target Stunned"],
    ["unconscious", "Target Unconscious"]
  ].filter(([key]) => hasCondition(targetConditions, key)).forEach(([, label]) => advantageReasons.push(label));
  if (hasCondition(targetConditions, "invisible")) disadvantageReasons.push("Target Invisible");
  if (hasCondition(targetConditions, "dodging") || hasCondition(targetConditions, "dodge")) disadvantageReasons.push("Target Dodging");

  if (hasCondition(targetConditions, "prone")) {
    const source = activeTokenForActor(actor?.id);
    const distance = source && target ? tokenDistanceFeet(source, target) : NaN;
    const attackType = fieldText(
      data?.attack?.type?.value,
      data?.attack?.type,
      data?.actionType,
      activity?.item?.system?.actionType
    ).toLowerCase();
    const melee = attackType.includes("melee") || ["mwak", "msak"].includes(attackType);
    if (melee && Number.isFinite(distance) && distance <= (Number(state.scene?.gridDistance ?? 5) || 5) + 0.01) {
      advantageReasons.push("Nearby Prone Target");
    } else {
      disadvantageReasons.push("Prone Target at Range");
    }
  }

  if (mode > 0) advantageReasons.unshift("Activity Rule");
  if (mode < 0) disadvantageReasons.unshift("Activity Rule");
  const hasAdvantage = advantageReasons.length > 0;
  const hasDisadvantage = disadvantageReasons.length > 0;
  const effective = hasAdvantage && !hasDisadvantage ? 1 : (hasDisadvantage && !hasAdvantage ? -1 : 0);
  const canceled = hasAdvantage && hasDisadvantage;
  return {
    rollMode: effective > 0 ? "advantage" : (effective < 0 ? "disadvantage" : (canceled ? "normal" : "")),
    rollModeReason: effective > 0
      ? advantageReasons.join(", ")
      : (effective < 0 ? disadvantageReasons.join(", ") : (canceled ? "Advantage and disadvantage cancel" : ""))
  };
}

function openRollChoiceDialog(data = {}) {
  const name = String(data.name ?? "Roll");
  const formula = String(data.formula ?? "d20");
  const canAuto = !!(data.kind && data.key);
  openModal(`
    <h2>${escapeHtml(name)}</h2>
    <div class="pp-roll-choice-hero">
      ${renderDieGlyph(20)}
      <strong>${escapeHtml(describeFormula(formula))}</strong>
      <span>${escapeHtml(formula)}</span>
    </div>
    <div class="pp-roll-choice-grid">
      ${canAuto ? `<button class="pp-button primary" type="button" data-modal-action="autoRoll">Auto roll</button>` : ""}
    </div>
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
    </div>
  `, {
    autoRoll: async () => {
      closeModal();
      await rollCheck(data.kind ?? "", data.key ?? "");
    }
  });
}

export function renderRollInstructions(instructions = [], allowManual = true, actionAttribute = "data-modal-action") {
  if (!instructions.length) return "";
  return `
    <div class="pp-roll-instructions">
      ${instructions.map((entry) => `
        <article class="pp-roll-instruction pp-roll-choice-hero pp-roll-kind-${escapeHtml(String(entry.kind ?? "roll").toLowerCase())}">
          <img class="pp-instruction-icon" src="${escapeHtml(rollInstructionIcon(entry))}" alt="">
          <div class="pp-roll-instruction-copy">
            <strong>${escapeHtml(entry.label)}</strong>
            ${entry.rollMode ? `<div class="pp-roll-mode ${escapeHtml(entry.rollMode)}"><i class="fas ${entry.rollMode === "advantage" ? "fa-arrow-trend-up" : (entry.rollMode === "disadvantage" ? "fa-arrow-trend-down" : "fa-scale-balanced")}"></i>${escapeHtml(capitalizeWords(entry.rollMode))}${entry.rollModeReason ? ` - ${escapeHtml(entry.rollModeReason)}` : ""}</div>` : ""}
            <span class="pp-roll-formula-text">${escapeHtml(entry.formula || entry.detail)}</span>
            ${entry.formula ? renderDiceFormulaIcons(entry.formula) : ""}
            ${entry.formula && entry.detail ? `<em>${escapeHtml(entry.detail)}</em>` : ""}
          </div>
          ${entry.nativeAction ? `
            <div class="pp-roll-instruction-actions ${Array.isArray(entry.nativeChoices) && entry.nativeChoices.length ? "pp-native-choice-actions" : ""}">
              ${Array.isArray(entry.nativeChoices) && entry.nativeChoices.length
        ? entry.nativeChoices.map((choice) => `
                  <button class="pp-button ${choice.primary === true || Number(choice.attackNumber ?? 0) === 1 ? "primary" : ""}" type="button" ${actionAttribute}="${escapeHtml(choice.modalAction ?? entry.modalAction ?? "nativeInstruction")}" data-native-action="${escapeHtml(choice.nativeAction ?? entry.nativeAction)}" data-operation="${escapeHtml(choice.operation ?? entry.operation ?? "")}" data-cast-rank="${escapeHtml(entry.castRank ?? "")}" data-attack-number="${escapeHtml(choice.attackNumber ?? "")}" data-variant-index="${escapeHtml(choice.variantIndex ?? entry.variantIndex ?? "")}" title="${escapeHtml(choice.formula ?? choice.label)}">${escapeHtml(choice.buttonLabel ?? choice.label)}</button>
                `).join("")
        : `<button class="pp-button primary" type="button" ${actionAttribute}="${escapeHtml(entry.modalAction ?? "nativeInstruction")}" data-native-action="${escapeHtml(entry.nativeAction)}" data-operation="${escapeHtml(entry.operation ?? "")}" data-cast-rank="${escapeHtml(entry.castRank ?? "")}" data-attack-number="${escapeHtml(entry.attackNumber ?? "")}" data-variant-index="${escapeHtml(entry.variantIndex ?? "")}">${escapeHtml(entry.buttonLabel ?? `Roll ${entry.kind === "damage" ? "Damage" : entry.kind === "healing" ? "Healing" : ""}`)}</button>`}
            </div>
          ` : (allowManual && entry.formula ? `
            <div class="pp-roll-instruction-actions">
              <button class="pp-button primary" type="button" ${actionAttribute}="autoInstruction" data-name="${escapeHtml(entry.label)}" data-formula="${escapeHtml(entry.formula)}">Auto</button>
            </div>
          ` : "")}
        </article>
      `).join("")}
    </div>
  `;
}

function renderDiceFormulaIcons(formula) {
  const dice = Array.from(String(formula ?? "").matchAll(/(\d*)d(4|6|8|10|12|20)/gi));
  if (!dice.length) return "";
  const modifier = formulaFlatModifier(formula);
  return `
    <div class="pp-formula-dice" aria-label="${escapeHtml(formula)}">
      ${dice.map((match) => {
    const count = Math.min(12, Math.max(1, Number(match[1] || 1)));
    const sides = match[2];
    return `<span>${Array.from({ length: count }).map(() => renderDieGlyph(sides)).join("")}</span>`;
  }).join("")}
      ${modifier ? `<strong class="pp-formula-modifier">${escapeHtml(signedMod(modifier))}</strong>` : ""}
    </div>
  `;
}

function formulaFlatModifier(formula = "") {
  let total = 0;
  for (const match of String(formula).matchAll(/([+-])\s*(\d+(?:\.\d+)?)(?!\s*[dD*\/])/g)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    total += match[1] === "-" ? -value : value;
  }
  return total;
}

function rollInstructionIcon(entry = {}) {
  const kind = String(entry.kind ?? "").toLowerCase();
  const label = String(entry.label ?? "").toLowerCase();
  if (kind === "attack") return `${CORE_ICON_ROOT}/sword.svg`;
  if (kind === "save") return `${CORE_ICON_ROOT}/shield.svg`;
  if (kind === "healing") return `${CORE_ICON_ROOT}/heal.svg`;
  if (kind === "damage") {
    const coreDamageIcons = {
      acid: "acid.svg",
      bludgeoning: "thrust.svg",
      cold: "frozen.svg",
      fire: "fire.svg",
      force: "explosion.svg",
      lightning: "lightning.svg",
      necrotic: "degen.svg",
      piercing: "thrust.svg",
      poison: "poison.svg",
      psychic: "daze.svg",
      radiant: "sun.svg",
      slashing: "sword.svg",
      thunder: "sound.svg"
    };
    const type = Object.keys(coreDamageIcons).find((candidate) => label.includes(candidate));
    return `${CORE_ICON_ROOT}/${coreDamageIcons[type] ?? "explosion.svg"}`;
  }
  return `${CORE_ICON_ROOT}/dice-target.svg`;
}

async function autoRollInstruction(item, data = {}) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  const formula = String(data.formula ?? "").trim();
  if (!actor || !formula) return;
  const payload = {
    actorId: actor.id,
    itemId: item?.id ?? "",
    formula,
    label: String(data.name ?? "Roll")
  };
  if (activeGmIds().length && sendSocket("formulaRoll", payload)) {
    showResultToast(`${payload.label} sent`, formula);
    return;
  }
  await rollFormulaForActor(actor, payload);
}

async function rollFormulaForActor(actor, data = {}) {
  const formula = String(data.formula ?? "").trim();
  if (!formula) return;
  const roll = new Roll(formula, actor?.getRollData?.() ?? {});
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: String(data.label ?? "Roll")
  });
}

function openRollReminderDialog(item, actor, options = {}) {
  const instructions = game.playerPilot.model.collectRollInstructions(item, options);
  if (!instructions.length) return;
  openModal(`
    <h2>${escapeHtml(itemDisplayName(item))}</h2>
    <p>Use this as the table prompt for what gets rolled next.</p>
    ${renderRollInstructions(instructions, true)}
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Done</button>
    </div>
  `, {
    manualInstruction: async (_modal, button) => {
      openManualRollDialog(button.dataset);
    },
    autoInstruction: async (_modal, button) => {
      await autoRollInstruction(item, button.dataset);
    },
    nativeInstruction: async (_modal, button) => {
      await runNativeItemRoll(item, button.dataset.nativeAction ?? "", button.dataset.castRank, button.dataset.attackNumber);
    }
  });
}

export async function executePlayerFirst(actionLabel, localFn, socketType, payload) {
  if (pilotPaused()) {
    warnPaused();
    return false;
  }
  if (setting("combatTurnLock", false) === true && ["useItem", "rollCheck", "rest", "moveToken", "prepareSpell", "pf2eStrike", "pf2eItemRoll"].includes(socketType)) {
    const actor = currentActor();
    if (actor && !actorHasActiveTurn(actor)) {
      ui.notifications?.warn?.("It is not this actor's turn.");
      addLog("Turn locked");
      return false;
    }
  }
  const authority = String(setting("movementAuthority", "playerFirst"));
  const forceGm = authority === "gm";
  if (!forceGm) {
    try {
      await localFn();
      addLog(actionLabel);
      return true;
    } catch (err) {
      console.warn(`Player Pilot local ${actionLabel} failed; falling back to GM.`, err);
    }
  }
  if (sendSocket(socketType, payload)) {
    addLog(`${actionLabel} sent`);
    return true;
  }
  ui.notifications?.warn?.("No GM is connected and the local action could not run.");
  return false;
}

export function actorHasActiveTurn(actor) {
  const combatant = game.combat?.combatant;
  if (!combatant) return true;
  const combatActorId = String(combatant.actor?.id ?? combatant.actorId ?? "");
  if (combatActorId && combatActorId === String(actor.id)) return true;
  const activeTokenId = String(combatant.token?.id ?? combatant.tokenId ?? "");
  if (!activeTokenId) return false;
  return getActorTokenCandidates(actor.id).some((token) => token.id === activeTokenId);
}

async function runNativeItemRoll(item, action, castRank = "", attackNumber = "") {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  if (!actor || !item || game.playerPilot.model.id !== "pf2e") return;
  const targetIds = Array.from(selectedTargetSet(state.scene?.id ?? ""));
  const requestedRank = Number(castRank);
  const requestedAttack = Number(attackNumber);
  const payload = {
    actorId: actor.id,
    itemId: item.id,
    nativeAction: String(action ?? ""),
    castRank: Number.isFinite(requestedRank) && requestedRank > 0 ? requestedRank : game.playerPilot.model.pf2eSpellRank(item),
    attackNumber: Number.isFinite(requestedAttack) && requestedAttack > 0 ? requestedAttack : 1,
    sceneId: state.scene?.id ?? "",
    targetIds
  };
  if (activeGmIds().length && sendSocket("pf2eItemRoll", payload)) {
    showResultToast(`${itemDisplayName(item)} roll sent`);
    return;
  }
  await executePlayerFirst(
    `PF2e ${payload.nativeAction}`,
    async () => game.playerPilot.model.nativeItemRoll(actor, item, payload.nativeAction, payload),
    "pf2eItemRoll",
    payload
  );
}

async function useItem(itemId, options = {}, uiOptions = {}) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  const item = findItem(itemId);
  if (!actor || !item) return;
  const canUseItem = game.playerPilot.model.canUseItem(item);
  if (!canUseItem) {
    const message = game.playerPilot.model.id === "pf2e" && item.type === "spell"
      ? "That spell has no available slot, use, or Focus Point."
      : (item.type === "spell" ? "That spell is not prepared." : "Equip that item before using it.");
    ui.notifications?.warn?.(message);
    return;
  }
  const targetIds = Array.from(selectedTargetSet(state.scene?.id ?? ""));
  if (activeGmIds().length) {
    sendSocket("useItem", {
      actorId: actor.id,
      itemId,
      options,
      sceneId: state.scene?.id ?? "",
      targetIds
    });
    showResultToast(`${itemDisplayName(item)} sent`, targetIds.length ? `${targetIds.length} target${targetIds.length === 1 ? "" : "s"}` : "");
    if (uiOptions.showReminder !== false) openRollReminderDialog(item, actor, options);
    return;
  }
  await executePlayerFirst(
    `Use ${item.name}`,
    async () => game.playerPilot.model.useItem(actor, item, options),
    "useItem",
    {
      actorId: actor.id,
      itemId,
      options,
      sceneId: state.scene?.id ?? "",
      targetIds
    }
  );
  if (uiOptions.showReminder !== false) openRollReminderDialog(item, actor, options);
}

export async function rollCheck(kind, key) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  if (!actor) return;
  let rollResult = null;
  const executed = await executePlayerFirst(
    `Roll ${kind}`,
    async () => {
      rollResult = await game.playerPilot.model.rollCheck(kind, key);
      return rollResult;
    },
    "rollCheck",
    { actorId: actor.id, kind, key }
  );
  if (executed && rollResult) showNativeRollResult(rollResult, kind, key);
}

function showNativeRollResult(result, kind = "roll", key = "") {
  const candidates = Array.isArray(result)
    ? result
    : (Array.isArray(result?.rolls) ? result.rolls : [result?.roll ?? result]);
  const roll = candidates.find((entry) => Number.isFinite(Number(entry?.total)));
  if (!roll) return;
  const actor = currentActor();
  const check = cachedModel(actor)?.groups?.checks?.find((entry) => entry.kind === kind && entry.key === key);
  const label = check?.name ?? capitalizeWords(`${key || kind} ${kind === "skill" ? "check" : ""}`.trim());
  const formula = String(roll.formula ?? roll._formula ?? "");
  showResultToast(`${label}: ${Number(roll.total)}`, formula);
}

function parseD20Mod(formula) {
  const match = String(formula ?? "").match(/d20\s*([+-]\s*\d+)?/i);
  if (!match?.[1]) return 0;
  return Number(match[1].replace(/\s+/g, "")) || 0;
}

function openManualRollDialog(data = {}) {
  const name = String(data.name ?? "Roll");
  const formula = String(data.formula ?? "d20");
  const mod = parseD20Mod(formula);
  const isD20 = /\bd20\b/i.test(formula);
  const totalMode = String(data.mode ?? "").toLowerCase() === "total";
  openModal(`
    <h2>${escapeHtml(name)}</h2>
    <div class="pp-roll-choice-hero">
      ${renderDieGlyph(20)}
      <strong>${escapeHtml(totalMode ? "Enter the final total." : describeFormula(formula))}</strong>
      <span>${escapeHtml(formula)}</span>
    </div>
    <label>${totalMode || !isD20 ? "Final Total" : "D20 Result"}</label>
    <input class="pp-search" type="number" ${!totalMode && isD20 ? "min=\"1\" max=\"20\"" : ""} name="manualD20" inputmode="numeric" placeholder="${totalMode || !isD20 ? "Total" : "1-20"}">
    <div class="pp-dialog-actions">
      <button class="pp-button" type="button" data-modal-action="close">Cancel</button>
      <button class="pp-button primary" type="button" data-modal-action="submitManual">Total</button>
    </div>
  `, {
    submitManual: async (modal) => {
      const raw = Number(modal.querySelector("[name='manualD20']")?.value ?? NaN);
      if (!Number.isFinite(raw) || (!totalMode && isD20 && (raw < 1 || raw > 20))) {
        ui.notifications?.warn?.(!totalMode && isD20 ? "Enter a d20 result from 1 to 20." : "Enter the roll total.");
        return;
      }
      const total = (!totalMode && isD20) ? raw + mod : raw;
      closeModal();
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: currentActor() }),
        content: `<p><strong>${escapeHtml(name)}</strong>: <strong>${escapeHtml(total)}</strong>${(!totalMode && isD20) ? ` <span>(${escapeHtml(raw)} ${escapeHtml(signedMod(mod))})</span>` : ""}</p>`
      });
      showResultToast(`${name}: ${total}`, (!totalMode && isD20) ? `${raw} ${signedMod(mod)}` : formula);
    }
  });
  window.setTimeout(() => state.modal?.querySelector("[name='manualD20']")?.focus?.(), 20);
}

export function showResultToast(title, detail = "") {
  if (state.modal) return;
  const existing = document.querySelector(".pp-result-toast");
  existing?.remove();
  const toast = document.createElement("div");
  toast.className = "pp-result-toast";
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}`;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

async function updateItemQuantity(itemId, delta) {
  const actor = currentActor();
  const item = findItem(itemId);
  if (!actor || !item || !Number.isFinite(delta) || delta === 0) return;
  const current = Number(item.system?.quantity ?? 0);
  const next = Math.max(0, current + delta);
  await executePlayerFirst(
    `Qty ${next}`,
    async () => item.update({ "system.quantity": next }),
    "updateItemData",
    { actorId: actor.id, itemId, updates: { "system.quantity": next }, label: `Qty ${next}` }
  );
}

async function updatePf2eResource(resource, delta) {
  const actor = currentActor();
  if (!actor || game.playerPilot.model.id !== "pf2e" || !Number.isFinite(delta) || delta === 0) return;
  const key = resource === "focus" ? "focus" : "heroPoints";
  const data = actor.system?.resources?.[key] ?? {};
  const current = Number(data.value ?? 0);
  const max = Number(data.max ?? (key === "heroPoints" ? 3 : current));
  const next = clamp(current + delta, 0, Number.isFinite(max) ? max : current + Math.max(delta, 0));
  const updates = { [`system.resources.${key}.value`]: next };
  const label = key === "focus" ? "Focus Points" : "Hero Points";
  await executePlayerFirst(
    `${label} ${next}`,
    async () => actor.update(updates),
    "updateActorData",
    { actorId: actor.id, updates, label: `${label} ${next}` }
  );
  window.setTimeout(queueRender, 50);
}

async function updateDeathSaves(kind) {
  const actor = currentActor();
  if (!actor) return;
  const death = actor.system?.attributes?.death ?? {};
  let success = Number(death.success ?? 0);
  let failure = Number(death.failure ?? 0);
  if (kind === "success") success = clamp(success + 1, 0, 3);
  else if (kind === "failure") failure = clamp(failure + 1, 0, 3);
  else {
    success = 0;
    failure = 0;
  }
  const updated = await executePlayerFirst(
    "Death saves",
    async () => actor.update({ "system.attributes.death.success": success, "system.attributes.death.failure": failure }),
    "updateActorData",
    {
      actorId: actor.id,
      updates: { "system.attributes.death.success": success, "system.attributes.death.failure": failure },
      label: "Death saves"
    }
  );
  if (updated) {
    invalidateModelCache();
    queueRender();
  }
}

function toggleTarget(tokenId) {
  const sceneId = state.scene?.id ?? "";
  const selected = selectedTargetSet(sceneId);
  if (selected.has(tokenId)) selected.delete(tokenId);
  else selected.add(tokenId);
  setSelectedTargetSet(sceneId, selected);
  queueRender();
}

function targetIdsForCurrentUser() {
  return asArray(game.user?.targets).map((token) => String(token.id ?? token.document?.id ?? "")).filter(Boolean);
}

export function applyTargetsForCurrentUser(targetIds = [], sceneId = "") {
  const ids = Array.from(new Set((targetIds ?? []).map(String).filter(Boolean)));
  let applied = false;
  try {
    if (canvas?.ready && typeof game.user?.updateTokenTargets === "function") {
      game.user.updateTokenTargets(ids);
      applied = true;
    }
  } catch (_err) {
    // best effort below
  }
  try {
    if (canvas?.ready && canvas.tokens?.placeables) {
      const selected = new Set(ids);
      for (const token of canvas.tokens.placeables) {
        token.setTarget?.(selected.has(token.id), {
          releaseOthers: false
        });
      }
      applied = true;
    }
  } catch (_err) {
    // best effort
  }
  try {
    const sid = String(sceneId || canvas?.scene?.id || game.scenes?.viewed?.id || "").trim();
    game.user?.broadcastActivity?.({
      targets: ids,
      scene: sid || undefined,
      sceneId: sid || undefined
    });
  } catch (_err) {
    // best effort
  }
  return applied;
}

async function applyTargets() {
  const sceneId = state.scene?.id ?? "";
  const targetIds = Array.from(selectedTargetSet(sceneId));
  const applied = applyTargetsForCurrentUser(targetIds, sceneId);
  sendSocket("targetUpdate", { actorId: state.actorId, sceneId, targetIds });
  addLog(applied ? `Player targets ${targetIds.length}` : `Targets saved ${targetIds.length}`);
}

async function pingSelectedTargets() {
  const scene = state.scene;
  const selected = Array.from(selectedTargetSet(scene?.id ?? ""));
  for (const tokenId of selected) {
    const token = scene?.tokens?.find?.((entry) => entry.id === tokenId);
    if (token) sendSocket("pingPoint", pointPayloadForToken(token));
  }
  addLog(`Ping ${selected.length} target${selected.length === 1 ? "" : "s"}`);
}

function pointPayloadForToken(token) {
  const grid = Number(state.scene?.gridSize ?? 100);
  return {
    sceneId: state.scene?.id ?? "",
    x: Number(token.x ?? 0) + (Number(token.width ?? 1) * grid / 2),
    y: Number(token.y ?? 0) + (Number(token.height ?? 1) * grid / 2),
    label: token.name ?? "Ping"
  };
}

async function pingActiveToken() {
  const token = activeTokenForActor();
  if (!token) return;
  sendSocket("pingPoint", pointPayloadForToken(token));
  addLog("Ping token");
}

function requestSceneState(force = false) {
  const now = Date.now();
  if (force) state.suppressSceneRenderUntil = 0;
  if (!force && now - state.lastSceneRequestAt < 10000) return;
  state.lastSceneRequestAt = now;
  if (!activeGmIds().length) {
    state.scene = buildLocalSceneState(game.user?.id);
    queueRender();
    return;
  }
  if (!sendSocket("requestSceneState", {})) {
    state.scene = buildLocalSceneState(game.user?.id);
    queueRender();
  }
}

function sceneStateFingerprint(scene) {
  if (!scene) return "";
  const tokens = (scene.tokens ?? [])
    .map((token) => `${token.id}:${token.actorId}:${Math.round(Number(token.x ?? 0))},${Math.round(Number(token.y ?? 0))}:${token.disposition}:${token.owned ? 1 : 0}:${token.playerOwned ? 1 : 0}:${(token.statuses ?? []).join(",")}:${(token.effects ?? []).map((effect) => `${effect.id ?? ""}:${effect.img ?? ""}`).join(",")}`)
    .join("|");
  return [
    scene.id ?? "",
    scene.mapControlsEnabled ? 1 : 0,
    (scene.combatTokenIds ?? []).join(","),
    (scene.manualTargetIds ?? []).join(","),
    tokens
  ].join(";");
}

const tokenMovementQueues = new Map();

function queueTokenMovement(data, options = {}) {
  const key = `${String(data?.sceneId ?? "")}.${String(data?.tokenId ?? data?.actorId ?? "")}`;
  const prior = tokenMovementQueues.get(key) ?? Promise.resolve();
  const queued = prior
    .catch(() => undefined)
    .then(() => moveTokenDocument(data, options));
  tokenMovementQueues.set(key, queued);
  queued.finally(() => {
    if (tokenMovementQueues.get(key) === queued) tokenMovementQueues.delete(key);
  }).catch(() => undefined);
  return queued;
}

async function moveActiveToken(dir) {
  if (pilotPaused()) {
    warnPaused();
    return;
  }
  const actor = currentActor();
  const token = activeTokenForActor(actor?.id);
  if (!actor) {
    ui.notifications?.warn?.("No owned actor found for this user.");
    return;
  }
  if (!token && canvas?.ready) {
    ui.notifications?.warn?.("No owned token found in the current scene.");
    return;
  }
  const sceneId = state.scene?.id ?? "";
  const movementDir = orientedMovementDirection(dir);
  const payload = {
    actorId: actor.id,
    tokenId: token?.id ?? state.selectedTokenId ?? "",
    sceneId,
    dir: movementDir,
    controlDir: dir
  };
  const authority = String(setting("movementAuthority", "playerFirst"));
  if (authority === "playerFirst" && canvas?.ready) {
    try {
      const result = await queueTokenMovement(payload, { showRuler: true });
      updatePlayerMovementStatus({ ...result, sceneId, tokenId: token.id }, dir);
      state.lastMoveDir = dir;
      addLog(state.lastMoveLabel);
      sendSocket("movementTrace", {
        actorId: actor.id,
        tokenId: token.id,
        sceneId,
        previous: result.previous,
        target: result.target
      });
      const localToken = state.scene?.tokens?.find?.((entry) => String(entry.id) === String(token.id));
      if (localToken && result.target) {
        localToken.x = Number(result.target.x ?? localToken.x);
        localToken.y = Number(result.target.y ?? localToken.y);
        state.sceneFingerprint = sceneStateFingerprint(state.scene);
      }
      queueRender();
      return;
    } catch (err) {
      console.warn("Player Pilot local movement failed; asking GM.", err);
    }
  }
  if (!sendSocket("moveToken", payload)) {
    ui.notifications?.warn?.("No GM is connected to move the token.");
    return;
  }
  state.lastMoveDir = dir;
  state.lastMoveLabel = "Move sent";
  addLog(`Move ${dir} sent`);
  queueRender();
}

async function moveTokenDocument({ tokenId, sceneId, dir }, options = {}) {
  const scene = getSceneDoc(sceneId);
  const tokenDoc = scene?.tokens?.get?.(tokenId) ?? asArray(scene?.tokens).find((td) => td.id === tokenId);
  if (!tokenDoc) throw new Error("Token not found.");
  if (!canvas?.ready) throw new Error("Canvas movement is required so walls and terrain can be enforced.");
  const grid = Number(canvas?.grid?.size ?? state.scene?.gridSize ?? scene.grid?.size ?? 100);
  const directions = new Set(String(dir ?? "").toLowerCase().split(/[-_\s]+/).filter(Boolean));
  const dx = (directions.has("left") ? -1 : directions.has("right") ? 1 : 0) * grid;
  const dy = (directions.has("up") ? -1 : directions.has("down") ? 1 : 0) * grid;
  const maxW = Number(canvas?.dimensions?.width ?? state.scene?.width ?? Infinity);
  const maxH = Number(canvas?.dimensions?.height ?? state.scene?.height ?? Infinity);
  const width = Number(tokenDoc.width ?? 1) * grid;
  const height = Number(tokenDoc.height ?? 1) * grid;
  const target = {
    x: clamp(Math.round((Number(tokenDoc.x ?? 0) + dx) / grid) * grid, 0, Math.max(0, maxW - width)),
    y: clamp(Math.round((Number(tokenDoc.y ?? 0) + dy) / grid) * grid, 0, Math.max(0, maxH - height))
  };
  const previous = { x: Number(tokenDoc.x ?? 0), y: Number(tokenDoc.y ?? 0) };
  if (target.x === previous.x && target.y === previous.y) {
    return { moved: false, distanceFeet: 0, units: String(scene?.grid?.units ?? state.scene?.gridUnits ?? "ft"), previous, target };
  }
  let moveResult = null;
  if (typeof tokenDoc.move === "function") {
    moveResult = await tokenDoc.move(target, { showRuler: options.showRuler === true });
  } else {
    throw new Error("Constrained token movement is unavailable.");
  }
  const actual = await resolveMovedTokenPosition(tokenDoc, previous, target, moveResult, grid);
  if (actual.x === previous.x && actual.y === previous.y) {
    return { moved: false, distanceFeet: 0, units: String(scene?.grid?.units ?? state.scene?.gridUnits ?? "ft"), previous, target: actual };
  }
  const distanceFeet = movementDistanceFeet(tokenDoc, previous, actual, scene, grid);
  return {
    moved: true,
    distanceFeet,
    units: String(scene?.grid?.units ?? state.scene?.gridUnits ?? "ft"),
    previous,
    target: actual
  };
}

function tokenPositionFromDocument(tokenDoc) {
  const liveDoc = tokenDoc?.parent?.tokens?.get?.(tokenDoc.id) ?? tokenDoc;
  const x = Number(liveDoc?.x);
  const y = Number(liveDoc?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function tokenPositionFromMoveResult(moveResult) {
  const candidates = [
    moveResult?.document,
    moveResult?.token,
    moveResult
  ];
  for (const candidate of candidates) {
    const x = Number(candidate?.x);
    const y = Number(candidate?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

async function resolveMovedTokenPosition(tokenDoc, previous, target, moveResult, grid = 100) {
  const tolerance = Math.max(0.5, Number(grid ?? 100) * 0.005);
  const samePosition = (a, b) => (
    a && b
    && Math.abs(Number(a.x) - Number(b.x)) <= tolerance
    && Math.abs(Number(a.y) - Number(b.y)) <= tolerance
  );
  const changed = (point) => point && !samePosition(point, previous);
  const normalize = (point) => {
    if (!point) return null;
    if (samePosition(point, target)) return { x: Number(target.x), y: Number(target.y) };
    return { x: Number(point.x), y: Number(point.y) };
  };

  const startedAt = Date.now();
  let last = null;
  let stableSamples = 0;
  while (Date.now() - startedAt < 900) {
    const latest = tokenPositionFromDocument(tokenDoc);
    if (samePosition(latest, target)) return normalize(target);
    if (changed(latest)) {
      stableSamples = samePosition(latest, last) ? stableSamples + 1 : 0;
      last = latest;
      if (stableSamples >= 3) return normalize(latest);
    } else {
      last = latest;
      stableSamples = 0;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  const finalDocumentPosition = tokenPositionFromDocument(tokenDoc);
  if (changed(finalDocumentPosition)) return normalize(finalDocumentPosition);

  // Some Foundry movement implementations return a position without updating the
  // collection immediately. Only trust that result when it reached the snapped
  // target; an arbitrary changed coordinate may be an animation frame.
  const returned = tokenPositionFromMoveResult(moveResult);
  if (samePosition(returned, target)) return normalize(target);
  if (!finalDocumentPosition && changed(returned)) return normalize(returned);
  return { x: Number(previous.x), y: Number(previous.y) };
}

function movementDistanceFeet(tokenDoc, previous, target, scene, grid) {
  const distance = Number(canvas?.scene?.grid?.distance ?? scene?.grid?.distance ?? state.scene?.gridDistance ?? 5) || 5;
  const from = tokenCenterAt(tokenDoc, previous, grid);
  const to = tokenCenterAt(tokenDoc, target, grid);
  const gridSteps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / grid;
  const minimumPlausible = gridSteps * distance * 0.75;
  const measureFunctions = [
    canvas?.grid?.measurePath?.bind?.(canvas.grid),
    canvas?.scene?.grid?.measurePath?.bind?.(canvas.scene.grid),
    scene?.grid?.measurePath?.bind?.(scene.grid)
  ].filter((measure) => typeof measure === "function");
  for (const measure of measureFunctions) {
    try {
      const measured = measure([from, to], { preview: true });
      const measuredDistance = Number(measured?.distance ?? measured);
      if (Number.isFinite(measuredDistance) && measuredDistance > 0 && measuredDistance >= minimumPlausible) {
        return measuredDistance;
      }
    } catch (_err) {
      // Try the next native grid measurement before using geometry.
    }
  }
  return (Math.hypot(to.x - from.x, to.y - from.y) / grid) * distance;
}

function tokenCenterAt(tokenDoc, point, grid) {
  return {
    x: Number(point?.x ?? 0) + (Number(tokenDoc?.width ?? 1) * grid / 2),
    y: Number(point?.y ?? 0) + (Number(tokenDoc?.height ?? 1) * grid / 2)
  };
}

function movementResultLabel(result, _dir = "") {
  if (!result?.moved) return "Move blocked";
  const amount = Math.round(Number(result.distanceFeet ?? 0) * 10) / 10;
  const units = result.units || state.scene?.gridUnits || "ft";
  const total = Number(result.totalDistance ?? result.totalFeet ?? NaN);
  return Number.isFinite(total) && total > amount
    ? `Moved ${amount} ${units}. Total ${Math.round(total * 10) / 10} ${units}.`
    : `Moved ${amount} ${units}`;
}

function updatePlayerMovementStatus(result, dir = "") {
  const now = Date.now();
  const step = Number(result?.distanceFeet ?? 0);
  const sceneId = String(result?.sceneId ?? state.scene?.id ?? "");
  const tokenId = String(result?.tokenId ?? state.selectedTokenId ?? "");
  const sameMovement = sceneId === String(state.movementBurst.sceneId ?? "")
    && tokenId === String(state.movementBurst.tokenId ?? "");
  const withinBurst = sameMovement && now - Number(state.movementBurst.lastAt ?? 0) <= MOVEMENT_BURST_MS;
  const start = {
    x: Number(result?.previous?.x ?? 0),
    y: Number(result?.previous?.y ?? 0)
  };
  const end = {
    x: Number(result?.target?.x ?? start.x),
    y: Number(result?.target?.y ?? start.y)
  };
  const points = (withinBurst && Array.isArray(state.movementBurst.points) && state.movementBurst.points.length)
    ? [...state.movementBurst.points, end]
    : [start, end];
  const deduped = points.filter((point, index, list) => (
    index === 0
    || point.x !== list[index - 1]?.x
    || point.y !== list[index - 1]?.y
  ));
  const suppliedTotal = Number(result?.totalDistance ?? result?.totalFeet ?? NaN);
  const scene = getSceneDoc(sceneId);
  const tokenDoc = scene?.tokens?.get?.(tokenId) ?? asArray(scene?.tokens).find((token) => String(token.id) === tokenId);
  const measuredTotal = tokenDoc ? measureMovementPath(scene, deduped, tokenDoc) : null;
  const total = Number.isFinite(suppliedTotal)
    ? suppliedTotal
    : (measuredTotal
      ?? measureMovementPathFromSceneState(deduped)
      ?? (withinBurst ? Number(state.movementBurst.total ?? 0) + step : step));
  if (state.movementBurst.timer) window.clearTimeout(state.movementBurst.timer);
  state.movementBurst.lastAt = now;
  state.movementBurst.total = total;
  state.movementBurst.sceneId = sceneId;
  state.movementBurst.tokenId = tokenId;
  state.movementBurst.points = deduped;
  state.lastMoveDir = dir;
  state.lastMoveLabel = movementResultLabel({ ...result, totalDistance: total }, dir);
  state.movementBurst.timer = window.setTimeout(() => {
    state.movementBurst.lastAt = 0;
    state.movementBurst.total = 0;
    state.movementBurst.sceneId = "";
    state.movementBurst.tokenId = "";
    state.movementBurst.points = [];
    state.movementBurst.timer = null;
    state.lastMoveLabel = "";
    state.lastMoveDir = "";
    queueRender();
  }, MOVEMENT_DISPLAY_MS);
}

function applyMovementToSceneState(result = {}) {
  const sceneId = String(result?.sceneId ?? "");
  if (sceneId && sceneId !== String(state.scene?.id ?? "")) return;
  const tokenId = String(result?.tokenId ?? "");
  if (!tokenId || !state.scene?.tokens) return;
  const token = state.scene.tokens.find?.((entry) => String(entry.id ?? "") === tokenId);
  if (!token) return;
  const target = result?.target ?? null;
  const x = Number(target?.x);
  const y = Number(target?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  token.x = x;
  token.y = y;
  state.selectedTokenId = tokenId;
  state.sceneFingerprint = sceneStateFingerprint(state.scene);
}

function measureMovementPathFromSceneState(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const gridSize = Number(state.scene?.gridSize ?? 100) || 100;
  const gridDistance = Number(state.scene?.gridDistance ?? 5) || 5;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1];
    const next = points[index];
    const dx = (Number(next?.x ?? 0) - Number(prior?.x ?? 0)) / gridSize;
    const dy = (Number(next?.y ?? 0) - Number(prior?.y ?? 0)) / gridSize;
    total += Math.hypot(dx, dy) * gridDistance;
  }
  return Number.isFinite(total) && total > 0 ? Math.round(total * 10) / 10 : null;
}

function createPixiText(text, style) {
  const preparedStyle = globalThis.PIXI?.TextStyle ? new PIXI.TextStyle(style) : style;
  try {
    return new PIXI.Text(String(text ?? ""), preparedStyle);
  } catch (_err) {
    return new PIXI.Text({ text: String(text ?? ""), style: preparedStyle });
  }
}

function recordGmMovementBurst(data, result) {
  if (!game.user?.isGM || !result?.moved) return null;
  const scene = getSceneDoc(data.sceneId);
  const tokenDoc = scene?.tokens?.get?.(data.tokenId) ?? asArray(scene?.tokens).find((token) => token.id === data.tokenId);
  if (!tokenDoc) return null;
  const key = `${scene?.id ?? data.sceneId}.${tokenDoc.id}`;
  const now = Date.now();
  const prior = gmMovementBursts.get(key);
  const withinBurst = prior && now - Number(prior.lastAt ?? 0) <= MOVEMENT_BURST_MS;
  const start = {
    x: Number(result.previous?.x ?? tokenDoc.x ?? 0),
    y: Number(result.previous?.y ?? tokenDoc.y ?? 0)
  };
  const end = {
    x: Number(result.target?.x ?? tokenDoc.x ?? 0),
    y: Number(result.target?.y ?? tokenDoc.y ?? 0)
  };
  const points = withinBurst ? [...prior.points, end] : [start, end];
  const deduped = points.filter((point, index, list) => index === 0 || point.x !== list[index - 1].x || point.y !== list[index - 1].y);
  const totalDistance = measureMovementPath(scene, deduped, tokenDoc)
    ?? (withinBurst ? Number(prior.totalDistance ?? 0) + Number(result.distanceFeet ?? 0) : Number(result.distanceFeet ?? 0));
  if (prior?.timer) window.clearTimeout(prior.timer);
  const timer = window.setTimeout(() => {
    clearMovementBurstOverlay(tokenDoc.id);
    gmMovementBursts.delete(key);
  }, MOVEMENT_DISPLAY_MS);
  const user = game.users?.get?.(String(data.userId ?? ""));
  const color = user?.color?.css ?? user?.color ?? "#62c7b2";
  const burst = { lastAt: now, points: deduped, totalDistance, timer, color };
  gmMovementBursts.set(key, burst);
  drawMovementBurstOverlay(tokenDoc, deduped, totalDistance, color);
  sendSocket("movementOverlay", {
    sceneId: String(scene?.id ?? data.sceneId ?? ""),
    tokenId: String(tokenDoc.id ?? ""),
    points: deduped,
    totalDistance,
    units: String(scene?.grid?.units ?? state.scene?.gridUnits ?? "ft"),
    color,
    hideAt: now + MOVEMENT_DISPLAY_MS
  });
  return burst;
}

function measureMovementPath(scene, points = [], tokenDoc = null) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const grid = Number(scene?.grid?.size ?? canvas?.grid?.size ?? state.scene?.gridSize ?? 100) || 100;
  const centered = tokenDoc ? points.map((point) => tokenCenterAt(tokenDoc, point, grid)) : points;
  const gridDistance = Number(canvas?.scene?.grid?.distance ?? scene?.grid?.distance ?? state.scene?.gridDistance ?? 5) || 5;
  let minimumPlausible = 0;
  for (let index = 1; index < centered.length; index += 1) {
    const dx = Math.abs(Number(centered[index].x) - Number(centered[index - 1].x));
    const dy = Math.abs(Number(centered[index].y) - Number(centered[index - 1].y));
    minimumPlausible += (Math.max(dx, dy) / grid) * gridDistance * 0.75;
  }
  const measureFunctions = [
    scene?.grid?.measurePath?.bind?.(scene.grid),
    canvas?.grid?.measurePath?.bind?.(canvas.grid)
  ].filter((measure) => typeof measure === "function");
  for (const measure of measureFunctions) {
    try {
      const result = measure(centered, { preview: true });
      const distance = Number(result?.distance ?? result);
      if (Number.isFinite(distance) && distance > 0 && distance >= minimumPlausible) {
        return Math.round(distance * 10) / 10;
      }
    } catch (_err) {
      // Try the next native grid measurement before falling back.
    }
  }
  return null;
}

function movementOverlayColor(color) {
  try {
    if (globalThis.PIXI?.Color) return Number(new PIXI.Color(color || "#62c7b2").toNumber());
  } catch (_err) {
    // Use the module accent below.
  }
  return 0x62c7b2;
}

function clearMovementBurstOverlay(tokenId) {
  const parent = canvas?.controls ?? canvas?.tokens ?? canvas?.stage;
  const overlay = parent?.getChildByName?.(`player-pilot-move-${tokenId}`);
  if (!overlay) return;
  parent.removeChild(overlay);
  overlay.destroy({ children: true });
}

function drawMovementBurstOverlay(tokenDoc, points, distance, color) {
  if (!canvas?.ready || !globalThis.PIXI || !Array.isArray(points) || points.length < 2) return;
  const parent = canvas.controls ?? canvas.tokens ?? canvas.stage;
  if (!parent) return;
  const grid = Number(canvas?.grid?.size ?? tokenDoc?.parent?.grid?.size ?? 100) || 100;
  const centers = points.map((point) => tokenCenterAt(tokenDoc, point, grid));
  clearMovementBurstOverlay(tokenDoc.id);
  const overlay = new PIXI.Container();
  overlay.name = `player-pilot-move-${tokenDoc.id}`;
  overlay.eventMode = "none";
  const lineColor = movementOverlayColor(color);
  const shadow = new PIXI.Graphics();
  shadow.lineStyle(4, 0x071016, 0.3);
  shadow.moveTo(centers[0].x, centers[0].y);
  centers.slice(1).forEach((point) => shadow.lineTo(point.x, point.y));
  const line = new PIXI.Graphics();
  line.lineStyle(2, lineColor, 0.78);
  line.moveTo(centers[0].x, centers[0].y);
  centers.slice(1).forEach((point) => line.lineTo(point.x, point.y));
  const markers = new PIXI.Graphics();
  centers.forEach((point, index) => {
    markers.beginFill(index === centers.length - 1 ? 0xffffff : lineColor, 0.85);
    markers.drawCircle(point.x, point.y, index === centers.length - 1 ? 5 : 3.5);
    markers.endFill();
  });
  overlay.addChild(shadow, line, markers);
  const last = centers[centers.length - 1];
  const units = String(tokenDoc?.parent?.grid?.units ?? state.scene?.gridUnits ?? "ft");
  const label = createPixiText(`${Math.round(Number(distance ?? 0) * 10) / 10} ${units}`, {
    fontFamily: "Signika, Arial",
    fontSize: 17,
    fontWeight: "700",
    fill: lineColor
  });
  label.anchor?.set?.(0.5, 1);
  label.position?.set?.(last.x, last.y - 12);
  const labelBg = new PIXI.Graphics();
  const padX = 8;
  const padY = 5;
  labelBg.beginFill(0xffffff, 0.8);
  labelBg.lineStyle(1.5, lineColor, 0.65);
  labelBg.drawRoundedRect(
    last.x - (label.width / 2) - padX,
    last.y - 12 - label.height - padY,
    label.width + (padX * 2),
    label.height + (padY * 2),
    7
  );
  labelBg.endFill();
  overlay.addChild(labelBg, label);
  parent.addChild(overlay);
}

function drawRemoteMovementOverlay(data = {}) {
  if (game.user?.isGM || userIsPilot() || !canvas?.ready) return;
  const viewedSceneId = String(canvas?.scene?.id ?? game.scenes?.viewed?.id ?? "");
  const sceneId = String(data.sceneId ?? "");
  if (sceneId && viewedSceneId && sceneId !== viewedSceneId) return;
  const tokenDoc = canvas?.scene?.tokens?.get?.(String(data.tokenId ?? ""))
    ?? game.scenes?.viewed?.tokens?.get?.(String(data.tokenId ?? ""));
  if (!tokenDoc) return;
  const points = Array.isArray(data.points) ? data.points : [];
  if (points.length < 2) return;
  drawMovementBurstOverlay(tokenDoc, points, Number(data.totalDistance ?? 0), data.color);
  const previousTimer = remoteMovementOverlayTimers.get(tokenDoc.id);
  if (previousTimer) window.clearTimeout(previousTimer);
  const remaining = Math.max(50, Number(data.hideAt ?? 0) - Date.now());
  const timer = window.setTimeout(() => {
    if (remoteMovementOverlayTimers.get(tokenDoc.id) !== timer) return;
    remoteMovementOverlayTimers.delete(tokenDoc.id);
    clearMovementBurstOverlay(tokenDoc.id);
  }, remaining);
  remoteMovementOverlayTimers.set(tokenDoc.id, timer);
}

function requestMapSnapshot() {
  const token = activeTokenForActor();
  if (!sendSocket("mapSnapshotRequest", {
    actorId: state.actorId,
    tokenId: token?.id ?? state.selectedTokenId ?? "",
    sceneId: state.scene?.id ?? ""
  })) {
    ui.notifications?.warn?.("No GM is connected for Ping On Map.");
    return;
  }
  addLog("Map snapshot requested");
}

function openPingOnMap() {
  state.activeTab = "map";
  state.navOpen = false;
  state.mapZoom = 1;
  state.mapPanX = 0;
  state.mapPanY = 0;
  queueRender();
  requestMapSnapshot();
}

function handleMapSnapshotClick(event, node) {
  if (!state.mapSnapshot?.image) return;
  if (Date.now() < Number(state.mapSuppressClickUntil ?? 0)) return;
  if (state.mapDrag?.moved) return;
  const img = node.querySelector("img");
  if (!(img instanceof HTMLImageElement)) return;
  const rect = img.getBoundingClientRect();
  const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  sendSocket("mapSnapshotPing", {
    requestId: state.mapSnapshot.requestId,
    sceneId: state.mapSnapshot.sceneId,
    nx,
    ny
  });
  addLog("Map ping sent");
}

function registerChatCapture() {
  Hooks.on("createChatMessage", (message) => {
    if (!userIsPilot()) return;
    const actorId = String(message.speaker?.actor ?? "");
    if (actorId && actorId !== state.actorId) return;
    const rolls = Array.isArray(message.rolls) ? message.rolls : [];
    if (rolls.length) {
      const roll = rolls[0];
      addLog(message.flavor || message.speaker?.alias || "Roll", {
        total: roll.total,
        formula: roll.formula
      });
      return;
    }
    const content = htmlToPlain(message.content ?? "");
    if (content) addLog(content.slice(0, 60));
  });

  Hooks.on("renderChatMessageHTML", (message, _html, _options) => {
    if (!userIsPilot()) return;
    // Close any popped out chat messages
    for (const app of Object.values(message.apps)) {
      if (app instanceof CONFIG.ChatMessage.popoutClass) {
        app.close();
      }
    }
  });
}

async function handleSocket(data) {
  if (!data || typeof data !== "object") return;
  const targets = Array.isArray(data.targetUserIds) ? data.targetUserIds : null;
  if (targets && !targets.includes(game.user?.id)) return;

  if (data.type === "settingsChanged") {
    applySharedDocumentPopupMode();
    if (userIsPilot()) mountPilotShell();
    else unmountPilotShell();
    queueRender();
    await enforceNoCanvasIfNeeded();
    return;
  }

  if (game.user?.isGM) {
    await handleGmSocket(data);
    return;
  }

  await handlePlayerSocket(data);
}

async function handlePlayerSocket(data) {
  if (data.type === "sceneState") {
    const nextScene = data.scene ?? null;
    const fingerprint = sceneStateFingerprint(nextScene);
    const changed = fingerprint !== state.sceneFingerprint;
    state.scene = nextScene;
    state.sceneFingerprint = fingerprint;
    state.lastSceneReceivedAt = Date.now();
    if (!state.selectedTokenId) activeTokenForActor();
    if (!changed) return;
    if (shouldDelaySceneRender()) return;
    queueRender();
    return;
  }
  if (data.type === "commandResult") {
    if (data.movement && typeof data.movement === "object") {
      applyMovementToSceneState(data.movement);
      updatePlayerMovementStatus(data.movement, String(data.dir ?? ""));
      queueRender();
    } else if (String(data.message ?? "").toLowerCase().startsWith("moved") || String(data.message ?? "").toLowerCase().includes("blocked")) {
      state.lastMoveLabel = data.message ?? "";
      queueRender();
    }
    addLog(data.message ?? "Done");
    return;
  }
  if (data.type === "movementOverlay") {
    drawRemoteMovementOverlay(data);
    return;
  }
  if (data.type === "mapSnapshot") {
    state.mapSnapshot = {
      requestId: data.requestId,
      sceneId: data.sceneId,
      image: data.image
    };
    state.activeTab = "map";
    addLog("Map snapshot received");
    queueRender();
    return;
  }
  if (data.type === "mapSnapshotCancel") {
    ui.notifications?.warn?.(data.message ?? "Map snapshot was cancelled.");
    addLog("Map snapshot cancelled");
    return;
  }
  if (data.type === "journalImage") {
    if (sharedDocumentPopupsEnabled()) showSharedImage(data.src, Number(data.duration ?? 20));
    return;
  }
}

const gmProxyTargets = new Map();
const gmMapSnapshots = new Map();
const gmSceneStateSentAt = new Map();
const gmSceneStateFingerprints = new Map();
const gmMovementBursts = new Map();
const remoteMovementOverlayTimers = new Map();
const MOVEMENT_BURST_MS = 2500;
const MOVEMENT_DISPLAY_MS = 4500;

async function handleGmSocket(data) {
  if (data.type === "requestSceneState") {
    sendSceneState(data.userId, true);
    return;
  }
  if (game.paused === true && ["targetUpdate", "moveToken", "movementTrace", "useItem", "rollCheck", "formulaRoll", "rest", "updateActorData", "updateItemData", "pf2eStrike", "pf2eItemRoll", "pf2eToggleEquipped", "pf2eCurrency", "pingPoint", "mapSnapshotRequest", "mapSnapshotPing"].includes(data.type)) {
    sendSocket("commandResult", { targetUserIds: [data.userId], message: "Game paused" });
    return;
  }
  if (data.type === "targetUpdate") {
    gmProxyTargets.set(String(data.userId), {
      actorId: data.actorId,
      sceneId: data.sceneId,
      targetIds: Array.isArray(data.targetIds) ? data.targetIds : [],
      at: Date.now()
    });
    await applyProxyTargetsForUser(data.userId);
    sendSocket("commandResult", {
      targetUserIds: [data.userId],
      message: `Targets ${gmProxyTargets.get(String(data.userId)).targetIds.length}`
    });
    return;
  }
  if (data.type === "moveToken") {
    try {
      const tokenDoc = tokenDocForPilotRequest(data);
      const moveData = tokenDoc
        ? { ...data, tokenId: tokenDoc.id, sceneId: tokenDoc.parent?.id ?? data.sceneId }
        : data;
      const result = await queueTokenMovement(moveData, { showRuler: false });
      const burst = recordGmMovementBurst(moveData, result);
      sendSocket("commandResult", {
        targetUserIds: [data.userId],
        message: movementResultLabel({ ...result, totalDistance: burst?.totalDistance }, data.dir),
        dir: data.controlDir ?? data.dir,
        movement: {
          ...result,
          sceneId: String(moveData.sceneId ?? ""),
          tokenId: String(moveData.tokenId ?? ""),
          totalDistance: Number(burst?.totalDistance ?? result.distanceFeet ?? 0)
        }
      });
    } catch (err) {
      console.error("Player Pilot GM command failed: Moved", err);
      sendSocket("commandResult", { targetUserIds: [data.userId], message: "Move failed" });
      ui.notifications?.error?.("Player Pilot: Move failed.");
    }
    return;
  }
  if (data.type === "movementTrace") {
    const scene = getSceneDoc(data.sceneId);
    const tokenDoc = scene?.tokens?.get?.(data.tokenId) ?? asArray(scene?.tokens).find((token) => token.id === data.tokenId);
    if (tokenDoc) recordGmMovementBurst(data, {
      moved: true,
      previous: data.previous,
      target: data.target,
      distanceFeet: movementDistanceFeet(tokenDoc, data.previous, data.target, scene, Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100)),
      units: String(scene?.grid?.units ?? "ft")
    });
    return;
  }
  if (data.type === "useItem") {
    await gmRun("Used item", data.userId, () => gmUseItem(data));
    return;
  }
  if (data.type === "rollCheck") {
    await gmRun("Rolled", data.userId, () => gmRollCheck(data));
    return;
  }
  if (data.type === "pf2eStrike") {
    await gmRun(`PF2e ${data.operation ?? "attack"}`, data.userId, () => gmPf2eStrike(data));
    return;
  }
  if (data.type === "pf2eItemRoll") {
    await gmRun("PF2e item roll", data.userId, () => gmPf2eItemRoll(data));
    return;
  }
  if (data.type === "formulaRoll") {
    await gmRun(data.label || "Rolled", data.userId, async () => {
      const actor = gmActor(data.actorId);
      if (!actor) throw new Error("Actor not found.");
      await rollFormulaForActor(actor, data);
    });
    return;
  }
  if (data.type === "rest") {
    await gmRun(`${data.restType} rest`, data.userId, () => gmRest(data));
    return;
  }
  if (data.type === "updateActorData") {
    await gmRun(data.label || "Updated actor", data.userId, () => gmUpdateActorData(data));
    return;
  }
  if (data.type === "updateItemData") {
    await gmRun(data.label || "Updated item", data.userId, () => gmUpdateItemData(data));
    return;
  }
  if (data.type === "pf2eToggleEquipped") {
    await gmRun(data.label || "Updated equipment", data.userId, () => gmPf2eToggleEquipped(data));
    return;
  }
  if (data.type === "pingPoint") {
    await pingPoint(data);
    return;
  }
  if (data.type === "mapSnapshotRequest") {
    await handleMapSnapshotRequest(data);
    return;
  }
  if (data.type === "mapSnapshotPing") {
    await handleMapSnapshotPing(data);
  }
}

async function gmRun(label, userId, fn) {
  try {
    await fn();
    sendSocket("commandResult", { targetUserIds: [userId], message: label });
  } catch (err) {
    console.error(`Player Pilot GM command failed: ${label}`, err);
    sendSocket("commandResult", { targetUserIds: [userId], message: `${label} failed` });
    ui.notifications?.error?.(`Player Pilot: ${label} failed.`);
  }
}

function gmActor(actorId) {
  return game.actors?.get?.(actorId) ?? null;
}

async function applyProxyTargetsForUser(userId) {
  const proxy = gmProxyTargets.get(String(userId));
  if (!proxy || Date.now() - proxy.at > 2 * 60 * 60 * 1000) return;
  const ids = proxy.targetIds ?? [];
  applyTargetsForCurrentUser(ids, proxy.sceneId);
}

async function withProxyTargetsForUser(userId, fn) {
  const proxy = gmProxyTargets.get(String(userId));
  const shouldApply = proxy && Date.now() - proxy.at <= 2 * 60 * 60 * 1000;
  const previous = shouldApply ? targetIdsForCurrentUser() : [];
  if (shouldApply) applyTargetsForCurrentUser(proxy.targetIds ?? [], proxy.sceneId);
  try {
    return await fn();
  } finally {
    if (shouldApply) applyTargetsForCurrentUser(previous, proxy.sceneId);
  }
}

function actionNoticeIcon(item) {
  return ({
    spell: "fa-wand-magic-sparkles",
    weapon: "fa-sword",
    feat: "fa-star",
    consumable: "fa-flask",
    equipment: "fa-shield-halved",
    tool: "fa-hammer"
  })[String(item?.type ?? "").toLowerCase()] ?? "fa-bolt";
}

function actionNoticeType(item) {
  return ({
    spell: "Spell",
    weapon: "Weapon",
    feat: "Feature",
    consumable: "Item",
    equipment: "Item",
    tool: "Tool"
  })[String(item?.type ?? "").toLowerCase()] ?? capitalizeWords(item?.type || "Action");
}

function actionNoticeActivation(item, activityId = "") {
  const selected = activityId ? game.playerPilot.model.selectedItemActivity(item, activityId)?.activity : null;
  const activity = game.playerPilot.model.activitySystem?.(selected);
  return fieldText(
    formatActionTime(activity?.activation ?? selected?.activation ?? {}),
    formatActionTime(item?.system?.activation ?? {}),
    unitLabel(activity?.actionType),
    unitLabel(item?.system?.actionType)
  );
}

function actionNoticeTargets(data, item, actor) {
  const scene = getSceneDoc(data.sceneId);
  const targetIds = Array.isArray(data.targetIds) ? data.targetIds : [];
  const names = targetIds
    .map((id) => scene?.tokens?.get?.(id) ?? asArray(scene?.tokens).find((token) => String(token.id) === String(id)))
    .map((token) => fieldText(token?.name, token?.actor?.name))
    .filter(Boolean);
  if (names.length) return names;
  if (targetIds.length) return [`${targetIds.length} target${targetIds.length === 1 ? "" : "s"}`];
  const targetInfo = game.playerPilot.model.itemTargetInfo(item, data.options?.activityId);
  if (targetInfo.selfOnly) return [`${actor.name} (Self)`];
  return targetInfo.text ? [targetInfo.text] : [];
}

function compactTargetText(targets, limit = 2) {
  if (!targets.length) return "No target";
  if (targets.length <= limit) return targets.join(", ");
  return `${targets.slice(0, limit).join(", ")} +${targets.length - limit}`;
}

function renderGmActionNotice({ requester, actor, item, data }) {
  const activityName = String(data.options?.activityName ?? "").trim();
  const activation = actionNoticeActivation(item, data.options?.activityId);
  const isSpell = item.type === "spell";
  const adapterId = game.playerPilot.model.id;
  const selectedLevel = Number(data.options?.castLevel ?? 0);
  const baseLevel = adapterId === "pf2e" ? Number(game.playerPilot.model.pf2eSpellRank(item) ?? 0) : Number(item.system?.level ?? 0);
  const castLevel = selectedLevel > 0 ? selectedLevel : baseLevel;
  const isCantrip = adapterId === "pf2e" ? game.playerPilot.model.pf2eIsCantrip(item) : baseLevel <= 0;
  const levelText = isSpell ? (isCantrip ? "Cantrip" : String(castLevel)) : "";
  const levelLabel = adapterId === "pf2e" ? "Rank" : "Level";
  const targets = actionNoticeTargets(data, item, actor);
  const targetText = compactTargetText(targets, 4);
  const playerChoice = String(data.options?.playerChoice ?? "").trim();
  const playerChoiceLabel = String(data.options?.playerChoiceLabel ?? "Choice").trim();
  const actionDetail = [activityName, activation].filter(Boolean).join(" / ");
  const detailPills = [
    levelText ? `<span class="pp-gm-action-pill pp-gm-action-level"><b>${escapeHtml(levelLabel)}</b><strong>${escapeHtml(levelText)}</strong></span>` : "",
    `<span class="pp-gm-action-pill pp-gm-action-target"><b>Target</b><strong>${escapeHtml(targetText)}</strong></span>`,
    playerChoice ? `<span class="pp-gm-action-pill"><b>${escapeHtml(playerChoiceLabel)}</b><strong>${escapeHtml(playerChoice)}</strong></span>` : ""
  ].filter(Boolean).join("");
  return {
    targets,
    levelText,
    content: `
      <section class="pp-gm-action-notice">
        <div class="pp-gm-action-heading">
          <span>${escapeHtml(requester)} / ${escapeHtml(actor.name)}</span>
          <em>${escapeHtml(actionNoticeType(item))}</em>
        </div>
        <div class="pp-gm-action-summary">
          <i class="fas ${escapeHtml(actionNoticeIcon(item))}"></i>
          <strong>${escapeHtml(item.name)}</strong>
          ${actionDetail ? `<small>${escapeHtml(actionDetail)}</small>` : ""}
        </div>
        <div class="pp-gm-action-details">${detailPills}</div>
      </section>
    `
  };
}

async function gmUseItem(data) {
  const actor = gmActor(data.actorId);
  const item = actor?.items?.get?.(data.itemId);
  if (!actor || !item) throw new Error("Actor or item not found.");
  if (Array.isArray(data.targetIds)) {
    gmProxyTargets.set(String(data.userId), {
      actorId: data.actorId,
      sceneId: data.sceneId,
      targetIds: data.targetIds,
      at: Date.now()
    });
  }
  const requester = game.users?.get?.(String(data.userId ?? ""))?.name ?? "Player";
  const notice = renderGmActionNotice({ requester, actor, item, data });
  const toastParts = [
    `${requester}: ACTION ${item.name}`,
    notice.levelText ? `${game.playerPilot.model.id === "pf2e" ? "RANK" : "LEVEL"} ${notice.levelText}` : "",
    `TARGET ${compactTargetText(notice.targets)}`
  ].filter(Boolean);
  ui.notifications?.info?.(toastParts.join("  |  "));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: asArray(game.users).filter((user) => user.isGM).map((user) => user.id),
    content: notice.content,
    flags: {
      [MODULE_ID]: {
        actionNotice: true,
        itemId: item.id,
        actorId: actor.id
      }
    }
  });
  await withProxyTargetsForUser(data.userId, () => game.playerPilot.model.useItem(actor, item, data.options ?? {}));
}

async function gmRollCheck(data) {
  const actor = gmActor(data.actorId);
  if (!actor) throw new Error("Actor not found.");
  await game.playerPilot.model.rollCheck(actor, data.kind, data.key);
}

async function gmPf2eStrike(data) {
  const actor = gmActor(data.actorId);
  if (!actor || game.playerPilot.model.id !== "pf2e") throw new Error("PF2e actor not found.");
  if (Array.isArray(data.targetIds)) {
    gmProxyTargets.set(String(data.userId), {
      actorId: data.actorId,
      sceneId: data.sceneId,
      targetIds: data.targetIds,
      at: Date.now()
    });
  }
  await withProxyTargetsForUser(data.userId, () => game.playerPilot.model.executeStrike(actor, data));
}

async function gmPf2eItemRoll(data) {
  const actor = gmActor(data.actorId);
  const item = actor?.items?.get?.(data.itemId);
  if (!actor || !item || game.playerPilot.model.id !== "pf2e") throw new Error("PF2e actor or item not found.");
  if (Array.isArray(data.targetIds)) {
    gmProxyTargets.set(String(data.userId), {
      actorId: data.actorId,
      sceneId: data.sceneId,
      targetIds: data.targetIds,
      at: Date.now()
    });
  }
  await withProxyTargetsForUser(data.userId, () => game.playerPilot.model.nativeItemRoll(actor, item, data.nativeAction, data));
}

function gmRest(data) {
  const actor = gmActor(data.actorId);
  if (!actor) throw new Error("Actor not found.");
  return game.playerPilot.model.rest(actor, data);
}

async function gmUpdateActorData(data) {
  const actor = gmActor(data.actorId);
  if (!actor) throw new Error("Actor not found.");
  await actor.update(data.updates ?? {});
}

async function gmPf2eToggleEquipped(data) {
  const actor = gmActor(data.actorId);
  const item = actor?.items?.get?.(data.itemId);
  if (!actor || !item) throw new Error("PF2e equipment control unavailable.");
  if (data.carryType && typeof game.playerPilot.model.setCarry === "function") {
    await game.playerPilot.model.setCarry(actor, item, {
      carryType: data.carryType,
      handsHeld: data.handsHeld,
      inSlot: data.inSlot
    });
    return;
  }
  if (typeof game.playerPilot.model.toggleEquipped !== "function") throw new Error("PF2e equipment control unavailable.");
  await game.playerPilot.model.toggleEquipped(actor, item, data.equipped === true);
}

async function gmUpdateItemData(data) {
  const actor = gmActor(data.actorId);
  const item = actor?.items?.get?.(data.itemId);
  if (!item) throw new Error("Item not found.");
  await item.update(data.updates ?? {});
}

function sendSceneState(targetUserId = "", force = false) {
  if (!game.user?.isGM) return;
  const targetUserIds = targetUserId ? [targetUserId] : userIdsForPilots();
  for (const userId of targetUserIds) {
    const now = Date.now();
    const last = Number(gmSceneStateSentAt.get(String(userId)) ?? 0);
    if (!force && now - last < 750) continue;
    const scene = buildLocalSceneState(userId);
    if (!scene) continue;
    const fingerprint = sceneStateFingerprint(scene);
    if (!force && gmSceneStateFingerprints.get(String(userId)) === fingerprint) continue;
    gmSceneStateSentAt.set(String(userId), now);
    gmSceneStateFingerprints.set(String(userId), fingerprint);
    sendSocket("sceneState", { targetUserIds: [userId], scene });
  }
}

function debounce(fn, delay = 150) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

const sendSceneStateDebounced = debounce(() => sendSceneState(), 1000);

async function pingPoint(data) {
  const sceneId = String(data.sceneId ?? canvas?.scene?.id ?? game.scenes?.viewed?.id ?? "");
  const x = Number(data.x ?? 0);
  const y = Number(data.y ?? 0);
  const zoom = Number(canvas?.stage?.scale?.x ?? canvas?.stage?.worldTransform?.a ?? 1);
  const user = game.users?.get?.(String(data.userId ?? "")) ?? game.user;
  const color = user?.color ?? game.user?.color ?? "#62c7b2";
  try {
    const ping = { scene: sceneId, style: "pulse", pull: false, color };
    if (Number.isFinite(zoom) && zoom > 0) ping.zoom = zoom;
    await game.user?.broadcastActivity?.({
      cursor: { x, y },
      ping
    });
  } catch (err) {
    console.warn("Player Pilot ping failed:", err);
  }
  drawLocalPing({ x, y, sceneId, userId: data.userId, color });
}

function drawLocalPing({ x, y, sceneId, userId, color }) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  try {
    canvas.controls?.drawPing?.(
      { x: px, y: py },
      {
        scene: String(sceneId ?? "") || (game.scenes?.viewed?.id ?? canvas?.scene?.id ?? null),
        user: String(userId ?? "") || game.user?.id || null,
        color: color || game.users?.get?.(String(userId ?? ""))?.color || game.user?.color || "#62c7b2"
      }
    );
    return true;
  } catch (_err) {
    try {
      canvas.ping?.({ x: px, y: py });
      return true;
    } catch (__err) {
      return false;
    }
  }
}

async function handleMapSnapshotRequest(data) {
  const requestId = foundry.utils.randomID();
  const sendCancel = (message) => sendSocket("mapSnapshotCancel", {
    targetUserIds: [data.userId],
    requestId,
    message
  });
  if (!canvas?.ready || !canvas?.app?.renderer) {
    sendCancel("The GM canvas is not ready.");
    return;
  }
  const selection = selectSnapshotTokenForPlayer(data);
  if (!selection.tokenDoc || !selection.selected) {
    restoreSnapshotTokenSelection(selection.previousTokenIds, selection.controlState);
    sendCancel("Player Pilot could not select your token for a player-vision snapshot.");
    return;
  }
  try {
    const approval = String(setting("pingApprovalMode", "manual"));
    if (approval !== "auto") {
      const tokenName = selection.tokenDoc?.name ?? "the player's token";
      const approved = await Dialog.confirm({
        title: "Player Pilot Map Snapshot",
        content: `<p>${escapeHtml(game.users.get(data.userId)?.name ?? "A player")} requested a map snapshot for Ping On Map.</p><p><strong>${escapeHtml(tokenName)}</strong> is selected so the snapshot uses that player's vision.</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: true
      });
      if (!approved) {
        sendCancel("The GM declined the map snapshot.");
        return;
      }
    }
    await refreshSnapshotVision();
    const snapshot = await captureMapSnapshot();
    gmMapSnapshots.set(requestId, {
      sceneId: snapshot.capture?.sceneId ?? canvas.scene?.id ?? data.sceneId ?? "",
      capture: snapshot.capture,
      worldRect: snapshot.worldRect,
      at: Date.now()
    });
    sendSocket("mapSnapshot", {
      targetUserIds: [data.userId],
      requestId,
      sceneId: snapshot.capture?.sceneId ?? canvas.scene?.id ?? data.sceneId ?? "",
      image: snapshot.image
    });
  } catch (err) {
    console.error("Player Pilot snapshot failed:", err);
    sendCancel("The GM could not capture a map snapshot.");
  } finally {
    restoreSnapshotTokenSelection(selection.previousTokenIds, selection.controlState);
  }
}

function captureCanvasControlState() {
  const controls = ui?.controls;
  const entries = Array.isArray(controls?.controls) ? controls.controls : [];
  const active = controls?.control ?? entries.find((entry) => entry?.active) ?? null;
  return {
    control: String(active?.name ?? ""),
    tool: String(active?.activeTool ?? active?.tools?.find?.((tool) => tool?.active)?.name ?? "")
  };
}

function activateCanvasControl(control = "token", tool = "select") {
  const layer = control === "token" ? canvas?.tokens : null;
  try {
    layer?.activate?.();
    ui?.controls?.activateControl?.(control);
    if (tool) ui?.controls?.activateTool?.(tool);
    return true;
  } catch (_err) {
    return false;
  }
}

function sceneForPilotTokenRequest(data = {}) {
  const viewedScene = canvas?.scene ?? game.scenes?.viewed ?? null;
  const requestedScene = getSceneDoc(data.sceneId);
  return requestedScene && viewedScene && String(requestedScene.id ?? "") === String(viewedScene.id ?? "")
    ? requestedScene
    : (viewedScene ?? requestedScene);
}

function tokenDocForPilotRequest(data = {}) {
  const scene = sceneForPilotTokenRequest(data);
  const userId = String(data.userId ?? "");
  const tokenId = String(data.tokenId ?? "");
  const actorId = String(data.actorId ?? "");
  const user = game.users?.get?.(userId) ?? null;
  const characterId = String(user?.character?.id ?? user?.characterId ?? "");
  const tokens = viewedTokenDocumentsForScene(scene);
  const actorForToken = (token) => token?.actor ?? game.actors?.get?.(token?.actorId) ?? null;
  const tokenActorId = (token) => String(token?.actorId ?? token?.actor?.id ?? "");
  return tokens.find((token) => tokenId && String(token.id ?? "") === tokenId)
    ?? tokens.find((token) => actorId && tokenActorId(token) === actorId)
    ?? tokens.find((token) => characterId && tokenActorId(token) === characterId)
    ?? tokens.find((token) => actorOwnedByUser(actorForToken(token), userId))
    ?? null;
}

function selectSnapshotTokenForPlayer(data = {}) {
  const tokenDoc = tokenDocForPilotRequest(data);
  const controlState = captureCanvasControlState();
  const previousTokenIds = asArray(canvas?.tokens?.controlled).map((token) => String(token.id ?? token.document?.id ?? "")).filter(Boolean);
  const token = tokenDoc ? (canvas?.tokens?.get?.(tokenDoc.id) ?? tokenDoc.object) : null;
  let selected = false;
  try {
    activateCanvasControl("token", "select");
    canvas?.tokens?.releaseAll?.();
    token?.control?.({ releaseOthers: true });
    selected = token?.controlled === true
      || asArray(canvas?.tokens?.controlled).some((controlled) => String(controlled.id ?? controlled.document?.id ?? "") === String(tokenDoc?.id ?? ""));
  } catch (_err) {
    selected = false;
  }
  return { tokenDoc, selected, previousTokenIds, controlState };
}

async function refreshSnapshotVision() {
  try {
    const update = canvas?.perception?.update?.(
      { refreshVision: true, refreshLighting: true },
      { force: true }
    );
    if (update?.then) await update;
  } catch (_err) {
    // Token control still triggers Foundry's normal vision refresh.
  }
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
}

function restoreSnapshotTokenSelection(tokenIds = [], controlState = null) {
  try {
    canvas?.tokens?.releaseAll?.();
    tokenIds.forEach((id, index) => canvas?.tokens?.get?.(id)?.control?.({ releaseOthers: index === 0 }));
    if (controlState?.control) activateCanvasControl(controlState.control, controlState.tool || "select");
  } catch (_err) {
    // The GM can reselect manually if the scene changed during capture.
  }
}

async function captureMapSnapshot() {
  const renderer = canvas.app?.renderer;
  const source = canvas.app?.view;
  const screenW = Math.max(1, Math.round(renderer?.screen?.width || source?.width || window.innerWidth || 1));
  const screenH = Math.max(1, Math.round(renderer?.screen?.height || source?.height || window.innerHeight || 1));
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / Math.max(1, screenW));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(screenW * scale));
  out.height = Math.max(1, Math.floor(screenH * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Snapshot canvas unavailable.");
  const hidden = [];
  const hide = (node) => {
    if (!node) return;
    hidden.push([node, node.visible]);
    node.visible = false;
  };
  try {
    hide(canvas.notes);
    hide(canvas.drawings);
    hide(canvas.templates);
    hide(canvas.controls?.hud);
    hide(canvas.controls?.rulers);
    asArray(canvas.tiles?.placeables).filter((tile) => tile.document?.hidden).forEach(hide);
    asArray(canvas.tokens?.placeables).filter((token) => token.document?.hidden).forEach(hide);
    const extract = renderer?.extract ?? renderer?.plugins?.extract;
    if (extract?.canvas && globalThis.PIXI?.RenderTexture && canvas.stage) {
      const texture = PIXI.RenderTexture.create({ width: screenW, height: screenH, resolution: 1 });
      try {
        renderer.render({ container: canvas.stage, target: texture, clear: true });
      } catch (_err) {
        renderer.render(canvas.stage, { renderTexture: texture, clear: true });
      }
      const extracted = extract.canvas(texture);
      ctx.drawImage(extracted, 0, 0, out.width, out.height);
      texture.destroy(true);
    } else if (source) {
      ctx.drawImage(source, 0, 0, out.width, out.height);
    } else {
      throw new Error("No render source available.");
    }
  } finally {
    for (const [node, visible] of hidden) node.visible = visible;
  }
  const wt = canvas.stage?.worldTransform;
  return {
    image: out.toDataURL("image/webp", 0.68),
    capture: {
      a: Number(wt?.a ?? 1),
      b: Number(wt?.b ?? 0),
      c: Number(wt?.c ?? 0),
      d: Number(wt?.d ?? 1),
      tx: Number(wt?.tx ?? 0),
      ty: Number(wt?.ty ?? 0),
      screenW,
      screenH,
      sceneId: canvas.scene?.id ?? game.scenes?.viewed?.id ?? ""
    },
    worldRect: getCurrentViewportWorldRect(screenW, screenH)
  };
}

function getCurrentViewportWorldRect(width, height) {
  try {
    const Point = globalThis.PIXI?.Point;
    if (Point && canvas.stage?.toLocal) {
      const topLeft = canvas.stage.toLocal(new Point(0, 0));
      const bottomRight = canvas.stage.toLocal(new Point(width, height));
      return {
        x1: Number(topLeft.x ?? 0),
        y1: Number(topLeft.y ?? 0),
        x2: Number(bottomRight.x ?? 0),
        y2: Number(bottomRight.y ?? 0)
      };
    }
  } catch (_err) {
    // fall back below
  }
  return {
    x1: 0,
    y1: 0,
    x2: Number(canvas?.dimensions?.width ?? width),
    y2: Number(canvas?.dimensions?.height ?? height)
  };
}

async function handleMapSnapshotPing(data) {
  const stored = gmMapSnapshots.get(String(data.requestId ?? ""));
  const nx = clamp(Number(data.nx ?? 0), 0, 1);
  const ny = clamp(Number(data.ny ?? 0), 0, 1);
  const capture = stored?.capture;
  if (capture && globalThis.PIXI?.Matrix && globalThis.PIXI?.Point) {
    const sx = nx * Number(capture.screenW || 0);
    const sy = ny * Number(capture.screenH || 0);
    const matrix = new PIXI.Matrix(
      Number(capture.a || 1),
      Number(capture.b || 0),
      Number(capture.c || 0),
      Number(capture.d || 1),
      Number(capture.tx || 0),
      Number(capture.ty || 0)
    );
    const point = matrix.clone().invert().apply(new PIXI.Point(sx, sy));
    await pingPoint({
      sceneId: capture.sceneId ?? stored?.sceneId ?? data.sceneId ?? canvas.scene?.id,
      x: point.x,
      y: point.y,
      userId: data.userId
    });
    return;
  }
  const rect = stored?.worldRect ?? {
    x1: 0,
    y1: 0,
    x2: Number(canvas?.dimensions?.width ?? 0),
    y2: Number(canvas?.dimensions?.height ?? 0)
  };
  await pingPoint({
    sceneId: stored?.sceneId ?? data.sceneId ?? canvas.scene?.id,
    x: Number(rect.x1 ?? 0) + (Number(rect.x2 ?? 0) - Number(rect.x1 ?? 0)) * nx,
    y: Number(rect.y1 ?? 0) + (Number(rect.y2 ?? 0) - Number(rect.y1 ?? 0)) * ny,
    userId: data.userId
  });
}

function showSharedImage(src, seconds = 20) {
  if (!src) return;
  state.sharedImage?.remove();
  const wrap = document.createElement("section");
  wrap.className = "pp-shared-image";
  wrap.innerHTML = `
    <button class="pp-icon-btn" type="button"><i class="fas fa-xmark"></i></button>
    <img src="${escapeHtml(src)}" alt="Shared journal image">
  `;
  document.body.appendChild(wrap);
  state.sharedImage = wrap;
  const close = () => {
    if (state.sharedImage === wrap) state.sharedImage = null;
    wrap.remove();
  };
  wrap.querySelector("button")?.addEventListener("click", close);
  window.setTimeout(close, Math.max(5, Number(seconds) || 20) * 1000);
}

function renderRootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function isSharedDocumentPopup(app, root) {
  const className = String(app?.constructor?.name ?? "");
  if (/ImagePopout|Journal.*Sheet/.test(className)) return true;
  if (!(root instanceof HTMLElement)) return false;
  return root.matches?.(
    ".image-popout, .journal-sheet, .journal-entry, .journal-entry-page, "
    + "[data-application-class='ImagePopout'], [data-application-class*='Journal']"
  ) === true;
}

function closeSharedDocumentPopup(app, root) {
  if (root instanceof HTMLElement) root.style.setProperty("display", "none", "important");
  window.setTimeout(() => {
    try {
      app?.close?.({ force: true });
    } catch (_err) {
      try {
        app?.close?.();
      } catch (_innerErr) {
        // Ignore close failures; the popup has already been hidden.
      }
    }
  }, 0);
}

function handleSharedDocumentPopupRender(app, html) {
  if (!userIsPilot()) return;
  const root = renderRootElement(html);
  if (!isSharedDocumentPopup(app, root)) return;

  applySharedDocumentPopupMode();
  if (!sharedDocumentPopupsEnabled()) {
    closeSharedDocumentPopup(app, root);
    return;
  }

  root?.classList?.add?.("pp-shared-document-popup");
  window.setTimeout(() => app?.bringToTop?.(), 0);
}

function bindTokenHudTargetToggle(app, html) {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
  if (!(root instanceof HTMLElement)) return;
  const token = app?.object ?? app?.token ?? canvas?.tokens?.hud?.object ?? null;
  const tokenDoc = token?.document ?? token ?? null;
  if (!tokenDoc?.id) return;
  let button = root.querySelector(".control-icon.pp-targetlist-toggle");
  if (!(button instanceof HTMLElement)) {
    const wrapper = document.createElement("div");
    wrapper.className = "control-icon pp-targetlist-toggle";
    wrapper.setAttribute("role", "button");
    wrapper.innerHTML = `<i class="fa-solid fa-user-plus"></i>`;
    const rightCol = root.querySelector(".col.right");
    if (rightCol) rightCol.prepend(wrapper);
    else root.append(wrapper);
    button = wrapper;
  }
  const sync = () => {
    const sceneId = String(tokenDoc.parent?.id ?? canvas?.scene?.id ?? "");
    const enabled = manualTargetIncluded(sceneId, tokenDoc);
    button.classList.toggle("active", enabled);
    const icon = button.querySelector("i");
    if (icon instanceof HTMLElement) icon.className = enabled ? "fa-solid fa-user-check" : "fa-solid fa-user-plus";
    const hint = enabled
      ? "Included in Player Pilot Targets/Ping list for this scene"
      : "Add this token to Player Pilot Targets/Ping list for this scene";
    button.title = hint;
    button.dataset.tooltip = hint;
    button.setAttribute("aria-label", hint);
  };
  sync();
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const sceneId = String(tokenDoc.parent?.id ?? canvas?.scene?.id ?? "");
    setManualTargetMembership(sceneId, tokenDoc, !manualTargetIncluded(sceneId, tokenDoc));
    sync();
    sendSceneState();
  };
}

function installGmMapToggleButton() {
  if (!game.user?.isGM || document.getElementById("player-pilot-gm-map-toggle")) return;
  const button = document.createElement("button");
  button.id = "player-pilot-gm-map-toggle";
  button.type = "button";
  button.innerHTML = `<i class="fas fa-mobile-screen-button"></i>`;
  const applyStoredPosition = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(GM_MAP_TOGGLE_POSITION_KEY) ?? "null");
      const left = Number(stored?.left);
      const top = Number(stored?.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      button.style.left = `${clamp(left, 0, Math.max(0, window.innerWidth - 48))}px`;
      button.style.top = `${clamp(top, 0, Math.max(0, window.innerHeight - 48))}px`;
      button.style.bottom = "auto";
    } catch (_err) {
      // Ignore stale local storage.
    }
  };
  const sync = () => {
    const enabled = setting("mapControlsEnabled", true) === true;
    button.classList.toggle("enabled", enabled);
    button.title = enabled ? "Player Pilot controls are on" : "Player Pilot controls are off";
  };
  let drag = null;
  let dragFrame = 0;
  const applyDragPosition = () => {
    dragFrame = 0;
    if (!drag) return;
    button.style.left = `${drag.nextLeft}px`;
    button.style.top = `${drag.nextTop}px`;
    button.style.bottom = "auto";
  };
  const queueDragPosition = () => {
    if (!dragFrame) dragFrame = window.requestAnimationFrame(applyDragPosition);
  };
  const onDragMove = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    event.stopPropagation();
    drag.nextLeft = Math.round(clamp(drag.left + dx, 0, Math.max(0, window.innerWidth - button.offsetWidth)));
    drag.nextTop = Math.round(clamp(drag.top + dy, 0, Math.max(0, window.innerHeight - button.offsetHeight)));
    button.classList.add("dragging");
    queueDragPosition();
  };
  const onDragEnd = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    const left = drag.nextLeft;
    const top = drag.nextTop;
    drag = null;
    document.removeEventListener("pointermove", onDragMove, true);
    document.removeEventListener("pointerup", onDragEnd, true);
    document.removeEventListener("pointercancel", onDragEnd, true);
    if (dragFrame) {
      window.cancelAnimationFrame(dragFrame);
      dragFrame = 0;
    }
    button.classList.remove("dragging");
    if (moved) {
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      button.style.bottom = "auto";
      localStorage.setItem(GM_MAP_TOGGLE_POSITION_KEY, JSON.stringify({ left, top }));
      button.dataset.skipClick = "true";
      window.setTimeout(() => { delete button.dataset.skipClick; }, 0);
    }
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = button.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      nextLeft: Math.round(rect.left),
      nextTop: Math.round(rect.top),
      moved: false
    };
    document.addEventListener("pointermove", onDragMove, true);
    document.addEventListener("pointerup", onDragEnd, true);
    document.addEventListener("pointercancel", onDragEnd, true);
  });
  button.addEventListener("click", async (event) => {
    if (button.dataset.skipClick === "true") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const next = !(setting("mapControlsEnabled", true) === true);
    await game.settings.set(MODULE_ID, "mapControlsEnabled", next);
    sync();
    sendSceneState();
  });
  document.body.appendChild(button);
  applyStoredPosition();
  sync();
}

function removeGmMapToggleButton() {
  const toggleElement = document.getElementById("player-pilot-gm-map-toggle")
  if (!game.user?.isGM || !toggleElement) return;
  toggleElement.remove();
}

let audioSuppressionInstalled = false;

function shouldSuppressPlayerAudio() {
  return userIsPilot() && setting("suppressPlayerAudio", true) === true;
}

function stopSuppressedAudio() {
  if (!shouldSuppressPlayerAudio()) return;
  try {
    for (const sound of (game.audio?.playing?.values?.() ?? [])) {
      try { sound?.stop?.({ fade: 0 }); } catch (_err) { /* best effort */ }
    }
  } catch (_err) {
    // best effort
  }
  document.querySelectorAll("audio").forEach((audio) => {
    try {
      audio.pause();
      audio.muted = true;
      audio.volume = 0;
      audio.currentTime = 0;
    } catch (_err) {
      // best effort
    }
  });
}

function patchAudioMethod(target, methodName, handler) {
  if (!target || typeof target[methodName] !== "function") return false;
  const flag = `__playerPilotAudioGuard_${methodName}`;
  if (target[flag] === true) return true;
  const original = target[methodName];
  target[methodName] = function (...args) {
    return handler.call(this, original, args);
  };
  Object.defineProperty(target, flag, { value: true, configurable: true });
  return true;
}

function installAudioSuppression() {
  if (!audioSuppressionInstalled) {
    audioSuppressionInstalled = true;
    try {
      const originalMediaPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        if (shouldSuppressPlayerAudio()) {
          try {
            this.pause();
            this.muted = true;
            this.volume = 0;
          } catch (_err) {
            // best effort
          }
          return Promise.resolve();
        }
        return originalMediaPlay.apply(this, args);
      };
    } catch (_err) {
      // browser path unavailable
    }
  }
  const soundClasses = Array.from(new Set([globalThis.Sound, globalThis.foundry?.audio?.Sound].filter(Boolean)));
  for (const SoundClass of soundClasses) {
    const proto = SoundClass?.prototype;
    for (const method of ["play", "playAtPosition"]) {
      patchAudioMethod(proto, method, function (original, args) {
        if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
        stopSuppressedAudio();
        return Promise.resolve(null);
      });
    }
    patchAudioMethod(proto, "_play", function (original, args) {
      if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
      stopSuppressedAudio();
      return undefined;
    });
    patchAudioMethod(proto, "load", function (original, args) {
      if (shouldSuppressPlayerAudio() && args?.[0]?.autoplay) {
        args = [{ ...args[0], autoplay: false }, ...args.slice(1)];
      }
      return original.apply(this, args);
    });
  }
  const playlistClasses = Array.from(new Set([globalThis.PlaylistSound, globalThis.foundry?.documents?.PlaylistSound].filter(Boolean)));
  for (const PlaylistSoundClass of playlistClasses) {
    patchAudioMethod(PlaylistSoundClass?.prototype, "play", function (original, args) {
      if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
      try { this?.sound?.stop?.({ fade: 0 }); } catch (_err) { /* best effort */ }
      stopSuppressedAudio();
      return null;
    });
  }
  const audioHelpers = Array.from(new Set([globalThis.AudioHelper, globalThis.foundry?.audio?.AudioHelper].filter(Boolean)));
  for (const AudioHelperClass of audioHelpers) {
    patchAudioMethod(AudioHelperClass, "play", function (original, args) {
      if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
      stopSuppressedAudio();
      return null;
    });
  }
  patchAudioMethod(game.audio, "play", function (original, args) {
    if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
    stopSuppressedAudio();
    return Promise.resolve(null);
  });
  patchAudioMethod(globalThis.HTMLAudioElement?.prototype, "play", function (original, args) {
    if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
    stopSuppressedAudio();
    return Promise.resolve();
  });
  patchAudioMethod(globalThis.Howl?.prototype, "play", function (original, args) {
    if (!shouldSuppressPlayerAudio()) return original.apply(this, args);
    try { this.stop?.(); } catch (_err) { /* best effort */ }
    stopSuppressedAudio();
    return null;
  });
  stopSuppressedAudio();
}

function suppressPlayerAudio() {
  installAudioSuppression();
  stopSuppressedAudio();
}

function installChatModeBridge() {
  const Chat = globalThis.ChatMessage;
  if (!Chat || Chat.__playerPilotApplyModeBridge || typeof Chat.applyMode !== "function" || typeof Chat.applyRollMode !== "function") return;
  try {
    Object.defineProperty(Chat, "applyRollMode", {
      configurable: true,
      writable: true,
      value(chatData, rollMode) {
        return Chat.applyMode(chatData, rollMode);
      }
    });
    Object.defineProperty(Chat, "__playerPilotApplyModeBridge", {
      configurable: true,
      value: true
    });
  } catch (_err) {
    // Keep Foundry's native method if another module has locked the property.
  }
}

function closePilotUserConfiguration(app) {
  if (!userIsPilot()) return;
  const name = String(app?.constructor?.name ?? "");
  const id = String(app?.id ?? app?.options?.id ?? "");
  const title = String(app?.title ?? app?.window?.title ?? "");
  if (!/UserConfig|UserConfiguration/i.test(`${name} ${id} ${title}`)) return;
  window.queueMicrotask(() => {
    try {
      app?.close?.({ animate: false });
    } catch (_err) {
      try { app?.close?.(); } catch (_closeErr) { /* best effort */ }
    }
  });
}

function applicationRoot(app, html = null) {
  const fromHook = html instanceof HTMLElement ? html : html?.[0];
  if (fromHook instanceof HTMLElement) return fromHook;
  const fromApp = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
  return fromApp instanceof HTMLElement ? fromApp : null;
}

function pilotPromptSignal(app, root) {
  if (!(root instanceof HTMLElement)) return false;
  if (root.matches(".player-pilot-shell, .pp-modal, .pp-boot-screen") || root.closest(".player-pilot-shell, .pp-modal")) return false;
  const identity = [
    app?.constructor?.name,
    app?.id,
    app?.options?.id,
    app?.title,
    root.id,
    root.className,
    root.querySelector(".window-title")?.textContent
  ].map((value) => String(value ?? "")).join(" ");
  if (/UserConfig|UserConfiguration|player-pilot-access/i.test(identity)) return false;
  const footer = root.querySelector("footer.form-footer, [data-application-part='footer'], .dialog-buttons");
  const buttons = footer?.querySelectorAll?.("button, [type='submit']") ?? [];
  if (!footer || buttons.length < 1) return false;
  const explicitDialog = /Dialog|Prompt|Confirm/i.test(identity)
    || !!root.querySelector(".dialog-content, #dialog-app, .cpr-dialog, [data-application-part='form'].dialog-content");
  return explicitDialog;
}

function syncPilotPromptBackdrop() {
  if (!userIsPilot()) {
    document.body?.classList?.remove?.("player-pilot-native-prompt-open");
    return;
  }
  const open = !!document.querySelector(".application.pp-native-prompt, .window-app.pp-native-prompt");
  document.body?.classList?.toggle?.("player-pilot-native-prompt-open", open);
}

function surfacePilotPrompt(app, html = null) {
  if (!userIsPilot()) return;
  const root = applicationRoot(app, html);
  if (!pilotPromptSignal(app, root)) return;
  root.classList.add("pp-native-prompt");
  root.setAttribute("aria-modal", "true");
  root.dataset.ppNativePrompt = "1";
  syncPilotPromptBackdrop();
  window.requestAnimationFrame(() => {
    if (!root.isConnected) return;
    root.querySelector("button[autofocus], footer button, [data-application-part='footer'] button")?.focus?.({ preventScroll: true });
  });
}

function installPilotPromptObserver() {
  if (!userIsPilot() || state.nativePromptObserver || !document.body) return;
  const inspect = (node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(".application, .window-app")) surfacePilotPrompt(null, node);
    node.querySelectorAll?.(".application, .window-app").forEach((element) => surfacePilotPrompt(null, element));
  };
  document.querySelectorAll(".application, .window-app").forEach((element) => surfacePilotPrompt(null, element));
  state.nativePromptObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(inspect);
    }
    window.queueMicrotask(syncPilotPromptBackdrop);
  });
  state.nativePromptObserver.observe(document.body, { childList: true });
}

function createSystemModel() {
  if (game.system.id == "dnd5e") {
    game.playerPilot.model = new DnD5eModel();
  } else if (game.system.id == "pf2e") {
    game.playerPilot.model = new PF2eModel();
  } else if (game.system.id == "swade") {
    game.playerPilot.model = new SwadeModel();
  } else {
    game.playerPilot.model = new BaseModel();
  }

  PlayerPilotShell.DEFAULT_OPTIONS.actions =
    foundry.utils.mergeObject(
      PlayerPilotShell.DEFAULT_OPTIONS.actions,
      game.playerPilot.model.constructor.SHELL_ACTIONS);
}

function registerHooks() {
  Hooks.on("renderUserConfig", closePilotUserConfiguration);
  Hooks.on("renderApplicationV2", closePilotUserConfiguration);
  Hooks.on("renderApplicationV2", surfacePilotPrompt);
  Hooks.on("closeApplicationV2", () => window.queueMicrotask(syncPilotPromptBackdrop));
  Hooks.on("renderDialog", surfacePilotPrompt);
  Hooks.on("closeDialog", () => window.queueMicrotask(syncPilotPromptBackdrop));
  Hooks.once("init", async () => {
    game.playerPilot ??= {};
    await loadTemplates();
    registerHandlebarsHelpers();
    registerSettings();
    const activePilot = earlyUserIsPilot();
    syncManagedNoCanvas(activePilot && setting('useNoCanvas', true) === true);
    if (activePilot) {
      startBootScreen();
      updateBootBranding();
      setBootStage(34, "Loading Player Pilot settings...", 72);
    } else removeBootScreen();
    if (activePilot) installAudioSuppression();
    installChatModeBridge();
    Hooks.on("canvasInit", () => {
      if (userIsPilot() && setting("useNoCanvas", true) === true) document.body?.classList?.add?.("player-pilot-active");
    });
  });
  Hooks.once("i18nInit", async () => {
    createSystemModel();
  });
  Hooks.once("setup", () => {
    if (!userIsPilot()) {
      removeBootScreen();
      return;
    }
    startBootScreen();
    updateBootBranding();
    setBootStage(72, "Preparing your character controls...", 88);
    mountPilotShell();
  });
  Hooks.once("ready", async () => {
    updateBootBranding();
    if (userIsPilot()) setBootStage(90, "Finishing character data...", 95);
    game.socket?.on?.(SOCKET, handleSocket);
    if (userIsPilot()) {
      registerChatCapture();
      installAudioSuppression();
    }
    installChatModeBridge();
    if (setting("showMapControlsToggleButton")) {
      installGmMapToggleButton();
    }
    await showGmChangelogOnce();
    await enforceNoCanvasIfNeeded();
    if (userIsPilot()) {
      installFoundryNotificationAutoClose();
      installPilotPromptObserver();
      mountPilotShell();
      requestSceneState(true);
      revealPilotShell();
      suppressPlayerAudio();
      invalidateModelCache();
    }
    else removeBootScreen();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !userIsPilot()) return;
    if (Date.now() - Number(state.lastSceneReceivedAt ?? 0) > 60000) requestSceneState(true);
  });

  Hooks.on("pauseGame", () => {
    if (userIsPilot()) queueRender();
  });
  Hooks.on("updateActor", (actor) => {
    if (userIsPilot() && String(actor?.id ?? "") === String(state.actorId ?? "")) {
      invalidateModelCache();
      queueRender();
    }
    if (game.user?.isGM) {
      const scene = getSceneDoc();
      const actorId = String(actor?.id ?? "");
      if (actorId && asArray(scene?.tokens).some((token) => String(token.actor?.id ?? token.actorId ?? "") === actorId)) {
        sendSceneStateDebounced();
      }
    }
  });
  Hooks.on("createItem", (item) => {
    if (userIsPilot() && String(item?.parent?.id ?? item?.actor?.id ?? "") === String(state.actorId ?? "")) {
      invalidateModelCache();
      queueRender();
    }
  });
  Hooks.on("updateItem", (item) => {
    if (userIsPilot() && String(item?.parent?.id ?? item?.actor?.id ?? "") === String(state.actorId ?? "")) {
      invalidateModelCache();
      queueRender();
    }
  });
  Hooks.on("deleteItem", (item) => {
    if (userIsPilot() && String(item?.parent?.id ?? item?.actor?.id ?? "") === String(state.actorId ?? "")) {
      invalidateModelCache();
      queueRender();
    }
  });
  Hooks.on("sfcReady", () => {
    if (userIsPilot()) {
      invalidateModelCache();
      queueRender();
    }
  });
  const gmSceneRefresh = () => {
    if (game.user?.isGM && gmSceneStateFingerprints.size > 0) sendSceneStateDebounced();
  };
  const gmEffectSceneRefresh = (effect) => {
    if (!game.user?.isGM || gmSceneStateFingerprints.size <= 0) return;
    const actorId = String(effect?.parent?.id ?? effect?.actor?.id ?? "");
    const scene = getSceneDoc();
    if (!actorId || !asArray(scene?.tokens).some((token) => String(token.actor?.id ?? token.actorId ?? "") === actorId)) return;
    sendSceneStateDebounced();
  };
  Hooks.on("canvasReady", gmSceneRefresh);
  Hooks.on("createToken", gmSceneRefresh);
  Hooks.on("updateToken", gmSceneRefresh);
  Hooks.on("deleteToken", gmSceneRefresh);
  Hooks.on("updateScene", gmSceneRefresh);
  Hooks.on("createCombat", gmSceneRefresh);
  Hooks.on("updateCombat", gmSceneRefresh);
  Hooks.on("deleteCombat", gmSceneRefresh);
  Hooks.on("combatStart", gmSceneRefresh);
  Hooks.on("combatEnd", gmSceneRefresh);
  Hooks.on("createActiveEffect", gmEffectSceneRefresh);
  Hooks.on("updateActiveEffect", gmEffectSceneRefresh);
  Hooks.on("deleteActiveEffect", gmEffectSceneRefresh);
  Hooks.on("renderImagePopout", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalPageSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalTextPageSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalImagePageSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalEntrySheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalEntryPageSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalEntryPageTextSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderJournalEntryPageImageSheet", handleSharedDocumentPopupRender);
  Hooks.on("renderApplicationV2", handleSharedDocumentPopupRender);
  Hooks.on("renderTokenHUD", bindTokenHudTargetToggle);
}

registerHooks();
