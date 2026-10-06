# Hermes VM — live wiring (as of 2026-10-03)

This documents exactly how the real Hermes Agent on the GCP VM is connected
today, what changed from the pre-existing setup, and how to roll back or swap
providers. All files referenced are on the VM; all commands need
`ssh -i ~/.ssh/<key> <user>@<VM_IP>`.

## Topology

```
my Windows box (bridge)           hermes-agent GCP VM
──────────────────────            ─────────────────────────────────────────
:3000  Fastify+MCP bridge ──▶  ─▶  ssh -N -L 8642:127.0.0.1:8642
                                 ▼
                           hermes-gateway.service   (systemd user service)
                           python -m hermes_cli.main gateway run
                             ├─ platforms.api_server   POST /v1/chat/completions, /v1/runs, /v1/runs/{id}
                             └─ platforms.discord      (user messaging — untouched)

                             model provider: providers.gemini → gemini-3.1-flash-lite
                             (GOOGLE_API_KEY — Google AI Studio free tier)
```

## What I changed on the VM

| File | Change | Rollback |
|---|---|---|
| `/home/openclaw/.hermes/config.yaml` | enabled `platforms.api_server` on `127.0.0.1:8642`; switched `model.default/provider` to `gemini-3.1-flash-lite`/`gemini`; moved personality roster from 24 entries to one `default` (token diet for free tier); added keyed `providers:` block | `sudo cp /home/openclaw/.hermes/config.yaml.bak-gemini-20261003-123007 /home/openclaw/.hermes/config.yaml` (backups: `*.bak-groq-*`, `*.bak-gemini-*`, `*.bak-strip-*`) |
| `/home/openclaw/.hermes/.env` | added `GOOGLE_API_KEY=…` (+ `GEMINI_API_KEY` alias) and `GROQ_API_KEY=…` (kept for reference; Groq free tier is rejected, see below) | remove the two lines |
| `hermes-gateway.service` | `systemctl --user restart hermes-gateway.service` — Discord/other messaging reconnects automatically | idempotent |

**Preserved data**: no file deleted. Skills dir untouched (all 24 local skills
still installed, just not injected on this model). Memory/projects/journey
untouched. `image_gen.provider` still `minimax` (image generation stays on
MiniMax as before, just MiniMax needs balance for that too).

## Why each choice

- **`platforms.api_server`** — the documented Hermes HTTP API. Spec § B's whole
  `hermes_ask`/`hermes_start_task`/`status/result` schema maps 1:1 to it. It
  refuses to boot without `API_SERVER_KEY`.
- **keyed `providers:` over `custom_providers:`** — this Hermes build (0.18.2)
  resolves the gateway lookup against the keyed map; the legacy list-barrel
  form returned "Unknown provider 'custom:gemini'" for a valid custom_provider.
- **Gemini over Groq** — verified on the VM: Groq free tier caps at 8,000 TPM;
  one Hermes call is ~17k tokens because it's an agent (SOUL+skills manifest+
  conversation). Gemini's free tier handled the same 17k cleanly in 0.8s.
- **`gemini-3.1-flash-lite`** — best live free-tier option at the moment
  (1M context, tool-calling works, thinking included). `gemini-2.5-flash` is
  retired for new keys; I listed available models and tested three.

## Provider playbook (verified patterns)

To add another OpenAI-compatible provider:
1. Drop a `KEY=…` into `/home/openclaw/.hermes/.env`
2. Add under `providers:` in `config.yaml`:
   ```yaml
   NAME:
     base_url: <host>/v1     # MUST be the openai-compat path
     key_env: KEY
     default_model: <model>
   ```
3. Switch selector: `model: { default: <model>, provider: NAME }`
4. `systemctl --user restart hermes-gateway.service`

Common pitfall the docs cover: some providers need `api_mode: chat_completions`.
If the model "says nothing", `.error` is usually in
`journalctl --user -u hermes-gateway.service -n 30`.

## The bridge sees no difference

Everything the bridge does goes through `/v1/chat/completions` and `/v1/runs`.
As long as `/health` answers and the model works, the bridge is provider-agnostic.
That's the whole architecture point (spec §34) — provider choice stays a Hermes
config concern.


## Update 2026-10-06 — Z.ai GLM (Coding Plan)

Provider is now **`glm`** → `https://api.z.ai/api/coding/paas/v4`, model **`glm-5.3-flash`**,
`agent.reasoning_effort: low`, key in `.env` as `ZAI_API_KEY`.

Lessons (each cost time):
- **Coding Plan keys only work on `/api/coding/paas/v4`.** The general `/api/paas/v4` endpoint answers
  `429 Insufficient balance` even with credit. Check which plan the key belongs to first.
- **Don't name the provider `zai`.** Hermes ships a built-in `zai` provider (coding endpoint) that shadows a
  custom entry of the same name. Use a different key (`glm`).
- `glm-5.3-flash` always thinks: `reasoning_effort: medium` → `400 ... use low, high, or max`. Use `low`.
- Gemini free tier (250k input tokens/min) is too small for Hermes' agent context on heavy tasks.
- Backups: `config.yaml.bak-glm-*`, `*.bak-glm53-*`, `*.bak-coding-*`.
- Skills guarded by an owner allowlist (e.g. Buffer's `cocat-guard.js`) refuse calls arriving via the API
  server, which carries no Discord user id. That is by design.
