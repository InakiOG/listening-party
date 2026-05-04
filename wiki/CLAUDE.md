# Listening Party — Wiki Schema

This file is the operating manual for the LLM that maintains this wiki. Read it at the start of every session before touching any wiki file.

---

## What this wiki is

A persistent, LLM-maintained knowledge base about the **listening-party** codebase. It sits between you and the raw source code. Every page you write should make future answers faster and richer — not just summarize what the code says, but synthesize *why* it works the way it does, what the trade-offs are, and how pieces connect.

You (the LLM) own `wiki/pages/` entirely. You create pages, update them, add cross-links, and keep them consistent. The human reads and sources; you write and maintain.

---

## Directory layout

```
wiki/
├── CLAUDE.md           ← this file — the schema
├── index.md            ← catalog of all pages (update on every change)
├── log.md              ← append-only chronological log
├── raw/                ← immutable source documents (human drops files here)
│   └── assets/         ← images referenced by sources
└── pages/              ← LLM-maintained wiki pages
    ├── overview.md
    ├── architecture.md
    └── ...
```

**Raw sources are immutable.** Never edit files under `wiki/raw/`. Read them, extract knowledge, integrate it into `wiki/pages/`.

---

## Page conventions

### Frontmatter (required on every page)

```yaml
---
title: Human-readable title
tags: [tag1, tag2]          # from the tag vocabulary below
sources: [filename.md]      # raw source files this page draws from (omit if derived from code)
updated: YYYY-MM-DD
---
```

### Tag vocabulary

| Tag | Use for |
|-----|---------|
| `architecture` | System design, layers, how components relate |
| `backend` | server.py, Python logic |
| `frontend` | app.js, index.html, desktop.html |
| `data` | JSON file schemas, storage layout |
| `api` | HTTP endpoints, request/response shapes |
| `auth` | Sessions, cookies, credentials |
| `ai` | Fun facts, LLM providers, prompts |
| `discogs` | Discogs API, scraper, collection |
| `testing` | Test suite, fixtures, coverage |
| `concept` | Cross-cutting ideas, design decisions |
| `flow` | End-to-end walkthroughs of a feature |
| `reference` | Tables, lists, quick lookup material |

### Cross-linking

Use `[[page-name]]` style wiki links within pages. When you reference a concept that has (or should have) its own page, link to it. If the target page doesn't exist yet, create it or note it as a gap.

### Page length

- Overview/architecture pages: 200–600 words
- Entity pages (a module, a data file): 150–400 words
- Flow pages: 300–800 words (include step-by-step sequences)
- Reference pages: as long as needed, prefer tables

---

## Operations

### Ingest (new source added to `wiki/raw/`)

1. Read the source file.
2. Discuss key takeaways with the human if they're present.
3. Create or update the most relevant pages in `wiki/pages/`.
4. Update `wiki/index.md` with any new pages.
5. Append an entry to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | Source Title
   Pages created: ..., Pages updated: ...
   ```

### Code change (the codebase changes)

When the human reports a change or you observe one:
1. Identify which wiki pages are affected.
2. Update them to reflect the new reality.
3. Check cross-references — does anything else link to changed content?
4. Append to log:
   ```
   ## [YYYY-MM-DD] update | What changed
   Pages updated: ...
   ```

### Query (human asks a question)

1. Read `wiki/index.md` to identify relevant pages.
2. Read those pages.
3. Synthesize an answer with page citations (`[[page-name]]`).
4. If the answer reveals a synthesis worth keeping, file it as a new page or section.
5. Append to log:
   ```
   ## [YYYY-MM-DD] query | Question summary
   Answer filed as: ... (or "not filed")
   ```

### Lint (health check)

Check for:
- Pages with broken `[[links]]` — target doesn't exist.
- Orphan pages — no inbound links from any other page.
- Stale claims — code has changed but page hasn't.
- Missing pages — important concepts mentioned inline but never given a page.
- Frontmatter gaps — missing `tags`, `updated`, or `title`.
- Index gaps — pages exist but aren't listed in `index.md`.

Report findings; ask the human which gaps to fill.

---

## index.md format

Group pages by category. Each entry: `- [[page-name]] — one-line summary`.

Categories: Overview, Architecture, Backend, Frontend, Data, API, Flows, Reference.

---

## log.md format

Append-only. Each entry starts with `## [YYYY-MM-DD] <type> | <title>`. Types: `ingest`, `update`, `query`, `lint`, `init`.

---

## Domain notes (listening-party specific)

- **Admin** = the `iñaki` / `administrador` account. All party-lifecycle actions are admin-only.
- **Party session** = the in-memory `_current_session` object active from first now-playing to `finish`.
- **Song key** = the string that identifies a reviewable item: `"Album::Song"` (song) or `"album::Artist::Album"` (album-level).
- **Discogs collection** = the cached vinyl library in `discogs-collection.json`, built by `discogs_scraper.py`.
- **Live albums** = albums added ad-hoc during a party, not in the collection.
- The app targets **local network only** — security trade-offs are intentional (plaintext passwords, no HTTPS, no CSRF).
