"""The cache between the page and Last.fm.

Rules from the brief, and where they live here:
  - many visitors must not mean many calls     -> RECENT_TTL: the songs are kept for a short time
  - two reloads in a row make one call          -> the second reload finds the songs in memory
  - when Last.fm fails, the page still works    -> we keep the last good answer and send it, marked "stale"
                                                   (it is also saved on disk, so it survives a restart)
Artist styles change rarely, so they are kept for days (TAGS_TTL), also on disk.
The similar artists too. They are only decoration for the network view, so we never
wait for them: they load in the background and appear on a later refresh.
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import demo
import shaping
from lastfm import LastfmError

log = logging.getLogger("service")


SIMILAR_LIMIT = 30  # similar artists kept per artist: enough to draw a full fan in the sphere


class Unavailable(Exception):
    """Last.fm failed and we have nothing saved to show instead."""


class MapService:
    def __init__(self, client, user, data_dir, recent_ttl=120, tags_ttl=14 * 86400,
                 retry_after=30, tag_budget=4.0, clock=time.time):
        self.client = client  # None in demo mode
        self.user = user
        self.data_dir = data_dir
        self.recent_ttl = recent_ttl
        self.tags_ttl = tags_ttl
        self.retry_after = retry_after
        self.tag_budget = tag_budget
        self.clock = clock

        self._lock = threading.Lock()       # one refresh at a time
        self._tags_lock = threading.Lock()
        self._tracks = None                 # the last good list of songs
        self._fetched_at = 0.0              # when we got it
        self._failed_until = 0.0            # after a failure, wait before asking again
        self._last_error = None
        self._tags = {}                     # artist key -> {"tags": [...], "at": time}
        self._tags_running = set()
        self._similar = {}                  # artist key -> {"similar": [[name, match]], "at": time}
        self._similar_running = set()
        self.covers = {}                    # cover id -> image URL
        self._pool = ThreadPoolExecutor(max_workers=3)
        self._load_from_disk()

    @property
    def demo(self):
        return self.client is None

    # ---------- the one public method used by /api/map ----------

    def get_map(self):
        """Return (payload, cache_status). cache_status is "miss", "hit", "stale" or "demo"."""
        if self.demo:
            now = self.clock()
            tags = demo.demo_tags()
            payload = shaping.build_payload(demo.demo_tracks(now), lambda a: tags.get(a, []),
                                            now, self.user, self.covers)
            demo_similar = demo.demo_similar()
            payload["similar"] = shaping.similar_payload(payload, lambda a: demo_similar.get(a, []))
            payload["similar_pending"] = 0
            return self._finish(payload, "demo", fetched_at=now)

        with self._lock:
            now = self.clock()
            if self._tracks is not None and now - self._fetched_at < self.recent_ttl:
                status = "hit"
            elif now < self._failed_until:
                status = "stale"            # Last.fm failed a moment ago: don't hammer it
            else:
                try:
                    self._tracks = self.client.recent_tracks(self.user)
                    self._fetched_at = now
                    self._last_error = None
                    self._save_snapshot()
                    status = "miss"
                except LastfmError as error:
                    log.warning("Last.fm failed: %s", error)
                    self._failed_until = now + self.retry_after
                    self._last_error = str(error)
                    status = "stale"
            if self._tracks is None:
                raise Unavailable(self._last_error or "Last.fm is unreachable")
            tracks = self._tracks

        if status == "miss":
            self._fetch_missing_tags(tracks)
        self._fetch_missing_similar(tracks)  # never waits; only artists not asked yet
        payload = shaping.build_payload(tracks, self._known_tags, now, self.user, self.covers)
        payload["similar"] = shaping.similar_payload(payload, self._known_similar)
        with self._tags_lock:
            payload["similar_pending"] = len(self._similar_running)
        return self._finish(payload, status, fetched_at=self._fetched_at)

    def _finish(self, payload, status, fetched_at):
        payload["source"] = "demo" if self.demo else "lastfm"
        payload["cache"] = {
            "status": status,
            "fetched_at": int(fetched_at),
            "age": max(0, int(self.clock() - fetched_at)),
            "ttl": self.recent_ttl,
        }
        if status == "stale":
            payload["error"] = "Last.fm ne répond pas. Ce sont les dernières écoutes reçues."
        return payload, status

    # ---------- artist styles ----------

    def _known_tags(self, artist):
        entry = self._tags.get(shaping.artist_key(artist))
        return None if entry is None else entry["tags"]

    def _fetch_missing_tags(self, tracks):
        """Ask Last.fm for the styles of new artists only.

        We wait at most `tag_budget` seconds. Artists still missing after that keep
        loading in the background, and the page shows them on its next refresh.
        """
        now = self.clock()
        names = {}
        for t in tracks:
            key = shaping.artist_key(t["artist"])
            entry = self._tags.get(key)
            if (entry is None or now - entry["at"] > self.tags_ttl) and key not in self._tags_running:
                names[key] = t["artist"]
        if not names:
            return
        with self._tags_lock:
            self._tags_running.update(names)
        futures = [self._pool.submit(self._fetch_tags, key, name) for key, name in names.items()]
        deadline = time.monotonic() + self.tag_budget
        for future in futures:
            try:
                future.result(timeout=max(0.0, deadline - time.monotonic()))
            except Exception:
                pass  # still running, or failed: the page shows "autre" for now

    def _fetch_tags(self, key, name):
        try:
            tags = self.client.artist_tags(name)
            with self._tags_lock:
                self._tags[key] = {"tags": tags, "at": self.clock()}
            self._save_tags()
        except LastfmError as error:
            # Remember the failure for one day, so we don't ask again at every refresh.
            log.warning("tags for one artist failed: %s", error)
            with self._tags_lock:
                self._tags[key] = {"tags": [], "at": self.clock() - self.tags_ttl + 86400}
        finally:
            with self._tags_lock:
                self._tags_running.discard(key)

    # ---------- similar artists (for the network view) ----------

    def _known_similar(self, artist):
        entry = self._similar.get(shaping.artist_key(artist))
        return [] if entry is None else entry["similar"]

    def _fetch_missing_similar(self, tracks):
        """Start the calls for new artists, without waiting for them."""
        now = self.clock()
        names = {}
        for t in tracks:
            key = shaping.artist_key(t["artist"])
            entry = self._similar.get(key)
            too_short = entry is not None and entry.get("lim", 0) < SIMILAR_LIMIT  # saved by an older version
            if (entry is None or too_short or now - entry["at"] > self.tags_ttl) and key not in self._similar_running:
                names[key] = t["artist"]
        with self._tags_lock:
            self._similar_running.update(names)
        for key, name in names.items():
            self._pool.submit(self._fetch_similar, key, name)

    def _fetch_similar(self, key, name):
        try:
            similar = [[n, m] for n, m in self.client.similar_artists(name, limit=SIMILAR_LIMIT)]
            at = self.clock()
        except LastfmError as error:
            log.warning("similar artists for one artist failed: %s", error)
            similar, at = [], self.clock() - self.tags_ttl + 86400  # ask again tomorrow
        with self._tags_lock:
            self._similar[key] = {"similar": similar, "at": at, "lim": SIMILAR_LIMIT}
            self._similar_running.discard(key)
            data = dict(self._similar)
        self._write_json("similar.json", data)

    # ---------- disk: keeps the last answer and the styles across restarts ----------

    def _path(self, name):
        return os.path.join(self.data_dir, name)

    def _write_json(self, name, data):
        if not self.data_dir:
            return
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            tmp = self._path(name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, self._path(name))  # never leaves a half-written file
        except OSError as error:
            log.warning("could not save %s: %s", name, error)

    def _save_snapshot(self):
        self._write_json("snapshot.json", {"user": self.user, "fetched_at": self._fetched_at,
                                           "tracks": self._tracks})

    def _save_tags(self):
        with self._tags_lock:
            data = dict(self._tags)
        self._write_json("tags.json", data)

    def _load_from_disk(self):
        if not self.data_dir:
            return
        try:
            with open(self._path("snapshot.json"), encoding="utf-8") as f:
                snap = json.load(f)
            if snap.get("user") == self.user:
                self._tracks = snap["tracks"]
                # Saved songs are old by definition: the first visit still asks Last.fm.
                self._fetched_at = float(snap["fetched_at"])
        except (OSError, ValueError, KeyError):
            pass
        try:
            with open(self._path("tags.json"), encoding="utf-8") as f:
                self._tags = json.load(f)
        except (OSError, ValueError):
            pass
        try:
            with open(self._path("similar.json"), encoding="utf-8") as f:
                self._similar = json.load(f)
        except (OSError, ValueError):
            pass
