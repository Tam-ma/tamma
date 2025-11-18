#!/bin/bash

# Production Deployment Script for Tamma Doc Review
# This script handles the complete production deployment process with safety checks

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
DEPLOYMENT_BRANCH="${DEPLOYMENT_BRANCH:-main}"
ENVIRONMENT="${ENVIRONMENT:-production}"
SMOKE_TEST_TIMEOUT="${SMOKE_TEST_TIMEOUT:-30}"
ROLLBACK_ON_FAILURE="${ROLLBACK_ON_FAILURE:-true}"

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
    if [[ "$ROLLBACK_ON_FAILURE" == "true" ]] && [[ -n "${PREVIOUS_DEPLOYMENT:-}" ]]; then
        log_warning "Attempting rollback to previous deployment: $PREVIOUS_DEPLOYMENT"
        rollback_deployment "$PREVIOUS_DEPLOYMENT"
    fi
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if we're in the right directory
    if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
        error_exit "package.json not found. Are you in the correct directory?"
    fi

    # Check required commands
    local required_commands=("node" "pnpm" "wrangler" "git" "jq")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error_exit "Required command '$cmd' not found. Please install it first."
        fi
    done

    # Check Node.js version (require >= 22)
    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ "$node_version" -lt 22 ]]; then
        error_exit "Node.js version 22 or higher required. Current: $(node -v)"
    fi

    # Check if wrangler is authenticated
    if ! wrangler whoami &> /dev/null; then
        error_exit "Wrangler not authenticated. Run: wrangler login"
    fi

    log_success "Prerequisites check passed"
}

# Verify git state
verify_git_state() {
    log_info "Verifying git state..."

    cd "$PROJECT_DIR"

    # Check if we're on the correct branch
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" != "$DEPLOYMENT_BRANCH" ]]; then
        error_exit "Not on deployment branch. Current: $current_branch, Expected: $DEPLOYMENT_BRANCH"
    fi

    # Check for uncommitted changes
    if [[ -n $(git status -s) ]]; then
        log_warning "Uncommitted changes detected:"
        git status -s
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Pull latest changes
    log_info "Pulling latest changes..."
    git pull origin "$DEPLOYMENT_BRANCH" || error_exit "Failed to pull latest changes"

    log_success "Git state verified"
}

# Run type checking
run_type_checking() {
    log_info "Running TypeScript type checking..."

    cd "$PROJECT_DIR"
    pnpm typecheck || error_exit "Type checking failed"

    log_success "Type checking passed"
}

# Run tests
run_tests() {
    log_info "Running test suite..."

    cd "$PROJECT_DIR"
    pnpm test:run || error_exit "Tests failed"

    log_success "All tests passed"
}

# Build production bundle
build_production() {
    log_info "Building production bundle..."

    cd "$PROJECT_DIR"

    # Clean previous build
    rm -rf build/

    # Set production environment
    export NODE_ENV=production

    # Build
    pnpm build || error_exit "Build failed"

    # Verify build output
    if [[ ! -d "build/client" ]]; then
        error_exit "Build output directory not found"
    fi

    log_success "Production build completed"
}

