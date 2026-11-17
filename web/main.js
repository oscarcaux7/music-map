// The page: load the data from my server, draw it, react to the pointer.

import { aggregate, fetchMap, LoadError } from "./data.js";
import { layout } from "./layout.js";
import { Scene } from "./scene.js";
import * as ui from "./ui.js";
import { wrap, duration, MINUTES_PER_PLAY } from "./stats.js";

const REFRESH_MS = 60_000;  // the server's cache decides when Last.fm is really asked
const canvas = document.getElementById("map");
const scene = new Scene(canvas);
scene.onImage = () => { state.dirty = true; };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  data: null,            // last answer of /api/map
  receivedAt: 0,
  range: "week",
  L: null,               // current layout
  pinned: null,          // a node or the sphere, fixed by a click or a tap
  lastInteraction: performance.now(),
  dirty: true,
};

// ---------- loading ----------

async function load() {
  try {
    const data = await fetchMap();
    state.data = data;
    state.receivedAt = Date.now();
    rebuild();
    ui.renderStatus(data, state.receivedAt);
    // Styles of new artists may still be on their way: ask again soon, a few times.
    const pending = data.tags_pending > 0 || data.similar_pending > 0;
    state.quickTries = pending ? (state.quickTries || 0) + 1 : 0;
    schedule(pending && state.quickTries <= 3 ? 6000 : REFRESH_MS);
  } catch (error) {
    const e = error instanceof LoadError ? error : new LoadError("network", String(error));
    handleError(e);
    schedule(e.retryIn * 1000);
  }
}

let timer = null;
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(load, ms);
}

function handleError(error) {
  if (state.data) {
    // We already have a map: keep it, and say that it is not fresh.
    ui.setStatusText(`${error.message} The map shows the last plays received.`, true);
    return;
  }
  const title = error.kind === "lastfm" ? "Last.fm does not answer" : "The server does not answer";
  ui.showMessage(title, `${error.message} Trying again in ${error.retryIn} seconds.`, {
    label: "Try again now",
    run: () => { ui.setStatusText("Trying again…"); load(); },
  });
  ui.setStatusText(title + ".", true);
  scene.setLayout(emptyLayout());
  state.dirty = true;
}

function emptyLayout() {
  const now = Math.floor(Date.now() / 1000);
  const agg = aggregate({ now, scrobbles: [], artists: [], families: [], now_playing: null }, state.range);
  return layout(agg);
}

function rebuild() {
  if (!state.data) return;
  const agg = aggregate(state.data, state.range);
  state.L = layout(agg);
  scene.setLayout(state.L);
  renderKey();
  if (scene.focusFamily && !state.L.sectorOf.has(scene.focusFamily)) scene.focusFamily = null;
  if (state.pinned?.type === "node") {
    const node = state.L.nodeOf.get(state.pinned.node.artist.id);
    state.pinned = node ? { type: "node", node } : null;
    if (!node) ui.hideCard();
  }
  scene.hovered = state.pinned;
  ui.renderLegend(state.L, scene.focusFamily, toggleFamily);
  ui.renderTape(state.L, pointArtist);
  ui.renderTable(state.L);
  ui.renderWrapped(wrap(agg), RANGE_TITLES[state.range], MINUTES_PER_PLAY, duration);

  if (!agg.scrobbles.length) {
    const wider = state.range !== "all";
    ui.showMessage(
      "No plays in this period yet",
      "Play a song: it appears at the top of the spiral, then moves down as time goes by.",
      wider ? { label: "See all plays", run: () => setRange("all") } : null,
    );
  } else {
    ui.hideMessage();
  }
  state.dirty = true;
}

// ---------- controls ----------

const RANGE_TITLES = {
  h3: "The last 3 hours",
  day: "The last 24 hours",
  week: "The last 7 days",
  all: "All my plays",
};

