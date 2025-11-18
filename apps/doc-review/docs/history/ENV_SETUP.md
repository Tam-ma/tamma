# Environment Variable Setup Guide

## Overview

This application uses environment variables for configuration, with different requirements for development and production environments.

## Development Setup

### Quick Start (No Auth)

For basic development without authentication features:

```bash
# No setup needed! The app will run with defaults
npm run dev
```

The application will use safe defaults from `.env.development` and auth routes will fail gracefully.

### Full Setup (With Auth)

To enable authentication features in development:

1. **Create GitHub OAuth App**
   - Go to https://github.com/settings/developers
   - Click "New OAuth App"
   - Set Application name: "Tamma Doc Review (Dev)"
   - Set Homepage URL: `http://localhost:6700`
   - Set Authorization callback URL: `http://localhost:6700/auth/callback`
   - Click "Register application"
   - Note your Client ID and generate a Client Secret

2. **Create Local Environment File**
   ```bash
   cp .env.development .env.local
   ```

3. **Add OAuth Credentials**
   Edit `.env.local` and add:
   ```
   GITHUB_CLIENT_ID=your_github_client_id_here
   GITHUB_CLIENT_SECRET=your_github_client_secret_here
   ```

4. **Start with Cloudflare Bindings**
   ```bash
   # Start with local Cloudflare Workers environment
   npm run start
   ```

   This provides local D1, KV, and R2 bindings needed for auth.

## Production Setup

### Using Wrangler Secrets (Recommended)

For production deployment on Cloudflare Pages:

```bash
# Set OAuth credentials as secrets
wrangler pages secret put GITHUB_CLIENT_ID --project-name=tamma-doc-review
wrangler pages secret put GITHUB_CLIENT_SECRET --project-name=tamma-doc-review
```

### Environment Variables vs Secrets

**In `wrangler.jsonc` (committed to repo):**
- Non-sensitive configuration
- Git repository details
- Feature flags
- Binding IDs (D1, KV, R2)

**As Wrangler Secrets (not in repo):**
- OAuth client secrets
- API keys
- Session secrets
- Encryption keys

## Environment Variable Reference

### Required for Auth

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | `Iv1.a1b2c3d4e5f6g7h8` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret | `1234567890abcdef...` |

### Optional (Have Defaults)

| Variable | Description | Default |
|----------|-------------|---------|
| `GIT_PROVIDER` | Git platform to use | `github` |
| `GIT_OWNER` | Repository owner | `meywd` |
| `GIT_REPO` | Repository name | `tamma` |
| `GIT_REF` | Git reference (branch/tag) | `main` |
| `DOCS_BASE_PATH` | Path to docs in repo | `docs` |

## Troubleshooting

### "Cannot read properties of undefined (reading 'GIT_PROVIDER')"

**Cause:** The application is trying to access environment variables but the context is undefined.

**Fix:** This has been fixed by using the `resolveEnv()` helper which handles both development and production contexts.

### Auth Routes Return 500 Error

**Possible causes:**

1. **Missing OAuth Credentials**
   - Check if `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
   - Verify credentials are correct in GitHub OAuth app settings

2. **Missing Cloudflare Bindings**
   - Auth requires KV namespace for session storage
   - Run with `npm run start` instead of `npm run dev`
   - Or deploy to Cloudflare Pages for full environment

3. **Incorrect Callback URL**
   - Development: `http://localhost:6700/auth/callback`
   - Production: `https://your-domain.pages.dev/auth/callback`
   - Must match exactly in GitHub OAuth app settings

### KV Namespace Not Found

**Cause:** Running in development without Cloudflare bindings.

**Fix:**
```bash
# Use wrangler for local development with bindings
npm run start

# Or deploy to preview environment
npm run deploy
```

## Context Resolution

The application uses a `resolveEnv()` helper to handle environment access across different runtime contexts:

```typescript
// Handles both structures:
// - context.env (Cloudflare Workers)
// - context.cloudflare.env (React Router v7 dev mode)
const env = resolveEnv(context);
```

This ensures compatibility between:
- Cloudflare Pages production
- Cloudflare Workers preview
- React Router v7 development server
- Wrangler local development

## Files

- `.env.example` - Template with all available variables
- `.env.development` - Development defaults (safe to commit)
- `.env.local` - Local overrides (DO NOT commit)
- `.env.production` - Production values (DO NOT commit)
- `wrangler.jsonc` - Cloudflare configuration (committed)

## Security Notes

1. **Never commit secrets** - Add `.env.local` and `.env.production` to `.gitignore`
2. **Use Wrangler secrets** - Set sensitive values with `wrangler pages secret put`
3. **Rotate credentials** - Regularly rotate OAuth secrets and API keys
4. **Validate in GitHub** - Check OAuth app settings match your callback URLs
