export type APIKeyStatus = 'active' | 'inactive' | 'expired' | 'revoked';

export type APIKeyScope = 
  | 'read:tests'
  | 'write:tests'
  | 'read:results'
  | 'write:results'
  | 'read:benchmarks'
  | 'write:benchmarks';

export interface APIKeyUsage {
  totalRequests: number;
  requestsThisPeriod: number;
  errorRate: number;
  avgRequestsPerDay: number;
  successRate: number;
  rateLimitUtilization: number;
}

export interface APIKey {
  id: string;
  name: string;
  description?: string;
  keyPrefix: string;
  scopes: APIKeyScope[];
  rateLimit: number;
  expiresAt?: Date | string;
  createdAt: Date | string;
  lastUsedAt?: Date | string;
  lastUsedIp?: string;
  usage: APIKeyUsage;
  status: APIKeyStatus;
  ipWhitelist?: string[];
}

export interface CreateAPIKeyRequest {
  name: string;
  description?: string;
  scopes: APIKeyScope[];
  rateLimit: number;
  expiresIn?: number; // days
  ipWhitelist?: string[];
}

export interface UpdateAPIKeyRequest {
  name?: string;
  description?: string;
  rateLimit?: number;
  ipWhitelist?: string[];
}

export interface APIKeyGeneratedResponse {
  apiKey: APIKey;
  fullKey: string; // Only returned on creation
}

export interface UsageStatsByEndpoint {
  endpoint: string;
  count: number;
  errorCount: number;
}

export interface UsageStatsOverTime {
  timestamp: string;
  requests: number;
  errors: number;
}

export interface SecurityEvent {
  id: string;
  timestamp: Date | string;
  event: 'key_created' | 'key_revoked' | 'key_used' | 'rate_limit_exceeded' | 'unauthorized_ip';
  ipAddress?: string;
  details?: string;
}

export interface APIKeyUsageDetails {
  overTime: UsageStatsOverTime[];
  byEndpoint: UsageStatsByEndpoint[];
  recentRequests: {
    timestamp: string;
    endpoint: string;
    statusCode: number;
    ipAddress: string;
  }[];
  securityEvents: SecurityEvent[];
}

export interface APIKeysListResponse {
  apiKeys: APIKey[];
  total: number;
  page: number;
  pageSize: number;
}

export interface APIKeyFilters {
  status?: APIKeyStatus;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'lastUsedAt' | 'status';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const SCOPE_DESCRIPTIONS: Record<APIKeyScope, string> = {
  'read:tests': 'View test configurations and details',
  'write:tests': 'Create, update, and delete tests',
  'read:results': 'View test execution results',
  'write:results': 'Submit test results',
  'read:benchmarks': 'View benchmark data and analytics',
  'write:benchmarks': 'Create and update benchmark configurations',
};

export const EXPIRATION_OPTIONS = [
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
  { label: '1 Year', value: 365 },
  { label: 'Never', value: undefined },
] as const;
