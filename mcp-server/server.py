"""
Listening Party — Wiki MCP Server

Exposes tools for searching, reading, writing, and maintaining the wiki
at /project/wiki. Mount the project root at /project in the container.
"""

from __future__ import annotations

import os
import re
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastmcp import FastMCP

# ── Paths ─────────────────────────────────────────────────────────────────────

PROJECT_DIR = Path(os.environ.get("PROJECT_DIR", "/project"))
WIKI_DIR    = Path(os.environ.get("WIKI_DIR", PROJECT_DIR / "wiki"))
PAGES_DIR   = WIKI_DIR / "pages"
RAW_DIR     = WIKI_DIR / "raw"
INDEX_PATH  = WIKI_DIR / "index.md"
LOG_PATH    = WIKI_DIR / "log.md"

# Source files allowed for `read_source_file` (relative to PROJECT_DIR)
_SOURCE_EXTENSIONS = {".py", ".js", ".html", ".json", ".md", ".txt", ".ps1", ".sh", ".yaml", ".yml", ".toml", ".cfg"}

mcp = FastMCP("listening-party-wiki", instructions=(
    "Tools for maintaining the Listening Party wiki. "
    "Use search_wiki to find relevant pages before answering questions. "
    "Use read_page / write_page to read and update wiki content. "
    "Use regenerate_index after bulk changes. Use lint_wiki periodically."
))


# ── Frontmatter helpers ────────────────────────────────────────────────────────

