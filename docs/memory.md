# Personal memory

Memory is stored per-user in `data/memory.json` (configurable via
`HERMES_HOME_MEMORY_PATH`) — a deliberate, honest, hackathon-scale design:

- **Entries are never inferred** — only stored verbatim when the user asks
  ("remember that…" → `hermes_remember`), or by a future explicit adapter.
- **Search results always carry `source: 'memory'` + `recordedAt`** so Alexa+
  speech (and any UI) can distinguish *retrieved* memories from fresh
  inference (spec §24). The demo script must keep that phrasing audible:
  "you told me on Tuesday that…" — not "you want…".
- **Per-user isolation**: the file is keyed by `userId`; search/list only ever
  reads one user's slice (spec §39).
- **No invented memories on miss**: when nothing matches, the tool returns
  `found: 0` and Alexa+ must say it doesn't have that recorded — never fill
  the gap with LLM confabulation.

## Upgrade path

Swap `state/memory.ts`'s three functions for:

1. **Hermes native memory** (preferred once its memory search API is used
   directly), or
2. an embedded vector store (sqlite-vec / LanceDB) for semantic recall.

The tool contract (`hermes_memory_search` / `hermes_remember`) stays stable.
