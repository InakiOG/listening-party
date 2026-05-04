---
title: Thread Safety
tags: [backend, concept, architecture]
updated: 2026-05-03
---

# Thread Safety

`ThreadingHTTPServer` spawns a new thread per request, so any shared mutable state requires locking. The app uses two locks and one smaller per-resource lock.

## Locks

### `REVIEWS_LOCK`

Guards all reads and writes to:
- `reviews-db.json`
- `users-db.json`
- `user-credentials.local.json`
- `party-records.json`
- `fun-facts-db.json`
- `discogs-collection.json`
- `_current_session` (in-memory party session)

This is a broad lock by design — it's held for the duration of a read-modify-write cycle on any of these files. Because all writes are fast (small JSON serialization), contention is low in practice.

### `LIVE_ALBUMS_LOCK`

Guards `live-albums.json` separately. Live albums are edited independently from the review/user stores, so separating the lock avoids unnecessary blocking during the more common review operations.

### `_fun_facts_lock`

Guards `_fun_facts_db` (the in-memory fun facts dict). Separate from `REVIEWS_LOCK` because fun facts writes happen on a background thread (`_prefetch_worker`) independently of user-triggered requests. Using the broader `REVIEWS_LOCK` for fun facts would risk deadlocking if a prefetch write and a review write were nested.

### `_READ_CACHE_LOCK`

Guards `_READ_CACHE`, the short-TTL in-memory response cache. Very briefly held — just for dict lookup or update.

### `_gemini_rate_lock`

Guards `_gemini_last_call`. Ensures the 5-second minimum between Gemini API calls even when multiple requests trigger inline fun-fact fetches concurrently.

## Background threads

Two daemon threads run alongside request handler threads:

| Thread | Started | What it touches |
|--------|---------|----------------|
| `backfill_missing_tracks` | At startup | `discogs-collection.json` under `REVIEWS_LOCK` |
| `_prefetch_worker` | 6s after boot | `_fun_facts_db` + `fun-facts-db.json` under `_fun_facts_lock` |

Daemon threads are killed automatically when the main thread exits — no cleanup needed.

## `now-playing.json` — no lock

`now-playing.json` is written and deleted without a lock. The rationale: it's a single-writer file (only the admin can set/clear it), and file writes on local filesystems are atomic enough for this use case. Using `REVIEWS_LOCK` here would risk holding it during a potentially slow file write while other threads wait.

## What's NOT thread-safe

- `_current_session` is modified by request handlers without always holding `REVIEWS_LOCK`. This is a minor risk (the party session is only modified by the admin, who has one browser tab open), but it's worth noting as a technical gap.

## Related pages

- [[server]] — where the locks are defined
- [[architecture]] — background thread overview
