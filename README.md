# The map of my plays

**Online: https://student02.wt.thomasjuldo.com**

My recent music from Last.fm, drawn two ways, with a "wrapped" of the period underneath. Buttons switch between them.

**Spiral** (after the timeline poster of the HfG Schwäbisch Gmünd)

- **Time winds down a green ribbon.** The spiral fits my plays: whatever the window (3 h, 24 h, 7 days, all), it runs from my first play of the period to now, in 4 to 7 turns of a round length (10 minutes … 30 days). A flag says where it starts when it is shorter than the window. Covers close in time stand side by side instead of piling up; a hairline points to the exact time of a cover that had to move. Zooming out gathers the covers into bands; zooming in, they glide apart towards their times. A slider stretches the spiral, from a tight coil to a long spring hanging from now. The ribbon starts at **now**, its top end, marked by a round cap and a `NOW` flag, and winds down into the past.
- **Each play is its album cover**, sitting on the ribbon. Flags mark the turns (`Tue 17`, `14:30`). Ticks mark every hour, or every 5 minutes in the 3 h view.
- **The grey web is the correlations.** Vertical lines drop from each cover to the loop below; each play is joined to the plays of other artists that share its Last.fm tags, by a curve through the inside of the spiral; plays of the same artist are chained. When many plays share one turn, the covers shrink so the links stay visible.
- **The song playing now** sits above the spiral, with a pulsing frame.

**Sphere** (after the hyperbolic graph viewers, and network "starburst" graphs)

- **A tree inside a wireframe globe.** Now is the centre; then the styles; then my artists; then a starburst around each artist with its songs, one dot per play, its tags and up to 30 similar artists from Last.fm.
- **Bridges** inside the globe are the strongest tags or similar artists shared by several of my artists: they draw the web between the clusters. **Green arcs** join two artists I played that Last.fm finds similar.
- **Hover** an artist: the rest fades away and its songs, tags and similar artists are named, without overlap. **Click** it: the camera flies to it.
- **The same slider** ("Compact / Spread") opens the sphere inside a globe that keeps its size: the artists of a style move apart around the surface, and each starburst opens wider.


**Wrapped**, under the drawing: the plays and the estimated time of the period, the top artist on its cover, the top song, the top 5 artists and songs, the styles, the busiest hour, the longest run of one artist and the longest session. Last.fm does not give the length of a song, so time is estimated at 3½ minutes per play, and the page says so.

All views fill the screen, with a thin header bar on top, and follow the light or dark theme. Both turn, move and zoom: drag to move, right-drag or Shift-drag to turn, Ctrl + wheel, pinch or double-click to zoom. Hover or tap a cover or a point for its card. Under the drawing, a pin board of the last songs and a table of the artists show the same data without the drawing. Light and dark themes.

## Start it

You need Docker with its Compose plugin.

```bash
git clone https://github.com/oscarcaux7/music-map.git
cd music-map
docker compose up --build
```

Open http://localhost:8080. Without a key, the page shows **demo data** (invented artists), and says so.

To see your own music, create the file `.env` next to `compose.yaml`:

```bash
cp .env.example .env
# then write your key and your user name in .env
docker compose up --build
```

- `LASTFM_API_KEY`: create one at https://www.last.fm/api/account/create
- `LASTFM_USER`: your Last.fm user name
- `RECENT_TTL` (optional): seconds during which the server reuses Last.fm's answer, 60 by default
- `DEMO=1` (optional): fake data, no call to Last.fm

`.env` is in `.gitignore`: the key never goes to GitHub.

## Online

The site runs on my practice server (Ubuntu, Docker), at https://student02.wt.thomasjuldo.com.

```
internet ──► Caddy (ports 80 and 443, HTTPS certificate) ──► app (port 8000, not published) ──► Last.fm
```

- `compose.server.yaml` is added on top of `compose.yaml` on the server only: the app publishes no port, Caddy is the only service facing the internet, both restart by themselves (`restart: unless-stopped`), and Caddy keeps its certificates in a volume.
- `Caddyfile` sends every request to the app. The address comes from `SITE_ADDRESS` in `.env`.
- The key is only in `.env` on the server, written by hand, never in Git.

Start it on the server (the first time):

```bash
git clone https://github.com/oscarcaux7/music-map.git
cd music-map
nano .env            # LASTFM_API_KEY, LASTFM_USER, SITE_ADDRESS (see .env.example)
docker compose -f compose.yaml -f compose.server.yaml up -d --build
```

**How a change goes online:** I change the code on my laptop, commit and push to GitHub; then on the server:

```bash
cd music-map && git pull && docker compose -f compose.yaml -f compose.server.yaml up -d --build
```

