# Architecture

```
                        ┌──────────────┐
                        │     USER     │
                        └──────┬───────┘
                               ▼
                    ┌────────────────────┐
                    │      ALEXA+        │
                    │  voice + display   │
                    └─────────┬──────────┘
                              │ Streamable HTTP MCP (public, OAuth 2.1+PKCE in prod)
                              ▼
                ┌───────────────────────────┐
                │   HERMES HOME MCP SERVER  │   ← the ONLY public component
                │  (this repo, apps/mcp-*)  │
                └────────────┬──────────────┘
                             │
             ┌───────────────┼────────────────┐
             ▼               ▼                ▼
        Fast tools     Hermes HTTP API    Local state
        (home, memory) (127.0.0.1:8642)   (memory, run registry)
                             │
                             ▼
                    ┌────────────────┐
                    │  HERMES AGENT  │  memory · browser · subagents · MCP
                    └───────┬────────┘
                            ▼
              Home · Calendar · GitHub · Messages · Muse …
```

## Key decisions

1. **No blocking Alexa+ calls**: Alexa+ targets <500 ms round-trips. Anything long
   goes through `hermes_start_task` → Hermes `/v1/runs` → runId returns in ~50 ms.
   Status/results are polled later (spec §36).
2. **The public surface is exactly one port**: Hermes, Home Assistant and the
   memory store are all bound to localhost (spec §38). Only the authenticated
   MCP endpoint is tunneled.
3. **Fail-closed substrate**: if the Hermes gateway is unreachable the server
   refuses to start — there is no silent fallback to a canned-stub demo.
4. **Local mode is loopback-only**: the DNS-rebind guard refuses foreign
   Host/Origin headers in dev (`mcp/transport.ts`).
5. **Run ownership**: `state/runs.ts` binds every `runId` to the creating
   `userId`; status/result calls from another user return
   "Unknown or inaccessible runId".

## Two runtime tracks

| Track | Status | Meaning |
|---|---|---|
| **Bridge (MVP)** | implemented | Tool handlers run in this server and call Hermes' HTTP API. |
| **Registry-remote** | stub (`hermes/registrations.ts`) | The catalog is exported as `tool-config.json` so Hermes can consume Hermes Home *as an MCP server* — the structural near-term "registry-remote" architecture. |
