# listening-party

Single-page local web app intended for phone use only.

## Run locally

From the repository root:

```bash
python3 server.py
```

Then open `http://localhost:8000` on the same device, or `http://<your-local-ip>:8000` from a phone on the same network.

Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress,InterfaceAlias

Example: http://192.168.100.12:8000

## Terminal controller

In a second terminal, run:

```bash
python3 controller.py
```

It will:
- Print album names with numbers starting at 1.
- Ask for an album number and then print song names with numbers.
- Ask for a song number and update the webpage banner to show Currently Playing with album art, album name, and song name.

## Start both in one command

From the repository root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-listening-party.ps1
```

This opens two terminals:
- One terminal running the API web server on port 8000.
- One terminal running the interactive controller.

## Reviews database

Reviews are stored in:

reviews-db.json

The frontend saves and loads reviews through these local API endpoints:
- GET /api/reviews?songKey=<album-and-song-key>
- POST /api/reviews

## Discogs collection cache

Every time the server starts, it refreshes a local Discogs collection cache from the public InakiOG collection pages and writes it to:

discogs-collection.json

The scraper is implemented in [discogs_scraper.py](discogs_scraper.py) and uses the public Discogs collection API.

