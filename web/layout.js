// Where each thing goes on the plate. World units: the plate spans -1.2 to 1.2.
//
//   distance from the centre  = how long ago (log scale: the last hours get more room)
//   angle                     = the music style (one sector per style)
//   height of a stem          = how many plays (drawn in scene.js)

const TAU = Math.PI * 2;
export const R_NOW = 0.24;   // inside this circle: the sphere of "now"
export const R_OLD = 1.0;    // the oldest songs of the period
export const R_SIGNS = 1.12; // the signs of the styles

const MIN_HOURS = 1 / 6;     // 10 minutes: anything newer sits on the first circle

const RINGS = [
  { h: 1, label: "1 h" },
  { h: 6, label: "6 h" },
  { h: 24, label: "24 h" },
  { h: 72, label: "3 jours" },
  { h: 168, label: "7 jours" },
  { h: 720, label: "30 jours" },
];

/** A stable number between 0 and 1 for a text, so the map does not move at each reload. */
export function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function timeScale(agg) {
  const spanHours = (agg.now - agg.oldest) / 3600;
  const maxHours =
    agg.range === "h3" ? 3 : agg.range === "day" ? 24 : agg.range === "week" ? 168 : Math.max(24, spanHours * 1.02);
  const span = Math.log(maxHours / MIN_HOURS);
  const radius = (ts) => {
    const hours = Math.max((agg.now - ts) / 3600, MIN_HOURS);
    const t = Math.min(1, Math.log(hours / MIN_HOURS) / span);
    return R_NOW + (R_OLD - R_NOW) * t;
  };
  const rings = RINGS.filter((r) => r.h < maxHours * 0.98).map((r) => ({
    ...r,
    r: R_NOW + (R_OLD - R_NOW) * (Math.log(r.h / MIN_HOURS) / span),
  }));
  rings.push({ h: maxHours, label: "", r: R_OLD });
  return { radius, rings, maxHours };
}

export function layout(agg) {
  const scale = timeScale(agg);

  // 1. One sector per style. Its width follows its number of artists.
  const GAP = 0.07;
  const weights = agg.families.map((f) => Math.max(f.artists, 1.5));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = TAU - GAP * agg.families.length;
  let angle = -Math.PI / 2;
  const sectors = agg.families.map((f, i) => {
    const width = (usable * weights[i]) / total;
    const sector = { ...f, a0: angle, a1: angle + width, mid: angle + width / 2 };
    angle += width + GAP;
    return sector;
  });
  const sectorOf = new Map(sectors.map((s) => [s.id, s]));

  // 2. Artists spread inside their sector, at the distance of their last play.
  const nodes = [];
  for (const sector of sectors) {
    const members = agg.artists
      .filter((a) => a.family === sector.id)
      .sort((a, b) => hash01(a.id) - hash01(b.id));
    const step = (sector.a1 - sector.a0) / members.length;
    members.forEach((a, i) => {
      const theta = sector.a0 + step * (i + 0.5) + (hash01(a.id + "θ") - 0.5) * step * 0.5;
      const r = scale.radius(a.last) + (hash01(a.id + "r") - 0.5) * 0.035;
      nodes.push({ artist: a, theta, r, x: r * Math.cos(theta), y: r * Math.sin(theta) });
    });
  }
  const nodeOf = new Map(nodes.map((n) => [n.artist.id, n]));

  // 3. Each song played is a small mark on the ground, on the line of its artist.
  //    An artist you play often leaves a trail from the centre outwards.
  const marks = [];
  for (const s of agg.scrobbles) {
    const node = nodeOf.get(s.a);
    if (!node) continue;
    const theta = node.theta + (hash01(String(s.ts)) - 0.5) * 0.05;
    const r = scale.radius(s.ts);
    marks.push({ id: s.a, family: node.artist.family, x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }

  // 4. Threads between artists that share a tag (at most 2 per artist).
  const links = [];
  const seen = new Set();
  for (const n of nodes) {
    const candidates = [];
    for (const m of nodes) {
      if (m === n) continue;
      const shared = n.artist.tags.filter((t) => m.artist.tags.includes(t)).length;
      if (shared > 0) candidates.push({ m, shared });
    }
    candidates
      .sort((a, b) => b.shared - a.shared || b.m.artist.plays - a.m.artist.plays)
      .slice(0, 2)
      .forEach(({ m, shared }) => {
        const key = [n.artist.id, m.artist.id].sort().join("|");
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ a: n, b: m, shared });
      });
  }

  // 5. Signs: one per style, outside the last circle.
  const signs = sectors.map((s) => ({
    sector: s,
    x: R_SIGNS * Math.cos(s.mid),
    y: R_SIGNS * Math.sin(s.mid),
  }));

  return { agg, scale, sectors, sectorOf, nodes, nodeOf, marks, links, signs };
}
