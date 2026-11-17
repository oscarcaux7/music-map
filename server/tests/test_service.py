"""Tests for the rules of the brief. Run them with:  cd server && python -m pytest -q
No network: a fake Last.fm answers instead of the real one.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import shaping  # noqa: E402
from lastfm import LastfmClient, normalize_track  # noqa: E402
from service import MapService, Unavailable  # noqa: E402

KEY = "SECRET-KEY-1234"

RECENT = {"recenttracks": {"track": [
    {"artist": {"#text": "Daft Punk"}, "name": "Veridis Quo", "album": {"#text": "Discovery"},
     "image": [{"size": "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg"}],
     "@attr": {"nowplaying": "true"}},
    {"artist": {"#text": "Daft Punk"}, "name": "One More Time", "album": {"#text": "Discovery"},
     "image": [{"size": "extralarge", "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg"}],
     "date": {"uts": "1763370000"}},
    {"artist": {"#text": "MF DOOM"}, "name": "Rhymes Like Dimes", "album": {"#text": "Operation"},
     "image": [{"size": "extralarge",
                "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png"}],
     "date": {"uts": "1763360000"}},
]}}
TAGS = {
    "Daft Punk": {"toptags": {"tag": [{"name": "electronic", "count": 100}, {"name": "french", "count": 40}]}},
    "MF DOOM": {"toptags": {"tag": [{"name": "Hip-Hop", "count": 100}, {"name": "seen live", "count": 9}]}},
}


# both artists get the same answer: MF DOOM is close to Daft Punk, and to itself (dropped)
SIMILAR = {"similarartists": {"artist": [{"name": "MF DOOM", "match": "0.8"}, {"name": "Madvillain", "match": "0.5"}]}}


class FakeLastfm:
    """Plays the role of ws.audioscrobbler.com. Set .down = True to make it fail."""

    def __init__(self):
        self.down = False
        self.urls = []

    def __call__(self, url, timeout):
        self.urls.append(url)
        if self.down:
            raise OSError("network is unreachable")
        if "user.getrecenttracks" in url.lower():
            return 200, json.dumps(RECENT).encode()
        if "artist.getsimilar" in url.lower():
            return 200, json.dumps(SIMILAR).encode()
        for artist, body in TAGS.items():
            if "artist=" + artist.replace(" ", "+") in url:
                return 200, json.dumps(body).encode()
        return 200, json.dumps({"error": 6, "message": "The artist you supplied could not be found"}).encode()


class Clock:
    def __init__(self):
        self.t = 1763370500.0

    def __call__(self):
        return self.t


@pytest.fixture
def setup(tmp_path):
    fake, clock = FakeLastfm(), Clock()
    client = LastfmClient(KEY, transport=fake)
    service = MapService(client, "oscar", str(tmp_path), recent_ttl=120, clock=clock)
    return service, fake, clock, client, tmp_path


def recent_calls(fake):
    return sum("getrecenttracks" in u.lower() for u in fake.urls)


def test_two_reloads_make_one_call(setup):
    service, fake, *_ = setup
    _, first = service.get_map()
    _, second = service.get_map()
    assert (first, second) == ("miss", "hit")
    assert recent_calls(fake) == 1


def test_cache_expires(setup):
    service, fake, clock, *_ = setup
    service.get_map()
    clock.t += 121
    _, status = service.get_map()
    assert status == "miss" and recent_calls(fake) == 2


def test_styles_are_asked_once_per_artist(setup):
    service, fake, clock, *_ = setup
    service.get_map()
    clock.t += 121
    service.get_map()
    tag_calls = [u for u in fake.urls if "gettoptags" in u.lower()]
    assert len(tag_calls) == 2  # Daft Punk and MF DOOM, once each


def test_lastfm_down_with_saved_data_gives_stale(setup):
    service, fake, clock, *_ = setup
    service.get_map()
    fake.down = True
    clock.t += 500
    payload, status = service.get_map()
    assert status == "stale"
    assert payload["error"] and payload["scrobbles"]


def test_after_a_failure_we_wait_before_asking_again(setup):
    service, fake, clock, *_ = setup
    service.get_map()
    fake.down = True
    clock.t += 500
    service.get_map()
    service.get_map()
    assert recent_calls(fake) == 2  # the first success, then one failed try, not two


def test_lastfm_down_without_data_raises(setup):
    service, fake, *_ = setup
    fake.down = True
    with pytest.raises(Unavailable) as error:
        service.get_map()
    assert KEY not in str(error.value)


def test_saved_snapshot_survives_a_restart(setup):
    service, fake, clock, client, tmp_path = setup
    service.get_map()
    fake.down = True
    clock.t += 1000
    restarted = MapService(client, "oscar", str(tmp_path), clock=clock)
    payload, status = restarted.get_map()
    assert status == "stale" and len(payload["scrobbles"]) == 2


def test_payload_shape(setup):
    service, *_ = setup
    payload, _ = service.get_map()
    names = {a["name"]: a for a in payload["artists"]}
    assert names["Daft Punk"]["family"] == "electro"
    assert names["MF DOOM"]["family"] == "rap"
    assert names["MF DOOM"]["cover"] is None          # the Last.fm placeholder is ignored
    assert "seen live" not in names["MF DOOM"]["tags"]
    assert payload["now_playing"]["t"] == "Veridis Quo"
    assert [s["t"] for s in payload["scrobbles"]] == ["One More Time", "Rhymes Like Dimes"]


def test_key_never_in_payload(setup):
    service, *_ = setup
    payload, _ = service.get_map()
    assert KEY not in json.dumps(payload)
    assert "fastly" not in json.dumps(payload)  # covers go through /api/cover/<id>


def test_single_track_object():
    raw = {"artist": {"#text": "A"}, "name": "B", "date": {"uts": "5"}}
    assert normalize_track(raw)["ts"] == 5


@pytest.mark.parametrize("tags,family", [
    ([("french rap", 100)], "rap"),
    ([("seen live", 100), ("garage rock", 80)], "rock"),
    ([("uk garage", 100)], "electro"),
    ([("dancehall", 100)], "monde"),
    ([("alternative rnb", 100)], "soul"),
    ([("trip-hop", 100)], "electro"),
    ([], "autre"),
])
def test_classify(tags, family):
    assert shaping.classify(tags) == family


def test_demo_mode(tmp_path):
    service = MapService(None, "demo", str(tmp_path))
    payload, status = service.get_map()
    assert status == "demo" and payload["source"] == "demo"
    assert len(payload["scrobbles"]) > 50 and payload["now_playing"]


def test_unknown_artist_is_not_asked_again(setup):
    service, fake, clock, *_ = setup
    TAGS.pop("MF DOOM")  # Last.fm answers "artist not found" for this one now
    try:
        service.get_map()
        clock.t += 121
        service.get_map()
    finally:
        TAGS["MF DOOM"] = {"toptags": {"tag": [{"name": "Hip-Hop", "count": 100}]}}
    asked = [u for u in fake.urls if "gettoptags" in u.lower() and "MF+DOOM" in u]
    assert len(asked) == 1


def wait_similar(service):
    import time as _t
    end = _t.monotonic() + 2
    while service._similar_running and _t.monotonic() < end:
        _t.sleep(0.01)


def test_similar_artists_asked_once_and_linked(setup):
    service, fake, clock, *_ = setup
    service.get_map()
    wait_similar(service)
    clock.t += 121
    payload, _ = service.get_map()
    calls = [u for u in fake.urls if "getsimilar" in u.lower()]
    assert len(calls) == 2  # once per artist, then kept
    ids = {a["name"]: a["id"] for a in payload["artists"]}
    daft = payload["similar"][ids["Daft Punk"]]
    assert {"n": "MF DOOM", "m": 0.8, "id": ids["MF DOOM"]} in daft   # a link to an artist I listened to
    assert {"n": "Madvillain", "m": 0.5} in daft                        # an artist I never played
    assert all(item.get("id") != ids["MF DOOM"] for item in payload["similar"][ids["MF DOOM"]])


def test_cover_candidates_stay_on_lastfm_image_hosts():
    import app
    url = "https://lastfm-img.freetls.fastly.net/i/u/300x300/abc123.jpg"
    candidates = app.cover_candidates(url)
    assert candidates[0] == url                       # the address Last.fm gave comes first
    assert "https://lastfm.freetls.fastly.net/i/u/300x300/abc123.jpg" in candidates
    assert all(c.split("/")[2] in app.COVER_HOSTS for c in candidates)
    assert app.cover_candidates("https://evil.example/i/u/300x300/abc.jpg") == []
