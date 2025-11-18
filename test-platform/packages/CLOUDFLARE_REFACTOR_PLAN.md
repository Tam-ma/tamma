# Backend Cloudflare Workers Refactoring Plan

## Current Problem

The backend API (`packages/api`) uses Node.js-specific dependencies that are not compatible with Cloudflare Workers runtime:

- **knex** - Database ORM requiring Node.js built-ins
- **ioredis** - Redis client requiring Node.js `net`, `tls`, `stream`
- **nodemailer** - Email service requiring Node.js `http`, `https`, `fs`
- **jsonwebtoken** - JWT library requiring Node.js `crypto`
- **bcryptjs** - Password hashing requiring Node.js `crypto`

**Error**: `Uncaught ReferenceError: __dirname is not defined`

## Architecture Clarification

Based on the AIBaaS platform design, we have:

1. **Public Website/API** (packages/web + packages/api)
   - User authentication and management
   - Benchmark results leaderboard
   - API key management
   - **Must be Cloudflare Workers compatible**

2. **Benchmark Runner** (separate service, TBD)
   - Executes code benchmarks
   - Runs tests and scoring
   - Can use different infrastructure (not Cloudflare Workers)

## Refactoring Strategy

### Replace with Cloudflare-Native Services

| Current Dependency | Cloudflare Alternative | Purpose |
|-------------------|------------------------|---------|
| knex + PostgreSQL | **Cloudflare D1** | Database ORM and SQL |
| ioredis + Redis | **Cloudflare KV** | Caching and sessions |
| nodemailer | **Cloudflare Email Workers** | Email sending |
| jsonwebtoken | **@tsndr/cloudflare-worker-jwt** | JWT without Node.js deps |
| bcryptjs | **Web Crypto API** | Password hashing |

### Migration Path

#### Phase 1: Database Migration (Cloudflare D1)

**Cloudflare D1** is a serverless SQL database built on SQLite:

```typescript
// Instead of knex
import { drizzle } from 'drizzle-orm/d1'

export interface Env {
  DB: D1Database
}

export default {
  async fetch(request: Request, env: Env) {
    const db = drizzle(env.DB)
    // Use drizzle ORM with D1
  }
}
```

**Benefits**:
- Serverless SQL (no connection management)
- Free up to 5GB storage
- SQL-compatible migrations
- TypeScript schema definitions

**wrangler.jsonc update**:
```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "aibaas",
      "database_id": "<create-with-wrangler-d1-create>"
    }
  ]
}
```

#### Phase 2: Replace Redis with KV

**Cloudflare KV** for caching and sessions:

```typescript
export interface Env {
  KV: KVNamespace
}

// Session storage
await env.KV.put(`session:${sessionId}`, JSON.stringify(session), {
  expirationTtl: 3600 // 1 hour
})

// Rate limiting
const key = `rate:${ip}:${endpoint}`
const count = await env.KV.get(key) || 0
await env.KV.put(key, count + 1, { expirationTtl: 60 })
```

**wrangler.jsonc update**:
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "<create-with-wrangler-kv-create>"
    }
  ]
}
```

#### Phase 3: Email with Cloudflare Email Workers

**Cloudflare Email Workers** for sending emails:

```typescript
import { EmailMessage } from 'cloudflare:email'

export default {
  async email(message: EmailMessage, env: Env) {
    // Send email verification
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@aibaas.com',
        to: user.email,
        subject: 'Verify your email',
        html: verificationTemplate
      })
    })
  }
}
```

**Alternative**: Use Resend or SendGrid API directly (Cloudflare Workers compatible)

#### Phase 4: JWT with Workers-Compatible Library

Replace `jsonwebtoken` with **@tsndr/cloudflare-worker-jwt**:

```typescript
import jwt from '@tsndr/cloudflare-worker-jwt'

// Sign JWT
const token = await jwt.sign(
  { userId: user.id, email: user.email },
  env.JWT_SECRET,
  { expiresIn: '15m' }
)

