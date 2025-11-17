import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  RESEND_API_KEY?: string
  ENVIRONMENT: string
}

/**
 * Extended Hono context with database instance
 */
export interface HonoContext {
  Bindings: Env
  Variables: {
    db: ReturnType<typeof drizzle<typeof schema>>
  }
}

const app = new Hono<HonoContext>()

// CORS configuration for frontend
app.use('/*', cors({
  origin: (origin) => {
    // Allow requests from frontend dev server and production
    const allowedOrigins = [
      'http://localhost:3100',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
    ]
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  },
  credentials: true, // Enable cookies for JWT refresh tokens
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Set-Cookie'],
}))

// Initialize database middleware
app.use('*', async (c, next) => {
  const db = drizzle(c.env.DB, { schema })
  c.set('db', db)
  await next()
})

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    message: 'AIBaaS API - AI Benchmarking as a Service',
    version: '1.0.0',
    environment: c.env.ENVIRONMENT || 'development',
    endpoints: {
      auth: '/auth',
      apiKeys: '/api-keys',
    },
    status: 'healthy',
  })
})

// Import and mount routes
import { authRoutes } from './routes/auth.routes'
import { apiKeyRoutes } from './routes/api-key.routes'

app.route('/auth', authRoutes)
app.route('/api-keys', apiKeyRoutes)

export default app
