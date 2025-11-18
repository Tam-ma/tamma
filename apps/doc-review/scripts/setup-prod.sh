#!/bin/bash

# Production Setup Script for Tamma Doc Review
# This script initializes all production resources (D1, KV, R2, secrets)

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
    local required_commands=("wrangler" "jq")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error_exit "Required command '$cmd' not found. Please install it first."
        fi
    done

    # Check if wrangler is authenticated
    if ! wrangler whoami &> /dev/null; then
        error_exit "Wrangler not authenticated. Run: wrangler login"
    fi

    log_success "Prerequisites check passed"
}

# Create D1 database
create_d1_database() {
    log_info "Checking D1 database..."

    local db_name="tamma-docs"

    # Check if database exists
    local db_list=$(wrangler d1 list --json 2>/dev/null || echo "[]")
    local db_exists=$(echo "$db_list" | jq -r ".[] | select(.name == \"$db_name\") | .name" || echo "")

    if [[ -n "$db_exists" ]]; then
        log_success "D1 database '$db_name' already exists"
        local db_id=$(echo "$db_list" | jq -r ".[] | select(.name == \"$db_name\") | .uuid")
        log_info "Database ID: $db_id"
    else
        log_info "Creating D1 database: $db_name"
        local result=$(wrangler d1 create "$db_name" --json)
        local db_id=$(echo "$result" | jq -r '.uuid')

        log_success "D1 database created"
        log_info "Database ID: $db_id"
        log_warning "Update wrangler.production.jsonc with database_id: $db_id"
    fi
}

# Create KV namespace
create_kv_namespace() {
    log_info "Checking KV namespace..."

    local kv_name="tamma-doc-review-cache"

    # Check if namespace exists
    local kv_list=$(wrangler kv namespace list --json 2>/dev/null || echo "[]")
    local kv_exists=$(echo "$kv_list" | jq -r ".[] | select(.title == \"$kv_name\") | .title" || echo "")

    if [[ -n "$kv_exists" ]]; then
        log_success "KV namespace '$kv_name' already exists"
        local kv_id=$(echo "$kv_list" | jq -r ".[] | select(.title == \"$kv_name\") | .id")
        log_info "KV ID: $kv_id"
    else
        log_info "Creating KV namespace: $kv_name"
        local result=$(wrangler kv namespace create "$kv_name" --json)
        local kv_id=$(echo "$result" | jq -r '.id')

        log_success "KV namespace created"
        log_info "KV ID: $kv_id"
        log_warning "Update wrangler.production.jsonc with id: $kv_id"
    fi
}

# Create R2 bucket
create_r2_bucket() {
    log_info "Checking R2 bucket..."

    local bucket_name="tamma-attachments"

    # Check if bucket exists
    local bucket_list=$(wrangler r2 bucket list --json 2>/dev/null || echo "[]")
    local bucket_exists=$(echo "$bucket_list" | jq -r ".[] | select(.name == \"$bucket_name\") | .name" || echo "")

    if [[ -n "$bucket_exists" ]]; then
        log_success "R2 bucket '$bucket_name' already exists"
    else
        log_info "Creating R2 bucket: $bucket_name"
        wrangler r2 bucket create "$bucket_name" || error_exit "Failed to create R2 bucket"

        log_success "R2 bucket created"
        log_warning "Update wrangler.production.jsonc with bucket_name: $bucket_name"
    fi
}

