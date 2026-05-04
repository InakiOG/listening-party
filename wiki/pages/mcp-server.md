---
title: MCP Server (Wiki Tools)
tags: [reference, architecture]
updated: 2026-05-03
---

# MCP Server (Wiki Tools)

A Docker-containerised MCP server that exposes wiki maintenance tools to Claude. Defined in `mcp-server/` and connected via `.claude/settings.json`.

## Starting the server

```bash
# Build and start (first time or after changes to server.py)
docker compose up --build -d

# Subsequent starts
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f wiki-mcp
```

The server binds to `http://localhost:8080`. The SSE endpoint Claude connects to is `http://localhost:8080/sse`.

## Connection config (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "wiki": {
      "transport": "sse",
      "url": "http://localhost:8080/sse"
    }
  }
}
```

Claude Code picks this up automatically when opened in the project directory.

## Available tools

| Tool | Description |
|------|-------------|
| `search_wiki(query, max_results?)` | Ranked full-text search across all wiki pages. Scores: title (+4/term), tags (+3/term), body (+1/occurrence). Returns excerpts. |
| `list_pages()` | All pages with title, tags, and last-updated date as a table. |
| `read_page(page_name)` | Read a wiki page by name (no `.md`). Also reads `index`, `log`, `CLAUDE`. |
| `write_page(page_name, content)` | Write or overwrite a page. Auto-inserts `updated` date if missing. |
| `delete_page(page_name)` | Delete a page and remove it from `index.md`. |
| `regenerate_index()` | Rebuild `wiki/index.md` by scanning all page frontmatter and extracting first sentences. Groups by tag category. |
| `append_log(entry_type, title, details?)` | Append a structured entry to `wiki/log.md`. Types: `ingest`, `update`, `query`, `lint`, `init`. |
| `lint_wiki()` | Health check: broken `[[links]]`, orphan pages, missing frontmatter fields, pages absent from index. |
| `read_source_file(relative_path)` | Read any project source file (capped at 8000 chars). For researching code before updating wiki. |
| `read_source_file_range(path, start, end)` | Read a specific line range from a source file (1-indexed). Use when `read_source_file` truncates. |
| `list_source_files(directory?, pattern?)` | List project files matching a glob. |

## Volume mount

The container mounts the project root (`.`) to `/project` with read-write access. All wiki file operations work directly on the host filesystem — no sync needed.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_DIR` | `/project` | Project root inside container |
| `WIKI_DIR` | `/project/wiki` | Wiki root |
| `MCP_HOST` | `0.0.0.0` | Bind address |
| `MCP_PORT` | `8080` | Port |

## Architecture

```
Claude Code (host)
      │  SSE  (http://localhost:8080/sse)
      ▼
Docker container: wiki-mcp
  server.py (FastMCP)
      │  read/write
      ▼
/project  (bind-mounted from host)
  wiki/pages/*.md
  wiki/index.md
  wiki/log.md
  server.py, app.js, ...
```

## Files

```
mcp-server/
├── server.py        ← FastMCP server with all tools
├── requirements.txt ← fastmcp>=2.0.0
└── Dockerfile

docker-compose.yml   ← project root
.claude/settings.json ← MCP connection config
```

## Related pages

- [[CLAUDE]] (wiki/CLAUDE.md) — wiki schema and workflows
- [[overview]] — project overview
