# Build from the repository root with --target tamma-engine.
FROM node:22-alpine AS manifests
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/cost-monitor/package.json packages/cost-monitor/
COPY packages/observability/package.json packages/observability/
COPY packages/platforms/package.json packages/platforms/
COPY packages/providers/package.json packages/providers/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/worker-runner/package.json packages/worker-runner/

FROM manifests AS build
RUN pnpm --filter tamma --filter @tamma/worker-runner... install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/cost-monitor/src packages/cost-monitor/src
COPY packages/cost-monitor/tsconfig.json packages/cost-monitor/
COPY packages/observability/src packages/observability/src
COPY packages/observability/tsconfig.json packages/observability/
COPY packages/platforms/src packages/platforms/src
COPY packages/platforms/tsconfig.json packages/platforms/
COPY packages/providers/src packages/providers/src
COPY packages/providers/tsconfig.json packages/providers/
COPY packages/orchestrator/src packages/orchestrator/src
COPY packages/orchestrator/tsconfig.json packages/orchestrator/
COPY packages/worker-runner/src packages/worker-runner/src
COPY packages/worker-runner/tsconfig.json packages/worker-runner/
RUN pnpm --filter @tamma/worker-runner... run build

FROM manifests AS production-deps
RUN pnpm --filter @tamma/worker-runner... install --prod --frozen-lockfile

FROM node:22-alpine AS tamma-engine
RUN apk add --no-cache tini git
RUN addgroup -g 1001 tamma && adduser -u 1001 -G tamma -s /bin/sh -D tamma
WORKDIR /app
ENV NODE_ENV=production
ENV PATH="/app/packages/worker-runner/node_modules/.bin:${PATH}"
ENV TAMMA_WORKING_DIRECTORY=/home/tamma/workdir
RUN mkdir -p /home/tamma/workdir && chown tamma:tamma /home/tamma/workdir
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages ./packages
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/cost-monitor/dist packages/cost-monitor/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/packages/platforms/dist packages/platforms/dist
COPY --from=build /app/packages/providers/dist packages/providers/dist
COPY --from=build /app/packages/orchestrator/dist packages/orchestrator/dist
COPY --from=build /app/packages/worker-runner/dist packages/worker-runner/dist

USER tamma
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD test -f /tmp/tamma-engine-healthy || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/worker-runner/dist/index.js", "service"]
