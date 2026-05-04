# Wiki Index — Listening Party

Catalog of all pages. Updated on every ingest or significant change.

---

## Overview

- [[overview]] — What the app is, who it's for, key design philosophy
- [[architecture]] — System diagram, three layers, startup sequence, design decisions

## Backend

- [[server]] — server.py internals: globals, handler, auth helpers, read cache, background workers
- [[thread-safety]] — Locking strategy: REVIEWS_LOCK, LIVE_ALBUMS_LOCK, _fun_facts_lock, what's unguarded
- [[admin-controls]] — What the admin account can do and how each action is authorized
- [[auth-sessions]] — Registration, login, session cookies, soft auto-login, active user window

## Frontend

- [[frontend]] — index.html, desktop.html, app.js: polling architecture, UI components, physics canvas, vinyl renderer

## Data

- [[data-files]] — All eight JSON files: schemas, lock assignments, gitignore status

## API

- [[api-reference]] — Full HTTP endpoint table with auth requirements and body shapes

## Flows

- [[party-lifecycle]] — End-to-end walkthrough: startup → first now-playing → reviews → finish party
- [[discogs-integration]] — Collection sync, track backfill, live album search, internal data mapping
- [[fun-facts]] — AI fact generation, provider fallback, background prefetch, priority queue

## Features (detailed)

- [[feature-album-collection]] — Album grid: sorting, grouping, expansion, cover animations, vinyl overlay
- [[feature-vinyl-disc-renderer]] — disc.js: color detection, CD rendering, CSS variable system, groove colors
- [[feature-now-playing]] — Now-playing card, disc spin speed, party-brief popup, server-side write flow
- [[feature-review-system]] — Star ratings, song vs album scope, upsert logic, likes, party snapshot integration
- [[feature-active-users]] — Physics bubble canvas, sticky attendees, top album cover art fetching, drag
- [[feature-user-profiles]] — Profile fields, photo upload, top albums with multi-source cover art picker
- [[feature-party-records]] — Live snapshots, finalization, party picture lightbox, admin vs guest views
- [[feature-live-albums]] — Ad-hoc albums, owner badge, cover art search, owner grouping mode
- [[feature-fun-facts-detail]] — Gemini/Groq prompts, 429 handling, in-memory cache, graceful degradation
- [[feature-users-board]] — Admin user list with password reveal and review history
- [[feature-server-restart-detection]] — X-Server-Boot-Id header, monkey-patched fetch, auto-reload

## Reference

- [[testing]] — 272 tests, four files, fixtures, coverage gaps
- [[security-notes]] — Known limitations and intentional trade-offs
- [[mcp-server]] — Docker MCP server: wiki tools, connection config, available tools table
