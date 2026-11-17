"""The web server: it serves the page and the API. Python standard library only.

Routes:
  GET /                  the page (files of the folder web/)
  GET /api/map           the listening data, from the cache or from Last.fm
  GET /api/cover/<id>    an album cover, fetched once from Last.fm's image server, then kept on disk
  GET /api/health        a status, with how many calls went to Last.fm

The browser only ever talks to this server. The Content-Security-Policy header
below makes the browser refuse any other address, so the rule is checked by the
browser itself, not only promised.
"""

import json
import logging
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import demo
from lastfm import DEFAULT_API_ROOT, USER_AGENT, LastfmClient
from service import MapService, Unavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", stream=sys.stdout)
log = logging.getLogger("app")

WEB_DIR = os.path.realpath(os.environ.get("WEB_DIR", os.path.join(os.path.dirname(__file__), "..", "web")))
DATA_DIR = os.environ.get("DATA_DIR", "/data")
COVER_DIR = os.path.join(DATA_DIR, "covers")
COVER_HOSTS = ("lastfm.freetls.fastly.net", "lastfm-img.freetls.fastly.net", "lastfm-img2.akamaized.net")
MAX_COVER_BYTES = 3 * 1024 * 1024

SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; "
                               "script-src 'self'; connect-src 'self'; base-uri 'none'; "
                               "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def make_service():
    key = os.environ.get("LASTFM_API_KEY", "").strip()
    user = os.environ.get("LASTFM_USER", "").strip()
    demo_mode = os.environ.get("DEMO", "").strip() in ("1", "true", "yes") or not key or not user
    if demo_mode:
        log.info("demo mode: fake data, no call to Last.fm")
        client = None
        user = user or "demo"
    else:
        client = LastfmClient(key, api_root=os.environ.get("LASTFM_API_ROOT", DEFAULT_API_ROOT))
        log.info("Last.fm mode for user %s", user)
    return MapService(
        client, user, DATA_DIR,
        recent_ttl=int(os.environ.get("RECENT_TTL", "120")),
        tags_ttl=int(os.environ.get("TAGS_TTL_DAYS", "14")) * 86400,
    )


class Handler(BaseHTTPRequestHandler):
    service = None  # set in main()
    server_version = "music-map"
    sys_version = ""

    def log_message(self, fmt, *args):  # one short line per request
        log.info("%s %s", self.command, self.path.split("?")[0])

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path == "/api/map":
                self.api_map()
            elif path.startswith("/api/cover/"):
                self.api_cover(path[len("/api/cover/"):])
            elif path == "/api/health":
                self.api_health()
            elif path.startswith("/api/"):
                self.send_json(404, {"error": "not_found"})
            else:
                self.static(path)
        except BrokenPipeError:
            pass
        except Exception:
            log.exception("unexpected error")
            self.send_json(500, {"error": "server_error", "message": "Server error."})

    # ---------- API ----------

    def api_map(self):
        try:
            payload, status = self.service.get_map()
        except Unavailable:
            self.send_json(503, {
                "error": "lastfm_unreachable",
                "message": "No plays could be received yet.",
                "retry_in": self.service.retry_after,
            }, extra={"X-Cache": "miss"})
            return
        self.send_json(200, payload, extra={"X-Cache": status})

    def api_health(self):
        client = self.service.client
        self.send_json(200, {
            "ok": True,
            "source": "demo" if client is None else "lastfm",
            "lastfm_calls": {} if client is None else dict(client.calls),
        })

    def api_cover(self, cid):
        if not cid.replace("-", "").isalnum() or len(cid) > 40:
            return self.send_json(404, {"error": "not_found"})

        svg = demo.cover_svg(cid) if cid.startswith("demo-") else None
        if svg:
            return self.send_bytes(200, svg.encode(), "image/svg+xml", cache=True)

        cached = os.path.join(COVER_DIR, cid)
        if os.path.exists(cached):
            with open(cached + ".type", encoding="ascii") as f:
                ctype = f.read().strip()
            with open(cached, "rb") as f:
                return self.send_bytes(200, f.read(), ctype, cache=True)

        url = self.service.covers.get(cid)  # only URLs that came from Last.fm's answers
        if not url or urllib.parse.urlsplit(url).hostname not in COVER_HOSTS:
            return self.send_json(404, {"error": "not_found"})
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=8) as resp:
                ctype = resp.headers.get_content_type()
                body = resp.read(MAX_COVER_BYTES + 1)
        except (urllib.error.URLError, OSError):
            return self.send_json(502, {"error": "cover_unreachable"})
        if not ctype.startswith("image/") or len(body) > MAX_COVER_BYTES:
            return self.send_json(502, {"error": "cover_invalid"})
        try:
            os.makedirs(COVER_DIR, exist_ok=True)
            with open(cached, "wb") as f:
                f.write(body)
            with open(cached + ".type", "w", encoding="ascii") as f:
                f.write(ctype)
        except OSError:
            pass
        self.send_bytes(200, body, ctype, cache=True)

    # ---------- the page ----------

    def static(self, path):
        path = urllib.parse.unquote(path)
        if path == "/":
            path = "/index.html"
        full = os.path.realpath(os.path.join(WEB_DIR, path.lstrip("/")))
        if not full.startswith(WEB_DIR + os.sep) or not os.path.isfile(full):
            return self.send_json(404, {"error": "not_found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self.send_bytes(200, f.read(), ctype, cache=False)

    # ---------- helpers ----------

    def send_json(self, code, data, extra=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers = {"Cache-Control": "no-store", **(extra or {})}
        self.send_bytes(code, body, "application/json; charset=utf-8", headers=headers)

    def send_bytes(self, code, body, ctype, cache=False, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if headers is None:
            headers = {"Cache-Control": "public, max-age=604800, immutable" if cache else "no-cache"}
        for name, value in {**SECURITY_HEADERS, **headers}.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)


def main():
    mimetypes.add_type("text/javascript", ".js")
    Handler.service = make_service()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    log.info("listening on port %d", port)
    server.serve_forever()


if __name__ == "__main__":
    main()
