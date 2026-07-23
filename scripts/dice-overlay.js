import { capitalizeWords, escapeHtml, signedMod } from "./utils.js";

const MODULE_ID = "player-pilot";
const ROLL_REQUEST_TYPES = new Set(["useItem", "rollCheck", "formulaRoll", "dnd5eAutoRoll", "pf2eStrike", "pf2eItemRoll"]);
const themes = new Map();
const pending = new Map();

let getActorId = () => "";
let removeTimer = null;

function registerBuiltInThemes() {
  registerDiceTheme("classic", { label: "Classic", className: "pp-dice-theme-classic" });
  registerDiceTheme("arcane", { label: "Arcane Glow", className: "pp-dice-theme-arcane" });
  registerDiceTheme("hologram", { label: "Hologram", className: "pp-dice-theme-hologram" });
}

export function registerDiceSettings() {
  game.settings.register(MODULE_ID, "diceAnimationMode", {
    scope: "client",
    config: false,
    type: String,
    default: "automatic"
  });
  game.settings.register(MODULE_ID, "diceTheme", {
    scope: "client",
    config: false,
    type: String,
    default: "classic"
  });
  game.settings.register(MODULE_ID, "diceColor", {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
}

export function configureDiceOverlay(options = {}) {
  getActorId = typeof options.getActorId === "function" ? options.getActorId : getActorId;
  if (!themes.size) registerBuiltInThemes();
}

export function registerDiceTheme(id, definition = {}) {
  const key = String(id ?? "").trim().toLowerCase();
  if (!key) throw new Error("A Player Pilot dice theme needs an id.");
  themes.set(key, {
    label: String(definition.label ?? capitalizeWords(key)),
    className: String(definition.className ?? ""),
    image: definition.image ?? "",
    renderDie: typeof definition.renderDie === "function" ? definition.renderDie : null
  });
}

function configuredMode() {
  return String(game.settings.get(MODULE_ID, "diceAnimationMode") ?? "automatic");
}

function useLightweightDice() {
  const mode = configuredMode();
  if (mode === "off") return false;
  if (mode === "lightweight") return true;
  return !game.dice3d;
}

function diceOverlayEnabled() {
  return configuredMode() !== "off";
}

function normalizedHex(value) {
  const text = String(value?.css ?? value ?? "").trim();
  const short = text.match(/^#([0-9a-f]{3})$/i);
  if (short) return `#${short[1].split("").map((part) => `${part}${part}`).join("")}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : "";
}

function playerDiceColor() {
  return normalizedHex(game.settings.get(MODULE_ID, "diceColor"))
    || normalizedHex(game.user?.color)
    || "#62c7b2";
}

function contrastColor(hex) {
  const color = normalizedHex(hex) || "#62c7b2";
  const values = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255);
  const linear = values.map((part) => part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  return luminance > 0.42 ? "#071017" : "#fffdf7";
}

function currentTheme() {
  if (!themes.size) registerBuiltInThemes();
  const id = String(game.settings.get(MODULE_ID, "diceTheme") ?? "classic");
  return { id: themes.has(id) ? id : "classic", ...(themes.get(id) ?? themes.get("classic")) };
}

function requestLabel(type, payload = {}) {
  if (payload.rollLabel) return String(payload.rollLabel);
  if (payload.label) return String(payload.label);
  if (type === "rollCheck") return `Rolling ${capitalizeWords(payload.key || payload.kind || "check")}`;
  if (type === "pf2eStrike") return `${capitalizeWords(payload.operation || "attack")} roll`;
  if (type === "pf2eItemRoll") return `${capitalizeWords(payload.nativeAction || "item")} roll`;
  return type === "useItem" ? "Resolving action" : "Rolling";
}

function pendingSides(type, payload = {}) {
  const formula = String(payload.formula ?? "");
  const parsed = Array.from(formula.matchAll(/(\d*)d(\d+)/gi)).flatMap((match) => {
    const count = Math.min(6, Math.max(1, Number(match[1] || 1)));
    return Array.from({ length: count }, () => Number(match[2]));
  });
  if (parsed.length) return parsed.slice(0, 6);
  if (type === "pf2eStrike" && ["damage", "critical"].includes(String(payload.operation))) return [12, 8, 6];
  return [20];
}

const polyhedronMarkupCache = new Map();

function subtractVector(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dotVector(left, right) {
  return left.reduce((total, value, index) => total + (value * right[index]), 0);
}

function crossVector(left, right) {
  return [
    (left[1] * right[2]) - (left[2] * right[1]),
    (left[2] * right[0]) - (left[0] * right[2]),
    (left[0] * right[1]) - (left[1] * right[0])
  ];
}

function normalizeVector(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-8 ? vector.map((value) => value / length) : [0, 0, 0];
}

function orientPolyhedron(vertices, faces, { direction = null, face = 0, up = [0, 1, 0] } = {}) {
  const faceIndices = faces[face] ?? faces[0];
  const faceDirection = normalizeVector(crossVector(
    subtractVector(vertices[faceIndices[1]], vertices[faceIndices[0]]),
    subtractVector(vertices[faceIndices[2]], vertices[faceIndices[0]])
  ));
  const front = normalizeVector(direction ?? faceDirection);
  const right = normalizeVector(crossVector(up, front));
  const correctedUp = crossVector(front, right);
  return vertices.map((vertex) => [
    dotVector(vertex, right),
    dotVector(vertex, correctedUp),
    dotVector(vertex, front)
  ]);
}

function convexPolyhedronFaces(vertices) {
  const epsilon = 1e-6;
  const seen = new Set();
  const faces = [];
  for (let first = 0; first < vertices.length - 2; first += 1) {
    for (let second = first + 1; second < vertices.length - 1; second += 1) {
      for (let third = second + 1; third < vertices.length; third += 1) {
        let normal = normalizeVector(crossVector(
          subtractVector(vertices[second], vertices[first]),
          subtractVector(vertices[third], vertices[first])
        ));
        if (!normal.some((value) => Math.abs(value) > epsilon)) continue;
        const distances = vertices.map((vertex) => dotVector(normal, subtractVector(vertex, vertices[first])));
        const hasPositive = distances.some((distance) => distance > epsilon);
        const hasNegative = distances.some((distance) => distance < -epsilon);
        if (hasPositive && hasNegative) continue;
        const indices = distances
          .map((distance, index) => Math.abs(distance) <= epsilon ? index : -1)
          .filter((index) => index >= 0);
        const key = [...indices].sort((left, right) => left - right).join(",");
        if (indices.length < 3 || seen.has(key)) continue;
        seen.add(key);
        if (hasPositive) normal = normal.map((value) => -value);
        const center = indices.reduce(
          (total, index) => total.map((value, axis) => value + vertices[index][axis]),
          [0, 0, 0]
        ).map((value) => value / indices.length);
        const reference = normalizeVector(subtractVector(vertices[indices[0]], center));
        const tangent = crossVector(normal, reference);
        indices.sort((left, right) => {
          const leftOffset = subtractVector(vertices[left], center);
          const rightOffset = subtractVector(vertices[right], center);
          const leftAngle = Math.atan2(dotVector(leftOffset, tangent), dotVector(leftOffset, reference));
          const rightAngle = Math.atan2(dotVector(rightOffset, tangent), dotVector(rightOffset, reference));
          return leftAngle - rightAngle;
        });
        faces.push(indices);
      }
    }
  }
  return faces;
}

function polyhedronDefinition(sides) {
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  if (sides === 10) {
    const cosine = Math.cos(Math.PI / 5);
    const heightRatio = (1 + cosine) / (1 - cosine);
    const ringHeight = 1 / Math.sqrt((heightRatio ** 2) - 1);
    const apexHeight = heightRatio * ringHeight;
    const vertices = [[0, 0, apexHeight], [0, 0, -apexHeight]];
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI / 5;
      vertices.push([Math.cos(angle), Math.sin(angle), index % 2 === 0 ? ringHeight : -ringHeight]);
    }
    return {
      vertices,
      view: { direction: [Math.cos((3 * Math.PI) / 5), Math.sin((3 * Math.PI) / 5), 0], up: [0, 0, 1] }
    };
  }
  if (sides === 12) {
    const inverseGoldenRatio = 1 / goldenRatio;
    const vertices = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push([x, y, z]);
    for (const y of [-goldenRatio, goldenRatio]) for (const z of [-inverseGoldenRatio, inverseGoldenRatio]) vertices.push([0, y, z]);
    for (const x of [-inverseGoldenRatio, inverseGoldenRatio]) for (const z of [-goldenRatio, goldenRatio]) vertices.push([x, 0, z]);
    for (const x of [-goldenRatio, goldenRatio]) for (const y of [-inverseGoldenRatio, inverseGoldenRatio]) vertices.push([x, y, 0]);
    return { vertices, view: { face: 0, up: [0, 0, 1] } };
  }
  const vertices = [];
  for (const y of [-1, 1]) for (const z of [-goldenRatio, goldenRatio]) vertices.push([0, y, z]);
  for (const x of [-1, 1]) for (const y of [-goldenRatio, goldenRatio]) vertices.push([x, y, 0]);
  for (const x of [-goldenRatio, goldenRatio]) for (const z of [-1, 1]) vertices.push([x, 0, z]);
  return { vertices, view: { face: 0, up: [0, 1, 0] } };
}

function polyhedronDieMarkup(sides) {
  if (polyhedronMarkupCache.has(sides)) return polyhedronMarkupCache.get(sides);
  const { vertices, view } = polyhedronDefinition(sides);
  const faces = convexPolyhedronFaces(vertices);
  const rotated = orientPolyhedron(vertices, faces, view);
  const minimumX = Math.min(...rotated.map((vertex) => vertex[0]));
  const maximumX = Math.max(...rotated.map((vertex) => vertex[0]));
  const minimumY = Math.min(...rotated.map((vertex) => vertex[1]));
  const maximumY = Math.max(...rotated.map((vertex) => vertex[1]));
  const scale = 92 / Math.max(maximumX - minimumX, maximumY - minimumY);
  const middleX = (minimumX + maximumX) / 2;
  const middleY = (minimumY + maximumY) / 2;
  const lightDirection = normalizeVector([-0.55, -0.7, 1]);
  const visibleFaces = faces.map((indices) => {
    const normal = normalizeVector(crossVector(
      subtractVector(rotated[indices[1]], rotated[indices[0]]),
      subtractVector(rotated[indices[2]], rotated[indices[0]])
    ));
    const depth = indices.reduce((total, index) => total + rotated[index][2], 0) / indices.length;
    return { indices, normal, depth };
  }).filter((face) => face.normal[2] > 1e-6).sort((left, right) => left.depth - right.depth);
  const facetClasses = ["deep", "dark", "mid", "light"];
  const markup = visibleFaces.map((face) => {
    const brightness = Math.max(0, dotVector(face.normal, lightDirection));
    const facetClass = facetClasses[Math.min(3, Math.floor(brightness * 4))];
    const points = face.indices.map((index) => {
      const [x, y] = rotated[index];
      return `${(50 + ((x - middleX) * scale)).toFixed(2)},${(50 - ((y - middleY) * scale)).toFixed(2)}`;
    }).join(" ");
    return `<polygon class="pp-die-face-${facetClass}" points="${points}"/>`;
  }).join("");
  polyhedronMarkupCache.set(sides, markup);
  return markup;
}

function dieShapeMarkup(sides) {
  const shape = Number(sides) === 100 ? 10 : Number(sides);
  const faces = {
    2: `
      <circle class="pp-die-face-base" cx="50" cy="50" r="45"/>
      <path class="pp-die-face-light" d="M50 5a45 45 0 0 0 0 90c-13-18-13-72 0-90Z"/>
      <path class="pp-die-face-dark" d="M50 5a45 45 0 0 1 0 90c13-18 13-72 0-90Z"/>`,
    3: `
      <polygon class="pp-die-face-base" points="50,4 96,91 4,91"/>
      <polygon class="pp-die-face-light" points="50,4 50,61 4,91"/>
      <polygon class="pp-die-face-mid" points="50,4 96,91 50,61"/>
      <polygon class="pp-die-face-dark" points="4,91 50,61 96,91"/>`,
    4: `
      <polygon class="pp-die-face-base" points="50,4 96,91 4,91"/>
      <polygon class="pp-die-face-light" points="50,4 50,61 4,91"/>
      <polygon class="pp-die-face-mid" points="50,4 96,91 50,61"/>
      <polygon class="pp-die-face-dark" points="4,91 50,61 96,91"/>`,
    6: `
      <polygon class="pp-die-face-base" points="50,3 93,27 93,75 50,98 7,75 7,27"/>
      <polygon class="pp-die-face-light" points="50,3 93,27 50,51 7,27"/>
      <polygon class="pp-die-face-mid" points="7,27 50,51 50,98 7,75"/>
      <polygon class="pp-die-face-dark" points="50,51 93,27 93,75 50,98"/>`,
    8: `
      <polygon class="pp-die-face-base" points="50,2 95,50 50,98 5,50"/>
      <polygon class="pp-die-face-light" points="50,2 50,52 5,50"/>
      <polygon class="pp-die-face-mid" points="50,2 95,50 50,52"/>
      <polygon class="pp-die-face-dark" points="5,50 50,52 50,98"/>
      <polygon class="pp-die-face-deep" points="50,52 95,50 50,98"/>`
  };
  const vertexCount = Math.min(12, Math.max(5, Number.isFinite(shape) ? shape : 8));
  const points = Array.from({ length: vertexCount }, (_, index) => {
    const angle = ((index / vertexCount) * Math.PI * 2) - (Math.PI / 2);
    return `${50 + (47 * Math.cos(angle))},${50 + (47 * Math.sin(angle))}`;
  });
  const facetClasses = ["light", "mid", "dark", "deep"];
  const generic = `
    <polygon class="pp-die-face-base" points="${points.join(" ")}"/>
    ${points.map((point, index) => `<polygon class="pp-die-face-${facetClasses[index % facetClasses.length]}" points="50,50 ${point} ${points[(index + 1) % points.length]}"/>`).join("")}`;
  const markup = [10, 12, 20].includes(shape) ? polyhedronDieMarkup(shape) : (faces[shape] ?? generic);
  return `<svg class="pp-die-art" viewBox="0 0 100 100" focusable="false" aria-hidden="true">${markup}</svg>`;
}

function makeDie({ sides = 20, value = "?", index = 0 } = {}) {
  const theme = currentTheme();
  const context = { sides, value, index, color: playerDiceColor(), contrast: contrastColor(playerDiceColor()) };
  const custom = theme.renderDie?.(context);
  if (custom instanceof HTMLElement) {
    custom.classList.add("pp-showcase-die");
    custom.dataset.sides ??= String(sides || 20);
    custom.style.setProperty("--pp-die-delay", `${index * -0.14}s`);
    return custom;
  }
  const die = document.createElement("div");
  die.className = "pp-showcase-die";
  die.dataset.sides = String(sides || 20);
  die.dataset.shape = String(Number(sides) === 100 ? 10 : Number(sides) || "custom");
  die.style.setProperty("--pp-die-delay", `${index * -0.14}s`);
  if (theme.image) {
    die.classList.add("pp-die-has-image");
    die.style.setProperty("--pp-die-image", `url("${String(theme.image).replace(/["\\\n\r]/g, "")}")`);
  }
  die.innerHTML = `<div class="pp-die-tumbler">${dieShapeMarkup(sides)}<span>${escapeHtml(value)}</span><small>d${escapeHtml(sides || 20)}</small></div>`;
  return die;
}

