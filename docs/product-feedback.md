# Product feedback

Honest feedback per tool used. **Note:** Alexa+ itself was *not* accessible (Preview); the Alexa+ side was
exercised only through a simulated client built on the MCP spec.

## MCP specification / TypeScript SDK (`@modelcontextprotocol/sdk` 1.32, protocol 2025-11-25)
- **Used for:** the Streamable-HTTP server (`apps/mcp-server`) and the client in the simulator.
- **Worked well:** Spec negotiation and `tools/list`/`tools/call` were smooth; typed inputs plus zod made tool schemas easy; `StreamableHTTPClientTransport` made the simulator ~100 lines.
- **Needs work:** One-transport-per-`Protocol` limit isn't obvious (friction #2); clients don't auto-recover from an expired session (#3); DNS-rebind/Origin protection had to be hand-written.
- **Onboarding:** Good; the examples got us running in under an hour.
- **Would build again:** Yes.

## Alexa+ (MCP integration — via simulation only)
- **Used for:** design target; we followed the stated constraints (Streamable HTTP, small tool set, ~500 ms responsiveness, OAuth2).
- **Worked well:** Using plain MCP as the integration surface is excellent — any agent runtime can sit behind it.
- **Needs work:** No way to try it without Preview access (#1). A public conformance/test harness would unblock outside developers.
- **Would build again:** Yes, once there is a testable path.

## Hermes Agent (Nous Research)
- **Used for:** the agent runtime behind the bridge (chat, long runs, skills, Discord messaging).
- **Worked well:** The OpenAI-compatible API server with `/v1/runs` maps perfectly onto an async voice-assistant pattern; skills and messaging are powerful.
- **Needs work:** API server is off by default and under-documented (#4); provider errors are hard to see (#5); skills can't identify an authenticated API caller (#7).
- **Would build again:** Yes.

## Model providers (Google Gemini API, Groq, Z.ai GLM)
- **Used for:** the model behind Hermes (final: `glm-5.3-flash` on the Z.ai Coding endpoint).
- **Worked well:** GLM Flash is fast and handles tool-calling agents on a modest plan.
- **Needs work:** Free tiers are too small for agent contexts (#5); endpoint/plan mismatch errors are misleading ("insufficient balance").

## Discord (via Hermes' messaging gateway)
- **Used for:** "send me a message" demo path — the bridge's `send_message` tool delivers a DM through Hermes' own bot.
- **Worked well:** Hermes resolves a username to a DM channel automatically.

## Home Assistant, Google Calendar (.ics), GitHub REST
- Implemented as optional tools; **not exercised live** in the demo (credentials not configured), and they return a clear "not configured" result otherwise.

## AWS services
- Not used.
