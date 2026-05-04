---
title: server.py
tags: [backend, architecture]
updated: 2026-05-03
---

# server.py

The main HTTP server. A single file containing all routes, business logic, file I/O helpers, and background workers.

## Key globals

| Symbol | Type | Purpose |
|--------|------|---------|
| `ROOT` | `Path` | Project root (absolute path of `server.py`'s directory) |
| `SERVER_BOOT_ID` | `str` | Unique ID per process start; sent as `X-Server-Boot-Id` header; clients reload on ID change |
| `REVIEWS_LOCK` | `Lock` | Guards all reads/writes to `reviews-db.json`, `users-db.json`, `user-credentials.local.json`, `party-records.json`, `fun-facts-db.json`, `discogs-collection.json` |
| `LIVE_ALBUMS_LOCK` | `Lock` | Guards `live-albums.json` |
| `_current_session` | `dict \| None` | In-memory party session state (not persisted until finish) |
| `_fun_facts_db` | `dict` | In-memory mirror of `fun-facts-db.json`; written through on update |
| `_priority_album` | `tuple \| None` | `(title, artist)` — the album to prefetch next; set when admin sets now-playing |
| `_gemini_last_call` | `float` | Epoch time of last Gemini API call; enforces 5s minimum interval |

## Path constants

All file paths are `ROOT / "filename.json"` constants: `REVIEWS_DB_PATH`, `USERS_DB_PATH`, `CREDENTIALS_DB_PATH`, `NOW_PLAYING_PATH`, `FUN_FACTS_DB_PATH`, `PARTY_RECORDS_PATH`, `LIVE_ALBUMS_PATH`, `COLLECTION_PATH`. Tests monkeypatch these to temp dirs.

## Request handler

`ListeningPartyHandler` subclasses `SimpleHTTPRequestHandler`. The `do_GET` and `do_POST`/`do_PATCH` methods parse the path and dispatch to named handlers (`_handle_*`). Unrecognized `/api/*` paths return 404; everything else falls through to the parent's file-serving logic.

Every response sets `X-Server-Boot-Id` so clients can detect server restarts.

## Auth helpers

| Function | What it does |
|----------|-------------|
| `get_session_user(handler)` | Reads `listening_party_session` cookie, looks up token in credentials store, returns username or `None` |
| `require_admin_actor(body)` | Checks `body["actorName"]` resolves to a user with `accountName == "administrador"` |
| `is_admin_cookie(handler)` | Cookie-based admin check (used for live album and party record endpoints) |

## Read cache

Short-TTL in-memory cache (`_READ_CACHE`) keyed by strings like `"users"`, `"reviews"`. TTLs are 1.5–3 seconds. Used on high-frequency GET endpoints that are hit every 2 seconds by all connected clients. The cache stores the already-serialized JSON string, so serialization only happens once per TTL window.

## Background workers

### `_prefetch_worker`

Starts 6 seconds after boot. Loops forever:
1. Check `_priority_album` — if set, fetch its facts first.
2. Iterate all albums in `discogs-collection.json`.
3. For any album with < 15 cached facts, call `fetch_fun_facts(title, artist)`.
4. Sleep 120 seconds between full passes.

### `backfill_missing_tracks` (imported from `discogs_scraper`)

Runs at startup. For each album with no tracks, tries Discogs → MusicBrainz → iTunes in sequence. Writes results back to `discogs-collection.json`.

## Error handling conventions

- Client errors return JSON `{ "error": "message" }` with appropriate 4xx status.
- Missing required body fields return 400.
- Auth failures return 401 or 403.
- Server errors are logged to stderr and return 500 with a generic message.

## Related pages

- [[architecture]] — where server.py fits in the system
- [[api-reference]] — all endpoints
- [[thread-safety]] — locking strategy
- [[auth-sessions]] — session management
- [[fun-facts]] — AI fact generation
- [[discogs-integration]] — collection sync