_FM_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_without_frontmatter)."""
    m = _FM_PATTERN.match(text)
    if not m:
        return {}, text
    raw = m.group(1)
    body = text[m.end():]
    fm: dict = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        # Parse simple lists: [a, b, c]
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1]
            fm[key] = [v.strip() for v in inner.split(",") if v.strip()]
        else:
            fm[key] = val
    return fm, body


def _first_sentence(text: str) -> str:
    """Extract first meaningful sentence from markdown body."""
    # Strip headings
    lines = [l for l in text.strip().splitlines() if l.strip() and not l.startswith("#")]
    if not lines:
        return ""
    first = lines[0].strip()
    # Cut at first period, question mark or exclamation
    m = re.search(r"[.!?]", first)
    if m:
        return first[:m.end()].strip()
    return first[:120].strip()


def _wiki_links_in(text: str) -> set[str]:
    """Return all [[link-target]] references in text."""
    return set(re.findall(r"\[\[([^\]]+)]]", text))


# ── Tool 1: search_wiki ───────────────────────────────────────────────────────

@mcp.tool()
def search_wiki(query: str, max_results: int = 8) -> str:
    """
    Full-text search across all wiki pages.

    Scores pages by:
    - +4 per term found in the page title (frontmatter)
    - +3 per term found in the page tags
    - +1 per occurrence in the body

    Returns ranked results with a short excerpt showing where the match is.
    """
    if not PAGES_DIR.exists():
        return "wiki/pages/ directory not found."

    terms = [t.lower() for t in query.split() if t.strip()]
    if not terms:
        return "Empty query."

    results: list[tuple[float, str, str, str]] = []  # (score, name, title, snippet)

    for path in sorted(PAGES_DIR.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        fm, body = _parse_frontmatter(raw)
        name  = path.stem
        title = fm.get("title", name)
        tags  = " ".join(fm.get("tags", []))
        full  = raw.lower()
        title_l = title.lower()
        tags_l  = tags.lower()
        body_l  = body.lower()

        score = 0.0
        for term in terms:
            score += title_l.count(term) * 4
            score += tags_l.count(term) * 3
            score += body_l.count(term) * 1

        if score == 0:
            continue

        # Build snippet: find first term occurrence in body
        snippet = ""
        for term in terms:
            idx = body_l.find(term)
            if idx != -1:
                start = max(0, idx - 60)
                end   = min(len(body), idx + 120)
                chunk = body[start:end].replace("\n", " ").strip()
                snippet = f"…{chunk}…" if start > 0 else f"{chunk}…"
                break

        results.append((score, name, title, snippet))

    if not results:
        return f"No pages matched '{query}'."

    results.sort(key=lambda r: r[0], reverse=True)
    lines = [f"## Search results for '{query}'\n"]
    for score, name, title, snippet in results[:max_results]:
        lines.append(f"**[[{name}]]** — {title}  (score: {score:.0f})")
        if snippet:
            lines.append(f"> {snippet}")
        lines.append("")

    return "\n".join(lines)


# ── Tool 2: list_pages ────────────────────────────────────────────────────────

@mcp.tool()
def list_pages() -> str:
    """
    List all pages in wiki/pages/ with their title, tags, and last-updated date.
    Use this to get an overview of available wiki content.
    """
    if not PAGES_DIR.exists():
        return "wiki/pages/ directory not found."

    rows: list[tuple[str, str, str, str]] = []
    for path in sorted(PAGES_DIR.glob("*.md")):
        fm, _ = _parse_frontmatter(path.read_text(encoding="utf-8"))
        name    = path.stem
        title   = fm.get("title", name)
        tags    = ", ".join(fm.get("tags", []))
        updated = fm.get("updated", "—")
        rows.append((name, title, tags, updated))

    if not rows:
        return "No pages found."

    lines = [f"{'Page':<45} {'Tags':<40} {'Updated'}"]
    lines.append("-" * 95)
    for name, title, tags, updated in rows:
        lines.append(f"{name:<45} {tags:<40} {updated}")

    return "\n".join(lines)


# ── Tool 3: read_page ─────────────────────────────────────────────────────────

@mcp.tool()
def read_page(page_name: str) -> str:
    """
    Read a wiki page by name (without .md extension).
    Also reads wiki/index.md and wiki/log.md if requested by those names.
    """
    # Allow reading index and log too
    if page_name in ("index", "log", "CLAUDE"):
        target = WIKI_DIR / f"{page_name}.md"
    else:
        target = PAGES_DIR / f"{page_name}.md"

    if not target.exists():
        available = [p.stem for p in PAGES_DIR.glob("*.md")]
        return f"Page '{page_name}' not found.\nAvailable pages: {', '.join(sorted(available))}"

    return target.read_text(encoding="utf-8")


# ── Tool 4: write_page ────────────────────────────────────────────────────────

@mcp.tool()
def write_page(page_name: str, content: str) -> str:
    """
    Write or update a wiki page. The page_name should not include .md.
    Content must include YAML frontmatter (--- title/tags/updated ---).
    The updated date is automatically set to today if not included.
    """
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    target = PAGES_DIR / f"{page_name}.md"

    # Inject today's date into frontmatter if `updated` is missing
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if "updated:" not in content and content.startswith("---"):
        content = re.sub(r"(---\s*\n)", f"\\1updated: {today}\n", content, count=1)
    elif "updated:" not in content:
        # No frontmatter at all — prepend a minimal one
        content = f"---\ntitle: {page_name}\ntags: []\nupdated: {today}\n---\n\n" + content

    existed = target.exists()
    target.write_text(content, encoding="utf-8")
    action = "Updated" if existed else "Created"
    return f"{action} wiki/pages/{page_name}.md ({len(content)} chars)."


# ── Tool 5: delete_page ───────────────────────────────────────────────────────

@mcp.tool()
def delete_page(page_name: str) -> str:
    """
    Delete a wiki page. Also removes it from index.md if present.
    Use with caution — this is irreversible.
    """
    target = PAGES_DIR / f"{page_name}.md"
    if not target.exists():
        return f"Page '{page_name}' does not exist."

    target.unlink()

    # Remove from index.md
    if INDEX_PATH.exists():
        idx = INDEX_PATH.read_text(encoding="utf-8")
        # Remove any line referencing [[page_name]]
        cleaned = "\n".join(
            line for line in idx.splitlines()
            if f"[[{page_name}]]" not in line
        )
        INDEX_PATH.write_text(cleaned, encoding="utf-8")
        return f"Deleted wiki/pages/{page_name}.md and removed from index.md."

    return f"Deleted wiki/pages/{page_name}.md."


# ── Tool 6: regenerate_index ──────────────────────────────────────────────────

_TAG_TO_CATEGORY = {
    "architecture": "Architecture",
    "backend":      "Backend",
    "frontend":     "Frontend",
    "data":         "Data",
    "api":          "API",
    "flow":         "Flows",
    "feature":      "Features",
    "auth":         "Backend",
    "concept":      "Architecture",
    "ai":           "Backend",
    "discogs":      "Backend",
    "testing":      "Reference",
    "reference":    "Reference",
}

_CATEGORY_ORDER = ["Overview", "Architecture", "Backend", "Frontend", "Data", "API", "Flows", "Features", "Reference"]

@mcp.tool()
def regenerate_index() -> str:
    """
    Rebuild wiki/index.md by scanning all pages in wiki/pages/.
    Groups pages by their primary tag, extracts one-line summaries from
    the first sentence of the body. Overwrites the existing index.md.
    Returns the new index content.
    """
    if not PAGES_DIR.exists():
        return "wiki/pages/ directory not found."

    categories: dict[str, list[tuple[str, str]]] = {c: [] for c in _CATEGORY_ORDER}
    categories["Uncategorized"] = []

    for path in sorted(PAGES_DIR.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        fm, body = _parse_frontmatter(raw)
        name    = path.stem
        title   = fm.get("title", name)
        tags    = fm.get("tags", [])
        summary = _first_sentence(body) or title

        # Map first matching tag to a category
        category = "Uncategorized"
        for tag in (tags if isinstance(tags, list) else [tags]):
            cat = _TAG_TO_CATEGORY.get(tag.strip())
            if cat:
                category = cat
                break

        categories.setdefault(category, []).append((name, summary))

    lines = ["# Wiki Index — Listening Party\n",
             "Catalog of all pages. Updated automatically by `regenerate_index`.\n",
             "---\n"]

    for cat in _CATEGORY_ORDER + ["Uncategorized"]:
        pages = categories.get(cat, [])
        if not pages:
            continue
        lines.append(f"## {cat}\n")
        for name, summary in pages:
            # Truncate summary to ~90 chars
            s = summary[:90] + ("…" if len(summary) > 90 else "")
            lines.append(f"- [[{name}]] — {s}")
        lines.append("")

    content = "\n".join(lines)
    INDEX_PATH.write_text(content, encoding="utf-8")
    total = sum(len(v) for v in categories.values())
    return f"Regenerated wiki/index.md — {total} pages across {sum(1 for v in categories.values() if v)} categories.\n\n{content}"


# ── Tool 7: append_log ────────────────────────────────────────────────────────

@mcp.tool()
def append_log(entry_type: str, title: str, details: str = "") -> str:
    """
    Append a structured entry to wiki/log.md.

    entry_type: one of 'ingest', 'update', 'query', 'lint', 'init'
    title: short description of what happened
    details: optional — pages created/updated, sources used, etc.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entry = f"\n## [{today}] {entry_type} | {title}\n"
    if details.strip():
        entry += details.strip() + "\n"

    if not LOG_PATH.exists():
        LOG_PATH.write_text("# Wiki Log\n\nAppend-only.\n" + entry, encoding="utf-8")
    else:
        existing = LOG_PATH.read_text(encoding="utf-8")
        # Insert after the first blank line following the header
        LOG_PATH.write_text(existing.rstrip() + "\n" + entry, encoding="utf-8")

    return f"Appended log entry: [{today}] {entry_type} | {title}"


