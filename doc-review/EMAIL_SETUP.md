# Email Notification System Setup Guide

This guide covers the complete setup and configuration of the email notification system for the Doc Review platform.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Configuration](#configuration)
4. [Database Setup](#database-setup)
5. [Testing](#testing)
6. [Production Deployment](#production-deployment)
7. [API Integration](#api-integration)
8. [Troubleshooting](#troubleshooting)

## Quick Start

### 1. Get Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key (starts with `re_`)

### 2. Configure Environment Variables

Create a `.dev.vars` file in the project root:

```bash
# Email Configuration
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM_EMAIL=notifications@yourdomain.com
APP_URL=http://localhost:5173
UNSUBSCRIBE_SECRET=your-secret-key-for-unsubscribe-tokens
```

### 3. Run Database Migrations

```bash
# Apply migrations to local D1 database
pnpm db:migrate:local

# For production
pnpm db:migrate
```

### 4. Test Email Sending

```bash
# Start development server
pnpm dev

# Navigate to settings
# http://localhost:5173/settings/notifications

# Click "Send Test Email"
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User Actions                         │
│  (Comment, Suggestion, Review Request)                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                 API Route Handlers                      │
│  (Check notification preferences)                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Email Queue                           │
│  (D1 Database - email_queue table)                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│               Queue Processor                           │
│  (Scheduled worker or manual trigger)                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                 Resend API                              │
│  (Email delivery service)                               │
└─────────────────────────────────────────────────────────┘
```

## Configuration

### Resend Configuration

1. **Domain Setup** (for production):
   - Add your domain in Resend dashboard
   - Configure DNS records:
     ```
     SPF: TXT record with Resend's SPF
     DKIM: CNAME records for DKIM verification
     DMARC: TXT record for DMARC policy
     ```

2. **Update wrangler.toml**:
   ```toml
   [vars]
   RESEND_FROM_EMAIL = "Doc Review <notifications@yourdomain.com>"
   APP_URL = "https://doc-review.yourdomain.com"
   ENVIRONMENT = "production"

   [[d1_databases]]
   binding = "DB"
   database_name = "tamma-docs"
   database_id = "your-database-id"
   ```

### Email Templates

Located in `/app/lib/email/templates/`:

- **comment-notification.tsx** - New comment notifications
- **suggestion-notification.tsx** - Suggestion status updates
- **review-request.tsx** - Review assignment notifications
- **digest.tsx** - Daily/weekly activity summaries

## Database Setup

### Tables Created

1. **email_queue** - Stores pending emails
2. **email_log** - Historical record of sent emails
3. **notification_preferences** - User notification settings
4. **document_watches** - Documents users are watching

### Migration Commands

```bash
# Generate new migration
pnpm drizzle-kit generate

# Apply migrations locally
pnpm db:migrate:local

# Apply to production
pnpm db:migrate

# View database with Drizzle Studio
pnpm db:studio
```

## Testing

### Unit Tests

```bash
# Run all tests
pnpm test

# Run email-specific tests
pnpm test email

# Watch mode
pnpm test:watch
```

### Manual Testing

1. **Test Email Delivery**:
   ```typescript
   // Navigate to /settings/notifications
   // Click "Send Test Email"
   ```

2. **Test Queue Processing**:
   ```typescript
   // Navigate to /admin/emails (admin only)
   // Click "Process Queue Now"
   ```

3. **Test Unsubscribe**:
   ```typescript
   // Click unsubscribe link in any email
   // Verify preferences are updated
   ```

## Production Deployment

### 1. Set Production Secrets

```bash
# Set Resend API key
wrangler secret put RESEND_API_KEY
# Enter: re_your_production_api_key

# Set unsubscribe token secret
wrangler secret put UNSUBSCRIBE_SECRET
# Enter: your-secure-random-string
```

### 2. Deploy

```bash
# Build and deploy
pnpm build
pnpm deploy
```

### 3. Set Up Scheduled Workers

For automatic queue processing, add to `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"] # Process queue every 5 minutes
```

Then create a scheduled handler:

```typescript
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processEmailQueue(env.DB, env));
  },
};
```

## API Integration

### Trigger Email Notifications

```typescript
// In your API route (e.g., comments.tsx)
import { queueEmail } from '~/lib/email/queue.server';
import { notificationPreferences } from '~/lib/db/schema';

// After creating a comment
const recipients = await getRecipients(comment, db);
for (const recipient of recipients) {
  // Check preferences
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, recipient.id))
    .first();

  if (prefs?.newComments) {
    await queueEmail({
      to: recipient.email,
      subject: `New comment on ${document.title}`,
      html: renderCommentEmail(comment),
      type: 'comment_notification',
      userId: recipient.id,
      metadata: { commentId: comment.id }
    }, env.DB);
  }
}
```

### Check Queue Status

```typescript
import { getQueueStats } from '~/lib/email/queue.server';

const stats = await getQueueStats(env.DB);
console.log(`Pending: ${stats.pending}, Sent: ${stats.sent}`);
```

## Troubleshooting

### Common Issues

1. **Emails not sending**:
   - Check Resend API key is correct
   - Verify `ENVIRONMENT` is not set to 'production' in dev
   - Check queue processor is running
   - View admin dashboard for errors

2. **Unsubscribe links not working**:
   - Verify `UNSUBSCRIBE_SECRET` is set
   - Check token expiry (7 days by default)
   - Ensure APP_URL is correct

3. **Rate limiting**:
   - Free tier: 3,000/month, 100/day
   - Implement batch processing for digests
   - Use queue scheduling to spread load

4. **Missing emails**:
   - Check spam folder
   - Verify domain DNS records (SPF, DKIM, DMARC)
   - Check Resend dashboard for bounces

### Debug Mode

Enable debug logging in development:

```typescript
// In service.server.ts
if (this.isDevelopment) {
  console.log('📧 [DEV] Email details:', {
    to: options.to,
    subject: options.subject,
    preview: options.html.substring(0, 200)
  });
}
```

### Admin Dashboard

Access at `/admin/emails` (requires admin role):

- View queue statistics
- Process queue manually
- Retry failed emails
- View recent email history
- Clean up old emails

## Security Considerations

1. **Token Security**:
   - Use strong secrets for unsubscribe tokens
   - Tokens expire after 7 days
   - HMAC-based signature verification

2. **Rate Limiting**:
   - Implement per-user rate limits
   - Use queue to prevent API abuse
   - Monitor for unusual activity

3. **Data Protection**:
   - Never log email content in production
   - Encrypt sensitive data at rest
   - Follow GDPR compliance for EU users

4. **Access Control**:
   - Admin dashboard requires admin role
   - Unsubscribe doesn't require authentication
   - Preferences require user authentication

## Monitoring & Analytics

### Key Metrics to Track

- **Delivery Rate**: Successful sends / Total attempts
- **Bounce Rate**: Bounced emails / Total sends
- **Open Rate**: (if tracking enabled)
- **Unsubscribe Rate**: Unsubscribes / Total recipients
- **Queue Depth**: Average pending emails
- **Processing Time**: Average time in queue

### Alerting

Set up alerts for:
- Queue depth > 100 emails
- Failure rate > 10%
- API errors from Resend
- Database connection issues

## Support

For issues or questions:
1. Check the [Resend documentation](https://resend.com/docs)
2. Review logs in admin dashboard
3. Check GitHub issues
4. Contact support with error details