function setRange(range) {
  state.range = range;
  document.getElementById("title-range").textContent = RANGE_TITLES[range];
  for (const b of document.querySelectorAll("[data-range]")) {
    b.setAttribute("aria-pressed", String(b.dataset.range === range));
  }
  rebuild();
}

document.querySelectorAll("[data-range]").forEach((b) =>
  b.addEventListener("click", () => setRange(b.dataset.range)));

const KEYS = {
  spiral: () => `A spiral of time, from now (the top end) down to my first play of the period: one turn = ${scene.turnText()}. Each cover is a play, sitting on the ribbon; a hairline points to its exact time when covers had to make room. The grey threads join plays that share an artist, a style or tags.`,
  sphere: () => "A network in a globe: now in the centre, then the styles, my artists, and around each artist a starburst of its songs, tags and similar artists. White bridges are tags or similar artists shared by several of my artists; green arcs join two artists I play that sound alike. Click an artist to fly to it.",
};

function renderKey() {
  const view = document.body.dataset.view || "spiral";
  document.getElementById("key").textContent = KEYS[view]?.() || "";
}

function setView(view) {
  scene.setMode(view);
  state.pinned = null;
  ui.hideCard();
  for (const b of document.querySelectorAll("[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  document.body.dataset.view = view;
  const stage = document.getElementById("stage");
  stage.classList.toggle("is-spiral", view === "spiral");
  stage.classList.toggle("is-sphere", view === "sphere");
  renderKey();
  document.getElementById("hint").textContent = view === "sphere"
    ? "Drag to move · right-drag or Shift + drag to turn · Ctrl + wheel to zoom"
    : "Drag to move · right-drag or Shift + drag to turn · Ctrl + wheel to zoom";
  try { localStorage.setItem("view", view); } catch { /* private mode */ }
  state.dirty = true;
}

document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view)));

function toggleFamily(id) {
  scene.focusFamily = scene.focusFamily === id ? null : id;
  ui.renderLegend(state.L, scene.focusFamily, toggleFamily);
  state.dirty = true;
}

/** From the list of last songs: light up an artist on the map. */
function pointArtist(id, pin = false) {
  touch();
  if (!state.L) return;
  const node = id ? state.L.nodeOf.get(id) : null;
  if (!node) {
    if (!state.pinned) { scene.hovered = null; ui.hideCard(); }
    else scene.hovered = state.pinned;
    state.dirty = true;
    return;
  }
  const target = { type: "node", node };
  if (pin) state.pinned = target;
  scene.hovered = target;
  scene.draw(performance.now(), animated());
  ui.showCard(target, state.L, scene.screenOf(target), pin);
  state.dirty = true;
}

document.getElementById("card-close").addEventListener("click", () => {
  state.pinned = null;
  scene.hovered = null;
  ui.hideCard();
  state.dirty = true;
});

// ---------- pointer on the canvas: hover, tap, drag to turn ----------

let drag = null;

function local(event) {
  const box = canvas.getBoundingClientRect();
  return [event.clientX - box.left, event.clientY - box.top];
}

function touch() {
  state.lastInteraction = performance.now();
}

// Two fingers on the canvas: pinch to zoom.
const fingers = new Map();
let pinch = null;

function pinchState() {
  const [a, b] = [...fingers.values()];
  return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
}

canvas.addEventListener("pointerdown", (event) => {
  touch();
  scene.cam = null;   // the visitor takes the camera back
  if (event.pointerType === "touch") {
    fingers.set(event.pointerId, local(event));
    if (fingers.size === 2) {
      pinch = pinchState();
      drag = null;
      return;
    }
  }
  drag = {
    x: event.clientX, y: event.clientY, lx: event.clientX, ly: event.clientY,
    rot: scene.rot, moved: false, id: event.pointerId,
    // mouse: left button moves the view, in every direction (like a map);
    // right button, or Shift / Alt + drag, turns it. Touch: one finger turns, two fingers move and zoom.
    mouse: event.pointerType === "mouse",
    turn: event.pointerType !== "mouse" || event.button === 2 || event.shiftKey || event.altKey,
  };
});

