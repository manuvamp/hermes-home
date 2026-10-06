# @hermes-home/mcp-server

Public-facing Alexa+ ↔ Hermes bridge. The only component that should ever be exposed to the internet.

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Liveness (no auth). |
| `GET /ready` | Readiness — checks Hermes gateway + Home Assistant reachability. |
| `POST /mcp` | Streamable HTTP MCP endpoint (Alexa+). |
| `GET /tools` | Introspection of the registered tool catalogue. |
| `GET /version` | Build/mode info. |
| `GET /.well-known/oauth-protected-resource` | OAuth discovery (spec §9). |
| `GET /.well-known/oauth-authorization-server` | OAuth discovery. |
| `GET /sse`, `POST /messages` | Return `410` — legacy SSE is not supported. |

## Modes

- **local** (default): loopback-only by DNS-rebind guard on Host/Origin; optional `AUTH_LOCAL_TOKEN`.
- **oauth2**: production Alexa+ account-linking. Validate OAuth 2.1 + PKCE (S256) bearer tokens; set `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URI`, `PUBLIC_BASE_URL`.

## Tool boundaries

Only these tools are exposed to Alexa+ (spec §10). Nothing else from Hermes is reachable through MCP:

- `hermes_ask` — quick, synchronous answers (bounded timeout).
- `hermes_start_task` — long async run; returns `runId` immediately.
- `hermes_task_status` / `hermes_task_result` — owner-checked run lookups.
- `hermes_memory_search` / `hermes_remember` — user-scoped memory.
- `home_get_state` — read-only home state.
- `home_control` — confirmed physical actions only (two-step, rate-limited, sensitive-domain guarded).

## Safety outcomes

- **DNS-rebind**: in local mode, requests must have a localhost Host header and (if any) a localhost Origin — a malicious web page cannot drive your laptop's MCP port.
- **Confirmation window**: `home_control` executes only a pending, unexpired (30 s) action described to the user in the previous call.
- **Rate limit**: actions are rate-limited per user (2 s).
- **No security bypass**: lock/alarm/cover actions still require the explicit out-loud confirmation path — never silent re-execution.

## Failure outcomes

- If the Hermes gateway is unreachable, the server **refuses to start** (`HERMES_REQUIRED=false` only for tests). No demoing against a stub.
- Hermes call failures surface as structured `{ success: false, error }` tool results so Alexa+ can speak them naturally.
- A forgetting user (`runId` from another user) gets `Unknown or inaccessible runId` — cross-user reads are impossible.

## Next-slice dashboard stub

`apps/dashboard` is deliberately minimal this slice. The debugging surface you actually have today:

```powershell
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
curl http://127.0.0.1:3000/tools
```

which answer, in order: "is it up?", "can it reach Hermes/HA?", "what is Alexa+ allowed to do?"
