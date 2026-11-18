# Build context is the repository root:  docker build -f dashboard/Dockerfile -t vega-ui .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contract/package.json packages/contract/
COPY dashboard/package.json dashboard/
COPY brain/package.json brain/
COPY tools/sim/package.json tools/sim/
RUN npm ci --workspace dashboard --include-workspace-root
COPY packages/contract packages/contract
COPY dashboard dashboard
RUN npm run build -w dashboard

FROM nginx:alpine
COPY dashboard/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dashboard/docker/40-vega-config.sh /docker-entrypoint.d/40-vega-config.sh
COPY --from=build /repo/dashboard/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-vega-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
