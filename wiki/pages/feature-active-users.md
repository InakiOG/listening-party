---
title: Feature — Active Users & Physics Bubbles
tags: [frontend, feature, concept]
updated: 2026-05-03
---

# Feature — Active Users & Physics Bubbles

Online guests are shown as floating profile photo bubbles that bounce around a canvas area. This is the most visually distinctive UI element in the app.

## What "active" means

A user is active if their `sessionLastSeenAt` timestamp (in `user-credentials.local.json`) is within **90 seconds** of the current server time. This timestamp is updated on every request that carries a valid session cookie — so any user browsing the app keeps their bubble alive automatically.

During an active party, **sticky attendees** are also included: users who were active when the party started remain in the list even if they stop making requests. This prevents bubbles disappearing when someone's phone goes idle mid-party. Sticky attendees come from `_current_session.stickyAttendeeKeys`.

The server's active user response at `GET /api/users/active` also embeds now-playing state, so this single 2-second poll covers both the bubble layer and the now-playing card.

## Polling and rendering pipeline

```
setInterval(2s) → apiGetActiveUsers()
                        ↓
                  renderActiveUserBubbles(users)
                        ↓
                  signature check (JSON of name+photo+profile)
                        ↓  (skip if unchanged)
                  rebuild layer innerHTML
                        ↓
                  syncBubblesFromDom()
                        ↓
                  physics loop continues
```

`lastActiveUsersSignature` prevents unnecessary re-renders when nothing has changed. A re-render only happens when the user list or any profile data changes.

Max 14 bubbles are shown (`limitedUsers = normalizedUsers.slice(0, 14)`).

## Bubble DOM structure

Each bubble is an `<article class="active-user-bubble" data-user-key="...">` containing:
- A profile `<img>` (falls back to `profileDefaultPhotoUrl`)
- A `.active-user-bubble-details` panel (hidden unless expanded) containing:
  - Name
  - Description
  - Instagram link (opens external URL)
  - Spotify link (opens external URL)
  - Top albums list (with cover art fetched from iTunes/MusicBrainz/Deezer)

Bubbles start at `left:-9999px; top:-9999px` — positioned off-screen until the physics engine places them.

## Physics engine

The physics loop runs on `requestAnimationFrame` (stored in `physicsRafId`). It maintains `bubbleEntities` — a `Map` keyed by `data-user-key`, where each entity has:

```js
{
  x, y,          // center position
  vx, vy,        // velocity
  radius,        // derived from DOM element size
  el             // the DOM element
}
```

Each frame:
1. Apply velocity: `x += vx`, `y += vy`.
2. Bounce off canvas edges (reverse velocity component, clamp position).
3. Check all pairs for circle-circle overlap:
   - If overlapping, compute the overlap distance, push the two circles apart.
   - Transfer velocity components along the collision normal (elastic-ish collision).
4. Apply light drag (`vx *= 0.98`, `vy *= 0.98`) to prevent infinite acceleration.
5. Update each bubble element's `left` and `top` styles.

`syncBubblesFromDom()` reconciles the `bubbleEntities` map with the current DOM after a re-render: entities for removed users are deleted, entities for new users are initialized with random position and velocity.

## Expanded bubble

Clicking a bubble toggles its `expanded` class, which shows the `.active-user-bubble-details` panel. The expanded state is tracked in `activeUserBubbleUiState` (a `Map` keyed by user key) so it survives re-renders.

When expanded, the bubble is larger — the physics engine accounts for this by reading the actual rendered `offsetWidth`/`offsetHeight` rather than a fixed radius.

## Drag

Bubbles can be dragged. `activeBubbleDrag` holds the active drag state:
```js
{ key, startX, startY, startEntityX, startEntityY }
```
On `pointermove`, the entity's position is updated directly. On `pointerup`, velocity is set to zero (drag-and-drop stops the bubble).

## Bubble color

Each bubble has a background color ring (visible when the profile photo is loading or absent). Colors are assigned randomly at first use and cached in `activeUserBubbleColorCache` keyed by normalized username. The palette is 8 vivid colors:

```js
["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#a855f7","#ec4899"]
```

## Top album cover art in expanded bubbles

Top albums shown in the expanded bubble panel use cover art from `ensureTopAlbumCover(title, artist)`, which queries (in parallel):
1. iTunes (artist + title)
2. iTunes (toggling "The " prefix)
3. iTunes (title only)
4. MusicBrainz + Cover Art Archive
5. Deezer

Results are scored by title/artist match quality and the best 5 are kept as options. The user can pick among them in the profile editor (see [[feature-user-profiles]]). Covers are cached in `topAlbumCoverCache` keyed by `"title::artist"` (lowercase).

## Visibility optimization

The active users poll is paused when the browser tab is hidden (`document.visibilitychange`). When the tab becomes visible again, a refresh runs immediately.

## Related pages

- [[feature-user-profiles]] — what data the bubbles display
- [[auth-sessions]] — how active status is determined server-side
- [[api-reference]] — `GET /api/users/active`
- [[server]] — sticky attendee logic in `_current_session`