canvas.addEventListener("pointermove", (event) => {
  touch();
  if (pinch && fingers.has(event.pointerId)) {
    fingers.set(event.pointerId, local(event));
    const now = pinchState();
    scene.zoomAt(now.d / Math.max(1, pinch.d), now.x, now.y);
    scene.panBy(now.x - pinch.x, now.y - pinch.y);
    pinch = now;
    viewChanged();
    return;
  }
  if (drag && drag.id === event.pointerId) {
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const enough = drag.mouse ? Math.hypot(dx, dy) > 5 : Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy);
    if (!drag.moved && enough) {
      drag.moved = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    }
    if (drag.moved) {
      const stepX = event.clientX - drag.lx;
      const stepY = event.clientY - drag.ly;
      drag.lx = event.clientX;
      drag.ly = event.clientY;
      if (drag.turn) scene.rot = drag.rot + dx * 0.008 / Math.sqrt(Math.max(1, scene.zoom));
      else scene.panBy(stepX, stepY);
      viewChanged();
      return;
    }
  }
  if (event.pointerType !== "mouse" || state.pinned) return;
  const [x, y] = local(event);
  const hit = scene.hitTest(x, y);
  canvas.classList.toggle("is-pointing", Boolean(hit));
  if (!sameTarget(hit, scene.hovered)) {
    scene.hovered = hit;
    state.dirty = true;
    if (hit && hit.type !== "sign") ui.showCard(hit, state.L, scene.screenOf(hit), false);
    else ui.hideCard();
  }
});

function endFinger(event) {
  fingers.delete(event.pointerId);
  if (fingers.size < 2) pinch = null;
}

canvas.addEventListener("pointerup", (event) => {
  const wasPinch = Boolean(pinch) || fingers.size > 1;
  endFinger(event);
  if (wasPinch) { drag = null; return; }
  const wasDrag = drag?.moved;
  drag = null;
  canvas.classList.remove("is-dragging");
  if (wasDrag) return;
  const [x, y] = local(event);
  const hit = scene.hitTest(x, y);
  if (hit?.type === "sign") {
    toggleFamily(hit.sign.sector.id);
    return;
  }
  if (hit && !sameTarget(hit, state.pinned)) {
    state.pinned = hit;
    scene.hovered = hit;
    // sphere: the camera flies to the artist
    if (scene.mode === "sphere" && hit.type === "node") scene.flyTo(hit.node.artist.id);
    ui.showCard(hit, state.L, scene.screenOf(hit), true);
  } else {
    state.pinned = null;
    scene.hovered = null;
    ui.hideCard();
  }
  state.dirty = true;
});

canvas.addEventListener("pointercancel", (event) => {
  endFinger(event);
  drag = null;
  canvas.classList.remove("is-dragging");
});

// ---------- zoom: Ctrl + wheel (or a trackpad pinch), double click, buttons, keys ----------

function viewChanged() {
  state.dirty = true;
  if (state.pinned) ui.showCard(state.pinned, state.L, scene.screenOf(state.pinned), true);
}

const zoomHint = document.getElementById("zoom-hint");
let zoomHintTimer = null;

canvas.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) {
    // a plain wheel still scrolls the page; say how to zoom
    zoomHint.hidden = false;
    clearTimeout(zoomHintTimer);
    zoomHintTimer = setTimeout(() => { zoomHint.hidden = true; }, 1400);
    return;
  }
  event.preventDefault();
  touch();
  zoomHint.hidden = true;
  const [x, y] = local(event);
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  scene.zoomAt(Math.exp(-delta * 0.0015), x, y);
  viewChanged();
}, { passive: false });

canvas.addEventListener("dblclick", (event) => {
  touch();
  const [x, y] = local(event);
  scene.zoomAt(event.shiftKey ? 0.5 : 2, x, y);
  viewChanged();
});