function overlayElement() {
  return document.querySelector(".pp-dice-overlay");
}

function dismissOverlay(overlay, removeDelay = 550) {
  if (!(overlay instanceof HTMLElement) || overlay.classList.contains("pp-dice-leaving")) return;
  removeTimer && window.clearTimeout(removeTimer);
  overlay.classList.add("pp-dice-leaving");
  removeTimer = window.setTimeout(() => {
    overlay.remove();
    removeTimer = null;
  }, removeDelay);
}

function buildOverlay(request) {
  removeTimer && window.clearTimeout(removeTimer);
  removeTimer = null;
  overlayElement()?.remove();
  const color = playerDiceColor();
  const theme = currentTheme();
  const overlay = document.createElement("section");
  overlay.className = `pp-dice-overlay pp-dice-rolling ${theme.className}`.trim();
  overlay.dataset.requestId = request.id;
  overlay.style.setProperty("--pp-dice-color", color);
  overlay.style.setProperty("--pp-dice-contrast", contrastColor(color));
  overlay.innerHTML = `
    <div class="pp-dice-backdrop"></div>
    <div class="pp-dice-presentation">
      <div class="pp-dice-kicker">PLAYER PILOT</div>
      <div class="pp-dice-title">${escapeHtml(request.label)}</div>
      <div class="pp-dice-tray" aria-hidden="true"></div>
      <div class="pp-dice-wait"><i class="fas fa-satellite-dish"></i><span>Waiting for GM</span><b aria-hidden="true"><i>.</i><i>.</i><i>.</i></b></div>
      <div class="pp-dice-results" aria-live="assertive"></div>
    </div>`;
  const blockOverlayInput = (event) => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    if (["pointerup", "touchend", "click"].includes(event.type) && overlay.classList.contains("pp-dice-settled")) {
      dismissOverlay(overlay);
    }
  };
  for (const eventName of ["pointerdown", "pointerup", "click", "dblclick", "contextmenu", "touchstart", "touchend", "wheel"]) {
    overlay.addEventListener(eventName, blockOverlayInput, { capture: true, passive: false });
  }
  const tray = overlay.querySelector(".pp-dice-tray");
  request.sides.forEach((sides, index) => tray.append(makeDie({ sides, index })));
  document.body.appendChild(overlay);
  return overlay;
}

