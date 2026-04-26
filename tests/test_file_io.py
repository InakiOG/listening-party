"""Tests for file I/O functions in server.py (require temp filesystem via patched_server fixture)."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server


# ---------------------------------------------------------------------------
# ensure_* helpers
# ---------------------------------------------------------------------------

class TestEnsureReviewsDb:
    def test_creates_file_when_missing(self, patched_server):
        server.ensure_reviews_db()
        path = patched_server / "reviews-db.json"
        assert path.exists()

    def test_new_file_is_empty_dict(self, patched_server):
        server.ensure_reviews_db()
        data = json.loads((patched_server / "reviews-db.json").read_text(encoding="utf-8"))
        assert data == {}

    def test_does_not_overwrite_existing(self, patched_server):
        path = patched_server / "reviews-db.json"
        path.write_text('{"key": "value"}', encoding="utf-8")
        server.ensure_reviews_db()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data == {"key": "value"}


class TestEnsureUsersDb:
    def test_creates_file(self, patched_server):
        server.ensure_users_db()
        assert (patched_server / "users-db.json").exists()

    def test_new_file_is_empty_dict(self, patched_server):
        server.ensure_users_db()
        data = json.loads((patched_server / "users-db.json").read_text(encoding="utf-8"))
        assert data == {}


class TestEnsureCredentialsDb:
    def test_creates_file(self, patched_server):
        server.ensure_credentials_db()
        assert (patched_server / "user-credentials.json").exists()


class TestEnsurePartyRecordsDb:
    def test_creates_file(self, patched_server):
        server.ensure_party_records_db()
        assert (patched_server / "party-records.json").exists()

    def test_structure_has_parties_list(self, patched_server):
        server.ensure_party_records_db()
        data = json.loads((patched_server / "party-records.json").read_text(encoding="utf-8"))
        assert "parties" in data
        assert isinstance(data["parties"], list)


class TestEnsureLiveAlbumsDb:
    def test_creates_file(self, patched_server):
        server.ensure_live_albums_db()
        assert (patched_server / "live-albums.json").exists()

    def test_structure_has_albums_list(self, patched_server):
        server.ensure_live_albums_db()
        data = json.loads((patched_server / "live-albums.json").read_text(encoding="utf-8"))
        assert data == {"albums": []}


# ---------------------------------------------------------------------------
# read_json_dict_or_reset
# ---------------------------------------------------------------------------

class TestReadJsonDictOrReset:
    def test_reads_valid_dict(self, patched_server):
        path = patched_server / "test.json"
        path.write_text('{"hello": "world"}', encoding="utf-8")
        result = server.read_json_dict_or_reset(path)
        assert result == {"hello": "world"}

    def test_invalid_json_returns_empty_and_resets_file(self, patched_server):
        path = patched_server / "test.json"
        path.write_text("{{not json}}", encoding="utf-8")
        result = server.read_json_dict_or_reset(path)
        assert result == {}
        assert json.loads(path.read_text(encoding="utf-8")) == {}

    def test_json_array_returns_empty(self, patched_server):
        path = patched_server / "test.json"
        path.write_text("[1, 2, 3]", encoding="utf-8")
        result = server.read_json_dict_or_reset(path)
        assert result == {}

    def test_normalizes_and_writes_back(self, patched_server):
        path = patched_server / "test.json"
        path.write_text('{"key":"val"}', encoding="utf-8")
        server.read_json_dict_or_reset(path)
        assert path.exists()


# ---------------------------------------------------------------------------
# Reviews store round-trip
# ---------------------------------------------------------------------------

class TestReviewsStoreRoundTrip:
    def test_write_then_read(self, patched_server):
        data = {"Abbey Road::Come Together": [{"name": "Alice", "rating": 5.0}]}
        server.write_reviews_store(data)
        result = server.read_reviews_store()
        assert result == data

    def test_read_missing_creates_empty(self, patched_server):
        result = server.read_reviews_store()
        assert result == {}

    def test_overwrite(self, patched_server):
        server.write_reviews_store({"key1": []})
        server.write_reviews_store({"key2": []})
        result = server.read_reviews_store()
        assert "key2" in result
        assert "key1" not in result


# ---------------------------------------------------------------------------
# Users store round-trip
# ---------------------------------------------------------------------------

class TestUsersStoreRoundTrip:
    def test_write_then_read(self, patched_server):
        data = {"alice": {"name": "Alice", "photoDataUrl": ""}}
        server.write_users_store(data)
        result = server.read_users_store()
        assert result == data

    def test_read_missing_creates_empty(self, patched_server):
        assert server.read_users_store() == {}


# ---------------------------------------------------------------------------
# Credentials store round-trip
# ---------------------------------------------------------------------------

class TestCredentialsStoreRoundTrip:
    def test_write_then_read(self, patched_server):
        data = {"alice": {"password": "secret", "sessionToken": "tok"}}
        server.write_credentials_store(data)
        result = server.read_credentials_store()
        assert result == data


# ---------------------------------------------------------------------------
# Party records store round-trip
# ---------------------------------------------------------------------------

class TestPartyRecordsStoreRoundTrip:
    def test_creates_default_structure(self, patched_server):
        result = server.read_party_records_store()
        assert "parties" in result
        assert isinstance(result["parties"], list)

    def test_write_then_read(self, patched_server):
        data = {"parties": [{"id": "abc123", "date": "2024-01-01"}]}
        server.write_party_records_store(data)
        result = server.read_party_records_store()
        assert result["parties"][0]["id"] == "abc123"

    def test_corrupted_file_returns_default(self, patched_server):
        (patched_server / "party-records.json").write_text("{{corrupt}", encoding="utf-8")
        result = server.read_party_records_store()
        assert result == {"parties": []}


# ---------------------------------------------------------------------------
# Live albums store round-trip
# ---------------------------------------------------------------------------

class TestLiveAlbumsStoreRoundTrip:
    def test_creates_default_structure(self, patched_server):
        result = server.read_live_albums_store()
        assert result == {"albums": []}

    def test_write_then_read(self, patched_server):
        data = {"albums": [{"id": "1", "title": "Test Album"}]}
        server.write_live_albums_store(data)
        result = server.read_live_albums_store()
        assert result["albums"][0]["title"] == "Test Album"

    def test_corrupted_returns_default(self, patched_server):
        (patched_server / "live-albums.json").write_text("not json", encoding="utf-8")
        result = server.read_live_albums_store()
        assert result == {"albums": []}


# ---------------------------------------------------------------------------
# increment_album_times_played
# ---------------------------------------------------------------------------

class TestIncrementAlbumTimesPlayed:
    def _write_collection(self, tmp_path, items):
        path = tmp_path / "discogs-collection.json"
        path.write_text(json.dumps({"items": items}), encoding="utf-8")

    def test_increments_matching_album(self, patched_server):
        self._write_collection(patched_server, [
            {"title": "Abbey Road", "artist": "The Beatles", "timesPlayed": 2}
        ])
        assert server.increment_album_times_played("Abbey Road", "The Beatles") is True
        data = json.loads((patched_server / "discogs-collection.json").read_text(encoding="utf-8"))
        assert data["items"][0]["timesPlayed"] == 3

    def test_case_insensitive_title(self, patched_server):
        self._write_collection(patched_server, [
            {"title": "Abbey Road", "artist": "The Beatles", "timesPlayed": 0}
        ])
        assert server.increment_album_times_played("abbey road", "the beatles") is True

    def test_artist_mismatch_does_not_update(self, patched_server):
        self._write_collection(patched_server, [
            {"title": "Abbey Road", "artist": "The Beatles", "timesPlayed": 0}
        ])
        assert server.increment_album_times_played("Abbey Road", "Rolling Stones") is False
        data = json.loads((patched_server / "discogs-collection.json").read_text(encoding="utf-8"))
        assert data["items"][0]["timesPlayed"] == 0

    def test_no_match_returns_false(self, patched_server):
        self._write_collection(patched_server, [
            {"title": "Abbey Road", "artist": "The Beatles", "timesPlayed": 0}
        ])
        assert server.increment_album_times_played("Nonexistent Album") is False

    def test_missing_collection_file_returns_false(self, patched_server):
        # File not written, so it won't exist
        assert server.increment_album_times_played("Abbey Road") is False

    def test_increments_without_artist(self, patched_server):
        self._write_collection(patched_server, [
            {"title": "Abbey Road", "artist": "The Beatles", "timesPlayed": 1}
        ])
        assert server.increment_album_times_played("Abbey Road") is True
        data = json.loads((patched_server / "discogs-collection.json").read_text(encoding="utf-8"))
        assert data["items"][0]["timesPlayed"] == 2

    def test_corrupted_collection_returns_false(self, patched_server):
        (patched_server / "discogs-collection.json").write_text("{{bad json}", encoding="utf-8")
        assert server.increment_album_times_played("Abbey Road") is False


# ---------------------------------------------------------------------------
# reconcile_auth_stores
# ---------------------------------------------------------------------------

class TestReconcileAuthStores:
    def test_admin_user_always_present(self, patched_server):
        users, creds = server.reconcile_auth_stores({}, {})
        assert server.ADMIN_USER_KEY in users
        assert users[server.ADMIN_USER_KEY]["accountName"] == server.ADMIN_ACCOUNT_NAME

    def test_admin_credentials_always_present(self, patched_server):
        _, creds = server.reconcile_auth_stores({}, {})
        assert server.ADMIN_USER_KEY in creds

    def test_regular_users_get_usuario_account(self, patched_server):
        users_in = {"alice": {"name": "Alice"}}
        creds_in = {"alice": {"password": "pass", "sessionToken": "tok"}}
        users, _ = server.reconcile_auth_stores(users_in, creds_in)
        assert users["alice"]["accountName"] == "usuario"

    def test_invalid_profiles_dropped(self, patched_server):
        users_in = {"alice": "not a dict"}
        users, _ = server.reconcile_auth_stores(users_in, {})
        assert "alice" not in users


# ---------------------------------------------------------------------------
# clear_now_playing / write_now_playing_payload
# ---------------------------------------------------------------------------

class TestNowPlaying:
    def test_write_creates_file(self, patched_server):
        server.write_now_playing_payload({"albumTitle": "Test"})
        assert (patched_server / "now-playing.json").exists()

    def test_clear_removes_file(self, patched_server):
        path = patched_server / "now-playing.json"
        path.write_text("{}", encoding="utf-8")
        server.clear_now_playing()
        assert not path.exists()

    def test_clear_when_missing_is_noop(self, patched_server):
        # Should not raise if file doesn't exist
        server.clear_now_playing()
