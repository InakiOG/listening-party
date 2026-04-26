"""Shared pytest fixtures for the listening-party test suite."""
import json
import sys
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

# Ensure the project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def patched_server(tmp_path, monkeypatch):
    """Redirect all server file-path globals to a temp directory."""
    import server

    monkeypatch.setattr(server, "REVIEWS_DB_PATH", tmp_path / "reviews-db.json")
    monkeypatch.setattr(server, "USERS_DB_PATH", tmp_path / "users-db.json")
    monkeypatch.setattr(server, "CREDENTIALS_DB_PATH", tmp_path / "user-credentials.json")
    monkeypatch.setattr(server, "PARTY_RECORDS_PATH", tmp_path / "party-records.json")
    monkeypatch.setattr(server, "LIVE_ALBUMS_PATH", tmp_path / "live-albums.json")
    monkeypatch.setattr(server, "COLLECTION_PATH", tmp_path / "discogs-collection.json")
    monkeypatch.setattr(server, "NOW_PLAYING_PATH", tmp_path / "now-playing.json")
    monkeypatch.setattr(server, "FUN_FACTS_DB_PATH", tmp_path / "fun-facts-db.json")
    return tmp_path


@pytest.fixture(scope="module")
def live_server(tmp_path_factory):
    """Start a real ThreadingHTTPServer with temp data files for endpoint integration tests."""
    import server
    from server import ListeningPartyHandler

    tmp = tmp_path_factory.mktemp("server_data")

    _original = {
        attr: getattr(server, attr)
        for attr in (
            "REVIEWS_DB_PATH",
            "USERS_DB_PATH",
            "CREDENTIALS_DB_PATH",
            "PARTY_RECORDS_PATH",
            "LIVE_ALBUMS_PATH",
            "COLLECTION_PATH",
            "NOW_PLAYING_PATH",
            "FUN_FACTS_DB_PATH",
        )
    }

    server.REVIEWS_DB_PATH = tmp / "reviews-db.json"
    server.USERS_DB_PATH = tmp / "users-db.json"
    server.CREDENTIALS_DB_PATH = tmp / "user-credentials.json"
    server.PARTY_RECORDS_PATH = tmp / "party-records.json"
    server.LIVE_ALBUMS_PATH = tmp / "live-albums.json"
    server.COLLECTION_PATH = tmp / "discogs-collection.json"
    server.NOW_PLAYING_PATH = tmp / "now-playing.json"
    server.FUN_FACTS_DB_PATH = tmp / "fun-facts-db.json"

    # Reset global mutable state
    server._current_session = None
    server._fun_facts_db = {}

    # Bootstrap data stores
    server.ensure_reviews_db()
    server.ensure_users_db()
    server.ensure_credentials_db()
    server.ensure_party_records_db()
    server.ensure_live_albums_db()

    users, creds = server.reconcile_auth_stores({}, {})
    server.write_users_store(users)
    server.write_credentials_store(creds)

    collection = {
        "items": [
            {
                "title": "Abbey Road",
                "artist": "The Beatles",
                "discogsId": 123,
                "timesPlayed": 0,
                "tracks": ["Come Together", "Something"],
            }
        ]
    }
    (tmp / "discogs-collection.json").write_text(json.dumps(collection), encoding="utf-8")

    handler = partial(ListeningPartyHandler, directory=str(tmp))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    yield {"port": port, "tmp": tmp, "base_url": f"http://127.0.0.1:{port}"}

    httpd.shutdown()

    for attr, val in _original.items():
        setattr(server, attr, val)