export function prepareRollSocket(type, payload = {}) {
  if (!ROLL_REQUEST_TYPES.has(type) || game.user?.isGM) return payload;
  const requestId = String(payload.requestId ?? foundry.utils.randomID());
  const next = { ...payload, requestId };
  if (!diceOverlayEnabled()) return next;
  const request = {
    id: requestId,
    type,
    actorId: String(payload.actorId ?? getActorId() ?? ""),
    label: requestLabel(type, payload),
    sides: pendingSides(type, payload),
    rolls: [],
    resolved: false,
    startedAt: Date.now(),
    settleTimer: null
  };
  pending.set(requestId, request);
  buildOverlay(request);
  return next;
}

function activeDieResults(die) {
  return Array.from(die?.results ?? [])
    .filter((result) => result.active !== false && result.discarded !== true)
    .map((result) => Number(result.result ?? result.value))
    .filter(Number.isFinite);
}

function collectDiceTerms(roll) {
  const dice = [];
  const seen = new WeakSet();
  const visit = (value, depth = 0) => {
    if (!value || depth > 5) return;
    if (Array.isArray(value) || (typeof value !== "string" && typeof value?.[Symbol.iterator] === "function")) {
      for (const entry of Array.from(value)) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const faces = Number(value.faces);
    if (Number.isFinite(faces) && faces >= 2) {
      dice.push(value);
      return;
    }
    for (const key of ["dice", "terms", "rolls", "roll", "result"]) visit(value[key], depth + 1);
  };
  visit(roll?.dice);
  visit(roll?.terms);
  return dice;
}

function formulaDice(formula = "") {
  return Array.from(String(formula).matchAll(/(\d*)d(\d+)/gi)).map((match) => ({
    faces: Number(match[2]),
    count: Math.min(20, Math.max(1, Number(match[1] || 1))),
    results: []
  })).filter((die) => Number.isFinite(die.faces) && die.faces >= 2);
}

function formulaFlatModifier(formula = "") {
  let modifier = 0;
  for (const match of String(formula).matchAll(/([+-])\s*(\d+(?:\.\d+)?)(?!\s*[dD])/g)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) modifier += match[1] === "-" ? -value : value;
  }
  return modifier;
}

