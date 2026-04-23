import hashlib
import json
import time
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


def fetch_release_details(release_id):
    request = Request(
        f"https://api.discogs.com/releases/{release_id}",
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


def _normalize_release_id(value):
    text = str(value or "").strip()
    return text or ""


def build_existing_items_index(existing_payload):
    if not isinstance(existing_payload, dict):
        return {}

    items = existing_payload.get("items")
    if not isinstance(items, list):
        return {}

    index = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        release_id = _normalize_release_id(item.get("discogsId"))
        if not release_id:
            continue
        index[release_id] = item

    return index


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


def summarize_tracklist(tracklist):
    tracks = []

    for entry in tracklist or []:
        if not isinstance(entry, dict):
            continue

        title = str(entry.get("title", "")).strip()
        if not title:
            continue

        duration = str(entry.get("duration", "")).strip()
        parts = [title]

        if duration:
            parts.append(duration)

        tracks.append(" - ".join(parts))

    return tracks


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
    existing_items_index = build_existing_items_index(existing_payload)

    try:
        first_page = fetch_collection_page(1)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
        if isinstance(existing_payload, dict):
            return existing_payload
        raise

    pagination = first_page.get("pagination") if isinstance(first_page, dict) else {}
    total_pages = int(pagination.get("pages") or 1)
    total_pages = min(total_pages, max_pages)
    fetched_all_pages = True

    for page_number in range(1, total_pages + 1):
        if page_number == 1:
            page_data = first_page
        else:
            try:
                page_data = fetch_collection_page(page_number)
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
                fetched_all_pages = False
                break

        releases = page_data.get("releases") if isinstance(page_data, dict) else []
        if not isinstance(releases, list) or not releases:
            break

        for release in releases:
            if not isinstance(release, dict):
                continue

            release_id = release.get("id")
            if release_id in seen_release_ids:
                continue

            seen_release_ids.add(release_id)
            mapped_release = map_release(release, page_number)
            existing_item = existing_items_index.get(_normalize_release_id(release_id))
            existing_tracks = existing_item.get("tracks") if isinstance(existing_item, dict) else None
            has_cached_tracks = isinstance(existing_tracks, list) and len(existing_tracks) > 0

            if has_cached_tracks:
                mapped_release["tracks"] = existing_tracks
                if not mapped_release.get("year") and isinstance(existing_item.get("year"), int):
                    mapped_release["year"] = existing_item.get("year")
                if not mapped_release.get("rawText"):
                    mapped_release["rawText"] = str(existing_item.get("rawText") or "").strip()
                collected_items.append(mapped_release)
                continue

            try:
                release_details = fetch_release_details(release_id)
                mapped_release["tracks"] = summarize_tracklist(release_details.get("tracklist"))
                if not mapped_release.get("year"):
                    year = release_details.get("year")
                    if isinstance(year, int) and year > 0:
                        mapped_release["year"] = year
                if not mapped_release.get("rawText"):
                    release_genres = release_details.get("genres") or []
                    release_styles = release_details.get("styles") or []
                    mapped_release["rawText"] = summarize_genres(release_genres, release_styles)
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
                mapped_release["tracks"] = []

            collected_items.append(mapped_release)

    # If we couldn't fetch all pages, preserve existing items from unfetched pages
    # so a network hiccup doesn't falsely prune albums still in the collection.
    if not fetched_all_pages and existing_items_index:
        for existing_id, existing_item in existing_items_index.items():
            if existing_id not in {_normalize_release_id(rid) for rid in seen_release_ids}:
                collected_items.append(existing_item)

    # Log albums that were removed from the Discogs profile.
    if existing_items_index:
        fetched_ids = {_normalize_release_id(rid) for rid in seen_release_ids}
        for existing_id, existing_item in existing_items_index.items():
            if existing_id not in fetched_ids:
                title = existing_item.get("title", "Unknown")
                artist = existing_item.get("artist", "")
                label = f"{title} — {artist}" if artist else title
                print(f"  Pruned (no longer in Discogs collection): {label}")

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


MUSICBRAINZ_USER_AGENT = "ListeningParty/1.0 (inakisebastianorozcogarcia@gmail.com)"


def fetch_tracks_from_musicbrainz(title, artist):
    query_parts = []
    if artist:
        query_parts.append(f'artist:"{artist}"')
    if title:
        query_parts.append(f'release:"{title}"')
    if not query_parts:
        return []

    search_query = urlencode({"query": " AND ".join(query_parts), "fmt": "json", "limit": "5"})
    search_request = Request(
        f"https://musicbrainz.org/ws/2/release/?{search_query}",
        headers={"User-Agent": MUSICBRAINZ_USER_AGENT, "Accept": "application/json"}
    )

    with urlopen(search_request, timeout=15) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        search_payload = json.loads(response.read().decode(charset, errors="replace"))

    releases = search_payload.get("releases") or []
    if not releases:
        return []

    mbid = releases[0].get("id", "")
    if not mbid:
        return []

    time.sleep(1)

    detail_request = Request(
        f"https://musicbrainz.org/ws/2/release/{mbid}?inc=recordings&fmt=json",
        headers={"User-Agent": MUSICBRAINZ_USER_AGENT, "Accept": "application/json"}
    )

    with urlopen(detail_request, timeout=15) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        detail_payload = json.loads(response.read().decode(charset, errors="replace"))

    tracks = []
    for medium in detail_payload.get("media") or []:
        for track in medium.get("tracks") or []:
            track_title = str(track.get("title") or "").strip()
            if track_title:
                tracks.append(track_title)

    return tracks


def fetch_tracks_from_itunes(title, artist):
    term = " ".join(filter(None, [artist, title]))
    if not term:
        return []

    query = urlencode({"term": term, "entity": "song", "limit": "200"})
    request = Request(
        f"https://itunes.apple.com/search?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )

    with urlopen(request, timeout=15) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        payload = json.loads(response.read().decode(charset, errors="replace"))

    results = payload.get("results") or []

    def norm(s):
        return str(s or "").lower().replace(" ", "")

    norm_title = norm(title)
    matching = [
        r for r in results
        if isinstance(r, dict)
        and norm_title
        and norm_title in norm(r.get("collectionName", ""))
    ]

    if not matching:
        matching = results

    matching.sort(key=lambda r: (int(r.get("discNumber") or 1), int(r.get("trackNumber") or 0)))

    seen = set()
    tracks = []
    for r in matching:
        track_name = str(r.get("trackName") or "").strip()
        if track_name and track_name not in seen:
            seen.add(track_name)
            tracks.append(track_name)

    return tracks


def backfill_missing_tracks():
    existing_payload = load_existing_output()
    if not isinstance(existing_payload, dict):
        print("Track backfill skipped: no collection cache found.")
        return

    items = existing_payload.get("items")
    if not isinstance(items, list):
        print("Track backfill skipped: items list missing.")
        return

    pending = [item for item in items if isinstance(item, dict) and not item.get("tracks")]
    if not pending:
        print("Track backfill: all albums already have tracks.")
        return

    print(f"Track backfill: fetching tracks for {len(pending)} album(s)...")
    filled = 0

    for item in pending:
        album_title = item.get("title", "")
        album_artist = item.get("artist", "")
        release_id = item.get("discogsId")
        tracks = []
        source = None

        # 1. Discogs
        if release_id:
            try:
                details = fetch_release_details(release_id)
                tracks = summarize_tracklist(details.get("tracklist"))
                if tracks:
                    source = "Discogs"
                    if not item.get("year"):
                        year = details.get("year")
                        if isinstance(year, int) and year > 0:
                            item["year"] = year
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
                print(f"    Discogs failed for {album_title!r}: {error}")
            time.sleep(1)

        # 2. MusicBrainz
        if not tracks:
            try:
                tracks = fetch_tracks_from_musicbrainz(album_title, album_artist)
                if tracks:
                    source = "MusicBrainz"
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
                print(f"    MusicBrainz failed for {album_title!r}: {error}")
            time.sleep(1)

        # 3. iTunes
        if not tracks:
            try:
                tracks = fetch_tracks_from_itunes(album_title, album_artist)
                if tracks:
                    source = "iTunes"
            except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
                print(f"    iTunes failed for {album_title!r}: {error}")

        item["tracks"] = tracks
        if tracks:
            filled += 1
            print(f"  [{filled}/{len(pending)}] {album_title!r}: {len(tracks)} track(s) via {source}")
        else:
            print(f"  [{len(pending)}] {album_title!r}: no tracks found on any source")

        time.sleep(1)

    existing_payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
    OUTPUT_PATH.write_text(json.dumps(existing_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Track backfill complete: {filled} album(s) updated.")


if __name__ == "__main__":
    result = update_collection_cache()
    print(f"Saved {result['totalItems']} collection items to {OUTPUT_PATH.name}")
