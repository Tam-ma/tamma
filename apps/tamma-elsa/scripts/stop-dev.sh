#!/bin/bash
# Tamma ELSA Development Stop Script

set -e

echo "Stopping Tamma ELSA services..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

docker compose down

echo "All services stopped."