function zoomButton(id, run) {
  document.getElementById(id).addEventListener("click", () => { touch(); run(); viewChanged(); });
}
zoomButton("zoom-in", () => scene.zoomAt(1.5));
zoomButton("zoom-out", () => scene.zoomAt(1 / 1.5));
zoomButton("zoom-reset", () => scene.resetView());

document.getElementById("stretch").addEventListener("input", (event) => {
  touch();
  scene.stretchTarget = Number(event.target.value) / 100;
  state.dirty = true;
});
zoomButton("turn-left", () => { scene.rot -= 0.35; });
zoomButton("turn-right", () => { scene.rot += 0.35; });

// the right button turns the view: no context menu on the drawing
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerleave", () => {
  if (state.pinned || drag) return;
  scene.hovered = null;
  ui.hideCard();
  state.dirty = true;
});

canvas.addEventListener("keydown", (event) => {
  touch();
  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.shiftKey) {
    scene.rot += event.key === "ArrowLeft" ? -0.15 : 0.15;
    state.dirty = true;
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    scene.panBy(event.key === "ArrowLeft" ? 60 : -60, 0);
    viewChanged();
    event.preventDefault();
  } else if (event.key === "+" || event.key === "=" || event.key === "-") {
    scene.zoomAt(event.key === "-" ? 1 / 1.4 : 1.4);
    viewChanged();
    event.preventDefault();
  } else if (event.key === "0") {
    scene.resetView();
    viewChanged();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    scene.panBy(0, event.key === "ArrowUp" ? 60 : -60);
    viewChanged();
    event.preventDefault();
  } else if (event.key === "Escape") {
    state.pinned = null;
    scene.hovered = null;
    scene.focusFamily = null;
    if (state.L) ui.renderLegend(state.L, null, toggleFamily);
    ui.hideCard();
    state.dirty = true;
  }
});

function sameTarget(a, b) {
  if (!a || !b || a.type !== b.type) return a === b;
  if (a.type === "node") return a.node === b.node && a.tile === b.tile;
  if (a.type === "sign") return a.sign === b.sign;
  return true;
}

// ---------- drawing loop ----------

function animated() {
  return !reducedMotion.matches;
}

let previous = performance.now();
function frame(time) {
  const dt = Math.min(0.1, (time - previous) / 1000);
  previous = time;
  const idle = time - state.lastInteraction > 5000 && !state.pinned && !scene.hovered && !drag;
  if (scene.step(dt, animated())) viewChanged();
  if (animated()) {
    // A slow turn when nobody touches the map, so it reads as an object, not a chart.
    if (idle) scene.rot += dt * 0.035;
    scene.draw(time, true);
  } else if (state.dirty) {
    scene.draw(time, false);
  }
  state.dirty = false;
  requestAnimationFrame(frame);
}

new ResizeObserver(() => {
  scene.resize();
  if (state.L) scene.setLayout(state.L);
  state.dirty = true;
}).observe(canvas);

// keep "mis à jour il y a…" true between two loads
setInterval(() => {
  if (state.data && !document.getElementById("status").classList.contains("is-stale")) {
    ui.renderStatus(state.data, state.receivedAt);
  }
}, 30_000);

// ---------- theme: the system's choice, unless the button chose ----------

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function currentTheme() {
  const forced = document.documentElement.dataset.theme;
  return forced || (darkQuery.matches ? "dark" : "light");
}
function applyTheme() {
  const theme = currentTheme();
  scene.setTheme(theme);
  document.getElementById("theme").setAttribute("aria-pressed", String(theme === "dark"));
  state.dirty = true;
}
try {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
} catch { /* private mode */ }
document.getElementById("theme").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  applyTheme();
});
darkQuery.addEventListener("change", applyTheme);
applyTheme();

let savedView = "spiral";
try { savedView = localStorage.getItem("view") === "sphere" ? "sphere" : "spiral"; } catch { /* private mode */ }
setView(savedView);
scene.setLayout(emptyLayout());
requestAnimationFrame(frame);
load();
