"""Integration tests for HTTP endpoints using a live test server (live_server fixture)."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _request(base_url, path, *, method="GET", body=None, cookies=None):
    """Make an HTTP request and return (status, body_dict_or_str, headers)."""
    url = base_url + path
    headers = {}
    data = None

    if body is not None:
        if isinstance(body, dict):
            data = json.dumps(body).encode("utf-8")
        else:
            data = body
        headers["Content-Type"] = "application/json; charset=utf-8"
        headers["Content-Length"] = str(len(data))

    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    def _parse(raw):
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, _parse(resp.read()), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, _parse(exc.read()), dict(exc.headers)


def _register(base_url, name, password="password123"):
    return _request(base_url, "/api/users/register", method="POST", body={"name": name, "password": password})


def _login(base_url, name, password="password123"):
    return _request(base_url, "/api/users/login", method="POST", body={"name": name, "password": password})


def _session_cookies_from_headers(headers):
    """Extract session token and user cookies from raw Set-Cookie header(s)."""
    cookies = {}
    raw = headers.get("Set-Cookie", "")
    for part in raw.split(","):
        kv = part.strip().split(";")[0].strip()
        if "=" in kv:
            k, _, v = kv.partition("=")
            k = k.strip()
            v = v.strip()
            if k in (server.SESSION_COOKIE_NAME, server.SESSION_USER_COOKIE_NAME):
                cookies[k] = v
    return cookies


# ---------------------------------------------------------------------------
# GET /api/users
# ---------------------------------------------------------------------------

class TestGetUser:
    def test_nonexistent_user_returns_exists_false(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/users?name=nobody_here")
        assert status == 200
        assert body["exists"] is False
        assert body["user"] is None

    def test_no_name_param_returns_exists_false(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/users")
        assert status == 200
        assert body["exists"] is False

    def test_registered_user_found(self, live_server):
        _register(live_server["base_url"], "GetUserTest")
        status, body, _ = _request(live_server["base_url"], "/api/users?name=GetUserTest")
        assert status == 200
        assert body["exists"] is True
        assert body["user"]["name"] == "GetUserTest"


# ---------------------------------------------------------------------------
# POST /api/users/register
# ---------------------------------------------------------------------------

class TestRegister:
    def test_success_returns_user(self, live_server):
        status, body, headers = _register(live_server["base_url"], "NewRegUser1")
        assert status == 200
        assert "user" in body
        assert body["user"]["name"] == "NewRegUser1"

    def test_success_sets_session_cookie(self, live_server):
        _, _, headers = _register(live_server["base_url"], "NewRegUser2")
        assert server.SESSION_COOKIE_NAME in headers.get("Set-Cookie", "")

    def test_duplicate_name_returns_409(self, live_server):
        _register(live_server["base_url"], "DupUser")
        status, body, _ = _register(live_server["base_url"], "DupUser")
        assert status == 409
        assert "error" in body

    def test_missing_name_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/register", method="POST",
            body={"password": "pass"}
        )
        assert status == 400

    def test_missing_password_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/register", method="POST",
            body={"name": "SomeUser"}
        )
        assert status == 400

    def test_invalid_json_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/register", method="POST",
            body=b"not-json-at-all"
        )
        assert status == 400


# ---------------------------------------------------------------------------
# POST /api/users/login
# ---------------------------------------------------------------------------

class TestLogin:
    def test_success_returns_user(self, live_server):
        _register(live_server["base_url"], "LoginOK")
        status, body, _ = _login(live_server["base_url"], "LoginOK")
        assert status == 200
        assert body["user"]["name"] == "LoginOK"

    def test_success_sets_session_cookie(self, live_server):
        _register(live_server["base_url"], "LoginCookieUser")
        _, _, headers = _login(live_server["base_url"], "LoginCookieUser")
        assert server.SESSION_COOKIE_NAME in headers.get("Set-Cookie", "")

    def test_wrong_password_returns_401(self, live_server):
        _register(live_server["base_url"], "WrongPass", "correct")
        status, body, _ = _login(live_server["base_url"], "WrongPass", "wrong")
        assert status == 401

    def test_unknown_user_returns_404(self, live_server):
        status, body, _ = _login(live_server["base_url"], "Nobody_At_All")
        assert status == 404

    def test_missing_name_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/login", method="POST",
            body={"password": "pass"}
        )
        assert status == 400

    def test_missing_password_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/login", method="POST",
            body={"name": "SomeUser"}
        )
        assert status == 400


# ---------------------------------------------------------------------------
# POST /api/users/logout
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_clears_session_cookie(self, live_server):
        _register(live_server["base_url"], "LogoutUser")
        _, _, login_headers = _login(live_server["base_url"], "LogoutUser")
        cookies = _session_cookies_from_headers(login_headers)

        status, body, headers = _request(
            live_server["base_url"], "/api/users/logout", method="POST",
            body={}, cookies=cookies
        )
        assert status == 200
        assert "Max-Age=0" in headers.get("Set-Cookie", "")

    def test_logout_without_session_still_200(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/logout", method="POST", body={}
        )
        assert status == 200


# ---------------------------------------------------------------------------
# GET /api/users/me
# ---------------------------------------------------------------------------

class TestGetMe:
    def test_no_session_returns_null_user(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/users/me")
        assert status == 200
        assert body["user"] is None

    def test_valid_session_returns_user(self, live_server):
        _register(live_server["base_url"], "MeUser")
        _, _, login_headers = _login(live_server["base_url"], "MeUser")
        cookies = _session_cookies_from_headers(login_headers)

        status, body, _ = _request(live_server["base_url"], "/api/users/me", cookies=cookies)
        assert status == 200
        assert body["user"] is not None
        assert body["user"]["name"] == "MeUser"


# ---------------------------------------------------------------------------
# GET /api/users/reviews
# ---------------------------------------------------------------------------

class TestGetUserReviews:
    def test_returns_empty_list_for_new_user(self, live_server):
        _register(live_server["base_url"], "ReviewsUser")
        status, body, _ = _request(live_server["base_url"], "/api/users/reviews?name=ReviewsUser")
        assert status == 200
        assert body["reviews"] == []

    def test_missing_name_returns_400(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/users/reviews")
        assert status == 400


# ---------------------------------------------------------------------------
# GET /api/users/active
# ---------------------------------------------------------------------------

class TestGetActiveUsers:
    def test_returns_list(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/users/active")
        assert status == 200
        assert "users" in body
        assert isinstance(body["users"], list)

    def test_logged_in_user_appears(self, live_server):
        _register(live_server["base_url"], "ActiveUser")
        _, _, login_headers = _login(live_server["base_url"], "ActiveUser")
        cookies = _session_cookies_from_headers(login_headers)

        # Touch session to make user active
        _request(live_server["base_url"], "/api/users/me", cookies=cookies)

        status, body, _ = _request(live_server["base_url"], "/api/users/active")
        assert status == 200
        names = [u.get("name") for u in body["users"]]
        assert "ActiveUser" in names


# ---------------------------------------------------------------------------
# GET /api/reviews
# ---------------------------------------------------------------------------

class TestGetReviews:
    def test_empty_for_unknown_song_key(self, live_server):
        encoded = quote("Some Album::Some Song")
        status, body, _ = _request(live_server["base_url"], f"/api/reviews?songKey={encoded}")
        assert status == 200
        assert body["reviews"] == []

    def test_missing_song_key_returns_empty(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/reviews")
        assert status == 200
        assert body["reviews"] == []


# ---------------------------------------------------------------------------
# GET /api/live-albums
# ---------------------------------------------------------------------------

class TestGetLiveAlbums:
    def test_returns_empty_albums_initially(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/live-albums")
        assert status == 200
        assert body["albums"] == []


# ---------------------------------------------------------------------------
# GET /api/fun-facts
# ---------------------------------------------------------------------------

class TestGetFunFacts:
    def test_missing_params_returns_empty(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/fun-facts")
        assert status == 200
        assert body["facts"] == []

    def test_missing_artist_returns_empty(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/fun-facts?album=Abbey+Road")
        assert status == 200
        assert body["facts"] == []


# ---------------------------------------------------------------------------
# POST /api/users/photo
# ---------------------------------------------------------------------------

class TestUpdatePhoto:
    def test_updates_photo(self, live_server):
        _register(live_server["base_url"], "PhotoUser")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/photo", method="POST",
            body={"name": "PhotoUser", "photoDataUrl": "data:image/png;base64,abc"}
        )
        assert status == 200
        assert body["user"]["photoDataUrl"] == "data:image/png;base64,abc"

    def test_missing_name_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/photo", method="POST",
            body={"photoDataUrl": "data:image/png;base64,abc"}
        )
        assert status == 400

    def test_missing_photo_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/photo", method="POST",
            body={"name": "SomeUser"}
        )
        assert status == 400

    def test_nonexistent_user_returns_404(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/photo", method="POST",
            body={"name": "GhostUser", "photoDataUrl": "data:image/png;base64,abc"}
        )
        assert status == 404


# ---------------------------------------------------------------------------
# POST /api/users/profile
# ---------------------------------------------------------------------------

class TestUpdateProfile:
    def test_updates_description(self, live_server):
        _register(live_server["base_url"], "ProfileUser")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"name": "ProfileUser", "description": "Hello world"}
        )
        assert status == 200
        assert body["user"]["description"] == "Hello world"

    def test_description_too_long_returns_400(self, live_server):
        _register(live_server["base_url"], "ProfileUserLong")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"name": "ProfileUserLong", "description": "x" * 200}
        )
        assert status == 400

    def test_invalid_spotify_url_returns_400(self, live_server):
        _register(live_server["base_url"], "SpotifyUser")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"name": "SpotifyUser", "spotifyUrl": "https://example.com/notspotify"}
        )
        assert status == 400

    def test_valid_spotify_url_accepted(self, live_server):
        _register(live_server["base_url"], "SpotifyUserOK")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={
                "name": "SpotifyUserOK",
                "spotifyUrl": "https://open.spotify.com/user/abc123",
            }
        )
        assert status == 200

    def test_instagram_strips_at_sign(self, live_server):
        _register(live_server["base_url"], "InstaUser")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"name": "InstaUser", "instagramUsername": "@myhandle"}
        )
        assert status == 200
        assert body["user"]["instagramUsername"] == "myhandle"

    def test_instagram_too_long_returns_400(self, live_server):
        _register(live_server["base_url"], "InstaUserLong")
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"name": "InstaUserLong", "instagramUsername": "x" * 50}
        )
        assert status == 400

    def test_missing_name_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/users/profile", method="POST",
            body={"description": "No name provided"}
        )
        assert status == 400


# ---------------------------------------------------------------------------
# POST /api/reviews/like
# ---------------------------------------------------------------------------

class TestLikeReview:
    def test_missing_required_fields_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/reviews/like", method="POST",
            body={"songKey": "Abbey Road::Come Together"}
        )
        assert status == 400

    def test_nonexistent_review_returns_404(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/reviews/like", method="POST",
            body={
                "songKey": "Abbey Road::Come Together",
                "reviewerName": "nobody",
                "likerName": "someone",
            }
        )
        assert status == 404


# ---------------------------------------------------------------------------
# Admin-only endpoints (actorName-based auth)
# ---------------------------------------------------------------------------

class TestNowPlayingAdminOnly:
    def test_non_admin_user_returns_403(self, live_server):
        _register(live_server["base_url"], "NormalUser42")
        status, body, _ = _request(
            live_server["base_url"], "/api/now-playing", method="POST",
            body={
                "actorName": "NormalUser42",
                "albumTitle": "Abbey Road",
                "albumArtist": "The Beatles",
                "songTitle": "Come Together",
                "coverUrl": "https://example.com/cover.jpg",
            }
        )
        assert status == 403

    def test_missing_actor_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/now-playing", method="POST",
            body={"albumTitle": "Abbey Road", "albumArtist": "The Beatles"}
        )
        assert status == 400

    def test_missing_album_title_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/now-playing", method="POST",
            body={
                "actorName": server.ADMIN_DEFAULT_NAME,
                "albumArtist": "The Beatles",
                "songTitle": "Come Together",
                "coverUrl": "https://example.com/cover.jpg",
            }
        )
        assert status == 400

    def test_admin_can_set_now_playing(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/now-playing", method="POST",
            body={
                "actorName": server.ADMIN_DEFAULT_NAME,
                "albumTitle": "Abbey Road",
                "albumArtist": "The Beatles",
                "songTitle": "Come Together",
                "coverUrl": "https://example.com/cover.jpg",
                "reviewScope": "song",
            }
        )
        assert status == 200
        assert body["nowPlaying"]["albumTitle"] == "Abbey Road"


class TestFinishPartyAdminOnly:
    def test_non_admin_returns_403(self, live_server):
        _register(live_server["base_url"], "NormalUser43")
        status, body, _ = _request(
            live_server["base_url"], "/api/listening-party/finish", method="POST",
            body={"actorName": "NormalUser43"}
        )
        assert status == 403

    def test_missing_actor_returns_400(self, live_server):
        status, body, _ = _request(
            live_server["base_url"], "/api/listening-party/finish", method="POST",
            body={}
        )
        assert status == 400


class TestPartyRecordsAdminOnly:
    def test_no_session_returns_403(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/party-records")
        assert status == 403

    def test_regular_user_returns_403(self, live_server):
        _register(live_server["base_url"], "NormalUser44")
        _, _, login_headers = _login(live_server["base_url"], "NormalUser44")
        cookies = _session_cookies_from_headers(login_headers)
        status, body, _ = _request(live_server["base_url"], "/api/party-records", cookies=cookies)
        assert status == 403


class TestAdminUsersAdminOnly:
    def test_no_session_returns_403(self, live_server):
        status, body, _ = _request(live_server["base_url"], "/api/admin/users")
        assert status == 403


# ---------------------------------------------------------------------------
# POST /api/live-albums (admin cookie required)
# ---------------------------------------------------------------------------

class TestPostLiveAlbums:
    def test_non_admin_returns_403(self, live_server):
        _register(live_server["base_url"], "NormalUser45")
        _, _, login_headers = _login(live_server["base_url"], "NormalUser45")
        cookies = _session_cookies_from_headers(login_headers)
        status, body, _ = _request(
            live_server["base_url"], "/api/live-albums", method="POST",
            body={"id": "x1", "title": "Test", "artist": "Artist"},
            cookies=cookies,
        )
        assert status == 403


# ---------------------------------------------------------------------------
# PATCH /api/live-albums (admin cookie required)
# ---------------------------------------------------------------------------

class TestPatchLiveAlbums:
    def test_non_admin_returns_403(self, live_server):
        _register(live_server["base_url"], "NormalUser46")
        _, _, login_headers = _login(live_server["base_url"], "NormalUser46")
        cookies = _session_cookies_from_headers(login_headers)
        status, body, _ = _request(
            live_server["base_url"], "/api/live-albums", method="PATCH",
            body={"id": "x1", "tracks": []},
            cookies=cookies,
        )
        assert status == 403


# ---------------------------------------------------------------------------
# Unknown API path
# ---------------------------------------------------------------------------

class TestNotFound:
    def test_unknown_api_path_returns_404(self, live_server):
        # Unknown /api/ paths fall through to the static file handler → 404 HTML
        status, _, _ = _request(live_server["base_url"], "/api/this_does_not_exist_xyz")
        assert status == 404
