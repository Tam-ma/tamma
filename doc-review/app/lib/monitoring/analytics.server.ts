/**
 * Analytics and Metrics Tracking
 *
 * This module provides analytics tracking for production deployments.
 * Cloudflare Workers Analytics is enabled by default in wrangler.jsonc.
 *
 * Additional features:
 * - Custom metrics tracking
 * - Performance monitoring
 * - User behavior analytics
 */

import type { AppLoadContext } from 'react-router';

interface AnalyticsEvent {
  name: string;
  timestamp: number;
  properties?: Record<string, string | number | boolean>;
  user?: {
    id: string;
    email?: string;
  };
}

interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * Track custom analytics event
 */
export async function trackEvent(
  context: AppLoadContext,
  event: AnalyticsEvent
): Promise<void> {
  const env = (context as any).cloudflare?.env || {};

  // Check if analytics is enabled
  if (env.ENABLE_ANALYTICS !== 'true') {
    return;
  }

  try {
    // Store event in KV for later analysis
    const key = `analytics:event:${event.name}:${event.timestamp}`;
    await env.CACHE.put(
      key,
      JSON.stringify(event),
      {
        expirationTtl: 86400 * 30, // 30 days
      }
    );

    // Log event for Cloudflare Analytics
    console.log(JSON.stringify({
      type: 'analytics_event',
      event: event.name,
      properties: event.properties,
      user: event.user?.id,
      timestamp: event.timestamp,
    }));
  } catch (error) {
    console.error('Failed to track analytics event:', error);
  }
}

/**
 * Track performance metric
 */
export async function trackMetric(
  _context: AppLoadContext,
  metric: PerformanceMetric
): Promise<void> {
  try {
    // Log metric for Cloudflare Analytics
    console.log(JSON.stringify({
      type: 'performance_metric',
      metric: metric.name,
      value: metric.value,
      unit: metric.unit,
      tags: metric.tags,
      timestamp: metric.timestamp,
    }));
  } catch (error) {
    console.error('Failed to track performance metric:', error);
  }
}

/**
 * Track page view
 */
export async function trackPageView(
  context: AppLoadContext,
  request: Request,
  user?: { id: string; email?: string }
): Promise<void> {
  const url = new URL(request.url);

  await trackEvent(context, {
    name: 'page_view',
    timestamp: Date.now(),
    properties: {
      path: url.pathname,
      search: url.search,
      referrer: request.headers.get('referer') || '',
    },
    user,
  });
}

/**
 * Track API request
 */
export async function trackApiRequest(
  context: AppLoadContext,
  request: Request,
  response: Response,
  duration: number
): Promise<void> {
  const url = new URL(request.url);

  await trackEvent(context, {
    name: 'api_request',
    timestamp: Date.now(),
    properties: {
      method: request.method,
      path: url.pathname,
      status: response.status,
      duration,
    },
  });

  await trackMetric(context, {
    name: 'api_response_time',
    value: duration,
    unit: 'ms',
    timestamp: Date.now(),
    tags: {
      method: request.method,
      path: url.pathname,
      status: response.status.toString(),
    },
  });
}

/**
 * Track user action
 */
export async function trackUserAction(
  context: AppLoadContext,
  action: string,
  user: { id: string; email?: string },
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  await trackEvent(context, {
    name: 'user_action',
    timestamp: Date.now(),
    properties: {
      action,
      ...properties,
    },
    user,
  });
}

/**
 * Middleware to track request metrics
 */
export async function withMetrics<T>(
  fn: () => Promise<T>,
  context: AppLoadContext,
  metricName: string
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    await trackMetric(context, {
      name: metricName,
      value: duration,
      unit: 'ms',
      timestamp: Date.now(),
      tags: {
        status: 'success',
      },
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    await trackMetric(context, {
      name: metricName,
      value: duration,
      unit: 'ms',
      timestamp: Date.now(),
      tags: {
        status: 'error',
      },
    });

    throw error;
  }
}

/**
 * Get analytics summary for a time period
 */
export async function getAnalyticsSummary(
  _context: AppLoadContext,
  _startTime: number,
  _endTime: number
): Promise<{
  pageViews: number;
  apiRequests: number;
  userActions: number;
  errors: number;
}> {
  // This is a simplified implementation
  // In production, you'd want to aggregate data from KV or use Cloudflare Analytics API

  return {
    pageViews: 0,
    apiRequests: 0,
    userActions: 0,
    errors: 0,
  };
}
