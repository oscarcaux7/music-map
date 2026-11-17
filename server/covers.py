"""Finding a cover for a song that Last.fm gives without one.

Last.fm's recent tracks sometimes have no image (a new single, a soundtrack). The server
then looks for one, once per song, in the background:

  1. Last.fm's album page (album.getInfo), with the same key: it often has the image.
  2. Deezer's public search (no key). A result is kept only if its artist and its title
     match the song, so that a wrong cover never shows.

The browser never talks to Deezer: the image goes through /api/cover like the others.
"""

import json
import logging
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from lastfm import USER_AGENT, LastfmError

log = logging.getLogger("covers")

DEEZER_SEARCH = "https://api.deezer.com/search"


def _simple(text):
    """'(D)Juno' -> 'djuno', 'Étoiles' -> 'etoiles': to compare names loosely."""
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def _matches(wanted, found):
    """True when one name contains the other, ignoring case, accents and punctuation."""
    a, b = _simple(wanted), _simple(found)
    return bool(a and b) and (a in b or b in a)


def deezer_transport(url, timeout):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


class CoverFinder:
    def __init__(self, lastfm_client, transport=deezer_transport, timeout=6):
        self.lastfm = lastfm_client
        self.transport = transport
        self.timeout = timeout

    def find(self, artist, track, album):
        """An image URL for this song, or None."""
        if album and self.lastfm is not None:
            try:
                url = self.lastfm.album_image(artist, album)
                if url:
                    return url
            except LastfmError as error:
                log.info("no album image on Last.fm: %s", error)
        return self._deezer(artist, track)

    def _deezer(self, artist, track):
        # several artists ("Walydo & Osirus Jack"): search with the first one only
        first = re.split(r",| & | and | feat\.? | ft\.? | x ", artist, flags=re.I)[0].strip()
        # then, if nothing matches, with the title alone (the checks below still apply)
        for words in (f"{first} {track}", track):
            query = urllib.parse.urlencode({"q": words, "limit": 10})
            log.info("call to Deezer: search")
            try:
                data = self.transport(f"{DEEZER_SEARCH}?{query}", self.timeout)
            except (urllib.error.URLError, OSError, ValueError) as error:
                log.warning("Deezer search failed: %s", type(error).__name__)
                return None
            for hit in (data or {}).get("data") or []:
                name = (hit.get("artist") or {}).get("name", "")
                title = hit.get("title", "")
                cover = (hit.get("album") or {}).get("cover_xl") or (hit.get("album") or {}).get("cover_big")
                # the title must match, and the artist too: "Sydo - 5 étoiles", not "Sto - 5 étoiles".
                # The artist may also be named in the title ("Walydo Session #3 : Osirus Jack").
                if cover and _matches(track, title) and (_matches(first, name) or _simple(first) in _simple(title)):
                    return cover.replace("1000x1000", "500x500")
        return None

