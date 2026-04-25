import json
import argparse
import os
import secrets
import threading
import urllib.request
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from discogs_scraper import backfill_missing_tracks, update_collection_cache

ROOT = Path(__file__).resolve().parent

# Load .env file if present (never overwrites a real env var)
_env_path = ROOT / ".env"
if _env_path.exists():
    with _env_path.open(encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())
REVIEWS_DB_PATH = ROOT / "reviews-db.json"
USERS_DB_PATH = ROOT / "users-db.json"
CREDENTIALS_DB_PATH = ROOT / "user-credentials.local.json"
NOW_PLAYING_PATH = ROOT / "now-playing.json"
PARTY_RECORDS_PATH = ROOT / "party-records.json"
LIVE_ALBUMS_PATH = ROOT / "live-albums.json"
COLLECTION_PATH = ROOT / "discogs-collection.json"
REVIEWS_LOCK = threading.Lock()
LIVE_ALBUMS_LOCK = threading.Lock()
_current_session = None
_fun_facts_cache = {}
_fun_facts_lock = threading.Lock()
ADMIN_USER_KEY = "iñaki"
ADMIN_DEFAULT_NAME = "Iñaki"
ADMIN_DEFAULT_PASSWORD = "14agosto"
ADMIN_ACCOUNT_NAME = "administrador"
SESSION_COOKIE_NAME = "listening_party_session"
SESSION_USER_COOKIE_NAME = "listening_party_user"
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10
ACTIVE_USER_WINDOW_SECONDS = 90


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


def ensure_credentials_db():
    if CREDENTIALS_DB_PATH.exists():
        return

    with CREDENTIALS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump({}, handle, indent=2)


def ensure_live_albums_db():
    if LIVE_ALBUMS_PATH.exists():
        return
    with LIVE_ALBUMS_PATH.open("w", encoding="utf-8") as handle:
        json.dump({"albums": []}, handle, indent=2)


def read_live_albums_store():
    ensure_live_albums_db()
    try:
        with LIVE_ALBUMS_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, OSError):
        data = {"albums": []}
    if not isinstance(data, dict) or not isinstance(data.get("albums"), list):
        data = {"albums": []}
    return data


def write_live_albums_store(store):
    with LIVE_ALBUMS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def ensure_party_records_db():
    if PARTY_RECORDS_PATH.exists():
        return

    with PARTY_RECORDS_PATH.open("w", encoding="utf-8") as handle:
        json.dump({"parties": []}, handle, indent=2)


def read_json_dict_or_reset(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (json.JSONDecodeError, OSError):
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    # Persist normalized content so future reads stay valid.
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)

    return payload


def read_reviews_store():
    ensure_reviews_db()
    return read_json_dict_or_reset(REVIEWS_DB_PATH)


def read_users_store():
    ensure_users_db()
    return read_json_dict_or_reset(USERS_DB_PATH)


def read_credentials_store():
    ensure_credentials_db()
    return read_json_dict_or_reset(CREDENTIALS_DB_PATH)


def write_reviews_store(store):
    with REVIEWS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def write_users_store(store):
    with USERS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def write_credentials_store(store):
    with CREDENTIALS_DB_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def read_party_records_store():
    ensure_party_records_db()
    try:
        with PARTY_RECORDS_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (json.JSONDecodeError, OSError):
        payload = {"parties": []}

    if not isinstance(payload, dict):
        payload = {"parties": []}
    if not isinstance(payload.get("parties"), list):
        payload["parties"] = []

    return payload


def write_party_records_store(store):
    with PARTY_RECORDS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, indent=2)


def parse_review_date_key(value):
    text = str(value or "").strip()
    if not text:
        return ""

    if len(text) >= 10:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass

    try:
        return datetime.strptime(text, "%d/%m/%y").date().isoformat()
    except ValueError:
        return ""


