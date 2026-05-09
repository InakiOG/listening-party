"""
Audio detection for Listening Party.
Listens to the microphone, recognizes the song via Shazam, and matches it to the
local Discogs collection so the server can auto-set now-playing.

Dependencies (install once):
    pip install sounddevice numpy shazamio
"""
import asyncio
import io
import re
import time
import wave
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SAMPLE_RATE = 44100
RECORD_SECONDS = 12
RETRY_DELAY_NO_MATCH = 20    # seconds to wait after no Shazam match
RETRY_DELAY_SAME_SONG = 90   # cooldown before re-detecting the same song


# ── string helpers ────────────────────────────────────────────────────────────

def _strip_duration(track: str) -> str:
    """Remove trailing ' - 3:45' or ' – 3:45' from a track string."""
    return re.sub(r"\s*[-–]\s*\d+:\d+\s*$", "", track).strip()


def _normalize(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    return re.sub(r"[^\w\s]", "", str(s).lower()).strip()


def _word_overlap(a: str, b: str) -> int:
    return len(set(_normalize(a).split()) & set(_normalize(b).split()))


# ── collection matching ───────────────────────────────────────────────────────

def match_to_collection(
    detected_title: str,
    detected_artist: str,
    items: list,
) -> Optional[tuple]:
    """
    Find the best match for (detected_title, detected_artist) inside the
    Discogs collection item list.

    Returns (album_item, track_index, clean_track_name) or None.
    track_index == 0 means it is the first track → reviewScope = "album".
    """
    norm_title = _normalize(detected_title)
    best: Optional[tuple] = None
    best_score = 0

    for item in items:
        artist_overlap = _word_overlap(str(item.get("artist", "")), detected_artist)
        if artist_overlap == 0:
            continue

        for i, track_raw in enumerate(item.get("tracks", [])):
            track_name = _strip_duration(str(track_raw))
            norm_track = _normalize(track_name)
            if not norm_track:
                continue

            if norm_title == norm_track:
                score = artist_overlap * 10 + 10
            elif norm_title in norm_track or norm_track in norm_title:
                score = artist_overlap * 10 + 5
            else:
                continue

            if score > best_score:
                best_score = score
                best = (item, i, track_name)

    return best


# ── Shazam recognition ────────────────────────────────────────────────────────

async def _shazam_recognize(wav_bytes: bytes) -> Optional[dict]:
    import warnings
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=RuntimeWarning, module="pydub")
        from shazamio import Shazam  # type: ignore
    result = await Shazam().recognize(wav_bytes)
    track = result.get("track")
    if not track:
        return None
    return {
        "title": str(track.get("title", "")).strip(),
        "artist": str(track.get("subtitle", "")).strip(),
    }


def record_and_recognize() -> Optional[dict]:
    """
    Record RECORD_SECONDS of audio from the default microphone and recognize
    it via Shazam.  Returns {"title": ..., "artist": ...} or None.
    Raises ImportError if sounddevice / numpy / shazamio are not installed.
    """
    import sounddevice as sd  # type: ignore
    import numpy  # noqa: F401 — sounddevice requires numpy at runtime

    audio = sd.rec(
        int(RECORD_SECONDS * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
    )
    sd.wait()

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())

    return asyncio.run(_shazam_recognize(buf.getvalue()))


def check_dependencies() -> bool:
    """Return True if all required packages are importable."""
    try:
        import sounddevice  # noqa: F401
        import numpy       # noqa: F401
        import shazamio    # noqa: F401
        return True
    except ImportError:
        return False


# ── detection loop ────────────────────────────────────────────────────────────

def run_detection_loop(stop_event, on_detection, get_collection_items):
    """
    Background detection loop.  Runs until stop_event is set.

    stop_event        – threading.Event; set it to stop the loop.
    on_detection      – callable(album, track_index, track_name, raw)
                        called each time a new song is matched.
    get_collection_items – callable() → list of album dicts from the collection.
    """
    last_key = None
    last_time = 0.0

    while not stop_event.is_set():
        try:
            result = record_and_recognize()
        except Exception as exc:
            logger.warning("record_and_recognize error: %s", exc)
            stop_event.wait(RETRY_DELAY_NO_MATCH)
            continue

        if not result or not result.get("title"):
            stop_event.wait(RETRY_DELAY_NO_MATCH)
            continue

        key = f"{result['title']}::{result['artist']}".lower()
        now = time.time()

        # Cooldown: don't fire the same song twice within RETRY_DELAY_SAME_SONG
        if key == last_key and (now - last_time) < RETRY_DELAY_SAME_SONG:
            remaining = RETRY_DELAY_SAME_SONG - (now - last_time)
            stop_event.wait(remaining)
            continue

        items = get_collection_items()
        match = match_to_collection(result["title"], result["artist"], items)

        if not match:
            logger.info(
                "Shazam found '%s' by '%s' — not in collection",
                result["title"],
                result["artist"],
            )
            stop_event.wait(RETRY_DELAY_NO_MATCH)
            continue

        album, track_index, track_name = match
        last_key = key
        last_time = now

        try:
            on_detection(
                album=album,
                track_index=track_index,
                track_name=track_name,
                raw=result,
            )
        except Exception as exc:
            logger.error("on_detection callback raised: %s", exc)

        # Wait before the next recognition cycle
        stop_event.wait(RETRY_DELAY_SAME_SONG)
