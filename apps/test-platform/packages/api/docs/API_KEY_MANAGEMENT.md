# API Key Management Documentation

## Overview

The API Key Management system provides secure generation, authentication, and management of API keys for programmatic access to the Test Platform. It includes comprehensive features for key lifecycle management, usage tracking, rate limiting, and security controls.

## Features

### Core Features
- **Secure Key Generation**: Cryptographically secure API keys with HMAC-SHA256 hashing
- **Key Authentication**: Middleware for validating API keys in requests
- **Key Management**: Full CRUD operations for API keys
- **Usage Tracking**: Detailed tracking of API key usage and statistics
- **Rate Limiting**: Per-key rate limiting with configurable limits
- **Key Rotation**: Secure key rotation with automatic old key revocation
- **Permissions & Scopes**: Fine-grained access control
- **IP & Domain Restrictions**: Whitelist specific IPs or domains
- **Expiration Management**: Automatic key expiration handling

## Architecture

### Components

1. **API Key Service** (`api-key-service.ts`)
   - Handles key generation with secure random bytes
   - HMAC-SHA256 hashing for secure storage
   - Key validation and verification
   - Key lifecycle management (create, update, revoke, rotate)

2. **Authentication Middleware** (`api-key-auth.ts`)
   - Request authentication via API keys
   - Permission and scope checking
   - Rate limiting enforcement
   - Multiple header support (Authorization, X-API-Key)

3. **Usage Tracking Service** (`api-key-usage-service.ts`)
   - Real-time usage tracking
   - Statistics aggregation
   - Rate limit checking
   - Redis integration with in-memory fallback

4. **API Endpoints** (`api-key.controller.ts`)
   - RESTful endpoints for key management
   - Input validation with Zod schemas
   - Comprehensive error handling

## API Endpoints

### Authentication

All API key management endpoints require authentication using either:
- JWT token (from user login)
- Valid API key with appropriate permissions

### Endpoints

#### Create API Key
```http
POST /api-keys
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Production API Key",
  "description": "Key for production environment",
  "keyType": "service",
  "permissions": ["read", "write"],
  "scopes": ["api:read", "api:write"],
  "allowedIps": ["192.168.1.1"],
  "allowedDomains": ["example.com"],
  "expiresAt": "2024-12-31T23:59:59Z",
  "usageLimit": 10000,
  "requireMfa": false
}

Response:
{
  "message": "API key created successfully",
  "apiKey": "tp_abc123...", // Full key shown only once
  "keyData": {
    "id": "key_123",
    "keyId": "tp_abc123",
    "keyPrefix": "tp_abc123",
    "name": "Production API Key",
    ...
  }
}
```

#### List API Keys
```http
GET /api-keys
Authorization: Bearer <token>

Response:
{
  "apiKeys": [
    {
      "id": "key_123",
      "name": "Production API Key",
      "status": "active",
      "usageCount": 1234,
      ...
    }
  ]
}
```

#### Get API Key Details
```http
GET /api-keys/:keyId
Authorization: Bearer <token>

Response:
{
  "apiKey": {
    "id": "key_123",
    "name": "Production API Key",
    "permissions": ["read", "write"],
    ...
  }
}
```

#### Update API Key
```http
PATCH /api-keys/:keyId
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Key Name",
  "permissions": ["read"],
  "status": "inactive"
}

Response:
{
  "message": "API key updated successfully",
  "apiKey": { ... }
}
```

#### Revoke API Key
```http
DELETE /api-keys/:keyId
Authorization: Bearer <token>

Response:
{
  "message": "API key revoked successfully"
}
```

#### Rotate API Key
```http
POST /api-keys/:keyId/rotate
Authorization: Bearer <token>

Response:
{
  "message": "API key rotated successfully",
  "apiKey": "tp_newkey123...", // New full key
  "keyData": { ... }
}
```

## Using API Keys

### Request Authentication

API keys can be provided in requests using:

#### Authorization Header (Recommended)
```http
GET /api/resource
Authorization: Bearer tp_your_api_key_here
```

#### X-API-Key Header
```http
GET /api/resource
X-API-Key: tp_your_api_key_here
```

#### Query Parameter (Not Recommended)
```http
GET /api/resource?api_key=tp_your_api_key_here
```

### Middleware Usage

```typescript
import { apiKeyAuth, requirePermissions, requireScopes } from './middleware/api-key-auth';

// Basic API key authentication
app.use('/api/*', apiKeyAuth({ required: true }));

// Require specific permissions
app.use('/admin/*', requirePermissions(['admin', 'write']));

// Require specific scopes
app.use('/api/users/*', requireScopes(['users:read', 'users:write']));

// With rate limiting
app.use('/api/public/*', withRateLimit(100)); // 100 requests per hour
```

## Security Features

### Key Generation
- Uses Node.js `crypto.randomBytes()` for cryptographic randomness
- 48-byte keys encoded as base64url
- Unique prefix (`tp_`) for easy identification

