---
title: Feature — Now Playing
tags: [frontend, backend, feature, flow]
updated: 2026-05-03
---

# Feature — Now Playing

The now-playing system is the core of a listening party session. It lets the admin announce what's currently being heard, drives the review flow for guests, and is the trigger that starts the party session.

## How it reaches clients

Now-playing state is **embedded in the active users response** rather than having its own poll. When `GET /api/users/active` is called (every 2 seconds by every client), the server includes now-playing data alongside the user list. The client detects changes by comparing a JSON signature (`lastNowPlayingSignature`) and re-renders only when something changed.

There is no `GET /api/now-playing` endpoint — the active-users endpoint is the channel for this data.

## Setting now-playing (admin)

Admin clicks a track button in an expanded album card, or the "Escuchar album" button. This calls:
- `startSongListening(album, songTitle)` → `apiSetNowPlaying({ reviewScope: "song", songTitle, ... })`
- `startAlbumListening(album)` → `apiSetNowPlaying({ reviewScope: "album", songTitle: "", ... })`

Both call `POST /api/now-playing`. The server:
1. Validates `actorName` is the admin.
2. Creates `_current_session` if it doesn't exist (first call starts the party).
3. Writes `now-playing.json` with the full payload.
4. Sets `_priority_album` so fun facts prefetch for this album immediately.
5. Increments `timesPlayed` on the album.
6. Appends the album to `_current_session["albumsPlayed"]` if it's new.
7. Calls `upsert_party_record_snapshot` to write a live snapshot to `party-records.json`.

`adminThanks` is also read from the album's `admin_thanks` field in the collection — a personalized message the host can pre-set for an album.

## `now-playing.json` structure

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

`reviewScope`: `"song"` → guests rate the specific song; `"album"` → guests rate the album as a whole, and the song rating UI is hidden.

## Now-playing card (client)

`renderNowPlaying(nowPlaying)` builds the card:
- Cover art
- Spinning vinyl disc (via `applyNowPlayingDiscVisual`)
- Album/song title
- Star rating UI (hidden if `reviewScope === "album"`)
- Review text input
- Admin controls (only shown to admin): "Clear", "Finish party"

The cover image click triggers `animateCoverToNowPlaying` — an arc animation of the cover flying to/from the album grid.

## Disc spin speed

The now-playing disc spins at different speeds depending on the review scope:
- `"song"` scope: primary `1.9s`, secondary `2.7s` — faster, more energetic
- `"album"` scope: primary `3.8s`, secondary `5.3s` — slower, contemplative

This is set as CSS custom properties `--np-spin-primary` and `--np-spin-secondary` on the section element.

## Clearing now-playing

Admin calls `POST /api/now-playing/clear { actorName }`. Server deletes `now-playing.json`. The party session (`_current_session`) remains open — a new `POST /api/now-playing` resumes it. When clients poll next and see no now-playing in the response, they hide the now-playing card.

When the server detects that now-playing went from active to cleared (`currentNowPlaying` was set, then the response has no now-playing), `handlePartyJustEnded()` runs — a 800ms delayed check that fetches the user's party list and shows a brief popup summary if a new party record appeared.

## Party brief popup

After a party ends and a guest's `apiGetMyParties` returns a new party they haven't seen:
- A popup (`party-brief-popup`) shows the party date, attendees, listeners, and album list.
- `partyBriefShownId` tracks the last shown party ID to avoid showing the same popup twice.

## Validation rules

`POST /api/now-playing` requires:
- `actorName` — must resolve to the admin
- `albumTitle` — required
- `coverUrl` — required
- `songTitle` — required only when `reviewScope === "song"`

## Related pages

- [[party-lifecycle]] — full sequence from first now-playing to finish
- [[feature-review-system]] — what the now-playing state drives for reviews
- [[feature-vinyl-disc-renderer]] — disc spin animation in now-playing
- [[admin-controls]] — how the admin triggers now-playing
- [[data-files]] — `now-playing.json` schema
