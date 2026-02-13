# Tier 3 Installer: Docker Compose Full-Stack Deployment

**Status:** Draft
**Last Updated:** 2026-02-13
**Scope:** `tamma init --full-stack` and standalone `docker compose up` for the complete Tamma platform

---

## Table of Contents

1. [Goal](#1-goal)
2. [Current Docker State](#2-current-docker-state)
3. [Service Architecture](#3-service-architecture)
4. [Dockerfiles](#4-dockerfiles)
5. [Docker Compose Configuration](#5-docker-compose-configuration)
6. [Image Registry](#6-image-registry)
7. [CLI Integration](#7-cli-integration)
8. [Configuration and Secrets](#8-configuration-and-secrets)
9. [Data Persistence](#9-data-persistence)
10. [Monitoring and Observability](#10-monitoring-and-observability)
11. [Update Strategy](#11-update-strategy)
12. [Testing Strategy](#12-testing-strategy)
13. [Risks and Mitigations](#13-risks-and-mitigations)
14. [Implementation Steps](#14-implementation-steps)

---

## 1. Goal

Provide a **single-command deployment** for the full Tamma platform:

```bash
# Option A: CLI-generated
tamma init --full-stack
docker compose up -d

# Option B: Direct from registry (no repo clone needed)
curl -sL https://raw.githubusercontent.com/meywd/tamma/main/docker/docker-compose.yml -o docker-compose.yml
curl -sL https://raw.githubusercontent.com/meywd/tamma/main/docker/.env.example -o .env
# Edit .env with API keys
docker compose up -d
```

The full stack includes:

| Service | Role | Technology |
|---------|------|-----------|
| **elsa-server** | ELSA workflow engine (mentorship workflows, activities) | .NET 8.0 |
| **tamma-api-dotnet** | .NET REST API (mentorship, integrations, workflow sync) | .NET 8.0 / ASP.NET |
| **tamma-api** | TypeScript REST API + SSE (engine routes, dashboard, auth) | Node.js 22 / Fastify |
| **tamma-engine** | Autonomous development engine (issue processing pipeline) | Node.js 22 |
| **tamma-dashboard** | Web UI (knowledge base, workflow monitoring) | Vite / React SPA |
| **postgres** | Primary database (ELSA state, mentorship data, analytics) | PostgreSQL 15 |
| **rabbitmq** | Message broker (ELSA distributed messaging) | RabbitMQ 3 + Management |

### Design Principles

- **Zero config to start:** `docker compose up` with sensible dev defaults works immediately.
- **Production-ready profiles:** `docker compose --profile production up` applies resource limits, replicas, and hardened settings.
- **Secret injection, not baking:** No credentials baked into images. Everything via `.env`, environment variables, or Docker secrets.
- **Stateless services, stateful infrastructure:** All application containers are ephemeral; only Postgres and RabbitMQ persist data in volumes.

---

## 2. Current Docker State

### What Already Exists

The `apps/tamma-elsa/` directory contains a functional Docker setup for the ELSA-side of the platform:

| Artifact | Path | Status |
|----------|------|--------|
| Dev compose | `apps/tamma-elsa/docker-compose.yml` | Working, 5 services |
| Prod compose | `apps/tamma-elsa/docker-compose.prod.yml` | Working, uses GHCR images |
| ELSA Server Dockerfile | `apps/tamma-elsa/src/Tamma.ElsaServer/Dockerfile` | Multi-stage .NET 8.0, non-root user |
| .NET API Dockerfile | `apps/tamma-elsa/src/Tamma.Api/Dockerfile` | Multi-stage .NET 8.0, non-root user |
| Activities Dockerfile | `apps/tamma-elsa/src/Tamma.Activities/Dockerfile` | Multi-stage .NET 8.0 (library, not a service) |
| DB init script | `apps/tamma-elsa/scripts/init-db.sql` | Schema, indexes, views, triggers, sample data |
| Dev scripts | `apps/tamma-elsa/scripts/start-dev.sh`, `stop-dev.sh` | Shell wrappers |

### What Works

- ELSA Server builds and runs in Docker with Postgres + RabbitMQ dependencies.
- .NET API (Tamma.Api) builds as a Docker image, connects to ELSA and Postgres.
- Health checks are defined for all existing services.
- The production compose file uses GHCR images with resource limits and replicas.
- `init-db.sql` creates the full mentorship schema on first Postgres start.

### What Is Missing

1. **No TypeScript Dockerfile** -- The `@tamma/api` (Fastify), `@tamma/cli`, and engine have no Dockerfiles. The existing `docker-compose.yml` `tamma-api` service points to the .NET API Dockerfile, not the Node.js API.
2. **No Dashboard Dockerfile** -- The existing compose references `./src/Tamma.Dashboard/Dockerfile` which does not exist (there is no `Tamma.Dashboard` directory in the .NET project). The actual dashboard is `packages/dashboard/` (Vite/React SPA).
3. **No Engine Container** -- The `TammaEngine` (polling loop, Claude agent integration) has no container definition. In the current model it only runs via `tamma start` (CLI) or `tamma server` (embedded Fastify).
4. **Naming Confusion** -- The existing compose uses `tamma-api` for the .NET API, but the TypeScript codebase also has a `@tamma/api` package (Fastify). The full-stack compose must disambiguate these.
5. **No `.env.example`** -- Users must know which env vars to set by reading compose files.
6. **No GHCR push workflow for TS images** -- CI only runs tests; no image builds.
7. **No `docker/` top-level directory** -- The compose files live inside `apps/tamma-elsa/`, which makes them hard to discover for new users.
8. **WorkflowSyncService connectivity** -- The .NET `WorkflowSyncService` needs `TammaServer:Url` configured to reach the TS API, but this is empty by default in `appsettings.json`.

---

## 3. Service Architecture

### 3.1 Service Inventory

```
                                  +------------------+
                                  |   User Browser   |
                                  +--------+---------+
                                           |
                          :3001 (dashboard) | :3100 (TS API) | :3000 (.NET API)
                                           |
                    +----------+-----------+----------+
                    |          |                      |
           +--------v---+ +---v---------+    +-------v--------+
           |  Dashboard |  | tamma-api   |    | tamma-api-     |
           |  (nginx)   |  | (Fastify)   |    | dotnet (ASP)   |
           +------------+  +------+------+    +---+-----+------+
                                  |               |     |
                            +-----v-----+    +---v-+  +-v---------+
                            |  tamma-   |    |ELSA |  | Workflow   |
                            |  engine   |    |Srvr |  | SyncSvc   |
                            |  (Node)   |    |(.NET)|  | (bg task) |
                            +-----+-----+    +--+--+  +-----------+
                                  |              |
                        +---------v---+    +-----v-----+
                        | GitHub API  |    | RabbitMQ   |
                        | (external)  |    +-----+------+
                        +-------------+          |
                                           +-----v-----+
                                           | Postgres   |
                                           +-----------+
```

### 3.2 Service Details

| Service | Image | Internal Port | Exposed Port | Depends On |
|---------|-------|--------------|--------------|------------|
| `postgres` | `postgres:15-alpine` | 5432 | 5432 (dev) / none (prod) | -- |
| `rabbitmq` | `rabbitmq:3-management-alpine` | 5672, 15672 | 5672, 15672 (dev) / none (prod) | -- |
| `elsa-server` | `ghcr.io/meywd/tamma-elsa:latest` | 5000 | 5000 (dev) / none (prod) | postgres, rabbitmq |
| `tamma-api-dotnet` | `ghcr.io/meywd/tamma-api-dotnet:latest` | 3000 | 3000 | elsa-server, postgres |
| `tamma-api` | `ghcr.io/meywd/tamma-api:latest` | 3100 | 3100 | postgres |
| `tamma-engine` | `ghcr.io/meywd/tamma-engine:latest` | -- | -- | tamma-api |
| `tamma-dashboard` | `ghcr.io/meywd/tamma-dashboard:latest` | 80 | 3001 | tamma-api |

### 3.3 Network Topology

All services join a single Docker bridge network (`tamma-net`). Services reference each other by service name (Docker's built-in DNS).

**Key internal routes:**

| From | To | URL | Protocol |
|------|----|-----|----------|
| tamma-api-dotnet | elsa-server | `http://elsa-server:5000` | REST |
| tamma-api-dotnet | postgres | `Server=postgres;Port=5432` | Npgsql |
| tamma-api-dotnet (WorkflowSyncService) | tamma-api | `http://tamma-api:3100` | REST |
| elsa-server | postgres | `Server=postgres;Port=5432` | Npgsql |
| elsa-server | rabbitmq | `rabbitmq:5672` | AMQP |
| tamma-engine | tamma-api | `http://tamma-api:3100` | REST/SSE |
| tamma-engine | GitHub API | `https://api.github.com` | REST |
| tamma-engine | Anthropic API | `https://api.anthropic.com` | REST |
| tamma-dashboard (browser) | tamma-api | `http://localhost:3100` | REST/SSE |
| tamma-dashboard (browser) | tamma-api-dotnet | `http://localhost:3000` | REST |

### 3.4 Port Mapping Summary

| Port | Service | Purpose |
|------|---------|---------|
| 3000 | tamma-api-dotnet | .NET REST API (mentorship, ELSA integration) |
| 3001 | tamma-dashboard | Web dashboard |
| 3100 | tamma-api | TypeScript REST API + SSE (engine, workflows, KB) |
| 5000 | elsa-server | ELSA workflow engine |
| 5432 | postgres | PostgreSQL (dev only) |
| 5672 | rabbitmq | AMQP (dev only) |
| 15672 | rabbitmq | RabbitMQ management UI (dev only) |

### 3.5 Volume Strategy

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `tamma-pg-data` | `/var/lib/postgresql/data` | Postgres persistent storage |
| `tamma-rmq-data` | `/var/lib/rabbitmq` | RabbitMQ persistent queues |
| `tamma-elsa-storage` | `/app/storage` | ELSA workflow state files |
| `tamma-engine-workdir` | `/workspace` | Git clones, agent temp files |
| `tamma-logs` | `/app/logs` | Shared log directory (optional) |

### 3.6 Health Checks

| Service | Health Check | Interval | Start Period |
|---------|-------------|----------|-------------|
| postgres | `pg_isready -U tamma -d tamma` | 10s | 15s |
| rabbitmq | `rabbitmq-diagnostics -q ping` | 30s | 30s |
| elsa-server | `curl -f http://localhost:5000/health` | 30s | 40s |
| tamma-api-dotnet | `curl -f http://localhost:3000/health` | 30s | 30s |
| tamma-api | `wget --no-verbose --tries=1 --spider http://localhost:3100/api/health` | 15s | 20s |
| tamma-engine | Custom: check that the engine process is alive | 30s | 60s |
| tamma-dashboard | `wget --no-verbose --tries=1 --spider http://localhost:80/` | 30s | 10s |

Note: TS containers use `wget` instead of `curl` because the slim Node.js base images do not include curl (and adding it increases image size and attack surface). An alternative is to use a small Node.js HTTP check script.

### 3.7 Startup Order and Dependency Graph

```
Level 0:  postgres, rabbitmq             (infrastructure, no deps)
Level 1:  elsa-server                    (depends_on: postgres [healthy], rabbitmq [healthy])
Level 2:  tamma-api-dotnet               (depends_on: elsa-server [healthy], postgres [healthy])
Level 3:  tamma-api                      (depends_on: postgres [healthy])
Level 4:  tamma-engine                   (depends_on: tamma-api [healthy])
Level 4:  tamma-dashboard                (depends_on: tamma-api [started])
```

The engine starts last because it needs both the TS API (for registration/SSE) and external connectivity (GitHub, Anthropic). The dashboard starts as soon as the API is available.

---

## 4. Dockerfiles

### 4.1 TypeScript Monorepo Dockerfile (Engine + API)

A single multi-stage Dockerfile at `docker/Dockerfile.ts` builds both `tamma-api` and `tamma-engine` from the same monorepo context. Target stages select which entrypoint to use.

```dockerfile
# ===========================================================================
# Stage 1: Install dependencies with pnpm
# ===========================================================================
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy lockfile and workspace config first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/platforms/package.json packages/platforms/
COPY packages/providers/package.json packages/providers/
COPY packages/observability/package.json packages/observability/
COPY packages/events/package.json packages/events/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/

RUN pnpm install --frozen-lockfile --prod=false

# ===========================================================================
# Stage 2: Build TypeScript
# ===========================================================================
FROM deps AS build
WORKDIR /app

# Copy source code
COPY packages/ packages/
COPY tsconfig.json ./

# Build all packages in dependency order
RUN pnpm run build

# Prune dev dependencies for smaller production image
RUN pnpm prune --prod

# ===========================================================================
# Stage 3a: tamma-api runtime
# ===========================================================================
FROM node:22-alpine AS tamma-api
RUN apk add --no-cache tini wget
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S tamma && adduser -S tamma -G tamma -u 1001
COPY --from=build --chown=tamma:tamma /app/node_modules ./node_modules
COPY --from=build --chown=tamma:tamma /app/packages ./packages
COPY --from=build --chown=tamma:tamma /app/package.json ./

RUN mkdir -p /app/logs && chown tamma:tamma /app/logs

USER tamma
EXPOSE 3100
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/cli/dist/index.js", "server", "--port", "3100", "--host", "0.0.0.0"]

# ===========================================================================
# Stage 3b: tamma-engine runtime
# ===========================================================================
FROM node:22-alpine AS tamma-engine
RUN apk add --no-cache tini git wget
WORKDIR /app

RUN addgroup -g 1001 -S tamma && adduser -S tamma -G tamma -u 1001
COPY --from=build --chown=tamma:tamma /app/node_modules ./node_modules
COPY --from=build --chown=tamma:tamma /app/packages ./packages
COPY --from=build --chown=tamma:tamma /app/package.json ./

# The engine needs a workspace directory for git operations
RUN mkdir -p /workspace /app/logs && \
    chown -R tamma:tamma /workspace /app/logs

USER tamma
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD test -f /tmp/tamma-engine-healthy || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/cli/dist/index.js", "start", "--mode", "service"]
```

**Build commands:**

```bash
# Build API image
docker build --target tamma-api -t ghcr.io/meywd/tamma-api:latest -f docker/Dockerfile.ts .

# Build Engine image
docker build --target tamma-engine -t ghcr.io/meywd/tamma-engine:latest -f docker/Dockerfile.ts .
```

### 4.2 Dashboard Dockerfile

```dockerfile
# ===========================================================================
# Stage 1: Build the Vite React app
# ===========================================================================
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared/ packages/shared/
COPY packages/dashboard/ packages/dashboard/
COPY tsconfig.json ./

RUN pnpm --filter @tamma/dashboard run build

# ===========================================================================
# Stage 2: Serve with nginx
# ===========================================================================
FROM nginx:1.27-alpine AS runtime

# Custom nginx config for SPA routing
COPY docker/nginx-dashboard.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html

# Non-root
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
```

**nginx-dashboard.conf** (placed at `docker/nginx-dashboard.conf`):

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback: serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy (so the SPA can use relative /api/ paths)
    location /api/ {
        proxy_pass http://tamma-api:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;     # Required for SSE
        proxy_cache off;
    }

    # .NET API proxy for mentorship/ELSA endpoints
    location /elsa-api/ {
        proxy_pass http://tamma-api-dotnet:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4.3 Existing ELSA Dockerfiles (Minimal Changes)

The existing `.NET` Dockerfiles in `apps/tamma-elsa/src/` are well-structured. The only changes needed:

1. **Tamma.ElsaServer/Dockerfile** -- No changes needed. Already multi-stage with non-root user.
2. **Tamma.Api/Dockerfile** -- No changes needed. Already multi-stage with non-root user.
3. **Tamma.Activities/Dockerfile** -- This is a library build, not a runnable service. It should be excluded from the compose services. The Activities are compiled into the ElsaServer image as a dependency.

### 4.4 Base Image Choices and Security Hardening

| Image | Base | Rationale |
|-------|------|-----------|
| TS apps | `node:22-alpine` | Smallest official Node.js image with musl; matches `engines.node: ">=22"` in package.json |
| .NET apps | `mcr.microsoft.com/dotnet/aspnet:8.0` | Official Microsoft runtime; matches `net8.0` target |
| Dashboard | `nginx:1.27-alpine` | Production-grade static file serving |
| Postgres | `postgres:15-alpine` | Matches existing compose; alpine for size |
| RabbitMQ | `rabbitmq:3-management-alpine` | Management plugin needed for monitoring |

**Security hardening applied across all custom images:**

- Non-root user (`tamma` UID 1001 for TS, built-in `nginx` for dashboard)
- `tini` as PID 1 for proper signal handling in Node.js containers
- `--no-cache` / `rm -rf /var/lib/apt/lists/*` to minimize layer size
- No `curl` in production TS images (use `wget` from Alpine base or Node.js health scripts)
- Read-only root filesystem compatible (volumes for writable paths)
- No `COPY . .` of entire repo -- only specific package directories

---

## 5. Docker Compose Configuration

### 5.1 Full docker-compose.yml

This file lives at the repository root: `docker/docker-compose.yml`.

```yaml
# Tamma Full-Stack Docker Compose
# Usage: docker compose -f docker/docker-compose.yml up -d

name: tamma

services:
  # ---------------------------------------------------------------------------
  # Infrastructure
  # ---------------------------------------------------------------------------
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-tamma}
      POSTGRES_USER: ${POSTGRES_USER:-tamma}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tamma_dev_only}
    volumes:
      - tamma-pg-data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    networks:
      - tamma-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-tamma} -d ${POSTGRES_DB:-tamma}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    restart: unless-stopped

  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-tamma}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-tamma_dev_only}
    volumes:
      - tamma-rmq-data:/var/lib/rabbitmq
    networks:
      - tamma-net
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    ports:
      - "${RABBITMQ_PORT:-5672}:5672"
      - "${RABBITMQ_MGMT_PORT:-15672}:15672"
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # ELSA Workflow Engine (.NET)
  # ---------------------------------------------------------------------------
  elsa-server:
    image: ${TAMMA_REGISTRY:-ghcr.io/meywd}/tamma-elsa:${TAMMA_VERSION:-latest}
    build:
      context: ../apps/tamma-elsa/src
      dockerfile: Tamma.ElsaServer/Dockerfile
    environment:
      - ASPNETCORE_ENVIRONMENT=${ASPNETCORE_ENVIRONMENT:-Development}
      - ConnectionStrings__DefaultConnection=Server=postgres;Port=5432;Database=${POSTGRES_DB:-tamma};User Id=${POSTGRES_USER:-tamma};Password=${POSTGRES_PASSWORD:-tamma_dev_only};
      - Elsa__Identity__SigningKey=${ELSA_SIGNING_KEY:-sufficiently-long-secret-signing-key-for-elsa-jwt-tokens-min-32-chars}
      - RabbitMq__HostName=rabbitmq
      - RabbitMq__Username=${RABBITMQ_USER:-tamma}
      - RabbitMq__Password=${RABBITMQ_PASSWORD:-tamma_dev_only}
      - Elsa__Server__BaseUrl=http://elsa-server:5000
      - Logging__LogLevel__Default=${ELSA_LOG_LEVEL:-Information}
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    volumes:
      - tamma-elsa-storage:/app/storage
    networks:
      - tamma-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    ports:
      - "${ELSA_PORT:-5000}:5000"
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # .NET API (Mentorship, Integrations, Workflow Sync)
  # ---------------------------------------------------------------------------
  tamma-api-dotnet:
    image: ${TAMMA_REGISTRY:-ghcr.io/meywd}/tamma-api-dotnet:${TAMMA_VERSION:-latest}
    build:
      context: ../apps/tamma-elsa/src
      dockerfile: Tamma.Api/Dockerfile
    environment:
      - ASPNETCORE_ENVIRONMENT=${ASPNETCORE_ENVIRONMENT:-Development}
      - ConnectionStrings__DefaultConnection=Server=postgres;Port=5432;Database=${POSTGRES_DB:-tamma};User Id=${POSTGRES_USER:-tamma};Password=${POSTGRES_PASSWORD:-tamma_dev_only};
      - Elsa__ServerUrl=http://elsa-server:5000
      - Elsa__ApiKey=${ELSA_API_KEY:-}
      - GitHub__Token=${GITHUB_TOKEN:-}
      - GitHub__Owner=${GITHUB_OWNER:-}
      - GitHub__Repo=${GITHUB_REPO:-}
      - Anthropic__ApiKey=${ANTHROPIC_API_KEY:-}
      - Dashboard__Url=http://tamma-dashboard:80
      - TammaServer__Url=http://tamma-api:3100
      - WorkflowSync__PollIntervalSeconds=${WORKFLOW_SYNC_INTERVAL:-30}
      - Logging__LogLevel__Default=${DOTNET_LOG_LEVEL:-Information}
    depends_on:
      elsa-server:
        condition: service_healthy
      postgres:
        condition: service_healthy
    networks:
      - tamma-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    ports:
      - "${DOTNET_API_PORT:-3000}:3000"
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # TypeScript API (Engine Routes, Dashboard API, Knowledge Base)
  # ---------------------------------------------------------------------------
  tamma-api:
    image: ${TAMMA_REGISTRY:-ghcr.io/meywd}/tamma-api:${TAMMA_VERSION:-latest}
    build:
      context: ..
      dockerfile: docker/Dockerfile.ts
      target: tamma-api
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - PORT=3100
      - HOST=0.0.0.0
      - GITHUB_TOKEN=${GITHUB_TOKEN:-}
      - GITHUB_OWNER=${GITHUB_OWNER:-}
      - GITHUB_REPO=${GITHUB_REPO:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - TAMMA_ENABLE_AUTH=${TAMMA_ENABLE_AUTH:-false}
      - TAMMA_JWT_SECRET=${TAMMA_JWT_SECRET:-dev-jwt-secret-change-in-production}
      - TAMMA_LOG_LEVEL=${TAMMA_LOG_LEVEL:-info}
      - ELSA_SERVER_URL=http://elsa-server:5000
      - ELSA_API_KEY=${ELSA_API_KEY:-}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - tamma-net
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3100/api/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
    ports:
      - "${TS_API_PORT:-3100}:3100"
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # Tamma Engine (Autonomous Dev Agent)
  # ---------------------------------------------------------------------------
  tamma-engine:
    image: ${TAMMA_REGISTRY:-ghcr.io/meywd}/tamma-engine:${TAMMA_VERSION:-latest}
    build:
      context: ..
      dockerfile: docker/Dockerfile.ts
      target: tamma-engine
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_OWNER=${GITHUB_OWNER}
      - GITHUB_REPO=${GITHUB_REPO}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TAMMA_MODE=${TAMMA_MODE:-standalone}
      - TAMMA_APPROVAL_MODE=${TAMMA_APPROVAL_MODE:-auto}
      - TAMMA_POLL_INTERVAL_MS=${TAMMA_POLL_INTERVAL_MS:-300000}
      - TAMMA_WORKING_DIR=/workspace
      - TAMMA_API_URL=http://tamma-api:3100
      - TAMMA_LOG_LEVEL=${TAMMA_LOG_LEVEL:-info}
      - TAMMA_AGENT_MODEL=${TAMMA_AGENT_MODEL:-claude-sonnet-4-20250514}
      - TAMMA_MAX_BUDGET_USD=${TAMMA_MAX_BUDGET_USD:-5.0}
      - TAMMA_MERGE_STRATEGY=${TAMMA_MERGE_STRATEGY:-squash}
      - TAMMA_ISSUE_LABELS=${TAMMA_ISSUE_LABELS:-tamma}
      - TAMMA_EXCLUDE_LABELS=${TAMMA_EXCLUDE_LABELS:-wontfix,duplicate}
      - TAMMA_BOT_USERNAME=${TAMMA_BOT_USERNAME:-tamma-bot}
    depends_on:
      tamma-api:
        condition: service_healthy
    volumes:
      - tamma-engine-workdir:/workspace
    networks:
      - tamma-net
    restart: unless-stopped

  # ---------------------------------------------------------------------------
  # Dashboard (React SPA via nginx)
  # ---------------------------------------------------------------------------
  tamma-dashboard:
    image: ${TAMMA_REGISTRY:-ghcr.io/meywd}/tamma-dashboard:${TAMMA_VERSION:-latest}
    build:
      context: ..
      dockerfile: docker/Dockerfile.dashboard
    depends_on:
      tamma-api:
        condition: service_started
    networks:
      - tamma-net
    ports:
      - "${DASHBOARD_PORT:-3001}:80"
    restart: unless-stopped

# ---------------------------------------------------------------------------
# Volumes
# ---------------------------------------------------------------------------
volumes:
  tamma-pg-data:
    driver: local
  tamma-rmq-data:
    driver: local
  tamma-elsa-storage:
    driver: local
  tamma-engine-workdir:
    driver: local

# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------
networks:
  tamma-net:
    driver: bridge
```

### 5.2 Environment Variable Reference (.env.example)

```bash
# =============================================================================
# Tamma Full-Stack Configuration
# Copy this file to .env and fill in required values.
# =============================================================================

# --- Required: API Keys ---
GITHUB_TOKEN=ghp_your_github_token_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here

# --- Required: GitHub Repository ---
GITHUB_OWNER=your-org-or-user
GITHUB_REPO=your-repo

# --- Database ---
POSTGRES_DB=tamma
POSTGRES_USER=tamma
POSTGRES_PASSWORD=change_this_in_production
# POSTGRES_PORT=5432

# --- RabbitMQ ---
RABBITMQ_USER=tamma
RABBITMQ_PASSWORD=change_this_in_production
# RABBITMQ_PORT=5672
# RABBITMQ_MGMT_PORT=15672

# --- ELSA ---
ELSA_SIGNING_KEY=generate-a-long-random-string-at-least-32-characters
# ELSA_API_KEY=
# ELSA_PORT=5000

# --- Engine ---
TAMMA_MODE=standalone
TAMMA_APPROVAL_MODE=auto               # auto | cli
TAMMA_POLL_INTERVAL_MS=300000           # 5 minutes
TAMMA_AGENT_MODEL=claude-sonnet-4-20250514
TAMMA_MAX_BUDGET_USD=5.0
TAMMA_MERGE_STRATEGY=squash            # squash | merge | rebase
TAMMA_ISSUE_LABELS=tamma
TAMMA_EXCLUDE_LABELS=wontfix,duplicate
TAMMA_BOT_USERNAME=tamma-bot
# TAMMA_LOG_LEVEL=info

# --- Auth ---
TAMMA_ENABLE_AUTH=false
TAMMA_JWT_SECRET=generate-with-openssl-rand-base64-32

# --- Image Registry (for pre-built images) ---
# TAMMA_REGISTRY=ghcr.io/meywd
# TAMMA_VERSION=latest

# --- Port Overrides ---
# DOTNET_API_PORT=3000
# TS_API_PORT=3100
# DASHBOARD_PORT=3001

# --- .NET API ---
# ASPNETCORE_ENVIRONMENT=Development
# DOTNET_LOG_LEVEL=Information
# WORKFLOW_SYNC_INTERVAL=30
```

### 5.3 Development vs Production Profiles

Rather than maintaining two separate compose files, use Docker Compose profiles and an override file.

**`docker/docker-compose.override.yml`** (auto-loaded in dev):

```yaml
# Development overrides: exposed ports, debug logging, volume mounts for hot reload
services:
  postgres:
    ports:
      - "5432:5432"

  rabbitmq:
    ports:
      - "5672:5672"
      - "15672:15672"

  elsa-server:
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - Logging__LogLevel__Default=Debug
    ports:
      - "5000:5000"

  tamma-api-dotnet:
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
    ports:
      - "3000:3000"

  tamma-api:
    environment:
      - NODE_ENV=development
      - TAMMA_LOG_LEVEL=debug
```

**`docker/docker-compose.prod.yml`** (explicit for production):

```yaml
# Production overrides: resource limits, replicas, restricted ports
services:
  postgres:
    ports: []       # No external exposure
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2G
        reservations:
          cpus: "0.5"
          memory: 512M

  rabbitmq:
    ports: []
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G

  elsa-server:
    ports: []
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 5
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
        reservations:
          cpus: "0.5"
          memory: 512M

  tamma-api-dotnet:
    ports: []
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: "0.5"
          memory: 512M

  tamma-api:
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: "0.5"
          memory: 512M

  tamma-engine:
    deploy:
      restart_policy:
        condition: on-failure
        delay: 10s
        max_attempts: 5
      resources:
        limits:
          cpus: "1.0"
          memory: 1G

  tamma-dashboard:
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "0.25"
          memory: 256M
```

**Usage:**

```bash
# Development (default)
docker compose -f docker/docker-compose.yml up -d

# Production
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d
```

### 5.4 Resource Limits Summary (Production)

| Service | CPU Limit | Memory Limit | Replicas |
|---------|-----------|-------------|----------|
| postgres | 2.0 | 2 GB | 1 |
| rabbitmq | 1.0 | 1 GB | 1 |
| elsa-server | 1.0 | 1 GB | 2 |
| tamma-api-dotnet | 0.5 | 512 MB | 2 |
| tamma-api | 0.5 | 512 MB | 2 |
| tamma-engine | 1.0 | 1 GB | 1 |
| tamma-dashboard | 0.25 | 256 MB | 2 |
| **Total** | **6.75** | **7.5 GB** | -- |

---

## 6. Image Registry

### 6.1 GitHub Container Registry Setup

All images are pushed to `ghcr.io` under the repository owner's namespace.

| Image | Full Tag |
|-------|----------|
| ELSA Server | `ghcr.io/meywd/tamma-elsa:latest` |
| .NET API | `ghcr.io/meywd/tamma-api-dotnet:latest` |
| TS API | `ghcr.io/meywd/tamma-api:latest` |
| TS Engine | `ghcr.io/meywd/tamma-engine:latest` |
| Dashboard | `ghcr.io/meywd/tamma-dashboard:latest` |

### 6.2 Tagging Strategy

Every image is tagged with three forms:

| Tag | Example | Purpose |
|-----|---------|---------|
| `latest` | `ghcr.io/meywd/tamma-api:latest` | Most recent build from `main` |
| `semver` | `ghcr.io/meywd/tamma-api:0.2.0` | Release tag; immutable |
| `sha` | `ghcr.io/meywd/tamma-api:sha-3610115` | Exact commit; for debugging |

Tags from branches other than `main` use the pattern `branch-<name>-<sha>` (e.g., `branch-feat-engine-mvp-3610115`).

### 6.3 GitHub Actions Workflow for Image Builds

New file: `.github/workflows/docker-publish.yml`

```yaml
name: Build & Publish Docker Images

on:
  push:
    branches: [main]
    tags: ["v*.*.*"]
  pull_request:
    branches: [main]

concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  OWNER: meywd

permissions:
  contents: read
  packages: write

jobs:
  # -------------------------------------------------------------------------
  # TypeScript images (API + Engine)
  # -------------------------------------------------------------------------
  build-ts:
    name: Build TS Images
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target: [tamma-api, tamma-engine]
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.OWNER }}/${{ matrix.target }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile.ts
          target: ${{ matrix.target }}
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # -------------------------------------------------------------------------
  # .NET images (ELSA Server + .NET API)
  # -------------------------------------------------------------------------
  build-dotnet:
    name: Build .NET Images
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - name: tamma-elsa
            context: apps/tamma-elsa/src
            dockerfile: Tamma.ElsaServer/Dockerfile
          - name: tamma-api-dotnet
            context: apps/tamma-elsa/src
            dockerfile: Tamma.Api/Dockerfile
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.OWNER }}/${{ matrix.name }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.context }}/${{ matrix.dockerfile }}
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # -------------------------------------------------------------------------
  # Dashboard image
  # -------------------------------------------------------------------------
  build-dashboard:
    name: Build Dashboard Image
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.OWNER }}/tamma-dashboard
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile.dashboard
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 7. CLI Integration

### 7.1 `tamma init --full-stack`

Generates a ready-to-use Docker deployment in the current directory.

**Behavior:**

```
$ tamma init --full-stack

 Tamma Full-Stack Installer

 [1/4] Generating docker-compose.yml...         done
 [2/4] Generating .env from template...          done
 [3/4] Copying init-db.sql...                    done
 [4/4] Copying nginx config...                   done

 Created:
   ./docker-compose.yml
   ./.env
   ./init-db.sql
   ./nginx-dashboard.conf

 Next steps:
   1. Edit .env and set GITHUB_TOKEN and ANTHROPIC_API_KEY
   2. Run: docker compose up -d
   3. Open http://localhost:3001 for the dashboard
   4. View logs: docker compose logs -f tamma-engine
```

**Implementation approach:**

The CLI command embeds the compose file, `.env.example`, `init-db.sql`, and `nginx-dashboard.conf` as string templates. It writes them to the current directory, prompts the user for required secrets if running interactively, and writes them to `.env`.

```typescript
// packages/cli/src/commands/init-fullstack.ts

export async function initFullStackCommand(options: { dir?: string }): Promise<void> {
  const targetDir = options.dir ?? process.cwd();

  // Write docker-compose.yml (embedded template)
  writeFileSync(join(targetDir, 'docker-compose.yml'), COMPOSE_TEMPLATE);

  // Write .env from .env.example template
  writeFileSync(join(targetDir, '.env'), ENV_TEMPLATE);

  // Write supporting files
  writeFileSync(join(targetDir, 'init-db.sql'), INIT_DB_SQL);
  writeFileSync(join(targetDir, 'nginx-dashboard.conf'), NGINX_CONF);

  // Interactive prompt for required secrets (if TTY)
  if (process.stdin.isTTY) {
    await promptAndWriteSecrets(join(targetDir, '.env'));
  }
}
```

The compose file generated by `init --full-stack` uses pre-built images (no `build:` directives) so users do not need the source code:

```yaml
services:
  tamma-api:
    image: ghcr.io/meywd/tamma-api:latest
    # no build: section
```

### 7.2 Relationship to `tamma server`

| Mode | How it runs | Transport | Use case |
|------|-------------|-----------|----------|
| `tamma start` | CLI process, Ink UI | InProcessTransport | Developer on their machine |
| `tamma server` | Fastify HTTP server | REST + SSE (RemoteTransport) | Headless server, remote dashboard |
| Docker full-stack | `tamma-api` + `tamma-engine` containers | REST + SSE between containers | Production deployment |

In Docker mode, the `tamma-engine` container runs the equivalent of `tamma start --mode service` which:
1. Creates a `TammaEngine` instance.
2. Registers with the `tamma-api` container (engine registry).
3. Runs the polling loop (`engine.run()`).
4. Uses `auto` approval mode (no TTY available).

The `tamma-api` container runs `tamma server --port 3100`, hosting the Fastify server with engine routes, dashboard API, and SSE.

### 7.3 Engine-to-ELSA Communication in Docker

When both run in Docker:

```
tamma-engine                    tamma-api (Fastify)              tamma-api-dotnet (.NET)
     |                               |                                |
     |--- REST: start engine ------->|                                |
     |<-- SSE: state updates --------|                                |
     |                               |                                |
     |                               |<-- REST: sync workflows -------|  (WorkflowSyncService)
     |                               |                                |
     |                               |--- REST: start workflow ------>|
     |                               |                                |
     |                               |                    elsa-server |
     |                               |                         |      |
     |                               |                         |<-----|  (ELSA API)
```

The `tamma-api-dotnet` (`.NET API`) has a `WorkflowSyncService` that periodically pushes ELSA workflow definitions and instances to the `tamma-api` (TypeScript) at `http://tamma-api:3100/api/workflows/definitions`. This is already implemented; the Docker compose simply sets `TammaServer__Url=http://tamma-api:3100`.

The `tamma-engine` container communicates exclusively with:
- `tamma-api` for registration and control (HTTP on internal network)
- GitHub API (external, via `GITHUB_TOKEN`)
- Anthropic API (external, via `ANTHROPIC_API_KEY`)

---

## 8. Configuration and Secrets

### 8.1 Secret Categories

| Secret | Required | Used By | Sensitivity |
|--------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | engine, .NET API | High -- repo write access |
| `ANTHROPIC_API_KEY` | Yes | engine, .NET API | High -- billing |
| `POSTGRES_PASSWORD` | Yes | postgres, .NET API, ELSA | Medium |
| `RABBITMQ_PASSWORD` | Yes | rabbitmq, ELSA | Medium |
| `TAMMA_JWT_SECRET` | If auth enabled | TS API | Medium |
| `ELSA_SIGNING_KEY` | Yes | ELSA server | Medium |
| `ELSA_API_KEY` | Optional | .NET API, TS API | Medium |

### 8.2 Secret Delivery Options

**Option 1: `.env` file (recommended for development and small deployments)**

```bash
# .env is gitignored; users create from .env.example
GITHUB_TOKEN=ghp_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
POSTGRES_PASSWORD=strongpassword
```

**Option 2: Docker secrets (recommended for Docker Swarm / production)**

```yaml
services:
  tamma-engine:
    secrets:
      - github_token
      - anthropic_api_key
    environment:
      - GITHUB_TOKEN_FILE=/run/secrets/github_token
      - ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key

secrets:
  github_token:
    external: true
  anthropic_api_key:
    external: true
```

This requires the engine code to support the `_FILE` suffix convention (read secret from file path). This is a standard Docker pattern.

**Option 3: Environment variables (CI/CD, Kubernetes)**

Secrets are injected directly as environment variables by the orchestrator. No `.env` file needed.

### 8.3 Config File Mounting

For advanced configuration, users can mount a `tamma.config.json` into the engine container:

```yaml
services:
  tamma-engine:
    volumes:
      - ./tamma.config.json:/app/tamma.config.json:ro
```

The CLI's `loadConfig()` already reads from this file. Docker environment variables override file values.

---

## 9. Data Persistence

### 9.1 Postgres Data Volume

```yaml
volumes:
  tamma-pg-data:
    driver: local
```

- Contains all ELSA workflow state, mentorship sessions, analytics, and application data.
- Survives `docker compose down` but **not** `docker compose down -v`.
- Backup strategy: `pg_dump` via a scheduled container or cron job.

```bash
# Backup example
docker compose exec postgres pg_dump -U tamma tamma > backup_$(date +%Y%m%d).sql

# Restore example
docker compose exec -T postgres psql -U tamma tamma < backup_20260213.sql
```

### 9.2 RabbitMQ Data Volume

```yaml
volumes:
  tamma-rmq-data:
    driver: local
```

- Contains queue definitions and persistent messages.
- Less critical than Postgres -- can be recreated by restarting services.

### 9.3 Engine Working Directory

```yaml
volumes:
  tamma-engine-workdir:
    driver: local
```

- The engine clones target repositories here for the agent to operate on.
- Ephemeral by nature -- can be wiped without data loss.
- Size depends on target repository size; may need monitoring.
- Consider bind-mounting a host directory for debugging:

```yaml
# Override for debugging
volumes:
  - /tmp/tamma-workspace:/workspace
```

### 9.4 Log Aggregation

All services log to stdout/stderr (Docker best practice). Logs are collected by the Docker logging driver.

```bash
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f tamma-engine

# Since a specific time
docker compose logs --since 2h tamma-engine
```

For persistent log storage, configure the Docker logging driver:

```yaml
# In docker-compose.yml, per service or globally
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"
```

---

## 10. Monitoring and Observability

### 10.1 Container Health Monitoring

Docker's built-in health check system provides the foundation. All services define `HEALTHCHECK` directives.

```bash
# Check health status
docker compose ps

# NAME                STATUS          HEALTH
# tamma-postgres      Up 2 minutes    healthy
# tamma-rabbitmq      Up 2 minutes    healthy
# tamma-elsa-server   Up 1 minute     healthy
# tamma-api-dotnet    Up 1 minute     healthy
# tamma-api           Up 1 minute     healthy
# tamma-engine        Up 30 seconds   starting
# tamma-dashboard     Up 1 minute     healthy
```

### 10.2 Log Aggregation Approach

**Tier 1 (default):** Docker JSON log driver with rotation. View via `docker compose logs`.

**Tier 2 (optional):** Add a Loki + Grafana stack for centralized log search:

```yaml
# docker/docker-compose.monitoring.yml (optional add-on)
services:
  loki:
    image: grafana/loki:3.0
    ports:
      - "3100:3100"  # Note: conflicts with tamma-api port if both enabled
    volumes:
      - loki-data:/loki
    networks:
      - tamma-net

  grafana:
    image: grafana/grafana:11.0
    ports:
      - "3200:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}
    volumes:
      - grafana-data:/var/lib/grafana
    networks:
      - tamma-net

volumes:
  loki-data:
  grafana-data:
```

### 10.3 Optional: Prometheus + Grafana Stack

For production deployments that want metrics:

```yaml
# docker/docker-compose.metrics.yml (optional add-on)
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - tamma-net

  # Scrape targets defined in prometheus.yml:
  # - elsa-server:5000/metrics  (if enabled in ELSA config)
  # - tamma-api-dotnet:3000/metrics  (needs Prometheus middleware)
  # - postgres-exporter:9187
  # - rabbitmq:15692  (Prometheus plugin)
```

This is intentionally separate from the core compose to keep the default deployment simple.

---

## 11. Update Strategy

### 11.1 Standard Update Flow

```bash
# 1. Pull latest images
docker compose -f docker/docker-compose.yml pull

# 2. Recreate containers with new images (zero-downtime for stateless services)
docker compose -f docker/docker-compose.yml up -d

# 3. Verify health
docker compose ps
```

### 11.2 Database Migrations

The .NET API (`Tamma.Api`) applies EF Core migrations on startup:

```csharp
dbContext.Database.Migrate();
```

For the TS side, if Knex migrations are added in the future, the engine container should run migrations before starting:

```dockerfile
CMD ["sh", "-c", "node packages/orchestrator/dist/migrate.js && node packages/cli/dist/index.js start --mode service"]
```

### 11.3 Breaking Changes

When a release includes breaking schema changes:

1. Tag images with semver (e.g., `0.3.0`).
2. Pin `.env` to `TAMMA_VERSION=0.3.0`.
3. Provide migration instructions in release notes.
4. For rollback: `TAMMA_VERSION=0.2.0` + restore DB backup.

### 11.4 Automated Update Script

```bash
#!/bin/bash
# tamma-update.sh
set -euo pipefail

echo "Backing up Postgres..."
docker compose exec -T postgres pg_dump -U tamma tamma > "backup_$(date +%Y%m%d_%H%M%S).sql"

echo "Pulling latest images..."
docker compose pull

echo "Restarting services..."
docker compose up -d

echo "Waiting for health checks..."
sleep 30
docker compose ps

echo "Update complete."
```

---

## 12. Testing Strategy

### 12.1 CI: Build Verification

The `docker-publish.yml` workflow builds all images on every PR (without pushing). This catches:
- Dockerfile syntax errors
- Missing dependencies in multi-stage builds
- Build failures from monorepo structure changes

### 12.2 Smoke Test Workflow

A new CI job that spins up the full stack and verifies basic connectivity:

```yaml
# In .github/workflows/docker-smoke-test.yml
smoke-test:
  name: Docker Smoke Test
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4

    - name: Build all images
      run: docker compose -f docker/docker-compose.yml build

    - name: Start stack
      run: |
        cp docker/.env.example docker/.env
        # Set test-safe values
        echo "GITHUB_TOKEN=test" >> docker/.env
        echo "ANTHROPIC_API_KEY=test" >> docker/.env
        echo "GITHUB_OWNER=test" >> docker/.env
        echo "GITHUB_REPO=test" >> docker/.env
        docker compose -f docker/docker-compose.yml up -d postgres rabbitmq

    - name: Wait for infrastructure
      run: |
        for i in $(seq 1 30); do
          if docker compose -f docker/docker-compose.yml exec postgres pg_isready -U tamma; then
            break
          fi
          sleep 2
        done

    - name: Start application services
      run: docker compose -f docker/docker-compose.yml up -d

    - name: Health check verification
      run: |
        sleep 30
        # Verify infrastructure
        docker compose -f docker/docker-compose.yml exec postgres pg_isready -U tamma
        # Verify TS API
        curl -sf http://localhost:3100/api/health || exit 1
        # Verify .NET API
        curl -sf http://localhost:3000/health || exit 1
        # Verify Dashboard
        curl -sf http://localhost:3001/ || exit 1
        # Verify ELSA (may take longer to start)
        for i in $(seq 1 10); do
          if curl -sf http://localhost:5000/health; then break; fi
          sleep 5
        done

    - name: Collect logs on failure
      if: failure()
      run: docker compose -f docker/docker-compose.yml logs

    - name: Teardown
      if: always()
      run: docker compose -f docker/docker-compose.yml down -v
```

### 12.3 Local Testing Checklist

Manual verification before merging Docker changes:

- [ ] `docker compose build` succeeds for all services
- [ ] `docker compose up -d` starts all services without errors
- [ ] All health checks pass within 2 minutes
- [ ] Dashboard loads at `http://localhost:3001`
- [ ] TS API health endpoint returns `{ "status": "ok" }` at `http://localhost:3100/api/health`
- [ ] .NET API health endpoint returns healthy at `http://localhost:3000/health`
- [ ] ELSA designer accessible at `http://localhost:5000`
- [ ] RabbitMQ management UI accessible at `http://localhost:15672`
- [ ] `docker compose down && docker compose up -d` preserves Postgres data
- [ ] `docker compose logs tamma-engine` shows engine startup
- [ ] `.env` changes are picked up after `docker compose up -d`

---

## 13. Risks and Mitigations

### 13.1 Docker Desktop Licensing

**Risk:** Docker Desktop requires a paid subscription for organizations with >250 employees or >$10M revenue.

**Mitigation:**
- Document alternative runtimes: Podman, Colima (macOS), Rancher Desktop.
- Test compose files with `podman-compose` in CI.
- All Dockerfiles use standard OCI-compatible syntax.

### 13.2 Resource Requirements

**Risk:** The full stack requires significant memory (7.5 GB production, ~4 GB minimum dev).

**Mitigation:**
- Document minimum requirements: 8 GB RAM, 4 CPU cores, 20 GB disk.
- Provide a "lite" profile that omits ELSA + RabbitMQ for users who only need the TS engine:

```bash
docker compose -f docker/docker-compose.yml up -d postgres tamma-api tamma-engine tamma-dashboard
```

- Resource limits prevent any single container from consuming all host resources.

### 13.3 Networking Issues

**Risk:** Port conflicts with services already running on the host (e.g., local Postgres on 5432).

**Mitigation:**
- All ports are configurable via `.env` variables (`POSTGRES_PORT`, `TS_API_PORT`, etc.).
- Document the port mapping table in README and `.env.example`.
- Production mode does not expose infrastructure ports (Postgres, RabbitMQ).

### 13.4 Image Size

**Risk:** Large images slow down pulls and increase registry costs.

**Mitigation:**
- Multi-stage builds keep runtime images lean.
- Alpine-based images where possible.
- Expected sizes: TS images ~200 MB, .NET images ~250 MB, Dashboard ~25 MB.
- Use Docker BuildKit layer caching in CI.

### 13.5 Secret Leakage

**Risk:** API keys in `.env` could be accidentally committed to Git.

**Mitigation:**
- `.env` is listed in `.gitignore` (already standard practice).
- `tamma init --full-stack` generates `.gitignore` if missing.
- `.env.example` uses placeholder values, never real keys.
- Docker images never bake secrets into layers.

### 13.6 Engine Container Requires Git + SSH

**Risk:** The engine container needs `git` and potentially SSH keys to push to repositories.

**Mitigation:**
- `git` is installed in the engine Dockerfile (`apk add git`).
- For HTTPS authentication (default): `GITHUB_TOKEN` is sufficient; the engine uses the GitHub API (not git push directly).
- For SSH authentication (advanced): mount SSH keys as a volume or Docker secret.

### 13.7 ELSA Cold Start

**Risk:** ELSA server takes 40+ seconds to start, delaying dependent services.

**Mitigation:**
- Health check `start_period: 40s` prevents premature failure detection.
- `depends_on` with `condition: service_healthy` ensures downstream services wait.
- Consider a warm-up endpoint or readiness probe.

---

## 14. Implementation Steps

### Phase 1: Foundation (Estimated: 2-3 days)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 1.1 | Create `docker/` directory at repo root | 15 min | None |
| 1.2 | Write `docker/Dockerfile.ts` (multi-stage, API + Engine targets) | 3 hr | None |
| 1.3 | Write `docker/Dockerfile.dashboard` (Vite build + nginx) | 1.5 hr | None |
| 1.4 | Write `docker/nginx-dashboard.conf` | 30 min | None |
| 1.5 | Copy and adapt `init-db.sql` to `docker/init-db.sql` | 15 min | None |
| 1.6 | Write `docker/.env.example` | 30 min | None |
| 1.7 | Verify all 5 images build locally: `docker build` for each | 1 hr | 1.2-1.5 |

### Phase 2: Compose and Connectivity (Estimated: 2-3 days)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 2.1 | Write `docker/docker-compose.yml` (full 7-service stack) | 2 hr | Phase 1 |
| 2.2 | Write `docker/docker-compose.override.yml` (dev defaults) | 30 min | 2.1 |
| 2.3 | Write `docker/docker-compose.prod.yml` (resource limits) | 1 hr | 2.1 |
| 2.4 | Add `_FILE` suffix support to CLI config loader for Docker secrets | 2 hr | None |
| 2.5 | Set `TammaServer__Url` in .NET API to point to TS API container | 30 min | 2.1 |
| 2.6 | Verify `docker compose up -d` starts all services and they become healthy | 2 hr | 2.1-2.5 |
| 2.7 | Test cross-service connectivity (ELSA <-> .NET API, WorkflowSync -> TS API) | 2 hr | 2.6 |

### Phase 3: Engine Containerization (Estimated: 2-3 days)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 3.1 | Add `--mode service` flag to CLI `start` command (headless, auto-approval) | 3 hr | None |
| 3.2 | Engine health check: write `/tmp/tamma-engine-healthy` on successful init | 1 hr | 3.1 |
| 3.3 | Engine container: register with TS API on startup (engine registry) | 2 hr | 3.1 |
| 3.4 | Test engine container processes a mock issue end-to-end | 3 hr | 3.1-3.3 |
| 3.5 | Verify engine container survives restart (picks up from IDLE state) | 1 hr | 3.4 |

### Phase 4: CLI Integration (Estimated: 1-2 days)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 4.1 | Implement `tamma init --full-stack` command | 3 hr | Phase 2 |
| 4.2 | Embed compose template, .env template, init-db.sql, nginx conf as strings | 1 hr | 4.1 |
| 4.3 | Interactive secret prompt in `init --full-stack` | 1.5 hr | 4.1 |
| 4.4 | Test `init --full-stack` generates working stack from scratch | 1 hr | 4.1-4.3 |

### Phase 5: Image Registry and CI (Estimated: 1-2 days)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 5.1 | Write `.github/workflows/docker-publish.yml` | 2 hr | Phase 1 |
| 5.2 | Configure GHCR package visibility (public) | 30 min | 5.1 |
| 5.3 | Verify images push to `ghcr.io/meywd/tamma-*` on merge to main | 1 hr | 5.1-5.2 |
| 5.4 | Write `.github/workflows/docker-smoke-test.yml` | 2 hr | Phase 2 |
| 5.5 | Verify smoke test passes in CI | 1 hr | 5.4 |

### Phase 6: Documentation and Polish (Estimated: 1 day)

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 6.1 | Add `docker/README.md` with quick start, architecture diagram, troubleshooting | 2 hr | Phase 5 |
| 6.2 | Add `.gitignore` entries for `.env`, `docker/*.log` | 15 min | None |
| 6.3 | Update top-level README with Docker quick start section | 30 min | 6.1 |
| 6.4 | Write `tamma-update.sh` convenience script | 30 min | Phase 2 |
| 6.5 | Final review: run full stack from clean `docker compose pull && up` | 1 hr | All |

### Total Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Foundation | 2-3 days |
| Phase 2: Compose and Connectivity | 2-3 days |
| Phase 3: Engine Containerization | 2-3 days |
| Phase 4: CLI Integration | 1-2 days |
| Phase 5: Image Registry and CI | 1-2 days |
| Phase 6: Documentation and Polish | 1 day |
| **Total** | **9-14 days** |

### Files Created / Modified

**New files:**

| File | Purpose |
|------|---------|
| `docker/Dockerfile.ts` | Multi-stage TS build (API + Engine) |
| `docker/Dockerfile.dashboard` | Dashboard build (Vite + nginx) |
| `docker/nginx-dashboard.conf` | nginx config for SPA + API proxy |
| `docker/docker-compose.yml` | Full 7-service stack |
| `docker/docker-compose.override.yml` | Dev overrides |
| `docker/docker-compose.prod.yml` | Production overrides |
| `docker/.env.example` | Environment variable template |
| `docker/init-db.sql` | Database initialization (copy from ELSA) |
| `docker/README.md` | Docker deployment guide |
| `.github/workflows/docker-publish.yml` | Image build and push CI |
| `.github/workflows/docker-smoke-test.yml` | Integration smoke test |
| `packages/cli/src/commands/init-fullstack.ts` | CLI command implementation |

**Modified files:**

| File | Change |
|------|--------|
| `packages/cli/src/commands/registry.ts` | Register `init --full-stack` command |
| `packages/cli/src/commands/start.tsx` | Add `--mode service` flag for headless operation |
| `packages/cli/src/config.ts` | Support `_FILE` suffix for Docker secrets |
| `.gitignore` | Add `docker/.env`, `docker/*.log` |
| `apps/tamma-elsa/src/Tamma.Api/appsettings.json` | Verify `TammaServer:Url` is parameterized |

---

## Appendix: File Locations Reference

Existing files that informed this plan:

| File | Role |
|------|------|
| `/apps/tamma-elsa/docker-compose.yml` | Existing ELSA dev compose |
| `/apps/tamma-elsa/docker-compose.prod.yml` | Existing ELSA prod compose |
| `/apps/tamma-elsa/src/Tamma.ElsaServer/Dockerfile` | ELSA Server Dockerfile |
| `/apps/tamma-elsa/src/Tamma.Api/Dockerfile` | .NET API Dockerfile |
| `/apps/tamma-elsa/src/Tamma.Api/Program.cs` | .NET API startup (EF migrations, service registration) |
| `/apps/tamma-elsa/src/Tamma.Api/appsettings.json` | .NET config (ELSA, Anthropic, GitHub) |
| `/apps/tamma-elsa/src/Tamma.Api/Services/WorkflowSyncService.cs` | Syncs ELSA state to TS API |
| `/apps/tamma-elsa/scripts/init-db.sql` | Database schema |
| `/packages/api/src/index.ts` | Fastify API (createApp, startServer) |
| `/packages/api/src/engine-registry.ts` | Multi-engine registry |
| `/packages/api/src/routes/engine-callback.ts` | ELSA callback routes |
| `/packages/orchestrator/src/engine.ts` | TammaEngine (core pipeline) |
| `/packages/orchestrator/src/elsa-client.ts` | ELSA HTTP client |
| `/packages/orchestrator/src/transports/in-process.ts` | CLI transport |
| `/packages/orchestrator/src/transports/remote.ts` | HTTP/SSE transport |
| `/packages/cli/src/commands/server.ts` | `tamma server` command |
| `/packages/dashboard/package.json` | Dashboard (Vite + React) |
| `/packages/shared/src/types/index.ts` | TammaConfig, ElsaConfig, ServerConfig |
| `/packages/shared/src/contracts/engine-transport.ts` | IEngineTransport interface |
| `/.github/workflows/ci.yml` | Existing CI pipeline |
