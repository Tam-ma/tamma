# Deployment Guide - Tamma Doc Review

This guide provides comprehensive instructions for deploying the Tamma Doc Review application to Cloudflare Workers.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Initial Production Setup](#initial-production-setup)
- [Deploying to Production](#deploying-to-production)
- [Database Migrations](#database-migrations)
- [Managing Secrets](#managing-secrets)
- [Monitoring and Observability](#monitoring-and-observability)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)
- [CI/CD Pipeline](#cicd-pipeline)

---

## Prerequisites

### Required Software

- **Node.js**: Version 22 or higher
- **pnpm**: Version 9 or higher
- **wrangler**: Latest version (`npm install -g wrangler`)
- **git**: For version control
- **jq**: For JSON processing in scripts

### Required Accounts

- **Cloudflare Account**: With Workers/Pages enabled
- **GitHub Account**: For OAuth authentication
- **GitLab Account** (optional): For GitLab OAuth
- **Sentry Account** (optional): For error tracking

### Prerequisites Checklist

Before deploying, ensure you have:

- [ ] Cloudflare account with Workers/Pages enabled
- [ ] Wrangler CLI installed and authenticated (`wrangler login`)
- [ ] GitHub OAuth application created
- [ ] GitLab OAuth application created (if using GitLab)
- [ ] Production domain configured (optional)
- [ ] Sentry project created (optional)

---

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/meywd/tamma.git
cd tamma/doc-review
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Create `.env.production` file with required secrets:

```bash
cp .env.example .env.production
```

Edit `.env.production` and fill in all values (see [Managing Secrets](#managing-secrets) section).

### 4. Update Production Configuration

Edit `wrangler.production.jsonc` and update:

- `database_id`: Your production D1 database ID
- `id` (KV namespace): Your production KV namespace ID
- `bucket_name`: Your R2 bucket name (if using file attachments)

---

## Initial Production Setup

The setup script creates all required Cloudflare resources and configures the production environment.

### Run Setup Script

```bash
cd scripts
./setup-prod.sh
```

The script will:

1. ✅ Verify prerequisites (wrangler, jq, authentication)
2. ✅ Create D1 database (if not exists)
3. ✅ Create KV namespace (if not exists)
4. ✅ Create R2 bucket (if not exists)
5. ✅ Apply database migrations
6. ✅ Configure secrets from `.env.production`
7. ✅ Seed initial admin user
8. ✅ Verify setup

### Update Configuration

After running the setup script, update `wrangler.production.jsonc` with the resource IDs displayed in the setup report.

Example:

```jsonc
{
  "d1_databases": [
    {
      "database_id": "abc123..." // From setup report
    }
  ],
  "kv_namespaces": [
    {
      "id": "xyz789..." // From setup report
    }
  ]
}
```

---

## Deploying to Production

### Manual Deployment

Use the deployment script for manual deployments:

```bash
cd scripts
./deploy-prod.sh
```

The script performs the following steps:

1. ✅ Check prerequisites
2. ✅ Verify git state (branch, uncommitted changes)
3. ✅ Run type checking
4. ✅ Run tests
5. ✅ Build production bundle
6. ✅ Check for pending migrations
7. ✅ Store deployment info (for rollback)
8. ✅ Deploy to Cloudflare Workers
9. ✅ Wait for deployment to be live
10. ✅ Run smoke tests
11. ✅ Generate deployment report

### Environment Variables

You can customize the deployment with environment variables:

```bash
# Deploy to staging instead of production
ENVIRONMENT=staging ./deploy-prod.sh

# Disable automatic rollback on failure
ROLLBACK_ON_FAILURE=false ./deploy-prod.sh

# Deploy from a different branch
DEPLOYMENT_BRANCH=develop ./deploy-prod.sh

# Set custom deployment URL for smoke tests
DEPLOYMENT_URL=https://staging.tamma.dev ./deploy-prod.sh
```

### Deployment Workflow

```
┌─────────────────┐
│  Prerequisites  │
└────────┬────────┘
         │
┌────────▼────────┐
│   Git Verify    │
└────────┬────────┘
         │
┌────────▼────────┐
│  Type Check     │
└────────┬────────┘
         │
┌────────▼────────┐
│   Run Tests     │
└────────┬────────┘
         │
┌────────▼────────┐
│  Build Prod     │
└────────┬────────┘
         │
┌────────▼────────┐
│   Migrations    │
└────────┬────────┘
         │
┌────────▼────────┐
│     Deploy      │
└────────┬────────┘
         │
┌────────▼────────┐
│  Smoke Tests    │
└────────┬────────┘
         │
┌────────▼────────┐
│     Success     │
└─────────────────┘
```

---

## Database Migrations

### Checking Migration Status

```bash
# List all migrations and their status
wrangler d1 migrations list tamma-docs

# Show detailed migration information
cd scripts
./migrate-prod.sh --status
```

### Applying Migrations

Migrations are automatically checked during deployment, but you can manually apply them:

```bash
cd scripts
./migrate-prod.sh
```

The migration script:

1. ✅ Creates backup of migration state
2. ✅ Lists pending migrations
3. ✅ Confirms with user (for production)
4. ✅ Applies migrations
5. ✅ Verifies migration success
6. ✅ Generates migration report

### Creating New Migrations

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply to local database for testing
pnpm db:migrate:local

# Apply to production (after testing)
./scripts/migrate-prod.sh
```

### Migration Best Practices

- ✅ Always test migrations locally first
- ✅ Review generated SQL before applying
- ✅ Make migrations backward compatible when possible
- ✅ Backup data before migrations (automated by script)
- ✅ Apply migrations during low-traffic periods
- ❌ Never manually edit applied migrations
- ❌ Never rollback migrations without proper planning

---

## Managing Secrets

### Required Secrets

All secrets must be set using `wrangler pages secret put`:

```bash
# GitHub OAuth
wrangler pages secret put GITHUB_CLIENT_ID --project-name=tamma-doc-review
wrangler pages secret put GITHUB_CLIENT_SECRET --project-name=tamma-doc-review

# GitLab OAuth (optional)
wrangler pages secret put GITLAB_CLIENT_ID --project-name=tamma-doc-review
wrangler pages secret put GITLAB_CLIENT_SECRET --project-name=tamma-doc-review

# Session security
wrangler pages secret put SESSION_SECRET --project-name=tamma-doc-review
wrangler pages secret put ENCRYPTION_KEY --project-name=tamma-doc-review

# Error tracking (optional)
wrangler pages secret put SENTRY_DSN --project-name=tamma-doc-review
```

### Generating Secure Secrets

```bash
# Generate SESSION_SECRET (32 bytes, base64)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32 bytes, base64)
openssl rand -base64 32
```

### OAuth Configuration

#### GitHub OAuth

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in details:
   - **Application name**: Tamma Doc Review
   - **Homepage URL**: `https://tamma-doc-review.pages.dev`
   - **Authorization callback URL**: `https://tamma-doc-review.pages.dev/auth/callback`
4. Save Client ID and Client Secret
5. Set secrets using wrangler

#### GitLab OAuth

1. Go to GitLab User Settings → Applications
2. Create new application:
   - **Name**: Tamma Doc Review
   - **Redirect URI**: `https://tamma-doc-review.pages.dev/auth/callback`
   - **Scopes**: `read_user`, `read_repository`
3. Save Application ID and Secret
4. Set secrets using wrangler

### Viewing Secrets

```bash
# List all secrets
wrangler pages secret list --project-name=tamma-doc-review

# Secrets values cannot be viewed after being set
# You must delete and recreate to change them
```

### Rotating Secrets

```bash
# Delete old secret
wrangler pages secret delete GITHUB_CLIENT_SECRET --project-name=tamma-doc-review

# Set new secret
wrangler pages secret put GITHUB_CLIENT_SECRET --project-name=tamma-doc-review
```

---

## Monitoring and Observability

### Health Checks

The application provides a health check endpoint:

```bash
# Check application health
curl https://tamma-doc-review.pages.dev/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "version": "1.0.0",
  "environment": "production",
  "checks": {
    "database": { "status": "healthy", "latency": 15 },
    "kv": { "status": "healthy", "latency": 8 },
    "storage": { "status": "healthy" },
    "git": { "status": "healthy", "configured": true, "provider": "github" }
  }
}
```

### Cloudflare Analytics

Cloudflare Workers Analytics is enabled by default:

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your project → Analytics
3. View metrics:
   - Request volume
   - Error rate
   - Response time
   - Status codes

### Sentry Error Tracking

If Sentry is configured:

1. Errors are automatically captured and sent to Sentry
2. View errors at https://sentry.io
3. Configure alerts for critical errors
4. Review stack traces and context

### Custom Metrics

The application tracks custom metrics:

- Page views
- API request latency
- User actions
- Database query performance

Access metrics via Cloudflare Analytics or custom dashboards.

### Logs

View application logs:

```bash
# Tail production logs
wrangler pages deployment tail --project-name=tamma-doc-review

# View specific deployment logs
wrangler pages deployment list --project-name=tamma-doc-review
wrangler pages deployment tail <deployment-id>
```

---

## Rollback Procedures

### Automatic Rollback

The deployment script automatically rolls back on failure if `ROLLBACK_ON_FAILURE=true` (default).

### Manual Rollback

#### Method 1: Redeploy Previous Version

```bash
# Find previous deployment
wrangler pages deployment list --project-name=tamma-doc-review

# Checkout previous commit
git checkout <previous-commit-hash>

# Redeploy
./scripts/deploy-prod.sh

# Return to main branch
git checkout main
```

#### Method 2: Cloudflare Dashboard

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your project → Deployments
3. Find previous successful deployment
4. Click "Rollback to this deployment"

### Database Rollback

⚠️ **WARNING**: Database rollback is complex and requires manual intervention.

```bash
# Check migration backups
ls -la db/backups/

# Manual rollback steps:
# 1. Review backup file
# 2. Write reverse migration SQL
# 3. Test on local database
# 4. Apply to production with extreme caution
```

### Rollback Checklist

- [ ] Identify issue and decide rollback is necessary
- [ ] Note current deployment commit/version
- [ ] Identify target rollback commit/version
- [ ] Check for database migration incompatibilities
- [ ] Perform rollback (automatic or manual)
- [ ] Verify application is working
- [ ] Run smoke tests
- [ ] Monitor for errors
- [ ] Update incident log

---

## Troubleshooting

### Common Issues

#### Build Fails

**Symptom**: `pnpm build` fails with errors

**Solution**:
```bash
# Clear cache and reinstall
rm -rf node_modules .cache build
pnpm install --force
pnpm build
```

#### Deployment Fails

**Symptom**: `wrangler pages deploy` fails

**Solutions**:
```bash
# Check authentication
wrangler whoami

# Re-authenticate if needed
wrangler logout
wrangler login

# Verify project name
wrangler pages project list
```

#### Database Connection Fails

**Symptom**: Health check shows database unhealthy

**Solutions**:
```bash
# Verify database exists
wrangler d1 list

# Check database binding in wrangler.production.jsonc
# Ensure database_id matches production database

# Test database query
wrangler d1 execute tamma-docs --remote --command="SELECT 1"
```

#### Missing Secrets

**Symptom**: Authentication fails, 500 errors

**Solution**:
```bash
# List configured secrets
wrangler pages secret list --project-name=tamma-doc-review

# Set missing secrets
wrangler pages secret put <SECRET_NAME> --project-name=tamma-doc-review
```

#### Health Check Fails

**Symptom**: `/health` endpoint returns 503 or errors

**Debug Steps**:
```bash
# Check detailed health response
curl -v https://tamma-doc-review.pages.dev/health

# Check application logs
wrangler pages deployment tail --project-name=tamma-doc-review

# Verify all resources are configured
./scripts/setup-prod.sh --verify
```

#### Migration Fails

**Symptom**: Migration script exits with error

**Solutions**:
```bash
# Check migration status
wrangler d1 migrations list tamma-docs

# View migration SQL
cat db/migrations/<migration-file>.sql

# Check for syntax errors or incompatibilities
# Manually fix migration file if needed
# Do not modify applied migrations!
```

### Performance Issues

#### Slow Response Times

**Checks**:
```bash
# Check health endpoint latency
curl -w "@curl-format.txt" https://tamma-doc-review.pages.dev/health

# Review Cloudflare Analytics
# Look for slow database queries
# Check KV cache hit rate
```

**Solutions**:
- Enable/configure caching
- Optimize database queries
- Review bundle size
- Check for N+1 queries

#### High Error Rate

**Checks**:
```bash
# View error logs
wrangler pages deployment tail --project-name=tamma-doc-review

# Check Sentry for error details
# Review Cloudflare Analytics for error patterns
```

### Getting Help

If issues persist:

1. **Check logs**: `wrangler pages deployment tail`
2. **Review documentation**: This guide and Cloudflare docs
3. **Search issues**: GitHub repository issues
4. **Open issue**: Provide logs, error messages, steps to reproduce

---

## CI/CD Pipeline

### GitHub Actions Workflow

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys on push to `main`.

### Workflow Steps

1. **Test**: Run type checking, linting, and tests
2. **Build**: Create production bundle
3. **Deploy**: Deploy to Cloudflare Workers
4. **Smoke Test**: Verify deployment health
5. **Notify**: Report deployment status

### Required Secrets

Configure in GitHub repository settings (Settings → Secrets and variables → Actions):

```
CLOUDFLARE_API_TOKEN     # Cloudflare API token with Workers/Pages permissions
CLOUDFLARE_ACCOUNT_ID    # Cloudflare account ID
```

### Generating Cloudflare API Token

1. Go to Cloudflare Dashboard → My Profile → API Tokens
2. Click "Create Token"
3. Use template: "Edit Cloudflare Workers"
4. Or create custom token with permissions:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit
   - Account → D1 → Edit
   - Account → Account Settings → Read
5. Copy token and add to GitHub secrets

### Manual Workflow Trigger

```bash
# Trigger workflow manually from GitHub UI:
# Actions → Deploy to Production → Run workflow

# Or using GitHub CLI:
gh workflow run deploy.yml
```

### Workflow Customization

Edit `.github/workflows/deploy.yml` to:

- Add deployment approvals
- Configure different environments (staging, production)
- Add custom deployment steps
- Configure notifications (Slack, email)

---

## Production Safeguards

### Rate Limiting

Configure rate limiting in `wrangler.production.jsonc`:

```jsonc
{
  "vars": {
    "ENABLE_RATE_LIMITING": "true",
    "RATE_LIMIT_REQUESTS": "100",
    "RATE_LIMIT_WINDOW": "60"
  }
}
```

### CORS Configuration

```jsonc
{
  "vars": {
    "ALLOWED_ORIGINS": "https://tamma-doc-review.pages.dev,https://tamma.dev"
  }
}
```

### Security Headers

The application automatically sets security headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000`

### Input Validation

All user inputs are validated and sanitized to prevent:

- SQL injection
- XSS attacks
- Path traversal
- Command injection

---

## Monitoring Checklist

After deployment, verify:

- [ ] Health check returns 200 OK
- [ ] All health checks show "healthy"
- [ ] Homepage loads correctly
- [ ] Authentication works (GitHub/GitLab OAuth)
- [ ] Document loading works
- [ ] Database queries are fast (check latency in health check)
- [ ] KV cache is working
- [ ] No errors in Cloudflare Analytics
- [ ] Sentry receiving events (if configured)
- [ ] Logs look normal (no errors/warnings)

---

## Support and Resources

- **Documentation**: This guide and project README
- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **GitHub Repository**: https://github.com/meywd/tamma
- **Issues**: https://github.com/meywd/tamma/issues
- **Discussions**: https://github.com/meywd/tamma/discussions

---

## Deployment Best Practices

✅ **DO**:

- Test thoroughly in local/staging before production
- Review all changes before deploying
- Monitor deployments for errors
- Keep secrets secure and rotate regularly
- Document all configuration changes
- Use version control for all code changes
- Run smoke tests after deployment
- Keep dependencies up to date

❌ **DON'T**:

- Deploy directly to production without testing
- Commit secrets to version control
- Skip tests before deploying
- Deploy during peak traffic hours (unless necessary)
- Make database schema changes without migrations
- Ignore errors in logs/monitoring
- Deploy uncommitted changes
- Modify production data manually

---

## Maintenance Schedule

### Regular Tasks

**Daily**:
- Monitor error rates
- Check application health
- Review logs for anomalies

**Weekly**:
- Review Cloudflare Analytics
- Check for security updates
- Review Sentry errors (if configured)

**Monthly**:
- Update dependencies
- Rotate secrets
- Review and optimize performance
- Backup database migration state

**Quarterly**:
- Security audit
- Performance optimization
- Cost analysis
- Documentation updates

---

## Version History

Track major deployments:

| Version | Date | Changes | Deployed By |
|---------|------|---------|-------------|
| 1.0.0 | 2025-01-15 | Initial production deployment | @meywd |

---

Last updated: 2025-01-15
