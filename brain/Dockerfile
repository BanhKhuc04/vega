# Build context is the repository root:  docker build -f brain/Dockerfile -t vega-brain .
# Multi-arch: the bundle is built on the build machine, the runtime stage is plain node:22-alpine, so
# `docker buildx build --platform linux/arm64 ...` needs no emulation and the image runs on a Pi 3 (64-bit OS).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contract/package.json packages/contract/
COPY brain/package.json brain/
COPY dashboard/package.json dashboard/
COPY tools/sim/package.json tools/sim/
RUN npm ci --workspace brain --include-workspace-root=false --ignore-scripts
COPY packages/contract packages/contract
COPY brain brain
RUN npm run build -w brain && mkdir -p /out/data

FROM node:22-alpine
ENV NODE_ENV=production BRAIN_DB=/data/brain.db
WORKDIR /app
COPY --from=build /repo/brain/dist/brain.mjs ./brain.mjs
# no RUN in this stage: building for arm64 on an amd64 machine needs no emulation
COPY --from=build --chown=node:node /out/data /data
USER node
VOLUME /data
# mqtt.js still calls url.parse (DEP0169); node:sqlite is flagged experimental on Node 22
CMD ["node", "--disable-warning=ExperimentalWarning", "--disable-warning=DEP0169", "brain.mjs"]
