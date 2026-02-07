#!/bin/bash
# Tamma ELSA Development Startup Script

set -e

echo "========================================"
echo "Tamma ELSA Mentorship Engine - Dev Mode"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo -e "${GREEN}Starting infrastructure services...${NC}"

# Start PostgreSQL and RabbitMQ first
docker compose up -d postgres rabbitmq

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
until docker compose exec -T postgres pg_isready -U tamma -d tamma > /dev/null 2>&1; do
    sleep 1
done
echo -e "${GREEN}PostgreSQL is ready!${NC}"

# Wait for RabbitMQ to be ready
echo -e "${YELLOW}Waiting for RabbitMQ to be ready...${NC}"
until docker compose exec -T rabbitmq rabbitmq-diagnostics -q ping > /dev/null 2>&1; do
    sleep 1
done
echo -e "${GREEN}RabbitMQ is ready!${NC}"

# Run database migrations
echo -e "${YELLOW}Applying database schema...${NC}"
docker compose exec -T postgres psql -U tamma -d tamma -f /docker-entrypoint-initdb.d/init-db.sql || true
echo -e "${GREEN}Database schema applied!${NC}"

# Start remaining services
echo -e "${GREEN}Starting application services...${NC}"
docker compose up -d

echo ""
echo -e "${GREEN}========================================"
echo "Tamma ELSA is now running!"
echo "========================================${NC}"
echo ""
echo "Services:"
echo "  - ELSA Server:    http://localhost:5000"
echo "  - Tamma API:      http://localhost:3000"
echo "  - Dashboard:      http://localhost:3001"
echo "  - PostgreSQL:     localhost:5432"
echo "  - RabbitMQ:       http://localhost:15672 (guest/guest)"
echo ""
echo "API Documentation: http://localhost:3000/swagger"
echo ""
echo "To view logs: docker compose logs -f"
echo "To stop:      docker compose down"
echo ""
