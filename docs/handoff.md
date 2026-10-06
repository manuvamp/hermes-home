# Handoff — Hermes Home (audit & continuation guide)

## 🟢 LIVE STATUS — updated 2026-10-03 ~12:30
**The bridge is fully connected to your real Hermes Agent** and everything
(`hermes_ask`, `hermes_start_task`, `hermes_task_status`, `hermes_task_result`)
is verified end-to-end live. The hero interaction works: an async run
`running → completed` on the real agent produced a real answer.

**Connection topology:**
```
Alexa+ (future) ──HTTPS──▶ bridge (this repo, :3000) ──SSH tunnel 127.0.0.1:8642──▶ Hermes Agent VM @ <VM_IP>
                                                                                      hermes_gateway (systemd user service)
                                                                                      provider: gemini  → gemini-3.1-flash-lite (free tier, 1M context)

Outbound notifications:
send_message tool ──ssh -i ~/.ssh/<key>──▶ `hermes send -t discord` on VM ──▶ Discord (Hermes' own bot)
                                                                            (webhooks are only a FALLBACK when SSH isn't set)
```

**For the AI/person picking this up.** This document tells you exactly what
exists, what's been *proven* (and how to re-prove it), what's stubbed, and the
exact next moves. Nothing here asks you to trust me — every claim has a
re-verification command.

Last full validation: **2026-10-03** — `npm run onboard` → `6 ready, 4 not ready`
(the 4 not-ready are empty credential slots, not bugs). `npm test` → **15/15 green**.

---

## 💬 Messaging / notifications (spec §19) — solved

`send_message` posts through **`hermes send` over SSH** to the gateway on the VM,
so messages come from **Hermes' own bot** (the same one your DM/chat sessions use).
No webhooks needed. Fallbacks (Telegram bot token, Discord/Slack webhooks) already
exist in `state/messaging.ts` and engage only when `HERMES_SEND_SSH_HOST` is unset.

**Why not the in-loop `discord` tool?** Verified on the VM: the `discord`
tool exposed over `/v1/chat/completions` is a *session-context* tool — it replies
within the Discord conversation the user is in. From the API route there is no
inbound Discord session, so Hermes exposes it but won't execute (`"I do not
currently have a functional tool available to send messages"`). `hermes send` is
the designed escape from that (spec §19) — no session required, uses the same
gateway credentials directly.

Env keys (already in `.env`): `HERMES_SEND_SSH_HOST`, `HERMES_SEND_SSH_USER`,
`HERMES_SEND_SUDO_USER`, `HERMES_SEND_TARGET` (currently `discord:<your_discord_username>` —
direct DM; switch to `discord` for the home channel or `telegram`/etc. per
spec platforms).

**DM targets**: `send_message` takes an optional `to` — any target `hermes send --list` accepts,
such as `discord:<your_discord_username>` (your DM), `discord:#ops` (a channel), `discord:<user_id>`,
or `telegram`. Omitting `to` delivers to your DM. Discovered via
`hermes send --list discord`.

## 1. What this is (30 seconds)

Alexa+ needs a **remote Streamable-HTTP MCP server**; Hermes (the agent CLI)
only ships a stdio MCP server. This repo is the **bridge**:

```
Alexa+  ──Streamable HTTP MCP──▶  THIS SERVER (public, OAuth2)  ──localhost HTTP──▶  Hermes Agent
                                                                              └─▶  Home Assistant, Calendar, GitHub, …
```

The server answers Alexa+'s MCP handshake with **14 deliberate tools** (never
the whole Hermes catalogue, spec §10) and keeps every long task async so Alexa+
never waits >500 ms (spec §36).

## 2. Current state — read this before anything else

| Area | State | How to re-verify |
|---|---|---|
| **Repo scaffolding** | ✅ done | `find . -type f -not -path '*/node_modules/*'` — 60 source files |
| **TypeScript build** | ✅ clean | `npm run build` |
| **Unit + protocol + safety tests** | ✅ 15/15 | `npm test` |
| **MCP Streamable-HTTP handshake** | ✅ live-verified | `npm run onboard` §2 (`mcp-session-id` returned, 14 tools listed) |
| **DNS-rebind guard** | ✅ live-verified | `npm run onboard` §3 — foreign Origin gets `403` |
| **OAuth discovery docs** | ✅ live-verified | `curl http://127.0.0.1:3000/.well-known/oauth-protected-resource` |
| **Real RS256 JWT verification** | ✅ unit-tested | `npm test` — `test/auth.test.ts` signs real keys, verifies against real JWKS |
| **Hermes connectivity** | ✅ boot-gated | server refuses to start if `HERMES_API_URL` down (unless `HERMES_REQUIRED=false`) |
| **Home Assistant** | ⚠️ code done, needs your `HASS_TOKEN` | set env → `npm run onboard` §4 goes green |
| **Calendar** | ⚠️ code done, needs your `.ics` URL | set `CALENDAR_ICS_URL` → onboard §4 |
| **GitHub** | ⚠️ code done, needs your PAT | set `GITHUB_TOKEN`+`GITHUB_USER` → onboard §4 |
| **Messaging notify** | ⚠️ code done, needs one webhook/bot | set any of `TELEGRAM_*`/`DISCORD_WEBHOOK_URL`/`SLACK_WEBHOOK_URL` |
| **Alexa+ onboarding** | ❌ not yet | needs a tunnel + your Alexa+ account — §7 below |

