"""Small Last.fm client, written with the Python standard library only.

Two methods are used:
  user.getRecentTracks  the songs you listened to (one call per refresh)
  artist.getTopTags     the styles of an artist (one call per new artist, kept for days)
  artist.getSimilar     the artists close to an artist (one call per new artist, kept for days)

The API key is read from the environment by app.py and passed in here.
It is never logged and never put in an error message, because the request
URL contains it.
"""

import json
import logging
import threading
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("lastfm")

DEFAULT_API_ROOT = "https://ws.audioscrobbler.com/2.0/"
USER_AGENT = "music-map/1.0 (student project)"

# Last.fm returns this image when an album has no cover. We treat it as "no cover".
PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f"


class LastfmError(Exception):
    """Last.fm could not answer. The message is safe to show: it holds no URL and no key."""


def urllib_transport(url, timeout):
    """Do the real HTTP request. Tests replace this function with a fake one."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        # Last.fm sends a JSON body with its error code even on 4xx answers.
        return error.code, error.read()


class LastfmClient:
    def __init__(self, api_key, api_root=DEFAULT_API_ROOT, timeout=8, transport=urllib_transport):
        self._api_key = api_key
        self._api_root = api_root
        self._timeout = timeout
        self._transport = transport
        self._lock = threading.Lock()
        self.calls = {}  # method name -> number of calls, shown at /api/health

    def _get(self, method, **params):
        query = {"method": method, "api_key": self._api_key, "format": "json", **params}
        url = self._api_root + "?" + urllib.parse.urlencode(query)

        with self._lock:
            self.calls[method] = self.calls.get(method, 0) + 1
        log.info("call to Last.fm: %s", method)  # the method only, never the URL

        try:
            status, body = self._transport(url, self._timeout)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise LastfmError(f"Last.fm is unreachable ({type(reason).__name__})") from None

        try:
            data = json.loads(body)
        except (ValueError, TypeError):
            raise LastfmError(f"Last.fm sent an unreadable answer (HTTP {status})") from None

        if isinstance(data, dict) and "error" in data:
            raise LastfmError(f"Last.fm error {data.get('error')}: {data.get('message', '')}")
        if status != 200:
            raise LastfmError(f"Last.fm answered HTTP {status}")
        return data

    def recent_tracks(self, user, limit=200):
        """The last `limit` songs of `user`, newest first, in a simple shape."""
        data = self._get("user.getRecentTracks", user=user, limit=limit)
        tracks = data.get("recenttracks", {}).get("track", [])
        if isinstance(tracks, dict):  # Last.fm sends an object, not a list, when there is one song
            tracks = [tracks]
        return [t for t in (normalize_track(raw) for raw in tracks) if t]

    def artist_tags(self, artist):
        """The main tags of an artist, as [(name, weight from 0 to 100)], strongest first."""
        data = self._get("artist.getTopTags", artist=artist, autocorrect=1)
        tags = data.get("toptags", {}).get("tag", [])
        if isinstance(tags, dict):
            tags = [tags]
        result = []
        for tag in tags:
            try:
                result.append((str(tag["name"]).strip().lower(), int(tag.get("count", 0))))
            except (KeyError, ValueError, TypeError):
                continue
        return result[:15]


    def similar_artists(self, artist, limit=30):
        """Artists close to `artist`, as [(name, match from 0 to 1)], closest first."""
        data = self._get("artist.getSimilar", artist=artist, autocorrect=1, limit=limit)
        items = data.get("similarartists", {}).get("artist", [])
        if isinstance(items, dict):
            items = [items]
        result = []
        for item in items:
            try:
                name = str(item["name"]).strip()
                match = float(item.get("match", 0))
            except (KeyError, ValueError, TypeError):
                continue
            if name:
                result.append((name, round(match, 3)))
        return result[:limit]


def _text(value):
    if isinstance(value, dict):
        return str(value.get("#text") or value.get("name") or "").strip()
    return str(value or "").strip()


def best_image(images):
    """The biggest cover URL, or None when Last.fm only has its placeholder."""
    if not isinstance(images, list):
        return None
    by_size = {img.get("size"): img.get("#text") for img in images if isinstance(img, dict)}
    for size in ("extralarge", "large", "medium", "small"):
        url = by_size.get(size)
        if url and PLACEHOLDER_IMAGE not in url:
            return url
    return None


def normalize_track(raw):
    if not isinstance(raw, dict):
        return None
    artist = _text(raw.get("artist"))
    name = _text(raw.get("name"))
    if not artist or not name:
        return None
    now_playing = str(raw.get("@attr", {}).get("nowplaying", "")).lower() == "true"
    ts = None
    if not now_playing:
        try:
            ts = int(raw["date"]["uts"])
        except (KeyError, ValueError, TypeError):
            return None
    return {
        "artist": artist,
        "track": name,
        "album": _text(raw.get("album")),
        "image": best_image(raw.get("image")),
        "ts": ts,
        "now_playing": now_playing,
    }