export function summarizeRoll(roll) {
  if (!roll || !Number.isFinite(Number(roll.total))) return null;
  const formula = String(roll.formula ?? roll._formula ?? "");
  let dice = collectDiceTerms(roll).map((die) => {
    const results = activeDieResults(die);
    return {
      faces: Number(die.faces),
      count: Math.max(1, Number(die.number ?? die.count ?? results.length ?? 1)),
      results
    };
  });
  if (!dice.length) dice = formulaDice(formula);
  const total = Number(roll.total);
  const resultsComplete = dice.length > 0 && dice.every((die) => die.results.length >= die.count);
  const modifier = dice.length ? (resultsComplete
    ? total - dice.reduce((sum, die) => sum + die.results.reduce((part, result) => part + result, 0), 0)
    : formulaFlatModifier(formula)) : null;
  if (dice.length === 1 && dice[0].count === 1 && !dice[0].results.length && Number.isFinite(modifier)) {
    const inferred = total - modifier;
    if (Number.isFinite(inferred) && inferred >= 1 && inferred <= dice[0].faces) dice[0].results = [inferred];
  }
  const dieTotal = dice.reduce((sum, die) => sum + die.results.reduce((part, result) => part + result, 0), 0);
  return {
    total,
    formula,
    dice,
    dieTotal,
    modifier: Number.isFinite(modifier) ? modifier : null
  };
}