**Nothing is broken.** Red rows in the last `onboard` run were all "credential
not configured yet" — each line includes the exact fix.

## 3. 10-minute re-verification (do this first)

```powershell
cd "D:\hackathn fire tv\alexa hermes agent link"
npm install            # if node_modules missing
npm run build          # expect: no output, exit 0
npm test               # expect: 15 pass, 0 fail
```

Then the live protocol+infra proof (spins the server against a fake Hermes
just long enough to prove the whole chain):

```powershell
npm run onboard        # the readiness ladder — the single most useful script
```

Expected when unconfigured: **6 ready / 4 not ready**, with only the four
credential integrations in red. If §§1–3 are green, infrastructure, protocol,
and auth wiring are sound.

## 4. File map — where everything lives (with responsibilities)

```
apps/mcp-server/
  src/
    server.ts            Fastify app: routes, /health /ready /tools /version /mcp, well-known docs
    config.ts            Single source of env truth (auto-loads .env, typed accessors)
    mcp/
      mcpServer.ts       Factory: one McpServer per session; wraps handlers with artifact-friendly results
      transport.ts       Streamable-HTTPServerTransport: sessions, DNS-rebind guard, TTL sweep
    auth/
      index.ts           preHandler: local (loopback ± static token) vs oauth2 (JWKS)
      jwks.ts            ✱ Real RS256 verify: JWKS fetch+cache, iss/aud/exp, kid rotation
    hermes/
      client.ts          ✱ Hermes HTTP: /v1/chat/completions, /v1/runs, /health, fail-closed gate
      registrations.ts   (stub, track-2) exports tool-config.json so Hermes can consume THIS bridge
      workflows.ts       (stub, track-2) workflow-template shapes for "Hermes, handle this"
    state/
      context.ts         per-request {userId, requestId, mode} — userId NEVER crosses users
      runs.ts            ✱ run registry: per-user ownership + background pump + completion notify
      memory.ts          per-user JSON memory (source:'memory' tagged, never inferred)
      homeassistant.ts   HA REST: list/get/resolveTarget/callService
      calendar.ts        ✱ dependency-free .ics/CalDAV parser
      github.ts          GitHub REST read-only issue triage
      messaging.ts       Telegram/Discord/Slack outbound
      notifications.ts   run-complete → hermesNotify + direct channels
    tools/
      registry.ts        ✱ single catalogue — add a tool file + 1 line here to extend
      hermes.ts / home.ts / memory.ts / calendar.ts / github.ts / messaging.ts

  test/  auth.test.ts (real RSA→JWT→JWKS), calendar.test.ts, safety.test.ts
  Dockerfile             MVP runtime image (see §8 for why it doesn't contain Hermes)

docs/
  architecture.md · alexa.md · hermes.md · integrations.md
  oauth-reference/README.md   (recommended prod auth wiring)
  memory.md · privacy.md · friction-log.md · product-feedback.md
  handoff.md                  ← you are here

scripts/
  dev.ps1       one-command env: install→build→server+dashboard(+tunnel)
  onboard.ps1   ✱ THE readiness ladder; opinionated, colored, PS5.1-safe
  smoke.ps1     lighter pass/fail
```

`✱` = highest-value files for an audit read.

## 5. Behaviors to verify for yourself (claims worth checking)

1. **Per-user isolation** (`state/runs.ts`, `state/memory.ts`): Alice's `runId`
   and memories are invisible to Bob. Pinned by `test/safety.test.ts`.
2. **Two-step home control** (`tools/home.ts`): `confirm:false` →
   `needsConfirmation:true`, `confirm:true` only executes within a 30 s window.
   Locks/alarms/covers double-guarded. Pinned in tests.
