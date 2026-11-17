// Everything around the canvas: the card, the legend, the last songs, the list, the messages.
// Names come from Last.fm, so they are always inserted with textContent, never as HTML.

import { COLORS } from "./scene.js";
import { ago, clock, plays } from "./data.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function coverInto(container, coverId, name) {
  container.replaceChildren();
  if (coverId) {
    const img = el("img");
    img.src = `/api/cover/${encodeURIComponent(coverId)}`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(el("span", "no-cover", initials(name))));
    container.append(img);
  } else {
    container.append(el("span", "no-cover", initials(name)));
  }
}

function initials(name) {
  return (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function familyLabel(L, id) {
  return L.sectors.find((s) => s.id === id)?.label || "Autre";
}

// ---------- card ----------

export function showCard(target, L, position, pinned) {
  const card = $("card");
  const agg = L.agg;
  let artist;
  if (target.type === "node") {
    artist = target.node.artist;
    $("card-value").textContent = plays(artist.plays);
    $("card-name").textContent = artist.name;
    if (target.tile) {
      const s = target.tile.s;
      $("card-line1").textContent = s.t;
      $("card-line2").textContent = `Écouté ${clock(s.ts, agg.now)}${s.al ? " · " + s.al : ""}`;
      coverInto($("card-cover"), s.c || artist.cover, artist.name);
    } else {
      $("card-line1").textContent = artist.topTrack ? `Le plus écouté : ${artist.topTrack}` : "";
      $("card-line2").textContent = `Dernière écoute ${ago(agg.now - artist.last)}`;
      coverInto($("card-cover"), artist.cover, artist.name);
    }
  } else if (target.type === "now") {
    const np = agg.nowPlaying;
    artist = np?.artist;
    $("card-value").textContent = np ? "En ce moment" : "Silence";
    $("card-name").textContent = np ? np.t : "Rien ne joue en ce moment";
    $("card-line1").textContent = np ? artist?.name || "" : "Lance une chanson : elle apparaîtra ici.";
    $("card-line2").textContent = np && np.al ? np.al : "";
    coverInto($("card-cover"), np?.c, np ? np.t : "");
  } else {
    return hideCard();
  }
  const style = $("card-style");
  if (artist) {
    const tags = (artist.tags || []).slice(0, 3).join(", ");
    style.textContent = familyLabel(L, artist.family) + (tags ? ` (${tags})` : "");
    card.style.setProperty("--family", COLORS[artist.family] || COLORS.autre);
  } else {
    style.textContent = "";
    card.style.setProperty("--family", "#ffb02e");
  }

  card.hidden = false;
  card.classList.toggle("is-pinned", Boolean(pinned));
  if (position) {
    const stage = $("stage").getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = position[0] + 18;
    if (left + w > stage.width - 8) left = position[0] - w - 18;
    const top = Math.min(Math.max(8, position[1] - h / 2), stage.height - h - 8);
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${top}px`;
  }
}

export function hideCard() {
  $("card").hidden = true;
  $("card").classList.remove("is-pinned");
}

// ---------- legend, last songs, list ----------

export function renderLegend(L, focusFamily, onToggle) {
  const legend = $("legend");
  legend.replaceChildren();
  legend.classList.toggle("has-focus", Boolean(focusFamily));
  for (const s of L.sectors) {
    const button = el("button");
    button.type = "button";
    button.style.setProperty("--family", COLORS[s.id] || COLORS.autre);
    button.setAttribute("aria-pressed", String(focusFamily === s.id));
    button.append(el("span", "", s.label), el("span", "count", String(s.plays)));
    button.addEventListener("click", () => onToggle(s.id));
    legend.append(button);
  }
}

export function renderTape(L, onPoint) {
  const tape = $("tape");
  tape.replaceChildren();
  const agg = L.agg;
  if (!agg.scrobbles.length) {
    tape.append(el("li", "empty", "Aucune écoute sur cette période."));
    return;
  }
  for (const s of agg.scrobbles.slice(0, 48)) {
    const artist = agg.byId.get(s.a);
    const li = el("li");
    li.className = "pin";
    const button = el("button");
    button.type = "button";
    button.style.setProperty("--family", COLORS[artist?.family] || COLORS.autre);
    const thumb = el("span", "thumb");
    coverInto(thumb, s.c, s.t);
    button.append(thumb, el("span", "t-track", s.t), el("span", "t-artist", artist?.name || ""),
      el("span", "t-time", clock(s.ts, agg.now)));
    button.setAttribute("aria-label", `${s.t}, ${artist?.name || ""}, ${clock(s.ts, agg.now)}. Montrer sur la carte.`);
    const point = () => onPoint(s.a);
    button.addEventListener("pointerenter", point);
    button.addEventListener("focus", point);
    button.addEventListener("click", () => onPoint(s.a, true));
    button.addEventListener("pointerleave", () => onPoint(null));
    button.addEventListener("blur", () => onPoint(null));
    li.append(button);
    tape.append(li);
  }
}

export function renderTable(L) {
  const body = $("table");
  body.replaceChildren();
  const rows = [...L.agg.artists].sort((a, b) => b.plays - a.plays || b.last - a.last);
  for (const a of rows) {
    const tr = el("tr");
    const style = el("td");
    const swatch = el("span", "swatch");
    swatch.style.setProperty("--family", COLORS[a.family] || COLORS.autre);
    style.append(swatch, document.createTextNode(familyLabel(L, a.family)));
    tr.append(el("td", "", a.name), style, el("td", "num", String(a.plays)), el("td", "", ago(L.agg.now - a.last)));
    body.append(tr);
  }
}

// ---------- status line and messages ----------

export function renderStatus(data, fetchedAtLocal) {
  const status = $("status");
  status.classList.remove("is-stale");
  if (!data) return;
  const age = (Date.now() - fetchedAtLocal) / 1000 + (data.cache?.age || 0);
  if (data.source === "demo") {
    status.textContent = "Données de démonstration. Ajoute ta clé Last.fm dans .env pour voir tes vraies écoutes.";
  } else if (data.cache?.status === "stale") {
    status.classList.add("is-stale");
    status.textContent = `Last.fm ne répond pas. Écoutes reçues ${ago(age)}.`;
  } else {
    status.textContent = `Écoutes de ${data.user} sur Last.fm, mises à jour ${ago(age)}.`;
  }
  $("foot-user").textContent = data.source === "demo" ? "démonstration" : `Last.fm (${data.user})`;
  $("title-user").textContent = data.source === "demo" ? "démonstration" : data.user;
}

export function showMessage(title, text, action) {
  $("message").hidden = false;
  $("message-title").textContent = title;
  $("message-text").textContent = text;
  const button = $("message-action");
  button.hidden = !action;
  if (action) {
    button.textContent = action.label;
    button.onclick = action.run;
  }
}

export function hideMessage() {
  $("message").hidden = true;
}

export function setStatusText(text, stale = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("is-stale", stale);
}
