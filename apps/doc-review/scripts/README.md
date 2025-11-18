# Deployment Scripts

This directory contains scripts for deploying and managing the Tamma Doc Review application on Cloudflare Workers.

## Scripts Overview

### 🚀 deploy-prod.sh

Complete production deployment script with safety checks and rollback capability.

```bash
# Standard deployment
./deploy-prod.sh

# Custom options
ENVIRONMENT=staging ./deploy-prod.sh
ROLLBACK_ON_FAILURE=false ./deploy-prod.sh
DEPLOYMENT_BRANCH=develop ./deploy-prod.sh
```

**What it does:**
1. Checks prerequisites (Node.js, pnpm, wrangler)
2. Verifies git state (correct branch, no uncommitted changes)
3. Runs type checking
4. Runs tests
5. Builds production bundle
6. Checks for pending migrations
7. Stores deployment info for rollback
8. Deploys to Cloudflare Workers
9. Waits for deployment to be live
10. Runs smoke tests
11. Generates deployment report
12. Rolls back on failure (if enabled)

**Exit codes:**
- `0`: Deployment successful
- `1`: Deployment failed

---

### ⚙️ setup-prod.sh

Initial production setup script for creating Cloudflare resources.

```bash
# Run setup
./setup-prod.sh
```

**What it does:**
1. Checks prerequisites
2. Creates D1 database (if not exists)
3. Creates KV namespace (if not exists)
4. Creates R2 bucket (if not exists)
5. Applies database migrations
6. Sets up secrets from `.env.production`
7. Seeds initial admin user
8. Verifies setup
9. Generates setup report

**When to use:**
- First-time production setup
- Creating new environment (staging, production)
- Recreating resources after deletion

**After running:**
- Update `wrangler.production.jsonc` with resource IDs from setup report
- Verify all secrets are configured correctly

---

### 🗄️ migrate-prod.sh

Database migration script with backup and verification.

```bash
# Apply migrations
./migrate-prod.sh

# With custom environment
ENVIRONMENT=staging ./migrate-prod.sh
```

**What it does:**
1. Checks prerequisites
2. Creates backup directory
3. Backs up current migration state
4. Lists pending migrations
5. Shows migration details
6. Confirms with user (for production)
7. Applies migrations
8. Verifies migration success
9. Generates migration report

**Safety features:**
- Creates backup before migration
- Shows preview of pending migrations
- Requires confirmation for production
- Verifies all migrations applied
- Generates detailed report

---

### 🧪 smoke-test.sh

Post-deployment smoke tests to verify application health.

```bash
# Run smoke tests
./smoke-test.sh

# Custom options
./smoke-test.sh --url https://staging.tamma.dev --timeout 60 --verbose

# Environment variables
DEPLOYMENT_URL=https://staging.tamma.dev ./smoke-test.sh
VERBOSE=true ./smoke-test.sh
```

**What it tests:**
1. Health check endpoint
2. Homepage accessibility
3. API endpoints
4. Authentication flows
5. Error handling
6. Security headers
7. Database connectivity
8. Performance (response times)

**Options:**
- `--url URL`: Deployment URL to test
- `--timeout SEC`: Request timeout in seconds
- `--verbose`: Enable detailed output
- `--help`: Show help message

**Exit codes:**
- `0`: All tests passed
- `1`: Some tests failed

---

## Common Workflows

### First-Time Production Setup

```bash
# 1. Create .env.production from template
cp ../.env.example ../.env.production
# Edit .env.production with your values

# 2. Run setup script
./setup-prod.sh

# 3. Update wrangler.production.jsonc with resource IDs

# 4. Deploy application
./deploy-prod.sh
```

### Regular Deployment

```bash
# Standard deployment (from main branch)
git checkout main
git pull origin main
./deploy-prod.sh
```

### Staging Deployment

```bash
# Deploy to staging environment
ENVIRONMENT=staging DEPLOYMENT_URL=https://staging.tamma.dev ./deploy-prod.sh
```

### Database Migration

```bash
# Check pending migrations
wrangler d1 migrations list tamma-docs

# Apply migrations
./migrate-prod.sh
```

### Manual Smoke Tests

