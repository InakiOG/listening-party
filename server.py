import json
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from discogs_scraper import update_collection_cache

ROOT = Path(__file__).resolve().parent
REVIEWS_DB_PATH = ROOT / "reviews-db.json"
REVIEWS_LOCK = threading.Lock()


def ensure_reviews_db():
    if REVIEWS_DB_PATH.exists():
        return

    with REVIEWS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump({}, handle, indent=2)


def read_reviews_store():
    ensure_reviews_db()

    with REVIEWS_DB_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, dict):
        return payload

    return {}


def write_reviews_store(store):
    with REVIEWS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


class ListeningPartyHandler(SimpleHTTPRequestHandler):
    def _send_json(self, payload, status_code=200):
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/reviews":
            params = parse_qs(parsed.query)
            song_key = (params.get("songKey", [""])[0] or "").strip()

            with REVIEWS_LOCK:
                store = read_reviews_store()
                reviews = store.get(song_key, []) if song_key else []

            self._send_json({
                "songKey": song_key,
                "reviews": reviews
            })
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path != "/api/reviews":
            self._send_json({"error": "Not found"}, status_code=404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, status_code=400)
            return

        song_key = str(payload.get("songKey", "")).strip()
        review_payload = payload.get("review") if isinstance(payload.get("review"), dict) else {}

        name = str(review_payload.get("name", "")).strip()
        text = str(review_payload.get("text", "")).strip()

        try:
            rating = float(review_payload.get("rating", 0))
        except (TypeError, ValueError):
            rating = 0

        if not song_key:
            self._send_json({"error": "songKey is required"}, status_code=400)
            return

        if not name:
            self._send_json({"error": "name is required"}, status_code=400)
            return

        if not text:
            self._send_json({"error": "text is required"}, status_code=400)
            return

        if rating < 0.5 or rating > 5:
            self._send_json({"error": "rating must be between 0.5 and 5"}, status_code=400)
            return

        normalized_rating = round(rating * 2) / 2
        created_at = datetime.now(timezone.utc).strftime("%d/%m/%y")

        review_entry = {
            "name": name,
            "text": text,
            "rating": normalized_rating,
            "createdAt": created_at
        }

        with REVIEWS_LOCK:
            store = read_reviews_store()
            existing = store.get(song_key, [])
            if not isinstance(existing, list):
                existing = []

            existing.append(review_entry)
            store[song_key] = existing
            write_reviews_store(store)
            updated_reviews = existing

        self._send_json({
            "songKey": song_key,
            "reviews": updated_reviews
        })


def run_server(port=8000):
    try:
        collection_payload = update_collection_cache()
        print(f"Discogs collection cache refreshed: {collection_payload.get('totalItems', 0)} items")
    except Exception as error:
        print(f"Discogs collection refresh skipped: {error}")

    ensure_reviews_db()
    handler = partial(ListeningPartyHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("", port), handler)
    print(f"Listening Party server running on http://0.0.0.0:{port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server(8000)
