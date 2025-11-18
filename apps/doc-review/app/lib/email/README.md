# Email Service Documentation

## Provider Selection: Resend

We've chosen **Resend** as our email provider for the following reasons:

### Why Resend?

1. **Free Tier**: 3,000 emails/month free (perfect for development and small teams)
2. **Developer-Friendly**: Simple API, React email templates, excellent documentation
3. **Edge Compatible**: Works seamlessly with Cloudflare Workers
4. **Built-in Features**: Email validation, bounce handling, analytics
5. **Fast Delivery**: Global infrastructure, 99.99% uptime SLA
6. **TypeScript Support**: First-class TypeScript SDK

### Alternative Options Considered

- **Cloudflare Email Workers**: More complex setup, requires domain ownership
- **SendGrid**: More expensive, complex API for simple use cases
- **AWS SES**: Requires AWS account, complex configuration
- **Mailgun**: Similar to SendGrid, overkill for our needs

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  API Routes     │────▶│  Email Queue    │────▶│  Resend API     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │  D1 Database    │
                        │  (Queue Table)  │
                        └─────────────────┘
```

## Setup Instructions

### 1. Get Resend API Key

1. Sign up at https://resend.com
2. Create an API key in dashboard
3. Add to your `.dev.vars` file:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=notifications@yourdomain.com
```

### 2. Configure Domain (Optional)

For production, configure your domain in Resend dashboard:
1. Add your domain
2. Add DNS records (SPF, DKIM, DMARC)
3. Verify domain

### 3. Environment Variables

Add to `wrangler.toml`:

```toml
[vars]
RESEND_FROM_EMAIL = "Doc Review <notifications@yourdomain.com>"
APP_URL = "https://doc-review.yourdomain.com"

[env.production.vars]
RESEND_FROM_EMAIL = "Doc Review <notifications@yourdomain.com>"
APP_URL = "https://doc-review.yourdomain.com"
```

## Email Templates

All templates are React components in `/app/lib/email/templates/`:

- `comment-notification.tsx` - Comment activity notifications
- `suggestion-notification.tsx` - Suggestion updates
- `review-request.tsx` - Review assignment notifications
- `digest.tsx` - Daily/weekly activity digest

## Queue System

Emails are queued to ensure:
- Fast API response times (<100ms)
- Retry on failure (exponential backoff)
- Rate limit compliance
- Batch processing capability

## Notification Preferences

Users can control notifications via `/settings/notifications`:
- Toggle notification types
- Set digest frequency
- Manage watched documents
- One-click unsubscribe

## Testing

Test emails locally:
```bash
pnpm test:email
```

Preview templates:
```bash
pnpm dev
# Visit http://localhost:6700/test/email-preview
```

## Monitoring

Track email metrics in admin dashboard:
- Send rate
- Bounce rate
- Open rate (if tracking enabled)
- Queue status
- Failed sends

## Rate Limits

- Free tier: 3,000 emails/month, 100/day
- Pro tier: 100,000 emails/month
- Enterprise: Custom limits

## Security

- All API keys stored as secrets
- Unsubscribe tokens use HMAC signatures
- Email content sanitized for XSS
- SPF/DKIM/DMARC configured for domain reputation