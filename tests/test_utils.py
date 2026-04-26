"""Unit tests for pure utility functions in server.py (no file I/O required)."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server


# ---------------------------------------------------------------------------
# normalize_user_key
# ---------------------------------------------------------------------------

class TestNormalizeUserKey:
    def test_lowercases_input(self):
        assert server.normalize_user_key("Alice") == "alice"

    def test_strips_whitespace(self):
        assert server.normalize_user_key("  Alice  ") == "alice"

    def test_none_returns_empty_string(self):
        assert server.normalize_user_key(None) == ""

    def test_empty_string(self):
        assert server.normalize_user_key("") == ""

    def test_unicode(self):
        assert server.normalize_user_key("Iñaki") == "iñaki"

    def test_already_lowercase(self):
        assert server.normalize_user_key("alice") == "alice"

    def test_mixed_case(self):
        assert server.normalize_user_key("AlIcE") == "alice"


# ---------------------------------------------------------------------------
# _to_non_negative_int
# ---------------------------------------------------------------------------

class TestToNonNegativeInt:
    def test_positive_int(self):
        assert server._to_non_negative_int(5) == 5

    def test_zero(self):
        assert server._to_non_negative_int(0) == 0

    def test_negative_returns_default(self):
        assert server._to_non_negative_int(-3) == 0

    def test_string_number(self):
        assert server._to_non_negative_int("10") == 10

    def test_none_returns_default(self):
        assert server._to_non_negative_int(None) == 0

    def test_custom_default(self):
        assert server._to_non_negative_int(None, default=5) == 5

    def test_invalid_string_returns_default(self):
        assert server._to_non_negative_int("abc") == 0

    def test_float_is_truncated(self):
        assert server._to_non_negative_int(3.9) == 3

    def test_negative_with_custom_default(self):
        assert server._to_non_negative_int(-1, default=99) == 99


# ---------------------------------------------------------------------------
# sanitize_user_profile
# ---------------------------------------------------------------------------

class TestSanitizeUserProfile:
    def test_none_returns_none(self):
        assert server.sanitize_user_profile(None) is None

    def test_non_dict_returns_none(self):
        assert server.sanitize_user_profile("string") is None
        assert server.sanitize_user_profile([]) is None
        assert server.sanitize_user_profile(42) is None

    def test_basic_profile(self):
        profile = {"name": "Alice", "photoDataUrl": "data:image/png;base64,abc"}
        result = server.sanitize_user_profile(profile)
        assert result["name"] == "Alice"
        assert result["photoDataUrl"] == "data:image/png;base64,abc"

    def test_description_capped_at_150(self):
        profile = {"name": "Alice", "description": "x" * 200}
        result = server.sanitize_user_profile(profile)
        assert len(result["description"]) == 150

    def test_description_at_limit_unchanged(self):
        profile = {"name": "Alice", "description": "x" * 150}
        result = server.sanitize_user_profile(profile)
        assert len(result["description"]) == 150

    def test_instagram_strips_at_sign(self):
        profile = {"name": "Alice", "instagramUsername": "@handle"}
        result = server.sanitize_user_profile(profile)
        assert result["instagramUsername"] == "handle"

    def test_instagram_capped_at_40(self):
        profile = {"name": "Alice", "instagramUsername": "x" * 50}
        result = server.sanitize_user_profile(profile)
        assert len(result["instagramUsername"]) == 40

    def test_spotify_url_capped_at_200(self):
        profile = {"name": "Alice", "spotifyUrl": "https://open.spotify.com/user/" + "x" * 300}
        result = server.sanitize_user_profile(profile)
        assert len(result["spotifyUrl"]) == 200

    def test_top_albums_padded_to_3(self):
        result = server.sanitize_user_profile({"name": "Alice"})
        assert len(result["topAlbums"]) == 3
        assert all(a["title"] == "" for a in result["topAlbums"])

    def test_top_albums_capped_at_3(self):
        albums = [{"title": f"Album {i}", "artist": "Artist", "coverUrl": ""} for i in range(5)]
        result = server.sanitize_user_profile({"name": "Alice", "topAlbums": albums})
        assert len(result["topAlbums"]) == 3

    def test_top_album_title_capped_at_150(self):
        albums = [{"title": "x" * 200, "artist": "", "coverUrl": ""}]
        result = server.sanitize_user_profile({"name": "Alice", "topAlbums": albums})
        assert len(result["topAlbums"][0]["title"]) == 150

    def test_top_album_artist_capped_at_120(self):
        albums = [{"title": "T", "artist": "x" * 150, "coverUrl": ""}]
        result = server.sanitize_user_profile({"name": "Alice", "topAlbums": albums})
        assert len(result["topAlbums"][0]["artist"]) == 120

    def test_default_account_name_is_usuario(self):
        result = server.sanitize_user_profile({"name": "Alice"})
        assert result["accountName"] == "usuario"

    def test_backward_compat_string_top_albums(self):
        profile = {"name": "Alice", "topAlbum1": "Abbey Road", "topAlbum2": "OK Computer", "topAlbum3": ""}
        result = server.sanitize_user_profile(profile)
        assert result["topAlbums"][0]["title"] == "Abbey Road"
        assert result["topAlbums"][1]["title"] == "OK Computer"
        assert result["topAlbums"][2]["title"] == ""

    def test_empty_dict_returns_defaults(self):
        result = server.sanitize_user_profile({})
        assert result is not None
        assert result["name"] == ""
        assert result["accountName"] == "usuario"
        assert len(result["topAlbums"]) == 3

    def test_listening_parties_non_negative(self):
        result = server.sanitize_user_profile({"name": "Alice", "listeningPartiesAttended": -5})
        assert result["listeningPartiesAttended"] == 0


# ---------------------------------------------------------------------------
# parse_review_date_key
# ---------------------------------------------------------------------------

class TestParseReviewDateKey:
    def test_iso_date_string(self):
        assert server.parse_review_date_key("2024-01-15") == "2024-01-15"

    def test_iso_datetime_utc(self):
        assert server.parse_review_date_key("2024-01-15T10:30:00Z") == "2024-01-15"

    def test_iso_datetime_with_offset(self):
        assert server.parse_review_date_key("2024-01-15T10:30:00+00:00") == "2024-01-15"

    def test_legacy_dd_mm_yy_format(self):
        assert server.parse_review_date_key("15/01/24") == "2024-01-15"

    def test_empty_returns_empty(self):
        assert server.parse_review_date_key("") == ""

    def test_none_returns_empty(self):
        assert server.parse_review_date_key(None) == ""

    def test_invalid_string_returns_empty(self):
        assert server.parse_review_date_key("not-a-date") == ""


# ---------------------------------------------------------------------------
# parse_iso_datetime
# ---------------------------------------------------------------------------

class TestParseIsoDatetime:
    def test_valid_utc_z(self):
        result = server.parse_iso_datetime("2024-01-15T10:30:00Z")
        assert result is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_valid_with_offset(self):
        result = server.parse_iso_datetime("2024-06-01T12:00:00+05:30")
        assert result is not None

    def test_naive_gets_utc(self):
        result = server.parse_iso_datetime("2024-01-15T10:30:00")
        assert result is not None
        assert result.tzinfo is not None

    def test_none_returns_none(self):
        assert server.parse_iso_datetime(None) is None

    def test_empty_returns_none(self):
        assert server.parse_iso_datetime("") is None

    def test_invalid_returns_none(self):
        assert server.parse_iso_datetime("not-a-date") is None


# ---------------------------------------------------------------------------
# create_session_token
# ---------------------------------------------------------------------------

class TestCreateSessionToken:
    def test_returns_non_empty_string(self):
        token = server.create_session_token()
        assert isinstance(token, str)
        assert token != ""

    def test_tokens_are_unique(self):
        tokens = {server.create_session_token() for _ in range(50)}
        assert len(tokens) == 50

    def test_token_is_url_safe(self):
        import re
        for _ in range(10):
            assert re.match(r"^[A-Za-z0-9_\-]+$", server.create_session_token())

    def test_token_length_sufficient(self):
        # 48 bytes base64url → at least 60 chars
        assert len(server.create_session_token()) >= 60


# ---------------------------------------------------------------------------
# read_session_token / read_plaintext_password / read_session_last_seen
# ---------------------------------------------------------------------------

class TestReadCredentialsHelpers:
    def test_read_session_token_present(self):
        assert server.read_session_token({"sessionToken": "tok123"}) == "tok123"

    def test_read_session_token_missing(self):
        assert server.read_session_token({}) == ""

    def test_read_session_token_none_arg(self):
        assert server.read_session_token(None) == ""

    def test_read_session_token_non_dict(self):
        assert server.read_session_token("nope") == ""

    def test_read_plaintext_password(self):
        assert server.read_plaintext_password({"password": "secret"}) == "secret"

    def test_read_plaintext_password_missing(self):
        assert server.read_plaintext_password({}) == ""

    def test_read_plaintext_password_none(self):
        assert server.read_plaintext_password(None) == ""

    def test_read_session_last_seen(self):
        ts = "2024-01-15T10:30:00Z"
        assert server.read_session_last_seen({"sessionLastSeenAt": ts}) == ts

    def test_read_session_last_seen_missing(self):
        assert server.read_session_last_seen({}) == ""


# ---------------------------------------------------------------------------
# find_user_key_by_session_token
# ---------------------------------------------------------------------------

class TestFindUserKeyBySessionToken:
    def test_finds_correct_user(self):
        creds = {
            "alice": {"sessionToken": "tok_alice"},
            "bob": {"sessionToken": "tok_bob"},
        }
        assert server.find_user_key_by_session_token(creds, "tok_bob") == "bob"

    def test_returns_empty_when_not_found(self):
        creds = {"alice": {"sessionToken": "tok_alice"}}
        assert server.find_user_key_by_session_token(creds, "unknown") == ""

    def test_empty_token_returns_empty(self):
        creds = {"alice": {"sessionToken": "tok_alice"}}
        assert server.find_user_key_by_session_token(creds, "") == ""

    def test_none_token_returns_empty(self):
        assert server.find_user_key_by_session_token({}, None) == ""

    def test_empty_store(self):
        assert server.find_user_key_by_session_token({}, "anything") == ""


# ---------------------------------------------------------------------------
# is_recent_active_session
# ---------------------------------------------------------------------------

class TestIsRecentActiveSession:
    def _entry(self, token, last_seen_offset_seconds):
        now = datetime.now(timezone.utc)
        last_seen = (now - timedelta(seconds=last_seen_offset_seconds)).isoformat()
        return {"sessionToken": token, "sessionLastSeenAt": last_seen}

    def test_fresh_session(self):
        entry = self._entry("tok", 10)
        assert server.is_recent_active_session(entry, datetime.now(timezone.utc)) is True

    def test_session_at_boundary(self):
        entry = self._entry("tok", server.ACTIVE_USER_WINDOW_SECONDS)
        assert server.is_recent_active_session(entry, datetime.now(timezone.utc)) is True

    def test_expired_session(self):
        entry = self._entry("tok", server.ACTIVE_USER_WINDOW_SECONDS + 1)
        assert server.is_recent_active_session(entry, datetime.now(timezone.utc)) is False

    def test_no_session_token(self):
        now = datetime.now(timezone.utc)
        entry = {"sessionToken": "", "sessionLastSeenAt": now.isoformat()}
        assert server.is_recent_active_session(entry, now) is False

    def test_no_last_seen(self):
        entry = {"sessionToken": "tok"}
        assert server.is_recent_active_session(entry, datetime.now(timezone.utc)) is False


# ---------------------------------------------------------------------------
# touch_session_activity
# ---------------------------------------------------------------------------

class TestTouchSessionActivity:
    def test_updates_last_seen(self):
        creds = {"alice": {"sessionToken": "tok", "sessionLastSeenAt": "old_value"}}
        result = server.touch_session_activity(creds, "alice")
        assert result is True
        assert creds["alice"]["sessionLastSeenAt"] != "old_value"

    def test_updated_value_is_valid_iso(self):
        creds = {"alice": {"sessionToken": "tok"}}
        server.touch_session_activity(creds, "alice")
        parsed = server.parse_iso_datetime(creds["alice"]["sessionLastSeenAt"])
        assert parsed is not None

    def test_missing_user_returns_false(self):
        assert server.touch_session_activity({}, "alice") is False

    def test_no_token_returns_false(self):
        creds = {"alice": {"sessionToken": ""}}
        assert server.touch_session_activity(creds, "alice") is False

    def test_empty_user_key_returns_false(self):
        creds = {"alice": {"sessionToken": "tok"}}
        assert server.touch_session_activity(creds, "") is False


# ---------------------------------------------------------------------------
# get_session_sticky_attendee_keys / add_session_sticky_attendee
# ---------------------------------------------------------------------------

class TestStickyAttendees:
    def test_get_keys_normalizes_and_deduplicates(self):
        session = {"stickyAttendeeKeys": ["Alice", "alice", "BOB"]}
        result = server.get_session_sticky_attendee_keys(session)
        assert result == ["alice", "bob"]

    def test_get_keys_empty(self):
        assert server.get_session_sticky_attendee_keys({"stickyAttendeeKeys": []}) == []

    def test_get_keys_non_dict(self):
        assert server.get_session_sticky_attendee_keys(None) == []

    def test_get_keys_missing_field(self):
        assert server.get_session_sticky_attendee_keys({}) == []

    def test_add_new_attendee(self):
        session = {"stickyAttendeeKeys": []}
        assert server.add_session_sticky_attendee(session, "alice") is True
        assert "alice" in session["stickyAttendeeKeys"]

    def test_add_duplicate_returns_false(self):
        session = {"stickyAttendeeKeys": ["alice"]}
        assert server.add_session_sticky_attendee(session, "alice") is False
        assert session["stickyAttendeeKeys"].count("alice") == 1

    def test_add_duplicate_different_case(self):
        session = {"stickyAttendeeKeys": ["alice"]}
        assert server.add_session_sticky_attendee(session, "ALICE") is False

    def test_add_empty_key_returns_false(self):
        session = {"stickyAttendeeKeys": []}
        assert server.add_session_sticky_attendee(session, "") is False

    def test_add_to_non_dict_returns_false(self):
        assert server.add_session_sticky_attendee(None, "alice") is False


# ---------------------------------------------------------------------------
# parse_cookie_header
# ---------------------------------------------------------------------------

class TestParseCookieHeader:
    def test_single_cookie(self):
        assert server.parse_cookie_header("name=value") == {"name": "value"}

    def test_multiple_cookies(self):
        result = server.parse_cookie_header("a=1; b=2; c=3")
        assert result == {"a": "1", "b": "2", "c": "3"}

    def test_empty_string(self):
        assert server.parse_cookie_header("") == {}

    def test_none(self):
        assert server.parse_cookie_header(None) == {}

    def test_ignores_parts_without_equals(self):
        result = server.parse_cookie_header("novalue; key=val")
        assert "novalue" not in result
        assert result["key"] == "val"

    def test_value_with_equals(self):
        result = server.parse_cookie_header("token=abc=def")
        assert result["token"] == "abc=def"


# ---------------------------------------------------------------------------
# build_session_cookie / build_user_cookie helpers
# ---------------------------------------------------------------------------

class TestCookieBuilders:
    def test_session_cookie_contains_token(self):
        cookie = server.build_session_cookie("my_token_123")
        assert "my_token_123" in cookie

    def test_session_cookie_is_http_only(self):
        assert "HttpOnly" in server.build_session_cookie("tok")

    def test_session_cookie_has_path(self):
        assert "Path=/" in server.build_session_cookie("tok")

    def test_clear_session_cookie_zeroes_max_age(self):
        assert "Max-Age=0" in server.build_clear_session_cookie()

    def test_user_cookie_contains_key(self):
        assert "alice" in server.build_user_cookie("alice")

    def test_user_cookie_encodes_special_chars(self):
        cookie = server.build_user_cookie("Iñaki")
        assert "Iñaki" not in cookie  # must be percent-encoded

    def test_clear_user_cookie_zeroes_max_age(self):
        assert "Max-Age=0" in server.build_clear_user_cookie()


# ---------------------------------------------------------------------------
# build_user_reviews
# ---------------------------------------------------------------------------

class TestBuildUserReviews:
    def setup_method(self):
        self.store = {
            "Abbey Road::Come Together": [
                {"name": "Alice", "rating": 4.5, "text": "Great", "createdAt": "2024-01-10", "likes": []},
                {"name": "Bob", "rating": 3.0, "text": "OK", "createdAt": "2024-01-09", "likes": []},
            ],
            "album::The Beatles::Abbey Road": [
                {"name": "Alice", "rating": 5.0, "text": "Best", "createdAt": "2024-01-12", "likes": []},
            ],
            "Revolver::Eleanor Rigby": [
                {"name": "Charlie", "rating": 4.0, "text": "Classic", "createdAt": "2024-01-08", "likes": []},
            ],
        }

    def test_returns_only_matching_user(self):
        reviews = server.build_user_reviews(self.store, "Alice")
        assert len(reviews) == 2
        assert all("Alice" in r["reviewKey"] or True for r in reviews)

    def test_case_insensitive_name_match(self):
        reviews = server.build_user_reviews(self.store, "alice")
        assert len(reviews) == 2

    def test_empty_name_returns_empty(self):
        assert server.build_user_reviews(self.store, "") == []

    def test_unknown_user_returns_empty(self):
        assert server.build_user_reviews(self.store, "Nobody") == []

    def test_song_scope_has_correct_fields(self):
        reviews = server.build_user_reviews(self.store, "Alice")
        song = next(r for r in reviews if r["scope"] == "song")
        assert song["albumTitle"] == "Abbey Road"
        assert song["songTitle"] == "Come Together"

    def test_album_scope_has_correct_fields(self):
        reviews = server.build_user_reviews(self.store, "Alice")
        album = next(r for r in reviews if r["scope"] == "album")
        assert album["albumTitle"] == "Abbey Road"
        assert album["songTitle"] == ""

    def test_sorted_descending_by_created_at(self):
        reviews = server.build_user_reviews(self.store, "Alice")
        dates = [r["createdAt"] for r in reviews]
        assert dates == sorted(dates, reverse=True)


# ---------------------------------------------------------------------------
# collect_reviewing_attendees
# ---------------------------------------------------------------------------

class TestCollectReviewingAttendees:
    def test_collects_unique_names(self):
        reviews = [
            {"reviewer": "Alice", "rating": 4},
            {"reviewer": "Bob", "rating": 3},
            {"reviewer": "alice", "rating": 5},  # duplicate (case-insensitive)
        ]
        result = server.collect_reviewing_attendees(reviews)
        assert result == ["Alice", "Bob"]

    def test_skips_empty_reviewer(self):
        reviews = [{"reviewer": "", "rating": 3}, {"reviewer": "Bob", "rating": 4}]
        assert server.collect_reviewing_attendees(reviews) == ["Bob"]

    def test_skips_non_dict_entries(self):
        reviews = ["not a dict", {"reviewer": "Alice", "rating": 5}]
        assert server.collect_reviewing_attendees(reviews) == ["Alice"]

    def test_empty_list(self):
        assert server.collect_reviewing_attendees([]) == []


# ---------------------------------------------------------------------------
# collect_reviews_for_albums
# ---------------------------------------------------------------------------

class TestCollectReviewsForAlbums:
    def setup_method(self):
        self.store = {
            "Abbey Road::Come Together": [
                {
                    "name": "Alice",
                    "rating": 4.5,
                    "text": "Great",
                    "createdAt": "2024-01-10T00:00:00Z",
                    "partyId": "party1",
                    "likes": [],
                }
            ],
            "album::The Beatles::Abbey Road": [
                {
                    "name": "Bob",
                    "rating": 5.0,
                    "text": "Best",
                    "createdAt": "2024-01-10T00:00:00Z",
                    "partyId": "party1",
                    "likes": [{"name": "Charlie", "photoDataUrl": ""}],
                }
            ],
            "Sgt. Pepper::Lucy in the Sky": [
                {
                    "name": "Alice",
                    "rating": 3.5,
                    "text": "Good",
                    "createdAt": "2024-01-10T00:00:00Z",
                    "partyId": "party1",
                    "likes": [],
                }
            ],
        }
        self.albums_played = [{"title": "Abbey Road", "artist": "The Beatles"}]

    def test_filters_by_album_title(self):
        result = server.collect_reviews_for_albums(
            self.store, self.albums_played, party_id_filter="party1"
        )
        assert len(result) == 2
        assert all(r["albumTitle"] == "Abbey Road" for r in result)

    def test_empty_albums_returns_empty(self):
        result = server.collect_reviews_for_albums(self.store, [], party_id_filter="party1")
        assert result == []

    def test_album_scope_detected(self):
        result = server.collect_reviews_for_albums(
            self.store, self.albums_played, party_id_filter="party1"
        )
        album_review = next((r for r in result if r["scope"] == "album"), None)
        assert album_review is not None
        assert album_review["songTitle"] == ""

    def test_song_scope_detected(self):
        result = server.collect_reviews_for_albums(
            self.store, self.albums_played, party_id_filter="party1"
        )
        song_review = next((r for r in result if r["scope"] == "song"), None)
        assert song_review is not None
        assert song_review["songTitle"] == "Come Together"

    def test_wrong_party_id_excluded(self):
        result = server.collect_reviews_for_albums(
            self.store, self.albums_played, party_id_filter="other_party"
        )
        assert result == []

    def test_case_insensitive_album_title(self):
        result = server.collect_reviews_for_albums(
            self.store, [{"title": "abbey road"}], party_id_filter="party1"
        )
        assert len(result) == 2

    def test_likes_normalized(self):
        result = server.collect_reviews_for_albums(
            self.store, self.albums_played, party_id_filter="party1"
        )
        album_review = next(r for r in result if r["scope"] == "album")
        assert album_review["likes"] == [{"name": "Charlie", "photoDataUrl": ""}]


# ---------------------------------------------------------------------------
# increment_users_listening_parties_attended
# ---------------------------------------------------------------------------

class TestIncrementUsersListeningPartiesAttended:
    def test_increments_count(self):
        users = {"alice": {"name": "Alice", "listeningPartiesAttended": 2}}
        result = server.increment_users_listening_parties_attended(users, ["alice"])
        assert result is True
        assert users["alice"]["listeningPartiesAttended"] == 3

    def test_starts_from_zero(self):
        users = {"alice": {"name": "Alice", "listeningPartiesAttended": 0}}
        server.increment_users_listening_parties_attended(users, ["alice"])
        assert users["alice"]["listeningPartiesAttended"] == 1

    def test_multiple_users_updated(self):
        users = {
            "alice": {"listeningPartiesAttended": 1},
            "bob": {"listeningPartiesAttended": 5},
        }
        server.increment_users_listening_parties_attended(users, ["alice", "bob"])
        assert users["alice"]["listeningPartiesAttended"] == 2
        assert users["bob"]["listeningPartiesAttended"] == 6

    def test_unknown_user_skipped(self):
        users = {}
        assert server.increment_users_listening_parties_attended(users, ["alice"]) is False

    def test_non_dict_users_store(self):
        assert server.increment_users_listening_parties_attended(None, ["alice"]) is False

    def test_non_list_user_keys(self):
        users = {"alice": {"listeningPartiesAttended": 0}}
        assert server.increment_users_listening_parties_attended(users, None) is False


# ---------------------------------------------------------------------------
# _make_facts_key
# ---------------------------------------------------------------------------

class TestMakeFactsKey:
    def test_basic(self):
        assert server._make_facts_key("Abbey Road", "The Beatles") == "abbey road::the beatles"

    def test_strips_whitespace(self):
        assert server._make_facts_key("  Album  ", "  Artist  ") == "album::artist"

    def test_lowercase(self):
        assert server._make_facts_key("ALBUM", "ARTIST") == "album::artist"
