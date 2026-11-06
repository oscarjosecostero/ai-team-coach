# API and worker image (Railway runs two services from it: `node dist/server.js` and `node dist/worker.js`).
# Built from the repo root because the API depends on the @coach/contracts workspace.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --workspace api --workspace packages/contracts --include-workspace-root=false
COPY packages/contracts packages/contracts
COPY api api
RUN npm run build --workspace api

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --omit=dev --workspace api --workspace packages/contracts --include-workspace-root=false && npm cache clean --force
# @coach/contracts ships TypeScript source; Node 24 strips the types at load time.
COPY packages/contracts/src packages/contracts/src
COPY --from=build /app/api/dist api/dist
WORKDIR /app/api
USER node
EXPOSE 4000
# The API applies pending migrations before listening. Worker: `node dist/worker.js`.
CMD ["node", "dist/server.js"]
