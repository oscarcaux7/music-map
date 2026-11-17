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

/** A sleeve for a song with no cover: the colour of its style, and its title in big letters. */
function sleeve(name, family) {
  const s = el("span", "no-cover");
  s.style.setProperty("--family", COLORS[family] || COLORS.autre);
  s.append(el("span", "no-cover-title", name || "?"));
  return s;
}

function coverInto(container, coverId, name, family) {
  container.replaceChildren();
  if (!coverId) {
    container.append(sleeve(name, family));
    return;
  }
  const img = el("img");
  const src = `/api/cover/${encodeURIComponent(coverId)}`;
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  let retried = false;
  img.addEventListener("error", () => {
    // the server may have been busy or just restarted: one more try, a little later
    if (!retried) {
      retried = true;
      setTimeout(() => { img.src = `${src}?retry=1`; }, 2500 + Math.random() * 2000);
      return;
    }
    img.replaceWith(sleeve(name, family));
  });
  container.append(img);
}


function familyLabel(L, id) {
  return L.sectors.find((s) => s.id === id)?.label || "Other";
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
      $("card-line2").textContent = `Played ${clock(s.ts, agg.now)}${s.al ? " · " + s.al : ""}`;
      coverInto($("card-cover"), s.c || artist.cover, s.t, artist.family);
    } else {
      $("card-line1").textContent = artist.topTrack ? `Most played: ${artist.topTrack}` : "";
      $("card-line2").textContent = `Last played ${ago(agg.now - artist.last)}`;
      coverInto($("card-cover"), artist.cover, artist.name, artist.family);
    }
  } else if (target.type === "now") {
    const np = agg.nowPlaying;
    artist = np?.artist;
    $("card-value").textContent = np ? "Playing now" : "Silence";
    $("card-name").textContent = np ? np.t : "Nothing is playing right now";
    $("card-line1").textContent = np ? artist?.name || "" : "Play a song: it will appear here.";
    $("card-line2").textContent = np && np.al ? np.al : "";
    coverInto($("card-cover"), np?.c || np?.artist?.cover, np ? np.t : "", np?.artist?.family);
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
    tape.append(el("li", "empty", "No plays in this period."));
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
    coverInto(thumb, s.c || artist?.cover, s.t, artist?.family);   // no cover for the song: the artist's
    button.append(thumb, el("span", "t-track", s.t), el("span", "t-artist", artist?.name || ""),
      el("span", "t-time", clock(s.ts, agg.now)));
    button.setAttribute("aria-label", `${s.t}, ${artist?.name || ""}, ${clock(s.ts, agg.now)}. Show on the map.`);
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
    status.textContent = "Demo data. Add your Last.fm key in .env to see your real plays.";
  } else if (data.cache?.status === "stale") {
    status.classList.add("is-stale");
    status.textContent = `Last.fm does not answer. Plays received ${ago(age)}.`;
  } else {
    status.textContent = `Plays of ${data.user} on Last.fm, updated ${ago(age)}.`;
  }
  $("foot-user").textContent = data.source === "demo" ? "demo data" : `Last.fm (${data.user})`;
  $("title-user").textContent = data.source === "demo" ? "demo" : data.user;
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

// ---------- the period, wrapped ----------

const pct = (x) => `${Math.round(x * 100)}%`;

function card(className, label) {
  const c = el("article", `w-card ${className}`);
  c.append(el("p", "w-label", label));
  return c;
}

function ranked(items, value, name, sub) {
  const ol = el("ol", "w-rank");
  const max = Math.max(1, ...items.map(value));
  items.forEach((it, i) => {
    const li = el("li");
    const bar = el("span", "w-bar");
    bar.style.setProperty("--w", `${(value(it) / max) * 100}%`);
    const text = el("span", "w-rank-text");
    text.append(el("span", "w-rank-name", name(it)), el("span", "w-rank-sub", sub(it)));
    li.append(el("span", "w-rank-n", String(i + 1)), text, el("span", "w-rank-v", String(value(it))), bar);
    ol.append(li);
  });
  return ol;
}

