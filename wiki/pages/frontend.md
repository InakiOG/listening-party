---
title: Frontend
tags: [frontend, architecture]
updated: 2026-05-03
---

# Frontend

Two separate HTML files served by the same backend, sharing `app.js` for the phone view.

## Files

| File | Target | Notes |
|------|--------|-------|
| `index.html` | Phone (touch, portrait) | Default; imports `app.js` |
| `desktop.html` | Mouse + keyboard | Larger layout; admin controls more visible; own inline script |
| `app.js` | Shared SPA logic | Loaded by `index.html` only |
| `disc.js` | Vinyl disc renderer | Imported by both HTML files |

Device detection: a CSS media query `(hover: hover) and (pointer: fine)` in `index.html` redirects pointer devices to `desktop.html` with a `<meta http-equiv="refresh">`.

## Global state (`app.js`)

```js
appState         // albums[], expandedAlbumId, sortBy, sortDirection, groupBy
sessionState     // currentUser
addAlbumModalState  // cover options for the "add live album" modal
bubbleEntities   // Map — physics state for active-user bubbles
```

## Polling architecture

The app achieves real-time feel through **four independent polling loops**, each with in-flight guards to prevent overlapping requests:

| Loop | Interval | Endpoint | What it drives |
|------|----------|----------|---------------|
| `activeUsersPollTimerId` | 2s | `GET /api/users/active` | Active user bubbles, now-playing state |
| `liveAlbumsPollTimerId` | varies | `GET /api/live-albums` | Live album list |
| `reviewPollTimerId` | varies | `GET /api/reviews` | Review list for current now-playing |
| `nowPlayingPollTimerId` | varies | embedded in active users | Now-playing card |

`/api/users/active` embeds the current now-playing state in its response, so one request covers both active users and what's playing.

## Server restart detection

`window.fetch` is monkey-patched to read `X-Server-Boot-Id` from every response header. If the ID changes (server restarted), the page reloads automatically.

## Key UI components

### Album list

- Sortable by: date added (desc/asc), artist name, release year.
- Groupable by genre.
- Albums expand in-place to show cover art, track listing, and review UI.

### Review bubbles

Reviews are rendered as animated card bubbles. Star ratings use a 0.5-increment system (0.5–5.0).

**Song key** passed to the review submission:
- Song review: `"Album Title::Song Title"`
- Album review: `"album::Artist Name::Album Title"`

### Active user bubbles (physics canvas)

Profile photos of currently online users are rendered as circles on a `<canvas>`. A physics loop (`physicsRafId`) runs `requestAnimationFrame`-driven simulation: circles have velocity, bounce off each other and canvas edges. State is stored in `bubbleEntities` (a `Map` of entity objects with position, velocity, radius).

### Vinyl disc renderer (`disc.js`)

`detectVinylColors(formatDescriptor)` parses Discogs format strings like `"Vinyl (Red Transparent)"` to extract color names, then renders CSS gradients simulating vinyl. `detectDiscType(formatDescriptor)` distinguishes Vinyl / CD / Cassette for different visual treatments.

### Now playing card

Rendered when `currentNowPlaying` is non-null. Shows cover art, album/song title, and a review form. `reviewScope` from the server determines whether the rating is for the song or the album.

### Profile management

Inline editing: bio (150 chars), Instagram handle (40 chars, `@` stripped), Spotify URL, top 3 albums, profile photo. All changes go to `POST /api/users/profile` or `POST /api/users/photo`.

## Admin-only UI

Shown only when `isAdminUser()` returns true (checks `sessionState.currentUser.accountName === "administrador"`):
- Set now-playing (album or song scope)
- Clear now-playing
- Finish party
- Add live album (searches iTunes for cover)
- Attach party photo

## Related pages

- [[architecture]] — how frontend fits in the system
- [[api-reference]] — all endpoints the frontend calls
- [[party-lifecycle]] — what the admin controls drive
