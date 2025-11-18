# Frontend-Backend Integration Guide

This document outlines how the frontend (`packages/web`) integrates with the backend API (`packages/api`).

## Architecture Overview

### Backend (Cloudflare Workers + Hono)
- **Framework**: Hono
- **Runtime**: Cloudflare Workers
- **Default Port**: 8787 (wrangler dev)
- **Base URL**: `http://localhost:8787`

### Frontend (Next.js 15 + React 19)
- **Framework**: Next.js 15 with App Router
- **React Version**: 19
- **Default Port**: 3000 (next dev)
- **API Base URL**: Configured via `NEXT_PUBLIC_API_BASE_URL`

## Configuration

### Backend Configuration

**File**: `packages/api/src/index.ts`

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// CORS configuration for frontend
app.use('/*', cors({
  origin: (origin) => {
    const allowedOrigins = [
      'http://localhost:3000',  // Next.js dev server
      'http://localhost:5173',  // Vite fallback
      'http://localhost:5174',
    ]
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  },
  credentials: true, // Enable cookies for JWT refresh tokens
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Set-Cookie'],
}))
```

### Frontend Configuration

**File**: `packages/web/.env`

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

**File**: `packages/web/src/services/api.ts`

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true, // Important for cookie-based auth
})
```

## API Services

### Authentication Service

**File**: `packages/web/src/services/auth.service.ts`

Provides methods for:
- User registration (`register`)
- Email verification (`verifyEmail`, `resendVerificationEmail`)
- Login/logout (`login`, `logout`)
- Token refresh (`refreshToken`)
- Password management (`forgotPassword`, `resetPassword`, `changePassword`)
- User profile (`getCurrentUser`)

**Usage Example**:

```typescript
import { authService } from '@/services/auth.service'

// Register a new user
const result = await authService.register({
  email: 'user@example.com',
  password: 'SecureP@ss123',
  fullName: 'John Doe'
})

// Login
const authResponse = await authService.login({
  email: 'user@example.com',
  password: 'SecureP@ss123',
  rememberMe: true
})
```

### API Keys Service

**File**: `packages/web/src/services/api-keys.service.ts`

Provides methods for:
- Key generation (`generateKey`)
- List keys (`listKeys`)
- Get key details (`getKey`)
- Update key (`updateKey`)
- Revoke key (`revokeKey`)
- Usage statistics (`getKeyUsage`)

**Usage Example**:

```typescript
import { apiKeysService } from '@/services/api-keys.service'

// Generate a new API key
const newKey = await apiKeysService.generateKey({
  name: 'Production API Key',
  description: 'Key for production environment',
  scopes: ['read:benchmarks', 'write:benchmarks'],
  rateLimit: 1000,
  expiresAt: '2025-12-31'
})

// List all keys
const { keys, total } = await apiKeysService.listKeys({
  page: 1,
  limit: 10,
  status: 'active'
})
```

## Authentication Flow

### JWT Token Management

The application uses a dual-token authentication system:

1. **Access Token**: 
   - Stored in memory (not localStorage for security)
   - Short-lived (15 minutes)
   - Sent with each API request

2. **Refresh Token**:
   - Stored in HttpOnly cookies
   - Long-lived (7 or 30 days based on "Remember Me")
   - Used to obtain new access tokens

### Token Refresh Strategy

The frontend automatically refreshes access tokens at 75% of their lifetime:

```typescript
// If access token expires in 15 minutes
// Refresh scheduled at: 15 * 0.75 = 11.25 minutes
```

### Session Management

- **Session Warning**: Displayed 5 minutes before token expiration
- **Auto-logout**: Triggers if user doesn't extend session
- **Silent Refresh**: Happens in background without user interaction

## API Endpoints

### Authentication Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | Register new user |
| `/auth/verify-email` | POST | Verify email with token |
| `/auth/resend-verification` | POST | Resend verification email |
| `/auth/login` | POST | Login user |
| `/auth/logout` | POST | Logout user |
| `/auth/refresh` | POST | Refresh access token |
| `/auth/forgot-password` | POST | Request password reset |
| `/auth/reset-password` | POST | Reset password with token |
| `/auth/change-password` | POST | Change password (authenticated) |
| `/auth/me` | GET | Get current user profile |