**If the server goes down,** the same commands run on any machine with Docker: clone, write `.env`, start. Nothing else needs saving: Last.fm is the source of the data, and the volume only holds a cache (the last answer, the styles, the covers) and Caddy's certificates, which come back by themselves. With a domain pointing to the new machine, put it in `SITE_ADDRESS` and Caddy gets a new certificate; without one, `SITE_ADDRESS=:80` serves the site in plain HTTP on the machine's address. On a laptop, `docker compose up` alone is enough (http://localhost:8080).

**After a scrobble** (FastScrobbler, Spotify, any app connected to Last.fm): the app sends the song to Last.fm, my server asks Last.fm again once its cache is older than `RECENT_TTL` (60 s), and the page asks my server every minute, and as soon as I come back to it. So a new song shows within about a minute, and the song playing now shows at the top of the spiral. There is no database of my own to update: Last.fm is the database, my server only keeps a copy for a short time.

## How it works

```
browser ──► my server (Python, port 8000 in the container, 8080 outside) ──► Last.fm
            │ /            the page (web/)
            │ /api/map     the songs, from the cache or from Last.fm
            │ /api/cover   the covers, fetched once, then kept on disk
            │ /api/health  how many calls went to Last.fm, per method
```

- **A song without a cover.** Last.fm sometimes gives a song with no image (a new single, a soundtrack). The server then looks for one, once per song and in the background: Last.fm's album page (`album.getInfo`) first, then Deezer's public search, keeping a result only if its artist and title match. The answer is kept 30 days (a miss is tried again the next day) in `extra_covers.json`, and the image goes through `/api/cover` like the others. When Last.fm's image server refuses a cover, the server tries its other addresses.
- **The browser only talks to my server.** The server sends a `Content-Security-Policy` header that forbids the page to contact any other address, so the browser itself enforces the rule. Covers are served by `/api/cover/<id>`, not loaded from Last.fm's image server.
- **The key stays on the server.** It is read from an environment variable, and never written in the page, in a log or in an error message.
- **Cache.** The server keeps the recent songs (`user.getRecentTracks`) for `RECENT_TTL` seconds. Two reloads in a row make one call: the response header `X-Cache` says `miss` the first time, `hit` the second. The styles of an artist (`artist.getTopTags`) and its similar artists (`artist.getSimilar`) are asked once per new artist, then kept for 14 days on disk. The page never waits for the similar artists: they load in the background.
- **When Last.fm fails,** the server sends the last answer it received (also saved on disk, so it survives a restart), marked `stale`, and waits 30 seconds before asking Last.fm again. The page says that the data is not fresh. If nothing was ever received, the page shows a message with a button to try again.
- **Phone and laptop.** The drawing fills the width, the card becomes a bottom sheet, two fingers move and zoom, and the pin board and the table work without the drawing.

The server uses the Python standard library only, and the page plain JavaScript with no library and no build step: nothing to install.

## Files

| File | Role |
|------|------|
| `server/app.py` | the web server and its routes, the security headers |
| `server/lastfm.py` | the calls to Last.fm |
| `server/service.py` | the cache, the saved copy on disk, the styles and the similar artists |
| `server/shaping.py` | turns songs into the data the page draws, finds each style |
| `server/covers.py` | a cover for a song that Last.fm gives without one (Last.fm's album page, then Deezer) |
| `server/demo.py` | the demo data and its drawn covers |
| `web/main.js` | loading, views, pointer, zoom, keyboard, theme, refresh every minute |
| `web/data.js` | the request to `/api/map`, counting per period |
| `web/layout.js` | the styles, the artists, the links between artists that share a tag |
| `web/scene.js` | the spiral and the sphere, drawn on a canvas by hand (3D projection, zoom, camera) |
| `web/stats.js` | the numbers of the "wrapped" section |
| `web/ui.js` | the card, the legend, the wrapped cards, the pin board, the table, the messages |

## Check the rules

```bash
# two reloads, one call: miss, then hit
curl -s -D - -o /dev/null localhost:8080/api/map | grep -i x-cache
curl -s -D - -o /dev/null localhost:8080/api/map | grep -i x-cache
curl -s localhost:8080/api/health        # "user.getRecentTracks": 1

# the calls, one line each, in the logs
docker compose logs -f app | grep "call to Last.fm"

# Last.fm unreachable: point the server to an address that does not answer
LASTFM_API_ROOT=http://10.255.255.1/ RECENT_TTL=1 docker compose up -d
# the page keeps the last songs and says that Last.fm does not answer.
# To see the message with no saved data at all, first remove the volume:
docker compose down -v

# the key is in no commit
git log -p --all | grep -c "$(grep LASTFM_API_KEY .env | cut -d= -f2)"   # must print 0

# tests of the cache and of the failures (no network needed)
cd server && python -m pytest -q
```

In the browser's Network tab, every request goes to `localhost:8080`.
