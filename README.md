# listening-party

Single-page local web app intended for phone use only.

## Run locally

From the repository root:

```bash
python server.py
```

By default, the server uses the existing local cache file and does not refresh Discogs.

Open:
- http://localhost:8000 on the same device, or
- http://<your-local-ip>:8000 from a phone on the same network.

To find your local IP in PowerShell:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress,InterfaceAlias
```

Example:
- http://192.168.100.12:8000

### Server flags

```bash
python server.py --refresh-discogs
python server.py --port 8000
```

- --refresh-discogs refreshes discogs-collection.json at startup.
- --port chooses the HTTP server port.

## Current listening control (administrador)

The terminal selection flow was removed.

Now, only the `administrador` account can control current listening directly from the web UI:
- Each expanded album shows an extra button: `Escuchar album`.
- Clicking it creates a currently listening entry for album review.
- Clicking a song asks for confirmation to start currently listening for that specific song.

## Start both in one command

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1
```

Script parameters:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1 -RefreshServerDiscogs
```

- -RefreshServerDiscogs passes --refresh-discogs to server.py.

### Optional maintenance utility

`controller.py` remains available only for maintenance tasks:

```bash
python controller.py --refresh-discogs
python controller.py --backfill-all-tracks
python controller.py --allow-online-fetch --backfill-all-tracks
```

- It no longer controls now-playing.

## Reviews database

Reviews are stored in:
- reviews-db.json

Users are stored in:
- users-db.json

Passwords are stored in:
- user-credentials.local.json (plaintext, local-only, gitignored)

Login session is stored in:
- Persistent HTTP cookie (auto-login, no repeated manual login required)

Local API endpoints include:
- GET /api/reviews?songKey=<album-and-song-key>
- POST /api/reviews
- POST /api/now-playing (administrador only)
- GET /api/users?name=<name>
- GET /api/users/me (current user from cookie session)
- GET /api/users/reviews?name=<name>
- POST /api/users/register (requires name + password)
- POST /api/users/login (requires name + password)
- POST /api/users/logout
- POST /api/users/photo

## Discogs collection cache

Collection cache is stored in:
- discogs-collection.json

The scraper is implemented in [discogs_scraper.py](discogs_scraper.py) and uses the public Discogs collection API.

