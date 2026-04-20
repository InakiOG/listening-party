import json
import argparse
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from discogs_scraper import update_collection_cache

ROOT = Path(__file__).resolve().parent
COLLECTION_PATH = ROOT / "discogs-collection.json"
NOW_PLAYING_PATH = ROOT / "now-playing.json"
REVIEWS_DB_PATH = ROOT / "reviews-db.json"
DEFAULT_COVER_URL = "./mi%20dise%C3%B1o.png"
USER_AGENT = "ListeningParty/1.0 (+https://www.discogs.com/user/InakiOG)"
FALLBACK_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def load_albums():
    with COLLECTION_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    items = payload.get("items", []) if isinstance(payload, dict) else []
    albums = []

    for item in items:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        if not title:
            continue

        raw_tracks = item.get("tracks", [])
        tracks = [str(track).strip() for track in raw_tracks if str(track).strip()]

        albums.append({
            "title": title,
            "artist": str(item.get("artist") or "").strip(),
            "year": item.get("year"),
            "discogsId": item.get("discogsId"),
            "tracks": tracks,
            "coverUrl": str(item.get("imageUrl") or "").strip() or DEFAULT_COVER_URL,
            "isOwned": item.get("isOwned", True)
        })

    return albums


def load_artists_with_albums():
    albums = load_albums()
    artists = {}

    for album in albums:
        artist_name = str(album.get("artist") or "").strip() or "Unknown artist"

        if artist_name not in artists:
            artists[artist_name] = []

        artists[artist_name].append(album)

    artist_names = sorted(artists.keys(), key=lambda name: name.lower())

    for artist_name in artist_names:
        artist_albums = artists[artist_name]
        artists[artist_name] = sorted(
            artist_albums,
            key=lambda album: (
                album.get("year") if isinstance(album.get("year"), int) and album.get("year") > 0 else 9999,
                str(album.get("title", "")).lower()
            )
        )

    return artist_names, artists


def save_tracks_to_collection(release_id, tracks):
    if not isinstance(release_id, int) or release_id <= 0:
        return

    if not isinstance(tracks, list) or not tracks:
        return

    try:
        with COLLECTION_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return

    items = payload.get("items", []) if isinstance(payload, dict) else []
    updated = False

    for item in items:
        if not isinstance(item, dict):
            continue

        item_release_id = item.get("discogsId")

        if str(item_release_id) != str(release_id):
            continue

        existing_tracks = item.get("tracks", [])
        if isinstance(existing_tracks, list) and existing_tracks == tracks:
            return

        item["tracks"] = tracks
        updated = True
        break

    if not updated:
        return

    try:
        with COLLECTION_PATH.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except OSError:
        return


def write_now_playing(album, song_title, album_number, song_number, review_scope="song"):
    payload = {
        "albumNumber": album_number,
        "songNumber": song_number,
        "albumTitle": album.get("title", ""),
        "albumArtist": album.get("artist", ""),
        "songTitle": song_title,
        "reviewScope": review_scope,
        "coverUrl": album.get("coverUrl", ""),
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }

    with NOW_PLAYING_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def choose_artist(artist_names):
    def print_artists():
        print("\nArtists:")
        print("  0. Add temporary album/song")
        for index, artist_name in enumerate(artist_names, start=1):
            print(f"  {index}. {artist_name}")

    print_artists()

    while True:
        raw = input("\nChoose artist number (or q to quit): ").strip().lower()

        if raw in {"q", "quit", "exit"}:
            return None

        if not raw.isdigit():
            print("Enter a valid number.")
            continue

        artist_choice = int(raw)
        if artist_choice == 0:
            return 0

        if 1 <= artist_choice <= len(artist_names):
            return artist_choice

        print("Artist number out of range.")
        print_artists()


