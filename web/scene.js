// Drawing the listening data on a <canvas>, with no library. Two views:
//
//   "spiral"  a helix of time, like a timeline poster: one turn per day (or per 4 hours),
//             the newest song at the top. Each play is its album cover, sitting on a
//             green ribbon. Thin grey threads join the plays of the same artist, and
//             artists that share a tag.
//   "sphere"  a network inside a wireframe globe: now in the middle, then the styles,
//             then the artists, then their songs, then each play, fanning out like a tree.
//
// Every 3D point is turned into a pixel by hand: a rotation, then a small perspective.

import { hash01 } from "./layout.js";

export const COLORS = {
  electro: "#1f8fe0",
  rap: "#f2751a",
  folk: "#3aae5a",
  rock: "#e8364f",
  soul: "#e3b100",
  classique: "#8a5cf0",
  monde: "#14b3a0",
  pop: "#e555b8",
  autre: "#8b8580",
};

const TAU = Math.PI * 2;
const RIBBON = "197, 216, 58";      // the chartreuse band of the spiral
const THEMES = {
  light: {
    ink: "#111", thread: "30, 30, 30", tick: "rgba(40, 46, 0, 0.55)", flagBg: "#111", flagFg: "#fff",
    glow: 0, halo: null, wire: "40, 40, 40", edge: "196, 92, 92", bridge: "40, 40, 70", label: "17, 17, 17",
    tagLeaf: "#444", root: "#111",
  },
  dark: {
    ink: "#f2f2f2", thread: "235, 235, 235", tick: "rgba(20, 24, 0, 0.7)", flagBg: null, flagFg: "#f2f2f2",
    glow: 0, halo: null, wire: "225, 225, 225", edge: "222, 140, 140", bridge: "235, 235, 255", label: "242, 242, 242",
    tagLeaf: "#f4f4f4", root: "#fff",
  },
};
const TILT = 0.34;                  // how much we look down on the spiral
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const EDGE = "222, 140, 140";       // the pink lines of the network

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mode = "spiral";
    this.t = THEMES.light;
    this.rot = 0.4;
    this.L = null;
    this.hovered = null;      // { type: "node", node, tile? } | { type: "now" }
    this.focusFamily = null;  // a style isolated from the legend
    this.images = new Map();  // cover id -> { img, ok }
    this.onImage = null;      // called when a cover arrives, so the page redraws
    this.tiles = [];
    this.graph = null;
    // zoom and pan: the view starts far away, then comes a little closer
    this.zoom = 0.3;
    this.panX = 0;
    this.panY = 0;
    this.target = { zoom: 1, panX: 0, panY: 0 };
    this.resize();
  }

  // ---------- zoom ----------

  static MIN_ZOOM = 0.3;
  static MAX_ZOOM = 8;

  /** Zoom by `factor`, keeping the point (x, y) of the screen in place. */
  zoomAt(factor, x = this.w / 2, y = this.h / 2) {
    const t = this.target;
    const z1 = t.zoom;
    const z2 = Math.max(Scene.MIN_ZOOM, Math.min(Scene.MAX_ZOOM, z1 * factor));
    t.panX = x - this.w / 2 - (x - this.w / 2 - t.panX) * (z2 / z1);
    t.panY = y - this.h / 2 - (y - this.h / 2 - t.panY) * (z2 / z1);
    t.zoom = z2;
    this.clampPan();
  }

  panBy(dx, dy) {
    this.target.panX += dx;
    this.target.panY += dy;
    this.clampPan();
  }

  clampPan() {
    const t = this.target;
    const mx = (this.w / 2) * Math.max(1, t.zoom);
    const my = (this.h / 2) * Math.max(1, t.zoom);
    t.panX = Math.max(-mx, Math.min(mx, t.panX));
    t.panY = Math.max(-my, Math.min(my, t.panY));
  }

  resetView(zoom = 1) {
    this.target = { zoom, panX: 0, panY: 0 };
  }

  /** Move the view towards its target. Returns true while it is still moving. */
  step(dt, smooth = true) {
    const t = this.target;
    const a = smooth ? 1 - Math.exp(-dt * 9) : 1;
    const before = this.zoom + this.panX + this.panY;
    this.zoom += (t.zoom - this.zoom) * a;
    this.panX += (t.panX - this.panX) * a;
    this.panY += (t.panY - this.panY) * a;
    if (Math.abs(t.zoom - this.zoom) < 1e-4) this.zoom = t.zoom;
    return Math.abs(this.zoom + this.panX + this.panY - before) > 1e-3;
  }

  setTheme(theme) {
    this.t = THEMES[theme] || THEMES.light;
  }

  setMode(mode) {
    this.mode = mode;
    this.hovered = null;
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, box.width);
    this.h = Math.max(1, box.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.k = Math.max(0.6, Math.min(1.15, this.w / 1000)); // shrinks covers and text on a phone
  }

  setLayout(L) {
    this.L = L;
    this.buildSpiral();
    this.buildGraph();
  }

  cover(id) {
    if (!id) return null;
    let entry = this.images.get(id);
    if (!entry) {
      const img = new Image();
      entry = { img, ok: false };
      img.decoding = "async";
      img.onload = () => { entry.ok = true; this.onImage?.(); };
      img.src = `/api/cover/${encodeURIComponent(id)}`;
      this.images.set(id, entry);
    }
    return entry.ok ? entry.img : null;
  }

  dimmed(artist) {
    const hl = this.hovered?.type === "node" ? this.hovered.node.artist.id : null;
    if (hl) return artist?.id !== hl;
    if (this.focusFamily) return artist?.family !== this.focusFamily;
    return false;
  }

  draw(time = 0, animate = true) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.L) return;
    if (this.mode === "sphere") this.drawSphere(time, animate);
    else this.drawSpiral(time, animate);
  }

  // ======================================================================
  //  Spiral
  // ======================================================================

  buildSpiral() {
    const agg = this.L.agg;
    const now = agg.now;
    let period;
    let span;
    if (agg.range === "h3") { period = 30 * 60; span = 3 * 3600; }   // one turn per half hour
    else if (agg.range === "day") { period = 4 * 3600; span = 86400; }
    else if (agg.range === "week") { period = 86400; span = 7 * 86400; }
    else {
      // all: as many turns as needed to spread the plays over about 8 turns, with a round length
      span = Math.max(3 * 3600, (now - agg.oldest) * 1.03);
      const NICE = [1800, 3600, 7200, 4 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400];
      period = NICE.find((p) => span / p <= 8) || 30 * 86400;
    }

    // The turns start on round times: midnight, or 0 h, 4 h, 8 h..., or 14 h, 14 h 30...
    const d = new Date(now * 1000);
    if (period < 86400) {
      const stepMin = period / 60;   // 30, 60, 120, 240, 360 or 720 minutes
      const minutes = Math.floor((d.getHours() * 60 + d.getMinutes()) / stepMin) * stepMin;
      d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    const marks = [];
    const turns = span / period;
    for (let i = 0; i <= Math.ceil(turns) + 1; i++) {
      const ts = d.getTime() / 1000;
      const u = (now - ts) / period;
      if (u > turns + 0.02) break;
      marks.push({ u, label: label(ts, period) });
      if (period < 86400) d.setTime(d.getTime() - period * 1000);
      else d.setDate(d.getDate() - period / 86400);
    }

    this.sp = {
      period,
      turns,
      offset: marks.length ? marks[0].u : 0,
      marks,
    };

    this.tiles = agg.scrobbles.map((s) => {
      const artist = agg.byId.get(s.a);
      return {
        s,
        artist,
        u: (now - s.ts) / period,
        size: 0.55 + 0.45 * Math.sqrt((artist?.plays || 1) / agg.maxPlays),
        sx: 0, sy: 0, side: 0, depth: 0,
      };
    });

    // fewer plays: bigger covers
    this.tileBoost = this.tiles.length < 60 ? 1.45 : this.tiles.length < 120 ? 1.2 : 1;
    //   many plays on one turn (7 days, when I listened mostly today): smaller covers,
    //   so they stop piling up and the links between them stay visible
    const perTurn = new Map();
    for (const t of this.tiles) perTurn.set(Math.floor(t.u), (perTurn.get(Math.floor(t.u)) || 0) + 1);
    const crowd = Math.max(0, ...perTurn.values());
    if (crowd > 16) this.tileBoost *= Math.max(0.42, Math.sqrt(16 / crowd));

    // threads: each play to the previous play of the same artist
    this.threads = [];
    const lastOf = new Map();
    for (const t of this.tiles) {
      const prev = lastOf.get(t.s.a);
      if (prev) this.threads.push([prev, t]);
      lastOf.set(t.s.a, t);
    }
    // and the newest plays of two artists that share a tag
    this.tagThreads = this.L.links.map(({ a, b }) => [this.firstTile(a.artist.id), this.firstTile(b.artist.id)])
      .filter(([x, y]) => x && y);

    // correlations, like the web of the poster:
    //   each play is joined to the 3 plays of other artists that share the most tags with it,
    //   preferring plays on other turns, so the lines cross the spiral from loop to loop
    this.corr = [];
    const seen = new Set();
    this.tiles.forEach((t, i) => {
      const tags = t.artist?.tags || [];
      if (!tags.length) return;
      const best = [];
      this.tiles.forEach((o, j) => {
        if (o.s.a === t.s.a) return;
        const shared = (o.artist?.tags || []).filter((x) => tags.includes(x)).length;
        if (!shared) return;
        const far = Math.min(1, Math.abs(o.u - t.u));
        best.push({ j, score: shared + far + hash01(`${i}-${j}`) * 0.3 });
      });
      best.sort((a, b) => b.score - a.score).slice(0, 3).forEach(({ j }) => {
        const key = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        this.corr.push([t, this.tiles[j]]);
      });
    });
    //   every play of a style is pulled towards one point on the axis of the spiral:
    //   the bundles cross in the middle, like the X-shaped knots of the poster
    const sums = new Map();
    for (const t of this.tiles) {
      const f = t.artist?.family || "autre";
      const e = sums.get(f) || { u: 0, n: 0 };
      e.u += t.u; e.n += 1;
      sums.set(f, e);
    }
    this.foci = new Map([...sums].map(([f, e]) => [f, e.u / e.n + (hash01(f) - 0.5) * 0.6]));
  }

  firstTile(id) {
    return this.tiles.find((t) => t.s.a === id) || null;
  }

  spiralFrame() {
    const { turns } = this.sp;
    const pitch = 0.42;
    const H = pitch * Math.max(turns, 1);
    // room at the top for the header bar and the "now" marker, which stands above the spiral
    const room = 150 * this.k;
    const S = Math.min(this.w * 0.4, (this.h * 0.92 - room) / (H * Math.cos(TILT) + 2.2 * Math.sin(TILT) + 0.3));
    return { S: S * this.zoom, pitch, top: H / 2 + 0.05, cy: this.h / 2 + room / 2 };
  }

  /** u: turns ago. Returns [x, y, depth, perspective]. */
  spiralPoint(u, F) {
    const a = Math.PI / 2 + (u - this.sp.offset) * TAU + this.rot;
    let R = 1 + 0.07 * Math.sin(u * 2.1 + 1) + 0.04 * Math.sin(u * 5.3);
    let y = F.top - u * F.pitch;
    if (u < 0) {
      // above now: the ribbon opens into wide, loose loops (the future, still empty)
      R *= 1 - 0.6 * u;
      y = F.top - u * F.pitch * 1.25;
    }
    const x = R * Math.cos(a);
    const z = R * Math.sin(a);
    const f = 5 / (5 - z);
    return [
      this.w / 2 + this.panX + x * F.S * f,
      F.cy + this.panY - y * Math.cos(TILT) * F.S + z * Math.sin(TILT) * F.S * f,
      z,
      f,
    ];
  }

  drawSpiral(time, animate) {
    const ctx = this.ctx;
    const F = this.spiralFrame();
    const k = this.k;
    const items = [];
    const hlArtist = this.hovered?.type === "node" ? this.hovered.node.artist.id : null;

    // 1. the ribbon, cut in small pieces so that covers can pass in front and behind
    //    It starts at now (u = 0, the top end) and winds down into the past.
    const steps = Math.max(60, Math.ceil(this.sp.turns * 140));
    const end = this.sp.turns + 0.01;
    let prev = this.spiralPoint(0, F);
    for (let i = 1; i <= steps; i++) {
      const u = end * (i / steps);
      const p = this.spiralPoint(u, F);
      items.push({ depth: (p[2] + prev[2]) / 2 - 0.02, kind: "rib", a: prev, b: p, fade: 1, thin: false });
      prev = p;
    }
    // hour ticks
    // a tick every 5 minutes (3 h), every hour (24 h and 7 days)
    const tickEvery = this.sp.period <= 3600 ? 1 / 6 : this.sp.period < 86400 ? 1 / 4 : 1 / 24;
    for (let u = this.sp.offset % tickEvery; u <= end; u += tickEvery) {
      const p = this.spiralPoint(u, F);
      items.push({ depth: p[2] - 0.01, kind: "tick", p });
    }

    // 2. the covers
    for (const t of this.tiles) {
      const p = this.spiralPoint(t.u, F);
      t.side = (12 + 26 * t.size) * k * p[3] * this.tileBoost * Math.pow(this.zoom, 0.85);
      t.sx = p[0];
      t.sy = p[1] - t.side / 2 - 3 * p[3];
      t.depth = p[2];
      items.push({ depth: p[2], kind: "tile", t });
    }

    // 3. the day labels, like little flags under the ribbon
    for (const m of this.sp.marks) {
      const p = this.spiralPoint(m.u, F);
      items.push({ depth: p[2] + 0.005, kind: "flag", p, text: m.label });
    }
    const top = this.spiralPoint(0, F);
    this.nowAt = top;

    // dark: a soft light behind the spiral, so it does not float in a flat black
    if (this.t.halo) {
      const c = this.spiralPoint(this.sp.turns / 2, F);
      const r = F.S * 2.6;
      const g = ctx.createRadialGradient(this.w / 2 + this.panX, c[1], 0, this.w / 2 + this.panX, c[1], r);
      g.addColorStop(0, `rgba(${this.t.halo}, 0.10)`);
      g.addColorStop(0.5, `rgba(${this.t.halo}, 0.03)`);
      g.addColorStop(1, `rgba(${this.t.halo}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // the web of correlations, first, under everything
    ctx.lineCap = "round";
    const axisX = this.w / 2 + this.panX;
    const axisY = (u) => F.cy + this.panY - (F.top - u * F.pitch) * Math.cos(TILT) * F.S;
    const fade = (t) => (hlArtist ? (t.s.a === hlArtist ? 3 : 0.35) : this.focusFamily ? (t.artist?.family === this.focusFamily ? 1.6 : 0.3) : 1);
    //   vertical drops, from each cover down to the loop under it
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${this.t.thread}, 0.32)`;
    ctx.beginPath();
    for (const t of this.tiles) {
      const below = this.spiralPoint(Math.min(this.sp.turns, t.u + 1), F);
      ctx.moveTo(t.sx, t.sy + t.side / 2);
      ctx.lineTo(t.sx, Math.max(t.sy + t.side / 2, below[1]));
    }
    ctx.stroke();
    //   plays of the same style, pulled to their point on the axis
    for (const t of this.tiles) {
      const u = this.foci.get(t.artist?.family || "autre");
      ctx.strokeStyle = `rgba(${this.t.thread}, ${Math.min(0.7, 0.24 * fade(t))})`;
      ctx.beginPath(); ctx.moveTo(t.sx, t.sy); ctx.lineTo(axisX, axisY(u)); ctx.stroke();
    }
    //   plays of artists that share tags
    ctx.lineWidth = 0.7;
    for (const [a, b] of this.corr) {
      const f = Math.max(fade(a), fade(b));
      ctx.strokeStyle = `rgba(${this.t.thread}, ${Math.min(0.85, 0.4 * f)})`;
      // the curve bends through the axis, so two neighbouring covers still draw a visible loop
      const cy = axisY((a.u + b.u) / 2);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.quadraticCurveTo(axisX, cy, b.sx, b.sy); ctx.stroke();
    }

    // threads of one artist
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${this.t.thread}, 0.16)`;
    ctx.beginPath();
    for (const [a, b] of this.tagThreads) { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = `rgba(${this.t.thread}, ${hlArtist ? 0.08 : 0.22})`;
    ctx.beginPath();
    for (const [a, b] of this.threads) {
      if (hlArtist && a.s.a === hlArtist) continue;
      ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
    }
    ctx.stroke();

    items.sort((x, y) => x.depth - y.depth);
    for (const it of items) {
      if (it.kind === "rib") {
        const front = Math.max(0, it.a[2]);
        if (this.t.glow) {
          // a wide, faint stroke under the band: the neon glow
          ctx.lineWidth = (12 + 10 * front) * k * it.a[3];
          ctx.strokeStyle = `rgba(${RIBBON}, ${0.05 + 0.07 * front})`;
          ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.stroke();
        }
        ctx.lineWidth = (it.thin ? 2.5 + 1.5 * front : 3 + 4 * front) * k * it.a[3];
        ctx.strokeStyle = `rgba(${RIBBON}, ${(0.55 + 0.45 * Math.max(0, (it.a[2] + 1) / 2)) * it.fade})`;
        ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.stroke();
      } else if (it.kind === "tick") {
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.t.tick;
        ctx.beginPath();
        ctx.moveTo(it.p[0], it.p[1] - 2.5 * k * it.p[3]);
        ctx.lineTo(it.p[0], it.p[1] + 2.5 * k * it.p[3]);
        ctx.stroke();
      } else if (it.kind === "tile") {
        this.drawTile(it.t);
      } else if (it.kind === "flag") {
        this.flag(it.p[0], it.p[1] + 9 * k, it.text, this.t.flagBg, this.t.flagFg);
      }
    }

    // the plays of the hovered artist, joined in black, on top
    if (hlArtist) {
      const mine = this.tiles.filter((t) => t.s.a === hlArtist);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = this.t.ink;
      ctx.beginPath();
      mine.forEach((t, i) => (i ? ctx.lineTo(t.sx, t.sy) : ctx.moveTo(t.sx, t.sy)));
      ctx.stroke();
      for (const t of mine) this.drawTile(t, true);
    }

    this.drawNowSpiral(top, time, animate);
  }

  drawTile(t, force = false) {
    const ctx = this.ctx;
    const s = t.side;
    const x = t.sx - s / 2;
    const y = t.sy - s / 2;
    const dim = !force && this.dimmed(t.artist);
    ctx.globalAlpha = dim ? 0.18 : 1;
    const img = this.cover(t.s.c || t.artist?.cover);
    if (img) ctx.drawImage(img, x, y, s, s);
    else {
      ctx.fillStyle = COLORS[t.artist?.family] || COLORS.autre;
      ctx.fillRect(x, y, s, s);
    }
    if (force) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.t.ink;
      ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
    }
    ctx.globalAlpha = 1;
  }

  flag(x, y, text, bg, fg, pointer = true) {
    const ctx = this.ctx;
    const size = Math.round(11 * Math.max(0.85, this.k));
    if (!bg) {
      // dark: no chip, just thin white text and a hairline to the ribbon
      ctx.font = `300 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.strokeStyle = "rgba(242, 242, 242, 0.45)";
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 2); ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(text.toUpperCase().split("").join(String.fromCharCode(8202)), x, y + 4);
      return;
    }
    ctx.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const w = ctx.measureText(text).width + 10;
    const h = size + 7;
    ctx.fillStyle = bg;
    if (pointer) {
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 1); ctx.lineTo(x, y - 4); ctx.lineTo(x + 4, y + 1); ctx.fill();
    }
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + h / 2 + 0.5);
  }

  drawNowSpiral(p, time, animate) {
    const ctx = this.ctx;
    const np = this.L.agg.nowPlaying;
    const k = this.k;
    const s = (np ? 54 : 0) * k * Math.pow(this.zoom, 0.85);
    // the stem rises above the tallest cover near now, so the marker is never hidden
    const near = this.tiles.filter((t) => t.u < 0.08).reduce((m, t) => Math.max(m, t.side), 0);
    const x = p[0];
    const stemTop = p[1] - near - 34 * k;
    const y = stemTop - s / 2;

    // the end of the ribbon: a round cap, so it is clear where the spiral stops
    ctx.fillStyle = `rgb(${RIBBON})`;
    ctx.beginPath(); ctx.arc(p[0], p[1], 6.5 * k, 0, TAU); ctx.fill();
    ctx.strokeStyle = this.t.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], 6.5 * k, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, p[1] - 6.5 * k); ctx.lineTo(x, stemTop); ctx.stroke();
    if (np) {
      const pulse = animate ? 0.5 + 0.5 * Math.sin(time / 420) : 1;
      ctx.strokeStyle = `rgba(${RIBBON}, ${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 3 + 3 * pulse;
      if (this.t.glow) { ctx.shadowColor = `rgba(${RIBBON}, 0.9)`; ctx.shadowBlur = 24 * pulse; }
      ctx.strokeRect(x - s / 2 - 4, y - s / 2 - 4, s + 8, s + 8);
      ctx.shadowBlur = 0;
      const img = this.cover(np.c || np.artist?.cover);
      if (img) ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
      else { ctx.fillStyle = COLORS[np.artist?.family] || COLORS.autre; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
      this.flag(x, y - s / 2 - 26 * k, "PLAYING NOW", "rgb(" + RIBBON + ")", "#111", false);
      this.nowBox = [x - s / 2, y - s / 2, s, s];
    } else {
      this.flag(x, stemTop - 20 * k, "NOW", "rgb(" + RIBBON + ")", "#111", false);
      this.nowBox = [x - 22 * k, stemTop - 20 * k, 44 * k, 20 * k];
    }
  }

  // ======================================================================
  //  Sphere
  // ======================================================================

  buildGraph() {
    // A tree inside a globe, like the old hyperbolic graph viewers:
    //   now (centre) -> styles -> my artists -> a starburst around each artist.
    // The starburst holds its songs, its tags and its similar artists (Last.fm).
    // A tag or a similar artist shared by several of my artists is not a leaf but a
    // bridge, placed between them inside the globe: those bridges draw the web of correlations.
    const agg = this.L.agg;
    const nodes = [];
    const edges = [];
    const root = { kind: "root", p: [0, 0, 0] };
    nodes.push(root);
    const sectors = this.L.sectors;
    const n = Math.max(1, sectors.length);
    const artistNodes = new Map();

    sectors.forEach((sector, i) => {
      const yy = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - yy * yy);
      const phi = i * GOLDEN + 0.6;
      const dir = norm([r * Math.cos(phi), yy * 0.8, r * Math.sin(phi)]);
      const hub = { kind: "hub", family: sector.id, label: sector.label, p: scale(dir, 0.3), dir };
      nodes.push(hub);
      edges.push({ a: root, b: hub, kind: "tree", family: sector.id });

      const members = agg.artists.filter((a) => a.family === sector.id).sort((a, b) => b.plays - a.plays);
      const [e1, e2] = basis(dir);
      const cap = Math.min(0.95, 0.35 + 0.1 * members.length);
      members.forEach((artist, j) => {
        const ang = j * GOLDEN + hash01(artist.id) * 0.6;
        const rho = cap * Math.sqrt((j + 0.6) / (members.length + 0.6));
        const adir = norm(add(dir, add(scale(e1, Math.cos(ang) * rho), scale(e2, Math.sin(ang) * rho))));
        const an = { kind: "artist", artist, family: sector.id, p: scale(adir, 0.74), dir: adir };
        nodes.push(an);
        artistNodes.set(artist.id, an);
        edges.push({ a: hub, b: an, kind: "tree", family: sector.id, artist: artist.id });
      });
    });

    // who shares what
    const tagUsers = new Map();
    const simUsers = new Map();
    const arcs = [];
    const seenArc = new Set();
    for (const an of artistNodes.values()) {
      for (const tag of an.artist.tags || []) {
        if (!tagUsers.has(tag)) tagUsers.set(tag, []);
        tagUsers.get(tag).push(an);
      }
      for (const item of agg.similar?.[an.artist.id] || []) {
        if (item.id) {
          const other = artistNodes.get(item.id);
          const key = [an.artist.id, item.id].sort().join("|");
          if (other && !seenArc.has(key)) {
            seenArc.add(key);
            arcs.push({ a: an, b: other, m: item.m, ids: [an.artist.id, item.id] });
          }
          continue;
        }
        const key = item.n.toLowerCase();
        if (!simUsers.has(key)) simUsers.set(key, { name: item.n, users: [] });
        simUsers.get(key).users.push({ an, m: item.m });
      }
    }

    // the starburst of each artist: concentric rings in the plane that touches the globe
    let leafCount = 0;
    for (const an of artistNodes.values()) {
      const artist = an.artist;
      const leaves = [];
      for (const [title, count] of artist.trackCounts.entries()) leaves.push({ kind: "track", name: title, count });
      for (const tag of artist.tags || []) if (tagUsers.get(tag).length === 1) leaves.push({ kind: "tag", name: tag });
      const sims = (agg.similar?.[artist.id] || []).filter((it) => !it.id && simUsers.get(it.n.toLowerCase()).users.length === 1);
      for (const it of sims) leaves.push({ kind: "sim", name: it.n, m: it.m });

      const [f1, f2] = basis(an.dir);
      const turn = hash01(artist.id) * TAU;
      let ring = 0;
      let inRing = 0;
      let cap = 7;
      leaves.forEach((leaf, i) => {
        if (inRing >= cap) { ring += 1; inRing = 0; cap = 7 + 7 * ring; }
        const left = Math.min(cap, leaves.length - (i - inRing));
        const a = turn + (inRing / left) * TAU + ring * 0.4;
        const R = 0.05 * (ring + 1);
        const p = add(an.p, add(scale(f1, Math.cos(a) * R), add(scale(f2, Math.sin(a) * R), scale(an.dir, 0.012 * (ring + 1)))));
        const node = { kind: leaf.kind, artist, family: an.family, p, name: leaf.name, count: leaf.count, m: leaf.m };
        nodes.push(node);
        edges.push({ a: an, b: node, kind: "spoke", family: an.family, artist: artist.id });
        leafCount += 1;
        // a song played several times: one small dot per play, just beyond it
        for (let c = 1; c < (leaf.count || 0); c++) {
          const pa = a + (c - (leaf.count - 1) / 2) * 0.12;
          const pp = add(an.p, add(scale(f1, Math.cos(pa) * (R + 0.025)), add(scale(f2, Math.sin(pa) * (R + 0.025)), scale(an.dir, 0.02))));
          const play = { kind: "play", artist, family: an.family, p: pp };
          nodes.push(play);
          edges.push({ a: node, b: play, kind: "spoke", family: an.family, artist: artist.id });
        }
        inRing += 1;
      });
    }

    // the bridges: shared tags and shared similar artists, inside the globe
    const bridges = [];
    const addBridge = (kind, name, users, w) => {
      let d = [0, 0, 0];
      for (const u of users) d = add(d, u.dir);
      const depth = 0.3 + 0.38 * hash01(name);
      const jitter = [hash01(name + "x") - 0.5, hash01(name + "y") - 0.5, hash01(name + "z") - 0.5];
      const p = scale(norm(add(norm(d), scale(jitter, 0.7))), depth);
      const node = { kind: "bridge", sub: kind, name, p, users: users.map((u) => u.artist.id), weight: w };
      nodes.push(node);
      bridges.push(node);
      for (const u of users) edges.push({ a: u, b: node, kind: "bridge", family: u.family, artist: u.artist.id, sub: kind });
    };
    for (const [tag, users] of tagUsers) if (users.length > 1) addBridge("tag", tag, users, users.length);
    for (const { name, users } of simUsers.values()) {
      if (users.length > 1) addBridge("sim", name, users.map((u) => u.an), users.length);
    }

    // the big fan in the middle: now, to every song of the last 24 hours
    for (const node of nodes) {
      if (node.kind === "track" && agg.now - node.artist.last < 86400) {
        edges.push({ a: root, b: node, kind: "long", family: node.family, artist: node.artist.id });
      }
    }
    for (const arc of arcs) {
      const mid = norm(add(arc.a.dir, arc.b.dir));
      arc.ctrl = { p: scale(mid, 1.05 + 0.15 * (1 - (arc.m || 0))) };
    }
    this.graph = { nodes, edges, artistNodes, root, arcs, bridges, leafCount };
  }

  sphereProject(p, time) {
    const yaw = this.rot;
    const pitch = 0.3 + 0.06 * Math.sin(time / 9000);
    let [x, y, z] = p;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    const cp = Math.cos(pitch);
    const spp = Math.sin(pitch);
    [y, z] = [y * cp - z * spp, y * spp + z * cp];
    const f = 3.4 / (3.4 - z);
    const S = this.sphereS;
    return [this.w / 2 + this.panX + x * S * f, this.sphereCy + this.panY - y * S * f, z, f];
  }

  drawSphere(time, animate) {
    const ctx = this.ctx;
    const k = this.k;
    this.sphereS = Math.min(this.w, this.h * 0.92) * 0.44 * this.zoom;
    this.sphereCy = this.h / 2 + 10;
    const t = animate ? time : 0;
    const g = this.graph;
    for (const node of g.nodes) node.s = this.sphereProject(node.p, t);
    for (const arc of g.arcs) arc.ctrl.s = this.sphereProject(arc.ctrl.p, t);
    const front = (s) => 0.55 + 0.45 * Math.max(0, (s[2] + 1) / 2);   // closer is brighter

    // the wireframe globe: outline, equator and two meridians
    ctx.strokeStyle = `rgba(${this.t.wire}, 0.6)`;
    ctx.lineWidth = 0.9;
    for (const which of [0, 1, 2]) {
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const p = which === 0 ? [Math.cos(a), 0, Math.sin(a)]
          : which === 1 ? [0, Math.cos(a), Math.sin(a)]
          : [Math.cos(a) * 0.7071, Math.sin(a), Math.cos(a) * 0.7071];
        const s = this.sphereProject(p, t);
        i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
      }
      ctx.stroke();
    }

    const hl = this.hovered?.type === "node" ? this.hovered.node.artist.id : null;
    const off = (e) => (hl ? e.artist !== hl : this.focusFamily ? e.family !== this.focusFamily : false);

    // edges: the tree in pink, the starbursts in the colour of their style, the bridges in white
    for (const e of g.edges) {
      const dim = off(e) ? 0.12 : 1;
      const depth = front(e.b.s);
      if (e.kind === "spoke") {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = rgba(COLORS[e.family] || COLORS.autre, (hl && !dim ? 0.9 : 0.5) * depth * dim);
      } else if (e.kind === "bridge") {
        ctx.lineWidth = hl && dim === 1 ? 0.9 : 0.5;
        ctx.strokeStyle = `rgba(${this.t.bridge}, ${(hl && dim === 1 ? 0.7 : 0.25) * depth * dim})`;
      } else if (e.kind === "long") {
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = `rgba(${this.t.edge}, ${0.3 * depth * dim})`;
      } else {
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = hl && dim === 1 ? `rgba(${this.t.label}, 0.95)` : `rgba(${this.t.edge}, ${0.7 * depth * dim})`;
      }
      ctx.beginPath(); ctx.moveTo(e.a.s[0], e.a.s[1]); ctx.lineTo(e.b.s[0], e.b.s[1]); ctx.stroke();
    }

    // arcs between two artists I listened to that Last.fm finds similar
    for (const arc of g.arcs) {
      const on = hl ? arc.ids.includes(hl) : !this.focusFamily || arc.a.family === this.focusFamily || arc.b.family === this.focusFamily;
      ctx.strokeStyle = `rgba(${RIBBON}, ${on ? (hl ? 0.85 : 0.12 + 0.25 * (arc.m || 0.5)) : 0.04})`;
      ctx.lineWidth = on && hl ? 1.4 : 0.7;
      ctx.beginPath();
      ctx.moveTo(arc.a.s[0], arc.a.s[1]);
      ctx.quadraticCurveTo(arc.ctrl.s[0], arc.ctrl.s[1], arc.b.s[0], arc.b.s[1]);
      ctx.stroke();
    }

    // nodes, back to front
    const sorted = g.nodes.slice(1).sort((a, b) => a.s[2] - b.s[2]);
    for (const node of sorted) {
      const f = node.s[3] * Math.pow(this.zoom, 0.5);
      const [x, y] = node.s;
      if (node.kind === "bridge") {
        const mine = hl && node.users.includes(hl);
        ctx.globalAlpha = hl && !mine ? 0.1 : front(node.s);
        ctx.strokeStyle = `rgb(${this.t.bridge})`;
        ctx.fillStyle = `rgb(${this.t.bridge})`;
        ctx.lineWidth = 0.9;
        const r = (1.1 + 0.45 * Math.min(node.weight, 6)) * f;
        if (node.sub === "tag") { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
        continue;
      }
      const color = COLORS[node.family] || COLORS.autre;
      const dim = node.artist ? this.dimmed(node.artist) : (this.focusFamily && node.family !== this.focusFamily);
      ctx.globalAlpha = (dim ? 0.15 : 1) * front(node.s);
      ctx.fillStyle = color;
      if (node.kind === "track") ctx.fillRect(x - 1.7 * f, y - 1.7 * f, 3.4 * f, 3.4 * f);
      else if (node.kind === "play") ctx.fillRect(x - 0.9 * f, y - 0.9 * f, 1.8 * f, 1.8 * f);
      else if (node.kind === "tag") { ctx.fillStyle = this.t.tagLeaf; ctx.fillRect(x - 1 * f, y - 1 * f, 2 * f, 2 * f); }
      else if (node.kind === "sim") {
        ctx.globalAlpha *= 0.55 + 0.45 * (node.m || 0.5);
        ctx.beginPath(); ctx.arc(x, y, 1.4 * f, 0, TAU); ctx.fill();
      } else if (node.kind === "artist") {
        const r = (2.5 + 4 * Math.sqrt(node.artist.plays / this.L.agg.maxPlays)) * f * k;
        node.r = r;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(${this.t.label}, 0.6)`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.stroke();
      } else if (node.kind === "hub") {
        ctx.beginPath(); ctx.arc(x, y, 3.5 * f, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // names: the styles, the most played artists; when hovering, the leaves of that artist
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const font = (w, size, style = "") => `${style} ${w} ${Math.round(size * Math.max(0.9, k))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    if (!hl) {
      ctx.font = font(700, 10);
      for (const node of g.nodes) {
        if (node.kind !== "hub") continue;
        ctx.fillStyle = COLORS[node.family] || COLORS.autre;
        ctx.fillText(node.label.toUpperCase(), node.s[0] + 6, node.s[1]);
      }
    } else {
      ctx.font = font(400, 10, "italic");
      ctx.fillStyle = `rgba(${this.t.label}, 0.8)`;
      for (const node of g.nodes) {
        const mine = (node.artist?.id === hl && (node.kind === "sim" || node.kind === "tag" || node.kind === "track"))
          || (node.kind === "bridge" && node.users.includes(hl));
        if (mine) ctx.fillText(node.name, node.s[0] + 5, node.s[1]);
      }
    }
    const top = [...g.artistNodes.values()].sort((a, b) => b.artist.plays - a.artist.plays).slice(0, 8);
    for (const node of hl ? [g.artistNodes.get(hl)].filter(Boolean) : top) {
      ctx.font = font(hl ? 700 : 500, 11);
      ctx.fillStyle = `rgba(${this.t.label}, ${hl ? 1 : 0.85})`;
      ctx.fillText(node.artist.name, node.s[0] + (node.r || 4) + 5, node.s[1]);
    }

    // now, in the middle
    const r0 = g.root.s;
    const np = this.L.agg.nowPlaying;
    const pulse = animate && np ? 0.5 + 0.5 * Math.sin(time / 420) : 0.6;
    ctx.fillStyle = this.t.root;
    ctx.beginPath(); ctx.arc(r0[0], r0[1], 3, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${RIBBON}, ${np ? 0.4 + 0.6 * pulse : 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(r0[0], r0[1], 8 + 6 * pulse, 0, TAU); ctx.stroke();
    this.nowAt = r0;
    this.nowBox = [r0[0] - 12, r0[1] - 12, 24, 24];

    // the counts, as the status line of an old graph viewer: one quiet line at the bottom
    ctx.fillStyle = `rgba(${this.t.label}, 0.55)`;
    ctx.font = `11px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = "left";
    const strip = 120;
    const agg = this.L.agg;
    ctx.fillText(
      `Graph loaded. ${this.L.sectors.length} styles · ${agg.artists.length} artists · ${agg.scrobbles.length} plays · `
      + `${g.nodes.length} nodes · ${g.edges.length} links · ${g.bridges.length} bridges · ${g.arcs.length} look-alikes`,
      Math.max(16, Math.min(48, this.w * 0.04)), this.h - 64,
    );
  }

  // ======================================================================
  //  Pointer
  // ======================================================================

  hitTest(x, y) {
    if (!this.L) return null;
    if (this.nowBox) {
      const [bx, by, bw, bh] = this.nowBox;
      if (x >= bx - 4 && x <= bx + bw + 4 && y >= by - 4 && y <= by + bh + 4) return { type: "now" };
    }
    if (this.mode === "sphere") {
      let best = null;
      let bestD = 14 * 14;
      for (const node of this.graph.nodes) {
        if (!node.artist || !node.s) continue;
        const d = (node.s[0] - x) ** 2 + (node.s[1] - y) ** 2;
        const bonus = node.kind === "artist" ? 0.5 : 1;
        if (d * bonus < bestD) { bestD = d * bonus; best = node; }
      }
      if (!best) return null;
      const node = this.L.nodeOf.get(best.artist.id);
      return node ? { type: "node", node } : null;
    }
    const sorted = [...this.tiles].sort((a, b) => b.depth - a.depth);
    for (const t of sorted) {
      const h = t.side / 2 + 2;
      if (Math.abs(x - t.sx) <= h && Math.abs(y - t.sy) <= h) {
        const node = this.L.nodeOf.get(t.s.a);
        if (node) return { type: "node", node, tile: t };
      }
    }
    return null;
  }

  screenOf(target) {
    if (!target) return null;
    if (target.type === "now") return this.nowAt ? [this.nowAt[0], this.nowAt[1] - 40] : null;
    if (target.type !== "node") return null;
    if (this.mode === "sphere") {
      const n = this.graph?.artistNodes.get(target.node.artist.id);
      return n?.s ? [n.s[0], n.s[1]] : null;
    }
    const t = target.tile || this.firstTile(target.node.artist.id);
    return t ? [t.sx, t.sy] : null;
  }
}

// ---------- small helpers ----------

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function label(ts, period) {
  const d = new Date(ts * 1000);
  if (period < 86400) {
    // a turn that starts at midnight says which day; the others say the time
    if (d.getHours() === 0 && d.getMinutes() === 0) return dayFmt.format(d);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (period === 86400) return dayFmt.format(d);
  return monthFmt.format(d);
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
}
function scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }
function add(a, b, c) {
  const r = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return c ? [r[0] + c[0], r[1] + c[1], r[2] + c[2]] : r;
}
function basis(d) {
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
  const e2 = norm([d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]]);
  return [e1, e2];
}