export function rollSummariesFrom(source, depth = 0, seen = new WeakSet()) {
  if (!source || depth > 4) return [];
  if (typeof source === "object") {
    if (seen.has(source)) return [];
    seen.add(source);
  }
  if (Array.isArray(source)) return source.flatMap((entry) => rollSummariesFrom(entry, depth + 1, seen));
  if (Number.isFinite(Number(source.total)) && (source.formula || source._formula || source.dice || source.terms)) {
    return [summarizeRoll(source)].filter(Boolean);
  }
  const candidates = [source.rolls, source.roll, source.message, source.result].filter(Boolean);
  return candidates.flatMap((entry) => rollSummariesFrom(entry, depth + 1, seen));
}

function normalizedSummaries(source) {
  if (!Array.isArray(source)) return [];
  return source.map((summary) => ({
    total: Number(summary.total),
    formula: String(summary.formula ?? ""),
    dice: Array.from(summary.dice ?? []).map((die) => ({
      faces: Number(die.faces),
      count: Math.max(1, Number(die.count ?? die.results?.length ?? 1)),
      results: Array.from(die.results ?? []).map(Number).filter(Number.isFinite)
    })).filter((die) => Number.isFinite(die.faces) && die.faces >= 2),
    dieTotal: Number(summary.dieTotal ?? 0),
    modifier: summary.modifier === null || summary.modifier === undefined ? null : Number(summary.modifier)
  })).filter((summary) => Number.isFinite(summary.total));
}

