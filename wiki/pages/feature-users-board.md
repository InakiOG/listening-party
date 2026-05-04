---
title: Feature — Users Board (Admin)
tags: [frontend, backend, feature, auth]
updated: 2026-05-03
---

# Feature — Users Board (Admin)

An admin-only view that shows all registered users, their profile photos, account types, passwords, and review histories.

## Access

Available from the profile menu when logged in as admin. Calls `openUsersBoardView()`, which:
1. Hides all other views, shows `users-board-view`.
2. Shows "Cargando..." while fetching.
3. Calls `GET /api/admin/users` (requires admin session cookie).
4. Calls `renderUsersBoard(users)`.

## What the server returns

`GET /api/admin/users` returns all users sorted alphabetically:
```json
{
  "users": [
    {
      "name": "Alice",
      "photoDataUrl": "...",
      "accountName": "usuario",
      "password": "hunter2",
      "reviews": [...]
    }
  ]
}
```

The `password` field is included in plaintext — this view is intentionally admin-only. Reviews are the user's full history (all albums, all parties, newest first).

## UI: user cards

Each user renders as a `.user-board-card` with:
- Avatar photo + name + account type
- A **password reveal button** — shows `••••••` by default; click to reveal the plaintext password. Click again to re-hide. State tracked in `btn.dataset.revealed`.
- A **reviews toggle** — shows a review count; click to expand/collapse the full review list. Each review shows: album/song target · rating/5, and optional review text. Uses `aria-expanded` for accessibility.

## Why this exists

Since passwords are stored in plaintext and guests may forget theirs, the admin needs a way to look them up. The board also lets the admin see who has reviewed what — useful for understanding engagement during or after a party.

## Related pages

- [[auth-sessions]] — how session auth works for this endpoint
- [[feature-user-profiles]] — individual user profile data
- [[api-reference]] — `GET /api/admin/users`
- [[security-notes]] — plaintext password trade-offs
