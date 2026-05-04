---
title: Discogs Integration
tags: [discogs, backend]
updated: 2026-05-03
---

# Discogs Integration

`discogs_scraper.py` is the Discogs API client and collection cache builder. It runs offline (via `controller.py`) or at server startup with `--refresh-discogs`.

## Collection sync — `update_collection_cache()`

Fetches the full vinyl collection for the configured Discogs user (`InakiOG`) and writes it to `discogs-collection.json`.

Flow:
1. Fetch all pages from `https://api.discogs.com/users/InakiOG/collection/folders/0/releases`.
2. For each release, call `fetch_release_details(release_id)` to get the track list.
3. Map the raw Discogs release to the internal item schema via `map_release()`.
4. Preserve existing `tracks`, `timesPlayed`, and `year` from the cache for releases that haven't changed (avoids overwriting manually-corrected data).
5. Skip writing the file if the SHA-256 fingerprint of all items is unchanged.
6. On network error mid-fetch, unseen pages are preserved from the existing cache — no false pruning.

## Track backfill — `backfill_missing_tracks()`

Runs as a **daemon thread** at server startup. For each album in the collection with an empty `tracks` list, it tries three sources in sequence:

| Priority | Source | API |
|----------|--------|-----|
| 1 | Discogs | `GET https://api.discogs.com/releases/{id}` |
| 2 | MusicBrainz | `https://musicbrainz.org/ws/2/release/?query=...` |
| 3 | iTunes | `https://itunes.apple.com/search?term=...&entity=song` |

Results are written back to `discogs-collection.json` under `REVIEWS_LOCK`.

## Live album search — `fetch_temporary_album_data(title, artist)`

Used by the admin when adding a live album (one not in the collection). Tries iTunes first, falls back to Spotify scraping (no auth, public HTML). Returns cover URL, tracks, and metadata.

## Internal data mapping — `map_release(release)`

Converts a raw Discogs API response to the internal item schema. Key transformations:
- `summarize_artists(artists)` — flattens the Discogs artist list (handles ANVs, joins, etc.) to a single display string.
- `summarize_formats(formats)` — extracts the `rawText` format descriptor (e.g. `"Vinyl (Red Transparent); Rock"`) used for vinyl color detection.
- `summarize_genres(genres, styles)` — merges Discogs genres and styles into a single tag string.
- `summarize_tracklist(tracklist)` — extracts just track titles, flattening multi-disc layouts.

## Cache index — `build_existing_items_index(items)`

Builds a dict keyed by `(discogsId, instanceId)` for O(1) lookup during incremental cache updates. This is how the scraper knows which releases already exist and which fields to preserve.

## Configuration

No config file. The Discogs username is hardcoded as `"InakiOG"`. The Discogs API is accessed without authentication (public collection endpoint).

## Related pages

- [[data-files]] — `discogs-collection.json` schema
- [[server]] — `backfill_missing_tracks` daemon thread
- [[frontend]] — `detectVinylColors`, `detectDiscType` use `rawText`
- [[testing]] — `test_discogs_scraper.py` coverage