function resultDice(summaries) {
  return summaries.flatMap((summary) => summary.dice.flatMap((die) => {
    if (die.results.length) return die.results.map((value) => ({ faces: die.faces, value }));
    return Array.from({ length: Math.max(1, Number(die.count ?? 1)) }, () => ({ faces: die.faces, value: "?" }));
  })).slice(0, 8);
}

function refreshPendingDice(request) {
  const dice = resultDice(request.rolls);
  if (!dice.length) return;
  request.sides = dice.map((die) => die.faces);
  const overlay = overlayElement();
  if (!overlay || overlay.dataset.requestId !== request.id || !overlay.classList.contains("pp-dice-rolling")) return;
  const tray = overlay.querySelector(".pp-dice-tray");
  tray?.replaceChildren(...dice.map((die, index) => makeDie({ sides: die.faces, value: "?", index })));
}

function resultMarkup(summary, index) {
  const hasModifier = Number.isFinite(summary.modifier) && summary.modifier !== 0;
  const hasDice = summary.dice.some((die) => die.results.length);
  const breakdown = hasDice
    ? `<span><b>Dice ${escapeHtml(summary.dieTotal)}</b>${hasModifier ? `<i>${escapeHtml(signedMod(summary.modifier))} modifier</i>` : ""}</span>`
    : (summary.formula ? `<span><b>${escapeHtml(summary.formula)}</b></span>` : "");
  return `
    <article class="pp-dice-result-card" style="--pp-result-delay:${index * 90}ms">
      <small>FINAL RESULT${index ? ` ${index + 1}` : ""}</small>
      <strong>${escapeHtml(summary.total)}</strong>
      ${breakdown}
      ${summary.formula ? `<em>${escapeHtml(summary.formula)}</em>` : ""}
    </article>`;
}

