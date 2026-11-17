// The period, "wrapped": a few numbers about my listening, computed from the same data
// as the drawing (the plays of the chosen period). Nothing here calls the server.
//
// Last.fm's recent tracks do not give the length of a song, so time is an estimate:
// every play counts for MINUTES_PER_PLAY minutes. The page says so.

export const MINUTES_PER_PLAY = 3.5;
const SESSION_GAP = 20 * 60;   // more than 20 minutes without a play: a new session

export function wrap(agg) {
  const plays = agg.scrobbles;                    // newest first
  if (!plays.length) return null;
  const minutes = plays.length * MINUTES_PER_PLAY;

  // artists, by plays
  const artists = [...agg.artists].sort((a, b) => b.plays - a.plays || b.last - a.last);

  // songs, by plays (a song is a title and its artist)
  const songs = new Map();
  for (const s of plays) {
    const key = `${s.a}\u0000${s.t}`;
    const e = songs.get(key) || { title: s.t, artist: agg.byId.get(s.a), plays: 0, cover: null, last: 0 };
    e.plays += 1;
    if (s.ts > e.last) { e.last = s.ts; e.cover = s.c || e.cover; }
    songs.set(key, e);
  }
  const topSongs = [...songs.values()].sort((a, b) => b.plays - a.plays || b.last - a.last);

  // styles, by plays
  const styles = [...agg.families].sort((a, b) => b.plays - a.plays);

  // hours of the day
  const hours = agg.hours;
  const peak = hours.indexOf(Math.max(...hours));
  const night = plays.filter((s) => new Date(s.ts * 1000).getHours() < 6).length;

  // the longest run of the same artist, one play after the other
  const chrono = [...plays].reverse();
  let run = { artist: null, n: 0 };
  let cur = { artist: null, n: 0 };
  for (const s of chrono) {
    cur = s.a === cur.artist ? { artist: s.a, n: cur.n + 1 } : { artist: s.a, n: 1 };
    if (cur.n > run.n) run = cur;
  }

  // sessions: plays less than 20 minutes apart
  let best = { n: 0, from: 0, to: 0 };
  let start = chrono[0].ts;
  let count = 0;
  let prev = null;
  for (const s of chrono) {
    if (prev !== null && s.ts - prev > SESSION_GAP) { start = s.ts; count = 0; }
    count += 1;
    prev = s.ts;
    if (count > best.n) best = { n: count, from: start, to: s.ts };
  }

  return {
    plays: plays.length,
    minutes,
    artistsCount: artists.length,
    songsCount: songs.size,
    topArtists: artists.slice(0, 5),
    topSongs: topSongs.slice(0, 5),
    styles,
    hours,
    peak,
    nightShare: night / plays.length,
    run: { artist: agg.byId.get(run.artist), n: run.n },
    session: { n: best.n, minutes: Math.max(MINUTES_PER_PLAY, (best.to - best.from) / 60 + MINUTES_PER_PLAY) },
  };
}

/** 3.5 -> "4 min", 200 -> "3 h 20" */
export function duration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