### Key Storage
- Keys are hashed using HMAC-SHA256 before storage
- Original key is never stored in the database
- Only the key prefix is stored for quick lookup

### Key Validation
- Timing-safe comparison to prevent timing attacks
- Automatic expiration checking
- IP and domain restriction enforcement
- Usage limit enforcement

### Rate Limiting
- Per-key rate limiting
- Redis-backed with in-memory fallback
- Configurable limits per endpoint
- Automatic reset after time window

## Usage Tracking

### Tracked Metrics
- Total request count
- Hourly, daily, and monthly usage
- Top endpoints accessed
- Error rates
- Average response times
- Last used timestamp and IP

### Getting Usage Statistics

```typescript
import { apiKeyUsageService } from './services/api-key-usage-service';

const stats = await apiKeyUsageService.getUsageStats('key_123');
console.log(stats);
// {
//   totalRequests: 5432,
//   requestsThisHour: 23,
//   requestsToday: 456,
//   requestsThisMonth: 5432,
//   topEndpoints: [
//     { endpoint: '/api/users', count: 234 },
//     { endpoint: '/api/posts', count: 123 }
//   ],
//   errorRate: 2.3,
//   averageResponseTime: 145.6
// }
```

## Database Schema

### api_keys Table
- `id`: UUID primary key
- `key_id`: Public identifier
- `key_hash`: Hashed API key
- `key_prefix`: First characters for identification
- `user_id`: Owner user ID
- `organization_id`: Optional organization ID
- `name`: Human-readable name
- `permissions`: JSON array of permissions
- `scopes`: JSON array of scopes
- `allowed_ips`: Comma-separated IP whitelist
- `allowed_domains`: Comma-separated domain whitelist
- `status`: active, inactive, revoked, expired
- `expires_at`: Expiration timestamp
- `usage_count`: Total usage counter
- `usage_limit`: Maximum requests allowed
- `last_used_at`: Last usage timestamp

### api_key_usage_logs Table
- `id`: UUID primary key
- `api_key_id`: Foreign key to api_keys
- `endpoint`: Accessed endpoint
- `method`: HTTP method
- `status_code`: Response status
- `response_time`: Response time in ms
- `ip_address`: Client IP
- `user_agent`: Client user agent
- `created_at`: Request timestamp

## Best Practices

### Security
1. **Never expose full API keys**: Show the complete key only once at creation
2. **Use HTTPS always**: Never send API keys over unencrypted connections
3. **Rotate keys regularly**: Implement key rotation policies
4. **Set expiration dates**: Use reasonable expiration periods
5. **Monitor usage**: Track unusual patterns and potential abuse

### Key Management
1. **Use descriptive names**: Make it easy to identify key purposes
2. **Limit permissions**: Follow principle of least privilege
3. **Use IP restrictions**: Limit keys to specific IP addresses when possible
4. **Set usage limits**: Prevent abuse with rate limiting
5. **Regular audits**: Review and revoke unused keys

### Implementation
1. **Use environment variables**: Store HMAC secrets securely
2. **Enable Redis**: Use Redis for production rate limiting
3. **Log key operations**: Maintain audit trails
4. **Monitor performance**: Track API key validation latency
5. **Handle errors gracefully**: Don't expose internal details

## Environment Variables

```env
# API Key Configuration
API_KEY_HMAC_SECRET=your-secret-key-for-hmac
API_KEY_DEFAULT_EXPIRY_DAYS=365
API_KEY_MAX_USAGE_PER_HOUR=1000

# Redis Configuration (for rate limiting)
REDIS_URL=redis://localhost:6379
```

## Migration Guide

To enable API key management:

1. Run the database migrations:
```bash
npm run migrate:latest
```

2. Set environment variables:
```bash
export API_KEY_HMAC_SECRET=$(openssl rand -base64 32)
export REDIS_URL=redis://localhost:6379
```

3. Import and use the routes:
```typescript
import apiKeyRoutes from './routes/api-key.routes';
app.route('/api-keys', apiKeyRoutes);
```

4. Add authentication middleware to protected routes:
```typescript
import { apiKeyAuth } from './middleware/api-key-auth';
app.use('/api/*', apiKeyAuth({ required: true }));
```

## Troubleshooting

### Common Issues

1. **"API key is required"**
   - Ensure the API key is provided in the correct header
   - Check that the middleware is configured correctly

2. **"Invalid API key"**
   - Verify the key hasn't been revoked
   - Check that the full key is being sent (including prefix)

3. **"API key has expired"**
   - Generate a new API key
   - Consider implementing key rotation

4. **"Rate limit exceeded"**
   - Wait for the rate limit window to reset
   - Request a higher rate limit if needed

5. **"IP address not allowed"**
   - Ensure requests come from whitelisted IPs
   - Update allowed IPs in key settings

## Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run API key tests specifically
npm test api-key

# Run with coverage
npm test -- --coverage
```

## Support

For issues or questions about API key management, please:
1. Check this documentation
2. Review the test files for usage examples
3. Contact the platform team

---

*Last updated: November 2024*