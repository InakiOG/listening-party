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

## Terminal controller

In a second terminal, run:

```bash
python controller.py
```

It will:
- Print artist names with numbers.
- Let you choose an album and then a song.
- Update now-playing for the webpage.

### Controller flags

```bash
python controller.py --allow-online-fetch
python controller.py --refresh-discogs
```

- Without flags, the controller uses local cache only.
- --allow-online-fetch enables online Discogs/Spotify fallback for missing tracks.
- --refresh-discogs refreshes collection cache first and enables online fetch.

### Temporary album mode

In artist selection, choose:
- 0. Add temporary album/song

This allows entering artist and album names manually, fetching image and tracks, and saving as a non-owned temporary entry in discogs-collection.json.

## Start both in one command

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1
```

Script parameters:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1 -RefreshServerDiscogs
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1 -RefreshControllerDiscogs
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1 -AllowControllerOnlineFetch
```

- -RefreshServerDiscogs passes --refresh-discogs to server.py.
- -RefreshControllerDiscogs passes --refresh-discogs to controller.py.
- -AllowControllerOnlineFetch passes --allow-online-fetch to controller.py.

## Reviews database

Reviews are stored in:
- reviews-db.json

Users are stored in:
- users-db.json

Local API endpoints include:
- GET /api/reviews?songKey=<album-and-song-key>
- POST /api/reviews
- GET /api/users?name=<name>
- GET /api/users/reviews?name=<name>
- POST /api/users/register
- POST /api/users/login
- POST /api/users/photo

## Discogs collection cache

Collection cache is stored in:
- discogs-collection.json

The scraper is implemented in [discogs_scraper.py](discogs_scraper.py) and uses the public Discogs collection API.