def choose_album_for_artist(artist_name, albums):
    if not albums:
        print(f"No albums available for {artist_name}.")
        return None

    def print_albums():
        print(f"\nAlbums by {artist_name} (chronological):")
        for index, album in enumerate(albums, start=1):
            year = album.get("year")
            year_text = str(year) if isinstance(year, int) and year > 0 else "Unknown year"
            print(f"  {index}. {year_text} - {album.get('title', 'Untitled Album')}")

    print_albums()

    while True:
        raw = input("\nChoose album number (b to go back, q to quit): ").strip().lower()

        if raw in {"q", "quit", "exit"}:
            return "quit"

        if raw in {"b", "back"}:
            return "back"

        if not raw.isdigit():
            print("Enter a valid number.")
            continue

        album_choice = int(raw)
        if 1 <= album_choice <= len(albums):
            return album_choice

        print("Album number out of range.")
        print_albums()


def choose_song(album, allow_online_fetch=True):
    tracks = album.get("tracks", [])

    if not tracks and allow_online_fetch:
        print("Loading songs from Discogs...")
        tracks = fetch_album_tracks(album)

    if not tracks and allow_online_fetch:
        print("Discogs has no songs for this release. Trying Spotify...")
        tracks = fetch_spotify_tracks(album)

    if not tracks and not allow_online_fetch:
        print("No songs cached for this album in the local database.")

    if not tracks:
        album["tracks"] = []
    else:
        album["tracks"] = tracks
        save_tracks_to_collection(album.get("discogsId"), tracks)

    if not tracks:
        print("No songs available for this album.")
        return None

    def print_songs():
        print(f"\nSongs in {album.get('title', 'album')}:")
        for index, track in enumerate(tracks, start=1):
            print(f"  {index}. {track}")
        print("  0. Score whole album")

    print_songs()

    while True:
        raw = input("\nChoose song number (b to go back, q to quit): ").strip().lower()

        if raw in {"q", "quit", "exit"}:
            return "quit"

        if raw in {"b", "back"}:
            return "back"

        if raw == "0":
            return "album"

        if not raw.isdigit():
            print("Enter a valid number.")
            continue

        choice = int(raw)
        if 1 <= choice <= len(tracks):
            return choice

        print("Song number out of range.")
        print_songs()


def fetch_album_tracks(album):
    release_id = album.get("discogsId")

    try:
        release_id = int(release_id)
    except (TypeError, ValueError):
        return []

    if release_id <= 0:
        return []

    payload = None
    for user_agent in (USER_AGENT, FALLBACK_USER_AGENT):
        request = Request(
            f"https://api.discogs.com/releases/{release_id}",
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json"
            }
        )

        try:
            with urlopen(request, timeout=30) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                payload = json.loads(response.read().decode(charset, errors="replace"))
            break
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
            payload = None

    if not isinstance(payload, dict):
        return []

    tracklist = payload.get("tracklist") if isinstance(payload, dict) else []
    tracks = []

    for entry in tracklist or []:
        if not isinstance(entry, dict):
            continue

        title = str(entry.get("title", "")).strip()
        if not title:
            continue

        duration = str(entry.get("duration", "")).strip()
        if duration:
            tracks.append(f"{title} - {duration}")
        else:
            tracks.append(title)

    return tracks


def fetch_url_text(url):
    request = Request(
        url,
        headers={
            "User-Agent": FALLBACK_USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9"
        }
    )

    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def find_spotify_album_url(album):
    artist = str(album.get("artist") or "").strip()
    title = str(album.get("title") or "").strip()

    if not artist and not title:
        return ""

    query = f"site:open.spotify.com/album {artist} {title}".strip()
    search_url = "https://duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})

    try:
        html = fetch_url_text(search_url)
    except (HTTPError, URLError, TimeoutError, OSError):
        return ""

    matches = re.findall(r"uddg=([^&\"']+)", html)

    for encoded in matches:
        decoded = urllib.parse.unquote(encoded)
        if re.match(r"^https://open\.spotify\.com/album/[A-Za-z0-9]+", decoded):
            return decoded

    direct = re.findall(r"https://open\.spotify\.com/album/[A-Za-z0-9]+", html)
    return direct[0] if direct else ""


