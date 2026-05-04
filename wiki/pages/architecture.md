---
title: Architecture
tags: [architecture, concept]
updated: 2026-05-03
---

# Architecture

## System diagram

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

## Three layers

### 1. Clients

Two HTML files share the same backend:

| File | Target device | Detection method |
|------|--------------|-----------------|
| `index.html` | Phone (touch) | Default; media query `(hover: hover) and (pointer: fine)` redirects to desktop |
| `desktop.html` | Mouse + keyboard | Larger layout, admin controls more visible |

`app.js` is the shared SPA logic loaded by `index.html`. `desktop.html` has its own inline script but shares CSS conventions.

Clients communicate with the server via REST JSON over plain HTTP. There is no WebSocket — real-time updates are achieved by **polling** (2-second intervals for active users and now-playing state).

### 2. Server (`server.py`)

A single `ListeningPartyHandler` class (subclassing `SimpleHTTPRequestHandler`) handles all requests:
- Requests to `/api/*` are dispatched to handler methods.
- All other requests fall through to `SimpleHTTPRequestHandler`'s file-serving logic (serves static files from the project root).

Two background daemon threads start on `run_server()`:
- **`_prefetch_worker`** — fetches AI fun facts for all albums with < 15 cached facts.
- **`backfill_missing_tracks`** (from `discogs_scraper`) — fills in track lists for albums missing them.

### 3. JSON storage

Eight flat files in the project root. No schema enforcement beyond what the server reads and writes. See [[data-files]] for each file's structure.

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| No external dependencies | Portability; one-command startup |
| Flat JSON files | No setup; readable/editable by hand; fine for party-scale data |
| Two locks for thread safety | `REVIEWS_LOCK` covers most writes; `LIVE_ALBUMS_LOCK` is separate because live albums are edited more independently |
| `actorName` body auth for party endpoints | Admin actions (set now-playing, finish party) check the body, not the cookie, so they can be triggered from scripts |
| `now-playing.json` deleted on shutdown | Prevents stale state on restart |
| Short-TTL read cache | Popular read endpoints (users, reviews) cache for 1.5–3 seconds to reduce file I/O under concurrent polling |

## Startup sequence

1. Load `.env` into environment.
2. `reconcile_auth_stores()` — ensure admin account exists in both `users-db.json` and `user-credentials.local.json`.
3. Clear `now-playing.json`.
4. Optionally refresh Discogs collection (`--refresh-discogs` flag).
5. Start `backfill_missing_tracks` daemon thread.
6. Start `ThreadingHTTPServer` on configured port.
7. After 6 seconds, start `_prefetch_worker` daemon thread.

## Related pages

- [[server]] — server.py internals
- [[frontend]] — client-side code
- [[data-files]] — JSON storage schemas
- [[thread-safety]] — locking strategy in detail
