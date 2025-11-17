/**
 * GitHub Webhook Receiver
 *
 * Receives and processes webhook events from GitHub
 * Verifies webhook signatures using HMAC-SHA256
 */

import type { ActionFunctionArgs } from 'react-router';
import { json } from 'react-router';
import { WebhookStorage } from '~/lib/webhooks/storage.server';
import { WebhookProcessor } from '~/lib/webhooks/processor.server';
import type { GitHubWebhookHeaders } from '~/lib/webhooks/types';

// GitHub webhook events we're interested in
const SUPPORTED_EVENTS = ['pull_request', 'pull_request_review', 'issue_comment', 'push'];

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX_REQUESTS = 100;

/**
 * Verify GitHub webhook signature
 */
async function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // GitHub sends the signature in the format: sha256=<signature>
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const signatureHash = signature.substring(7); // Remove 'sha256=' prefix

    // Create HMAC-SHA256 hash
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));

    // Convert to hex string
    const computedHash = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(signatureHash, computedHash);
  } catch (error) {
    console.error('Error verifying GitHub webhook signature:', error);
    return false;
  }
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
 * Check if IP is from GitHub
 */
async function isGitHubIP(ip: string): Promise<boolean> {
  try {
    // GitHub publishes their webhook IPs at https://api.github.com/meta
    // For production, you should fetch and cache this list
    // For now, we'll implement basic validation

    // GitHub's IP ranges (simplified - fetch from API in production)
    const githubIPRanges = [
      '192.30.252.0/22',
      '185.199.108.0/22',
      '140.82.112.0/20',
      '143.55.64.0/20'
    ];

    // TODO: Implement proper IP range checking
    // For now, return true in development, implement properly in production
    return true;
  } catch (error) {
    console.error('Error checking GitHub IP:', error);
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
  const key = `ratelimit:github:${identifier}`;
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
    GITHUB_WEBHOOK_SECRET?: string;
    WEBHOOK_SECRET?: string;
  };

  const db = env.DB;
  const cache = env.CACHE;
  const secret = env.GITHUB_WEBHOOK_SECRET || env.WEBHOOK_SECRET;

  // Initialize storage and processor
  const storage = new WebhookStorage(db);
  const processor = new WebhookProcessor(db, storage);

  try {
    // Get request headers
    const headers = Object.fromEntries(request.headers.entries());
    const githubHeaders: Partial<GitHubWebhookHeaders> = {
      'x-github-event': headers['x-github-event'],
      'x-github-delivery': headers['x-github-delivery'],
      'x-hub-signature-256': headers['x-hub-signature-256'],
      'x-github-hook-id': headers['x-github-hook-id'],
      'x-github-hook-installation-target-id': headers['x-github-hook-installation-target-id'],
      'x-github-hook-installation-target-type': headers['x-github-hook-installation-target-type']
    };

    // Validate required headers
    if (!githubHeaders['x-github-event'] || !githubHeaders['x-github-delivery']) {
      return json(
        { error: 'Missing required GitHub headers' },
        {
          status: 400,
          headers: {
            'X-Webhook-Status': 'invalid-headers'
          }
        }
      );
    }

    const eventType = githubHeaders['x-github-event'];
    const deliveryId = githubHeaders['x-github-delivery'];

    // Check if event type is supported
    if (!SUPPORTED_EVENTS.includes(eventType)) {
      return json(
        { message: `Event type '${eventType}' not supported` },
        {
          status: 200, // Return 200 to prevent GitHub from retrying
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

    // Verify signature if secret is configured
    if (secret) {
      const signature = githubHeaders['x-hub-signature-256'];
      if (!signature) {
        return json(
          { error: 'Missing webhook signature' },
          {
            status: 401,
            headers: {
              'X-Webhook-Status': 'missing-signature'
            }
          }
        );
      }

      const isValid = await verifyGitHubSignature(payload, signature, secret);
      if (!isValid) {
        console.error('Invalid GitHub webhook signature', {
          deliveryId,
          eventType,
          ip: clientIP
        });

        return json(
          { error: 'Invalid webhook signature' },
          {
            status: 401,
            headers: {
              'X-Webhook-Status': 'invalid-signature'
            }
          }
        );
      }
    }

    // Verify IP is from GitHub (optional but recommended)
    const isFromGitHub = await isGitHubIP(clientIP);
    if (!isFromGitHub) {
      console.warn('Webhook received from non-GitHub IP', {
        deliveryId,
        eventType,
        ip: clientIP
      });
      // Log but don't block - GitHub might use new IPs
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

    // Store webhook event for audit trail
    const webhookEvent = await storage.createWebhookEvent({
      provider: 'github',
      eventType,
      eventAction: (parsedPayload as any).action,
      payload: parsedPayload,
      signature: githubHeaders['x-hub-signature-256'],
      headers: githubHeaders as Record<string, string>,
      ipAddress: clientIP,
      userAgent: headers['user-agent']
    });

    // Process webhook asynchronously (don't block the response)
    // In production, you might want to use a queue for this
    context.cloudflare?.ctx?.waitUntil(
      processor.processWebhookEvent(
        webhookEvent.id,
        'github',
        eventType,
        parsedPayload
      ).catch(error => {
        console.error('Error processing webhook:', error);
      })
    );

    // Return success response
    return json(
      {
        message: 'Webhook received',
        deliveryId,
        eventType,
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
    GITHUB_WEBHOOK_SECRET?: string;
    WEBHOOK_SECRET?: string;
  };

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhooks/github`;
  const hasSecret = !!(env.GITHUB_WEBHOOK_SECRET || env.WEBHOOK_SECRET);

  return json({
    provider: 'github',
    webhookUrl,
    supportedEvents: SUPPORTED_EVENTS,
    signatureHeader: 'X-Hub-Signature-256',
    signatureAlgorithm: 'HMAC-SHA256',
    secretConfigured: hasSecret,
    rateLimits: {
      window: RATE_LIMIT_WINDOW,
      maxRequests: RATE_LIMIT_MAX_REQUESTS
    },
    documentation: 'https://docs.github.com/webhooks',
    setupInstructions: [
      `1. Go to your GitHub repository settings`,
      `2. Navigate to Webhooks section`,
      `3. Add webhook with URL: ${webhookUrl}`,
      `4. Set Content-Type to 'application/json'`,
      `5. Configure secret (must match GITHUB_WEBHOOK_SECRET env var)`,
      `6. Select events: ${SUPPORTED_EVENTS.join(', ')}`,
      `7. Save and test the webhook`
    ]
  });
}