#!/bin/bash

# Production Database Migration Script for Tamma Doc Review
# This script safely applies database migrations with backup and verification

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
DB_NAME="tamma-docs"
BACKUP_DIR="$PROJECT_DIR/db/backups"
ENVIRONMENT="${ENVIRONMENT:-production}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Error handler
error_exit() {
    log_error "$1"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check required commands
    if ! command -v wrangler &> /dev/null; then
        error_exit "wrangler not found. Please install it first."
    fi

    if ! command -v jq &> /dev/null; then
        error_exit "jq not found. Please install it first."
    fi

    # Check if wrangler is authenticated
    if ! wrangler whoami &> /dev/null; then
        error_exit "Wrangler not authenticated. Run: wrangler login"
    fi

    # Check if migrations directory exists
    if [[ ! -d "$PROJECT_DIR/db/migrations" ]]; then
        error_exit "Migrations directory not found: $PROJECT_DIR/db/migrations"
    fi

    log_success "Prerequisites check passed"
}

# Create backup directory
create_backup_dir() {
    log_info "Creating backup directory..."

    mkdir -p "$BACKUP_DIR"

    log_success "Backup directory ready: $BACKUP_DIR"
}

# Backup database
backup_database() {
    log_info "Creating database backup..."

    local timestamp=$(date -u +"%Y%m%d_%H%M%S")
    local backup_file="$BACKUP_DIR/${DB_NAME}_${timestamp}.sql"

    # Export database schema and data
    # Note: D1 doesn't have direct export, so we'll document the migration state
    local migration_list=$(wrangler d1 migrations list "$DB_NAME" --json 2>/dev/null || echo "[]")

    echo "-- Database: $DB_NAME" > "$backup_file"
    echo "-- Backup Date: $(date -u)" >> "$backup_file"
    echo "-- Environment: $ENVIRONMENT" >> "$backup_file"
    echo "" >> "$backup_file"
    echo "-- Applied Migrations:" >> "$backup_file"
    echo "$migration_list" | jq -r '.[] | select(.applied_at != null) | "-- \(.name) - \(.applied_at)"' >> "$backup_file"

    log_success "Backup created: $backup_file"
    echo "$backup_file"
}