# Apply database migrations
apply_migrations() {
    log_info "Applying database migrations..."

    cd "$PROJECT_DIR"

    local db_name="tamma-docs"

    # Check if migrations directory exists
    if [[ ! -d "db/migrations" ]]; then
        log_warning "No migrations directory found, skipping..."
        return 0
    fi

    # Count migration files
    local migration_count=$(ls -1 db/migrations/*.sql 2>/dev/null | wc -l)
    if [[ $migration_count -eq 0 ]]; then
        log_info "No migrations to apply"
        return 0
    fi

    log_info "Found $migration_count migration(s)"

    # Apply migrations
    wrangler d1 migrations apply "$db_name" --remote || error_exit "Failed to apply migrations"

    log_success "Migrations applied successfully"
}

# Set up secrets
setup_secrets() {
    log_info "Setting up secrets..."

    # Check if .env.production exists
    if [[ ! -f "$PROJECT_DIR/.env.production" ]]; then
        log_warning ".env.production not found"
        log_info "Please create .env.production with required secrets:"
        log_info "  - GITHUB_CLIENT_ID"
        log_info "  - GITHUB_CLIENT_SECRET"
        log_info "  - GITLAB_CLIENT_ID"
        log_info "  - GITLAB_CLIENT_SECRET"
        log_info "  - SESSION_SECRET"
        log_info "  - ENCRYPTION_KEY"
        return 0
    fi

    # Read secrets from .env.production
    log_info "Reading secrets from .env.production..."

    # Function to set secret
    set_secret() {
        local key="$1"
        local value="$2"

        if [[ -n "$value" ]]; then
            echo "$value" | wrangler pages secret put "$key" --project-name=tamma-doc-review > /dev/null
            log_success "Secret '$key' set"
        else
            log_warning "Secret '$key' is empty, skipping..."
        fi
    }

    # Parse and set secrets
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue

        # Remove quotes from value
        value=$(echo "$value" | sed 's/^["'\'']//' | sed 's/["'\'']$//')

        set_secret "$key" "$value"
    done < "$PROJECT_DIR/.env.production"

    log_success "Secrets configured"
}

# Seed initial data
seed_initial_data() {
    log_info "Seeding initial data..."

    local db_name="tamma-docs"

    # Create admin user (if needed)
    log_info "Creating admin user..."

    # Generate a secure session secret if not provided
    local admin_email="${ADMIN_EMAIL:-admin@tamma.dev}"
    local admin_name="${ADMIN_NAME:-Tamma Admin}"

    # Insert admin user
    local sql="INSERT OR IGNORE INTO users (id, email, name, role, created_at, updated_at)
               VALUES (
                   lower(hex(randomblob(16))),
                   '$admin_email',
                   '$admin_name',
                   'admin',
                   datetime('now'),
                   datetime('now')
               );"

    wrangler d1 execute "$db_name" --remote --command="$sql" || log_warning "Failed to create admin user (may already exist)"

    log_success "Initial data seeded"
    log_info "Admin user: $admin_email"
}

# Verify setup
verify_setup() {
    log_info "Verifying setup..."

    local errors=0

    # Check D1 database
    if ! wrangler d1 list --json | jq -e '.[] | select(.name == "tamma-docs")' > /dev/null; then
        log_error "D1 database not found"
        ((errors++))
    fi

    # Check KV namespace
    if ! wrangler kv namespace list --json | jq -e '.[] | select(.title | contains("tamma-doc-review"))' > /dev/null; then
        log_error "KV namespace not found"
        ((errors++))
    fi

    # Check R2 bucket
    if ! wrangler r2 bucket list --json | jq -e '.[] | select(.name == "tamma-attachments")' > /dev/null; then
        log_error "R2 bucket not found"
        ((errors++))
    fi

    if [[ $errors -eq 0 ]]; then
        log_success "Setup verification passed"
    else
        log_error "Setup verification failed with $errors error(s)"
        return 1
    fi
}

# Generate setup report
generate_setup_report() {
    log_info "Generating setup report..."

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Get resource IDs
    local db_id=$(wrangler d1 list --json | jq -r '.[] | select(.name == "tamma-docs") | .uuid' || echo "N/A")
    local kv_id=$(wrangler kv namespace list --json | jq -r '.[] | select(.title | contains("tamma-doc-review")) | .id' || echo "N/A")

    cat > setup-report.txt <<EOF
===========================================
Production Setup Report
===========================================
Timestamp: $timestamp

Resources Created:
- D1 Database: tamma-docs (ID: $db_id)
- KV Namespace: tamma-doc-review-cache (ID: $kv_id)
- R2 Bucket: tamma-attachments

Configuration:
- Project: tamma-doc-review
- Environment: production

Next Steps:
1. Update wrangler.production.jsonc with resource IDs
2. Set up secrets using .env.production
3. Deploy application using deploy-prod.sh
4. Verify deployment at https://tamma-doc-review.pages.dev

Status: SUCCESS
===========================================
EOF

    log_success "Setup report generated"
    cat setup-report.txt
}

# Main setup flow
main() {
    log_info "Starting production setup for Tamma Doc Review"
    echo ""

    # Confirm production setup
    log_warning "You are about to set up PRODUCTION resources"
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo
    if [[ ! $REPLY == "yes" ]]; then
        log_info "Setup cancelled"
        exit 0
    fi

    # Execute setup steps
    check_prerequisites
    create_d1_database
    create_kv_namespace
    create_r2_bucket
    apply_migrations
    setup_secrets
    seed_initial_data
    verify_setup
    generate_setup_report

    log_success "Production setup completed successfully!"
}

# Run main function
main "$@"