function settleRequest(request, { failed = false } = {}) {
  const overlay = overlayElement() ?? buildOverlay(request);
  if (overlay.dataset.requestId !== request.id) return;
  if (!request.rolls.length && !failed) {
    pending.delete(request.id);
    overlay.classList.remove("pp-dice-rolling");
    dismissOverlay(overlay, 350);
    return;
  }
  overlay.classList.remove("pp-dice-rolling");
  overlay.classList.add("pp-dice-settled");
  overlay.classList.toggle("pp-dice-failed", failed);
  const tray = overlay.querySelector(".pp-dice-tray");
  const dice = resultDice(request.rolls);
  tray.replaceChildren();
  if (dice.length) {
    dice.forEach((die, index) => tray.append(makeDie({ sides: die.faces, value: die.value, index })));
  } else if (failed) {
    tray.append(makeDie({ sides: request.sides[0] ?? 20, value: "×", index: 0 }));
  }
  const results = overlay.querySelector(".pp-dice-results");
  results.innerHTML = request.rolls.length
    ? request.rolls.map(resultMarkup).join("")
    : (failed ? `<article class="pp-dice-result-card"><small>FAILED</small><strong>×</strong><span><b>${escapeHtml(request.label)}</b></span></article>` : "");
  pending.delete(request.id);
  removeTimer = window.setTimeout(
    () => dismissOverlay(overlay),
    failed ? 4500 : (request.rolls.length ? 6200 : 1000)
  );
}

function scheduleSettle(request, options = {}) {
  request.settleTimer && window.clearTimeout(request.settleTimer);
  request.settleTimer = window.setTimeout(() => settleRequest(request, options), request.rolls.length ? 180 : 900);
}

export function resolveDiceRequest(data = {}) {
  const requestId = String(data.requestId ?? "");
  if (!requestId) return;
  const request = pending.get(requestId);
  if (!request) return;
  const summaries = normalizedSummaries(data.rolls);
  if (summaries.length) {
    request.rolls = summaries;
    refreshPendingDice(request);
  }
  request.resolved = true;
  scheduleSettle(request, { failed: data.failed === true || /failed/i.test(String(data.message ?? "")) });
}

export function showDiceResult({ label = "Roll", total, formula = "", dice = [], modifier = null } = {}) {
  if (!diceOverlayEnabled() || !Number.isFinite(Number(total))) return;
  const normalizedDice = Array.from(dice).map((die) => ({
    faces: Number(die.faces ?? 20),
    results: Array.from(die.results ?? []).map(Number).filter(Number.isFinite)
  })).filter((die) => die.results.length);
  const dieTotal = normalizedDice.reduce((sum, die) => sum + die.results.reduce((part, value) => part + value, 0), 0);
  const request = {
    id: `local-${foundry.utils.randomID()}`,
    label: String(label),
    sides: normalizedDice.map((die) => die.faces).slice(0, 6).length ? normalizedDice.map((die) => die.faces).slice(0, 6) : [20],
    rolls: [{
      total: Number(total),
      formula: String(formula),
      dice: normalizedDice,
      dieTotal,
      modifier: modifier === null || modifier === undefined ? null : (Number.isFinite(Number(modifier)) ? Number(modifier) : null)
    }],
    resolved: true
  };
  buildOverlay(request);
  window.setTimeout(() => settleRequest(request), 650);
}