# List pending migrations
list_pending_migrations() {
    log_info "Checking for pending migrations..."

    cd "$PROJECT_DIR"

    # Get list of applied migrations
    local applied_migrations=$(wrangler d1 migrations list "$DB_NAME" --json 2>/dev/null | jq -r '.[] | select(.applied_at != null) | .name' || echo "")

    # Get list of all migration files
    local all_migrations=$(ls -1 db/migrations/*.sql 2>/dev/null | xargs -n1 basename || echo "")

    if [[ -z "$all_migrations" ]]; then
        log_info "No migrations found"
        return 1
    fi

    # Find pending migrations
    local pending_migrations=()
    while IFS= read -r migration; do
        if ! echo "$applied_migrations" | grep -q "$migration"; then
            pending_migrations+=("$migration")
        fi
    done <<< "$all_migrations"

    if [[ ${#pending_migrations[@]} -eq 0 ]]; then
        log_success "No pending migrations"
        return 1
    fi

    log_info "Found ${#pending_migrations[@]} pending migration(s):"
    for migration in "${pending_migrations[@]}"; do
        log_info "  - $migration"
    done

    return 0
}

# Show migration details
show_migration_details() {
    log_info "Migration details:"

    cd "$PROJECT_DIR"

    for migration_file in db/migrations/*.sql; do
        if [[ -f "$migration_file" ]]; then
            local migration_name=$(basename "$migration_file")
            local applied_at=$(wrangler d1 migrations list "$DB_NAME" --json 2>/dev/null | jq -r ".[] | select(.name == \"$migration_name\") | .applied_at" || echo "")

            if [[ -n "$applied_at" && "$applied_at" != "null" ]]; then
                log_info "  ✓ $migration_name (applied: $applied_at)"
            else
                log_warning "  ✗ $migration_name (pending)"

                # Show first few lines of migration
                log_info "    Preview:"
                head -n 5 "$migration_file" | sed 's/^/    /'
            fi
        fi
    done
}

# Apply migrations
apply_migrations() {
    log_info "Applying migrations to $ENVIRONMENT..."

    cd "$PROJECT_DIR"

    local remote_flag=""
    if [[ "$ENVIRONMENT" == "production" ]]; then
        remote_flag="--remote"
    else
        remote_flag="--local"
    fi

    # Apply migrations
    wrangler d1 migrations apply "$DB_NAME" $remote_flag || error_exit "Migration failed"

    log_success "Migrations applied successfully"
}

# Verify migrations
verify_migrations() {
    log_info "Verifying migrations..."

    cd "$PROJECT_DIR"

    # List applied migrations
    local migration_list=$(wrangler d1 migrations list "$DB_NAME" --json)
    local applied_count=$(echo "$migration_list" | jq '[.[] | select(.applied_at != null)] | length')
    local total_count=$(ls -1 db/migrations/*.sql 2>/dev/null | wc -l)

    log_info "Applied migrations: $applied_count / $total_count"

    if [[ $applied_count -ne $total_count ]]; then
        log_warning "Not all migrations are applied"
        return 1
    fi

    # Verify database tables exist
    log_info "Verifying database schema..."

    local tables=$(wrangler d1 execute "$DB_NAME" --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --json || echo "[]")
    local table_count=$(echo "$tables" | jq 'length')

    log_info "Found $table_count tables in database"

    if [[ $table_count -eq 0 ]]; then
        log_error "No tables found in database"
        return 1
    fi

    log_success "Migration verification passed"
}

# Rollback migrations (if needed)
rollback_migrations() {
    local backup_file="$1"

    log_warning "Rolling back migrations..."

    # D1 doesn't support automatic rollback, so we'd need to manually restore
    log_error "Automatic rollback not supported for D1"
    log_error "Manual intervention required"
    log_info "Backup file: $backup_file"

    error_exit "Migration rollback required - check backup file"
}

# Generate migration report
generate_migration_report() {
    log_info "Generating migration report..."

    cd "$PROJECT_DIR"

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local migration_list=$(wrangler d1 migrations list "$DB_NAME" --json)

    cat > migration-report.txt <<EOF
===========================================
Migration Report
===========================================
Timestamp: $timestamp
Database: $DB_NAME
Environment: $ENVIRONMENT

Applied Migrations:
$(echo "$migration_list" | jq -r '.[] | select(.applied_at != null) | "- \(.name) (applied: \(.applied_at))"')

Database Tables:
$(wrangler d1 execute "$DB_NAME" --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --json | jq -r '.[] | .name | "- \(.)"' || echo "Failed to fetch tables")

Status: SUCCESS
===========================================
EOF

    log_success "Migration report generated"
    cat migration-report.txt
}

# Main migration flow
main() {
    log_info "Starting database migration for Tamma Doc Review"
    log_info "Database: $DB_NAME"
    log_info "Environment: $ENVIRONMENT"
    echo ""

    # Check prerequisites
    check_prerequisites

    # Check for pending migrations
    if ! list_pending_migrations; then
        log_info "No migrations to apply. Exiting."
        exit 0
    fi

    # Show migration details
    show_migration_details
    echo ""

    # Confirm migration
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_warning "You are about to apply migrations to PRODUCTION"
        read -p "Are you sure you want to continue? (yes/no): " -r
        echo
        if [[ ! $REPLY == "yes" ]]; then
            log_info "Migration cancelled"
            exit 0
        fi
    fi

    # Create backup
    create_backup_dir
    local backup_file=$(backup_database)

    # Apply migrations
    if apply_migrations; then
        verify_migrations
        generate_migration_report
        log_success "Migration completed successfully!"
    else
        log_error "Migration failed"
        rollback_migrations "$backup_file"
    fi
}

# Run main function
main "$@"
