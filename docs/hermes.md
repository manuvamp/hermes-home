# Hermes setup (spec §§6–7, 34)

Hermes Home needs a **reachable Hermes HTTP gateway** — local, VM, or cloud.
The server refuses to start without it (`HERMES_REQUIRED=false` is for tests only).

## Install & verify

```powershell
# install per the official Hermes docs, then:
hermes --version
hermes chat --oneshot -q "Respond with the word READY"
```

## Run the gateway

```
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me
hermes gateway
```

Verify:

```powershell
curl http://127.0.0.1:8642/health
curl http://127.0.0.1:8642/v1/models
```

Point the MCP server at it:

```
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=change-me
```

**Never** expose :8642 publicly (spec §38).

## Endpoints used

| Endpoint | Used by |
|---|---|
| `POST /v1/chat/completions` | `hermes_ask` (bounded timeout) |
| `POST /v1/runs` | `hermes_start_task` (returns runId immediately) |
| `GET /v1/runs/{id}` | `hermes_task_status`, `hermes_task_result` |
| `GET /health` | startup gate, `/ready` |
| `POST /v1/notify` (best effort) | task-completion notifications (spec §19) |

## Model flexibility (spec §34)

Model choice stays a Hermes concern — this repo only sets `HERMES_API_URL` /
`HERMES_API_KEY` (and optionally `HERMES_MODEL` for quick asks). Claude, GPT,
OpenRouter or Nous backends all work without touching the Alexa+ integration.
