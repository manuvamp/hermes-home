# Hermes Home — MCP server runtime (MVP track).
# Alexa+ reaches this over Streamable HTTP at POST /mcp.
# The Hermes Agent itself is a SEPARATE runtime (local gateway /
# cloud / VM); this image is only the bridge.

FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests (npm workspaces).
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/mcp-server/package.json apps/mcp-server/

RUN npm install

COPY packages/shared packages/shared
COPY apps/mcp-server apps/mcp-server

RUN npm run build --workspace @hermes-home/shared
RUN npm run build --workspace @hermes-home/mcp-server

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/package.json /app/package.json
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/packages/shared /app/packages/shared
COPY --from=base /app/apps/mcp-server /app/apps/mcp-server

WORKDIR /app/apps/mcp-server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.js"]