export function captureDiceRollMessage(message) {
  if (!diceOverlayEnabled() || !message?.rolls?.length || message.isContentVisible === false) return;
  const summaries = rollSummariesFrom(message.rolls);
  if (!summaries.length) return;
  const flaggedId = String(message.getFlag?.(MODULE_ID, "rollRequestId") ?? "");
  let request = flaggedId ? pending.get(flaggedId) : null;
  if (!request) {
    const actorId = String(message.speaker?.actor ?? "");
    request = Array.from(pending.values()).reverse().find((candidate) => !actorId || candidate.actorId === actorId) ?? null;
  }
  if (request) {
    request.rolls = summaries;
    refreshPendingDice(request);
    if (request.resolved) scheduleSettle(request);
    return;
  }
  if (!useLightweightDice()) return;
  const actorId = String(message.speaker?.actor ?? "");
  if (actorId && actorId !== String(getActorId() ?? "")) return;
  const localRequest = {
    id: `message-${message.id ?? foundry.utils.randomID()}`,
    label: String(message.flavor ?? message.alias ?? "Roll"),
    actorId,
    sides: resultDice(summaries).map((die) => die.faces).slice(0, 6),
    rolls: summaries,
    resolved: true
  };
  buildOverlay(localRequest);
  window.setTimeout(() => settleRequest(localRequest), 650);
}

export function diceViewContext() {
  const mode = configuredMode();
  const selectedTheme = currentTheme().id;
  const explicitColor = normalizedHex(game.settings.get(MODULE_ID, "diceColor"));
  const color = explicitColor || playerDiceColor();
  return {
    diceMode: mode,
    diceColor: color,
    dicePlayerColor: normalizedHex(game.user?.color) || "#62c7b2",
    diceUsesPlayerColor: !explicitColor,
    diceThemes: Array.from(themes.entries()).map(([id, theme]) => ({
      id,
      label: theme.label,
      selected: id === selectedTheme
    }))
  };
}

export async function saveDiceSettings(root) {
  const mode = String(root.querySelector("[name='diceAnimationMode']")?.value ?? "automatic");
  const theme = String(root.querySelector("[name='diceTheme']")?.value ?? "classic");
  const usePlayerColor = root.querySelector("[name='usePlayerColor']")?.checked === true;
  const color = usePlayerColor ? "" : normalizedHex(root.querySelector("[name='diceColor']")?.value);
  await Promise.all([
    game.settings.set(MODULE_ID, "diceAnimationMode", mode),
    game.settings.set(MODULE_ID, "diceTheme", themes.has(theme) ? theme : "classic"),
    game.settings.set(MODULE_ID, "diceColor", color)
  ]);
}

export function previewDiceTheme() {
  if (!diceOverlayEnabled()) {
    ui.notifications?.info?.("Dice animation is currently off.");
    return;
  }
  const dice = [
    { faces: 4, results: [3] },
    { faces: 6, results: [4] },
    { faces: 8, results: [7] },
    { faces: 10, results: [8] },
    { faces: 12, results: [10] },
    { faces: 20, results: [16] }
  ];
  const dieTotal = dice.reduce((sum, die) => sum + die.results[0], 0);
  const request = {
    id: `preview-${foundry.utils.randomID()}`,
    label: "Dice Preview",
    sides: dice.map((die) => die.faces),
    rolls: [],
    resolved: false
  };
  buildOverlay(request);
  window.setTimeout(() => {
    request.rolls = [{ total: dieTotal, formula: "d4 + d6 + d8 + d10 + d12 + d20", dice, dieTotal, modifier: 0 }];
    settleRequest(request);
  }, 1800);
}

export function exposeDiceApi() {
  game.playerPilot.dice = {
    registerTheme: registerDiceTheme,
    themes
  };
  Hooks.callAll("playerPilotRegisterDiceThemes", game.playerPilot.dice);
}

export function clearDiceOverlay() {
  removeTimer && window.clearTimeout(removeTimer);
  removeTimer = null;
  for (const request of pending.values()) request.settleTimer && window.clearTimeout(request.settleTimer);
  pending.clear();
  overlayElement()?.remove();
}
