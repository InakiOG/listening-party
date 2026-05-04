---
title: Authentication & Sessions
tags: [auth, backend]
updated: 2026-05-03
---

# Authentication & Sessions

## Overview

The auth system is intentionally minimal: plaintext passwords stored in a gitignored local file, session tokens in cookies, no CSRF protection. It is designed for trusted guests on a private LAN, not internet exposure.

## Accounts

Accounts have two tiers:

| `accountName` | Who | Capabilities |
|--------------|-----|-------------|
| `"usuario"` | All regular guests | Browse, review, like, update profile |
| `"administrador"` | Admin only (username: `iñaki`) | Everything, plus party lifecycle controls |

The admin account is hardcoded in `server.py` (`ADMIN_USER_KEY = "iñaki"`, `ADMIN_DEFAULT_NAME = "Iñaki"`, `ADMIN_DEFAULT_PASSWORD = "14agosto"`). `reconcile_auth_stores()` recreates it at every startup if it's missing from either store.

## Storage

Two files hold auth data:

- `users-db.json` — public profile data, keyed by normalized username (lowercase).
- `user-credentials.local.json` — passwords and session tokens, **gitignored**, same key scheme.

The files are always kept in sync by the server (registration writes both; login reads credentials, touches session; profile updates touch users-db only).

## Registration flow

1. Client: `POST /api/users/register { name, password, photoDataUrl? }`
2. Server normalizes username to lowercase.
3. Checks for duplicate in `users-db.json`.
4. Writes new entry to both `users-db.json` and `user-credentials.local.json`.
5. Issues session cookies immediately (user is logged in after registration).

## Login flow

1. Client: `POST /api/users/login { name, password }`
2. Server normalizes username, looks up in credentials store.
3. Compares plaintext passwords.
4. Generates a new `sessionToken` (`secrets.token_hex(32)`).
5. Writes token + timestamps back to `user-credentials.local.json`.
6. Sets two cookies in the response:

| Cookie | Value | Flags |
|--------|-------|-------|
| `listening_party_session` | Session token | HttpOnly, SameSite=Lax, Max-Age=10 years |
| `listening_party_user` | URL-encoded username | Not HttpOnly (readable by JS) |

## Session validation

`get_session_user(handler)` reads `listening_party_session` from the request cookie header, looks it up across all credentials entries, and returns the matching username. On each validated request, `sessionLastSeenAt` is updated in the credentials store — this drives the 90-second active window.

## Soft auto-login

If `listening_party_session` is missing but `listening_party_user` is present, `GET /api/users/me` re-issues a session token without requiring the password. This handles the case where cookies were partially cleared.

## Active user window

A user is "active" if `sessionLastSeenAt` is within **90 seconds** of the current time (`ACTIVE_USER_WINDOW_SECONDS = 90`). The `/api/users/active` endpoint returns this list, which drives the bubble UI and the sticky attendee logic for party sessions.

## Admin auth — two mechanisms

Admin actions use two different auth mechanisms depending on the endpoint:

| Mechanism | Endpoints |
|-----------|----------|
| `actorName` in request body | `POST /api/now-playing`, `POST /api/now-playing/clear`, `POST /api/listening-party/finish`, `POST /api/listening-party/picture` |
| Session cookie (`is_admin_cookie`) | `GET /api/admin/users`, `POST /api/live-albums`, `PATCH /api/live-albums`, `GET /api/party-records` |

The body-based mechanism was chosen for party lifecycle endpoints so they can be triggered from scripts without managing cookies.

## Known limitations

- Plaintext passwords.
- No HTTPS — credentials travel in plain text on the network.
- No CSRF tokens.
- No brute-force rate limiting on login.
- No logout invalidation — the token in `user-credentials.local.json` is replaced on next login, but the old token remains valid until then (no token blocklist).

See [[overview]] for the intentional-design rationale.

## Related pages

- [[data-files]] — `users-db.json` and `user-credentials.local.json` schemas
- [[api-reference]] — auth fields per endpoint
- [[server]] — `get_session_user`, `reconcile_auth_stores`
