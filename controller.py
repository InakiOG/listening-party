import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALBUMS_PATH = ROOT / "albums.json"
NOW_PLAYING_PATH = ROOT / "now-playing.json"


def load_albums():
    with ALBUMS_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload.get("albums", [])


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


def choose_album(albums):
    print("\nAlbums:")
    for index, album in enumerate(albums, start=1):
        print(f"  {index}. {album.get('title', 'Untitled Album')}")

    while True:
        raw = input("\nChoose album number (or q to quit): ").strip().lower()

        if raw in {"q", "quit", "exit"}:
            return None

        if not raw.isdigit():
            print("Enter a valid number.")
            continue

        choice = int(raw)
        if 1 <= choice <= len(albums):
            return choice

        print("Album number out of range.")


def choose_song(album):
    tracks = album.get("tracks", [])

    if not tracks:
        print("No songs available for this album.")
        return None

    print(f"\nSongs in {album.get('title', 'album')}:")
    for index, track in enumerate(tracks, start=1):
        print(f"  {index}. {track}")

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


def main():
    albums = load_albums()

    if not albums:
        print("No albums found in albums.json")
        return

    print("Listening Party Controller")
    print("Select an album, then a song. The webpage will update automatically.")

    while True:
        album_choice = choose_album(albums)
        if album_choice is None:
            print("Goodbye.")
            return

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
