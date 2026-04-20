import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
USERNAME = "InakiOG"
OUTPUT_PATH = ROOT / "discogs-collection.json"
USER_AGENT = "ListeningParty/1.0 (+https://www.discogs.com/user/InakiOG)"
PER_PAGE = 100


def fetch_collection_page(page_number):
    query = urlencode({"page": page_number, "per_page": PER_PAGE})
    request = Request(
        f"https://api.discogs.com/users/{USERNAME}/collection/folders/0/releases?{query}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }
    )

    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset, errors="replace"))


def load_existing_output():
    if not OUTPUT_PATH.exists():
        return None

    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def summarize_artists(artists):
    names = []

    for artist in artists or []:
        name = str(artist.get("name", "")).strip()
        if name:
            names.append(name)

    return ", ".join(names) if names else "Unknown artist"


def summarize_formats(formats):
    parts = []

    for format_item in formats or []:
        name = str(format_item.get("name", "")).strip()
        if not name:
            continue

        details = []
        quantity = str(format_item.get("qty", "")).strip()
        text = str(format_item.get("text", "")).strip()

        if quantity and quantity != "1":
            details.append(f"x{quantity}")

        if text:
            details.append(text)

        if details:
            parts.append(f"{name} ({', '.join(details)})")
        else:
            parts.append(name)

    return "; ".join(parts)


def summarize_genres(genres, styles):
    values = []

    for value in (genres or []) + (styles or []):
        text = str(value).strip()
        if text:
            values.append(text)

    return ", ".join(values)


def map_release(release, page_number):
    basic_information = release.get("basic_information") or {}
    artists = basic_information.get("artists") or []
    title = str(basic_information.get("title") or "").strip() or "Untitled release"
    artist = summarize_artists(artists)
    cover_url = str(basic_information.get("cover_image") or basic_information.get("thumb") or "").strip()
    release_id = release.get("id")
    artist_id = artists[0].get("id") if artists else None
    release_url = f"https://www.discogs.com/release/{release_id}" if release_id else ""
    artist_url = f"https://www.discogs.com/artist/{artist_id}" if artist_id else ""
    year = basic_information.get("year")

    if not isinstance(year, int) or year <= 0:
        year = None

    format_summary = summarize_formats(basic_information.get("formats"))
    genre_summary = summarize_genres(basic_information.get("genres"), basic_information.get("styles"))

    details = []
    if format_summary:
        details.append(format_summary)
    if genre_summary:
        details.append(genre_summary)

    return {
        "title": title,
        "artist": artist,
        "releaseUrl": release_url,
        "artistUrl": artist_url,
        "imageUrl": cover_url,
        "imageAlt": f"{title} cover",
        "year": year,
        "sourcePage": page_number,
        "rawText": "; ".join(details),
        "discogsId": release_id,
        "instanceId": release.get("instance_id"),
        "dateAdded": release.get("date_added"),
        "rating": release.get("rating", 0)
    }


def update_collection_cache(max_pages=100):
    collected_items = []
    seen_release_ids = set()
    existing_payload = load_existing_output()

    try:
        first_page = fetch_collection_page(1)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
        if isinstance(existing_payload, dict):
            return existing_payload
        raise

    pagination = first_page.get("pagination") if isinstance(first_page, dict) else {}
    total_pages = int(pagination.get("pages") or 1)
    total_pages = min(total_pages, max_pages)

    for page_number in range(1, total_pages + 1):
        if page_number == 1:
            payload = first_page
        else:
            try:
                payload = fetch_collection_page(page_number)
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
                break

        releases = payload.get("releases") if isinstance(payload, dict) else []
        if not isinstance(releases, list) or not releases:
            break

        for release in releases:
            if not isinstance(release, dict):
                continue

            release_id = release.get("id")
            if release_id in seen_release_ids:
                continue

            seen_release_ids.add(release_id)
            collected_items.append(map_release(release, page_number))

    payload = {
        "source": "Discogs public collection API",
        "profile": USERNAME,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "items": collected_items,
        "totalItems": len(collected_items)
    }

    existing_fingerprint = None
    if isinstance(existing_payload, dict):
        existing_fingerprint = hashlib.sha256(
            json.dumps(existing_payload.get("items", []), sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

    new_fingerprint = hashlib.sha256(
        json.dumps(payload["items"], sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()

    if existing_fingerprint == new_fingerprint:
        return payload

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


if __name__ == "__main__":
    result = update_collection_cache()
    print(f"Saved {result['totalItems']} collection items to {OUTPUT_PATH.name}")
