---
title: Feature — Party Records & History
tags: [frontend, backend, feature]
updated: 2026-05-03
---

# Feature — Party Records & History

Every listening party is snapshotted into `party-records.json` as it happens. Guests can see the parties they attended; the admin can see all records.

## Live snapshots (not just on finish)

The party record is not only written when the admin explicitly finishes the party. It is **upserted on every now-playing change** via `upsert_party_record_snapshot()`. This means if the server crashes mid-party, the record is mostly intact — only the very last now-playing event might be missing.

`upsert_party_record_snapshot(session, users_store, credentials_store, reviews_store, finalized=False)`:
1. Derives `partyId` from `session["id"]`.
2. Scans `reviews-db.json` for all reviews matching this party's `albumsPlayed` list and `partyId`.
3. Computes `attendees` (users who submitted ≥ 1 review) from the collected reviews.
4. Computes `listeners` from `stickyAttendeeKeys` (users who were active when the party started).
5. Looks up the existing record in `party-records.json` (by ID) to preserve `finalizedAt` and `endedAt` if already set.
6. Writes/replaces the record.

## Finalization

When `POST /api/listening-party/finish` is called with `finalized=True`:
- `endedAt` and `finalizedAt` are set to the current timestamp.
- `now-playing.json` is deleted.
- `_current_session` is set to `None`.

A shutdown with an active session also triggers finalization (`finalize_active_session_on_shutdown()`), so a party is recorded even if the server is killed ungracefully.

## Record structure

```json
{
  "id": "2024-01-15T20:00:00+00:00",
  "date": "2024-01-15T20:00:00+00:00",
  "startedAt": "2024-01-15T20:00:00+00:00",
  "endedAt": "2024-01-15T23:00:00+00:00",
  "finalizedAt": "2024-01-15T23:00:00+00:00",
  "savedAt": "2024-01-15T23:00:00+00:00",
  "attendees": ["Alice", "Bob"],
  "listeners": ["Alice", "Bob", "Charlie"],
  "albumsPlayed": [{ "title": "...", "artist": "...", "coverUrl": "..." }],
  "reviews": [...],
  "partyPicture": "data:image/jpeg;base64,..."
}
```

`attendees` vs `listeners`:
- `listeners` = everyone who was active (had an open session) when the party started (sticky, never shrinks).
- `attendees` = subset of listeners (or latecomers) who submitted at least one review.

## Party picture

Admin can attach a photo to the active party via `POST /api/listening-party/picture { pictureDataUrl }`. The base64 image is stored in `_current_session["partyPicture"]` and immediately upserted to the party record. One photo per party (overwritten if called again).

In the frontend, the party picture shows as a tappable thumbnail in the party card. Tapping opens a fullscreen lightbox (`party-picture-lightbox`). The lightbox closes on click-outside, close button, or Escape key.

## Viewing records

### Admin: Party Records view

Accessible from the profile menu (admin only). `openPartyRecordsView()` fetches `GET /api/party-records` (admin cookie required) and renders all parties sorted by date descending.

Each party card shows:
- Date (formatted as full locale string: weekday, day, month, year, time)
- Attendees list
- Listeners list
- Party photo (if any)
- Albums grid with cover art
- Reviews list: reviewer · target (album or song) · rating, review text, liker avatars

### All users: My Parties view

Accessible from the profile menu. `openMyPartiesView()` fetches `GET /api/my-parties` (session cookie required). Returns parties where the current user appears in `attendees` or `listeners`. Admins see all parties.

Format is the same as the admin view but filtered to the user's own history. Includes `buildPartyAlbumsMarkup` which shows per-album average scores from reviews.

### Party brief popup

When the now-playing card disappears (party just ended), after 800ms the client fetches `GET /api/my-parties` and checks if the latest party ID is new (hasn't been shown yet via `partyBriefShownId`). If so, shows `party-brief-popup` — a compact summary with date, attendees, listeners, and albums played. This gives every guest an instant recap.

## Date formatting

`formatPartyDate(dateStr)`:
- If the string contains `T` (ISO datetime): uses `toLocaleString` with weekday, date, and time.
- If date-only: uses `toLocaleDateString` with weekday, date (no time).
- Falls back to the raw string if `Date` parsing fails.

## Related pages

- [[party-lifecycle]] — how records are created during a party
- [[admin-controls]] — admin-only party management endpoints
- [[data-files]] — `party-records.json` schema
- [[api-reference]] — party record endpoints
- [[feature-now-playing]] — the trigger for upsert snapshots
