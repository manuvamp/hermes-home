# Devpost submission pack (copy/paste)

**Track:** Alexa+ (self-hosted MCP server, Streamable HTTP, spec 2025-11-25 — simulated-Alexa+ client included)
**Mini challenge:** Open Source (MIT license in this repo). AWS Builder: not entered.

## Project description
Hermes Home is a self-hosted MCP server that lets Alexa+ talk to a persistent personal AI agent (Hermes).
Alexa+ integrates through remote Streamable-HTTP MCP servers, but the Hermes runtime only offers a local
stdio MCP server — so we built the bridge. The server exposes 14 deliberately small tools (never the full
agent catalogue). Anything slow runs asynchronously: `hermes_start_task` returns a run id instantly, and
status/result are polled, so a voice assistant never blocks on the agent. Safety is built in: the server
refuses to boot without a live agent, run and memory state are isolated per user, home-control actions need
explicit confirmation, and internet exposure uses RS256/JWKS-verified OAuth2 with a DNS-rebind guard.

Because Alexa+ is in Preview, we also built an **Alexa+ simulator** (`apps/dashboard/src/sim`): a voice/chat
web app that acts as the MCP client via the official SDK, discovers tools, calls them over Streamable HTTP and
shows every `tools/call` in a live trace panel. Demo: ask a question → Hermes answers; start a research task
and poll it; "send me a message on Discord" → Hermes writes it and its messaging gateway delivers a DM.

## How it works
Voice/chat client → (Streamable HTTP MCP, tools/list + tools/call) → Hermes Home server (Fastify, official SDK)
→ Hermes Agent API (`/v1/chat/completions`, `/v1/runs`) on a cloud VM, reached over an SSH tunnel →
model (Z.ai GLM-5.3-Flash) + Hermes skills and messaging gateway (Discord).

## Built during the hackathon
All of it — the repo was created for this hackathon (bridge, tools, auth, simulator, docs).
The Hermes Agent runtime itself and its VM pre-existed (it is the agent being bridged).

## Required fields checklist
- [ ] Public GitHub repo URL (MIT) — repo must contain all source + run instructions (README "Try it in 2 minutes")
- [ ] Demo video < 3 min, public YouTube/Vimeo, English, no third-party music
- [ ] Product feedback → paste `docs/product-feedback.md`
- [ ] Friction log (optional, up to +10%) → paste `docs/friction-log.md`
- [ ] Open Source: contribution URL, repo URL, GitHub username, short description
- [ ] Where the code calls the track tech: `apps/mcp-server/src/mcp/*` (server) and `apps/dashboard/src/sim/agent.js` (client)
