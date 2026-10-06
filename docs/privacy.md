# Privacy

- **Only the MCP server is public.** Hermes, Home Assistant, and the memory
  store bind to localhost; nothing personal transits the tunnel except
  authenticated tool traffic (spec §38).
- **Per-user memory, always.** Memory and run history are keyed by the user's
  identity (`x-user-id` locally; OAuth `sub` in production). One shared memory
  across users is treated as a bug (spec §39).
- **Memory is verbatim, tagged, and recallable.** Stored only when asked,
  labeled `source: 'memory'`, never silently inferred (spec §24).
- **No dangerous autonomy.** Locks/alarms/covers pass through the
  dual-confirmation path — never silent execution (spec §17).
- **Logs are minimal.** Request ids, tool names, duration, success/failure.
  Never: tokens, passwords, API keys, raw personal conversations (spec §47).
- **Secrets stay out of source control.** `.env` is git-ignored; only
  `.env.example` ships (spec §38).
- **Muse is descriptive only.** No medical/cognitive claims from sensor data
  (spec §20).