def get_session_date_key(session_payload):
    started_at = str((session_payload or {}).get("startedAt", "")).strip()
    if not started_at:
        return ""

    try:
        return datetime.fromisoformat(started_at.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return started_at[:10]


def collect_reviews_for_albums(reviews_store, albums_played, review_date_filter="", party_id_filter=""):
    reviews = []
    album_titles_lower = {
        str(a.get("title", "")).strip().lower()
        for a in albums_played
        if str(a.get("title", "")).strip()
    }
    if not album_titles_lower:
        return reviews

    for review_key, review_list in reviews_store.items():
        if not isinstance(review_list, list):
            continue

        key_str = str(review_key)
        is_album_key = key_str.startswith("album::")

        if is_album_key:
            rest = key_str[len("album::"):]
            parts = [p for p in rest.split("::") if p]
            if not parts:
                continue
            album_title = parts[-1].strip()
            song_title_val = ""
        else:
            parts = key_str.split("::", 1)
            album_title = parts[0].strip()
            song_title_val = parts[1].strip() if len(parts) > 1 else ""

        if album_title.lower() not in album_titles_lower:
            continue

        for r in review_list:
            if not isinstance(r, dict):
                continue
            review_party_id = str(r.get("partyId") or "").strip()
            if review_party_id:
                if review_party_id != party_id_filter:
                    continue
            else:
                review_date_key = parse_review_date_key(r.get("createdAt", ""))
                if review_date_key and review_date_key != review_date_filter:
                    continue
            raw_likes = r.get("likes") or []
            likes = [
                {"name": str(l.get("name", "")).strip(), "photoDataUrl": str(l.get("photoDataUrl", "")).strip()}
                for l in raw_likes
                if isinstance(l, dict) and str(l.get("name", "")).strip()
            ]
            reviews.append({
                "reviewer": str(r.get("name", "")).strip(),
                "albumTitle": album_title,
                "songTitle": song_title_val,
                "rating": float(r.get("rating", 0) or 0),
                "text": str(r.get("text", "")).strip(),
                "scope": "album" if is_album_key else "song",
                "createdAt": str(r.get("createdAt", "")).strip(),
                "likes": likes
            })

    return reviews


def collect_active_attendees(users_store, credentials_store, include_admin=True):
    attendees = []
    for user_key, credentials_entry in credentials_store.items():
        if not read_session_token(credentials_entry):
            continue

        profile = sanitize_user_profile(users_store.get(user_key))
        if not profile:
            continue

        if not include_admin and profile.get("accountName") == ADMIN_ACCOUNT_NAME:
            continue

        attendee_name = str(profile.get("name", user_key)).strip()
        if attendee_name:
            attendees.append(attendee_name)

    unique = []
    seen = set()
    for attendee in attendees:
        key = attendee.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(attendee)

    return unique


def collect_reviewing_attendees(party_reviews):
    attendees = []
    seen = set()

    for review in party_reviews:
        if not isinstance(review, dict):
            continue

        reviewer = str(review.get("reviewer", "")).strip()
        if not reviewer:
            continue

        reviewer_key = reviewer.lower()
        if reviewer_key in seen:
            continue

        seen.add(reviewer_key)
        attendees.append(reviewer)

    return attendees


def collect_session_listeners(session_payload, users_store):
    listeners = []
    seen = set()
    for user_key in get_session_sticky_attendee_keys(session_payload):
        profile = sanitize_user_profile(users_store.get(user_key))
        name = str(profile.get("name", user_key) if profile else user_key).strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        listeners.append(name)
    return listeners


def upsert_party_record_snapshot(session_payload, users_store, credentials_store, reviews_store, finalized=False):
    if not session_payload or not session_payload.get("albumsPlayed"):
        return None

    record_id = str(session_payload.get("id", "")).strip()
    started_at = str(session_payload.get("startedAt", "")).strip()
    if not record_id or not started_at:
        return None

    session_date_key = get_session_date_key(session_payload)
    party_reviews = collect_reviews_for_albums(reviews_store, session_payload.get("albumsPlayed", []), session_date_key, record_id)
    attendees = collect_reviewing_attendees(party_reviews)
    listeners = collect_session_listeners(session_payload, users_store)
    now_iso = datetime.now(timezone.utc).isoformat()

    records_store = read_party_records_store()
    parties = records_store.get("parties", [])
    if not isinstance(parties, list):
        parties = []

    existing_index = next(
        (index for index, entry in enumerate(parties) if str(entry.get("id", "")).strip() == record_id),
        -1
    )
    existing = parties[existing_index] if existing_index >= 0 and isinstance(parties[existing_index], dict) else {}

    record = {
        "id": record_id,
        "date": started_at,
        "startedAt": started_at,
        "savedAt": now_iso,
        "attendees": attendees,
        "listeners": listeners,
        "albumsPlayed": session_payload.get("albumsPlayed", []),
        "reviews": party_reviews
    }

    # Include picture if it exists in the session
    party_picture = str(session_payload.get("partyPicture", "")).strip()
    if party_picture:
        record["partyPicture"] = party_picture

    finalized_at = str(existing.get("finalizedAt", "")).strip()
    ended_at = str(existing.get("endedAt", "")).strip()

    # Backfill endedAt from finalizedAt for older records that only had finalizedAt.
    if not ended_at and finalized_at:
        ended_at = finalized_at

    if finalized:
        finalized_at = now_iso
        ended_at = now_iso

    if ended_at:
        record["endedAt"] = ended_at

    # Keep finalizedAt for backward compatibility with existing clients/data.
    if finalized_at:
        record["finalizedAt"] = finalized_at

    if existing_index >= 0:
        parties[existing_index] = record
    else:
        parties.append(record)

    records_store["parties"] = parties
    write_party_records_store(records_store)
    return record


def finalize_active_session_on_shutdown():
    global _current_session

    with REVIEWS_LOCK:
        session_to_save = _current_session
        if not session_to_save or not session_to_save.get("albumsPlayed"):
            _current_session = None
            clear_now_playing()
            return

        users_store = read_users_store()
        credentials_store = read_credentials_store()
        users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
        write_users_store(users_store)
        write_credentials_store(credentials_store)
        reviews_store = read_reviews_store()
        upsert_party_record_snapshot(
            session_to_save,
            users_store,
            credentials_store,
            reviews_store,
            finalized=True
        )
        _current_session = None
        clear_now_playing()


def normalize_user_key(name):
    return str(name or "").strip().lower()


def sanitize_user_profile(profile):
    if not isinstance(profile, dict):
        return None

    raw_top_albums = profile.get("topAlbums")
    if not isinstance(raw_top_albums, list):
        raw_top_albums = [
            profile.get("topAlbum1", ""),
            profile.get("topAlbum2", ""),
            profile.get("topAlbum3", "")
        ]

    top_albums = []
    for value in raw_top_albums[:3]:
        if isinstance(value, dict):
            top_albums.append({
                "title": str(value.get("title", "")).strip()[:150],
                "artist": str(value.get("artist", "")).strip()[:120],
                "coverUrl": str(value.get("coverUrl", "")).strip()
            })
        else:
            top_albums.append({
                "title": str(value or "").strip()[:150],
                "artist": "",
                "coverUrl": ""
            })

    while len(top_albums) < 3:
        top_albums.append({
            "title": "",
            "artist": "",
            "coverUrl": ""
        })

    return {
        "name": str(profile.get("name", "")).strip(),
        "photoDataUrl": str(profile.get("photoDataUrl", "")).strip(),
        "description": str(profile.get("description", "")).strip()[:150],
        "instagramUsername": str(profile.get("instagramUsername", "")).strip().lstrip("@")[:40],
        "spotifyUrl": str(profile.get("spotifyUrl", "")).strip()[:200],
        "topAlbums": top_albums,
        "listeningPartiesAttended": _to_non_negative_int(profile.get("listeningPartiesAttended"), default=0),
        "createdAt": str(profile.get("createdAt", "")).strip(),
        "accountName": str(profile.get("accountName", "usuario")).strip() or "usuario"
    }


def increment_users_listening_parties_attended(users_store, user_keys):
    if not isinstance(users_store, dict) or not isinstance(user_keys, list):
        return False

    updated = False
    for raw_key in user_keys:
        user_key = normalize_user_key(raw_key)
        if not user_key:
            continue

        profile = users_store.get(user_key)
        if not isinstance(profile, dict):
            continue

        current = _to_non_negative_int(profile.get("listeningPartiesAttended"), default=0)
        profile["listeningPartiesAttended"] = current + 1
        users_store[user_key] = profile
        updated = True

    return updated


def read_plaintext_password(credentials_entry):
    if not isinstance(credentials_entry, dict):
        return ""

    return str(credentials_entry.get("password", "")).strip()


def read_session_token(credentials_entry):
    if not isinstance(credentials_entry, dict):
        return ""

    return str(credentials_entry.get("sessionToken", "")).strip()


def read_session_last_seen(credentials_entry):
    if not isinstance(credentials_entry, dict):
        return ""

    return str(credentials_entry.get("sessionLastSeenAt", "")).strip()


def parse_iso_datetime(value):
    text = str(value or "").strip()
    if not text:
        return None

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def is_recent_active_session(credentials_entry, now_utc):
    session_token = read_session_token(credentials_entry)
    if not session_token:
        return False

    last_seen = parse_iso_datetime(read_session_last_seen(credentials_entry))
    if not last_seen:
        return False

    return (now_utc - last_seen).total_seconds() <= ACTIVE_USER_WINDOW_SECONDS


def touch_session_activity(credentials_store, user_key):
    if not user_key:
        return False

    entry = credentials_store.get(user_key)
    if not isinstance(entry, dict):
        return False

    if not read_session_token(entry):
        return False

    entry["sessionLastSeenAt"] = datetime.now(timezone.utc).isoformat()
    credentials_store[user_key] = entry
    return True


def get_session_sticky_attendee_keys(session_payload):
    if not isinstance(session_payload, dict):
        return []

    raw_keys = session_payload.get("stickyAttendeeKeys", [])
    if not isinstance(raw_keys, list):
        return []

    unique = []
    seen = set()
    for key in raw_keys:
        normalized = normalize_user_key(key)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)

    return unique


