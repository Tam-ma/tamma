# Quick Start: Deployment Guide

Get your Tamma Doc Review application deployed to production in 5 steps.

## Prerequisites Checklist

Before you begin, ensure you have:

- [ ] Cloudflare account ([Sign up](https://dash.cloudflare.com/sign-up))
- [ ] GitHub OAuth app created ([Create one](https://github.com/settings/developers))
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Node.js 22+ and pnpm 9+ installed

## Step 1: Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser window to authorize wrangler with your Cloudflare account.

## Step 2: Configure Environment

```bash
# Copy environment template
cp .env.example .env.production

# Edit with your values
nano .env.production  # or use your favorite editor
```

**Required values:**
- `GITHUB_CLIENT_ID`: From GitHub OAuth app
- `GITHUB_CLIENT_SECRET`: From GitHub OAuth app
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`
- `ENCRYPTION_KEY`: Generate with `openssl rand -base64 32`

## Step 3: Set Up Production Resources

```bash
cd scripts
./setup-prod.sh
```

This creates:
- D1 database for application data
- KV namespace for caching
- R2 bucket for file storage (optional)

**After completion:**
- Copy resource IDs from the setup report
- Update `wrangler.production.jsonc` with these IDs

## Step 4: Deploy to Production

```bash
./deploy-prod.sh
```

This will:
- Run type checking and tests
- Build production bundle
- Apply database migrations
- Deploy to Cloudflare Workers
- Run smoke tests

## Step 5: Verify Deployment

```bash
# Check health
curl https://tamma-doc-review.pages.dev/health

# Or run full smoke tests
./smoke-test.sh
```

Expected health check response:
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy" },
    "kv": { "status": "healthy" },
    "storage": { "status": "healthy" },
    "git": { "status": "healthy" }
  }
}
```

---

## Next Steps

### Set Up GitHub OAuth

1. Go to your GitHub OAuth app settings
2. Update Homepage URL: `https://tamma-doc-review.pages.dev`
3. Update Callback URL: `https://tamma-doc-review.pages.dev/auth/callback`

### Set Up CI/CD (Optional)

1. Add GitHub secrets:
   - `CLOUDFLARE_API_TOKEN`: [Create token](https://dash.cloudflare.com/profile/api-tokens)
   - `CLOUDFLARE_ACCOUNT_ID`: Found in Cloudflare dashboard

2. Push to main branch - deployment happens automatically!

### Configure Custom Domain (Optional)

1. Go to Cloudflare Dashboard → Workers & Pages → tamma-doc-review
2. Click "Custom Domains"
3. Add your domain
4. Update OAuth app callback URLs

### Set Up Monitoring (Optional)

1. **Sentry** for error tracking:
   ```bash
   wrangler pages secret put SENTRY_DSN --project-name=tamma-doc-review
   ```

2. **Cloudflare Analytics** (enabled by default):
   - View in Cloudflare dashboard

---

## Common Issues

### "Database not found"

Run setup script first:
```bash
./setup-prod.sh
```

### "Authentication failed"

Re-authenticate with Cloudflare:
```bash
wrangler logout
wrangler login
```

### "Tests failed"

Check test output and fix issues before deploying:
```bash
pnpm test:run
```

### "Deployment timeout"

Increase timeout and retry:
```bash
TIMEOUT=60 ./deploy-prod.sh
```

---

## Getting Help

- **Full documentation**: See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Scripts documentation**: See [scripts/README.md](scripts/README.md)
- **Troubleshooting**: See DEPLOYMENT.md → Troubleshooting section
- **GitHub Issues**: [Report a bug](https://github.com/meywd/tamma/issues)

---

## Rollback

If something goes wrong:

```bash
# Find previous deployment
wrangler pages deployment list --project-name=tamma-doc-review

# Rollback via dashboard
# Or redeploy previous version
git checkout <previous-commit>
./deploy-prod.sh
git checkout main
```

---

## Production Checklist

After deployment, verify:

- [ ] Health check returns 200 OK
- [ ] All health checks show "healthy"
- [ ] Homepage loads correctly
- [ ] GitHub OAuth login works
- [ ] Document loading works
- [ ] No errors in Cloudflare Analytics
- [ ] Response times are acceptable (< 2s)

---

## Useful Commands

```bash
# View logs
wrangler pages deployment tail --project-name=tamma-doc-review

# List deployments
wrangler pages deployment list --project-name=tamma-doc-review

# Check migrations
wrangler d1 migrations list tamma-docs

# Run smoke tests
./scripts/smoke-test.sh

# View secrets
wrangler pages secret list --project-name=tamma-doc-review
```

---

Last updated: 2025-01-15
