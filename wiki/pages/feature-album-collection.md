---
title: Feature — Album Collection Browser
tags: [frontend, discogs, feature]
updated: 2026-05-03
---

# Feature — Album Collection Browser

The album collection is the main view of the app. It displays every vinyl record in the host's Discogs collection as a grid of cover art, with in-place expansion for details and track listing.

## Data source

Albums come from two sources, merged on the client:

1. **Discogs collection** (`discogs-collection.json`) — the primary library, fetched from Discogs and cached locally by `discogs_scraper.py`. Served by `GET /api/collection` (falls through to file serving from `SimpleHTTPRequestHandler`).
2. **Live albums** (`live-albums.json`) — albums added by the admin during a party that aren't in the collection. Fetched by a polling loop (`liveAlbumsPollTimerId`) and merged into `appState.albums` with `isLive: true`.

## Album object (client-side)

The server returns raw Discogs items; the frontend augments them:

| Field | Source | Notes |
|-------|--------|-------|
| `title`, `artist`, `year` | Discogs | |
| `tracks` | Discogs / backfill | Filled by `backfill_missing_tracks` if empty |
| `rawText` | Discogs | Format descriptor, e.g. `"Vinyl (Red Transparent); Rock"` |
| `timesPlayed` | Discogs cache | Incremented each time admin sets now-playing |
| `coverUrl` | Discogs | Album art URL |
| `vinylColor`, `vinylColorSecondary` | Derived client-side | From `detectVinylColors(rawText)` |
| `discType` | Derived | From `detectDiscType(rawText)`: `"vinyl"`, `"cd"`, or `"both"` |
| `primaryGenre` | Derived | From `extractPrimaryGenre(rawText)` |
| `score` | Aggregated | Average rating from reviews (computed client-side after fetching reviews) |
| `isLive` | Flag | `true` for live albums |
| `owner`, `ownerPhotoUrl` | Live album fields | Set when admin adds a live album with owner info |

## Sorting

Controlled by `appState.sortBy` and `appState.sortDirection`. All sorting is client-side via `getSortedAlbums()`.

| Sort key | Comparison | Tie-breaker |
|----------|-----------|-------------|
| `date` (default) | `dateAdded` timestamp | Artist, then title |
| `artist` | `localeCompare` | Title |
| `title` | `localeCompare` | — |
| `genre` | `localeCompare` on `primaryGenre` | Artist, then title |
| `score` | Numeric average rating | Artist, then title |
| `timesPlayed` | Numeric count | Artist, then title |

## Grouping

When `appState.groupBy` is set, the list renders as collapsible group headers instead of a flat grid.

| Group key | What it groups on |
|-----------|------------------|
| `genre` | `album.primaryGenre` — from `extractPrimaryGenre(rawText)` |
| `artist` | `album.artist` |
| `owner` | `album.owner` for live albums, `"Iñaki"` for collection albums |

Grouping only operates on main collection albums except `owner` grouping, which includes live albums.

## Album card

Each album renders as an `<article class="album-card">` with a `<button class="cover-button">` that toggles expansion. Expanded state is tracked in `appState.expandedAlbumId`.

**Collapsed state:** Cover art image + vinyl disc overlay (spinning animation).

**Expanded state** (`isExpanded: true`): cover art, title, artist, year, genre, notes, `timesPlayed`, track list (for admin: clickable track buttons; for guests: plain list items), optional gifted-by/admin-thanks text, Spotify link if present.

The `album-opening` CSS animation plays on expand via `runAlbumOpenAnimation()`.

## Vinyl disc overlay

Every album cover has a spinning vinyl disc overlaid in the top-right corner, rendered via CSS + `disc.js`. The disc peeks out from behind the cover art.

- **Standard vinyl**: a dark disc. Colored vinyl gets a CSS custom property `--vinyl-color` derived from `detectVinylColors`.
- **Colored vinyl**: `--disc-border-color`, `--disc-groove-light`, `--disc-groove-dark` are set for albums whose vinyl color is light enough to show grooves.
- **Clear vinyl**: rendered as near-white with colored groove accents.
- **CD**: disc gets `cd-disc` class; background uses `buildCdBackground(coverUrl)` — a layered radial/conic gradient over the album art to simulate a CD's rainbow sheen.
- **Multi-disc**: a secondary disc (`vinyl-disc-secondary`) peeks further out for albums with two discs or two vinyl colors. A release like `"Vinyl (Red); Vinyl (Blue)"` renders two separately colored discs.

## Cover art not-owned styling

If `album.ownedByUser` is falsy (live albums not owned by the host), the cover image gets the `not-owned` CSS class (typically a reduced-opacity treatment).

## Now-playing link

When a now-playing card is active, clicking the album in the now-playing card calls `openNowPlayingAlbumInGrid()`, which locates the matching album in `appState.albums` using normalized title+artist comparison (`normalizeAlbumIdentityPart`) and scrolls it into view with an expand animation.

## Animations

- **Cover → now-playing**: `animateCoverToNowPlaying(sourceImg)` clones the cover image element, positions it fixed over the source, and uses the Web Animations API to arc it toward the now-playing widget (cubic-bezier arc, 680ms). Respects `prefers-reduced-motion`.
- **Album open**: `album-opening` CSS keyframe animation triggers on `runAlbumOpenAnimation()`.

## Related pages

- [[discogs-integration]] — how the collection is built
- [[feature-now-playing]] — how albums become now-playing
- [[feature-vinyl-disc-renderer]] — disc rendering details
- [[feature-live-albums]] — live albums mixed into the grid
- [[data-files]] — `discogs-collection.json` schema
