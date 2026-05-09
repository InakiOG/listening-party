"""
Spotify integration for Listening Party.
Controls Spotify playback to mirror whatever the admin sets as now-playing.

Setup:
1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file
3. Add your redirect URI to the Spotify app settings (must match SPOTIFY_REDIRECT_URI in .env)
4. Open the app on the same machine as the server, log in as admin, click the Spotify button
5. Once connected, Spotify will follow every now-playing change automatically
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
# Needs write permission to control playback
SPOTIFY_SCOPES = "user-modify-playback-state user-read-playback-state"


def build_auth_url(client_id: str, redirect_uri: str) -> str:
    return SPOTIFY_AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": SPOTIFY_SCOPES,
    })


def _b64(s: str) -> str:
    import base64
    return base64.b64encode(s.encode()).decode()


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    """Exchange an authorization code for access + refresh tokens."""
    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode()
    req = urllib.request.Request(
        SPOTIFY_TOKEN_URL,
        data=data,
        headers={
            "Authorization": f"Basic {_b64(f'{client_id}:{client_secret}')}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Get a fresh access token using the refresh token."""
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode()
    req = urllib.request.Request(
        SPOTIFY_TOKEN_URL,
        data=data,
        headers={
            "Authorization": f"Basic {_b64(f'{client_id}:{client_secret}')}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _spotify_put(access_token: str, url: str, body: Optional[dict]) -> None:
    """PUT to a Spotify endpoint. Raises urllib.error.HTTPError on failure."""
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()


def _search(access_token: str, query: str, search_type: str) -> list:
    """Search Spotify. Returns list of items of the given type."""
    url = "https://api.spotify.com/v1/search?" + urllib.parse.urlencode({
        "q": query,
        "type": search_type,
        "limit": 3,
    })
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    return data.get(f"{search_type}s", {}).get("items", [])


def trigger_playback(
    access_token: str,
    album_title: str,
    album_artist: str,
    song_title: str,
    review_scope: str,
) -> None:
    """
    Start playing on Spotify.
    - review_scope == "album"  → find the album and play from track 1
    - review_scope == "song"   → find the specific track and play it
    Raises an exception if the Spotify API call fails.
    """
    if review_scope == "album":
        # Try precise field filter first, then fall back to plain text
        for query in (
            f'album:"{album_title}" artist:"{album_artist}"',
            f"{album_title} {album_artist}",
        ):
            items = _search(access_token, query, "album")
            if items:
                break

        if not items:
            raise RuntimeError(f"Album '{album_title}' by '{album_artist}' not found on Spotify")

        album_uri = items[0]["uri"]
        logger.info("Spotify: playing album %s (%s)", album_title, album_uri)
        try:
            _spotify_put(
                access_token,
                "https://api.spotify.com/v1/me/player/play",
                {"context_uri": album_uri, "offset": {"position": 0}, "position_ms": 0},
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise RuntimeError("No active Spotify device found — open Spotify on any device first") from exc
            raise

    else:  # song scope
        for query in (
            f'track:"{song_title}" artist:"{album_artist}"',
            f"{song_title} {album_artist}",
        ):
            items = _search(access_token, query, "track")
            if items:
                break

        if not items:
            raise RuntimeError(f"Track '{song_title}' by '{album_artist}' not found on Spotify")

        track_uri = items[0]["uri"]
        logger.info("Spotify: playing track %s (%s)", song_title, track_uri)
        try:
            _spotify_put(
                access_token,
                "https://api.spotify.com/v1/me/player/play",
                {"uris": [track_uri], "position_ms": 0},
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise RuntimeError("No active Spotify device found — open Spotify on any device first") from exc
            raise
