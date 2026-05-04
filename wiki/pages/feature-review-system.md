---
title: Feature — Review System
tags: [frontend, backend, feature]
updated: 2026-05-03
---

# Feature — Review System

Guests can leave star ratings and optional text reviews for albums and individual songs. Reviews are scoped to a party session, can receive likes from other guests, and are visible in real time.

## Review scopes

Two types of review, distinguished by the **song key** format:

| Scope | Key format | When used |
|-------|-----------|-----------|
| Song review | `"Album Title::Song Title"` | Admin set now-playing with `reviewScope: "song"` |
| Album review | `"album::Artist Name::Album Title"` | Admin set now-playing with `reviewScope: "album"` |

The now-playing card shows a star rating widget and text input. Guests rate whatever the admin has set as current.

## Star rating widget

Half-star increments from 0.5 to 5.0. Stored as a float in `reviews-db.json`. The UI displays filled/half/empty stars. `selectedRating` in module scope tracks the current value before submission.

## Submission flow

1. Guest sets a star rating and optionally types a review text.
2. Client calls `POST /api/reviews { songKey, name, rating, text?, partyId?, photoDataUrl? }`.
3. Server:
   - Reads `reviews-db.json`.
   - Checks if the user already has a review for this `songKey` + `partyId`. If yes, **upserts** (replaces) their existing entry — one review per song per party per user.
   - Appends or replaces the review.
   - Writes back to `reviews-db.json`.
   - Adds the reviewer to `_current_session["stickyAttendeeKeys"]` if they're not already there.
   - Invalidates the read cache for that song key.

The `photoDataUrl` field carries the reviewer's profile photo at time of submission, stored inline in the review so it displays even if the user later changes their photo.

## Upsert logic

```
for each review in reviews[songKey]:
    if review.partyId == body.partyId and review.name (normalized) == body.name:
        replace this review
        return
append new review
```

This lets guests revise their rating during the party without accumulating duplicate entries.

## Review polling

`reviewPollTimerId` polls for reviews of the current now-playing item. Polling uses `GET /api/reviews?songKey=...&partyId=...`. A server-side read cache (1.5s TTL) absorbs the polling load.

Reviews are fetched in two modes:
- **By song key**: `?songKey=Album::Song&partyId=xxx` — specific reviews for the now-playing item.
- **By album title**: `?albumTitle=Abbey Road` — all reviews (album-level + all songs) for an album page. Returns `{ albumTitle, reviewsByKey }` instead of a flat list.

## Review display

Reviews render as animated bubble cards in the now-playing section. Each card shows:
- Reviewer name + profile photo
- Star rating
- Review text (if any)
- Like button + liker avatars
- Timestamp (formatted relative or absolute)

## Likes

`POST /api/reviews/like { songKey, reviewerName, likerName, likerPhotoDataUrl? }`:
- Finds the review by `reviewerName` in the song key's review list.
- Toggles: if `likerName` is already in `review.likes`, removes them; otherwise appends `{ name, photoDataUrl }`.
- Returns the updated review list.

The `photoDataUrl` for the liker is stored in the like entry so it renders even if the liker changes their photo.

## User's own review history

`GET /api/users/reviews?name=<name>` returns all reviews by a user across all time, sorted newest first. Served from the "My reviews" panel in the profile view. Each entry includes `scope`, `albumTitle`, `songTitle`, `rating`, `text`, `createdAt`, `reviewKey`.

## Review data in party records

When a party snapshot is saved (on each now-playing change and on finish), `collect_reviews_for_albums` scans `reviews-db.json` for all reviews matching the party's `albumsPlayed` list, filtered by `partyId`. These are embedded in the party record so the history is self-contained.

## Normalization and sanitization

- Reviewer names are normalized to lowercase for upsert matching, but the display name is preserved as submitted.
- No HTML encoding happens on the server — raw text is stored and served. XSS is only a concern on the local network (intentional trade-off).
- Rating is coerced to float; invalid values default to 0.

## Related pages

- [[feature-now-playing]] — now-playing drives the review scope
- [[data-files]] — `reviews-db.json` schema, song key formats
- [[api-reference]] — review endpoints
- [[party-lifecycle]] — how reviews attach to a party
- [[feature-party-records]] — how reviews are stored in the party snapshot
