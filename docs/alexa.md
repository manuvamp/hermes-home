# Alexa+ integration notes (spec §§8, 40, 48–50)

Alexa+ talks to Hermes Home as a **remote MCP server over Streamable HTTP**
at `POST /mcp`. Nothing else is required on the Amazon side beyond add-on
configuration; there is no custom intent model — Alexa+ decides when Hermes
Home's tools apply from their descriptions.

## Dev loop (spec §40)

1. `hermes gateway` (API server on :8642)
2. `npm run dev:mcp` (this server on :3000)
3. `cloudflared tunnel --url http://localhost:3000` → note the `https://*.trycloudflare.com` URL
4. Set `PUBLIC_BASE_URL=https://<tunnel>` and `AUTH_MODE=oauth2` when onboarding to Alexa+.
5. Validate `POST /mcp` in MCP Inspector **before** touching the Alexa+ simulator (spec §41).

## Demo script (2 minutes — spec §48)

1. "Alexa, what's on my plate today?" → `hermes_ask` + memory
2. "Turn on my office." → `home_control` (with out-loud confirmation)
3. "Ask Hermes to figure out what I need to prepare for my meeting tomorrow." →
   `hermes_start_task` → immediate "I've asked Hermes…"
4. Cut to the dashboard — run state visible.
5. "Is Hermes done?" / "What did it find?" → `hermes_task_status` + `hermes_task_result`
6. Closing card: **Your voice on the front. Your agent underneath.**

## Onboarding checklist

- [ ] MCP server reachable at a fixed HTTPS URL
- [ ] Discovery documents resolve (`/.well-known/*`)
- [ ] OAuth authorize+token flow completes with S256 challenge
- [ ] `tools/list` over `/mcp` passes in under 500 ms
- [ ] Physical device test before submission (spec §41, test 12)
