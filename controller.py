import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
COLLECTION_PATH = ROOT / "discogs-collection.json"
NOW_PLAYING_PATH = ROOT / "now-playing.json"
DEFAULT_COVER_URL = "./mi%20dise%C3%B1o.png"
USER_AGENT = "ListeningParty/1.0 (+https://www.discogs.com/user/InakiOG)"


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
            "coverUrl": str(item.get("imageUrl") or "").strip() or DEFAULT_COVER_URL
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


def write_now_playing(album, song_title, album_number, song_number):
    payload = {
        "albumNumber": album_number,
        "songNumber": song_number,
        "albumTitle": album.get("title", ""),
        "songTitle": song_title,
        "coverUrl": album.get("coverUrl", ""),
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }

    with NOW_PLAYING_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def choose_artist(artist_names):
    def print_artists():
        print("\nArtists:")
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


def choose_song(album):
    tracks = album.get("tracks", [])

    if not tracks:
        tracks = fetch_album_tracks(album)
        album["tracks"] = tracks
        save_tracks_to_collection(album.get("discogsId"), tracks)

    if not tracks:
        print("No songs available for this album.")
        return None

    def print_songs():
        print(f"\nSongs in {album.get('title', 'album')}:")
        for index, track in enumerate(tracks, start=1):
            print(f"  {index}. {track}")

    print_songs()

    while True:
        raw = input("\nChoose song number (b to go back, q to quit): ").strip().lower()

        if raw in {"q", "quit", "exit"}:
            return "quit"

        if raw in {"b", "back"}:
            return "back"

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

    if not isinstance(release_id, int) or release_id <= 0:
        return []

    request = Request(
        f"https://api.discogs.com/releases/{release_id}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }
    )

    try:
        with urlopen(request, timeout=30) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            payload = json.loads(response.read().decode(charset, errors="replace"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
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


def main():
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

        artist_name = artist_names[artist_choice - 1]
        albums = artists.get(artist_name, [])
        album_choice = choose_album_for_artist(artist_name, albums)

        if album_choice == "quit":
            print("Goodbye.")
            return

        if album_choice == "back" or album_choice is None:
            continue

        album = albums[album_choice - 1]
        song_choice = choose_song(album)

        if song_choice == "quit":
            print("Goodbye.")
            return

        if song_choice == "back" or song_choice is None:
            continue

        song_title = album["tracks"][song_choice - 1]
        write_now_playing(album, song_title, album_choice, song_choice)
        print(f"\nCurrently playing: {album.get('title', 'Unknown Album')} - {song_title}")


if __name__ == "__main__":
    main()
