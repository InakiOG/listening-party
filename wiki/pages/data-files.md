---
title: Data Files
tags: [data, reference]
updated: 2026-05-03
---

# Data Files

All persistent state lives in eight JSON files in the project root. No database. Files are read and written by `server.py` under `REVIEWS_LOCK` or `LIVE_ALBUMS_LOCK` (except `now-playing.json` which uses neither lock — it's written atomically enough for its use case).

## File inventory

| File | Lock | Gitignored | Description |
|------|------|-----------|-------------|
| `discogs-collection.json` | `REVIEWS_LOCK` | No | Vinyl collection cache from Discogs |
| `reviews-db.json` | `REVIEWS_LOCK` | No | All user reviews |
| `users-db.json` | `REVIEWS_LOCK` | No | User profiles |
| `user-credentials.local.json` | `REVIEWS_LOCK` | **Yes** | Passwords + session tokens |
| `party-records.json` | `REVIEWS_LOCK` | No | Historical party snapshots |
| `fun-facts-db.json` | `REVIEWS_LOCK` | No | AI-generated fun facts cache |
| `live-albums.json` | `LIVE_ALBUMS_LOCK` | No | Ad-hoc albums added during a party |
| `now-playing.json` | (none) | No | Current track; deleted on clear/shutdown |

---

## `discogs-collection.json`

Built by `discogs_scraper.py`. Immutable during a party; refreshed with `--refresh-discogs`.

Top-level keys: `source`, `profile`, `updatedAt`, `totalItems`, `items[]`.

Each item:
```json
{
  "title": "Abbey Road",
  "artist": "The Beatles",
  "year": 1969,
  "discogsId": 12345,
  "instanceId": 67890,
  "releaseUrl": "...",
  "artistUrl": "...",
  "imageUrl": "...",
  "imageAlt": "...",
  "rawText": "Vinyl (Red Transparent); Rock, Classic Rock",
  "tracks": ["Come Together", "Something"],
  "timesPlayed": 3,
  "dateAdded": "2023-06-01T00:00:00-07:00",
  "rating": 5,
  "sourcePage": 1
}
```

`rawText` is the original Discogs format string, used by `detectVinylColors` and `detectDiscType` in the frontend.

---

## `reviews-db.json`

Keyed by **song key**. Two formats:

| Key format | Meaning |
|-----------|---------|
| `"Album Title::Song Title"` | Song-level review |
| `"album::Artist Name::Album Title"` | Album-level review |

Value is an array of review objects. Multiple users can review the same key. One user can only have one review per `partyId` — submitting again upserts (replaces).

Review object:
```json
{
  "name": "Alice",
  "rating": 4.5,
  "text": "Great track.",
  "photoDataUrl": "data:image/jpeg;base64,...",
  "createdAt": "2024-01-15T20:30:00+00:00",
  "partyId": "2024-01-15T20:00:00+00:00",
  "likes": [{ "name": "Bob", "photoDataUrl": "..." }]
}
```

---

## `users-db.json`

Keyed by **normalized username** (lowercase). The admin key is `"iñaki"`.

```json
{
  "name": "Alice",
  "photoDataUrl": "...",
  "description": "Bio (max 150 chars)",
  "instagramUsername": "handle",
  "spotifyUrl": "https://open.spotify.com/user/...",
  "topAlbums": [
    { "title": "...", "artist": "...", "coverUrl": "..." },
    { "title": "", "artist": "", "coverUrl": "" },
    { "title": "", "artist": "", "coverUrl": "" }
  ],
  "listeningPartiesAttended": 4,
  "createdAt": "2024-01-10T00:00:00+00:00",
  "accountName": "usuario"
}
```

`accountName` is `"administrador"` only for the admin. Everyone else is `"usuario"`.

---

## `user-credentials.local.json`

**Gitignored. Plaintext passwords.** Contains passwords and session tokens. Keyed by normalized username.

```json
{
  "alice": {
    "name": "Alice",
    "password": "hunter2",
    "createdAt": "...",
    "sessionToken": "abc123...",
    "sessionCreatedAt": "...",
    "sessionLastSeenAt": "..."
  }
}
```

`sessionLastSeenAt` is updated on every authenticated request and drives the active user window (90 seconds).

---

## `party-records.json`

Snapshot of every listening party. Structure: `{ "parties": [...] }`.

Each party record:
```json
{
  "id": "2024-01-15T20:00:00+00:00",
  "date": "2024-01-15T20:00:00+00:00",
  "startedAt": "...",
  "endedAt": "...",
  "finalizedAt": "...",
  "savedAt": "...",
  "attendees": ["Alice", "Bob"],
  "listeners": ["Alice", "Bob", "Charlie"],
  "albumsPlayed": [{ "title": "...", "artist": "...", "coverUrl": "..." }],
  "reviews": [...],
  "partyPicture": "data:image/jpeg;base64,..."
}
```

- `attendees`: users who submitted at least one review.
- `listeners`: all users with an active session when the party started (sticky — don't leave if they disconnect).

---

## `now-playing.json`

Written by `POST /api/now-playing`, deleted by `POST /api/now-playing/clear` and on server shutdown.

```json
{
  "albumTitle": "Abbey Road",
  "albumArtist": "The Beatles",
  "songTitle": "Come Together",
  "reviewScope": "song",
  "coverUrl": "...",
  "adminThanks": "",
  "updatedAt": "...",
  "updatedBy": "Iñaki",
  "partyId": "2024-01-15T20:00:00+00:00"
}
```

`reviewScope`: `"song"` shows song-level rating UI; `"album"` hides it.

---

## `fun-facts-db.json`

Keyed by `"album title lowercase::artist name lowercase"`. Value: array of up to 15 Spanish-language fact strings.

---

## `live-albums.json`

Albums added ad-hoc during a party. Structure: `{ "albums": [...] }`. Each album: `{ id, title, artist, coverUrl?, spotifyUrl?, tracks[] }`. Cleared between parties by the admin.

---

## Related pages

- [[discogs-integration]] — how `discogs-collection.json` is built
- [[fun-facts]] — how `fun-facts-db.json` is populated
- [[auth-sessions]] — how `user-credentials.local.json` is used
- [[party-lifecycle]] — how `party-records.json` is written
- [[thread-safety]] — which lock guards which file
