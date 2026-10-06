# generic-mcp — future integration adapters

Hermes already connects to external MCP servers (stdio + Streamable HTTP), so the
adapter pattern for new services is intentionally thin: configure, don't code.

```yaml
# example — config-driven, nothing hard-coded (spec §22)
integrations:
  github:
    enabled: true
    mcp:
      url: https://api.githubcopilot.com/mcp/
      transport: streamable-http
  notion:
    enabled: false
  custom:
    enabled: false
    mcp:
      command: ["npx", "-y", "@acme/mcp-server"]
      transport: stdio
```

A service adapter only exists when a service needs normalization BEFORE its tools
reach Alexa+. Everything else should ride the generic config path above.
Each adapter implements:

```ts
interface Integration {
  id: string;
  name: string;
  healthCheck(): Promise<boolean>;
  tools(): ToolDefinition[];
}
```

Planned adapters live beside this file: `homeassistant/` (done, in the MCP server),
`calendar/`, `messaging/`, `muse/` (optional, SDK-licensing gated — spec §21).
