---
title: Feature — Server Restart Detection
tags: [frontend, backend, feature, concept]
updated: 2026-05-03
---

# Feature — Server Restart Detection

Every client automatically detects when the server has restarted and reloads the page. This prevents stale state — the album list, now-playing data, or session from a previous server run persisting in memory without the client knowing.

## Mechanism

### Server side

On every startup, `server.py` generates a unique boot ID:

```python
SERVER_BOOT_ID = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
```

Format: `"<millisecond timestamp>-<8 hex chars>"`. This is both unique and sortable by time.

`ListeningPartyHandler.end_headers()` appends this ID to every HTTP response:
```
X-Server-Boot-Id: 1716000000000-a3f2c1e4
```

### Client side

`window.fetch` is monkey-patched at app startup:

```js
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const bootId = response.headers.get("X-Server-Boot-Id") || "";
  if (bootId) {
    if (!knownServerBootId) {
      knownServerBootId = bootId;          // First response — learn the ID
    } else if (knownServerBootId !== bootId) {
      window.location.reload();            // ID changed — server restarted
    }
  }
  return response;
};
```

The patched fetch wraps every request, including polls and API calls. The first response after page load sets `knownServerBootId`. Any subsequent response with a different ID triggers `window.location.reload()`.

## Why this matters

Without this:
- A guest browsing the album list has no way to know the server crashed and restarted.
- The client's `appState.albums` might be stale if the collection was refreshed on restart.
- The session cookie might still be valid (session tokens survive server restart since they're stored on disk), so the user stays logged in — but the now-playing state was reset (`now-playing.json` is deleted on startup).
- Inconsistent UI: the now-playing card might show old data while the server has no record of it.

The reload is immediate and silent — no user confirmation. This is intentional: a server restart during a party is a rare event, and the cost of a reload (a few seconds of re-initialization) is much lower than the cost of guests operating with stale state.

## Coverage

The patched `window.fetch` covers all requests made through the standard `fetch` API, which includes all API calls and polling loops. It does not cover:
- `<img>` tag loads (album cover art, profile photos)
- `<script>` or `<link>` loads
- WebSocket (not used)

These omissions are fine — the goal is to detect backend API changes, not static asset changes.

## Related pages

- [[server]] — `SERVER_BOOT_ID` generation, `end_headers` injection
- [[frontend]] — monkey-patched `window.fetch`
- [[architecture]] — polling architecture that makes every client touch the server regularly
