---
title: Testing
tags: [testing, reference]
updated: 2026-05-03
---

# Testing

272 tests across four files. Only standard library + pytest — no mocking libraries, no test databases.

## Running tests

```bash
# All tests
.\ListeningParty\Scripts\python.exe -m pytest tests/ -v

# Single file
.\ListeningParty\Scripts\python.exe -m pytest tests/test_utils.py -v

# Single class
.\ListeningParty\Scripts\python.exe -m pytest tests/test_endpoints.py::TestRegister -v
```

## Test files

| File | Count | What it covers |
|------|-------|---------------|
| `tests/test_utils.py` | 118 | Pure utility functions: normalization, sanitization, session token helpers, cookie builders, review aggregation, date parsing |
| `tests/test_file_io.py` | 45 | File I/O functions with temp directories: ensure/read/write for every store, `increment_album_times_played`, `reconcile_auth_stores`, `clear_now_playing` |
| `tests/test_discogs_scraper.py` | 57 | Pure functions in `discogs_scraper.py`: `summarize_artists`, `summarize_formats`, `summarize_genres`, `summarize_tracklist`, `map_release`, `build_existing_items_index` |
| `tests/test_endpoints.py` | 52 | Every HTTP endpoint against a real `ThreadingHTTPServer` on a random port with temp data files |

## Fixtures (`tests/conftest.py`)

### `patched_server` (function scope)

Monkeypatches all `server.*_PATH` globals to point at a `tmp_path` temp directory. Use this for file I/O tests — no actual files in the project root are touched.

### `live_server` (module scope)

Starts a real `ThreadingHTTPServer` on a random available port with a seeded temp data directory. Yields a dict `{ base_url, port, tmp }`. Use for endpoint integration tests. Module scope means the server starts once per test file, not per test — faster and more realistic.

## Testing philosophy

- No database mocks — file I/O tests use real file operations in temp directories.
- No HTTP mocks in endpoint tests — they hit a real server instance.
- No `unittest.mock` in the standard test suite — isolation comes from `tmp_path` and process scope.
- Tests that need to cover file I/O use `patched_server`; tests that need to cover HTTP behavior use `live_server`.

## Coverage gaps (as of initial wiki)

- Background threads (`_prefetch_worker`, `backfill_missing_tracks`) are not directly tested — they're daemon threads that interact with external APIs.
- Fun fact generation (Gemini/Groq API calls) is not tested — would require mocking external HTTP.
- Desktop UI (`desktop.html`) has no automated frontend tests.

## Related pages

- [[server]] — the functions under test
- [[discogs-integration]] — `test_discogs_scraper.py` target
- [[data-files]] — the stores that file I/O tests exercise