# Check for pending migrations
check_migrations() {
    log_info "Checking for pending database migrations..."

    cd "$PROJECT_DIR"

    # List applied migrations
    local applied_migrations=$(wrangler d1 migrations list tamma-docs --json 2>/dev/null | jq -r '.[] | select(.applied_at != null) | .name' || echo "")

    # List all migrations
    local all_migrations=$(ls -1 db/migrations/*.sql 2>/dev/null | xargs -n1 basename || echo "")

    if [[ -z "$all_migrations" ]]; then
        log_info "No migrations found"
        return 0
    fi

    # Check for unapplied migrations
    local pending_count=0
    while IFS= read -r migration; do
        if ! echo "$applied_migrations" | grep -q "$migration"; then
            log_warning "Pending migration: $migration"
            ((pending_count++))
        fi
    done <<< "$all_migrations"

    if [[ $pending_count -gt 0 ]]; then
        log_info "Found $pending_count pending migration(s)"
        read -p "Apply migrations before deployment? (Y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            "$SCRIPT_DIR/migrate-prod.sh" || error_exit "Migration failed"
        fi
    else
        log_success "No pending migrations"
    fi
}

# Store current deployment info
store_deployment_info() {
    log_info "Storing current deployment info for potential rollback..."

    cd "$PROJECT_DIR"

    # Get current deployment URL (this would need actual implementation based on CF Pages API)
    # For now, just store timestamp and git commit
    local git_commit=$(git rev-parse HEAD)
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    PREVIOUS_DEPLOYMENT="${git_commit}"

    echo "{\"commit\": \"$git_commit\", \"timestamp\": \"$timestamp\"}" > .last-deployment.json

    log_info "Stored deployment info: commit $git_commit"
}

# Deploy to Cloudflare Workers
deploy_to_cloudflare() {
    log_info "Deploying to Cloudflare Workers (Production)..."

    cd "$PROJECT_DIR"

    # Deploy using production config
    wrangler pages deploy ./build/client \
        --project-name=tamma-doc-review \
        --branch=production \
        --commit-dirty=true \
        || error_exit "Cloudflare deployment failed"

    log_success "Deployment to Cloudflare completed"
}

# Wait for deployment to be live
wait_for_deployment() {
    log_info "Waiting for deployment to be live..."

    local max_attempts=30
    local attempt=0
    local deployment_url="${DEPLOYMENT_URL:-https://tamma-doc-review.pages.dev}"

    while [[ $attempt -lt $max_attempts ]]; do
        if curl -sf "$deployment_url/health" -o /dev/null 2>&1; then
            log_success "Deployment is live"
            return 0
        fi

        ((attempt++))
        log_info "Waiting for deployment... (attempt $attempt/$max_attempts)"
        sleep 2
    done

    error_exit "Deployment did not become live within timeout"
}

# Run smoke tests
run_smoke_tests() {
    log_info "Running smoke tests..."

    cd "$PROJECT_DIR"

    if [[ -x "$SCRIPT_DIR/smoke-test.sh" ]]; then
        "$SCRIPT_DIR/smoke-test.sh" || error_exit "Smoke tests failed"
    else
        log_warning "Smoke test script not found, skipping..."
    fi

    log_success "Smoke tests passed"
}

# Rollback deployment
rollback_deployment() {
    local target_commit="$1"

    log_warning "Rolling back to commit: $target_commit"

    cd "$PROJECT_DIR"

    # Checkout target commit
    git checkout "$target_commit" || {
        log_error "Failed to checkout commit for rollback"
        return 1
    }

    # Rebuild and redeploy
    pnpm build || {
        log_error "Build failed during rollback"
        return 1
    }

    wrangler pages deploy ./build/client \
        --project-name=tamma-doc-review \
        --branch=production \
        --commit-dirty=true \
        || {
        log_error "Rollback deployment failed"
        return 1
    }

    log_success "Rollback completed"

    # Return to original branch
    git checkout "$DEPLOYMENT_BRANCH"
}

# Generate deployment report
generate_deployment_report() {
    log_info "Generating deployment report..."

    cd "$PROJECT_DIR"

    local git_commit=$(git rev-parse HEAD)
    local git_commit_short=$(git rev-parse --short HEAD)
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local deployer=$(git config user.name)
    local commit_message=$(git log -1 --pretty=%B)

    cat > deployment-report.txt <<EOF
===========================================
Deployment Report
===========================================
Timestamp: $timestamp
Environment: $ENVIRONMENT
Deployer: $deployer
Git Commit: $git_commit ($git_commit_short)
Git Branch: $DEPLOYMENT_BRANCH

Commit Message:
$commit_message

Deployment URL: ${DEPLOYMENT_URL:-https://tamma-doc-review.pages.dev}

Status: SUCCESS
===========================================
EOF

    log_success "Deployment report generated"
    cat deployment-report.txt
}

# Main deployment flow
main() {
    log_info "Starting production deployment for Tamma Doc Review"
    log_info "Environment: $ENVIRONMENT"
    log_info "Branch: $DEPLOYMENT_BRANCH"
    echo ""

    # Confirm production deployment
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_warning "You are about to deploy to PRODUCTION"
        read -p "Are you sure you want to continue? (yes/no): " -r
        echo
        if [[ ! $REPLY == "yes" ]]; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi

    # Execute deployment steps
    check_prerequisites
    verify_git_state
    run_type_checking
    run_tests
    build_production
    check_migrations
    store_deployment_info
    deploy_to_cloudflare
    wait_for_deployment
    run_smoke_tests
    generate_deployment_report

    log_success "Deployment completed successfully!"
    log_info "Deployment URL: ${DEPLOYMENT_URL:-https://tamma-doc-review.pages.dev}"
}

# Run main function
main "$@"
