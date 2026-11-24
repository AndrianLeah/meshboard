# Self-hosted Meshboard: the app, live sync and the API in one image. See docs/self-hosting.md.
#   docker build -t meshboard .
#   docker run -p 8080:8080 -v meshboard:/data -e MESHBOARD_URL=http://localhost:8080 meshboard

# the app, built once
FROM node:22.18-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# the server's runtime packages only
FROM node:22.18-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false --ignore-scripts

FROM node:22.18-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY src/core ./src/core
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
