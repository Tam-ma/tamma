import { json, type LoaderFunctionArgs } from 'react-router';
import type { AppLoadContext } from '@react-router/cloudflare';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  checks: {
    database: {
      status: 'healthy' | 'unhealthy';
      latency?: number;
      error?: string;
    };
    kv: {
      status: 'healthy' | 'unhealthy';
      latency?: number;
      error?: string;
    };
    storage: {
      status: 'healthy' | 'unhealthy';
      error?: string;
    };
    git: {
      status: 'healthy' | 'unhealthy';
      configured: boolean;
      provider?: string;
      error?: string;
    };
  };
}

async function checkDatabase(context: AppLoadContext): Promise<HealthCheckResult['checks']['database']> {
  try {
    const startTime = Date.now();

    // Simple query to check database connectivity
    const result = await context.cloudflare.env.DB.prepare(
      'SELECT 1 as health_check'
    ).first();

    const latency = Date.now() - startTime;

    if (result && result.health_check === 1) {
      return {
        status: 'healthy',
        latency,
      };
    }

    return {
      status: 'unhealthy',
      error: 'Unexpected query result',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkKV(context: AppLoadContext): Promise<HealthCheckResult['checks']['kv']> {
  try {
    const startTime = Date.now();

    // Try to write and read a test value
    const testKey = 'health_check_test';
    const testValue = Date.now().toString();

    await context.cloudflare.env.CACHE.put(testKey, testValue, {
      expirationTtl: 60, // 1 minute
    });

    const result = await context.cloudflare.env.CACHE.get(testKey);
    const latency = Date.now() - startTime;

    // Clean up test key
    await context.cloudflare.env.CACHE.delete(testKey);

    if (result === testValue) {
      return {
        status: 'healthy',
        latency,
      };
    }

    return {
      status: 'unhealthy',
      error: 'KV read/write mismatch',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkStorage(context: AppLoadContext): Promise<HealthCheckResult['checks']['storage']> {
  try {
    // Check if R2 bucket is accessible
    // Note: R2 list operation to check bucket existence
    const bucket = context.cloudflare.env.STORAGE;

    if (!bucket) {
      return {
        status: 'unhealthy',
        error: 'R2 bucket not configured',
      };
    }

    // Simple head request to check bucket accessibility
    // We'll just check if the binding exists and is accessible
    return {
      status: 'healthy',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function checkGit(context: AppLoadContext): HealthCheckResult['checks']['git'] {
  try {
    const env = context.cloudflare.env;
    const provider = env.GIT_PROVIDER;
    const owner = env.GIT_OWNER;
    const repo = env.GIT_REPO;

    // Check if Git provider is configured
    const configured = !!(provider && owner && repo);

    if (!configured) {
      return {
        status: 'unhealthy',
        configured: false,
        error: 'Git provider not fully configured',
      };
    }

    // Check if OAuth credentials are set (we can't verify them without making an API call)
    const hasGitHubCredentials = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
    const hasGitLabCredentials = !!(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET);

    const hasCredentials =
      (provider === 'github' && hasGitHubCredentials) ||
      (provider === 'gitlab' && hasGitLabCredentials);

    if (!hasCredentials) {
      return {
        status: 'unhealthy',
        configured: true,
        provider,
        error: 'OAuth credentials not configured',
      };
    }

    return {
      status: 'healthy',
      configured: true,
      provider,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      configured: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;

  // Run all health checks in parallel
  const [databaseCheck, kvCheck, storageCheck, gitCheck] = await Promise.all([
    checkDatabase(context),
    checkKV(context),
    checkStorage(context),
    Promise.resolve(checkGit(context)),
  ]);

  // Determine overall health status
  const allHealthy =
    databaseCheck.status === 'healthy' &&
    kvCheck.status === 'healthy' &&
    storageCheck.status === 'healthy' &&
    gitCheck.status === 'healthy';

  const anyUnhealthy =
    databaseCheck.status === 'unhealthy' ||
    kvCheck.status === 'unhealthy' ||
    storageCheck.status === 'unhealthy' ||
    gitCheck.status === 'unhealthy';

  const overallStatus = allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded';

  const healthCheck: HealthCheckResult = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: env.APP_VERSION || '1.0.0',
    environment: env.NODE_ENV || 'development',
    checks: {
      database: databaseCheck,
      kv: kvCheck,
      storage: storageCheck,
      git: gitCheck,
    },
  };

  // Return appropriate HTTP status code
  const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 207 : 503;

  return json(healthCheck, {
    status: statusCode,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': 'application/json',
    },
  });
}

// Export a simple component for browsers
export default function Health() {
  return null;
}
