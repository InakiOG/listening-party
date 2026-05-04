---
title: Security Notes
tags: [concept, reference]
updated: 2026-05-03
---

# Security Notes

The app is designed for **trusted guests on a private local network**. The trade-offs listed here are intentional design choices, not bugs.

## Known limitations

| Issue | Detail |
|-------|--------|
| Plaintext passwords | `user-credentials.local.json` stores passwords in plain text. Gitignored. |
| No HTTPS | All traffic is unencrypted HTTP. Credentials and session tokens travel in the clear. |
| No CSRF protection | POST endpoints don't validate CSRF tokens. Any page can make cross-site requests to the server. |
| No brute-force protection | The login endpoint has no rate limiting. |
| Admin password hardcoded | `ADMIN_DEFAULT_PASSWORD` in `server.py` is `"14agosto"`. Change before hosting outside your home network. |
| API keys in `.env` | `GEMINI_API_KEY` and `GROQ_API_KEY` are in a plain text file. Gitignored but readable by anyone with filesystem access. |
| No input sanitization | Review text and descriptions are stored and served as-is. XSS is possible if content is rendered without escaping — only relevant on the local network. |
| No session invalidation | Logging out clears the cookie but doesn't invalidate the token server-side until the next login. |

## Threat model

**In scope (LAN party among friends):**
- All users are invited guests.
- The host controls the WiFi network.
- No data is sensitive in the context of the party.

**Out of scope:**
- Public internet exposure.
- Hostile users on the network.
- Storing sensitive personal data.

**Do not expose this server to the internet.** If you need to run it on a public network, add HTTPS (e.g. via a reverse proxy like Caddy), hash passwords, add CSRF tokens, and rate-limit login.

## Related pages

- [[auth-sessions]] — session and credential implementation details
- [[overview]] — design philosophy
