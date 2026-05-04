---
title: Party Lifecycle
tags: [flow, backend, concept]
updated: 2026-05-03
---

# Party Lifecycle

An end-to-end walkthrough of what happens during a listening party, from boot to finish.

## Phase 1: Server startup

1. `reconcile_auth_stores()` — ensures admin account exists in both JSON stores.
2. `now-playing.json` deleted — prevents stale state from a previous session.
3. `backfill_missing_tracks` daemon thread starts.
4. Server begins accepting requests.
5. After 6 seconds, `_prefetch_worker` starts fetching AI fun facts.

At this point `_current_session` is `None` — no party is active.

## Phase 2: First now-playing (party begins)

Admin calls `POST /api/now-playing { actorName, albumTitle, albumArtist, songTitle?, coverUrl, reviewScope? }`.

Because `_current_session` is `None`, the server:
1. Reads all currently active users (`sessionLastSeenAt` within 90s).
2. Creates `_current_session`:
   ```python
   {
     "id": "<ISO timestamp>",          # becomes the partyId
     "startedAt": "<ISO timestamp>",
     "stickyAttendeeKeys": {...},       # normalized usernames of active users
     "albumsPlayed": [],
     "reviews": []
   }
   ```
3. Increments `listeningPartiesAttended` on all sticky attendees in `users-db.json`.
4. Increments `timesPlayed` on the album in `discogs-collection.json`.
5. Writes `now-playing.json`.
6. Sets `_priority_album` so the prefetch worker loads facts for this album first.

**The party ID is the ISO timestamp of the first now-playing call.** All reviews submitted during the party carry this `partyId`.

## Phase 3: Active party

### Now-playing changes

Each subsequent `POST /api/now-playing`:
- Updates `now-playing.json`.
- Adds the album to `_current_session["albumsPlayed"]` if not already there.
- Increments `timesPlayed` on the album.
- Sets `_priority_album`.

### Guests review

Guests call `POST /api/reviews { songKey, name, rating, text?, partyId }`. The server:
1. Appends or upserts the review in `reviews-db.json`.
2. If the reviewer isn't in `stickyAttendeeKeys`, adds them (they joined mid-party).

### Clear now-playing

`POST /api/now-playing/clear` deletes `now-playing.json`. The party session stays open in memory — a new `POST /api/now-playing` resumes it without creating a new party.

## Phase 4: Finish party

Admin calls `POST /api/listening-party/finish { actorName }`.

1. Reads all reviews for this party from `reviews-db.json` (filtered by `partyId`).
2. Builds the final party record:
   - `attendees` — users in `stickyAttendeeKeys` who submitted ≥ 1 review.
   - `listeners` — all users in `stickyAttendeeKeys`.
   - `albumsPlayed` — from `_current_session["albumsPlayed"]`.
   - `endedAt`, `finalizedAt`, `savedAt` — current timestamp.
3. Appends to `party-records.json`.
4. Clears `now-playing.json`.
5. Sets `_current_session = None`.

## Data flow diagram

```
Startup
  └─► _current_session = None

POST /api/now-playing  (first call)
  └─► _current_session created
      stickyAttendeeKeys seeded from active users
      listeningPartiesAttended incremented for each
      timesPlayed incremented on album
      now-playing.json written

POST /api/reviews
  └─► reviews-db.json updated (partyId attached)
      reviewer added to stickyAttendeeKeys if new

POST /api/now-playing  (subsequent)
  └─► albumsPlayed updated
      timesPlayed incremented
      now-playing.json updated

POST /api/listening-party/finish
  └─► party-records.json appended
      now-playing.json deleted
      _current_session = None
```

## Related pages

- [[admin-controls]] — what the admin can do
- [[auth-sessions]] — how active users are determined
- [[data-files]] — `party-records.json`, `now-playing.json` schemas
- [[api-reference]] — endpoint details
