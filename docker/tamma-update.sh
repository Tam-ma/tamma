#!/bin/sh
# =============================================================================
# Tamma Docker Update Script
#
# Backs up the PostgreSQL database, pulls the latest images from GHCR,
# and restarts all services.
#
# Usage:
#   ./tamma-update.sh
# =============================================================================
set -eu

echo "Tamma Docker Update"
echo ""

# Backup Postgres data
echo "Creating Postgres backup..."
docker compose exec postgres pg_dump -U "${POSTGRES_USER:-tamma}" "${POSTGRES_DB:-tamma}" > "backup-$(date +%Y%m%d-%H%M%S).sql" 2>/dev/null || echo "Backup skipped (postgres not running)"

# Pull latest images
echo "Pulling latest images..."
docker compose pull

# Restart services
echo "Restarting services..."
docker compose up -d

echo ""
echo "Update complete! Waiting for health checks..."
docker compose ps