3. **Async-by-default** (`hermes/client.ts`, `state/runs.ts`):
   `hermes_start_task` returns a `runId` immediately; status/result polled.
4. **Fail-closed Hermes gate** (`hermes/client.ts` `assertHermesReady`): server
   won't boot without a live gateway. `HERMES_REQUIRED=false` exists only for CI.
5. **JWT signing gotcha (fixed)**: JWT signs `header.payload`, not all 3 parts.
   `auth/jwks.ts` builds `signedContent` from parts[0..1] — a test prior to this
   fix produced `invalid signature` on every token. Confirm in `auth.test.ts`.

## 6. Design decisions I made (questions to audit)

- **One McpServer per session** (SDK allows only one transport per `Protocol`):
  `mcpServer.ts` is a *factory* keyed by session. Not a shared instance — that's
  the root of the "Already connected to a transport" crash you should NOT reintroduce.
- **No new npm deps**: calendar, GitHub, JWKS, messaging are all hand-rolled
  with stdlib fetch/crypto. Keeps the attack surface small and the audit easy.
  Deliberate trade: no CalDAV depth discovery beyond `REPORT`, no JWKS `x5c`
  chain validation — noted as follow-ups, not blockers.
- **PS5.1-safe scripts**: `scripts/*.ps1` avoid `??`, `?.`, `?:`; curl bodies
  come from temp files, headers via regex — PowerShell 5.1 mangles inline JSON.
- **Local mode's hard boundary is Host/Origin**; oauth2 mode additionally
  enforces a verified Bearer. Don't relax the local guard for the demo.

## 7. Next moves, in priority order

1. ✅ ~~Chinese wall — connect bridge to the user's actual Hermes.~~ **done**
2. **Fill the 4 integration slots** in `.env`: `HASS_TOKEN`, `CALENDAR_ICS_URL`,
   `GITHUB_TOKEN`/`GITHUB_USER`, one messaging webhook. Re-run `npm run onboard`
   — target `10 ready, 0 not ready`.
3. **Expose + onboard Alexa+** (docs/alexa.md):
   `cloudflared tunnel --url http://localhost:3000` → set
   `PUBLIC_BASE_URL` + `AUTH_MODE=oauth2` + your IdP's `AUTH_JWKS_URI`/issuer/aud
   → run through the Alexa+ simulator → physical device.
4. **Durable SSH tunnel for the demo** — current tunnel is a background `ssh -N`;
   dies with this shell. For rehearsal/demo-day robustness make it a Windows
   Scheduled Task running: `ssh -i ~/.ssh/<key> -N -L 8642:127.0.0.1:8642 <user>@<VM_IP>`
   (script the loop with `-o ServerAliveInterval=30`).
5. **Track 2 (registry-remote)** — the deliberately-stubbed second architecture:
   wire `hermes/registrations.ts#writeToolConfig` into server startup so Hermes
   can consume this bridge *as an MCP server* (bilateral tools). Only after track 1 demos cleanly.
6. **Physical device test** before submission — the spec's §41 final step.

## 8. What to watch / known limits

- **`docker-compose.yml` does NOT contain Hermes** — the agent runs on the
  host/VM per `docs/hermes.md`; the Compose service is just the bridge. That's
  the product split, not an oversight.
- **If rolls back to MiniMax**: config backups live at
  `/home/openclaw/.hermes/config.yaml.bak-*` (groq, gemini, lean, strip).
  Personality roster is preserved in `config.yaml.bak-strip-*`; rollback copies
  it back and switches `model:`/provider. (Free-tier note below.)
- **Hermes Agent + free LLM tier**: because Hermes' context is ~17k tokens/call
  (STM+skills+SOUL+memories), the LLM provider needs a big TPM budget:
  - Groq free: **rejected** (8k TPM cap). Kept in providers for future non-agent use.
  - Google AI Studio free (this is what's on now): works great.
  - MiniMax-M2.7: configured but out of account balance; restore by topping up
    MiniMax credits then flipping `model:`/`provider:` (backup pattern above).
- **`mcpServer.ts` handler context**: tools get `x-user-id` for identity; in
  oauth2 production the user comes from the JWT `sub` set in `auth/index.ts`.
- **Memory is a local JSON file** (`data/memory.json`). Fine for a demo; swap
  `state/memory.ts`'s three functions for a real store before multi-user prod.
- **`transport.ts` local guard trusts loopback** — assumed dev machine is
  single-tenant. If you demo on a shared LAN box, set `AUTH_LOCAL_TOKEN` too.
- **The `data/` dir is gitignored** — clean checkouts boot fresh; the
  onboarding ladder walks the first-run flow.
