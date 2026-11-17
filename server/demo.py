"""Fake listening data, for working on the page before Last.fm has enough songs.

Turned on with DEMO=1, or when no LASTFM_API_KEY is set. The page says clearly
that the data is fake. The artists are invented, and their covers are drawn here
as SVG, so the demo makes no call to anything outside.
"""

import hashlib
import math
import random
from html import escape

# family, artist, tags (strongest first), tracks
ARTISTS = [
    ("rap", "Béton Lunaire", ["rap", "french rap", "cloud rap"], ["Périph", "Néon 93", "Satellite"]),
    ("rap", "MC Ardoise", ["hip-hop", "boom bap", "jazz rap"], ["Craie", "Tableau noir"]),
    ("rap", "Kessel & Fils", ["french rap", "trap"], ["Ascenseur", "Zone B", "Plafond"]),
    ("rap", "Lila Drill", ["drill", "uk drill"], ["Nord", "Quai 4"]),
    ("electro", "Vapeur Analogique", ["electronic", "synthwave", "night"], ["Autoroute 3h", "Halogène"]),
    ("electro", "Moiré", ["techno", "minimal"], ["Trame", "Grille 128", "Interférence"]),
    ("electro", "Station Orbe", ["ambient", "electronic", "night"], ["Apogée", "Périgée"]),
    ("electro", "Club Sans Nom", ["house", "deep house"], ["Vestiaire", "4 du mat"]),
    ("rock", "Les Fusibles", ["rock", "post-punk", "french"], ["Court-circuit", "Ampère"]),
    ("rock", "Granite Bleu", ["shoegaze", "dream pop", "rock"], ["Brume", "Larsen doux"]),
    ("rock", "Orage Sec", ["metal", "hardcore"], ["Foudre", "Tôle"]),
    ("pop", "Juliette Néon", ["pop", "synthpop", "french"], ["Écran tactile", "Rose fluo", "Bis"]),
    ("pop", "Les Sirènes FM", ["pop", "dance"], ["Fréquence", "Refrain"]),
    ("soul", "Velours Quartet", ["jazz", "soul", "night"], ["Contrebasse", "Minuit pile"]),
    ("soul", "Sœur Groove", ["funk", "disco"], ["Paillettes", "Boule à facettes"]),
    ("soul", "Ambre R.", ["r&b", "neo-soul"], ["Miel", "Tard"]),
    ("folk", "Cabane Nord", ["folk", "indie", "acoustic"], ["Bois flotté", "Lanterne"]),
    ("folk", "Petit Cerf", ["indie", "singer-songwriter", "french"], ["Clairière", "Pull trop grand"]),
    ("classique", "Orchestre de Poche", ["classical", "orchestral"], ["Allegro 2", "Nocturne"]),
    ("classique", "Studio Pixel", ["soundtrack", "video game music"], ["Niveau 1", "Boss final"]),
    ("monde", "Salsa Calibre", ["latin", "salsa"], ["Calor", "Clave"]),
    ("monde", "Afro Délice", ["afrobeats", "afro"], ["Soleil", "Lagos-Paris"]),
]

FAMILY_HUES = {
    "electro": "#38c8ff", "rap": "#ff8a1f", "folk": "#5be37d", "rock": "#ff3d5a",
    "soul": "#ffd23f", "classique": "#b07cff", "monde": "#7dffe0", "pop": "#ff7ad9",
}


def demo_tags():
    return {name: [(tag, 100 - 20 * i) for i, tag in enumerate(tags)] for _f, name, tags, _t in ARTISTS}


# invented artists that the demo artists "sound like", so the network view has a halo
DEMO_GHOSTS = ["Halo Diesel", "Nuit Blanche Club", "Papier Calque", "Les Antennes", "Sable Rouge",
               "Chrome Doux", "Marée Basse", "Kilomètre 0", "Lune de Poche", "Bureau 404",
               "Les Néons Tristes", "Carton Pâte", "Velcro", "Miroir Sans Tain"]


def demo_similar():
    """Artists sharing a tag are similar; each also gets two invented names."""
    out = {}
    for i, (_f, name, tags, _t) in enumerate(ARTISTS):
        close = [(other, round(0.9 - 0.1 * k, 2)) for k, (_g, other, otags, _u) in enumerate(
            a for a in ARTISTS if a[1] != name and set(a[2]) & set(tags))][:4]
        close += [(DEMO_GHOSTS[(i * 3) % len(DEMO_GHOSTS)], 0.4), (DEMO_GHOSTS[(i * 5 + 1) % len(DEMO_GHOSTS)], 0.3)]
        out[name] = close
    return out


def demo_tracks(now):
    """About 7 days of listening, more in the evening, with a few favourite artists."""
    hour_seed = int(now // 3600)  # the data changes a little every hour
    rng = random.Random(hour_seed)
    weights = [rng.uniform(0.3, 1.0) ** 3 for _ in ARTISTS]
    for favourite in rng.sample(range(len(ARTISTS)), 4):
        weights[favourite] *= 3

    tracks = []
    t = now - 60
    while len(tracks) < 200 and t > now - 7 * 86400:
        hour = (t // 3600) % 24
        busy = 0.15 if 2 <= hour < 8 else (1.0 if 18 <= hour or hour < 1 else 0.55)
        if rng.random() < busy:
            _f, artist, _tags, titles = rng.choices(ARTISTS, weights)[0]
            title = rng.choice(titles)
            tracks.append({
                "artist": artist, "track": title, "album": f"{artist} (album)",
                "image": "demo:" + cover_id(artist), "ts": int(t), "now_playing": False,
            })
            t -= rng.randint(150, 260)  # one song
        else:
            t -= rng.randint(1200, 5400)  # a pause

    _f, artist, _tags, titles = ARTISTS[hour_seed % len(ARTISTS)]
    tracks.insert(0, {"artist": artist, "track": titles[0], "album": f"{artist} (album)",
                      "image": "demo:" + cover_id(artist), "ts": None, "now_playing": True})
    return tracks


def cover_id(artist):
    return "demo-" + hashlib.sha1(artist.encode()).hexdigest()[:10]


def cover_svg(cid):
    """A drawn cover for a demo artist, or None for an unknown id."""
    for family, artist, _tags, _titles in ARTISTS:
        if cover_id(artist) == cid:
            break
    else:
        return None
    hue = FAMILY_HUES.get(family, "#8b8580")
    rng = random.Random(cid)
    rings = "".join(
        f'<circle cx="150" cy="150" r="{r}" fill="none" stroke="{hue}" '
        f'stroke-opacity="{0.25 + 0.6 * rng.random():.2f}" stroke-width="{rng.choice([1, 2, 3])}"/>'
        for r in range(20, 150, rng.choice([12, 16, 22]))
    )
    angle = rng.uniform(0, math.pi)
    x2, y2 = 150 + 140 * math.cos(angle), 150 + 140 * math.sin(angle)
    initials = escape("".join(word[0] for word in artist.split()[:2]).upper())
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">'
        '<rect width="300" height="300" fill="#141211"/>'
        f"{rings}"
        f'<line x1="150" y1="150" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{hue}" stroke-width="3"/>'
        f'<text x="18" y="282" font-family="sans-serif" font-size="34" font-weight="700" '
        f'fill="#f2ede6">{initials}</text></svg>'
    )