# ── Tool 8: lint_wiki ─────────────────────────────────────────────────────────

@mcp.tool()
def lint_wiki() -> str:
    """
    Health-check the wiki. Reports:
    - Pages with missing or incomplete frontmatter
    - Broken [[links]] (targets that don't exist as pages)
    - Orphan pages (no inbound links from any other page)
    - Pages missing from index.md
    - Pages in index.md that no longer exist
    """
    if not PAGES_DIR.exists():
        return "wiki/pages/ directory not found."

    pages: dict[str, str] = {}
    for path in PAGES_DIR.glob("*.md"):
        pages[path.stem] = path.read_text(encoding="utf-8")

    index_text = INDEX_PATH.read_text(encoding="utf-8") if INDEX_PATH.exists() else ""

    issues: list[str] = []

    # ── Frontmatter check ─────────────────────────────────────────
    for name, raw in pages.items():
        fm, _ = _parse_frontmatter(raw)
        missing_fields = [f for f in ("title", "tags", "updated") if f not in fm]
        if missing_fields:
            issues.append(f"[frontmatter] `{name}` missing: {', '.join(missing_fields)}")

    # ── Broken links ──────────────────────────────────────────────
    for name, raw in pages.items():
        for target in _wiki_links_in(raw):
            if target not in pages:
                issues.append(f"[broken-link] `{name}` → [[{target}]] (target not found)")

    # ── Orphan pages (no inbound links from other pages or index) ─
    inbound: dict[str, set[str]] = {name: set() for name in pages}
    all_text = index_text + "\n".join(pages.values())
    for target in pages:
        if f"[[{target}]]" in all_text:
            # Count inbound from other pages
            for src_name, src_text in pages.items():
                if src_name != target and f"[[{target}]]" in src_text:
                    inbound[target].add(src_name)
            if f"[[{target}]]" in index_text:
                inbound[target].add("index.md")

    for name in pages:
        if not inbound[name]:
            issues.append(f"[orphan] `{name}` has no inbound links from any page or index.md")

    # ── Pages not in index.md ─────────────────────────────────────
    for name in pages:
        if f"[[{name}]]" not in index_text:
            issues.append(f"[missing-from-index] `{name}` not listed in index.md")

    # ── Index references non-existent pages ──────────────────────
    for target in _wiki_links_in(index_text):
        if target not in pages:
            issues.append(f"[stale-index] index.md references [[{target}]] but page doesn't exist")

    if not issues:
        return f"Wiki is healthy. {len(pages)} pages checked, no issues found."

    summary = f"{len(issues)} issue(s) found across {len(pages)} pages:\n\n"
    return summary + "\n".join(f"- {i}" for i in sorted(issues))