### API Keys Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api-keys` | POST | Generate new API key |
| `/api-keys` | GET | List all keys |
| `/api-keys/:id` | GET | Get key details |
| `/api-keys/:id` | PUT | Update key |
| `/api-keys/:id` | DELETE | Revoke key |
| `/api-keys/:id/usage` | GET | Get usage statistics |

## Error Handling

### Client-Side Error Handling

The API client includes automatic error handling:

```typescript
// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    switch (error.response?.status) {
      case 401:
        // Redirect to login
        window.location.href = '/login'
        break
      case 403:
        console.error('Access forbidden')
        break
      case 404:
        console.error('Resource not found')
        break
      case 500:
        console.error('Server error')
        break
    }
    return Promise.reject(error)
  }
)
```

### Error Message Extraction

Helper function to extract user-friendly error messages:

```typescript
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || 
           error.response?.data?.error ||
           `Request failed with status ${error.response?.status}`
  }
  return 'An unexpected error occurred'
}
```

## Security Considerations

### CORS Configuration

- Backend explicitly allows frontend origins
- Credentials enabled for cookie-based auth
- Proper headers exposed for Set-Cookie

### Cookie Security

Refresh tokens should use these attributes:
```typescript
{
  httpOnly: true,  // Not accessible via JavaScript
  secure: true,    // HTTPS only (in production)
  sameSite: 'lax', // CSRF protection
  maxAge: 604800   // 7 days (or 30 for "Remember Me")
}
```

### Input Validation

Both frontend and backend validate:
- Email format (RFC 5322)
- Password complexity (12+ chars, mixed case, numbers, special chars)
- Rate limiting enforcement
- Input sanitization

## Development Workflow

### Starting the Development Environment

1. **Start Backend**:
```bash
cd packages/api
npm run dev  # Runs wrangler dev on port 8787
```

2. **Start Frontend**:
```bash
cd packages/web
npm run dev  # Runs next dev on port 3000
```

3. **Verify Connection**:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8787`
- Health Check: `http://localhost:8787/`

### Testing API Integration

```bash
# Test backend is running
curl http://localhost:8787/

# Expected response:
{
  "message": "Test Platform API",
  "version": "1.0.0",
  "endpoints": {
    "auth": "/auth",
    "apiKeys": "/api-keys"
  }
}
```

## Troubleshooting

### Common Issues

**Issue**: "Network Error" when calling API
- **Solution**: Verify backend is running on port 8787
- **Check**: `NEXT_PUBLIC_API_BASE_URL` in `.env`

**Issue**: CORS errors in browser console
- **Solution**: Verify frontend origin is in allowed origins list
- **Check**: CORS configuration in `packages/api/src/index.ts`

**Issue**: Cookies not being set
- **Solution**: Ensure `withCredentials: true` in axios config
- **Check**: Backend sets proper cookie attributes

**Issue**: Token refresh failing
- **Solution**: Verify `/auth/refresh` endpoint exists
- **Check**: Refresh token cookie is being sent

## Production Deployment

### Environment Variables

**Backend (Cloudflare Workers)**:
- Configure via `wrangler.toml` or Cloudflare dashboard
- Set allowed origins to production URLs

**Frontend (Vercel/etc)**:
```env
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

### CORS for Production

Update allowed origins in `packages/api/src/index.ts`:

```typescript
const allowedOrigins = [
  'https://yourdomain.com',
  'https://www.yourdomain.com',
  'http://localhost:3000', // Keep for local dev
]
```

### Security Checklist

- [ ] HTTPS enabled for all environments
- [ ] Secure cookies enabled (`secure: true`)
- [ ] Production origins configured in CORS
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] Error messages don't expose system details
- [ ] Secrets stored in environment variables
- [ ] CSRF protection enabled

## Next Steps

1. **Testing**: Add E2E tests for complete user flows
2. **Monitoring**: Implement error tracking and analytics
3. **Performance**: Add caching strategies
4. **Documentation**: API documentation with OpenAPI/Swagger
