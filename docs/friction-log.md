# Friction log

Real snags from building Hermes Home during the hackathon. Format per entry:
**Task · Expected · Actual · Severity · Workaround · Suggestion**

---

## 1. No Alexa+ Preview access → had to build a simulated client
- **Task:** Onboard the MCP server to Alexa+ and test on a device.
- **Expected:** A self-serve way to point an Alexa+ account at a custom Streamable-HTTP MCP server.
- **Actual:** Alexa+ is in Preview; no access for an outside developer account. The hackathon's "simulated Alexa+" path was the only option.
- **Severity:** High (blocks end-to-end validation).
- **Workaround:** Built `apps/dashboard/src/sim` — an MCP client using the official SDK plus an LLM/keyword tool-picker and a voice UI.
- **Suggestion:** Publish an official Alexa+ MCP *test harness* (CLI or web) that exercises `tools/list` and `tools/call` with Alexa+'s real timing limits (500 ms budget) and OAuth flow, usable without Preview access.

## 2. MCP SDK: "Already connected to a transport" with a shared server
- **Task:** Serve many concurrent MCP sessions over Streamable HTTP.
- **Expected:** One `McpServer` instance, many transports.
- **Actual:** `Protocol` allows one transport; the second session crashes with `Already connected to a transport`.
- **Severity:** Medium (obvious only after the crash).
- **Workaround:** Factory that builds one `McpServer` per session (`apps/mcp-server/src/mcp/mcpServer.ts`).
- **Suggestion:** Document the per-session pattern in the Streamable HTTP server examples, or support multi-transport natively.

## 3. Stale MCP session after server restart
- **Task:** Keep a long-lived MCP client (the simulator) across server restarts.
- **Expected:** Client transparently re-initializes.
- **Actual:** `Bad request: no valid session. Send an initialize request first.` until the client is recreated.
- **Severity:** Low.
- **Workaround:** Drop the client and reconnect on any transport error.
- **Suggestion:** Have the SDK client auto re-`initialize` on a 404/"no valid session" response (the 2025-11 spec describes this for expired sessions).

## 4. Hermes had no obvious HTTP API
- **Task:** Reach the Hermes agent from the bridge.
- **Expected:** An HTTP endpoint.
- **Actual:** Hermes ships a stdio MCP server only; the OpenAI-compatible API server exists but is off by default (`platforms.api_server`) and refuses to boot without `API_SERVER_KEY`.
- **Severity:** Medium.
- **Workaround:** Enabled `api_server` on 127.0.0.1:8642, tunnelled over SSH.
- **Suggestion:** Document the API server in the main README with a minimal config.

## 5. Model-provider quirks cost the most time
- **Task:** Give the agent a model that fits free/cheap tiers.
- **Actual:** (a) Groq free tier: 8k TPM vs ~17k tokens per agent call. (b) Gemini free tier: 250k input tokens/min, exhausted by a single heavy skill run. (c) Z.ai: Coding-Plan keys only work on `/api/coding/paas/v4`; the general endpoint returns `429 Insufficient balance` despite credit. (d) Hermes' built-in `zai` provider name shadows a custom provider of the same name. (e) `glm-5.3-flash` rejects `reasoning_effort: medium`.
- **Severity:** High (each looked like "the bridge is broken").
- **Workaround:** Custom provider `glm` on the coding endpoint, `reasoning_effort: low` — see `docs/hermes-vm.md`.
- **Suggestion:** Surface provider errors in the Hermes API run response (we read them from `status` text) and warn on unknown reasoning-effort values.

## 6. Voice-latency budget vs agent latency
- **Task:** Answer Alexa+-style requests quickly.
- **Expected:** Sub-second tool results.
- **Actual:** A real agent answer takes 15–20 s; `hermes_ask` has to time out around 20 s.
- **Severity:** Medium.
- **Workaround:** Async-by-default design: `hermes_start_task` returns a run id immediately; status/result are polled; the simulator speaks an acknowledgement while waiting.
- **Suggestion:** First-class async/long-running tool semantics in Alexa+ MCP (progress notifications, "I'll tell you when it's done").

## 7. Owner-guarded skills refuse API-server callers
- **Task:** Ask Hermes (via the bridge) to analyse Buffer posts.
- **Actual:** The skill's owner allowlist needs a Discord user id; API-server sessions have none, so it refuses (correctly).
- **Severity:** Low (security working as designed).
- **Workaround:** Not bypassed. The simulator no longer forwards refusals as messages.
- **Suggestion:** Let Hermes API callers carry an authenticated principal that skills can map to an owner.

## 8. Windows / PowerShell 5.1 pitfalls
- **Task:** Scripted onboarding and an SSH one-liner on Windows.
- **Actual:** Inline JSON and nested quotes are mangled by PowerShell 5.1's native-argument passing (a `read -rsp "..."` over SSH silently saved an empty key).
- **Workaround:** Pipe values over stdin; keep remote commands free of double quotes; `scripts/*.ps1` avoid PS7-only syntax.
- **Suggestion:** Provide `.sh`/Node equivalents of setup scripts in sample repos.