export function renderWrapped(stats, periodTitle, minutesPerPlay, duration) {
  const root = $("wrapped");
  root.replaceChildren();
  $("wrapped-period").textContent = periodTitle;
  if (!stats) {
    root.append(el("p", "w-empty", "No plays in this period yet."));
    return;
  }

  // 1. the total
  const total = card("w-total", "In this period");
  total.append(
    el("p", "w-huge", String(stats.plays)),
    el("p", "w-unit", stats.plays > 1 ? "plays" : "play"),
    el("p", "w-line", `≈ ${duration(stats.minutes)} of music · ${stats.artistsCount} artists · ${stats.songsCount} songs`),
  );

  // 2. the top artist, on its cover
  const a = stats.topArtists[0];
  const top = card("w-artist", "Top artist");
  const bg = el("div", "w-cover");
  coverInto(bg, a.cover, a.name, a.family);
  top.prepend(bg);
  top.append(
    el("p", "w-big", a.name),
    el("p", "w-line", `${a.plays} plays · ≈ ${duration(a.plays * minutesPerPlay)} · ${pct(a.plays / stats.plays)} of my plays`),
  );
  top.style.setProperty("--family", COLORS[a.family] || COLORS.autre);

  // 3. the top song
  const s = stats.topSongs[0];
  const song = card("w-song", "Top song");
  const thumb = el("div", "w-thumb");
  coverInto(thumb, s.cover || s.artist?.cover, s.title, s.artist?.family);
  song.append(thumb, el("p", "w-mid", s.title), el("p", "w-line", s.artist?.name || ""),
    el("p", "w-times", `${s.plays}×`));

  // 4. and 5. the top fives
  const artists = card("w-list", "Top 5 artists");
  artists.append(ranked(stats.topArtists, (x) => x.plays, (x) => x.name, (x) => `≈ ${duration(x.plays * minutesPerPlay)}`));
  const songs = card("w-list", "Top 5 songs");
  songs.append(ranked(stats.topSongs, (x) => x.plays, (x) => x.title, (x) => x.artist?.name || ""));

  // 6. the styles, as one bar
  const st = stats.styles[0];
  const styles = card("w-styles", "Mostly");
  styles.append(el("p", "w-big", st.label), el("p", "w-line", `${pct(st.plays / stats.plays)} of my plays`));
  const bar = el("div", "w-stack");
  const keys = el("ul", "w-keys");
  for (const f of stats.styles) {
    const part = el("span");
    part.style.setProperty("--w", `${(f.plays / stats.plays) * 100}%`);
    part.style.setProperty("--family", COLORS[f.id] || COLORS.autre);
    bar.append(part);
    const li = el("li", "", `${f.label} ${pct(f.plays / stats.plays)}`);
    li.style.setProperty("--family", COLORS[f.id] || COLORS.autre);
    keys.append(li);
  }
  styles.append(bar, keys);

  // 7. the clock: plays per hour of the day
  const clock = card("w-clock", "When I listen");
  const hh = String(stats.peak).padStart(2, "0");
  clock.append(el("p", "w-big", `${hh}:00`), el("p", "w-line", `my busiest hour · ${pct(stats.nightShare)} of plays between midnight and 6:00`));
  const bars = el("div", "w-hours");
  const maxH = Math.max(1, ...stats.hours);
  stats.hours.forEach((n, h) => {
    const b = el("span", h === stats.peak ? "is-peak" : "");
    b.style.setProperty("--h", `${(n / maxH) * 100}%`);
    b.title = `${String(h).padStart(2, "0")}:00 · ${n} plays`;
    bars.append(b);
  });
  const ticks = el("div", "w-hour-ticks");
  for (const t of ["00", "06", "12", "18", "24"]) ticks.append(el("span", "", t));
  clock.append(bars, ticks);

  // 8. on repeat, 9. the longest session
  const repeat = card("w-small", "On repeat");
  repeat.append(el("p", "w-big", `${stats.run.n} in a row`), el("p", "w-line", `songs by ${stats.run.artist?.name || "one artist"}, one after the other`));
  const session = card("w-small", "Longest session");
  session.append(el("p", "w-big", duration(stats.session.minutes)), el("p", "w-line", `${stats.session.n} plays without a break of more than 20 minutes`));

  root.append(total, top, song, artists, songs, styles, clock, repeat, session);
  root.append(el("p", "w-note", `Time is estimated: Last.fm does not give the length of a song, so each play counts for ${minutesPerPlay} minutes.`));
}
