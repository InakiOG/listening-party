---
title: Feature — Live Albums
tags: [frontend, backend, feature]
updated: 2026-05-03
---

# Feature — Live Albums

Live albums are records played during a party that aren't in the host's Discogs collection — a friend's vinyl, a borrowed record, a random find. The admin can add them on the fly without modifying the main collection.

## What makes a live album different

| Aspect | Collection album | Live album |
|--------|-----------------|-----------|
| Source | `discogs-collection.json` | `live-albums.json` |
| Ownership | Always owned by host | May have `owner` + `ownerPhotoUrl` |
| `isLive` flag | `false` | `true` |
| `timesPlayed` tracking | Incremented in collection cache | Not tracked |
| Persistence | Permanent | Cleared between parties |
| In sort/filter | Included | Included (with grouping awareness) |

## Adding a live album (admin)

1. Admin taps the "+" FAB button (`add-album-button`), visible only to admin.
2. The "Add album" modal opens.
3. Admin types a title and artist. A debounced search (`addAlbumSearchTimer`) fetches cover options from the server after 500ms idle.
4. Server calls `fetch_temporary_album_data(title, artist)` from `discogs_scraper.py`:
   - Queries iTunes first: `https://itunes.apple.com/search?term=...&entity=album&limit=5`
   - Falls back to Spotify scraping (public search page, no auth) if iTunes returns nothing.
   - Returns `{ title, artist, coverUrl, tracks, spotifyUrl }`.
5. Admin selects a cover from the returned options.
6. Admin optionally fills in the owner's name (for albums brought by a guest).
7. Client calls `POST /api/live-albums { id, title, artist, coverUrl?, spotifyUrl? }` (admin cookie).
8. Server appends to `live-albums.json` under `LIVE_ALBUMS_LOCK`.

## Track list update

After a live album is added, tracks might be missing. Admin can update them via `PATCH /api/live-albums { id, tracks[] }`. The server finds the album by ID in `live-albums.json` and replaces its `tracks` array.

On the album card (when expanded as admin), track items become clickable play buttons — the same as collection albums.

## Owner badge

If a live album has an `owner` field, an owner badge appears on the cover:
- If `ownerPhotoUrl` is set: renders as a small circular photo in the cover corner.
- If only `owner` name: renders as a letter badge (`safeOwner[0].toUpperCase()`).

## Polling

`liveAlbumsPollTimerId` polls `GET /api/live-albums` periodically. When the response changes, `appState.albums` is updated and re-rendered. Live albums are merged into the same album list as collection albums so they appear in sort/filter/grouping.

## Owner grouping

When `appState.groupBy === "owner"`:
- Collection albums are grouped under `"Iñaki"` (the host).
- Live albums with an `owner` are grouped under that owner's name.
- `"Iñaki"` is always sorted first, then alphabetical.
- All other grouping modes (`genre`, `artist`) exclude live albums to avoid mixing unlabeled live entries with the clean Discogs data.

## Lifecycle

Live albums persist in `live-albums.json` across server restarts. They are **not automatically cleared** — the admin must explicitly clear them. There is no UI button for bulk clear in the current implementation; it must be done manually (edit or delete `live-albums.json`).

Live album data is included in `_current_session["albumsPlayed"]` when the admin sets now-playing for one, so it appears in the party record.

## Related pages

- [[feature-album-collection]] — how live albums merge into the main view
- [[discogs-integration]] — `fetch_temporary_album_data` for cover art
- [[admin-controls]] — admin FAB button
- [[data-files]] — `live-albums.json` schema
- [[api-reference]] — live album endpoints
