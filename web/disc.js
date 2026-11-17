// The third view: time as a record, after Will Sheppard's "Music CD checkouts from the
// Seattle Public Library" (a spiral of thin coloured bars that can unfold into a cone).
//
//   the groove   an Archimedean spiral, from my first play of the period (centre) to now (edge)
//   a bar        one slice of time. Its colours stack the styles I played in that slice,
//                its length grows with the number of plays (log scale, so one play still shows)
//   unfold       0: a flat disc seen from above. 1: a cone, the past sinking in the middle,
//                the bars rising like the spikes of an equalizer.
//
// These functions become methods of Scene (see the end of scene.js), so `this` is the scene.

const TAU = Math.PI * 2;
const RIBBON = "197, 216, 58";
const SLICES = 360;          // slices of time on the whole groove
const HOLE = 0.16;           // the hole of the record

const startFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

export const discMethods = {
  buildDisc() {
    const agg = this.L.agg;
    const now = agg.now;
    const WINDOW = { h3: 3 * 3600, day: 86400, week: 7 * 86400, all: Infinity }[agg.range] || Infinity;
    const dataSpan = agg.scrobbles.length ? now - agg.oldest : 0;
    const span = Math.min(WINDOW, Math.max(3600, dataSpan * 1.04));
    const turns = 6;
    const slice = span / SLICES;
    const families = this.L.sectors.map((s) => s.id);

    // count the plays of each style in each slice of time
    const slices = Array.from({ length: SLICES }, (_, i) => ({ i, counts: new Map(), plays: [], total: 0 }));
    for (const s of agg.scrobbles) {
      const i = Math.min(SLICES - 1, Math.max(0, Math.floor((now - s.ts) / slice)));
      const sl = slices[SLICES - 1 - i];   // index 0 = the oldest, at the centre
      const fam = agg.byId.get(s.a)?.family || "autre";
      sl.counts.set(fam, (sl.counts.get(fam) || 0) + 1);
      sl.plays.push(s);
      sl.total += 1;
    }
    for (const sl of slices) {
      sl.t = (sl.i + 0.5) / SLICES;
      sl.from = now - span + sl.i * slice;
      sl.parts = families.filter((f) => sl.counts.has(f)).map((f) => ({ family: f, n: sl.counts.get(f) }));
      for (const [f, n] of sl.counts) if (!families.includes(f)) sl.parts.push({ family: f, n });
    }

    // a time label at 12 places along the groove
    const labels = [];
    for (let j = 1; j < 12; j++) {
      const t = j / 12;
      const ts = now - span + t * span;
      const d = new Date(ts * 1000);
      labels.push({ t, text: span > 2 * 86400 ? `${dayFmt.format(d)} ${timeFmt.format(d)}` : timeFmt.format(d) });
    }
    // a smoothed density: how much I listened around each slice (a moving gaussian window).
    // Drawn as a fine line on every slice, it gives the record its texture, like grooves.
    const sigma = 5;
    for (const sl of slices) {
      let sum = 0;
      for (let d = -3 * sigma; d <= 3 * sigma; d++) {
        const o = slices[sl.i + d];
        if (o) sum += o.total * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
      sl.density = sum;
    }
    const maxDensity = Math.max(1e-6, ...slices.map((s) => s.density));
    for (const sl of slices) sl.density /= maxDensity;
    this.disc = { span, turns, slice, slices, labels, start: now - span, maxN: Math.max(1, ...slices.map((s) => s.total)) };
    if (this.unfold === undefined) { this.unfold = 0; this.unfoldTarget = 0.45; }
  },

  /** "one turn = 4 hours" for the page. */
  discTurnText() {
    const sec = (this.disc?.span || 86400) / (this.disc?.turns || 6);
    if (sec < 3600) return `${Math.round(sec / 60)} minutes`;
    if (sec < 2 * 86400) return `${Math.round((sec / 3600) * 10) / 10} hours`;
    return `${Math.round((sec / 86400) * 10) / 10} days`;
  },

  /** A point of the groove at time t (0 centre, 1 edge), in the 3D world. */
  discPoint(t, lift = 0) {
    const a = t * this.disc.turns * TAU;
    const r = HOLE + (1 - HOLE) * t;
    const y = (t - 0.6) * 1.5 * this.unfold + lift;
    return { x: r * Math.cos(a), y, z: r * Math.sin(a), a };
  },

  drawDisc(time, animate) {
    const ctx = this.ctx;
    const D = this.disc;
    const k = this.k;
    this.sphereS = Math.min(this.w * 0.46, this.h * 0.44) * this.zoom;
    this.sphereCy = this.h / 2 + 30;
    // the more the record unfolds, the more we look at it from the side, to see the cone
    if (!this.cam) this.pitch = 0.95 - 0.5 * this.unfold;
    const P = (p) => this.sphereProject([p.x, p.y, p.z], time);
    const hl = this.hovered?.type === "node" ? this.hovered.node.artist.id : null;
    const dark = this.t.paper === "13, 13, 13";

    // the groove, and a small tick for each empty slice: the lines of a record
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${this.t.thread}, 0.28)`;
    ctx.beginPath();
    for (let i = 0; i <= 900; i++) {
      const s = P(this.discPoint(i / 900));
      i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
    }
    ctx.stroke();

    // the bars, back to front
    const tilt = 0.15 + 1.1 * this.unfold;       // unfolded, the bars rise towards the sky
    const L = 0.3;
    const bars = [];
    for (const sl of D.slices) {
      const base = this.discPoint(sl.t);
      const out = [Math.cos(base.a) * Math.cos(tilt), Math.sin(tilt), Math.sin(base.a) * Math.cos(tilt)];
      // the envelope: a fine line on every slice, as long as the smoothed density
      const env = 0.015 + 0.2 * sl.density;
      const ea = P(base);
      const eb = P({ x: base.x + out[0] * env, y: base.y + out[1] * env, z: base.z + out[2] * env });
      bars.push({ depth: ea[2] - 0.001, empty: true, a: ea, b: eb, density: sl.density });
      if (!sl.total) continue;
      // the whole bar: log of the plays, so a single play still shows
      const total = (L * Math.log2(1 + sl.total)) / Math.log2(1 + D.maxN) + 0.03;
      let from = 0.01;
      const segs = [];
      for (const part of sl.parts) {
        const len = (total * part.n) / sl.total;
        const p0 = { x: base.x + out[0] * from, y: base.y + out[1] * from, z: base.z + out[2] * from };
        const p1 = { x: base.x + out[0] * (from + len), y: base.y + out[1] * (from + len), z: base.z + out[2] * (from + len) };
        segs.push({ family: part.family, a: P(p0), b: P(p1) });
        from += len;
      }
      const mine = hl ? sl.plays.some((s) => s.a === hl) : this.focusFamily ? sl.counts.has(this.focusFamily) : true;
      sl.screen = segs[segs.length - 1].b;
      sl.screenBase = segs[0].a;
      bars.push({ depth: segs[0].a[2], segs, mine, sl });
    }
    bars.sort((a, b) => a.depth - b.depth);
    ctx.lineCap = "butt";
    if (dark) ctx.globalCompositeOperation = "lighter";   // dark: the colours add up and glow
    for (const bar of bars) {
      if (bar.empty) {
        ctx.globalAlpha = (hl || this.focusFamily ? 0.12 : 0.3) + 0.25 * bar.density;
        ctx.strokeStyle = `rgb(${this.t.thread})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(bar.a[0], bar.a[1]); ctx.lineTo(bar.b[0], bar.b[1]); ctx.stroke();
        continue;
      }
      const near = 0.6 + 0.4 * Math.max(0, (bar.depth + 1) / 2);
      ctx.globalAlpha = (bar.mine ? 0.92 : 0.12) * near;
      ctx.lineWidth = Math.max(1.6, 4.5 * k * Math.sqrt(this.zoom) * bar.segs[0].a[3]);
      for (const s of bar.segs) {
        ctx.strokeStyle = this.colors[s.family] || this.colors.autre;
        ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // the time labels, written along the radius, outside the groove
    ctx.font = `500 ${Math.round(10 * Math.max(0.9, k))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = `rgba(${this.t.label}, 0.75)`;
    ctx.textBaseline = "middle";
    for (const lab of D.labels) {
      const p = this.discPoint(lab.t);
      const a = P({ x: p.x * 1.0, y: p.y, z: p.z });
      const r = Math.hypot(p.x, p.z) || 1;
      const b = P({ x: p.x * (1 + 0.32 / r), y: p.y + 0.2 * this.unfold, z: p.z * (1 + 0.32 / r) });
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const flip = Math.abs(ang) > Math.PI / 2;
      ctx.save();
      ctx.translate(b[0], b[1]);
      ctx.rotate(flip ? ang + Math.PI : ang);
      ctx.textAlign = flip ? "right" : "left";
      ctx.fillText(lab.text, 0, 0);
      ctx.restore();
    }

    // the two ends: the first play, and now
    const first = P(this.discPoint(0));
    const end = P(this.discPoint(1));
    ctx.fillStyle = `rgb(${this.t.label})`;
    ctx.beginPath(); ctx.arc(first[0], first[1], 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgb(${RIBBON})`;
    ctx.beginPath(); ctx.arc(end[0], end[1], 6 * k, 0, TAU); ctx.fill();
    ctx.strokeStyle = this.t.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.flag(end[0], end[1] + 12 * k, "NOW", `rgb(${RIBBON})`, "#111");
    this.nowAt = end;
    this.nowBox = [end[0] - 10, end[1] - 10, 20, 20];

    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${this.t.label}, 0.55)`;
    ctx.font = `11px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillText(
      `From ${startFmt.format(new Date(D.start * 1000))} (centre) to now (edge) · one turn = ${this.discTurnText()} · ${SLICES} slices of ${Math.max(1, Math.round(D.slice / 60))} min`,
      Math.max(16, Math.min(48, this.w * 0.04)), this.h - 64,
    );
  },

  /** The slice under the pointer: its most played artist. */
  hitDisc(x, y) {
    let best = null;
    let bestD = 12 * 12;
    for (const sl of this.disc.slices) {
      if (!sl.total || !sl.screen) continue;
      for (const p of [sl.screen, sl.screenBase]) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < bestD) { bestD = d; best = sl; }
      }
    }
    if (!best) return null;
    const counts = new Map();
    for (const s of best.plays) counts.set(s.a, (counts.get(s.a) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const node = this.L.nodeOf.get(top);
    return node ? { type: "node", node, slice: best } : null;
  },
};
