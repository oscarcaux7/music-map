"""Turn Last.fm's raw songs into the data the page draws.

The page receives three lists:
  families   the music styles found, with their plays
  artists    one entry per artist: name, style, tags, a cover
  scrobbles  one entry per song played: when, which artist, which track
The page does the counting per time window and the drawing itself.
"""

import hashlib

# Each family is one region of the map. The page gives each one its colour.
# Order matters twice: it is the order of the regions around the map,
# and it is the order in which a tag is tested (rap before rock, and so on).
FAMILIES = [
    ("electro", "Électro"),
    ("rap", "Rap"),
    ("folk", "Folk et indé"),
    ("rock", "Rock"),
    ("soul", "Soul, jazz, funk"),
    ("classique", "Classique et BO"),
    ("monde", "Musiques du monde"),
    ("pop", "Pop"),
    ("autre", "Autre"),
]
FAMILY_LABELS = dict(FAMILIES)

# For each tag, the families are tested in this order. The first keyword found wins.
KEYWORDS = [
    ("rap", ["hip-hop", "hip hop", "hiphop", "rap", "trap", "drill", "grime", "boom bap"]),
    ("soul", ["soul", "r&b", "rnb", "funk", "jazz", "blues", "disco", "gospel"]),
    ("rock", ["rock", "punk", "metal", "grunge", "shoegaze", "emo", "hardcore", "alternative"]),
    ("electro", ["electro", "electronic", "house", "techno", "edm", "dubstep", "drum and bass",
                 "dnb", "trance", "ambient", "idm", "synthwave", "garage", "breakbeat", "jungle",
                 "hyperpop", "downtempo", "trip-hop", "trip hop", "lo-fi", "lofi"]),
    ("folk", ["folk", "indie", "singer-songwriter", "acoustic", "chanson", "country",
              "americana", "variete", "variété"]),
    ("classique", ["classical", "classique", "soundtrack", "score", "orchestral", "piano",
                   "opera", "instrumental", "neoclassical", "video game music"]),
    ("monde", ["latin", "reggaeton", "reggae", "afro", "dancehall", "salsa", "bossa", "world",
               "amapiano", "zouk", "kompa", "bachata", "flamenco", "raï"]),
    ("pop", ["pop", "dance"]),
]

# Tags that say nothing about the style. They are kept out of the page.
NOISE_TAGS = {
    "seen live", "favorites", "favourite", "favorite", "favourites", "albums i own",
    "my favorites", "love", "beautiful", "awesome", "cool", "male vocalists", "female vocalists",
    "french", "france", "british", "uk", "american", "usa", "canadian", "german", "korean",
    "japanese", "belgian", "swedish", "australian", "spanish", "italian", "brazilian",
    "00s", "10s", "20s", "90s", "80s", "70s", "60s", "2020s", "2010s",
}


def classify(tags):
    """The family of an artist, from its tags (strongest first)."""
    for name, _weight in tags:
        if name in NOISE_TAGS:
            continue
        for family, words in KEYWORDS:
            if any(word in name for word in words):
                return family
    return "autre"


def useful_tags(tags, limit=6):
    """The tags worth showing and linking: no noise, at least a little weight."""
    kept = [name for name, weight in tags if name not in NOISE_TAGS and weight >= 5]
    return kept[:limit]


def short_id(text, prefix=""):
    return prefix + hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def artist_key(name):
    return name.strip().casefold()


def build_payload(tracks, tags_for, now, user, covers):
    """Build the JSON for /api/map.

    tracks    songs from LastfmClient.recent_tracks (or the demo)
    tags_for  function: artist name -> [(tag, weight)], or None while not known yet
    covers    dict that this function fills: cover id -> image URL (used by /api/cover)
    """
    artists = {}
    scrobbles = []
    now_playing = None
    pending = 0

    def cover_id(url):
        if not url:
            return None
        if url.startswith("demo:"):
            return url[len("demo:"):]
        cid = short_id(url, "c")
        covers[cid] = url
        return cid

    for t in tracks:
        key = artist_key(t["artist"])
        if key not in artists:
            tags = tags_for(t["artist"])
            if tags is None:
                pending += 1
                tags = []
            family = classify(tags)
            artists[key] = {
                "id": short_id(key, "a"),
                "name": t["artist"],
                "family": family,
                "tags": useful_tags(tags),
                "cover": None,
            }
        artist = artists[key]
        cid = cover_id(t.get("image"))
        if cid and not artist["cover"]:
            artist["cover"] = cid  # the newest cover we have for this artist

        if t.get("now_playing"):
            if now_playing is None:
                now_playing = {"a": artist["id"], "t": t["track"], "al": t["album"], "c": cid}
            continue
        scrobbles.append({"ts": t["ts"], "a": artist["id"], "t": t["track"], "al": t["album"], "c": cid})

    scrobbles.sort(key=lambda s: s["ts"], reverse=True)
    present = {a["family"] for a in artists.values()}

    return {
        "user": user,
        "now": int(now),
        "families": [{"id": fid, "label": label} for fid, label in FAMILIES if fid in present],
        "artists": sorted(artists.values(), key=lambda a: a["name"].casefold()),
        "scrobbles": scrobbles,
        "now_playing": now_playing,
        "tags_pending": pending,
    }


def similar_payload(payload, similar_for, limit=30):
    """For each artist id, its close artists: {"n": name, "m": match, "id": id if I listened to it}."""
    ids = {artist_key(a["name"]): a["id"] for a in payload["artists"]}
    out = {}
    for a in payload["artists"]:
        items = []
        for name, match in similar_for(a["name"])[:limit]:
            item = {"n": name, "m": match}
            other = ids.get(artist_key(name))
            if other == a["id"]:
                continue
            if other:
                item["id"] = other
            items.append(item)
        if items:
            out[a["id"]] = items
    return out