// Verify JWT
const isValid = await jwt.verify(token, env.JWT_SECRET)
const decoded = jwt.decode(token)
```

**Install**:
```bash
npm install @tsndr/cloudflare-worker-jwt
```

#### Phase 5: Password Hashing with Web Crypto API

Replace `bcryptjs` with **Web Crypto API**:

```typescript
// Hash password
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Verify password
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const hashedInput = await hashPassword(password)
  return hashedInput === hash
}
```

**Note**: For production, use a more secure method like Argon2 via WebAssembly or a third-party service.

## Updated wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "api",
  "main": "src/index.ts",
  "compatibility_date": "2025-11-11",
  "compatibility_flags": ["nodejs_compat"],
  
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "aibaas",
      "database_id": "your-database-id"
    }
  ],
  
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your-kv-id",
      "preview_id": "your-preview-kv-id"
    }
  ],
  
  "vars": {
    "ENVIRONMENT": "development"
  },
  
  "secrets": [
    "JWT_SECRET",
    "RESEND_API_KEY"
  ]
}
```

## Implementation Steps

### Step 1: Install Cloudflare-Compatible Packages

```bash
cd packages/api
npm uninstall knex ioredis nodemailer jsonwebtoken bcryptjs
npm install drizzle-orm @tsndr/cloudflare-worker-jwt
npm install -D drizzle-kit
```

### Step 2: Create D1 Database

```bash
npx wrangler d1 create aibaas
# Copy the database_id to wrangler.jsonc
```

### Step 3: Create KV Namespace

```bash
npx wrangler kv:namespace create "KV"
npx wrangler kv:namespace create "KV" --preview
# Copy the ids to wrangler.jsonc
```

### Step 4: Define Drizzle Schema

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').notNull(), // JSON array
  rateLimit: integer('rate_limit').default(1000),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  status: text('status').default('active'),
})
```

### Step 5: Create Migrations

```bash
npx drizzle-kit generate:sqlite
npx wrangler d1 execute aibaas --local --file=./drizzle/0000_initial.sql
```

### Step 6: Update src/index.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'

export interface Env {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  RESEND_API_KEY: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS
app.use('/*', cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Initialize DB middleware
app.use('*', async (c, next) => {
  const db = drizzle(c.env.DB, { schema })
  c.set('db', db)
  await next()
})

// Routes
app.get('/', (c) => c.json({ message: 'AIBaaS API' }))

export default app
```

## Testing Plan

1. **Local D1 Database**: Use `--local` flag for development
2. **Local KV**: Use `--local` flag for development
3. **Test Authentication**: Register, verify, login flows
4. **Test API Keys**: Generate, list, revoke operations
5. **Deploy to Workers**: Test in production environment

## Cost Implications

### Cloudflare Free Tier
- **D1**: 5GB storage, 5M reads/day, 100K writes/day
- **KV**: 100K reads/day, 1K writes/day, 1GB storage
- **Workers**: 100K requests/day
- **Email Workers**: Use Resend free tier (100 emails/day)

### Paid Tier (if needed)
- **Workers Paid** ($5/month): 10M requests
- **D1** ($5/month base + usage)
- **KV** ($0.50/GB storage)

**Estimated Monthly Cost**: $0-15 (likely free tier sufficient for MVP)

## Timeline

- **Day 1-2**: Install packages, setup D1 and KV
- **Day 3-4**: Migrate database schema with Drizzle
- **Day 5-6**: Refactor authentication endpoints
- **Day 7**: Refactor API key endpoints
- **Day 8**: Testing and debugging
- **Day 9**: Deploy to Cloudflare Workers
- **Day 10**: Integration testing with frontend

## Success Criteria

- ✅ Backend starts successfully with `npm run dev`
- ✅ All authentication endpoints work
- ✅ All API key endpoints work
- ✅ Frontend can communicate with backend
- ✅ Deployable to Cloudflare Workers
- ✅ No Node.js-specific dependencies

---

**Status**: Ready to implement
**Estimated Effort**: 10 days
**Risk Level**: Medium (requires significant refactoring)
**Benefit**: Full Cloudflare Workers compatibility, lower costs, better scalability
