---
title: API Reference
tags: [api, reference]
updated: 2026-05-03
---

# API Reference

All endpoints are served by `server.py` at `http://<host>:8000/api/*`. All request and response bodies are JSON. POST/PATCH require `Content-Type: application/json`.

---

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/users?name=<name>` | None | Look up a user profile by display name |
| `GET` | `/api/users/me` | Cookie | Return the currently logged-in user |
| `GET` | `/api/users/reviews?name=<name>` | None | All reviews by a user, newest first |
| `GET` | `/api/users/active` | None | Active users (seen within 90s) + embedded now-playing state |
| `GET` | `/api/admin/users` | Admin cookie | Full user list |
| `POST` | `/api/users/register` | None | Create account. Body: `{ name, password, photoDataUrl? }` |
| `POST` | `/api/users/login` | None | Log in. Body: `{ name, password }`. Sets session cookie. |
| `POST` | `/api/users/logout` | Cookie | Clear session cookie |
| `POST` | `/api/users/photo` | None | Update profile photo. Body: `{ name, photoDataUrl }` |
| `POST` | `/api/users/profile` | None | Update bio/links/top albums. Body: `{ name, description?, instagramUsername?, spotifyUrl?, topAlbums? }` |

### Profile field limits

| Field | Limit |
|-------|-------|
| `description` | 150 chars |
| `instagramUsername` | 40 chars (leading `@` stripped) |
| `spotifyUrl` | 200 chars; must start with `https://open.spotify.com/user/` |
| `topAlbums[].title` | 150 chars |
| `topAlbums[].artist` | 120 chars |

---

## Reviews

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/reviews?songKey=<key>&partyId=<id>` | None | Reviews for a key; `partyId` is optional filter |
| `POST` | `/api/reviews` | None | Submit or upsert a review. Body: `{ songKey, name, rating, text?, partyId?, photoDataUrl? }` |
| `POST` | `/api/reviews/like` | None | Toggle like. Body: `{ songKey, reviewerName, likerName, likerPhotoDataUrl? }` |

Song key formats:
- Song: `"Album Title::Song Title"`
- Album: `"album::Artist Name::Album Title"`

---

## Now Playing (admin only)

Authorization: `actorName` in the **request body** must resolve to the `administrador` account. Not cookie-based.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/now-playing` | Set current track. Body: `{ actorName, albumTitle, albumArtist, songTitle?, coverUrl, reviewScope? }` |
| `POST` | `/api/now-playing/clear` | Stop playback. Body: `{ actorName }` |

`reviewScope` defaults to `"song"` if `songTitle` is provided, else `"album"`.

---

## Party management (admin only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/listening-party/finish` | body `actorName` | Finalize party, write record, clear now-playing |
| `POST` | `/api/listening-party/picture` | body `actorName` | Attach photo. Body: `{ actorName, pictureDataUrl }` |
| `GET` | `/api/party-records` | Admin cookie | All past party records |
| `GET` | `/api/my-parties` | Cookie | Parties the current user attended |

---

## Live albums

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/live-albums` | None | Albums added during the current party |
| `POST` | `/api/live-albums` | Admin cookie | Add album. Body: `{ id, title, artist, coverUrl?, spotifyUrl? }` |
| `PATCH` | `/api/live-albums` | Admin cookie | Update track list. Body: `{ id, tracks[] }` |

---

## Collection

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/collection` | None | Full Discogs collection |
| `GET` | `/api/collection/search?q=<query>` | None | Search collection by title/artist |

---

## Fun facts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/fun-facts?album=<name>&artist=<name>` | None | Up to 15 facts. Fetches inline on cache miss (blocking). |

---

## Auth notes

Two auth mechanisms are in use simultaneously:

| Mechanism | Used by |
|-----------|--------|
| Session cookie (`listening_party_session`) | `/api/users/me`, `/api/admin/users`, live album write endpoints, party records |
| `actorName` body field | `/api/now-playing`, `/api/listening-party/*` |

See [[auth-sessions]] for full details.

---

## Related pages

- [[auth-sessions]] — session cookie mechanics
- [[data-files]] — what the endpoints read and write
- [[party-lifecycle]] — the flow that now-playing and finish endpoints drive
