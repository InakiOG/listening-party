# Listening Party

A local-network web app for hosting vinyl listening parties. Guests join on their phones, browse a synced Discogs vinyl collection, and leave star ratings and text reviews for albums and songs in real time. A host (`administrador`) controls what's currently playing from the same UI. AI-generated fun facts about each album are fetched on demand and cached.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Data Files](#data-files)
5. [Running the App](#running-the-app)
6. [Server Flags](#server-flags)
7. [API Reference](#api-reference)
8. [Authentication & Sessions](#authentication--sessions)
9. [Admin Controls](#admin-controls)
10. [Discogs Integration](#discogs-integration)
11. [Fun Facts (AI)](#fun-facts-ai)
12. [Frontend](#frontend)
13. [Testing](#testing)
14. [Maintenance Utility](#maintenance-utility)
15. [Environment Variables](#environment-variables)
16. [Wiki & MCP Server](#wiki--mcp-server)
17. [Known Limitations & Security Notes](#known-limitations--security-notes)

---

## Overview

- **Who it's for:** A group of people in the same room on the same local network.
- **What it does:** Displays a vinyl collection from Discogs, lets everyone rate albums and individual songs, shows who is currently active, and lets the host announce what's currently being listened to.
- **Technology stack:** Python standard library HTTP server, vanilla JavaScript SPA, JSON flat-file storage — zero external runtime dependencies.

---

## Architecture

```
┌──────────────────────────────┐
│  Phone / Desktop browser     │
│  index.html + app.js (phone) │
│  desktop.html (desktop)      │
└──────────────┬───────────────┘
               │ HTTP REST  (local network)
┌──────────────▼───────────────┐
│  server.py                   │
│  ThreadingHTTPServer         │
│  ListeningPartyHandler       │
│  ─ serves static files       │
│  ─ handles /api/* routes     │
│  ─ background threads:       │
│      • fun-facts prefetch    │
│      • track backfill        │
└──────────────┬───────────────┘
               │ read / write
┌──────────────▼───────────────┐
│  JSON files (project root)   │
│  reviews-db.json             │
│  users-db.json               │
│  user-credentials.local.json │
│  discogs-collection.json     │
│  party-records.json          │
│  fun-facts-db.json           │
│  live-albums.json            │
│  now-playing.json            │
└──────────────────────────────┘
```

**Key design decisions:**

- No database, no npm, no build step. The server is pure Python stdlib (`http.server`, `threading`, `json`, `secrets`, `urllib`).
- All client code is vanilla JS. No frameworks, no bundler.
- Thread safety is managed with two locks: `REVIEWS_LOCK` (guards all JSON store reads/writes) and `LIVE_ALBUMS_LOCK`.
- The server clears `now-playing.json` on startup and saves the active party record on graceful shutdown.

---

## Project Structure

```
listening-party/
├── server.py                  # Main HTTP server — all routes and business logic
├── discogs_scraper.py         # Discogs API client + track backfill from MusicBrainz/iTunes
├── controller.py              # Offline maintenance CLI (no longer used by the web UI)
├── start-listening-party.ps1  # PowerShell launcher (opens server in a new terminal)
│
├── index.html                 # Phone SPA (served at /)
├── desktop.html               # Desktop UI (same routes, larger layout)
├── app.js                     # Shared frontend logic imported by index.html
│
├── discogs-collection.json    # Vinyl collection cache (built by discogs_scraper)
├── reviews-db.json            # All user reviews
├── users-db.json              # User profiles
├── user-credentials.local.json  # Passwords + session tokens (gitignored, plaintext)
├── party-records.json         # Historical listening party snapshots
├── fun-facts-db.json          # AI-generated fun facts cache (keyed by album::artist)
├── live-albums.json           # Albums added ad-hoc during a party (not in collection)
├── now-playing.json           # Current track (written on set, deleted on clear/shutdown)
│
├── .env                       # API keys: GEMINI_API_KEY, GROQ_API_KEY (gitignored)
│
├── tests/
│   ├── conftest.py            # Shared fixtures: patched_server, live_server
│   ├── test_utils.py          # Pure utility function unit tests
│   ├── test_file_io.py        # File I/O function tests (temp dir)
│   ├── test_discogs_scraper.py # discogs_scraper.py unit tests
│   └── test_endpoints.py      # HTTP endpoint integration tests (real server)
│
└── ListeningParty/            # Python virtual environment
```

---

## Data Files

### `discogs-collection.json`

Built by `discogs_scraper.py`. Contains the full vinyl collection.

```json
{
  "source": "Discogs public collection API",
  "profile": "InakiOG",
  "updatedAt": "2024-01-15T20:00:00+00:00",
  "totalItems": 120,
  "items": [
    {
      "title": "Abbey Road",
      "artist": "The Beatles",
      "year": 1969,
      "discogsId": 12345,
      "instanceId": 67890,
      "releaseUrl": "https://www.discogs.com/release/12345",
      "artistUrl": "https://www.discogs.com/artist/100",
      "imageUrl": "https://...",
      "imageAlt": "Abbey Road cover",
      "rawText": "Vinyl (Red Transparent); Rock, Classic Rock",
      "tracks": ["Come Together", "Something", "Maxwell's Silver Hammer"],
      "timesPlayed": 3,
      "dateAdded": "2023-06-01T00:00:00-07:00",
      "rating": 5,
      "sourcePage": 1
    }
  ]
}
```

### `reviews-db.json`

Keyed by review key. Two key formats:

| Format | Meaning |
|--------|---------|
| `"Album Title::Song Title"` | Song-level review |
| `"album::Artist::Album Title"` | Album-level review |

Value is an array of review objects:

```json
{
  "name": "Alice",
  "rating": 4.5,
  "text": "Great opening track.",
  "photoDataUrl": "data:image/jpeg;base64,...",
  "createdAt": "2024-01-15T20:30:00+00:00",
  "partyId": "2024-01-15T20:00:00+00:00",
  "likes": [
    { "name": "Bob", "photoDataUrl": "data:image/jpeg;base64,..." }
  ]
}
```

Multiple reviews for the same key are appended. When a user already has a review for a given `partyId`, submitting again **upserts** (replaces) their existing entry.

### `users-db.json`

Keyed by normalized username (lowercase). Each entry:

```json
{
  "name": "Alice",
  "photoDataUrl": "data:image/jpeg;base64,...",
  "description": "Bio text (max 150 chars)",
  "instagramUsername": "handle",
  "spotifyUrl": "https://open.spotify.com/user/...",
  "topAlbums": [
    { "title": "Abbey Road", "artist": "The Beatles", "coverUrl": "https://..." },
    { "title": "OK Computer", "artist": "Radiohead", "coverUrl": "" },
    { "title": "", "artist": "", "coverUrl": "" }
  ],
  "listeningPartiesAttended": 4,
  "createdAt": "2024-01-10T00:00:00+00:00",
  "accountName": "usuario"
}
```

`accountName` is `"administrador"` only for the admin user; everyone else is `"usuario"`.

### `user-credentials.local.json`

**Gitignored. Plaintext passwords. Local only.**

```json
{
  "alice": {
    "name": "Alice",
    "password": "hunter2",
    "createdAt": "2024-01-10T00:00:00+00:00",
    "sessionToken": "abc123...",
    "sessionCreatedAt": "2024-01-15T20:00:00+00:00",
    "sessionLastSeenAt": "2024-01-15T21:00:00+00:00"
  }
}
```

### `party-records.json`

Snapshot of every listening party. Auto-updated while a party is in progress; finalized on `/api/listening-party/finish`.

```json
{
  "parties": [
    {
      "id": "2024-01-15T20:00:00+00:00",
      "date": "2024-01-15T20:00:00+00:00",
      "startedAt": "2024-01-15T20:00:00+00:00",
      "endedAt": "2024-01-15T23:00:00+00:00",
      "finalizedAt": "2024-01-15T23:00:00+00:00",
      "savedAt": "2024-01-15T23:00:00+00:00",
      "attendees": ["Alice", "Bob"],
      "listeners": ["Alice", "Bob", "Charlie"],
      "albumsPlayed": [
        { "title": "Abbey Road", "artist": "The Beatles", "coverUrl": "https://..." }
      ],
      "reviews": [...],
      "partyPicture": "data:image/jpeg;base64,..."
    }
  ]
}
```

- `attendees`: users who submitted at least one review during the party.
- `listeners`: all users who were logged in when the party started (sticky — remain even if they disconnect).

### `now-playing.json`

Written on `POST /api/now-playing`, deleted on clear or server shutdown. Polled by clients.

```json
{
  "albumTitle": "Abbey Road",
  "albumArtist": "The Beatles",
  "songTitle": "Come Together",
  "reviewScope": "song",
  "coverUrl": "https://...",
  "adminThanks": "",
  "updatedAt": "2024-01-15T21:00:00+00:00",
  "updatedBy": "Iñaki",
  "partyId": "2024-01-15T20:00:00+00:00"
}
```

`reviewScope` is `"song"` or `"album"`. When `"album"`, song-level rating UI is hidden.

### `fun-facts-db.json`

Keyed by `"album title lowercase::artist name lowercase"`. Value is an array of up to 15 Spanish-language fact strings. Populated by the background prefetch worker and by inline fetches on `GET /api/fun-facts`.

### `live-albums.json`

Albums added during a party that are not in the Discogs collection (e.g., a friend's record). Structure: `{ "albums": [...] }`. Cleared between parties by the admin.

---

## Running the App

**Prerequisites:** Python 3.10+, no external packages required.

```bash
# Create and activate the virtual environment (first time only)
python -m venv ListeningParty
.\ListeningParty\Scripts\activate     # Windows
source ListeningParty/bin/activate    # macOS/Linux

# Start the server
python server.py
```

Open in a browser:

- Same machine: `http://localhost:8000`
- Phone on the same WiFi: `http://<your-local-ip>:8000`

Find your local IP on Windows:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress,InterfaceAlias
```

### PowerShell launcher

Opens the server in a new terminal window (useful for parties — keeps the server visible):

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1
# With Discogs refresh:
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1 -RefreshServerDiscogs
```

---

## Server Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port PORT` | `8000` | TCP port to bind |
| `--refresh-discogs` | off | Re-fetch `discogs-collection.json` from Discogs API at startup |

```bash
python server.py --port 8080 --refresh-discogs
```

---

## API Reference

All endpoints are under the same HTTP server that serves static files. JSON body required for POST/PATCH unless noted.

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/users?name=<name>` | None | Look up a user profile by name |
| `GET` | `/api/users/me` | Cookie | Return the currently logged-in user |
| `GET` | `/api/users/reviews?name=<name>` | None | All reviews by a user, newest first |
| `GET` | `/api/users/active` | None | List of users with an active session (seen within 90 seconds) |
| `GET` | `/api/admin/users` | Admin cookie | Full user list (admin only) |
| `POST` | `/api/users/register` | None | Create account. Body: `{ name, password, photoDataUrl? }` |
| `POST` | `/api/users/login` | None | Log in. Body: `{ name, password }`. Sets session cookie. |
| `POST` | `/api/users/logout` | Cookie | Clear session cookie |
| `POST` | `/api/users/photo` | None | Update profile photo. Body: `{ name, photoDataUrl }` |
| `POST` | `/api/users/profile` | None | Update bio/links/top albums. Body: `{ name, description?, instagramUsername?, spotifyUrl?, topAlbums? }` |

**Profile field limits** (enforced by server, returns 400 if exceeded):

| Field | Limit |
|-------|-------|
| `description` | 150 characters |
| `instagramUsername` | 40 characters (leading `@` stripped automatically) |
| `spotifyUrl` | 200 characters, must start with `https://open.spotify.com/user/` |
| `topAlbums[].title` | 150 characters |
| `topAlbums[].artist` | 120 characters |

### Reviews

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/reviews?songKey=<key>&partyId=<id>` | None | Reviews for a song key, optionally filtered by party |
| `POST` | `/api/reviews` | None | Submit or update a review. Body: `{ songKey, name, rating, text?, partyId?, photoDataUrl? }` |
| `POST` | `/api/reviews/like` | None | Toggle like on a review. Body: `{ songKey, reviewerName, likerName, likerPhotoDataUrl? }` |

**Song key formats:**
- Song review: `"Album Title::Song Title"`
- Album review: `"album::Artist Name::Album Title"`

### Now Playing (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/now-playing` | `actorName` must be admin | Set current album/song. Body: `{ actorName, albumTitle, albumArtist, songTitle?, coverUrl, reviewScope? }` |
| `POST` | `/api/now-playing/clear` | `actorName` must be admin | Stop current playback. Body: `{ actorName }` |

### Party Management (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/listening-party/finish` | `actorName` must be admin | Finalize party, write record. Body: `{ actorName }` |
| `POST` | `/api/listening-party/picture` | `actorName` must be admin | Attach photo to active party. Body: `{ actorName, pictureDataUrl }` |
| `GET` | `/api/party-records` | Admin cookie | All past party records |
| `GET` | `/api/my-parties` | Cookie | Parties the current user attended |

### Live Albums (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/live-albums` | None | Albums added ad-hoc during the party |
| `POST` | `/api/live-albums` | Admin cookie | Add an album. Body: `{ id, title, artist, coverUrl?, spotifyUrl? }` |
| `PATCH` | `/api/live-albums` | Admin cookie | Update track list. Body: `{ id, tracks[] }` |

### Fun Facts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/fun-facts?album=<name>&artist=<name>` | None | Up to 15 fun facts. Fetches inline on cache miss. |

---

## Authentication & Sessions

- **Registration** creates an entry in `users-db.json` and `user-credentials.local.json`, and immediately logs the user in by issuing session cookies.
- **Login** validates the plaintext password and issues a new `sessionToken`.
- **Session cookies:**
  - `listening_party_session` — the session token (HttpOnly, SameSite=Lax, 10-year Max-Age).
  - `listening_party_user` — the URL-encoded username (not HttpOnly, readable by JS).
- **Session restoration:** If the session cookie is missing but the user cookie is present, `/api/users/me` re-issues a session token automatically (soft auto-login).
- **Active user window:** A user is considered "active" if their `sessionLastSeenAt` timestamp is within **90 seconds** of the current time. The timestamp is updated on every request that carries a valid session cookie.
- **Admin account:** Username key is `iñaki`, display name `Iñaki`, account name `administrador`. The default password is hardcoded in `server.py` (`ADMIN_DEFAULT_PASSWORD`). The admin account is always recreated by `reconcile_auth_stores()` at startup.

---

## Admin Controls

The `administrador` account has exclusive access to:

1. **Set now playing** — choose an album (scope = `"album"`) or a specific song (scope = `"song"`). This creates or resumes a party session. The first call to set now-playing on a fresh session:
   - Creates a `_current_session` in memory with a timestamp ID.
   - Seeds `stickyAttendeeKeys` from all currently active sessions.
   - Increments `listeningPartiesAttended` for all seeded attendees.
   - Increments `timesPlayed` on the album in `discogs-collection.json`.
2. **Clear now playing** — removes `now-playing.json`.
3. **Finish party** — finalizes `_current_session`, writes a record to `party-records.json`, clears now-playing.
4. **Add / update live albums** — albums not in the Discogs collection can be added for the duration of a party.
5. **Attach party picture** — a photo URL stored on the party record.

For now-playing and party lifecycle endpoints, authorization is checked via `actorName` in the **request body** (not the session cookie). The server looks up the user by name and verifies `accountName == "administrador"`.

For live album management and party records viewing, authorization uses the **session cookie**.

---

## Discogs Integration

`discogs_scraper.py` fetches and caches the vinyl collection.

### `update_collection_cache()`

- Fetches all pages from `https://api.discogs.com/users/InakiOG/collection/folders/0/releases`.
- For each release, calls `fetch_release_details()` to get the track list.
- Preserves existing `tracks`, `timesPlayed`, and `year` from the cache for releases that haven't changed.
- Skips writing the file if the content fingerprint (SHA-256 of items) is unchanged.
- If a network error occurs mid-fetch, unseen pages are preserved from the existing cache (no false pruning).

### `backfill_missing_tracks()`

Runs at server startup in a **daemon thread**. For each album in the collection that has no tracks, it tries three sources in order:

1. **Discogs API** — `GET /releases/{id}`
2. **MusicBrainz** — `https://musicbrainz.org/ws/2/release/`
3. **iTunes** — `https://itunes.apple.com/search`

Results are written back to `discogs-collection.json`.

### `fetch_temporary_album_data(title, artist)`

Used by the admin to search for an album not in the collection. Queries iTunes first, falls back to Spotify scraping.

---

## Fun Facts (AI)

Fun facts are short Spanish-language trivia paragraphs about albums and individual songs, generated by AI and cached in `fun-facts-db.json`.

### Flow

1. **Background prefetch worker** (`_prefetch_worker`) — a daemon thread that starts 6 seconds after server boot. It iterates through all albums in the collection and fetches facts for any that have fewer than 15 cached facts. It waits 120 seconds between full passes.
2. **Priority queue** — when the admin sets now-playing, `_priority_album` is set. The prefetch worker always tries the priority album first.
3. **Inline fetch** — `GET /api/fun-facts` returns cached facts immediately if 15+ exist; otherwise it fetches inline before responding (blocking the request).

### AI providers

Two providers are tried in order:

| Provider | Model | Rate limit |
|----------|-------|-----------|
| Gemini | `gemini-2.0-flash-lite` | Max 12 calls/min (enforced: 5s minimum between calls) |
| Groq | `llama-3.3-70b-versatile` (or configured model) | Used if Gemini unavailable or returns empty |

The prompt asks for 15 facts per album, including facts about individual songs and music videos, written in Spanish (artist/album/song names kept in English).

API keys are loaded from `.env`:

```
GEMINI_API_KEY=your_key_here
GROQ_API_KEY=your_key_here
```

---

## Frontend

Two UIs share the same backend but are served as separate HTML files:

| File | Target | Notes |
|------|--------|-------|
| `index.html` | Phone (touch, no hover) | Detected via `(hover: hover) and (pointer: fine)` — if the device fails this check, index.html is the default |
| `desktop.html` | Mouse + keyboard | Larger layout, admin controls more accessible |

`app.js` contains the shared SPA logic loaded by `index.html`.

### Key frontend features

- **Album list** — sortable by date added, artist name, or release year; groupable by genre. Albums expand in-place to show track listing and cover art.
- **Review system** — star ratings (0.5–5.0 in 0.5 increments), optional text, photo attached from the user's profile. Reviews are shown as animated bubbles.
- **Now playing** — polls the server (via `/api/users/active` which embeds now-playing state) and renders a currently-playing card.
- **Active user bubbles** — a physics-based canvas animation showing profile photos of currently online users. Bubbles bounce off each other and the canvas edges.
- **Vinyl color detection** — `detectVinylColors(formatDescriptor)` parses Discogs format strings like `"Vinyl (Red Transparent)"` to render colored vinyl gradients.
- **Disc type detection** — `detectDiscType(formatDescriptor)` distinguishes Vinyl / CD / Cassette for visual rendering.
- **Profile management** — users can update their bio, Instagram handle, Spotify URL, top 3 albums, and profile photo inline.

---

## Testing

272 tests across four files using `pytest`. Tests use only the Python standard library plus pytest — no additional dependencies.

```bash
# Run all tests
.\ListeningParty\Scripts\python.exe -m pytest tests/ -v

# Run a specific file
.\ListeningParty\Scripts\python.exe -m pytest tests/test_utils.py -v

# Run a specific class
.\ListeningParty\Scripts\python.exe -m pytest tests/test_endpoints.py::TestRegister -v
```

### Test files

| File | Count | What it covers |
|------|-------|----------------|
| `tests/test_utils.py` | 118 | All pure utility functions in `server.py`: normalization, sanitization, session token helpers, cookie builders, review aggregation, date parsing |
| `tests/test_file_io.py` | 45 | All file I/O functions with temp directories: ensure/read/write for every store, `increment_album_times_played`, `reconcile_auth_stores`, `clear_now_playing` |
| `tests/test_discogs_scraper.py` | 57 | All pure functions in `discogs_scraper.py`: `summarize_artists/formats/genres/tracklist`, `map_release`, `build_existing_items_index` |
| `tests/test_endpoints.py` | 52 | Every HTTP endpoint against a real `ThreadingHTTPServer` on a random port with temp data files |

### Fixtures (`tests/conftest.py`)

- **`patched_server`** (function scope) — redirects all `server.*_PATH` globals to a `tmp_path` temp directory via `monkeypatch`. Use for file I/O tests.
- **`live_server`** (module scope) — starts an actual `ThreadingHTTPServer` on a random port with a seeded temp data directory. Yields `{ base_url, port, tmp }`. Use for endpoint integration tests.

---

## Maintenance Utility

`controller.py` is a standalone CLI for offline maintenance. It is **not used by the web server** and does not need to be running during a party.

```bash
# Refresh the Discogs collection cache
python controller.py --refresh-discogs

# Fill in missing track lists for all albums
python controller.py --backfill-all-tracks

# Fill in missing tracks, allowing live network calls
python controller.py --allow-online-fetch --backfill-all-tracks
```

---

## Environment Variables

Loaded from `.env` in the project root at server startup (never overwrites a real environment variable).

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | Google Gemini API key for fun facts generation |
| `GROQ_API_KEY` | No | Groq API key used as Gemini fallback |

The server starts and operates normally without these keys — fun facts will simply return empty arrays.

---

## Wiki & MCP Server

The project ships with an LLM-maintained knowledge wiki and a Docker-based MCP server that exposes wiki tools directly to Claude Code.

### Wiki

The wiki lives in `wiki/` and is a structured, interlinked collection of markdown files documenting every feature, API, data schema, and design decision in the codebase. It is written and maintained by the LLM — never by hand. You read it; Claude writes it.

```
wiki/
├── CLAUDE.md        ← Operating manual for the LLM (conventions, workflows)
├── index.md         ← Catalog of all pages
├── log.md           ← Append-only history of changes
├── raw/             ← Drop source documents here for ingestion
└── pages/           ← All wiki pages (25+ covering every feature)
```

**Key pages:** `overview`, `architecture`, `api-reference`, `party-lifecycle`, `feature-review-system`, `feature-active-users`, `feature-vinyl-disc-renderer`, and more. See `wiki/index.md` for the full catalog.

### MCP Server

The MCP server is a Docker container that gives Claude Code a set of tools to search, read, write, and maintain the wiki without leaving the conversation.

**Prerequisites:** Docker Desktop (or Docker Engine + Compose).

#### Start the server

```bash
# Build image and start in the background
docker compose up --build -d

# View logs
docker compose logs -f wiki-mcp

# Stop
docker compose down
```

The server runs at `http://localhost:8080`. Claude Code connects to it automatically when you open this project — the connection is configured in `.claude/settings.json`.

#### Available tools

| Tool | Description |
|------|-------------|
| `search_wiki` | Ranked full-text search across all wiki pages with scored excerpts |
| `list_pages` | Table of all pages with tags and last-updated date |
| `read_page` | Read any wiki page (or `index`, `log`, `CLAUDE`) by name |
| `write_page` | Create or overwrite a wiki page |
| `delete_page` | Delete a page and remove it from the index |
| `regenerate_index` | Rebuild `wiki/index.md` from page frontmatter and first sentences |
| `append_log` | Append a structured entry to `wiki/log.md` |
| `lint_wiki` | Health check: broken links, orphans, missing frontmatter, index gaps |
| `read_source_file` | Read any project source file (for researching code) |
| `read_source_file_range` | Read a specific line range from a source file |
| `list_source_files` | List project files matching a glob pattern |

#### Connecting manually (non-Claude Code clients)

Any MCP client that supports SSE transport can connect:

```json
{
  "mcpServers": {
    "wiki": {
      "transport": "sse",
      "url": "http://localhost:8080/sse"
    }
  }
}
```

#### How it works

The container mounts the project root as `/project` (read-write). All tool operations — reading pages, writing pages, regenerating the index — work directly on your local files. No sync step, no copy. Changes made by Claude through the MCP tools appear immediately on disk.

```
Claude Code
    │  SSE — localhost:8080/sse
    ▼
Docker: wiki-mcp
    │  bind mount (read/write)
    ▼
wiki/pages/*.md, wiki/index.md, wiki/log.md, server.py, app.js …
```

#### Typical workflow

1. Start the MCP server: `docker compose up -d`
2. Open the project in Claude Code — tools are available immediately.
3. Ask Claude questions about the codebase — it searches the wiki first.
4. Add a source document to `wiki/raw/` and ask Claude to ingest it.
5. After code changes, ask Claude to update the affected wiki pages.
6. Periodically run `lint_wiki` to catch broken links and orphan pages.

---

## Known Limitations & Security Notes

This app is designed for **trusted guests on a private local network**. It is not hardened for public internet exposure.

| Issue | Detail |
|-------|--------|
| Plaintext passwords | `user-credentials.local.json` stores passwords in plain text. The file is gitignored. |
| No HTTPS | All traffic is unencrypted HTTP. Do not expose to the internet. |
| No CSRF protection | POST endpoints do not validate CSRF tokens. |
| No brute-force protection | The login endpoint has no rate limiting. |
| Admin password hardcoded | `ADMIN_DEFAULT_PASSWORD` in `server.py` is hardcoded. Change it before hosting outside your home network. |
| API keys in `.env` | `GEMINI_API_KEY` and `GROQ_API_KEY` are stored in a plain `.env` file. The file is gitignored. |
| No input sanitization | Review text and descriptions are stored and served as-is. XSS is possible if content is rendered without escaping (relevant only on the local network). |
