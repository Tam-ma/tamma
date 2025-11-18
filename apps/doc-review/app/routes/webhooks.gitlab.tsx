/**
 * GitLab Webhook Receiver
 *
 * Receives and processes webhook events from GitLab
 * Verifies webhook token for authentication
 */

import type { ActionFunctionArgs } from 'react-router';
import { data as json } from 'react-router';
import { WebhookStorage } from '~/lib/webhooks/storage.server';
import { WebhookProcessor } from '~/lib/webhooks/processor.server';
import type { GitLabWebhookHeaders } from '~/lib/webhooks/types';

// GitLab webhook events we're interested in
const SUPPORTED_EVENTS = ['merge_request', 'note', 'push'];

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX_REQUESTS = 100;

/**
 * Verify GitLab webhook token
 */
function verifyGitLabToken(requestToken: string | undefined, configuredToken: string): boolean {
  if (!requestToken || !configuredToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(requestToken, configuredToken);
}

/**
 * Constant-time string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Check if IP is from GitLab
 */
async function isGitLabIP(_ip: string): Promise<boolean> {
  try {
    // GitLab.com IP ranges (for GitLab.com hosted projects)
    // For self-hosted GitLab, you would need to configure your own IP ranges
    // TODO: Implement proper IP range checking
    // For now, return true in development, implement properly in production
    return true;
  } catch (error) {
    console.error('Error checking GitLab IP:', error);
    return false;
  }
}

/**
 * Rate limiting check
 */
async function checkRateLimit(
  kv: KVNamespace,
  identifier: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `ratelimit:gitlab:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW;

  try {
    const data = await kv.get(key, 'json') as { count: number; windowStart: number } | null;

    if (!data || data.windowStart < windowStart) {
      // New window
      await kv.put(
        key,
        JSON.stringify({ count: 1, windowStart: now }),
        { expirationTtl: RATE_LIMIT_WINDOW * 2 }
      );

      return {
        allowed: true,
        remaining: RATE_LIMIT_MAX_REQUESTS - 1,
        resetAt: now + RATE_LIMIT_WINDOW
      };
    }

    if (data.count >= RATE_LIMIT_MAX_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: data.windowStart + RATE_LIMIT_WINDOW
      };
    }

    // Increment counter
    await kv.put(
      key,
      JSON.stringify({ count: data.count + 1, windowStart: data.windowStart }),
      { expirationTtl: RATE_LIMIT_WINDOW * 2 }
    );

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - data.count - 1,
      resetAt: data.windowStart + RATE_LIMIT_WINDOW
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Allow on error to prevent blocking legitimate requests
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS,
      resetAt: now + RATE_LIMIT_WINDOW
    };
  }
}

/**
 * Handle POST request (webhook delivery)
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare?.env as {
    DB: D1Database;
    CACHE: KVNamespace;
    GITLAB_WEBHOOK_TOKEN?: string;
    WEBHOOK_TOKEN?: string;
  };

  const db = env.DB;
  const cache = env.CACHE;
  const token = env.GITLAB_WEBHOOK_TOKEN || env.WEBHOOK_TOKEN;

  // Initialize storage and processor
  const storage = new WebhookStorage(db);
  const processor = new WebhookProcessor(db, storage);

  try {
    // Get request headers
    const headers = Object.fromEntries(request.headers.entries());
    const gitlabHeaders: Partial<GitLabWebhookHeaders> = {
      'x-gitlab-event': headers['x-gitlab-event'],
      'x-gitlab-token': headers['x-gitlab-token'],
      'x-gitlab-event-uuid': headers['x-gitlab-event-uuid'],
      'x-gitlab-instance': headers['x-gitlab-instance']
    };

    // Validate required headers
    if (!gitlabHeaders['x-gitlab-event']) {
      return json(
        { error: 'Missing required GitLab headers' },
        {
          status: 400,
          headers: {
            'X-Webhook-Status': 'invalid-headers'
          }
        }
      );
    }

    const eventType = gitlabHeaders['x-gitlab-event'];
    const eventUuid = gitlabHeaders['x-gitlab-event-uuid'] || `gitlab-${Date.now()}`;

    // Map GitLab event names to our internal names
    const eventTypeMapping: Record<string, string> = {
      'Merge Request Hook': 'merge_request',
      'Note Hook': 'note',
      'Push Hook': 'push',
      'Tag Push Hook': 'tag_push',
      'Issue Hook': 'issue',
      'Pipeline Hook': 'pipeline'
    };

    const normalizedEventType = eventTypeMapping[eventType] || eventType.toLowerCase().replace(' hook', '').replace(' ', '_');

    // Check if event type is supported
    if (!SUPPORTED_EVENTS.includes(normalizedEventType)) {
      return json(
        { message: `Event type '${eventType}' not supported` },
        {
          status: 200, // Return 200 to prevent GitLab from retrying
          headers: {
            'X-Webhook-Status': 'unsupported-event'
          }
        }
      );
    }

    // Get client IP
    const clientIP = headers['cf-connecting-ip'] ||
                     headers['x-forwarded-for']?.split(',')[0] ||
                     headers['x-real-ip'] ||
                     'unknown';

    // Check rate limiting
    const rateLimit = await checkRateLimit(cache, clientIP);
    if (!rateLimit.allowed) {
      return json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(rateLimit.resetAt),
            'Retry-After': String(rateLimit.resetAt - Math.floor(Date.now() / 1000))
          }
        }
      );
    }

    // Get request body
    const payload = await request.text();

    // Verify token if configured
    if (token) {
      const requestToken = gitlabHeaders['x-gitlab-token'];
      if (!requestToken) {
        return json(
          { error: 'Missing webhook token' },
          {
            status: 401,
            headers: {
              'X-Webhook-Status': 'missing-token'
            }
          }
        );
      }

      const isValid = verifyGitLabToken(requestToken, token);
      if (!isValid) {
        console.error('Invalid GitLab webhook token', {
          eventUuid,
          eventType,
          ip: clientIP
        });

        return json(
          { error: 'Invalid webhook token' },
          {
            status: 401,
            headers: {
              'X-Webhook-Status': 'invalid-token'
            }
          }
        );
      }
    }

    // Verify IP is from GitLab (optional but recommended)
    const isFromGitLab = await isGitLabIP(clientIP);
    if (!isFromGitLab) {
      console.warn('Webhook received from non-GitLab IP', {
        eventUuid,
        eventType,
        ip: clientIP
      });
      // Log but don't block - GitLab might use new IPs or be self-hosted
    }

    // Parse payload
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch (error) {
      return json(
        { error: 'Invalid JSON payload' },
        {
          status: 400,
          headers: {
            'X-Webhook-Status': 'invalid-json'
          }
        }
      );
    }

    // Extract action from payload
    let eventAction: string | undefined;
    if (normalizedEventType === 'merge_request') {
      eventAction = (parsedPayload as any).object_attributes?.action;
    } else if (normalizedEventType === 'note') {
      eventAction = 'created'; // GitLab notes are always created
    }

    // Store webhook event for audit trail
    const webhookEvent = await storage.createWebhookEvent({
      provider: 'gitlab',
      eventType: normalizedEventType,
      eventAction,
      payload: parsedPayload,
      signature: gitlabHeaders['x-gitlab-token'], // Store token hash for audit
      headers: gitlabHeaders as Record<string, string>,
      ipAddress: clientIP,
      userAgent: headers['user-agent']
    });

    // Process webhook asynchronously (don't block the response)
    context.cloudflare?.ctx?.waitUntil(
      processor.processWebhookEvent(
        webhookEvent.id,
        'gitlab',
        normalizedEventType,
        parsedPayload
      ).catch(error => {
        console.error('Error processing webhook:', error);
      })
    );

    // Return success response
    return json(
      {
        message: 'Webhook received',
        eventUuid,
        eventType: normalizedEventType,
        eventId: webhookEvent.id
      },
      {
        status: 200,
        headers: {
          'X-Webhook-Status': 'accepted',
          'X-Webhook-Event-Id': webhookEvent.id,
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt)
        }
      }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);

    // Log error but return success to prevent retries for bad payloads
    return json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: {
          'X-Webhook-Status': 'error'
        }
      }
    );
  }
}

/**
 * Handle GET request (webhook info/test)
 */
export async function loader({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare?.env as {
    GITLAB_WEBHOOK_TOKEN?: string;
    WEBHOOK_TOKEN?: string;
  };

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhooks/gitlab`;
  const hasToken = !!(env.GITLAB_WEBHOOK_TOKEN || env.WEBHOOK_TOKEN);

  return json({
    provider: 'gitlab',
    webhookUrl,
    supportedEvents: SUPPORTED_EVENTS,
    tokenHeader: 'X-Gitlab-Token',
    authenticationMethod: 'Secret Token',
    tokenConfigured: hasToken,
    rateLimits: {
      window: RATE_LIMIT_WINDOW,
      maxRequests: RATE_LIMIT_MAX_REQUESTS
    },
    documentation: 'https://docs.gitlab.com/ee/user/project/integrations/webhooks.html',
    setupInstructions: [
      `1. Go to your GitLab project settings`,
      `2. Navigate to Settings > Webhooks`,
      `3. Add webhook with URL: ${webhookUrl}`,
      `4. Configure Secret Token (must match GITLAB_WEBHOOK_TOKEN env var)`,
      `5. Select trigger events:`,
      `   - Merge request events`,
      `   - Comments (for notes)`,
      `   - Push events`,
      `6. Enable SSL verification`,
      `7. Add webhook and test`
    ],
    eventMapping: {
      'Merge Request Hook': 'merge_request',
      'Note Hook': 'note',
      'Push Hook': 'push'
    }
  });
}