# muse — optional adapter (not MVP)

Muse is **not** automatically compatible with Hermes — an adapter is needed
(spec §20). It is intentionally excluded from the MVP: hackathons count as
non-commercial use of the Muse SDK, but confirm the current licence before
applying for SDK access (spec §21).

Planned flow (when SDK access lands):

```
Muse Headband ──BLE──▶ Muse SDK ─▶ companion app ─▶ muse adapter ─▶ MCP ─▶ Hermes
```

Normalized tools:

- `muse_connection_status`
- `muse_latest_metrics` — descriptive metrics only (`attention`, `calm`, `motion`, `timestamp`)
- `muse_session_summary` — stored session summaries ("compare my last two sessions")

**Do not** draw medical or cognitive conclusions from EEG data (spec §20, §44).
