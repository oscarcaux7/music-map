// Getting the data from MY server (never from Last.fm), and counting it per period.

export class LoadError extends Error {
  constructor(kind, message, retryIn = 30) {
    super(message);
    this.kind = kind;       // "lastfm": Last.fm down and nothing saved; "network": my server does not answer
    this.retryIn = retryIn;
  }
}

export async function fetchMap() {
  let response;
  try {
    response = await fetch("/api/map", { cache: "no-store" });
  } catch {
    throw new LoadError("network", "The map server does not answer.");
  }
  let body = null;
  try { body = await response.json(); } catch { /* not JSON: handled below */ }
  if (!response.ok || !body) {
    if (response.status === 503 && body) {
      throw new LoadError("lastfm", body.message, body.retry_in || 30);
    }
    throw new LoadError("network", `The server answered with an error (${response.status}).`);
  }
  return body;
}

export const RANGES = {
  h3: 3 * 3600,
  day: 24 * 3600,
  week: 7 * 24 * 3600,
  all: Infinity,
};

/** Count the plays of each artist and style inside the chosen period. */
export function aggregate(data, range) {
  const now = data.now;
  const from = now - RANGES[range];
  const scrobbles = data.scrobbles.filter((s) => s.ts >= from);

  const artists = new Map();
  for (const a of data.artists) {
    artists.set(a.id, { ...a, plays: 0, last: 0, first: Infinity, trackCounts: new Map(), cover: null });
  }
  for (const s of scrobbles) {
    const a = artists.get(s.a);
    if (!a) continue;
    a.plays += 1;
    if (s.ts > a.last) { a.last = s.ts; if (s.c) a.cover = s.c; }
    a.first = Math.min(a.first, s.ts);
    a.trackCounts.set(s.t, (a.trackCounts.get(s.t) || 0) + 1);
  }

  const played = [...artists.values()].filter((a) => a.plays > 0);
  for (const a of played) {
    a.cover = a.cover || data.artists.find((x) => x.id === a.id)?.cover || null;
    a.topTrack = [...a.trackCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || "";
  }

  const families = data.families
    .map((f) => {
      const members = played.filter((a) => a.family === f.id);
      return { ...f, artists: members.length, plays: members.reduce((n, a) => n + a.plays, 0) };
    })
    .filter((f) => f.artists > 0);

  const hours = new Array(24).fill(0);
  for (const s of scrobbles) hours[new Date(s.ts * 1000).getHours()] += 1;

  return {
    now,
    range,
    scrobbles,
    artists: played,
    byId: artists,
    families,
    hours,
    similar: data.similar || {},
    maxPlays: Math.max(1, ...played.map((a) => a.plays)),
    oldest: scrobbles.length ? scrobbles[scrobbles.length - 1].ts : now,
    nowPlaying: data.now_playing ? { ...data.now_playing, artist: artists.get(data.now_playing.a) } : null,
  };
}

// ---------- words ----------

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function ago(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function clock(ts, now) {
  const date = new Date(ts * 1000);
  const today = new Date(now * 1000);
  if (date.toDateString() === today.toDateString()) return timeFmt.format(date);
  const yesterday = new Date((now - 86400) * 1000);
  if (date.toDateString() === yesterday.toDateString()) return `yesterday, ${timeFmt.format(date)}`;
  return dayFmt.format(date);
}

export function plays(n) {
  return `${n} play${n > 1 ? "s" : ""}`;
}