def add_session_sticky_attendee(session_payload, user_key):
    if not isinstance(session_payload, dict):
        return False

    normalized = normalize_user_key(user_key)
    if not normalized:
        return False

    existing = get_session_sticky_attendee_keys(session_payload)
    if normalized in existing:
        return False

    existing.append(normalized)
    session_payload["stickyAttendeeKeys"] = existing
    return True


def seed_session_sticky_attendees_from_recent(session_payload, credentials_store, now_utc):
    if not isinstance(session_payload, dict):
        return False

    changed = False
    for user_key, credentials_entry in credentials_store.items():
        if not is_recent_active_session(credentials_entry, now_utc):
            continue

        if add_session_sticky_attendee(session_payload, user_key):
            changed = True

    return changed


def build_session_cookie(token):
    return (
        f"{SESSION_COOKIE_NAME}={token}; Path=/; Max-Age={SESSION_COOKIE_MAX_AGE}; "
        "HttpOnly; SameSite=Lax"
    )


def build_clear_session_cookie():
    return f"{SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"


def build_user_cookie(user_key):
    encoded_user_key = quote(str(user_key or ""), safe="")
    return f"{SESSION_USER_COOKIE_NAME}={encoded_user_key}; Path=/; Max-Age={SESSION_COOKIE_MAX_AGE}; SameSite=Lax"


def build_clear_user_cookie():
    return f"{SESSION_USER_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax"


def parse_cookie_header(cookie_header):
    values = {}

    for part in str(cookie_header or "").split(";"):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        values[key.strip()] = value.strip()

    return values


def create_session_token():
    return secrets.token_urlsafe(48)


def find_user_key_by_session_token(credentials_store, session_token):
    if not session_token:
        return ""

    for user_key, entry in credentials_store.items():
        if read_session_token(entry) == session_token:
            return str(user_key)

    return ""


def reconcile_auth_stores(users_store, credentials_store):
    normalized_users = {}
    normalized_credentials = {}

    for user_key, raw_profile in users_store.items():
        if not isinstance(raw_profile, dict):
            continue

        sanitized_profile = sanitize_user_profile(raw_profile)
        if not sanitized_profile:
            continue

        profile_name = sanitized_profile.get("name") or str(user_key).strip()
        profile_created_at = sanitized_profile.get("createdAt") or datetime.now(timezone.utc).isoformat()

        normalized_users[user_key] = {
            "name": profile_name,
            "photoDataUrl": sanitized_profile.get("photoDataUrl", ""),
            "description": sanitized_profile.get("description", ""),
            "instagramUsername": sanitized_profile.get("instagramUsername", ""),
            "spotifyUrl": sanitized_profile.get("spotifyUrl", ""),
            "topAlbums": sanitized_profile.get("topAlbums", ["", "", ""]),
            "listeningPartiesAttended": _to_non_negative_int(
                sanitized_profile.get("listeningPartiesAttended"),
                default=0
            ),
            "createdAt": profile_created_at,
            "accountName": "usuario"
        }

        password = read_plaintext_password(credentials_store.get(user_key))
        if password:
            raw_credentials = credentials_store.get(user_key) if isinstance(credentials_store.get(user_key), dict) else {}
            normalized_credentials[user_key] = {
                "name": str(raw_credentials.get("name", profile_name)).strip() or profile_name,
                "password": password,
                "createdAt": str(raw_credentials.get("createdAt", profile_created_at)).strip() or profile_created_at,
                "sessionToken": str(raw_credentials.get("sessionToken", "")).strip(),
                "sessionCreatedAt": str(raw_credentials.get("sessionCreatedAt", "")).strip(),
                "sessionLastSeenAt": str(raw_credentials.get("sessionLastSeenAt", "")).strip()
            }

    admin_profile = normalized_users.get(ADMIN_USER_KEY)
    if not isinstance(admin_profile, dict):
        admin_profile = {}

    admin_credentials = normalized_credentials.get(ADMIN_USER_KEY)
    if not isinstance(admin_credentials, dict):
        admin_credentials = {}

    admin_sanitized_profile = sanitize_user_profile(admin_profile) or {}
    admin_name = str(admin_profile.get("name", ADMIN_DEFAULT_NAME)).strip() or ADMIN_DEFAULT_NAME
    admin_photo = str(admin_profile.get("photoDataUrl", "")).strip()
    admin_description = str(admin_sanitized_profile.get("description", "")).strip()
    admin_instagram = str(admin_sanitized_profile.get("instagramUsername", "")).strip().lstrip("@")
    admin_spotify = str(admin_sanitized_profile.get("spotifyUrl", "")).strip()
    admin_top_albums = admin_sanitized_profile.get("topAlbums", ["", "", ""])
    admin_created_at = str(admin_profile.get("createdAt", "")).strip() or datetime.now(timezone.utc).isoformat()

    normalized_users[ADMIN_USER_KEY] = {
        "name": admin_name,
        "photoDataUrl": admin_photo,
        "description": admin_description,
        "instagramUsername": admin_instagram,
        "spotifyUrl": admin_spotify,
        "topAlbums": admin_top_albums,
        "listeningPartiesAttended": _to_non_negative_int(
            admin_profile.get("listeningPartiesAttended"),
            default=0
        ),
        "createdAt": admin_created_at,
        "accountName": ADMIN_ACCOUNT_NAME
    }
    normalized_credentials[ADMIN_USER_KEY] = {
        "name": str(admin_credentials.get("name", admin_name)).strip() or admin_name,
        "password": ADMIN_DEFAULT_PASSWORD,
        "createdAt": str(admin_credentials.get("createdAt", admin_created_at)).strip() or admin_created_at,
        "sessionToken": str(admin_credentials.get("sessionToken", "")).strip(),
        "sessionCreatedAt": str(admin_credentials.get("sessionCreatedAt", "")).strip(),
        "sessionLastSeenAt": str(admin_credentials.get("sessionLastSeenAt", "")).strip()
    }

    for user_key, profile in normalized_users.items():
        if user_key == ADMIN_USER_KEY:
            profile["accountName"] = ADMIN_ACCOUNT_NAME
            continue

        profile["accountName"] = "usuario"

    return normalized_users, normalized_credentials


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


