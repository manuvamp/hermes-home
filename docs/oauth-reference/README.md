# OAuth 2.1 + PKCE reference for Alexa+ account linking (spec §9)

Development mode works loopback-only. For Alexa+ production onboarding:

## What Alexa+ requires

- OAuth 2.1 authorization-code flow with **PKCE S256** (plain never accepted)
- Bearer tokens presented in the `Authorization` header — never in URLs
- Discovery documents:
  - `GET /.well-known/oauth-protected-resource` — advertises the protected MCP resource + its authorization server(s)
  - `GET /.well-known/oauth-authorization-server` — issuer metadata, must list `code_challenge_methods_supported: ["S256"]`
- Canonical resource URI equal to the public MCP base URL
- `401` + `WWW-Authenticate` on unauthenticated calls, pointing at the protected-resource metadata

This server serves both discovery documents from `src/server.ts`
(`registerWellKnown`). In `AUTH_MODE=oauth2`, `src/auth/index.ts` enforces a
bearer token on `/mcp` and returns a `401` with `WWW-Authenticate` when absent.

## Recommended production wiring

Put a **reference proxy/IdP** in front — don't hand-roll an authorization
server at a hackathon:

| Option | Notes |
|---|---|
| **oauth2-proxy** + any OIDC IdP | Simplest: proxy terminates OAuth, forwards `Authorization` to this server. |
| **Keycloak** | Full local IdP; realm with a public client, PKCE enforced, `S256` only. |
| **Amazon Cognito** | Closest to the Alexa+ ecosystem; hosted UI + code+PKCE flow. |

Whatever fronts it must enforce: PKCE S256 only, short-lived access tokens,
rotated refresh tokens, and no tokens in query strings.

## Mapping identity (spec §39)

The token's `sub` becomes `userId`, which scopes per-user memory and run
ownership. Multi-user isolation therefore works the moment oauth2 mode is
enabled — nothing else in the tool layer needs to change.
