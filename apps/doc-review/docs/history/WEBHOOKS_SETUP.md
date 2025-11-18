# Webhook Setup Guide

This guide explains how to configure webhooks for the Documentation Review platform to receive real-time updates from GitHub and GitLab.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Database Setup](#database-setup)
- [Environment Configuration](#environment-configuration)
- [GitHub Webhook Setup](#github-webhook-setup)
- [GitLab Webhook Setup](#gitlab-webhook-setup)
- [Admin Interface](#admin-interface)
- [Testing Webhooks](#testing-webhooks)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)

## Overview

The webhook system enables real-time synchronization between your Git providers (GitHub/GitLab) and the documentation review platform. When events occur on pull/merge requests, the platform receives notifications and updates accordingly.

### Supported Events

#### GitHub
- **Pull Request Events**: opened, closed, merged, updated
- **Pull Request Reviews**: submitted, edited
- **Comments**: created, edited, deleted (on PRs)
- **Push Events**: commits to branches

#### GitLab
- **Merge Request Events**: open, close, merge, update
- **Notes**: comments on merge requests
- **Push Events**: commits to branches

## Architecture

```
┌─────────────┐      Webhook      ┌──────────────┐
│   GitHub    │───────POST────────▶│   Receiver   │
│   GitLab    │                    │   Endpoint   │
└─────────────┘                    └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  Signature   │
                                   │ Verification │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Storage    │
                                   │   (D1 DB)    │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  Processor   │
                                   │   (Async)    │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Actions    │
                                   │  (Updates)   │
                                   └──────────────┘
```

## Database Setup

1. **Run the migration** to create webhook tables:

```bash
# Apply the webhook migration
npx wrangler d1 migrations apply tamma-docs --local
```

This creates three tables:
- `webhook_events`: Stores all incoming webhook events
- `webhook_configurations`: Stores webhook settings
- `webhook_deliveries`: Tracks delivery attempts

## Environment Configuration

### Local Development (wrangler.toml)

```toml
[vars]
# GitHub webhook configuration
GITHUB_WEBHOOK_SECRET = "your-github-webhook-secret-here"

# GitLab webhook configuration
GITLAB_WEBHOOK_TOKEN = "your-gitlab-webhook-token-here"

# Optional: Admin user for webhook management
ADMIN_USER_ID = "your-admin-user-id"
```

### Production (Cloudflare Dashboard)

1. Go to your Cloudflare Workers dashboard
2. Select your worker
3. Go to Settings → Variables
4. Add the following encrypted environment variables:

- `GITHUB_WEBHOOK_SECRET`: Secret for GitHub webhook signature verification
- `GITLAB_WEBHOOK_TOKEN`: Token for GitLab webhook authentication
- `ADMIN_USER_ID`: User ID with admin privileges (optional)

## GitHub Webhook Setup

### Step 1: Navigate to Repository Settings

1. Go to your GitHub repository
2. Click on **Settings** tab
3. In the left sidebar, click **Webhooks**
4. Click **Add webhook**

### Step 2: Configure Webhook

1. **Payload URL**:
   ```
   https://your-domain.com/webhooks/github
   ```

2. **Content type**: Select `application/json`

3. **Secret**: Enter a secure secret (must match `GITHUB_WEBHOOK_SECRET`)
   ```bash
   # Generate a secure secret
   openssl rand -hex 32
   ```

4. **SSL verification**: Enable (recommended)

5. **Which events would you like to trigger this webhook?**
   - Select "Let me select individual events"
   - Check these events:
     - Pull requests
     - Pull request reviews
     - Pull request review comments
     - Issue comments
     - Pushes

6. **Active**: Check the box

7. Click **Add webhook**

### Step 3: Verify Setup

1. GitHub will send a `ping` event
2. Check the webhook's "Recent Deliveries" tab
3. You should see a successful delivery (green checkmark)

## GitLab Webhook Setup

### Step 1: Navigate to Project Settings

1. Go to your GitLab project
2. Navigate to **Settings** → **Webhooks**

### Step 2: Configure Webhook

1. **URL**:
   ```
   https://your-domain.com/webhooks/gitlab
   ```

2. **Secret token**: Enter a secure token (must match `GITLAB_WEBHOOK_TOKEN`)
   ```bash
   # Generate a secure token
   openssl rand -hex 32
   ```

3. **Trigger events** - Select:
   - Merge request events
   - Comments
   - Push events

4. **SSL verification**: Enable (recommended)

5. Click **Add webhook**

### Step 3: Test Webhook

1. Click **Test** next to your webhook
2. Select "Merge request events"
3. Verify successful delivery

## Admin Interface

Access the webhook admin interface at:
```
https://your-domain.com/admin/webhooks
```

**Note**: Requires admin privileges (user email ending in `@admin.com` or matching `ADMIN_USER_ID`)

### Features

1. **Webhook URLs Display**: Copy webhook endpoints
2. **Configuration Status**: View active/inactive status
3. **Statistics**:
   - Total events received
   - Processed/Failed/Pending counts
   - Last received timestamp

4. **Recent Events**:
   - View last 20 webhook events
   - See processing status
   - View full payload details
   - Retry failed events

5. **Testing**:
   - Send test webhooks
   - Verify connectivity

6. **Maintenance**:
   - Clear old events (>30 days)
   - Reprocess failed events

## Testing Webhooks

### Using Admin UI

1. Navigate to `/admin/webhooks`
2. Click "Test Webhook" for GitHub or GitLab
3. Check the response and event log

### Using cURL

#### Test GitHub Webhook
```bash
PAYLOAD='{"action":"opened","number":999,"pull_request":{"number":999,"title":"Test PR"}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-secret" | sed 's/^.* //')

curl -X POST https://your-domain.com/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: test-123" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

#### Test GitLab Webhook
```bash
curl -X POST https://your-domain.com/webhooks/gitlab \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-Event: Merge Request Hook" \
  -H "X-Gitlab-Token: your-token" \
  -d '{"object_kind":"merge_request","object_attributes":{"iid":999}}'
```

### Using GitHub/GitLab UI

Both platforms offer webhook testing in their settings:

**GitHub**: Settings → Webhooks → Recent Deliveries → Redeliver
**GitLab**: Settings → Webhooks → Test

## Troubleshooting

### Common Issues

#### 1. Signature Verification Failed

**Symptoms**: 401 Unauthorized response

**Solutions**:
- Verify the secret matches exactly (no extra spaces)
- Ensure you're using the correct header (`X-Hub-Signature-256` for GitHub)
- Check the secret is properly configured in environment variables

#### 2. Rate Limit Exceeded

**Symptoms**: 429 Too Many Requests

**Solutions**:
- Default limit: 100 requests per 60 seconds
- Wait for the rate limit window to reset
- Check `X-RateLimit-Reset` header for reset time

#### 3. Events Not Processing

**Check**:
1. View admin panel for event status
2. Check if events are marked as "pending" or "failed"
3. Look for error messages in event details
4. Verify database connections are working

#### 4. Missing Events

**Verify**:
- Webhook is active in GitHub/GitLab settings
- Correct events are selected
- No delivery failures in provider's webhook logs

### Debug Mode

Enable debug logging by setting in your worker:
```javascript
const DEBUG = true; // In development only
```

### Viewing Logs

```bash
# Local development
npx wrangler tail

# Production
wrangler tail --env production
```

## Security Considerations

### 1. Secret Management

- **Never commit secrets** to version control
- Use strong, randomly generated secrets (32+ characters)
- Rotate secrets regularly (every 90 days recommended)
- Use different secrets for different environments

### 2. Signature Verification

- **Always verify** webhook signatures in production
- Use constant-time comparison to prevent timing attacks
- Reject requests with missing or invalid signatures

### 3. Rate Limiting

- Implemented per-IP rate limiting (100 req/minute)
- Prevents DoS attacks
- Configurable limits in code

### 4. IP Allowlisting (Optional)

For additional security, implement IP allowlisting:

**GitHub IPs**: https://api.github.com/meta (hooks array)
**GitLab IPs**: Varies for self-hosted instances

### 5. Audit Trail

- All webhook events are logged in database
- Includes IP address, headers, and payload
- Retained for 30 days by default
- Use for security analysis and debugging

### 6. HTTPS Only

- Always use HTTPS endpoints
- Enable SSL verification in webhook settings
- Never use HTTP in production

## Webhook Event Flow

1. **Event Occurs**: PR opened/merged, comment added, etc.
2. **Provider Sends Webhook**: GitHub/GitLab POST to endpoint
3. **Receiver Validates**:
   - Check headers
   - Verify signature/token
   - Rate limiting
4. **Store Event**: Save to database for audit trail
5. **Async Processing**:
   - Convert to unified format
   - Execute actions (update suggestions, sync comments)
6. **Update Status**: Mark event as processed/failed

## Performance Considerations

- **Async Processing**: Webhooks respond immediately, process async
- **Response Time**: Target <200ms response time
- **Retry Logic**: Failed events retry up to 5 times
- **Cleanup**: Old events auto-cleaned after 30 days
- **Caching**: KV namespace used for rate limiting

## Monitoring

Monitor webhook health through:

1. **Admin Dashboard**: Real-time statistics and event log
2. **Metrics**:
   - Total events received
   - Processing success rate
   - Average processing time
3. **Alerts**: Set up alerts for:
   - High failure rate (>10%)
   - Processing delays (>5 minutes)
   - Rate limit hits

## Support

For issues or questions:

1. Check webhook Recent Deliveries in GitHub/GitLab
2. View admin panel for event details
3. Check application logs with `wrangler tail`
4. Review this documentation
5. Check webhook endpoint status: `GET /webhooks/github` or `GET /webhooks/gitlab`