def fetch_spotify_tracks(album):
    album_url = find_spotify_album_url(album)
    if not album_url:
        return []

    try:
        album_html = fetch_url_text(album_url)
    except (HTTPError, URLError, TimeoutError, OSError):
        return []

    track_urls = re.findall(
        r'<meta name="music:song" content="(https://open\.spotify\.com/track/[A-Za-z0-9]+)"',
        album_html
    )

    tracks = []
    seen = set()

    for track_url in track_urls:
        if track_url in seen:
            continue

        seen.add(track_url)

        try:
            track_html = fetch_url_text(track_url)
        except (HTTPError, URLError, TimeoutError, OSError):
            continue

        match = re.search(r'<meta property="og:title" content="([^"]+)"', track_html)
        if not match:
            continue

        title = match.group(1).strip()
        if title:
            tracks.append(title)

    return tracks


def fetch_spotify_album_image(album):
    album_url = find_spotify_album_url(album)
    if not album_url:
        return ""

    try:
        album_html = fetch_url_text(album_url)
    except (HTTPError, URLError, TimeoutError, OSError):
        return ""

    match = re.search(r'<meta property="og:image" content="([^"]+)"', album_html)
    return match.group(1).strip() if match else ""


def fetch_temporary_album_data(artist_name, album_title):
    query = f"{artist_name} {album_title}".strip()
    cover_url = ""
    tracks = []
    year = ""

    if not query:
        return {
            "coverUrl": DEFAULT_COVER_URL,
            "tracks": [],
            "year": ""
        }

    album_search_url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({
        "term": query,
        "entity": "album",
        "limit": 1
    })

    collection_id = None

    try:
        payload_text = fetch_url_text(album_search_url)
        payload = json.loads(payload_text)
        results = payload.get("results", []) if isinstance(payload, dict) else []

        if results:
            album_item = results[0]
            cover_url = str(album_item.get("artworkUrl100") or "").strip()
            cover_url = cover_url.replace("100x100", "600x600") if cover_url else ""
            release_date = str(album_item.get("releaseDate") or "")
            year = release_date[:4] if release_date else ""
            collection_id = album_item.get("collectionId")
    except (ValueError, HTTPError, URLError, TimeoutError, OSError):
        collection_id = None

    if collection_id:
        lookup_url = "https://itunes.apple.com/lookup?" + urllib.parse.urlencode({
            "id": collection_id,
            "entity": "song"
        })

        try:
            lookup_text = fetch_url_text(lookup_url)
            lookup_payload = json.loads(lookup_text)
            entries = lookup_payload.get("results", []) if isinstance(lookup_payload, dict) else []

            for entry in entries:
                if not isinstance(entry, dict) or entry.get("wrapperType") != "track":
                    continue

                track_name = str(entry.get("trackName") or "").strip()
                if track_name:
                    tracks.append(track_name)
        except (ValueError, HTTPError, URLError, TimeoutError, OSError):
            tracks = []

    if not tracks:
        spotify_album = {
            "artist": artist_name,
            "title": album_title
        }
        tracks = fetch_spotify_tracks(spotify_album)

    if not cover_url:
        cover_url = fetch_spotify_album_image({
            "artist": artist_name,
            "title": album_title
        })

    return {
        "coverUrl": cover_url or DEFAULT_COVER_URL,
        "tracks": tracks,
        "year": year
    }


def save_temporary_album_to_collection(album):
    try:
        with COLLECTION_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    items = payload.get("items")
    if not isinstance(items, list):
        items = []

    target_title = str(album.get("title") or "").strip().lower()
    target_artist = str(album.get("artist") or "").strip().lower()
    existing_item = None

    for item in items:
        if not isinstance(item, dict):
            continue

        item_title = str(item.get("title") or "").strip().lower()
        item_artist = str(item.get("artist") or "").strip().lower()

        if item_title == target_title and item_artist == target_artist:
            existing_item = item
            break

    mapped_item = {
        "title": album.get("title", ""),
        "artist": album.get("artist", ""),
        "year": int(album.get("year")) if str(album.get("year", "")).isdigit() else album.get("year", ""),
        "discogsId": None,
        "releaseUrl": "",
        "artistUrl": "",
        "imageUrl": album.get("coverUrl", DEFAULT_COVER_URL),
        "rawText": "Temporary album (not owned)",
        "sourcePage": "temporary",
        "tracks": album.get("tracks", []),
        "isOwned": False,
        "isTemporary": True
    }

    if existing_item is not None:
        existing_item.update(mapped_item)
    else:
        items.append(mapped_item)

    payload["items"] = items

    try:
        with COLLECTION_PATH.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except OSError:
        return False

    return True