def write_now_playing_payload(payload):
    with NOW_PLAYING_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _to_non_negative_int(value, default=0):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def increment_album_times_played(album_title, album_artist=""):
    if not COLLECTION_PATH.exists():
        return False

    try:
        with COLLECTION_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return False

    items = payload.get("items", []) if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return False

    target_title = str(album_title or "").strip().lower()
    target_artist = str(album_artist or "").strip().lower()
    if not target_title:
        return False

    updated = False
    for item in items:
        if not isinstance(item, dict):
            continue

        item_title = str(item.get("title") or "").strip().lower()
        item_artist = str(item.get("artist") or "").strip().lower()

        if item_title != target_title:
            continue

        if target_artist and item_artist != target_artist:
            continue

        current_count = _to_non_negative_int(item.get("timesPlayed"), default=0)
        item["timesPlayed"] = current_count + 1
        updated = True
        break

    if not updated:
        return False

    payload["items"] = items

    try:
        with COLLECTION_PATH.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except OSError:
        return False

    return True


def _fetch_gemini_fun_facts(album, artist, song=None):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return []

    if song:
        prompt = (
            f'Return ONLY a JSON array of 8 fun facts about the song "{song}" '
            f'from the album "{album}" by "{artist}". '
            'Each fact must be 1-2 sentences, genuinely interesting, no markdown, raw JSON array of strings only.'
        )
    else:
        prompt = (
            f'Return ONLY a JSON array of 8 fun facts about the album "{album}" by "{artist}". '
            'Each fact must be 1-2 sentences, genuinely interesting, no markdown, raw JSON array of strings only.'
        )

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-1.5-flash:generateContent?key={api_key}"
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 700, "temperature": 0.75},
    }).encode("utf-8")

    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
        # Strip markdown code fences if the model wraps the JSON
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1] if len(parts) > 1 else text
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        facts = json.loads(text)
        if isinstance(facts, list):
            return [str(f) for f in facts if f][:8]
    except Exception:
        pass
    return []


