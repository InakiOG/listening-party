import json
import argparse
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from discogs_scraper import update_collection_cache

ROOT = Path(__file__).resolve().parent
REVIEWS_DB_PATH = ROOT / "reviews-db.json"
USERS_DB_PATH = ROOT / "users-db.json"
NOW_PLAYING_PATH = ROOT / "now-playing.json"
REVIEWS_LOCK = threading.Lock()


def ensure_reviews_db():
    if REVIEWS_DB_PATH.exists():
        return

    with REVIEWS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump({}, handle, indent=2)


def ensure_users_db():
    if USERS_DB_PATH.exists():
        return

    with USERS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump({}, handle, indent=2)


def read_reviews_store():
    ensure_reviews_db()

    with REVIEWS_DB_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, dict):
        return payload

    return {}


def read_users_store():
    ensure_users_db()

    with USERS_DB_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, dict):
        return payload

    return {}


def write_reviews_store(store):
    with REVIEWS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def write_users_store(store):
    with USERS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def normalize_user_key(name):
    return str(name or "").strip().lower()


def sanitize_user_profile(profile):
    if not isinstance(profile, dict):
        return None

    return {
        "name": str(profile.get("name", "")).strip(),
        "photoDataUrl": str(profile.get("photoDataUrl", "")).strip(),
        "createdAt": str(profile.get("createdAt", "")).strip()
    }


def build_user_reviews(store, user_name):
    normalized_name = normalize_user_key(user_name)
    if not normalized_name:
        return []

    records = []

    for review_key, review_list in store.items():
        if not isinstance(review_list, list):
            continue

        for review in review_list:
            if not isinstance(review, dict):
                continue

            reviewer_name = str(review.get("name", "")).strip()
            if normalize_user_key(reviewer_name) != normalized_name:
                continue

            is_album = str(review_key).startswith("album::")
            scope = "album" if is_album else "song"
            album_title = ""
            song_title = ""

            if is_album:
                _, _, rest = str(review_key).partition("album::")
                parts = [segment for segment in rest.split("::") if segment]
                if parts:
                    album_title = parts[-1]
            else:
                parts = str(review_key).split("::", 1)
                album_title = parts[0].strip() if parts else ""
                song_title = parts[1].strip() if len(parts) > 1 else ""

            records.append({
                "scope": scope,
                "albumTitle": album_title,
                "songTitle": song_title,
                "text": str(review.get("text", "")).strip(),
                "rating": float(review.get("rating", 0) or 0),
                "createdAt": str(review.get("createdAt", "")).strip(),
                "reviewKey": review_key
            })

    records.sort(key=lambda entry: entry.get("createdAt", ""), reverse=True)
    return records


def clear_now_playing():
    if NOW_PLAYING_PATH.exists():
        NOW_PLAYING_PATH.unlink()


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

        if parsed.path == "/api/users":
            params = parse_qs(parsed.query)
            name = (params.get("name", [""])[0] or "").strip()
            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                user_profile = sanitize_user_profile(users_store.get(user_key)) if user_key else None

            self._send_json({
                "exists": bool(user_profile),
                "user": user_profile
            })
            return

        if parsed.path == "/api/users/reviews":
            params = parse_qs(parsed.query)
            name = (params.get("name", [""])[0] or "").strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            with REVIEWS_LOCK:
                reviews_store = read_reviews_store()
                user_reviews = build_user_reviews(reviews_store, name)

            self._send_json({
                "name": name,
                "reviews": user_reviews
            })
            return

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

        if parsed.path == "/api/users/register":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            name = str(payload.get("name", "")).strip()
            photo_data_url = str(payload.get("photoDataUrl", "")).strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()

                if user_key in users_store:
                    self._send_json({"error": "name already exists"}, status_code=409)
                    return

                profile = {
                    "name": name,
                    "photoDataUrl": photo_data_url,
                    "createdAt": datetime.now(timezone.utc).isoformat()
                }

                users_store[user_key] = profile
                write_users_store(users_store)

            self._send_json({
                "user": sanitize_user_profile(profile)
            })
            return

        if parsed.path == "/api/users/login":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            name = str(payload.get("name", "")).strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                user_profile = sanitize_user_profile(users_store.get(user_key))

            if not user_profile:
                self._send_json({"error": "user not found"}, status_code=404)
                return

            self._send_json({"user": user_profile})
            return

        if parsed.path == "/api/users/photo":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            name = str(payload.get("name", "")).strip()
            photo_data_url = str(payload.get("photoDataUrl", "")).strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            if not photo_data_url:
                self._send_json({"error": "photoDataUrl is required"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                profile = users_store.get(user_key)

                if not isinstance(profile, dict):
                    self._send_json({"error": "user not found"}, status_code=404)
                    return

                profile["photoDataUrl"] = photo_data_url
                users_store[user_key] = profile
                write_users_store(users_store)

                updated_profile = sanitize_user_profile(profile)

            self._send_json({"user": updated_profile})
            return

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
        review_scope = str(payload.get("scope", "song")).strip().lower()
        review_payload = payload.get("review") if isinstance(payload.get("review"), dict) else {}

        name = str(review_payload.get("name", "")).strip()
        photo_data_url = str(review_payload.get("photoDataUrl", "")).strip()
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

        if rating < 0.5 or rating > 5:
            self._send_json({"error": "rating must be between 0.5 and 5"}, status_code=400)
            return

        normalized_rating = round(rating * 2) / 2
        created_at = datetime.now(timezone.utc).strftime("%d/%m/%y")

        review_entry = {
            "name": name,
            "photoDataUrl": photo_data_url,
            "text": text,
            "rating": normalized_rating,
            "createdAt": created_at,
            "scope": "album" if review_scope == "album" else "song"
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


def run_server(port=8000, refresh_discogs=False):
    clear_now_playing()

    if refresh_discogs:
        try:
            collection_payload = update_collection_cache()
            print(f"Discogs collection cache refreshed: {collection_payload.get('totalItems', 0)} items")
        except Exception as error:
            print(f"Discogs collection refresh skipped: {error}")
    else:
        print("Using local discogs-collection.json cache (no startup refresh).")

    ensure_reviews_db()
    ensure_users_db()
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
    parser = argparse.ArgumentParser(description="Listening Party server")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind the HTTP server")
    parser.add_argument(
        "--refresh-discogs",
        action="store_true",
        help="Refresh discogs-collection.json from Discogs at startup"
    )
    args = parser.parse_args()
    run_server(args.port, refresh_discogs=args.refresh_discogs)
