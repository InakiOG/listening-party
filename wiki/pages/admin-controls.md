---
title: Admin Controls
tags: [backend, flow, auth]
updated: 2026-05-03
---

# Admin Controls

The `administrador` account (username: `iñaki`) has exclusive access to all party lifecycle operations.

## What the admin can do

| Action | Endpoint | Auth mechanism |
|--------|----------|---------------|
| Set now-playing (album or song) | `POST /api/now-playing` | `actorName` in body |
| Clear now-playing | `POST /api/now-playing/clear` | `actorName` in body |
| Finish party | `POST /api/listening-party/finish` | `actorName` in body |
| Attach party photo | `POST /api/listening-party/picture` | `actorName` in body |
| Add live album | `POST /api/live-albums` | Session cookie |
| Update live album tracks | `PATCH /api/live-albums` | Session cookie |
| View all party records | `GET /api/party-records` | Session cookie |
| View all users | `GET /api/admin/users` | Session cookie |

## `actorName` vs cookie auth

The party lifecycle endpoints (`now-playing`, `finish`, `picture`) use `actorName` in the request body rather than the session cookie. This design allows scripting these actions without cookie management — the admin can trigger them from a terminal, a cron job, or another device.

Live album and record-viewing endpoints use cookie auth (standard browser session).

## Setting now-playing

The most consequential admin action. On the **first** call after a server start (or after a party finishes):
- Creates `_current_session` in memory.
- Seeds `stickyAttendeeKeys` from all currently active users.
- Increments `listeningPartiesAttended` for each seeded user.

On subsequent calls:
- Updates `now-playing.json`.
- Adds the album to `albumsPlayed` if it's new.
- Increments `timesPlayed` on the album in `discogs-collection.json`.
- Sets `_priority_album` so the AI prefetch worker prioritizes this album.

See [[party-lifecycle]] for the full flow.

## Finishing a party

`POST /api/listening-party/finish` writes the party snapshot to `party-records.json`, clears now-playing, and resets `_current_session` to `None`. The next `POST /api/now-playing` will start a fresh party.

## Live albums

Albums not in the Discogs collection can be added during a party via `POST /api/live-albums`. The admin typically searches by title — `fetch_temporary_album_data()` in `discogs_scraper.py` queries iTunes for cover art and track lists. The live album list is stored in `live-albums.json` and served separately from the main collection.

## Admin account bootstrap

`ADMIN_USER_KEY`, `ADMIN_DEFAULT_NAME`, and `ADMIN_DEFAULT_PASSWORD` are hardcoded in `server.py`. `reconcile_auth_stores()` runs at every startup and ensures the admin exists in both `users-db.json` and `user-credentials.local.json`. This means the admin account can never be accidentally deleted — it's recreated on the next boot.

## Related pages

- [[auth-sessions]] — how admin identity is verified
- [[party-lifecycle]] — what the admin actions trigger
- [[api-reference]] — request/response schemas
- [[discogs-integration]] — `fetch_temporary_album_data` for live albums
