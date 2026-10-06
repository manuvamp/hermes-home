# Integrations (spec §§D, 22, 43)

Hermes Home never hard-codes individual services. Every integration is one
small adapter that (a) knows how to reach its service, and (b) normalizes the
result into voice-size data.

| Integration | Status | Tools | Config | Safety |
|---|---|---|---|---|
| **Hermes** | built-in | `hermes_ask`, `hermes_start_task`, `hermes_task_status`, `hermes_task_result` | `HERMES_API_URL/KEY` | long work is always async; per-user run ids |
| **Memory** | built-in | `hermes_memory_search`, `hermes_remember` | `HERMES_HOME_MEMORY_PATH` | per-user; `source:'memory'` tagged |
| **Home Assistant** | built-in | `home_get_state`, `home_control` | `HASS_URL`, `HASS_TOKEN` | two-step confirm; sensitive domains double-guard |
| **Calendar** | adapter | `calendar_today`, `calendar_tomorrow`, `calendar_events` | `CALENDAR_ICS_URL` *or* `CALDAV_*` | read-only |
| **GitHub** | adapter | `github_my_issues`, `github_repo_issues` | `GITHUB_TOKEN`, `GITHUB_USER` | read-only (no write actions in MVP) |
| **Messaging** | adapter | `send_message` | `TELEGRAM_*` / `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` | outbound only |
| **Muse** | skeleton | — | SDK required (license-gated) | descriptive metrics only (spec §20) |
| **Generic MCP** | pattern | config-driven | `integrations/generic-mcp/README.md` | the *pattern* every future service follows |

## Adding a new integration

1. `src/state/<name>.ts` — a tiny client for the service with `xxxConfigured()`
2. `src/tools/<name>.ts` — `RegisteredTool[]` with tight, voice-friendly schemas
3. One line in `src/tools/registry.ts`
4. Show it in `/ready` (optional but recommended)
5. Env vars in `.env.example`; a page in `docs/` if it needs ceremony

Keep tool schemas small and answers structured. Alexa+ speaks the result;
it isn't reading a JSON dump.
