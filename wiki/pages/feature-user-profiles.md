---
title: Feature — User Profiles
tags: [frontend, backend, feature, auth]
updated: 2026-05-03
---

# Feature — User Profiles

Every user has a profile with a photo, bio, social links, top albums list, and party attendance count. Profiles are viewable by others (via the active user bubbles) and editable by the owner.

## Profile fields

| Field | Max length | Notes |
|-------|-----------|-------|
| `name` | Display name (not editable after registration) | Stored as-is; normalized to lowercase for lookup |
| `photoDataUrl` | — | Base64 data URL of the profile image |
| `description` | 150 chars | Free-text bio |
| `instagramUsername` | 40 chars | Leading `@` stripped automatically (server + client) |
| `spotifyUrl` | 200 chars | Must start with `https://open.spotify.com/user/` |
| `topAlbums` | 3 entries | Each: `{ title, artist, coverUrl }` |
| `listeningPartiesAttended` | — | Integer; incremented when a party starts |
| `accountName` | — | `"usuario"` or `"administrador"` |
| `createdAt` | — | ISO timestamp of account creation |

## Registration

`POST /api/users/register { name, password, photoDataUrl? }`:
1. Server normalizes `name` to lowercase for the storage key.
2. Checks `users-db.json` for a duplicate.
3. Writes entry to both `users-db.json` and `user-credentials.local.json`.
4. Returns the new user profile + sets session cookies.

Password and name are required; photo is optional. The client can register without a photo first and upload one separately.

## Photo upload

`POST /api/users/photo { name, photoDataUrl }`:
- Reads the photo as a data URL via `FileReader` (client-side `readFileAsDataUrl`).
- Sends the base64 string to the server.
- Server writes it to `users-db.json[userKey].photoDataUrl`.
- The photo is stored inline in the JSON — no separate file storage.

Photos are embedded in reviews at submission time so they display correctly even if the user later changes their photo.

## Profile edit

`POST /api/users/profile { name, description?, instagramUsername?, spotifyUrl?, topAlbums? }`:
- Partial update — only supplied fields are changed.
- Field limits are validated on both client and server.
- `instagramUsername`: leading `@` stripped on client via `normalizeInstagramHandle`; enforced again on server.
- `spotifyUrl`: validated client-side with `isValidSpotifyUrl` — must start with `https://open.spotify.com/user/`.

## Top albums with cover art

The top albums feature has a multi-source cover art lookup system built into the client:

1. `ensureTopAlbumCover(title, artist)` — synchronous; returns a cached URL or `""` and kicks off a background fetch.
2. `fetchTopAlbumCover(title, artist)` — queries 5 sources in parallel via `Promise.allSettled`:
   - iTunes: artist + title query
   - iTunes: toggled "The " prefix (handles "The Dark Side of the Moon" ↔ "Dark Side of the Moon")
   - iTunes: title-only query
   - MusicBrainz + Cover Art Archive
   - Deezer
3. Results are deduplicated, scored, and trimmed to 5 options:
   - Score 0: exact title + artist match
   - Score 1: title match only
   - Score 2: artist match only
   - Score 3: no match
4. `renderTopAlbumPicker(index, ...)` shows multiple cover options as small thumbnails if > 1 result.
5. User picks the correct cover by clicking a thumbnail — stored in `topAlbumCoverUserPick` map.
6. The selected `coverUrl` is saved to the server on `POST /api/users/profile`.

On login/session restore, previously saved `coverUrl` values pre-populate `topAlbumCoverUserPick` so the right cover shows without re-fetching.

## Profile view

Accessed from the profile menu (avatar button). Shows:
- Profile photo (tappable to change)
- Username + party count
- Editable description, Instagram handle, Spotify URL
- Top 3 album inputs with live cover art preview
- "My reviews" link → review history
- "My parties" link → attended party list
- Logout button

## Profile data in active user bubbles

When other users view someone's bubble:
- Profile photo, description, Instagram, Spotify, top albums are all visible.
- Instagram and Spotify render as tappable buttons that open external URLs.
- Top album cover art is fetched fresh from the cover art sources (not from the server's `coverUrl` field) — each device fetches covers independently.

## `listeningPartiesAttended` counter

Incremented server-side in `increment_users_listening_parties_attended()` when a party starts. Only users who are "sticky attendees" at party start get the increment — being logged in when the party begins. This is a one-time increment per party, not per session change.

## Persistence of username

The username is persisted in `localStorage` (key: `listeningPartyUserName`) so returning users don't have to type it again. `GET /api/users/me` uses this to restore the session without requiring a password re-entry (soft auto-login).

## Related pages

- [[auth-sessions]] — registration, login, session management
- [[feature-active-users]] — how profile data appears in bubbles
- [[data-files]] — `users-db.json` schema
- [[api-reference]] — user and profile endpoints
