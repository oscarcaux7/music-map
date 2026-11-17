# La carte de mes écoutes

My recent music from Last.fm, drawn two ways. A button switches between them.

**Spirale** (after the timeline poster of the HfG Schwäbisch Gmünd)

- **Time winds down a green ribbon.** One turn per half hour (3 h), per 4 hours (24 h) or per day (7 days). The newest song is at the top; above it the ribbon opens into wide, empty loops: the time to come.
- **Each play is its album cover**, sitting on the ribbon. Black flags mark the turns (`mar. 17`, `14 h 30`). Ticks mark every hour, or every 5 minutes in the 3 h view.
- **The grey web is the correlations.** Vertical lines drop from each cover to the loop below; every play of a style is pulled to one point on the axis, so the bundles cross in the middle; each play is joined to the plays of other artists that share its Last.fm tags; plays of the same artist are chained.
- **The song playing now** sits above the spiral, with a pulsing frame.

**Sphère** (after the hyperbolic graph viewers, and network "starburst" graphs)

- **A tree inside a wireframe globe.** Now is the centre; then the styles; then my artists; then a starburst around each artist with its songs, one dot per play, its tags and up to 30 similar artists from Last.fm.
- **Bridges** inside the globe are tags or similar artists shared by several of my artists: they draw the web between the clusters. **Green arcs** join two artists I played that Last.fm finds similar.

Both views turn, move and zoom: drag to move, right-drag or Shift-drag to turn, Ctrl + wheel, pinch or double-click to zoom. Hover or tap a cover or a point for its card. Under the drawing, a pin board of the last songs and a table of the artists show the same data without the drawing. Light and dark themes.

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
- `RECENT_TTL` (optional): seconds during which the server reuses Last.fm's answer, 120 by default
- `DEMO=1` (optional): fake data, no call to Last.fm

`.env` is in `.gitignore`: the key never goes to GitHub.

## How it works

```
browser ──► my server (Python, port 8000 in the container, 8080 outside) ──► Last.fm
            │ /            the page (web/)
            │ /api/map     the songs, from the cache or from Last.fm
            │ /api/cover   the covers, fetched once, then kept on disk
            │ /api/health  how many calls went to Last.fm, per method
```

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
| `server/demo.py` | the demo data and its drawn covers |
| `web/main.js` | loading, views, pointer, zoom, keyboard, theme, refresh every minute |
| `web/data.js` | the request to `/api/map`, counting per period |
| `web/layout.js` | the styles, the artists, the links between artists that share a tag |
| `web/scene.js` | the spiral and the sphere, drawn on a canvas by hand (3D projection, zoom) |
| `web/ui.js` | the card, the legend, the pin board, the table, the messages |

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