```bash
# Test production
./smoke-test.sh

# Test staging
./smoke-test.sh --url https://staging.tamma.dev

# Verbose mode
./smoke-test.sh --verbose
```

---

## Environment Variables

### deploy-prod.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPLOYMENT_BRANCH` | `main` | Git branch to deploy from |
| `ENVIRONMENT` | `production` | Deployment environment |
| `ROLLBACK_ON_FAILURE` | `true` | Auto-rollback on failure |
| `DEPLOYMENT_URL` | `https://tamma-doc-review.pages.dev` | Deployment URL |

### migrate-prod.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `production` | Database environment |
| `DB_NAME` | `tamma-docs` | D1 database name |

### smoke-test.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPLOYMENT_URL` | `https://tamma-doc-review.pages.dev` | URL to test |
| `TIMEOUT` | `30` | Request timeout (seconds) |
| `VERBOSE` | `false` | Enable verbose output |

---

## Prerequisites

All scripts require:

- **Node.js**: Version 22 or higher
- **pnpm**: Version 9 or higher
- **wrangler**: Latest version (`npm install -g wrangler`)
- **git**: For version control
- **jq**: For JSON processing
- **curl**: For HTTP requests (smoke tests)
- **bc**: For arithmetic (smoke tests)

### Installing Prerequisites

```bash
# macOS
brew install node pnpm jq bc
npm install -g wrangler

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs jq bc
npm install -g pnpm wrangler

# Verify installation
node --version    # Should be >= 22
pnpm --version    # Should be >= 9
wrangler --version
jq --version
```

---

## Troubleshooting

### Script Fails: Command Not Found

**Issue**: `wrangler: command not found` or similar

**Solution**:
```bash
npm install -g wrangler
# Or ensure wrangler is in PATH
export PATH=$PATH:~/.npm-global/bin
```

### Script Fails: Permission Denied

**Issue**: `./deploy-prod.sh: Permission denied`

**Solution**:
```bash
chmod +x *.sh
```

### Deployment Fails: Authentication Error

**Issue**: `Error: Not authenticated`

**Solution**:
```bash
wrangler logout
wrangler login
```

### Migration Fails: Database Not Found

**Issue**: `Database tamma-docs not found`

**Solution**:
```bash
# Run setup script first
./setup-prod.sh

# Or create database manually
wrangler d1 create tamma-docs
```

### Smoke Tests Fail: Connection Timeout

**Issue**: Tests timeout connecting to deployment

**Solution**:
```bash
# Increase timeout
TIMEOUT=60 ./smoke-test.sh

# Check if deployment is accessible
curl -I https://tamma-doc-review.pages.dev/health

# Wait for deployment to be fully live
# Cloudflare deployments can take 1-2 minutes to propagate
```

---

## Security Best Practices

### Secrets Management

- ❌ **NEVER** commit `.env.production` to version control
- ✅ Use `wrangler pages secret put` for sensitive values
- ✅ Rotate secrets regularly
- ✅ Use strong, randomly generated secrets

### Script Security

- ✅ Scripts use `set -euo pipefail` for safety
- ✅ All user input is validated
- ✅ Secrets are never logged
- ✅ Confirmation required for production operations

### Deployment Security

- ✅ Type checking before deployment
- ✅ Tests must pass before deployment
- ✅ Git state verified (correct branch, no uncommitted changes)
- ✅ Automatic rollback on failure
- ✅ Smoke tests after deployment

---

## Script Maintenance

### Updating Scripts

1. Test changes in non-production environment
2. Update script version/changelog
3. Update documentation
4. Review security implications
5. Test rollback procedures

### Adding New Scripts

1. Follow existing naming convention
2. Include detailed header comments
3. Use consistent logging functions
4. Add error handling
5. Document in this README
6. Make executable: `chmod +x script-name.sh`

---

## Support

For issues or questions:

1. Check [DEPLOYMENT.md](../DEPLOYMENT.md) for detailed documentation
2. Review script output for error messages
3. Check Cloudflare dashboard for resource status
4. Open issue on GitHub repository

---

## Changelog

### Version 1.0.0 (2025-01-15)

- Initial release
- Added deploy-prod.sh
- Added setup-prod.sh
- Added migrate-prod.sh
- Added smoke-test.sh

---

Last updated: 2025-01-15