def choose_temporary_album_and_song(allow_online_fetch):
    print("\nTemporary album mode")
    artist_name = input("Artist name (or q to cancel): ").strip()

    if artist_name.lower() in {"q", "quit", "exit"}:
        return "back"

    if not artist_name:
        print("Artist name is required.")
        return "back"

    album_title = input("Album name (or q to cancel): ").strip()

    if album_title.lower() in {"q", "quit", "exit"}:
        return "back"

    if not album_title:
        print("Album name is required.")
        return "back"

    print("Fetching album image and songs...")
    fetched = fetch_temporary_album_data(artist_name, album_title)

    album = {
        "title": album_title,
        "artist": artist_name,
        "year": fetched.get("year") or "Unknown year",
        "discogsId": None,
        "tracks": fetched.get("tracks") or [],
        "coverUrl": fetched.get("coverUrl") or DEFAULT_COVER_URL,
        "isOwned": False,
        "isTemporary": True
    }

    save_temporary_album_to_collection(album)
    song_choice = choose_song(album, allow_online_fetch=allow_online_fetch)

    if song_choice == "quit":
        return "quit"

    if song_choice == "back" or song_choice is None:
        return "back"

    if song_choice == "album":
        write_now_playing(album, "", 0, 0, "album")
        print(f"\nCurrently selected for album review: {album.get('title', 'Unknown Album')}")
        return "played"

    song_title = album["tracks"][song_choice - 1]
    write_now_playing(album, song_title, 0, song_choice, "song")
    print(f"\nCurrently playing (temporary): {album.get('title', 'Unknown Album')} - {song_title}")
    return "played"


def main(allow_online_fetch=False, refresh_discogs=False):

    if refresh_discogs:
        try:
            payload = update_collection_cache()
            print(f"Discogs collection refreshed: {payload.get('totalItems', 0)} items")
        except Exception as error:
            print(f"Discogs refresh failed, using local database: {error}")
    elif allow_online_fetch:
        print("Using local discogs-collection.json with online fallback enabled.")
    else:
        print("Using local discogs-collection.json without online fetch.")

    artist_names, artists = load_artists_with_albums()

    if not artist_names:
        print("No artists found in discogs-collection.json")
        return

    print("Listening Party Controller")
    print("Select an artist, then an album, then a song. The webpage will update automatically.")

    while True:
        artist_choice = choose_artist(artist_names)
        if artist_choice is None:
            print("Goodbye.")
            return

        if artist_choice == 0:
            result = choose_temporary_album_and_song(allow_online_fetch=allow_online_fetch)
            if result == "quit":
                print("Goodbye.")
                return
            continue

        artist_name = artist_names[artist_choice - 1]
        albums = artists.get(artist_name, [])
        album_choice = choose_album_for_artist(artist_name, albums)

        if album_choice == "quit":
            print("Goodbye.")
            return

        if album_choice == "back" or album_choice is None:
            continue

        album = albums[album_choice - 1]
        song_choice = choose_song(album, allow_online_fetch=allow_online_fetch)

        if song_choice == "quit":
            print("Goodbye.")
            return

        if song_choice == "album":
            write_now_playing(album, "", album_choice, 0, "album")
            print(f"\nCurrently selected for album review: {album.get('title', 'Unknown Album')}")
            continue

        if song_choice == "back" or song_choice is None:
            continue

        song_title = album["tracks"][song_choice - 1]
        write_now_playing(album, song_title, album_choice, song_choice, "song")
        print(f"\nCurrently playing: {album.get('title', 'Unknown Album')} - {song_title}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Listening Party terminal controller")
    parser.add_argument(
        "--refresh-discogs",
        action="store_true",
        help="Refresh discogs-collection.json at startup and enable online fetch"
    )
    parser.add_argument(
        "--allow-online-fetch",
        action="store_true",
        help="Allow Discogs/Spotify online fetch for missing songs without startup refresh"
    )
    args = parser.parse_args()

    online_fetch_enabled = args.allow_online_fetch or args.refresh_discogs
    main(allow_online_fetch=online_fetch_enabled, refresh_discogs=args.refresh_discogs)