class ListeningPartyHandler(SimpleHTTPRequestHandler):
    def _send_json(self, payload, status_code=200, extra_headers=None):
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        for key, value in (extra_headers or []):
            self.send_header(key, value)
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

        if parsed.path == "/api/users/me":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")
            user_cookie_key = unquote(cookies.get(SESSION_USER_COOKIE_NAME, "")).strip()

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                user_key = find_user_key_by_session_token(credentials_store, session_token)
                if not user_key and user_cookie_key:
                    fallback_key = normalize_user_key(user_cookie_key)
                    if fallback_key in users_store:
                        user_key = fallback_key

                user_profile = sanitize_user_profile(users_store.get(user_key)) if user_key else None

                restored_headers = []
                if user_profile and user_key and not session_token:
                    restored_token = create_session_token()
                    credentials_entry = credentials_store.get(user_key)
                    if not isinstance(credentials_entry, dict):
                        credentials_entry = {}
                    credentials_entry["sessionToken"] = restored_token
                    credentials_entry["sessionCreatedAt"] = datetime.now(timezone.utc).isoformat()
                    credentials_entry["sessionLastSeenAt"] = datetime.now(timezone.utc).isoformat()
                    credentials_store[user_key] = credentials_entry
                    write_credentials_store(credentials_store)
                    restored_headers = [
                        ("Set-Cookie", build_session_cookie(restored_token)),
                        ("Set-Cookie", build_user_cookie(user_key))
                    ]
                elif user_profile and user_key:
                    if touch_session_activity(credentials_store, user_key):
                        write_credentials_store(credentials_store)
                    restored_headers = [("Set-Cookie", build_user_cookie(user_key))]

                if user_profile and user_key and _current_session and _current_session.get("albumsPlayed"):
                    add_session_sticky_attendee(_current_session, user_key)

            self._send_json(
                {
                    "exists": bool(user_profile),
                    "user": user_profile
                },
                extra_headers=restored_headers
            )
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

        if parsed.path == "/api/users/active":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                caller_key = find_user_key_by_session_token(credentials_store, session_token)
                credentials_changed = touch_session_activity(credentials_store, caller_key)
                if _current_session and _current_session.get("albumsPlayed"):
                    add_session_sticky_attendee(_current_session, caller_key)

                active_users_by_key = {}
                now_utc = datetime.now(timezone.utc)
                for user_key, credentials_entry in credentials_store.items():
                    if not is_recent_active_session(credentials_entry, now_utc):
                        continue

                    profile = sanitize_user_profile(users_store.get(user_key))
                    if not profile:
                        continue

                    active_users_by_key[normalize_user_key(profile.get("name", user_key))] = profile

                if _current_session and _current_session.get("albumsPlayed"):
                    for sticky_key in get_session_sticky_attendee_keys(_current_session):
                        profile = sanitize_user_profile(users_store.get(sticky_key))
                        if not profile:
                            continue

                        active_users_by_key[sticky_key] = profile

                active_users = list(active_users_by_key.values())

                if credentials_changed:
                    write_credentials_store(credentials_store)

                active_users.sort(key=lambda user: str(user.get("name", "")).lower())

            self._send_json({
                "users": active_users
            })
            return

        if parsed.path == "/api/reviews":
            params = parse_qs(parsed.query)
            song_key = (params.get("songKey", [""])[0] or "").strip()
            party_id_filter = (params.get("partyId", [""])[0] or "").strip()

            with REVIEWS_LOCK:
                store = read_reviews_store()
                reviews = store.get(song_key, []) if song_key else []

            if party_id_filter:
                reviews = [r for r in reviews if isinstance(r, dict) and r.get("partyId") == party_id_filter]

            self._send_json({
                "songKey": song_key,
                "reviews": reviews
            })
            return

        if parsed.path == "/api/admin/users":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                caller_key = find_user_key_by_session_token(credentials_store, session_token)
                users_store = read_users_store()
                caller_profile = sanitize_user_profile(users_store.get(caller_key)) if caller_key else None

            if not caller_profile or caller_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                self._send_json({"error": "admin only"}, status_code=403)
                return

            with REVIEWS_LOCK:
                reviews_store = read_reviews_store()
                all_users = []
                for user_key, profile_raw in users_store.items():
                    profile = sanitize_user_profile(profile_raw)
                    if not profile:
                        continue
                    cred = credentials_store.get(user_key) or {}
                    password = read_plaintext_password(cred)
                    reviews = build_user_reviews(reviews_store, profile.get("name", ""))
                    all_users.append({
                        "name": profile.get("name", ""),
                        "photoDataUrl": profile.get("photoDataUrl", ""),
                        "accountName": profile.get("accountName", ""),
                        "password": password,
                        "reviews": reviews
                    })

            all_users.sort(key=lambda u: str(u.get("name", "")).lower())
            self._send_json({"users": all_users})
            return

        if parsed.path == "/api/live-albums":
            with LIVE_ALBUMS_LOCK:
                store = read_live_albums_store()
            self._send_json({"albums": store.get("albums", [])})
            return

        if parsed.path == "/api/party-records":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                user_key = find_user_key_by_session_token(credentials_store, session_token)
                users_store = read_users_store()
                user_profile = sanitize_user_profile(users_store.get(user_key)) if user_key else None

            if not user_profile or user_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                self._send_json({"error": "admin only"}, status_code=403)
                return

            records = read_party_records_store()
            parties = sorted(
                records.get("parties", []),
                key=lambda p: str(p.get("date", "")),
                reverse=True
            )
            self._send_json({"parties": parties})
            return

        if parsed.path == "/api/my-parties":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                user_key = find_user_key_by_session_token(credentials_store, session_token)
                users_store = read_users_store()
                user_profile = sanitize_user_profile(users_store.get(user_key)) if user_key else None

            if not user_profile:
                self._send_json({"error": "session required"}, status_code=401)
                return

            user_name = user_profile.get("name", "")
            is_admin = user_profile.get("accountName") == ADMIN_ACCOUNT_NAME

            records = read_party_records_store()
            parties = records.get("parties", [])

            if not is_admin:
                parties = [
                    p for p in parties
                    if user_name in p.get("attendees", []) or user_name in p.get("listeners", [])
                ]

            parties = sorted(
                parties,
                key=lambda p: str(p.get("savedAt", p.get("date", ""))),
                reverse=True
            )
            self._send_json({"parties": parties})
            return

        if parsed.path == "/api/fun-facts":
            params = parse_qs(parsed.query)
            album  = (params.get("album",  [""])[0] or "").strip()
            artist = (params.get("artist", [""])[0] or "").strip()
            song   = (params.get("song",   [""])[0] or "").strip()

            if not album or not artist:
                self._send_json({"facts": []})
                return

            cache_key = f"{album.lower()}|{artist.lower()}|{song.lower()}"

            with _fun_facts_lock:
                if cache_key in _fun_facts_cache:
                    self._send_json({"facts": _fun_facts_cache[cache_key]})
                    return

            facts = _fetch_gemini_fun_facts(album, artist, song or None)

            with _fun_facts_lock:
                _fun_facts_cache[cache_key] = facts

            self._send_json({"facts": facts})
            return

        super().do_GET()

    def do_POST(self):
        global _current_session
        parsed = urlparse(self.path)

        if parsed.path == "/api/now-playing/clear":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            actor_name = str(payload.get("actorName", "")).strip()

            if not actor_name:
                self._send_json({"error": "actorName is required"}, status_code=400)
                return

            actor_key = normalize_user_key(actor_name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                actor_profile = sanitize_user_profile(users_store.get(actor_key))

                if not actor_profile:
                    self._send_json({"error": "actor user not found"}, status_code=404)
                    return

                if actor_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                    self._send_json({"error": "only administrador can clear now playing"}, status_code=403)
                    return

                clear_now_playing()

            self._send_json({"ok": True})
            return

        if parsed.path == "/api/listening-party/finish":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            actor_name = str(payload.get("actorName", "")).strip()

            if not actor_name:
                self._send_json({"error": "actorName is required"}, status_code=400)
                return

            actor_key = normalize_user_key(actor_name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                actor_profile = sanitize_user_profile(users_store.get(actor_key))

                if not actor_profile:
                    self._send_json({"error": "actor user not found"}, status_code=404)
                    return

                if actor_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                    self._send_json({"error": "only administrador can finish listening party"}, status_code=403)
                    return

                session_to_save = _current_session
                if not session_to_save or not session_to_save.get("albumsPlayed"):
                    self._send_json({"error": "No hay listening party activa para finalizar."}, status_code=400)
                    return
                reviews_store = read_reviews_store()
                record = upsert_party_record_snapshot(
                    session_to_save,
                    users_store,
                    credentials_store,
                    reviews_store,
                    finalized=True
                )
                if not record:
                    self._send_json({"error": "No se pudo guardar el record de la listening party."}, status_code=500)
                    return

                clear_now_playing()
                _current_session = None

            self._send_json({"ok": True, "recordCreated": True, "partyId": record["id"]})
            return

        if parsed.path == "/api/listening-party/picture":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            picture_data_url = str(payload.get("pictureDataUrl", "")).strip()

            if not picture_data_url:
                self._send_json({"error": "pictureDataUrl is required"}, status_code=400)
                return

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)

                # Verify that only admin can add pictures
                admin_key = normalize_user_key(ADMIN_DEFAULT_NAME)
                admin_profile = sanitize_user_profile(users_store.get(admin_key))

                if not admin_profile or admin_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                    self._send_json({"error": "only administrador can add pictures"}, status_code=403)
                    return

                if _current_session is None:
                    self._send_json({"error": "No hay listening party activa"}, status_code=400)
                    return

                if not _current_session.get("albumsPlayed"):
                    self._send_json({"error": "No hay reproduccion activa"}, status_code=400)
                    return

                # Add picture to the session
                _current_session["partyPicture"] = picture_data_url

                # Upsert the record with the picture
                reviews_store = read_reviews_store()
                upsert_party_record_snapshot(
                    _current_session,
                    users_store,
                    credentials_store,
                    reviews_store,
                    finalized=False
                )

            self._send_json({"ok": True})
            return

        if parsed.path == "/api/now-playing":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            actor_name = str(payload.get("actorName", "")).strip()
            album_title = str(payload.get("albumTitle", "")).strip()
            album_artist = str(payload.get("albumArtist", "")).strip()
            song_title = str(payload.get("songTitle", "")).strip()
            cover_url = str(payload.get("coverUrl", "")).strip()
            review_scope = str(payload.get("reviewScope", "song")).strip().lower()
            review_scope = "album" if review_scope == "album" else "song"

            if not actor_name:
                self._send_json({"error": "actorName is required"}, status_code=400)
                return

            if not album_title:
                self._send_json({"error": "albumTitle is required"}, status_code=400)
                return

            if not cover_url:
                self._send_json({"error": "coverUrl is required"}, status_code=400)
                return

            if review_scope == "song" and not song_title:
                self._send_json({"error": "songTitle is required for song scope"}, status_code=400)
                return

            actor_key = normalize_user_key(actor_name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                actor_profile = sanitize_user_profile(users_store.get(actor_key))

                if not actor_profile:
                    self._send_json({"error": "actor user not found"}, status_code=404)
                    return

                if actor_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                    self._send_json({"error": "only administrador can control now playing"}, status_code=403)
                    return

                if _current_session is None:
                    _current_session = {
                        "id": datetime.now(timezone.utc).isoformat(),
                        "startedAt": datetime.now(timezone.utc).isoformat(),
                        "albumsPlayed": [],
                        "stickyAttendeeKeys": []
                    }
                    seed_session_sticky_attendees_from_recent(
                        _current_session,
                        credentials_store,
                        datetime.now(timezone.utc)
                    )
                    add_session_sticky_attendee(_current_session, actor_key)
                    started_attendees = get_session_sticky_attendee_keys(_current_session)
                    if increment_users_listening_parties_attended(users_store, started_attendees):
                        write_users_store(users_store)
                add_session_sticky_attendee(_current_session, actor_key)

                now_playing_payload = {
                    "albumNumber": 0,
                    "songNumber": 0,
                    "albumTitle": album_title,
                    "albumArtist": album_artist,
                    "songTitle": song_title,
                    "reviewScope": review_scope,
                    "coverUrl": cover_url,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedBy": actor_profile.get("name", actor_name),
                    "partyId": _current_session["id"]
                }
                write_now_playing_payload(now_playing_payload)
                increment_album_times_played(album_title, album_artist)
                already_tracked = any(
                    str(a.get("title", "")).lower() == album_title.lower()
                    for a in _current_session["albumsPlayed"]
                )
                if not already_tracked and album_title:
                    _current_session["albumsPlayed"].append({
                        "title": album_title,
                        "artist": album_artist,
                        "coverUrl": cover_url
                    })

                reviews_store = read_reviews_store()
                upsert_party_record_snapshot(
                    _current_session,
                    users_store,
                    credentials_store,
                    reviews_store,
                    finalized=False
                )

            self._send_json({"nowPlaying": now_playing_payload})
            return

        if parsed.path == "/api/users/register":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            name = str(payload.get("name", "")).strip()
            password = str(payload.get("password", "")).strip()
            photo_data_url = str(payload.get("photoDataUrl", "")).strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            if not password:
                self._send_json({"error": "password is required"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)

                if user_key in users_store or user_key in credentials_store:
                    self._send_json({"error": "name already exists"}, status_code=409)
                    return

                profile = {
                    "name": name,
                    "photoDataUrl": photo_data_url,
                    "description": "",
                    "instagramUsername": "",
                    "spotifyUrl": "",
                    "topAlbums": ["", "", ""],
                    "listeningPartiesAttended": 0,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "accountName": "usuario"
                }

                users_store[user_key] = profile
                session_token = create_session_token()
                credentials_store[user_key] = {
                    "name": name,
                    "password": password,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "sessionToken": session_token,
                    "sessionCreatedAt": datetime.now(timezone.utc).isoformat(),
                    "sessionLastSeenAt": datetime.now(timezone.utc).isoformat()
                }
                if _current_session and _current_session.get("albumsPlayed"):
                    add_session_sticky_attendee(_current_session, user_key)
                write_users_store(users_store)
                write_credentials_store(credentials_store)

            self._send_json({
                "user": sanitize_user_profile(profile)
            }, extra_headers=[
                ("Set-Cookie", build_session_cookie(session_token)),
                ("Set-Cookie", build_user_cookie(user_key))
            ])
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
            password = str(payload.get("password", "")).strip()

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            if not password:
                self._send_json({"error": "password is required"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                user_profile = sanitize_user_profile(users_store.get(user_key))
                stored_password = read_plaintext_password(credentials_store.get(user_key))

            if not user_profile:
                self._send_json({"error": "user not found"}, status_code=404)
                return

            if not stored_password:
                self._send_json({"error": "password not set for user"}, status_code=403)
                return

            if stored_password != password:
                self._send_json({"error": "invalid password"}, status_code=401)
                return

            session_token = create_session_token()

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                credentials_entry = credentials_store.get(user_key)
                if not isinstance(credentials_entry, dict):
                    credentials_entry = {}
                credentials_entry["sessionToken"] = session_token
                credentials_entry["sessionCreatedAt"] = datetime.now(timezone.utc).isoformat()
                credentials_entry["sessionLastSeenAt"] = datetime.now(timezone.utc).isoformat()
                credentials_store[user_key] = credentials_entry
                if _current_session and _current_session.get("albumsPlayed"):
                    add_session_sticky_attendee(_current_session, user_key)
                write_credentials_store(credentials_store)

            self._send_json(
                {"user": user_profile},
                extra_headers=[
                    ("Set-Cookie", build_session_cookie(session_token)),
                    ("Set-Cookie", build_user_cookie(user_key))
                ]
            )
            return

        if parsed.path == "/api/users/logout":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                user_key = find_user_key_by_session_token(credentials_store, session_token)
                if user_key:
                    entry = credentials_store.get(user_key)
                    if not isinstance(entry, dict):
                        entry = {}
                    entry["sessionToken"] = ""
                    entry["sessionCreatedAt"] = ""
                    entry["sessionLastSeenAt"] = ""
                    credentials_store[user_key] = entry
                    write_credentials_store(credentials_store)

            self._send_json(
                {"ok": True},
                extra_headers=[
                    ("Set-Cookie", build_clear_session_cookie()),
                    ("Set-Cookie", build_clear_user_cookie())
                ]
            )
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
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
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

        if parsed.path == "/api/users/profile":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            name = str(payload.get("name", "")).strip()
            description = str(payload.get("description", "")).strip()
            instagram_username = str(payload.get("instagramUsername", "")).strip().lstrip("@")
            spotify_url = str(payload.get("spotifyUrl", "")).strip()
            top_albums_raw = payload.get("topAlbums", [])

            if not isinstance(top_albums_raw, list):
                top_albums_raw = []

            top_albums = []
            for value in top_albums_raw[:3]:
                if isinstance(value, dict):
                    top_albums.append({
                        "title": str(value.get("title", "")).strip(),
                        "artist": str(value.get("artist", "")).strip(),
                        "coverUrl": str(value.get("coverUrl", "")).strip()
                    })
                else:
                    top_albums.append({
                        "title": str(value or "").strip(),
                        "artist": "",
                        "coverUrl": ""
                    })

            while len(top_albums) < 3:
                top_albums.append({
                    "title": "",
                    "artist": "",
                    "coverUrl": ""
                })

            if not name:
                self._send_json({"error": "name is required"}, status_code=400)
                return

            if len(description) > 150:
                self._send_json({"error": "description must be 150 characters or less"}, status_code=400)
                return

            if len(instagram_username) > 40:
                self._send_json({"error": "instagramUsername must be 40 characters or less"}, status_code=400)
                return

            if spotify_url and not spotify_url.startswith("https://open.spotify.com/user/"):
                self._send_json({"error": "spotifyUrl must start with https://open.spotify.com/user/"}, status_code=400)
                return

            if len(spotify_url) > 200:
                self._send_json({"error": "spotifyUrl must be 200 characters or less"}, status_code=400)
                return

            if any(len(str(entry.get("title", ""))) > 150 for entry in top_albums):
                self._send_json({"error": "topAlbums title must be 150 characters or less"}, status_code=400)
                return

            if any(len(str(entry.get("artist", ""))) > 120 for entry in top_albums):
                self._send_json({"error": "topAlbums artist must be 120 characters or less"}, status_code=400)
                return

            user_key = normalize_user_key(name)

            with REVIEWS_LOCK:
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                profile = users_store.get(user_key)

                if not isinstance(profile, dict):
                    self._send_json({"error": "user not found"}, status_code=404)
                    return

                profile["description"] = description
                profile["instagramUsername"] = instagram_username
                profile["spotifyUrl"] = spotify_url
                profile["topAlbums"] = top_albums
                users_store[user_key] = profile
                write_users_store(users_store)

                updated_profile = sanitize_user_profile(profile)

            self._send_json({"user": updated_profile})
            return

        if parsed.path == "/api/live-albums":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                caller_key = find_user_key_by_session_token(credentials_store, session_token)
                users_store = read_users_store()
                caller_profile = sanitize_user_profile(users_store.get(caller_key)) if caller_key else None

            if not caller_profile or caller_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                self._send_json({"error": "admin only"}, status_code=403)
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                album = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            if not isinstance(album, dict):
                self._send_json({"error": "album must be an object"}, status_code=400)
                return

            safe_album = {
                "id": str(album.get("id", "")).strip(),
                "title": str(album.get("title", "")).strip(),
                "artist": str(album.get("artist", "")).strip(),
                "owner": str(album.get("owner", "")).strip(),
                "ownerPhotoUrl": str(album.get("ownerPhotoUrl", "")).strip(),
                "coverUrl": str(album.get("coverUrl", "")).strip(),
                "spotifyUrl": str(album.get("spotifyUrl", "")).strip(),
                "addedAt": datetime.now(timezone.utc).isoformat()
            }

            if not safe_album["title"] or not safe_album["id"]:
                self._send_json({"error": "title and id are required"}, status_code=400)
                return

            with LIVE_ALBUMS_LOCK:
                store = read_live_albums_store()
                existing_ids = {a.get("id") for a in store["albums"]}
                if safe_album["id"] not in existing_ids:
                    store["albums"].append(safe_album)
                    write_live_albums_store(store)

            self._send_json({"album": safe_album})
            return

        if parsed.path == "/api/reviews/like":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            song_key = str(payload.get("songKey", "")).strip()
            reviewer_name = str(payload.get("reviewerName", "")).strip().lower()
            liker_name = str(payload.get("likerName", "")).strip()
            liker_photo = str(payload.get("likerPhotoDataUrl", "")).strip()

            if not song_key or not reviewer_name or not liker_name:
                self._send_json({"error": "songKey, reviewerName, and likerName are required"}, status_code=400)
                return

            with REVIEWS_LOCK:
                store = read_reviews_store()
                review_list = store.get(song_key)
                if not isinstance(review_list, list):
                    self._send_json({"error": "Review not found"}, status_code=404)
                    return

                target_idx = next(
                    (i for i in reversed(range(len(review_list)))
                     if isinstance(review_list[i], dict)
                     and str(review_list[i].get("name", "")).strip().lower() == reviewer_name),
                    -1
                )
                if target_idx < 0:
                    self._send_json({"error": "Review not found"}, status_code=404)
                    return

                review = review_list[target_idx]
                likes = review.get("likes", [])
                if not isinstance(likes, list):
                    likes = []

                liker_key = liker_name.lower()
                existing_idx = next(
                    (i for i, l in enumerate(likes)
                     if isinstance(l, dict) and str(l.get("name", "")).strip().lower() == liker_key),
                    -1
                )
                if existing_idx >= 0:
                    likes.pop(existing_idx)
                    liked = False
                else:
                    likes.append({"name": liker_name, "photoDataUrl": liker_photo})
                    liked = True

                review["likes"] = likes
                review_list[target_idx] = review
                store[song_key] = review_list
                write_reviews_store(store)

                if _current_session and _current_session.get("albumsPlayed"):
                    users_store = read_users_store()
                    credentials_store = read_credentials_store()
                    users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                    write_users_store(users_store)
                    write_credentials_store(credentials_store)
                    upsert_party_record_snapshot(
                        _current_session,
                        users_store,
                        credentials_store,
                        store,
                        finalized=False
                    )

            self._send_json({"liked": liked, "likes": likes})
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
        party_id = str(payload.get("partyId", "")).strip()
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
            "scope": "album" if review_scope == "album" else "song",
            "partyId": party_id if party_id else None
        }

        with REVIEWS_LOCK:
            store = read_reviews_store()
            existing = store.get(song_key, [])
            if not isinstance(existing, list):
                existing = []

            normalized_name = normalize_user_key(name)
            upsert_idx = next(
                (i for i, r in enumerate(existing)
                 if isinstance(r, dict)
                 and normalize_user_key(r.get("name", "")) == normalized_name
                 and r.get("partyId") == party_id),
                None
            )
            if upsert_idx is not None:
                existing[upsert_idx] = review_entry
            else:
                existing.append(review_entry)

            store[song_key] = existing
            write_reviews_store(store)
            updated_reviews = existing

            if _current_session and _current_session.get("albumsPlayed"):
                users_store = read_users_store()
                credentials_store = read_credentials_store()
                users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
                write_users_store(users_store)
                write_credentials_store(credentials_store)
                upsert_party_record_snapshot(
                    _current_session,
                    users_store,
                    credentials_store,
                    store,
                    finalized=False
                )

        self._send_json({
            "songKey": song_key,
            "reviews": updated_reviews
        })

    def do_PATCH(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/live-albums":
            cookies = parse_cookie_header(self.headers.get("Cookie", ""))
            session_token = cookies.get(SESSION_COOKIE_NAME, "")

            with REVIEWS_LOCK:
                credentials_store = read_credentials_store()
                caller_key = find_user_key_by_session_token(credentials_store, session_token)
                users_store = read_users_store()
                caller_profile = sanitize_user_profile(users_store.get(caller_key)) if caller_key else None

            if not caller_profile or caller_profile.get("accountName") != ADMIN_ACCOUNT_NAME:
                self._send_json({"error": "admin only"}, status_code=403)
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""

            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json({"error": "Invalid JSON body"}, status_code=400)
                return

            album_id = str(payload.get("id", "")).strip()
            tracks = payload.get("tracks", [])

            if not album_id:
                self._send_json({"error": "id is required"}, status_code=400)
                return

            if not isinstance(tracks, list):
                self._send_json({"error": "tracks must be an array"}, status_code=400)
                return

            safe_tracks = [str(t).strip() for t in tracks if str(t).strip()]

            with LIVE_ALBUMS_LOCK:
                store = read_live_albums_store()
                album = next((a for a in store["albums"] if a.get("id") == album_id), None)
                if not album:
                    self._send_json({"error": "album not found"}, status_code=404)
                    return
                album["tracks"] = safe_tracks
                write_live_albums_store(store)

            self._send_json({"ok": True})
            return

        self._send_json({"error": "not found"}, status_code=404)


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

    threading.Thread(target=backfill_missing_tracks, daemon=True).start()

    ensure_reviews_db()
    ensure_users_db()
    ensure_credentials_db()
    ensure_party_records_db()
    ensure_live_albums_db()

    users_store = read_users_store()
    credentials_store = read_credentials_store()
    users_store, credentials_store = reconcile_auth_stores(users_store, credentials_store)
    write_users_store(users_store)
    write_credentials_store(credentials_store)

    handler = partial(ListeningPartyHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("", port), handler)
    print(f"Listening Party server running on http://0.0.0.0:{port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        finalize_active_session_on_shutdown()
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
