"""Unit tests for pure functions in discogs_scraper.py."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import discogs_scraper


# ---------------------------------------------------------------------------
# _normalize_release_id
# ---------------------------------------------------------------------------

class TestNormalizeReleaseId:
    def test_int_becomes_string(self):
        assert discogs_scraper._normalize_release_id(12345) == "12345"

    def test_string_passthrough(self):
        assert discogs_scraper._normalize_release_id("99") == "99"

    def test_none_returns_empty(self):
        assert discogs_scraper._normalize_release_id(None) == ""

    def test_empty_string_returns_empty(self):
        assert discogs_scraper._normalize_release_id("") == ""

    def test_strips_whitespace(self):
        assert discogs_scraper._normalize_release_id("  42  ") == "42"


# ---------------------------------------------------------------------------
# summarize_artists
# ---------------------------------------------------------------------------

class TestSummarizeArtists:
    def test_single_artist(self):
        assert discogs_scraper.summarize_artists([{"name": "The Beatles"}]) == "The Beatles"

    def test_multiple_artists(self):
        result = discogs_scraper.summarize_artists([{"name": "Art"}, {"name": "Boz"}])
        assert result == "Art, Boz"

    def test_empty_list_returns_unknown(self):
        assert discogs_scraper.summarize_artists([]) == "Unknown artist"

    def test_none_returns_unknown(self):
        assert discogs_scraper.summarize_artists(None) == "Unknown artist"

    def test_strips_whitespace(self):
        result = discogs_scraper.summarize_artists([{"name": "  The Beatles  "}])
        assert result == "The Beatles"

    def test_skips_empty_names(self):
        result = discogs_scraper.summarize_artists([{"name": ""}, {"name": "Valid"}])
        assert result == "Valid"

    def test_all_empty_names_returns_unknown(self):
        assert discogs_scraper.summarize_artists([{"name": ""}]) == "Unknown artist"


# ---------------------------------------------------------------------------
# summarize_formats
# ---------------------------------------------------------------------------

class TestSummarizeFormats:
    def test_single_format_name_only(self):
        assert discogs_scraper.summarize_formats([{"name": "Vinyl"}]) == "Vinyl"

    def test_format_with_qty_above_one(self):
        result = discogs_scraper.summarize_formats([{"name": "Vinyl", "qty": "2"}])
        assert result == "Vinyl (x2)"

    def test_format_with_qty_one_no_prefix(self):
        result = discogs_scraper.summarize_formats([{"name": "Vinyl", "qty": "1"}])
        assert result == "Vinyl"

    def test_format_with_text(self):
        result = discogs_scraper.summarize_formats([{"name": "Vinyl", "text": "Red Transparent"}])
        assert result == "Vinyl (Red Transparent)"

    def test_format_with_qty_and_text(self):
        result = discogs_scraper.summarize_formats([{"name": "Vinyl", "qty": "2", "text": "Red"}])
        assert result == "Vinyl (x2, Red)"

    def test_multiple_formats_joined_by_semicolon(self):
        result = discogs_scraper.summarize_formats([{"name": "Vinyl"}, {"name": "CD"}])
        assert result == "Vinyl; CD"

    def test_empty_list_returns_empty(self):
        assert discogs_scraper.summarize_formats([]) == ""

    def test_none_returns_empty(self):
        assert discogs_scraper.summarize_formats(None) == ""

    def test_skips_entries_with_empty_name(self):
        result = discogs_scraper.summarize_formats([{"name": ""}, {"name": "CD"}])
        assert result == "CD"


# ---------------------------------------------------------------------------
# summarize_genres
# ---------------------------------------------------------------------------

class TestSummarizeGenres:
    def test_genres_and_styles_combined(self):
        result = discogs_scraper.summarize_genres(["Rock"], ["Alternative"])
        assert result == "Rock, Alternative"

    def test_empty_both(self):
        assert discogs_scraper.summarize_genres([], []) == ""

    def test_none_both(self):
        assert discogs_scraper.summarize_genres(None, None) == ""

    def test_only_genres(self):
        assert discogs_scraper.summarize_genres(["Rock", "Pop"], []) == "Rock, Pop"

    def test_only_styles(self):
        assert discogs_scraper.summarize_genres([], ["Indie"]) == "Indie"

    def test_strips_whitespace(self):
        result = discogs_scraper.summarize_genres(["  Rock  "], [])
        assert result == "Rock"

    def test_skips_empty_values(self):
        result = discogs_scraper.summarize_genres(["", "Rock"], [])
        assert result == "Rock"


# ---------------------------------------------------------------------------
# summarize_tracklist
# ---------------------------------------------------------------------------

class TestSummarizeTracklist:
    def test_basic_track_titles(self):
        tracklist = [{"title": "Song 1"}, {"title": "Song 2"}]
        assert discogs_scraper.summarize_tracklist(tracklist) == ["Song 1", "Song 2"]

    def test_track_with_duration(self):
        tracklist = [{"title": "Song 1", "duration": "3:45"}]
        assert discogs_scraper.summarize_tracklist(tracklist) == ["Song 1 - 3:45"]

    def test_track_without_duration(self):
        tracklist = [{"title": "Song 1", "duration": ""}]
        assert discogs_scraper.summarize_tracklist(tracklist) == ["Song 1"]

    def test_empty_tracklist(self):
        assert discogs_scraper.summarize_tracklist([]) == []

    def test_none_returns_empty(self):
        assert discogs_scraper.summarize_tracklist(None) == []

    def test_skips_empty_titles(self):
        tracklist = [{"title": ""}, {"title": "Valid Track"}]
        assert discogs_scraper.summarize_tracklist(tracklist) == ["Valid Track"]

    def test_skips_non_dict_entries(self):
        tracklist = ["not a dict", {"title": "Valid"}]
        assert discogs_scraper.summarize_tracklist(tracklist) == ["Valid"]


# ---------------------------------------------------------------------------
# map_release
# ---------------------------------------------------------------------------

class TestMapRelease:
    def _basic_release(self, **overrides):
        base = {
            "id": 12345,
            "instance_id": 67890,
            "date_added": "2023-01-01T00:00:00-07:00",
            "rating": 4,
            "basic_information": {
                "title": "Abbey Road",
                "artists": [{"name": "The Beatles", "id": 100}],
                "year": 1969,
                "cover_image": "https://example.com/cover.jpg",
                "formats": [{"name": "Vinyl"}],
                "genres": ["Rock"],
                "styles": ["Classic Rock"],
            },
        }
        base.update(overrides)
        return base

    def test_maps_title(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["title"] == "Abbey Road"

    def test_maps_artist(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["artist"] == "The Beatles"

    def test_maps_year(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["year"] == 1969

    def test_maps_discogs_id(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["discogsId"] == 12345

    def test_initial_times_played_zero(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["timesPlayed"] == 0

    def test_release_url_format(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert "discogs.com/release/12345" in result["releaseUrl"]

    def test_artist_url_format(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert "discogs.com/artist/100" in result["artistUrl"]

    def test_empty_title_uses_default(self):
        release = self._basic_release()
        release["basic_information"]["title"] = ""
        result = discogs_scraper.map_release(release, 1)
        assert result["title"] == "Untitled release"

    def test_invalid_year_becomes_none(self):
        release = self._basic_release()
        release["basic_information"]["year"] = 0
        result = discogs_scraper.map_release(release, 1)
        assert result["year"] is None

    def test_negative_year_becomes_none(self):
        release = self._basic_release()
        release["basic_information"]["year"] = -100
        result = discogs_scraper.map_release(release, 1)
        assert result["year"] is None

    def test_cover_image_used(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["imageUrl"] == "https://example.com/cover.jpg"

    def test_thumb_used_when_no_cover(self):
        release = self._basic_release()
        release["basic_information"]["cover_image"] = ""
        release["basic_information"]["thumb"] = "https://thumb.url"
        result = discogs_scraper.map_release(release, 1)
        assert result["imageUrl"] == "https://thumb.url"

    def test_image_alt_text(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert result["imageAlt"] == "Abbey Road cover"

    def test_source_page_stored(self):
        result = discogs_scraper.map_release(self._basic_release(), 3)
        assert result["sourcePage"] == 3

    def test_raw_text_includes_format_and_genre(self):
        result = discogs_scraper.map_release(self._basic_release(), 1)
        assert "Vinyl" in result["rawText"]
        assert "Rock" in result["rawText"]

    def test_no_artists_gives_unknown(self):
        release = self._basic_release()
        release["basic_information"]["artists"] = []
        result = discogs_scraper.map_release(release, 1)
        assert result["artist"] == "Unknown artist"
        assert result["artistUrl"] == ""


# ---------------------------------------------------------------------------
# build_existing_items_index
# ---------------------------------------------------------------------------

class TestBuildExistingItemsIndex:
    def test_indexes_by_string_release_id(self):
        payload = {
            "items": [
                {"discogsId": 123, "title": "Album 1"},
                {"discogsId": 456, "title": "Album 2"},
            ]
        }
        index = discogs_scraper.build_existing_items_index(payload)
        assert "123" in index
        assert index["123"]["title"] == "Album 1"
        assert "456" in index

    def test_empty_items_returns_empty(self):
        assert discogs_scraper.build_existing_items_index({"items": []}) == {}

    def test_non_dict_payload_returns_empty(self):
        assert discogs_scraper.build_existing_items_index(None) == {}
        assert discogs_scraper.build_existing_items_index([]) == {}

    def test_missing_items_key_returns_empty(self):
        assert discogs_scraper.build_existing_items_index({}) == {}

    def test_items_without_discogs_id_skipped(self):
        payload = {"items": [{"title": "No ID"}, {"discogsId": 123, "title": "Has ID"}]}
        index = discogs_scraper.build_existing_items_index(payload)
        assert len(index) == 1
        assert "123" in index

    def test_non_dict_items_skipped(self):
        payload = {"items": ["not a dict", {"discogsId": 99, "title": "Valid"}]}
        index = discogs_scraper.build_existing_items_index(payload)
        assert "99" in index
        assert len(index) == 1