# ── Tool 9: read_source_file ──────────────────────────────────────────────────

@mcp.tool()
def read_source_file(relative_path: str) -> str:
    """
    Read any source file in the project (relative to the project root).
    Useful for researching code before updating wiki pages.
    Only text files with known extensions are allowed.

    Examples: 'server.py', 'app.js', 'wiki/CLAUDE.md', 'tests/conftest.py'
    """
    # Sanitize: no path traversal outside project
    target = (PROJECT_DIR / relative_path).resolve()
    try:
        target.relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: '{relative_path}' is outside the project directory."

    if not target.exists():
        return f"File not found: {relative_path}"

    if target.is_dir():
        files = [str(p.relative_to(PROJECT_DIR)) for p in sorted(target.iterdir()) if p.is_file()]
        return f"'{relative_path}' is a directory. Contents:\n" + "\n".join(files)

    if target.suffix.lower() not in _SOURCE_EXTENSIONS:
        return f"File type '{target.suffix}' is not allowed. Permitted: {', '.join(sorted(_SOURCE_EXTENSIONS))}"

    content = target.read_text(encoding="utf-8", errors="replace")
    # Cap at 8000 chars to avoid flooding context
    if len(content) > 8000:
        return content[:8000] + f"\n\n… [truncated — {len(content)} total chars. Use offset parameter or read a specific section.]"
    return content


# ── Tool 10: read_source_file_range ──────────────────────────────────────────

@mcp.tool()
def read_source_file_range(relative_path: str, start_line: int, end_line: int) -> str:
    """
    Read a specific line range from a source file (1-indexed, inclusive).
    Use this when read_source_file returns a truncated file.
    """
    target = (PROJECT_DIR / relative_path).resolve()
    try:
        target.relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied."

    if not target.exists():
        return f"File not found: {relative_path}"

    if target.suffix.lower() not in _SOURCE_EXTENSIONS:
        return f"File type '{target.suffix}' not allowed."

    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    total = len(lines)
    s = max(1, start_line) - 1
    e = min(total, end_line)
    selected = lines[s:e]

    header = f"// {relative_path} lines {s+1}–{e} of {total}\n"
    return header + "\n".join(f"{s+1+i:>4}  {line}" for i, line in enumerate(selected))


# ── Tool 11: list_source_files ────────────────────────────────────────────────

@mcp.tool()
def list_source_files(directory: str = ".", pattern: str = "*") -> str:
    """
    List files in the project matching a glob pattern.
    directory: relative path from project root (default: project root)
    pattern: glob pattern like '*.py' or '**/*.md'
    """
    base = (PROJECT_DIR / directory).resolve()
    try:
        base.relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return "Access denied."

    if not base.exists():
        return f"Directory not found: {directory}"

    files = sorted(base.glob(pattern))
    if not files:
        return f"No files matched '{pattern}' in '{directory}'."

    lines = []
    for f in files:
        rel = f.relative_to(PROJECT_DIR)
        size = f.stat().st_size if f.is_file() else 0
        kind = "dir" if f.is_dir() else f"{size:,} bytes"
        lines.append(f"{str(rel):<60} {kind}")

    return f"{'Path':<60} Size\n" + "-" * 75 + "\n" + "\n".join(lines)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("MCP_PORT", 8080))
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    mcp.run(transport="sse", host=host, port=port)
