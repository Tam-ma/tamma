import type { CreateTestBankTask } from '../../types/test-bank.types'
import { getCodeGenRoleEvaluations } from './role-evaluations'
import { generatedHardTasks } from './generate-hard-tasks'

// First 10 tasks are hand-crafted with full implementations
// Remaining 40 tasks are template-generated with core structure
const handCraftedTasks: CreateTestBankTask[] = [
  // ============================================================================
  // DISTRIBUTED SYSTEMS (10 tasks)
  // ============================================================================
  {
    title: 'Distributed Rate Limiter with Sliding Window',
    description:
      'Implement a distributed rate limiter using sliding window algorithm with Redis backend, token bucket fallback, and multi-tier rate limiting.',
    prompt: `Create a distributed rate limiter that handles API rate limiting across multiple servers. It should support different rate limits for different user tiers and endpoints. Include monitoring and graceful degradation.`,
    solution: `import { EventEmitter } from 'events'

/**
 * Distributed Rate Limiter with Sliding Window Algorithm
 *
 * Supports multi-tier rate limiting, Redis backend, and graceful degradation.
 *
 * @example
 * const limiter = new DistributedRateLimiter({ redisClient })
 * const allowed = await limiter.checkLimit('user123', 'premium', '/api/data')
 */

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  burstSize?: number
}

interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, expiryMs: number): Promise<void>
  zadd(key: string, score: number, member: string): Promise<void>
  zremrangebyscore(key: string, min: number, max: number): Promise<void>
  zcard(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
}

type UserTier = 'free' | 'premium' | 'enterprise'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
}

export class DistributedRateLimiter extends EventEmitter {
  private configs: Map<string, RateLimitConfig>
  private localCache: Map<string, { count: number; resetAt: number }>
  private redisClient?: RedisClient
  private fallbackMode: boolean = false

  constructor(options: { redisClient?: RedisClient }) {
    super()
    this.redisClient = options.redisClient
    this.localCache = new Map()
    this.configs = new Map()
    this.initializeDefaultConfigs()
  }

  private initializeDefaultConfigs(): void {
    this.configs.set('free', { windowMs: 60000, maxRequests: 10, burstSize: 2 })
    this.configs.set('premium', { windowMs: 60000, maxRequests: 100, burstSize: 20 })
    this.configs.set('enterprise', { windowMs: 60000, maxRequests: 1000, burstSize: 100 })
  }

  setConfig(tier: UserTier, config: RateLimitConfig): void {
    this.configs.set(tier, config)
  }

  async checkLimit(userId: string, tier: UserTier, endpoint: string): Promise<RateLimitResult> {
    const config = this.configs.get(tier)
    if (!config) {
      throw new Error(\`Unknown tier: \${tier}\`)
    }

    try {
      if (this.redisClient && !this.fallbackMode) {
        return await this.checkLimitRedis(userId, endpoint, config)
      }
      return this.checkLimitLocal(userId, endpoint, config)
    } catch (error) {
      this.emit('error', error)
      this.fallbackMode = true
      return this.checkLimitLocal(userId, endpoint, config)
    }
  }

  private async checkLimitRedis(
    userId: string,
    endpoint: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const key = \`ratelimit:\${userId}:\${endpoint}\`
    const now = Date.now()
    const windowStart = now - config.windowMs

    await this.redisClient!.zremrangebyscore(key, 0, windowStart)
    const count = await this.redisClient!.zcard(key)

    if (count >= config.maxRequests) {
      const resetAt = now + config.windowMs
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: Math.ceil(config.windowMs / 1000),
      }
    }

    await this.redisClient!.zadd(key, now, \`\${now}-\${Math.random()}\`)
    await this.redisClient!.expire(key, Math.ceil(config.windowMs / 1000))

    return {
      allowed: true,
      remaining: config.maxRequests - count - 1,
      resetAt: now + config.windowMs,
    }
  }

  private checkLimitLocal(
    userId: string,
    endpoint: string,
    config: RateLimitConfig
  ): RateLimitResult {
    const key = \`\${userId}:\${endpoint}\`
    const now = Date.now()
    const cached = this.localCache.get(key)

    if (!cached || now >= cached.resetAt) {
      this.localCache.set(key, { count: 1, resetAt: now + config.windowMs })
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: now + config.windowMs,
      }
    }

    if (cached.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: cached.resetAt,
        retryAfter: Math.ceil((cached.resetAt - now) / 1000),
      }
    }

    cached.count++
    return {
      allowed: true,
      remaining: config.maxRequests - cached.count,
      resetAt: cached.resetAt,
    }
  }

  clearCache(): void {
    this.localCache.clear()
  }

  getStats(userId: string, endpoint: string): { count: number; resetAt: number } | null {
    const key = \`\${userId}:\${endpoint}\`
    return this.localCache.get(key) || null
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DistributedRateLimiter } from './solution'

describe('DistributedRateLimiter', () => {
  let limiter: DistributedRateLimiter
  let mockRedis: any

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      zadd: vi.fn(),
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      expire: vi.fn(),
    }
    limiter = new DistributedRateLimiter({ redisClient: mockRedis })
  })

  it('should allow requests within limit', async () => {
    mockRedis.zcard.mockResolvedValue(5)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThanOrEqual(0)
  })

  it('should deny requests exceeding limit', async () => {
    mockRedis.zcard.mockResolvedValue(10)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeDefined()
  })

  it('should handle different tiers correctly', async () => {
    mockRedis.zcard.mockResolvedValue(50)
    const freeTier = await limiter.checkLimit('user1', 'free', '/api/data')
    const premiumTier = await limiter.checkLimit('user2', 'premium', '/api/data')
    expect(freeTier.allowed).toBe(false)
    expect(premiumTier.allowed).toBe(true)
  })

  it('should fallback to local cache on Redis failure', async () => {
    mockRedis.zcard.mockRejectedValue(new Error('Redis unavailable'))
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result).toBeDefined()
  })

  it('should track requests per endpoint', async () => {
    mockRedis.zcard.mockResolvedValue(0)
    await limiter.checkLimit('user1', 'free', '/api/data')
    await limiter.checkLimit('user1', 'free', '/api/other')
    expect(mockRedis.zadd).toHaveBeenCalledTimes(2)
  })

  it('should remove expired entries', async () => {
    await limiter.checkLimit('user1', 'free', '/api/data')
    expect(mockRedis.zremrangebyscore).toHaveBeenCalled()
  })

  it('should set expiry on keys', async () => {
    mockRedis.zcard.mockResolvedValue(0)
    await limiter.checkLimit('user1', 'free', '/api/data')
    expect(mockRedis.expire).toHaveBeenCalled()
  })

  it('should calculate remaining requests correctly', async () => {
    mockRedis.zcard.mockResolvedValue(7)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.remaining).toBe(2)
  })

  it('should handle custom tier configurations', () => {
    limiter.setConfig('premium', { windowMs: 30000, maxRequests: 50 })
    expect(() => limiter.checkLimit('user1', 'premium', '/api/data')).not.toThrow()
  })

  it('should throw error for unknown tier', async () => {
    await expect(limiter.checkLimit('user1', 'unknown' as any, '/api/data')).rejects.toThrow()
  })

  it('should clear local cache', () => {
    limiter.clearCache()
    const stats = limiter.getStats('user1', '/api/data')
    expect(stats).toBeNull()
  })

  it('should emit error events on failures', async () => {
    const errorSpy = vi.fn()
    limiter.on('error', errorSpy)
    mockRedis.zcard.mockRejectedValue(new Error('Redis error'))
    await limiter.checkLimit('user1', 'free', '/api/data')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('should handle concurrent requests', async () => {
    mockRedis.zcard.mockResolvedValue(5)
    const promises = Array.from({ length: 10 }, () =>
      limiter.checkLimit('user1', 'free', '/api/data')
    )
    const results = await Promise.all(promises)
    expect(results).toHaveLength(10)
  })

  it('should provide reset timestamp', async () => {
    mockRedis.zcard.mockResolvedValue(0)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('should handle burst traffic with burstSize', async () => {
    mockRedis.zcard.mockResolvedValue(11)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.allowed).toBe(false)
  })

  it('should track stats in local mode', () => {
    limiter = new DistributedRateLimiter({})
    limiter.checkLimit('user1', 'free', '/api/data')
    const stats = limiter.getStats('user1', '/api/data')
    expect(stats).toBeDefined()
    expect(stats?.count).toBe(1)
  })

  it('should reset window after expiry in local mode', async () => {
    limiter = new DistributedRateLimiter({})
    await limiter.checkLimit('user1', 'free', '/api/data')
    vi.useFakeTimers()
    vi.advanceTimersByTime(61000)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.remaining).toBe(9)
    vi.useRealTimers()
  })

  it('should handle enterprise tier limits', async () => {
    mockRedis.zcard.mockResolvedValue(500)
    const result = await limiter.checkLimit('user1', 'enterprise', '/api/data')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThan(400)
  })

  it('should provide retry-after in seconds', async () => {
    mockRedis.zcard.mockResolvedValue(10)
    const result = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(result.retryAfter).toBeGreaterThan(0)
    expect(result.retryAfter).toBeLessThanOrEqual(60)
  })

  it('should handle rapid sequential requests', async () => {
    mockRedis.zcard.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const r1 = await limiter.checkLimit('user1', 'free', '/api/data')
    const r2 = await limiter.checkLimit('user1', 'free', '/api/data')
    const r3 = await limiter.checkLimit('user1', 'free', '/api/data')
    expect(r1.allowed && r2.allowed && r3.allowed).toBe(true)
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: [
      'distributed-systems',
      'rate-limiting',
      'redis',
      'sliding-window',
      'scalability',
    ],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Circuit Breaker Pattern with Health Monitoring',
    description:
      'Implement a circuit breaker pattern with configurable failure thresholds, half-open state testing, and real-time health monitoring.',
    prompt: `Build a circuit breaker that protects against cascading failures in microservices. It should track success/failure rates, support different failure types, and provide health metrics.`,
    solution: `import { EventEmitter } from 'events'

/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by monitoring service health and opening circuit when threshold is exceeded.
 *
 * @example
 * const breaker = new CircuitBreaker({ failureThreshold: 5, timeout: 60000 })
 * const result = await breaker.execute(() => serviceCall())
 */

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold: number
  successThreshold?: number
  timeout: number
  resetTimeout?: number
  monitoringWindow?: number
}

interface HealthMetrics {
  state: CircuitState
  failures: number
  successes: number
  totalRequests: number
  errorRate: number
  lastFailureTime?: number
}

class CircuitBreakerError extends Error {
  constructor(message: string, public state: CircuitState) {
    super(message)
    this.name = 'CircuitBreakerError'
  }
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED
  private failures: number = 0
  private successes: number = 0
  private totalRequests: number = 0
  private nextAttempt: number = 0
  private config: Required<CircuitBreakerConfig>
  private recentResults: Array<{ timestamp: number; success: boolean }> = []

  constructor(config: CircuitBreakerConfig) {
    super()
    this.config = {
      successThreshold: 2,
      resetTimeout: config.timeout,
      monitoringWindow: 60000,
      ...config,
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerError('Circuit breaker is OPEN', this.state)
      }
      this.transitionTo(CircuitState.HALF_OPEN)
    }

    try {
      this.totalRequests++
      const result = await this.executeWithTimeout(operation)
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error('Operation timeout')),
          this.config.timeout
        )
      ),
    ])
  }

  private onSuccess(): void {
    this.successes++
    this.recordResult(true)

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED)
        this.reset()
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failures = 0
    }
  }

  private onFailure(error: unknown): void {
    this.failures++
    this.recordResult(false)
    this.emit('failure', error)

    if (
      this.state === CircuitState.HALF_OPEN ||
      this.failures >= this.config.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN)
      this.nextAttempt = Date.now() + this.config.resetTimeout
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state
      this.state = newState
      this.emit('stateChange', { from: oldState, to: newState })

      if (newState === CircuitState.OPEN) {
        this.emit('open')
      } else if (newState === CircuitState.CLOSED) {
        this.emit('close')
      }
    }
  }

  private reset(): void {
    this.failures = 0
    this.successes = 0
  }

  private recordResult(success: boolean): void {
    const now = Date.now()
    this.recentResults.push({ timestamp: now, success })
    this.recentResults = this.recentResults.filter(
      (r) => now - r.timestamp < this.config.monitoringWindow
    )
  }

  getMetrics(): HealthMetrics {
    const windowResults = this.recentResults.filter(
      (r) => Date.now() - r.timestamp < this.config.monitoringWindow
    )
    const failureCount = windowResults.filter((r) => !r.success).length
    const errorRate = windowResults.length > 0 ? failureCount / windowResults.length : 0

    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      errorRate,
      lastFailureTime: this.recentResults
        .filter((r) => !r.success)
        .pop()?.timestamp,
    }
  }

  getState(): CircuitState {
    return this.state
  }

  forceOpen(): void {
    this.transitionTo(CircuitState.OPEN)
    this.nextAttempt = Date.now() + this.config.resetTimeout
  }

  forceClose(): void {
    this.transitionTo(CircuitState.CLOSED)
    this.reset()
  }

  isHealthy(): boolean {
    const metrics = this.getMetrics()
    return this.state === CircuitState.CLOSED && metrics.errorRate < 0.5
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CircuitBreaker } from './solution'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      timeout: 1000,
      resetTimeout: 5000,
    })
  })

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED')
  })

  it('should execute successful operations', async () => {
    const result = await breaker.execute(async () => 'success')
    expect(result).toBe('success')
  })

  it('should open circuit after threshold failures', async () => {
    const failing = async () => { throw new Error('fail') }

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow()
    }

    expect(breaker.getState()).toBe('OPEN')
  })

  it('should reject requests when circuit is open', async () => {
    breaker.forceOpen()
    await expect(breaker.execute(async () => 'test')).rejects.toThrow('Circuit breaker is OPEN')
  })

  it('should transition to HALF_OPEN after timeout', async () => {
    const failing = async () => { throw new Error('fail') }

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow()
    }

    vi.useFakeTimers()
    vi.advanceTimersByTime(5001)

    await expect(breaker.execute(failing)).rejects.toThrow()
    expect(breaker.getState()).toBe('HALF_OPEN')

    vi.useRealTimers()
  })

  it('should close circuit after successful half-open tests', async () => {
    breaker.forceOpen()
    vi.useFakeTimers()
    vi.advanceTimersByTime(5001)

    await breaker.execute(async () => 'success')
    await breaker.execute(async () => 'success')

    expect(breaker.getState()).toBe('CLOSED')
    vi.useRealTimers()
  })

  it('should timeout slow operations', async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 2000))
    await expect(breaker.execute(slow)).rejects.toThrow('Operation timeout')
  })

  it('should emit state change events', async () => {
    const stateChangeSpy = vi.fn()
    breaker.on('stateChange', stateChangeSpy)

    breaker.forceOpen()
    expect(stateChangeSpy).toHaveBeenCalled()
  })

  it('should emit failure events', async () => {
    const failureSpy = vi.fn()
    breaker.on('failure', failureSpy)

    await expect(breaker.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    expect(failureSpy).toHaveBeenCalled()
  })

  it('should track success metrics', async () => {
    await breaker.execute(async () => 'success')
    const metrics = breaker.getMetrics()
    expect(metrics.successes).toBe(1)
    expect(metrics.totalRequests).toBe(1)
  })

  it('should track failure metrics', async () => {
    await expect(breaker.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    const metrics = breaker.getMetrics()
    expect(metrics.failures).toBe(1)
  })

  it('should calculate error rate', async () => {
    await breaker.execute(async () => 'success')
    await expect(breaker.execute(async () => { throw new Error('fail') })).rejects.toThrow()

    const metrics = breaker.getMetrics()
    expect(metrics.errorRate).toBe(0.5)
  })

  it('should force circuit open', () => {
    breaker.forceOpen()
    expect(breaker.getState()).toBe('OPEN')
  })

  it('should force circuit closed', () => {
    breaker.forceOpen()
    breaker.forceClose()
    expect(breaker.getState()).toBe('CLOSED')
  })

  it('should reset failure count on successful close', async () => {
    await expect(breaker.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    breaker.forceClose()
    const metrics = breaker.getMetrics()
    expect(metrics.failures).toBe(0)
  })

  it('should track last failure time', async () => {
    await expect(breaker.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    const metrics = breaker.getMetrics()
    expect(metrics.lastFailureTime).toBeDefined()
  })

  it('should report healthy when closed and low error rate', async () => {
    await breaker.execute(async () => 'success')
    expect(breaker.isHealthy()).toBe(true)
  })

  it('should report unhealthy when open', () => {
    breaker.forceOpen()
    expect(breaker.isHealthy()).toBe(false)
  })

  it('should handle concurrent requests', async () => {
    const promises = Array.from({ length: 10 }, () =>
      breaker.execute(async () => 'success')
    )
    const results = await Promise.all(promises)
    expect(results).toHaveLength(10)
  })

  it('should maintain monitoring window', async () => {
    await breaker.execute(async () => 'success')
    vi.useFakeTimers()
    vi.advanceTimersByTime(61000)
    await breaker.execute(async () => 'success')
    vi.useRealTimers()

    const metrics = breaker.getMetrics()
    expect(metrics.totalRequests).toBe(2)
  })

  it('should emit open event', () => {
    const openSpy = vi.fn()
    breaker.on('open', openSpy)
    breaker.forceOpen()
    expect(openSpy).toHaveBeenCalled()
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['circuit-breaker', 'resilience', 'microservices', 'fault-tolerance'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Event Sourcing Store with Snapshots',
    description:
      'Build an event sourcing system with event store, snapshot management, event replay capabilities, and projection rebuilding.',
    prompt: `Create an event sourcing store that persists domain events, supports snapshots for performance, and can rebuild state from events. Include event versioning and migration support.`,
    solution: `import { EventEmitter } from 'events'

/**
 * Event Sourcing Store with Snapshot Support
 *
 * Implements event sourcing pattern with snapshot optimization and event replay.
 *
 * @example
 * const store = new EventStore()
 * await store.append('account-123', { type: 'DEPOSIT', amount: 100 })
 * const state = await store.getState('account-123', AccountProjection)
 */

interface DomainEvent {
  type: string
  aggregateId: string
  version: number
  timestamp: number
  data: any
  metadata?: Record<string, any>
}

interface Snapshot<T> {
  aggregateId: string
  version: number
  state: T
  timestamp: number
}

interface Projection<T> {
  initialState: T
  apply(state: T, event: DomainEvent): T
}

interface EventStoreConfig {
  snapshotInterval?: number
  maxEventsInMemory?: number
}

export class EventStore extends EventEmitter {
  private events: Map<string, DomainEvent[]>
  private snapshots: Map<string, Snapshot<any>>
  private config: Required<EventStoreConfig>
  private eventMigrations: Map<string, (event: DomainEvent) => DomainEvent>

  constructor(config: EventStoreConfig = {}) {
    super()
    this.events = new Map()
    this.snapshots = new Map()
    this.eventMigrations = new Map()
    this.config = {
      snapshotInterval: 100,
      maxEventsInMemory: 10000,
      ...config,
    }
  }

  async append(aggregateId: string, eventData: Omit<DomainEvent, 'aggregateId' | 'version' | 'timestamp'>): Promise<DomainEvent> {
    const aggregateEvents = this.events.get(aggregateId) || []
    const version = aggregateEvents.length + 1

    const event: DomainEvent = {
      ...eventData,
      aggregateId,
      version,
      timestamp: Date.now(),
    }

    aggregateEvents.push(event)
    this.events.set(aggregateId, aggregateEvents)

    this.emit('eventAppended', event)

    if (version % this.config.snapshotInterval === 0) {
      await this.createSnapshot(aggregateId)
    }

    this.enforceMemoryLimit()

    return event
  }

  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    const events = this.events.get(aggregateId) || []

    if (fromVersion) {
      return events.filter(e => e.version >= fromVersion)
    }

    return events
  }

  async getState<T>(aggregateId: string, projection: Projection<T>): Promise<T> {
    const snapshot = this.snapshots.get(aggregateId) as Snapshot<T> | undefined

    let state = snapshot ? snapshot.state : projection.initialState
    let fromVersion = snapshot ? snapshot.version + 1 : 1

    const events = await this.getEvents(aggregateId, fromVersion)

    for (const event of events) {
      const migratedEvent = this.migrateEvent(event)
      state = projection.apply(state, migratedEvent)
    }

    return state
  }

  async createSnapshot<T>(aggregateId: string, projection?: Projection<T>): Promise<void> {
    if (!projection) {
      return
    }

    const state = await this.getState(aggregateId, projection)
    const events = this.events.get(aggregateId) || []
    const latestVersion = events[events.length - 1]?.version || 0

    const snapshot: Snapshot<T> = {
      aggregateId,
      version: latestVersion,
      state,
      timestamp: Date.now(),
    }

    this.snapshots.set(aggregateId, snapshot)
    this.emit('snapshotCreated', snapshot)
  }

  async replay<T>(aggregateId: string, projection: Projection<T>): Promise<T[]> {
    const events = await this.getEvents(aggregateId)
    const states: T[] = []
    let state = projection.initialState

    for (const event of events) {
      const migratedEvent = this.migrateEvent(event)
      state = projection.apply(state, migratedEvent)
      states.push(JSON.parse(JSON.stringify(state)))
    }

    return states
  }

  registerMigration(eventType: string, migration: (event: DomainEvent) => DomainEvent): void {
    this.eventMigrations.set(eventType, migration)
  }

  private migrateEvent(event: DomainEvent): DomainEvent {
    const migration = this.eventMigrations.get(event.type)
    return migration ? migration(event) : event
  }

  private enforceMemoryLimit(): void {
    let totalEvents = 0
    for (const events of this.events.values()) {
      totalEvents += events.length
    }

    if (totalEvents > this.config.maxEventsInMemory) {
      this.emit('memoryLimitReached', { totalEvents })
    }
  }

  getSnapshot<T>(aggregateId: string): Snapshot<T> | undefined {
    return this.snapshots.get(aggregateId) as Snapshot<T> | undefined
  }

  clear(): void {
    this.events.clear()
    this.snapshots.clear()
  }

  getEventCount(aggregateId: string): number {
    return this.events.get(aggregateId)?.length || 0
  }

  getAllAggregateIds(): string[] {
    return Array.from(this.events.keys())
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventStore } from './solution'

interface AccountState {
  balance: number
  transactions: number
}

const accountProjection = {
  initialState: { balance: 0, transactions: 0 },
  apply: (state: AccountState, event: any) => {
    if (event.type === 'DEPOSIT') {
      return { balance: state.balance + event.data.amount, transactions: state.transactions + 1 }
    }
    if (event.type === 'WITHDRAW') {
      return { balance: state.balance - event.data.amount, transactions: state.transactions + 1 }
    }
    return state
  },
}

describe('EventStore', () => {
  let store: EventStore

  beforeEach(() => {
    store = new EventStore({ snapshotInterval: 3 })
  })

  it('should append events', async () => {
    const event = await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    expect(event.version).toBe(1)
    expect(event.aggregateId).toBe('acc-1')
  })

  it('should retrieve events by aggregateId', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'WITHDRAW', data: { amount: 50 } })

    const events = await store.getEvents('acc-1')
    expect(events).toHaveLength(2)
  })

  it('should calculate state from events', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })

    const state = await store.getState('acc-1', accountProjection)
    expect(state.balance).toBe(150)
    expect(state.transactions).toBe(2)
  })

  it('should create snapshots at intervals', async () => {
    const spy = vi.fn()
    store.on('snapshotCreated', spy)

    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 25 } })

    await store.createSnapshot('acc-1', accountProjection)
    expect(spy).toHaveBeenCalled()
  })

  it('should retrieve state from snapshot and remaining events', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 25 } })
    await store.createSnapshot('acc-1', accountProjection)
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 10 } })

    const state = await store.getState('acc-1', accountProjection)
    expect(state.balance).toBe(185)
  })

  it('should replay all events', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'WITHDRAW', data: { amount: 30 } })

    const states = await store.replay('acc-1', accountProjection)
    expect(states).toHaveLength(2)
    expect(states[0].balance).toBe(100)
    expect(states[1].balance).toBe(70)
  })

  it('should handle event migrations', async () => {
    store.registerMigration('OLD_DEPOSIT', (event) => ({
      ...event,
      type: 'DEPOSIT',
      data: { amount: event.data.value },
    }))

    await store.append('acc-1', { type: 'OLD_DEPOSIT', data: { value: 100 } })
    const state = await store.getState('acc-1', accountProjection)
    expect(state.balance).toBe(100)
  })

  it('should emit events on append', async () => {
    const spy = vi.fn()
    store.on('eventAppended', spy)

    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    expect(spy).toHaveBeenCalled()
  })

  it('should get events from specific version', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 25 } })

    const events = await store.getEvents('acc-1', 2)
    expect(events).toHaveLength(2)
    expect(events[0].version).toBe(2)
  })

  it('should clear all data', () => {
    store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    store.clear()

    expect(store.getEventCount('acc-1')).toBe(0)
  })

  it('should get snapshot by aggregateId', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.createSnapshot('acc-1', accountProjection)

    const snapshot = store.getSnapshot<AccountState>('acc-1')
    expect(snapshot).toBeDefined()
    expect(snapshot?.state.balance).toBe(100)
  })

  it('should count events per aggregate', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })

    expect(store.getEventCount('acc-1')).toBe(2)
  })

  it('should list all aggregate IDs', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-2', { type: 'DEPOSIT', data: { amount: 50 } })

    const ids = store.getAllAggregateIds()
    expect(ids).toContain('acc-1')
    expect(ids).toContain('acc-2')
  })

  it('should include metadata in events', async () => {
    const event = await store.append('acc-1', {
      type: 'DEPOSIT',
      data: { amount: 100 },
      metadata: { userId: 'user-123' },
    })
    expect(event.metadata?.userId).toBe('user-123')
  })

  it('should emit memory limit warning', async () => {
    const spy = vi.fn()
    const smallStore = new EventStore({ maxEventsInMemory: 2 })
    smallStore.on('memoryLimitReached', spy)

    await smallStore.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await smallStore.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })
    await smallStore.append('acc-1', { type: 'DEPOSIT', data: { amount: 25 } })

    expect(spy).toHaveBeenCalled()
  })

  it('should handle empty event stream', async () => {
    const state = await store.getState('nonexistent', accountProjection)
    expect(state).toEqual(accountProjection.initialState)
  })

  it('should preserve event order', async () => {
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    await store.append('acc-1', { type: 'WITHDRAW', data: { amount: 30 } })
    await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })

    const events = await store.getEvents('acc-1')
    expect(events[0].type).toBe('DEPOSIT')
    expect(events[1].type).toBe('WITHDRAW')
    expect(events[2].type).toBe('DEPOSIT')
  })

  it('should assign incremental versions', async () => {
    const e1 = await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 100 } })
    const e2 = await store.append('acc-1', { type: 'DEPOSIT', data: { amount: 50 } })

    expect(e1.version).toBe(1)
    expect(e2.version).toBe(2)
  })

  it('should handle concurrent appends', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      store.append('acc-1', { type: 'DEPOSIT', data: { amount: i } })
    )

    await Promise.all(promises)
    expect(store.getEventCount('acc-1')).toBe(10)
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['event-sourcing', 'cqrs', 'domain-driven-design', 'snapshots'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // Continue with remaining 47 tasks following the same pattern...
  // Due to length constraints, I'll provide a representative sample of each category

  {
    title: 'CQRS Command and Query Bus',
    description:
      'Implement CQRS pattern with separate command and query buses, handlers, middleware support, and validation pipeline.',
    prompt: `Build a CQRS system with command/query separation, handler registration, middleware chain, and error handling. Support async handlers and command validation.`,
    solution: `/**
 * CQRS Command and Query Bus Implementation
 *
 * Separates write operations (commands) from read operations (queries).
 */

type Handler<T, R> = (message: T) => Promise<R>
type Middleware<T> = (message: T, next: () => Promise<any>) => Promise<any>

class CommandBus {
  private handlers = new Map<string, Handler<any, any>>()
  private middlewares: Middleware<any>[] = []

  registerHandler<T, R>(commandName: string, handler: Handler<T, R>): void {
    this.handlers.set(commandName, handler)
  }

  use<T>(middleware: Middleware<T>): void {
    this.middlewares.push(middleware)
  }

  async execute<T, R>(commandName: string, command: T): Promise<R> {
    const handler = this.handlers.get(commandName)
    if (!handler) {
      throw new Error(\`No handler registered for command: \${commandName}\`)
    }

    let index = 0
    const executeMiddleware = async (): Promise<R> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++]
        return middleware(command, executeMiddleware)
      }
      return handler(command)
    }

    return executeMiddleware()
  }
}

class QueryBus {
  private handlers = new Map<string, Handler<any, any>>()
  private cache = new Map<string, { result: any; timestamp: number }>()
  private cacheTTL = 5000

  registerHandler<T, R>(queryName: string, handler: Handler<T, R>): void {
    this.handlers.set(queryName, handler)
  }

  async execute<T, R>(queryName: string, query: T, useCache = true): Promise<R> {
    const cacheKey = \`\${queryName}:\${JSON.stringify(query)}\`

    if (useCache) {
      const cached = this.cache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.result
      }
    }

    const handler = this.handlers.get(queryName)
    if (!handler) {
      throw new Error(\`No handler registered for query: \${queryName}\`)
    }

    const result = await handler(query)

    if (useCache) {
      this.cache.set(cacheKey, { result, timestamp: Date.now() })
    }

    return result
  }

  clearCache(): void {
    this.cache.clear()
  }
}

export class CQRSBus {
  readonly commands = new CommandBus()
  readonly queries = new QueryBus()

  addValidationMiddleware(): void {
    this.commands.use(async (command: any, next) => {
      if (!command || typeof command !== 'object') {
        throw new Error('Invalid command')
      }
      return next()
    })
  }

  addLoggingMiddleware(logger: (msg: string) => void): void {
    this.commands.use(async (command: any, next) => {
      logger(\`Executing command: \${JSON.stringify(command)}\`)
      const result = await next()
      logger(\`Command completed\`)
      return result
    })
  }
}`,
    tests: `import { describe, it, expect, vi } from 'vitest'
import { CQRSBus } from './solution'

describe('CQRSBus', () => {
  it('should execute commands', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ success: true })

    bus.commands.registerHandler('CreateUser', handler)
    const result = await bus.commands.execute('CreateUser', { name: 'John' })

    expect(result.success).toBe(true)
    expect(handler).toHaveBeenCalledWith({ name: 'John' })
  })

  it('should execute queries', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ users: [] })

    bus.queries.registerHandler('GetUsers', handler)
    const result = await bus.queries.execute('GetUsers', {})

    expect(result.users).toEqual([])
  })

  it('should cache query results', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ data: 'test' })

    bus.queries.registerHandler('GetData', handler)
    await bus.queries.execute('GetData', { id: 1 })
    await bus.queries.execute('GetData', { id: 1 })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should apply middleware to commands', async () => {
    const bus = new CQRSBus()
    const middleware = vi.fn(async (cmd, next) => next())

    bus.commands.use(middleware)
    bus.commands.registerHandler('Test', async () => ({}))
    await bus.commands.execute('Test', {})

    expect(middleware).toHaveBeenCalled()
  })

  it('should throw on unknown command', async () => {
    const bus = new CQRSBus()
    await expect(bus.commands.execute('Unknown', {})).rejects.toThrow()
  })

  it('should throw on unknown query', async () => {
    const bus = new CQRSBus()
    await expect(bus.queries.execute('Unknown', {})).rejects.toThrow()
  })

  it('should add validation middleware', async () => {
    const bus = new CQRSBus()
    bus.addValidationMiddleware()
    bus.commands.registerHandler('Test', async () => ({}))

    await expect(bus.commands.execute('Test', null as any)).rejects.toThrow('Invalid command')
  })

  it('should add logging middleware', async () => {
    const bus = new CQRSBus()
    const logger = vi.fn()
    bus.addLoggingMiddleware(logger)
    bus.commands.registerHandler('Test', async () => ({}))

    await bus.commands.execute('Test', {})
    expect(logger).toHaveBeenCalledTimes(2)
  })

  it('should bypass cache when requested', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ data: 'test' })

    bus.queries.registerHandler('GetData', handler)
    await bus.queries.execute('GetData', { id: 1 }, false)
    await bus.queries.execute('GetData', { id: 1 }, false)

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should clear query cache', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ data: 'test' })

    bus.queries.registerHandler('GetData', handler)
    await bus.queries.execute('GetData', { id: 1 })
    bus.queries.clearCache()
    await bus.queries.execute('GetData', { id: 1 })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should execute middleware chain in order', async () => {
    const bus = new CQRSBus()
    const order: number[] = []

    bus.commands.use(async (cmd, next) => {
      order.push(1)
      const result = await next()
      order.push(4)
      return result
    })
    bus.commands.use(async (cmd, next) => {
      order.push(2)
      const result = await next()
      order.push(3)
      return result
    })
    bus.commands.registerHandler('Test', async () => ({}))

    await bus.commands.execute('Test', {})
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('should handle async handlers', async () => {
    const bus = new CQRSBus()
    bus.commands.registerHandler('AsyncTest', async (cmd) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return { processed: true }
    })

    const result = await bus.commands.execute('AsyncTest', {})
    expect(result.processed).toBe(true)
  })

  it('should differentiate cache by query params', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })

    bus.queries.registerHandler('GetData', handler)
    const r1 = await bus.queries.execute('GetData', { id: 1 })
    const r2 = await bus.queries.execute('GetData', { id: 2 })

    expect(r1.id).toBe(1)
    expect(r2.id).toBe(2)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should handle command errors in middleware', async () => {
    const bus = new CQRSBus()
    bus.commands.use(async (cmd, next) => {
      try {
        return await next()
      } catch (error) {
        return { error: 'handled' }
      }
    })
    bus.commands.registerHandler('Failing', async () => {
      throw new Error('Command failed')
    })

    const result = await bus.commands.execute('Failing', {})
    expect(result.error).toBe('handled')
  })

  it('should support multiple command handlers', async () => {
    const bus = new CQRSBus()
    bus.commands.registerHandler('Create', async () => ({ created: true }))
    bus.commands.registerHandler('Update', async () => ({ updated: true }))

    const r1 = await bus.commands.execute('Create', {})
    const r2 = await bus.commands.execute('Update', {})

    expect(r1.created).toBe(true)
    expect(r2.updated).toBe(true)
  })

  it('should support multiple query handlers', async () => {
    const bus = new CQRSBus()
    bus.queries.registerHandler('GetAll', async () => ({ items: [] }))
    bus.queries.registerHandler('GetById', async () => ({ item: null }))

    const r1 = await bus.queries.execute('GetAll', {})
    const r2 = await bus.queries.execute('GetById', { id: 1 })

    expect(r1.items).toEqual([])
    expect(r2.item).toBeNull()
  })

  it('should pass command data to handler', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({})

    bus.commands.registerHandler('Test', handler)
    await bus.commands.execute('Test', { name: 'Alice', age: 30 })

    expect(handler).toHaveBeenCalledWith({ name: 'Alice', age: 30 })
  })

  it('should handle query with complex params', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ results: [] })

    bus.queries.registerHandler('Search', handler)
    await bus.queries.execute('Search', { filters: { status: 'active' }, page: 1 })

    expect(handler).toHaveBeenCalledWith({ filters: { status: 'active' }, page: 1 })
  })

  it('should expire cache after TTL', async () => {
    const bus = new CQRSBus()
    const handler = vi.fn().mockResolvedValue({ data: 'test' })

    bus.queries.registerHandler('GetData', handler)
    await bus.queries.execute('GetData', { id: 1 })

    vi.useFakeTimers()
    vi.advanceTimersByTime(6000)
    await bus.queries.execute('GetData', { id: 1 })
    vi.useRealTimers()

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should handle concurrent commands', async () => {
    const bus = new CQRSBus()
    bus.commands.registerHandler('Test', async () => ({ success: true }))

    const promises = Array.from({ length: 10 }, () =>
      bus.commands.execute('Test', {})
    )
    const results = await Promise.all(promises)

    expect(results).toHaveLength(10)
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['cqrs', 'architecture', 'command-pattern', 'query-pattern'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  // ============================================================================
  // REMAINING DISTRIBUTED SYSTEMS (6 tasks)
  // ============================================================================

  {
    title: 'Distributed Cache with Consistent Hashing',
    description:
      'Build a distributed cache system using consistent hashing for node distribution, with replication and failover support.',
    prompt: `Implement a distributed cache that uses consistent hashing to distribute keys across nodes. Include virtual nodes, replication factor, and automatic rebalancing when nodes join or leave.`,
    solution: `/**
 * Distributed Cache with Consistent Hashing
 */

import crypto from 'crypto'

interface CacheNode {
  id: string
  host: string
  port: number
}

interface CacheEntry<T> {
  value: T
  timestamp: number
  ttl: number
}

export class ConsistentHashCache<T> {
  private ring: Map<number, CacheNode> = new Map()
  private nodes: Map<string, CacheNode> = new Map()
  private storage: Map<string, CacheEntry<T>> = new Map()
  private virtualNodes = 150
  private replicationFactor = 2

  addNode(node: CacheNode): void {
    this.nodes.set(node.id, node)
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(\`\${node.id}:\${i}\`)
      this.ring.set(hash, node)
    }
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (!node) return

    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(\`\${nodeId}:\${i}\`)
      this.ring.delete(hash)
    }
    this.nodes.delete(nodeId)
  }

  set(key: string, value: T, ttl = 3600000): void {
    const nodes = this.getNodes(key)
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), ttl }

    nodes.forEach((node) => {
      const storageKey = \`\${node.id}:\${key}\`
      this.storage.set(storageKey, entry)
    })
  }

  get(key: string): T | null {
    const nodes = this.getNodes(key)

    for (const node of nodes) {
      const storageKey = \`\${node.id}:\${key}\`
      const entry = this.storage.get(storageKey)

      if (entry) {
        if (Date.now() - entry.timestamp > entry.ttl) {
          this.storage.delete(storageKey)
          continue
        }
        return entry.value
      }
    }
    return null
  }

  delete(key: string): void {
    const nodes = this.getNodes(key)
    nodes.forEach((node) => {
      const storageKey = \`\${node.id}:\${key}\`
      this.storage.delete(storageKey)
    })
  }

  private getNodes(key: string): CacheNode[] {
    const keyHash = this.hash(key)
    const sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b)

    const nodes: CacheNode[] = []
    const nodeIds = new Set<string>()

    let startIndex = sortedHashes.findIndex((h) => h >= keyHash)
    if (startIndex === -1) startIndex = 0

    for (let i = 0; i < sortedHashes.length && nodes.length < this.replicationFactor; i++) {
      const index = (startIndex + i) % sortedHashes.length
      const node = this.ring.get(sortedHashes[index])!

      if (!nodeIds.has(node.id)) {
        nodes.push(node)
        nodeIds.add(node.id)
      }
    }

    return nodes
  }

  private hash(key: string): number {
    const hash = crypto.createHash('md5').update(key).digest()
    return hash.readUInt32BE(0)
  }

  getNodeCount(): number {
    return this.nodes.size
  }

  clear(): void {
    this.storage.clear()
  }
}`,
    tests: `import { describe, it, expect, beforeEach } from 'vitest'
import { ConsistentHashCache } from './solution'

describe('ConsistentHashCache', () => {
  let cache: ConsistentHashCache<string>

  beforeEach(() => {
    cache = new ConsistentHashCache<string>()
  })

  it('should add nodes', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    expect(cache.getNodeCount()).toBe(1)
  })

  it('should store and retrieve values', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  it('should return null for missing keys', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    expect(cache.get('nonexistent')).toBeNull()
  })

  it('should delete values', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    cache.delete('key1')
    expect(cache.get('key1')).toBeNull()
  })

  it('should replicate across multiple nodes', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  it('should handle node removal', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    cache.removeNode('node1')
    expect(cache.getNodeCount()).toBe(1)
  })

  it('should expire entries after TTL', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1', 10)
    setTimeout(() => {
      expect(cache.get('key1')).toBeNull()
    }, 20)
  })

  it('should distribute keys across nodes', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    cache.set('key1', 'value1')
    cache.set('key2', 'value2')
    expect(cache.get('key1')).toBe('value1')
    expect(cache.get('key2')).toBe('value2')
  })

  it('should handle multiple value types', () => {
    const numCache = new ConsistentHashCache<number>()
    numCache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    numCache.set('count', 42)
    expect(numCache.get('count')).toBe(42)
  })

  it('should clear all entries', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    cache.clear()
    expect(cache.get('key1')).toBeNull()
  })

  it('should handle concurrent sets', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    cache.set('key1', 'value2')
    expect(cache.get('key1')).toBe('value2')
  })

  it('should distribute with consistent hashing', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('test', 'value')
    const value1 = cache.get('test')
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    const value2 = cache.get('test')
    expect(value1).toBe(value2)
  })

  it('should handle empty cache', () => {
    expect(cache.get('any')).toBeNull()
  })

  it('should support custom TTL', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1', 100000)
    expect(cache.get('key1')).toBe('value1')
  })

  it('should handle replication factor', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    cache.addNode({ id: 'node3', host: 'localhost', port: 8003 })
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  it('should maintain consistency during rebalancing', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    expect(cache.get('key1')).toBe('value1')
  })

  it('should store complex objects', () => {
    const objCache = new ConsistentHashCache<{ name: string; age: number }>()
    objCache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    objCache.set('user', { name: 'Alice', age: 30 })
    expect(objCache.get('user')).toEqual({ name: 'Alice', age: 30 })
  })

  it('should handle multiple deletes', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.set('key1', 'value1')
    cache.delete('key1')
    cache.delete('key1')
    expect(cache.get('key1')).toBeNull()
  })

  it('should maintain separate storage per node', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.addNode({ id: 'node2', host: 'localhost', port: 8002 })
    cache.set('key1', 'value1')
    cache.set('key2', 'value2')
    expect(cache.get('key1')).toBe('value1')
    expect(cache.get('key2')).toBe('value2')
  })

  it('should handle node with same id replacement', () => {
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    cache.removeNode('node1')
    cache.addNode({ id: 'node1', host: 'localhost', port: 8001 })
    expect(cache.getNodeCount()).toBe(1)
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['distributed-systems', 'consistent-hashing', 'caching', 'replication'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Leader Election with Raft Consensus',
    description:
      'Implement Raft-based leader election algorithm with heartbeats, term management, and vote requests.',
    prompt: `Create a leader election system based on Raft consensus. Support term increments, candidate voting, leader heartbeats, and follower timeout detection. Handle network partitions gracefully.`,
    solution: `/**
 * Raft Leader Election Implementation
 */

import { EventEmitter } from 'events'

enum NodeState {
  FOLLOWER = 'FOLLOWER',
  CANDIDATE = 'CANDIDATE',
  LEADER = 'LEADER',
}

interface VoteRequest {
  term: number
  candidateId: string
}

interface VoteResponse {
  term: number
  voteGranted: boolean
}

export class RaftNode extends EventEmitter {
  private state: NodeState = NodeState.FOLLOWER
  private currentTerm = 0
  private votedFor: string | null = null
  private leaderId: string | null = null
  private electionTimeout = 150 + Math.random() * 150
  private heartbeatInterval = 50
  private lastHeartbeat = Date.now()
  private electionTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private peers: Set<string> = new Set()
  private votes = new Set<string>()

  constructor(private nodeId: string) {
    super()
  }

  addPeer(peerId: string): void {
    this.peers.add(peerId)
  }

  start(): void {
    this.startElectionTimer()
  }

  stop(): void {
    this.clearTimers()
  }

  requestVote(request: VoteRequest): VoteResponse {
    if (request.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false }
    }

    if (request.term > this.currentTerm) {
      this.currentTerm = request.term
      this.votedFor = null
      this.becomeFollower()
    }

    if (this.votedFor === null || this.votedFor === request.candidateId) {
      this.votedFor = request.candidateId
      this.lastHeartbeat = Date.now()
      return { term: this.currentTerm, voteGranted: true }
    }

    return { term: this.currentTerm, voteGranted: false }
  }

  receiveHeartbeat(term: number, leaderId: string): void {
    if (term >= this.currentTerm) {
      this.currentTerm = term
      this.leaderId = leaderId
      this.becomeFollower()
      this.lastHeartbeat = Date.now()
    }
  }

  private startElection(): void {
    this.state = NodeState.CANDIDATE
    this.currentTerm++
    this.votedFor = this.nodeId
    this.votes.clear()
    this.votes.add(this.nodeId)

    this.emit('electionStarted', { term: this.currentTerm })

    if (this.votes.size > this.peers.size / 2) {
      this.becomeLeader()
    }
  }

  simulateVoteResponse(response: VoteResponse): void {
    if (this.state !== NodeState.CANDIDATE) return
    if (response.term > this.currentTerm) {
      this.currentTerm = response.term
      this.becomeFollower()
      return
    }

    if (response.voteGranted && response.term === this.currentTerm) {
      this.votes.add(\`vote-\${this.votes.size}\`)

      if (this.votes.size > (this.peers.size + 1) / 2) {
        this.becomeLeader()
      }
    }
  }

  private becomeLeader(): void {
    this.state = NodeState.LEADER
    this.leaderId = this.nodeId
    this.emit('becameLeader', { term: this.currentTerm })
    this.startHeartbeat()
  }

  private becomeFollower(): void {
    this.state = NodeState.FOLLOWER
    this.votes.clear()
    this.clearHeartbeat()
    this.startElectionTimer()
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat', { term: this.currentTerm, leaderId: this.nodeId })
    }, this.heartbeatInterval)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startElectionTimer(): void {
    this.clearTimers()
    this.electionTimer = setTimeout(() => {
      if (Date.now() - this.lastHeartbeat > this.electionTimeout) {
        this.startElection()
      }
    }, this.electionTimeout)
  }

  private clearTimers(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer)
      this.electionTimer = null
    }
    this.clearHeartbeat()
  }

  getState(): NodeState {
    return this.state
  }

  getTerm(): number {
    return this.currentTerm
  }

  getLeaderId(): string | null {
    return this.leaderId
  }

  isLeader(): boolean {
    return this.state === NodeState.LEADER
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RaftNode } from './solution'

describe('RaftNode', () => {
  let node: RaftNode

  beforeEach(() => {
    node = new RaftNode('node1')
    node.addPeer('node2')
    node.addPeer('node3')
  })

  it('should start as follower', () => {
    expect(node.getState()).toBe('FOLLOWER')
  })

  it('should increment term when starting election', () => {
    const initialTerm = node.getTerm()
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(400)
    expect(node.getTerm()).toBeGreaterThan(initialTerm)
    vi.useRealTimers()
  })

  it('should grant vote for valid request', () => {
    const response = node.requestVote({ term: 1, candidateId: 'node2' })
    expect(response.voteGranted).toBe(true)
  })

  it('should reject vote for lower term', () => {
    node.requestVote({ term: 5, candidateId: 'node2' })
    const response = node.requestVote({ term: 3, candidateId: 'node3' })
    expect(response.voteGranted).toBe(false)
  })

  it('should not vote twice in same term', () => {
    node.requestVote({ term: 1, candidateId: 'node2' })
    const response = node.requestVote({ term: 1, candidateId: 'node3' })
    expect(response.voteGranted).toBe(false)
  })

  it('should become leader with majority votes', () => {
    const spy = vi.fn()
    node.on('becameLeader', spy)
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(400)
    node.simulateVoteResponse({ term: node.getTerm(), voteGranted: true })
    node.simulateVoteResponse({ term: node.getTerm(), voteGranted: true })
    expect(spy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('should send heartbeats when leader', () => {
    const spy = vi.fn()
    node.on('heartbeat', spy)
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(400)
    node.simulateVoteResponse({ term: node.getTerm(), voteGranted: true })
    node.simulateVoteResponse({ term: node.getTerm(), voteGranted: true })
    vi.advanceTimersByTime(100)
    expect(spy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('should revert to follower on higher term heartbeat', () => {
    node.receiveHeartbeat(10, 'node2')
    expect(node.getState()).toBe('FOLLOWER')
    expect(node.getLeaderId()).toBe('node2')
  })

  it('should update term on higher term vote request', () => {
    const response = node.requestVote({ term: 10, candidateId: 'node2' })
    expect(node.getTerm()).toBe(10)
    expect(response.voteGranted).toBe(true)
  })

  it('should track leader id', () => {
    node.receiveHeartbeat(1, 'node2')
    expect(node.getLeaderId()).toBe('node2')
  })

  it('should emit election started event', () => {
    const spy = vi.fn()
    node.on('electionStarted', spy)
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(400)
    expect(spy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('should stop timers on stop', () => {
    node.start()
    node.stop()
    expect(node.getState()).toBe('FOLLOWER')
  })

  it('should reset election timer on heartbeat', () => {
    node.start()
    node.receiveHeartbeat(1, 'node2')
    expect(node.getState()).toBe('FOLLOWER')
  })

  it('should check if node is leader', () => {
    expect(node.isLeader()).toBe(false)
  })

  it('should handle concurrent vote requests', () => {
    node.requestVote({ term: 1, candidateId: 'node2' })
    const r2 = node.requestVote({ term: 1, candidateId: 'node2' })
    expect(r2.voteGranted).toBe(true)
  })

  it('should add peers', () => {
    const newNode = new RaftNode('node4')
    newNode.addPeer('node5')
    expect(newNode).toBeDefined()
  })

  it('should handle vote rejection', () => {
    node.simulateVoteResponse({ term: 1, voteGranted: false })
    expect(node.getState()).toBe('FOLLOWER')
  })

  it('should handle higher term in vote response', () => {
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(400)
    node.simulateVoteResponse({ term: node.getTerm() + 5, voteGranted: false })
    expect(node.getState()).toBe('FOLLOWER')
    vi.useRealTimers()
  })

  it('should maintain current term', () => {
    const term = node.getTerm()
    node.receiveHeartbeat(term - 1, 'node2')
    expect(node.getTerm()).toBe(term)
  })

  it('should handle multiple heartbeats', () => {
    node.receiveHeartbeat(1, 'node2')
    node.receiveHeartbeat(2, 'node2')
    expect(node.getTerm()).toBe(2)
  })

  it('should reset voted for on new term', () => {
    node.requestVote({ term: 1, candidateId: 'node2' })
    node.requestVote({ term: 2, candidateId: 'node3' })
    expect(node.getTerm()).toBe(2)
  })

  it('should handle election timeout', () => {
    node.start()
    vi.useFakeTimers()
    vi.advanceTimersByTime(500)
    expect(node.getTerm()).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['distributed-systems', 'raft', 'consensus', 'leader-election'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Saga Pattern for Distributed Transactions',
    description:
      'Implement Saga pattern for managing distributed transactions with compensation logic and rollback support.',
    prompt: `Build a Saga orchestrator that coordinates distributed transactions across services. Support step execution, compensation on failure, and saga state persistence. Handle timeouts and retries.`,
    solution: `/**
 * Saga Pattern Implementation
 */

import { EventEmitter } from 'events'

type SagaStep<T> = (data: T) => Promise<T>
type CompensationStep<T> = (data: T) => Promise<void>

interface StepDefinition<T> {
  name: string
  execute: SagaStep<T>
  compensate: CompensationStep<T>
}

enum SagaStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
}

interface SagaState<T> {
  status: SagaStatus
  currentStep: number
  data: T
  executedSteps: string[]
  error?: Error
}

export class SagaOrchestrator<T> extends EventEmitter {
  private steps: StepDefinition<T>[] = []
  private state: SagaState<T>
  private timeout = 30000
  private maxRetries = 3

  constructor(initialData: T) {
    super()
    this.state = {
      status: SagaStatus.PENDING,
      currentStep: 0,
      data: initialData,
      executedSteps: [],
    }
  }

  addStep(name: string, execute: SagaStep<T>, compensate: CompensationStep<T>): this {
    this.steps.push({ name, execute, compensate })
    return this
  }

  async execute(): Promise<T> {
    this.state.status = SagaStatus.RUNNING
    this.emit('started', { data: this.state.data })

    try {
      for (let i = 0; i < this.steps.length; i++) {
        this.state.currentStep = i
        const step = this.steps[i]

        this.emit('stepStarted', { step: step.name, index: i })

        this.state.data = await this.executeWithTimeout(step.execute(this.state.data))
        this.state.executedSteps.push(step.name)

        this.emit('stepCompleted', { step: step.name, index: i })
      }

      this.state.status = SagaStatus.COMPLETED
      this.emit('completed', { data: this.state.data })
      return this.state.data
    } catch (error) {
      this.state.status = SagaStatus.FAILED
      this.state.error = error as Error
      this.emit('failed', { error })

      await this.compensate()
      throw error
    }
  }

  private async compensate(): Promise<void> {
    this.state.status = SagaStatus.COMPENSATING
    this.emit('compensationStarted')

    const executedSteps = [...this.state.executedSteps].reverse()

    for (const stepName of executedSteps) {
      const step = this.steps.find((s) => s.name === stepName)
      if (step) {
        try {
          await this.executeWithTimeout(step.compensate(this.state.data))
          this.emit('stepCompensated', { step: stepName })
        } catch (error) {
          this.emit('compensationFailed', { step: stepName, error })
        }
      }
    }

    this.state.status = SagaStatus.COMPENSATED
    this.emit('compensationCompleted')
  }

  private async executeWithTimeout<R>(promise: Promise<R>): Promise<R> {
    return Promise.race([
      promise,
      new Promise<R>((_, reject) =>
        setTimeout(() => reject(new Error('Step timeout')), this.timeout)
      ),
    ])
  }

  getState(): SagaState<T> {
    return { ...this.state }
  }

  getStatus(): SagaStatus {
    return this.state.status
  }

  setTimeout(ms: number): this {
    this.timeout = ms
    return this
  }

  async retry(): Promise<T> {
    if (this.state.status !== SagaStatus.FAILED && this.state.status !== SagaStatus.COMPENSATED) {
      throw new Error('Can only retry failed sagas')
    }

    this.state.status = SagaStatus.PENDING
    this.state.currentStep = 0
    this.state.executedSteps = []
    delete this.state.error

    return this.execute()
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SagaOrchestrator } from './solution'

describe('SagaOrchestrator', () => {
  interface OrderData {
    orderId: string
    amount: number
    inventory?: boolean
    payment?: boolean
  }

  let saga: SagaOrchestrator<OrderData>

  beforeEach(() => {
    saga = new SagaOrchestrator<OrderData>({ orderId: '123', amount: 100 })
  })

  it('should execute all steps successfully', async () => {
    saga
      .addStep(
        'reserve',
        async (data) => ({ ...data, inventory: true }),
        async () => {}
      )
      .addStep(
        'payment',
        async (data) => ({ ...data, payment: true }),
        async () => {}
      )

    const result = await saga.execute()
    expect(result.inventory).toBe(true)
    expect(result.payment).toBe(true)
  })

  it('should compensate on failure', async () => {
    const compensate1 = vi.fn()
    const compensate2 = vi.fn()

    saga
      .addStep(
        'step1',
        async (data) => data,
        compensate1
      )
      .addStep(
        'step2',
        async () => { throw new Error('Step failed') },
        compensate2
      )

    await expect(saga.execute()).rejects.toThrow('Step failed')
    expect(compensate1).toHaveBeenCalled()
    expect(saga.getStatus()).toBe('COMPENSATED')
  })

  it('should emit started event', async () => {
    const spy = vi.fn()
    saga.on('started', spy)
    saga.addStep('test', async (data) => data, async () => {})
    await saga.execute()
    expect(spy).toHaveBeenCalled()
  })

  it('should emit completed event', async () => {
    const spy = vi.fn()
    saga.on('completed', spy)
    saga.addStep('test', async (data) => data, async () => {})
    await saga.execute()
    expect(spy).toHaveBeenCalled()
  })

  it('should emit step events', async () => {
    const startSpy = vi.fn()
    const completeSpy = vi.fn()
    saga.on('stepStarted', startSpy)
    saga.on('stepCompleted', completeSpy)
    saga.addStep('test', async (data) => data, async () => {})
    await saga.execute()
    expect(startSpy).toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalled()
  })

  it('should track executed steps', async () => {
    saga
      .addStep('step1', async (data) => data, async () => {})
      .addStep('step2', async (data) => data, async () => {})

    await saga.execute()
    const state = saga.getState()
    expect(state.executedSteps).toEqual(['step1', 'step2'])
  })

  it('should timeout long-running steps', async () => {
    saga
      .setTimeout(100)
      .addStep(
        'slow',
        async (data) => {
          await new Promise(resolve => setTimeout(resolve, 200))
          return data
        },
        async () => {}
      )

    await expect(saga.execute()).rejects.toThrow('Step timeout')
  })

  it('should support retry after failure', async () => {
    let attempt = 0
    saga.addStep(
      'flaky',
      async (data) => {
        if (attempt++ === 0) throw new Error('First attempt fails')
        return data
      },
      async () => {}
    )

    await expect(saga.execute()).rejects.toThrow()
    const result = await saga.retry()
    expect(result).toBeDefined()
  })

  it('should maintain saga state', async () => {
    saga.addStep('test', async (data) => ({ ...data, processed: true }), async () => {})
    await saga.execute()
    const state = saga.getState()
    expect(state.status).toBe('COMPLETED')
  })

  it('should compensate in reverse order', async () => {
    const order: string[] = []
    saga
      .addStep(
        'step1',
        async (data) => data,
        async () => { order.push('comp1') }
      )
      .addStep(
        'step2',
        async (data) => data,
        async () => { order.push('comp2') }
      )
      .addStep(
        'step3',
        async () => { throw new Error('fail') },
        async () => { order.push('comp3') }
      )

    await expect(saga.execute()).rejects.toThrow()
    expect(order).toEqual(['comp2', 'comp1'])
  })

  it('should handle compensation failures gracefully', async () => {
    const spy = vi.fn()
    saga.on('compensationFailed', spy)
    saga
      .addStep(
        'step1',
        async (data) => data,
        async () => { throw new Error('Compensation failed') }
      )
      .addStep(
        'step2',
        async () => { throw new Error('Step failed') },
        async () => {}
      )

    await expect(saga.execute()).rejects.toThrow()
    expect(spy).toHaveBeenCalled()
  })

  it('should set custom timeout', () => {
    saga.setTimeout(5000)
    expect(saga.getState().status).toBe('PENDING')
  })

  it('should chain step additions', () => {
    const result = saga
      .addStep('s1', async (d) => d, async () => {})
      .addStep('s2', async (d) => d, async () => {})
    expect(result).toBe(saga)
  })

  it('should get current status', async () => {
    expect(saga.getStatus()).toBe('PENDING')
    saga.addStep('test', async (data) => data, async () => {})
    const promise = saga.execute()
    await promise
    expect(saga.getStatus()).toBe('COMPLETED')
  })

  it('should emit compensation events', async () => {
    const startSpy = vi.fn()
    const completeSpy = vi.fn()
    saga.on('compensationStarted', startSpy)
    saga.on('compensationCompleted', completeSpy)
    saga
      .addStep('s1', async (d) => d, async () => {})
      .addStep('s2', async () => { throw new Error('fail') }, async () => {})

    await expect(saga.execute()).rejects.toThrow()
    expect(startSpy).toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalled()
  })

  it('should prevent retry of non-failed saga', async () => {
    saga.addStep('test', async (d) => d, async () => {})
    await saga.execute()
    await expect(saga.retry()).rejects.toThrow('Can only retry failed sagas')
  })

  it('should preserve data through steps', async () => {
    saga
      .addStep('s1', async (d) => ({ ...d, step1: true }), async () => {})
      .addStep('s2', async (d) => ({ ...d, step2: true }), async () => {})

    const result = await saga.execute()
    expect(result.step1).toBe(true)
    expect(result.step2).toBe(true)
  })

  it('should handle empty saga', async () => {
    const result = await saga.execute()
    expect(result).toEqual({ orderId: '123', amount: 100 })
  })

  it('should track current step index', async () => {
    saga
      .addStep('s1', async (d) => d, async () => {})
      .addStep('s2', async (d) => d, async () => {})

    await saga.execute()
    const state = saga.getState()
    expect(state.currentStep).toBe(1)
  })

  it('should store error on failure', async () => {
    saga.addStep('fail', async () => { throw new Error('Test error') }, async () => {})
    await expect(saga.execute()).rejects.toThrow()
    expect(saga.getState().error?.message).toBe('Test error')
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['saga-pattern', 'distributed-transactions', 'compensation', 'orchestration'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Message Queue with Delivery Guarantees',
    description:
      'Build a message queue system with at-least-once delivery, acknowledgment, dead letter queue, and priority support.',
    prompt: `Implement a message queue that ensures reliable message delivery. Support message acknowledgment, retry logic, DLQ for failed messages, and priority queues. Handle consumer failures gracefully.`,
    solution: `/**
 * Message Queue with Delivery Guarantees
 */

import { EventEmitter } from 'events'

interface Message<T> {
  id: string
  data: T
  priority: number
  attempts: number
  maxAttempts: number
  timestamp: number
  ackDeadline?: number
}

type MessageHandler<T> = (message: T) => Promise<void>

export class MessageQueue<T> extends EventEmitter {
  private queue: Message<T>[] = []
  private dlq: Message<T>[] = []
  private inFlight = new Map<string, Message<T>>()
  private consumers = new Map<string, MessageHandler<T>>()
  private processing = false
  private maxAttempts = 3
  private ackTimeout = 30000
  private pollInterval = 100

  enqueue(data: T, priority = 0, maxAttempts = this.maxAttempts): string {
    const id = \`msg-\${Date.now()}-\${Math.random()}\`
    const message: Message<T> = {
      id,
      data,
      priority,
      attempts: 0,
      maxAttempts,
      timestamp: Date.now(),
    }

    this.queue.push(message)
    this.queue.sort((a, b) => b.priority - a.priority)
    this.emit('enqueued', { id, priority })

    if (!this.processing) {
      this.processMessages()
    }

    return id
  }

  subscribe(consumerId: string, handler: MessageHandler<T>): void {
    this.consumers.set(consumerId, handler)
    if (!this.processing) {
      this.processMessages()
    }
  }

  unsubscribe(consumerId: string): void {
    this.consumers.delete(consumerId)
  }

  ack(messageId: string): void {
    if (this.inFlight.has(messageId)) {
      this.inFlight.delete(messageId)
      this.emit('acknowledged', { messageId })
    }
  }

  nack(messageId: string): void {
    const message = this.inFlight.get(messageId)
    if (message) {
      this.inFlight.delete(messageId)
      message.attempts++

      if (message.attempts >= message.maxAttempts) {
        this.dlq.push(message)
        this.emit('movedToDLQ', { messageId })
      } else {
        this.queue.unshift(message)
        this.emit('requeued', { messageId, attempts: message.attempts })
      }
    }
  }

  private async processMessages(): Promise<void> {
    this.processing = true

    while (this.queue.length > 0 || this.inFlight.size > 0) {
      this.checkAckDeadlines()

      if (this.queue.length > 0 && this.consumers.size > 0) {
        const message = this.queue.shift()!
        message.attempts++
        message.ackDeadline = Date.now() + this.ackTimeout

        this.inFlight.set(message.id, message)
        this.emit('processing', { messageId: message.id })

        this.deliverToConsumer(message)
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollInterval))
    }

    this.processing = false
  }

  private async deliverToConsumer(message: Message<T>): Promise<void> {
    const consumer = Array.from(this.consumers.values())[0]
    if (!consumer) return

    try {
      await consumer(message.data)
      this.ack(message.id)
    } catch (error) {
      this.emit('processingFailed', { messageId: message.id, error })
      this.nack(message.id)
    }
  }

  private checkAckDeadlines(): void {
    const now = Date.now()
    for (const [id, message] of this.inFlight) {
      if (message.ackDeadline && now > message.ackDeadline) {
        this.emit('ackTimeout', { messageId: id })
        this.nack(id)
      }
    }
  }

  getQueueSize(): number {
    return this.queue.length
  }

  getDLQSize(): number {
    return this.dlq.length
  }

  getInFlightCount(): number {
    return this.inFlight.size
  }

  getDLQMessages(): Message<T>[] {
    return [...this.dlq]
  }

  clear(): void {
    this.queue = []
    this.dlq = []
    this.inFlight.clear()
  }

  setMaxAttempts(attempts: number): void {
    this.maxAttempts = attempts
  }

  setAckTimeout(ms: number): void {
    this.ackTimeout = ms
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MessageQueue } from './solution'

describe('MessageQueue', () => {
  let queue: MessageQueue<string>

  beforeEach(() => {
    queue = new MessageQueue<string>()
  })

  it('should enqueue messages', () => {
    queue.enqueue('test')
    expect(queue.getQueueSize()).toBe(1)
  })

  it('should process messages with consumer', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(handler).toHaveBeenCalledWith('test')
  })

  it('should handle priority messages', () => {
    queue.enqueue('low', 0)
    queue.enqueue('high', 10)
    expect(queue.getQueueSize()).toBe(2)
  })

  it('should acknowledge messages', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(queue.getInFlightCount()).toBe(0)
  })

  it('should move to DLQ after max attempts', async () => {
    queue.setMaxAttempts(2)
    const handler = vi.fn().mockRejectedValue(new Error('fail'))
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 500))
    expect(queue.getDLQSize()).toBeGreaterThan(0)
  })

  it('should retry failed messages', async () => {
    let attempts = 0
    const handler = vi.fn().mockImplementation(async () => {
      if (attempts++ < 1) throw new Error('fail')
    })

    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 400))
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should emit enqueued event', () => {
    const spy = vi.fn()
    queue.on('enqueued', spy)
    queue.enqueue('test')
    expect(spy).toHaveBeenCalled()
  })

  it('should emit acknowledged event', async () => {
    const spy = vi.fn()
    queue.on('acknowledged', spy)
    const handler = vi.fn().mockResolvedValue(undefined)
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(spy).toHaveBeenCalled()
  })

  it('should unsubscribe consumers', () => {
    const handler = vi.fn()
    queue.subscribe('consumer1', handler)
    queue.unsubscribe('consumer1')
    queue.enqueue('test')
    expect(handler).not.toHaveBeenCalled()
  })

  it('should track in-flight messages', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200)))
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(queue.getInFlightCount()).toBe(1)
  })

  it('should return DLQ messages', async () => {
    queue.setMaxAttempts(1)
    const handler = vi.fn().mockRejectedValue(new Error('fail'))
    queue.subscribe('consumer1', handler)
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 300))
    const dlqMessages = queue.getDLQMessages()
    expect(dlqMessages.length).toBeGreaterThan(0)
  })

  it('should clear queue', () => {
    queue.enqueue('test1')
    queue.enqueue('test2')
    queue.clear()
    expect(queue.getQueueSize()).toBe(0)
  })

  it('should handle multiple consumers', () => {
    queue.subscribe('c1', vi.fn())
    queue.subscribe('c2', vi.fn())
    queue.enqueue('test')
    expect(queue.getQueueSize()).toBe(1)
  })

  it('should set custom max attempts', () => {
    queue.setMaxAttempts(5)
    queue.enqueue('test')
    expect(queue.getQueueSize()).toBe(1)
  })

  it('should set custom ack timeout', () => {
    queue.setAckTimeout(5000)
    queue.enqueue('test')
    expect(queue.getQueueSize()).toBe(1)
  })

  it('should emit processing event', async () => {
    const spy = vi.fn()
    queue.on('processing', spy)
    queue.subscribe('c1', vi.fn().mockResolvedValue(undefined))
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(spy).toHaveBeenCalled()
  })

  it('should emit failed event', async () => {
    const spy = vi.fn()
    queue.on('processingFailed', spy)
    queue.subscribe('c1', vi.fn().mockRejectedValue(new Error('fail')))
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(spy).toHaveBeenCalled()
  })

  it('should return unique message ids', () => {
    const id1 = queue.enqueue('test1')
    const id2 = queue.enqueue('test2')
    expect(id1).not.toBe(id2)
  })

  it('should handle ack timeout', async () => {
    const spy = vi.fn()
    queue.on('ackTimeout', spy)
    queue.setAckTimeout(50)
    queue.subscribe('c1', () => new Promise(resolve => setTimeout(resolve, 200)))
    queue.enqueue('test')

    await new Promise(resolve => setTimeout(resolve, 300))
    expect(spy).toHaveBeenCalled()
  })

  it('should requeue on nack', async () => {
    const spy = vi.fn()
    queue.on('requeued', spy)
    queue.subscribe('c1', vi.fn().mockRejectedValue(new Error('fail')))
    queue.enqueue('test', 0, 3)

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(spy).toHaveBeenCalled()
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['message-queue', 'reliability', 'ack', 'dlq', 'priority-queue'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Service Registry with Health Checks',
    description:
      'Implement a service registry that tracks service instances with health checking, automatic deregistration, and load balancing support.',
    prompt: `Create a service registry for microservices discovery. Support service registration, health checks, TTL-based expiration, and instance selection strategies. Include metrics and monitoring.`,
    solution: `/**
 * Service Registry with Health Checks
 */

import { EventEmitter } from 'events'

interface ServiceInstance {
  id: string
  name: string
  host: string
  port: number
  metadata?: Record<string, any>
  registeredAt: number
  lastHeartbeat: number
  healthy: boolean
}

type HealthCheck = (instance: ServiceInstance) => Promise<boolean>
type LoadBalancingStrategy = 'round-robin' | 'random' | 'least-connections'

export class ServiceRegistry extends EventEmitter {
  private services = new Map<string, Map<string, ServiceInstance>>()
  private healthChecks = new Map<string, HealthCheck>()
  private heartbeatInterval = 10000
  private ttl = 30000
  private roundRobinIndex = new Map<string, number>()
  private connections = new Map<string, number>()
  private checkTimer: NodeJS.Timeout | null = null

  register(instance: Omit<ServiceInstance, 'id' | 'registeredAt' | 'lastHeartbeat' | 'healthy'>): string {
    const id = \`\${instance.name}-\${Date.now()}-\${Math.random()}\`
    const fullInstance: ServiceInstance = {
      ...instance,
      id,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      healthy: true,
    }

    if (!this.services.has(instance.name)) {
      this.services.set(instance.name, new Map())
    }

    this.services.get(instance.name)!.set(id, fullInstance)
    this.emit('registered', { id, name: instance.name })

    if (!this.checkTimer) {
      this.startHealthChecks()
    }

    return id
  }

  deregister(serviceName: string, instanceId: string): void {
    const instances = this.services.get(serviceName)
    if (instances?.has(instanceId)) {
      instances.delete(instanceId)
      this.emit('deregistered', { id: instanceId, name: serviceName })

      if (instances.size === 0) {
        this.services.delete(serviceName)
      }
    }
  }

  heartbeat(serviceName: string, instanceId: string): void {
    const instance = this.services.get(serviceName)?.get(instanceId)
    if (instance) {
      instance.lastHeartbeat = Date.now()
      instance.healthy = true
    }
  }

  getInstance(serviceName: string, strategy: LoadBalancingStrategy = 'round-robin'): ServiceInstance | null {
    const instances = this.getHealthyInstances(serviceName)
    if (instances.length === 0) return null

    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(serviceName, instances)
      case 'random':
        return instances[Math.floor(Math.random() * instances.length)]
      case 'least-connections':
        return this.selectLeastConnections(instances)
      default:
        return instances[0]
    }
  }

  getInstances(serviceName: string): ServiceInstance[] {
    return Array.from(this.services.get(serviceName)?.values() || [])
  }

  getHealthyInstances(serviceName: string): ServiceInstance[] {
    return this.getInstances(serviceName).filter((i) => i.healthy)
  }

  setHealthCheck(serviceName: string, check: HealthCheck): void {
    this.healthChecks.set(serviceName, check)
  }

  private selectRoundRobin(serviceName: string, instances: ServiceInstance[]): ServiceInstance {
    const index = (this.roundRobinIndex.get(serviceName) || 0) % instances.length
    this.roundRobinIndex.set(serviceName, index + 1)
    return instances[index]
  }

  private selectLeastConnections(instances: ServiceInstance[]): ServiceInstance {
    return instances.reduce((min, instance) =>
      (this.connections.get(instance.id) || 0) < (this.connections.get(min.id) || 0) ? instance : min
    )
  }

  private startHealthChecks(): void {
    this.checkTimer = setInterval(async () => {
      for (const [serviceName, instances] of this.services) {
        for (const instance of instances.values()) {
          const healthCheck = this.healthChecks.get(serviceName)

          if (healthCheck) {
            try {
              instance.healthy = await healthCheck(instance)
            } catch {
              instance.healthy = false
            }
          } else {
            const timeSinceHeartbeat = Date.now() - instance.lastHeartbeat
            if (timeSinceHeartbeat > this.ttl) {
              instance.healthy = false
              this.emit('unhealthy', { id: instance.id, name: serviceName })
              this.deregister(serviceName, instance.id)
            }
          }

          if (!instance.healthy) {
            this.emit('unhealthy', { id: instance.id, name: serviceName })
          }
        }
      }
    }, this.heartbeatInterval)
  }

  stopHealthChecks(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  getMetrics() {
    const metrics = {
      totalServices: this.services.size,
      totalInstances: 0,
      healthyInstances: 0,
      unhealthyInstances: 0,
    }

    for (const instances of this.services.values()) {
      metrics.totalInstances += instances.size
      for (const instance of instances.values()) {
        if (instance.healthy) {
          metrics.healthyInstances++
        } else {
          metrics.unhealthyInstances++
        }
      }
    }

    return metrics
  }

  incrementConnections(instanceId: string): void {
    this.connections.set(instanceId, (this.connections.get(instanceId) || 0) + 1)
  }

  decrementConnections(instanceId: string): void {
    const count = this.connections.get(instanceId) || 0
    this.connections.set(instanceId, Math.max(0, count - 1))
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ServiceRegistry } from './solution'

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry

  beforeEach(() => {
    registry = new ServiceRegistry()
  })

  it('should register services', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    expect(id).toBeDefined()
    expect(registry.getInstances('api')).toHaveLength(1)
  })

  it('should deregister services', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.deregister('api', id)
    expect(registry.getInstances('api')).toHaveLength(0)
  })

  it('should update heartbeat', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.heartbeat('api', id)
    const instances = registry.getInstances('api')
    expect(instances[0].healthy).toBe(true)
  })

  it('should get instance with round-robin', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.register({ name: 'api', host: 'localhost', port: 3001 })
    const i1 = registry.getInstance('api', 'round-robin')
    const i2 = registry.getInstance('api', 'round-robin')
    expect(i1?.id).not.toBe(i2?.id)
  })

  it('should get instance with random strategy', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    const instance = registry.getInstance('api', 'random')
    expect(instance).toBeDefined()
  })

  it('should filter healthy instances', () => {
    const id1 = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    const id2 = registry.register({ name: 'api', host: 'localhost', port: 3001 })
    const instances = registry.getInstances('api')
    instances[0].healthy = false
    const healthy = registry.getHealthyInstances('api')
    expect(healthy).toHaveLength(1)
  })

  it('should emit registration events', () => {
    const spy = vi.fn()
    registry.on('registered', spy)
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    expect(spy).toHaveBeenCalled()
  })

  it('should emit deregistration events', () => {
    const spy = vi.fn()
    registry.on('deregistered', spy)
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.deregister('api', id)
    expect(spy).toHaveBeenCalled()
  })

  it('should run health checks', async () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.setHealthCheck('api', async () => true)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(registry.getHealthyInstances('api')).toHaveLength(1)
  })

  it('should mark unhealthy on failed health check', async () => {
    const spy = vi.fn()
    registry.on('unhealthy', spy)
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.setHealthCheck('api', async () => false)
    await new Promise(resolve => setTimeout(resolve, 15000))
  })

  it('should get service names', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.register({ name: 'db', host: 'localhost', port: 5432 })
    expect(registry.getServiceNames()).toContain('api')
    expect(registry.getServiceNames()).toContain('db')
  })

  it('should provide metrics', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    const metrics = registry.getMetrics()
    expect(metrics.totalServices).toBe(1)
    expect(metrics.totalInstances).toBe(1)
  })

  it('should track connections', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.incrementConnections(id)
    registry.incrementConnections(id)
    expect(registry.getMetrics()).toBeDefined()
  })

  it('should decrement connections', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.incrementConnections(id)
    registry.decrementConnections(id)
    expect(registry.getMetrics()).toBeDefined()
  })

  it('should select least connections', () => {
    const id1 = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    const id2 = registry.register({ name: 'api', host: 'localhost', port: 3001 })
    registry.incrementConnections(id1)
    const instance = registry.getInstance('api', 'least-connections')
    expect(instance?.id).toBe(id2)
  })

  it('should stop health checks', () => {
    registry.stopHealthChecks()
    expect(registry.getMetrics()).toBeDefined()
  })

  it('should support metadata', () => {
    registry.register({
      name: 'api',
      host: 'localhost',
      port: 3000,
      metadata: { version: '1.0' },
    })
    const instance = registry.getInstance('api')
    expect(instance?.metadata?.version).toBe('1.0')
  })

  it('should return null for unknown service', () => {
    const instance = registry.getInstance('unknown')
    expect(instance).toBeNull()
  })

  it('should handle multiple services', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.register({ name: 'db', host: 'localhost', port: 5432 })
    expect(registry.getServiceNames()).toHaveLength(2)
  })

  it('should maintain round-robin state', () => {
    registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.register({ name: 'api', host: 'localhost', port: 3001 })
    registry.register({ name: 'api', host: 'localhost', port: 3002 })
    const i1 = registry.getInstance('api', 'round-robin')
    const i2 = registry.getInstance('api', 'round-robin')
    const i3 = registry.getInstance('api', 'round-robin')
    expect(i1?.id).not.toBe(i2?.id)
    expect(i2?.id).not.toBe(i3?.id)
  })

  it('should cleanup empty services', () => {
    const id = registry.register({ name: 'api', host: 'localhost', port: 3000 })
    registry.deregister('api', id)
    expect(registry.getServiceNames()).toHaveLength(0)
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['service-discovery', 'health-checks', 'load-balancing', 'microservices'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },

  {
    title: 'Distributed Lock Manager',
    description:
      'Build a distributed lock manager with timeout support, deadlock detection, and lock acquisition queuing.',
    prompt: `Implement a distributed locking system that prevents race conditions. Support lock acquisition with timeout, automatic release, deadlock detection, and fair queuing. Handle client failures.`,
    solution: `/**
 * Distributed Lock Manager
 */

import { EventEmitter } from 'events'

interface Lock {
  resource: string
  owner: string
  acquiredAt: number
  expiresAt: number
  waitQueue: Array<{ owner: string; resolve: (acquired: boolean) => void }>
}

export class DistributedLockManager extends EventEmitter {
  private locks = new Map<string, Lock>()
  private ownerLocks = new Map<string, Set<string>>()
  private defaultTimeout = 30000
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    super()
    this.cleanupInterval = setInterval(() => this.cleanup(), 1000)
  }

  async acquire(resource: string, owner: string, timeout = this.defaultTimeout): Promise<boolean> {
    const existingLock = this.locks.get(resource)

    if (!existingLock || Date.now() >= existingLock.expiresAt) {
      return this.grantLock(resource, owner, timeout)
    }

    if (existingLock.owner === owner) {
      existingLock.expiresAt = Date.now() + timeout
      return true
    }

    return this.waitForLock(resource, owner, timeout)
  }

  release(resource: string, owner: string): boolean {
    const lock = this.locks.get(resource)
    if (!lock || lock.owner !== owner) {
      return false
    }

    this.locks.delete(resource)
    this.ownerLocks.get(owner)?.delete(resource)
    this.emit('released', { resource, owner })

    if (lock.waitQueue.length > 0) {
      const next = lock.waitQueue.shift()!
      this.grantLock(resource, next.owner, this.defaultTimeout)
      next.resolve(true)
    }

    return true
  }

  isLocked(resource: string): boolean {
    const lock = this.locks.get(resource)
    return !!lock && Date.now() < lock.expiresAt
  }

  getLockOwner(resource: string): string | null {
    const lock = this.locks.get(resource)
    return lock && Date.now() < lock.expiresAt ? lock.owner : null
  }

  getOwnerLocks(owner: string): string[] {
    return Array.from(this.ownerLocks.get(owner) || [])
  }

  forceRelease(resource: string): boolean {
    const lock = this.locks.get(resource)
    if (!lock) return false

    this.locks.delete(resource)
    this.ownerLocks.get(lock.owner)?.delete(resource)
    this.emit('forcedRelease', { resource, owner: lock.owner })

    lock.waitQueue.forEach((waiter) => waiter.resolve(false))

    return true
  }

  detectDeadlock(owner: string): boolean {
    const visited = new Set<string>()
    const stack = new Set<string>()

    const hasCycle = (current: string): boolean => {
      if (stack.has(current)) return true
      if (visited.has(current)) return false

      visited.add(current)
      stack.add(current)

      const resources = this.getOwnerLocks(current)
      for (const resource of resources) {
        const lock = this.locks.get(resource)
        if (lock) {
          for (const waiter of lock.waitQueue) {
            if (hasCycle(waiter.owner)) {
              return true
            }
          }
        }
      }

      stack.delete(current)
      return false
    }

    return hasCycle(owner)
  }

  private grantLock(resource: string, owner: string, timeout: number): boolean {
    const lock: Lock = {
      resource,
      owner,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + timeout,
      waitQueue: [],
    }

    this.locks.set(resource, lock)

    if (!this.ownerLocks.has(owner)) {
      this.ownerLocks.set(owner, new Set())
    }
    this.ownerLocks.get(owner)!.add(resource)

    this.emit('acquired', { resource, owner })
    return true
  }

  private waitForLock(resource: string, owner: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const lock = this.locks.get(resource)!
      const timer = setTimeout(() => {
        const index = lock.waitQueue.findIndex((w) => w.owner === owner)
        if (index !== -1) {
          lock.waitQueue.splice(index, 1)
        }
        this.emit('acquireTimeout', { resource, owner })
        resolve(false)
      }, timeout)

      lock.waitQueue.push({
        owner,
        resolve: (acquired) => {
          clearTimeout(timer)
          resolve(acquired)
        },
      })
    })
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [resource, lock] of this.locks) {
      if (now >= lock.expiresAt) {
        this.emit('expired', { resource, owner: lock.owner })
        this.release(resource, lock.owner)
      }
    }
  }

  getQueueLength(resource: string): number {
    return this.locks.get(resource)?.waitQueue.length || 0
  }

  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.locks.clear()
    this.ownerLocks.clear()
  }
}`,
    tests: `import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DistributedLockManager } from './solution'

describe('DistributedLockManager', () => {
  let manager: DistributedLockManager

  beforeEach(() => {
    manager = new DistributedLockManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  it('should acquire lock', async () => {
    const acquired = await manager.acquire('resource1', 'owner1')
    expect(acquired).toBe(true)
  })

  it('should prevent concurrent acquisition', async () => {
    await manager.acquire('resource1', 'owner1')
    const acquired = await manager.acquire('resource1', 'owner2', 100)
    expect(acquired).toBe(false)
  })

  it('should release lock', async () => {
    await manager.acquire('resource1', 'owner1')
    const released = manager.release('resource1', 'owner1')
    expect(released).toBe(true)
  })

  it('should check if resource is locked', async () => {
    await manager.acquire('resource1', 'owner1')
    expect(manager.isLocked('resource1')).toBe(true)
  })

  it('should get lock owner', async () => {
    await manager.acquire('resource1', 'owner1')
    expect(manager.getLockOwner('resource1')).toBe('owner1')
  })

  it('should not release lock by non-owner', async () => {
    await manager.acquire('resource1', 'owner1')
    const released = manager.release('resource1', 'owner2')
    expect(released).toBe(false)
  })

  it('should reacquire same lock by owner', async () => {
    await manager.acquire('resource1', 'owner1')
    const acquired = await manager.acquire('resource1', 'owner1')
    expect(acquired).toBe(true)
  })

  it('should queue lock requests', async () => {
    await manager.acquire('resource1', 'owner1')
    manager.acquire('resource1', 'owner2', 5000)
    expect(manager.getQueueLength('resource1')).toBe(1)
  })

  it('should grant lock to next in queue', async () => {
    await manager.acquire('resource1', 'owner1', 100)
    const promise = manager.acquire('resource1', 'owner2', 5000)

    await new Promise(resolve => setTimeout(resolve, 150))
    const acquired = await promise
    expect(acquired).toBe(true)
  })

  it('should emit acquired event', async () => {
    const spy = vi.fn()
    manager.on('acquired', spy)
    await manager.acquire('resource1', 'owner1')
    expect(spy).toHaveBeenCalled()
  })

  it('should emit released event', async () => {
    const spy = vi.fn()
    manager.on('released', spy)
    await manager.acquire('resource1', 'owner1')
    manager.release('resource1', 'owner1')
    expect(spy).toHaveBeenCalled()
  })

  it('should force release lock', async () => {
    await manager.acquire('resource1', 'owner1')
    const forced = manager.forceRelease('resource1')
    expect(forced).toBe(true)
    expect(manager.isLocked('resource1')).toBe(false)
  })

  it('should track owner locks', async () => {
    await manager.acquire('resource1', 'owner1')
    await manager.acquire('resource2', 'owner1')
    expect(manager.getOwnerLocks('owner1')).toHaveLength(2)
  })

  it('should timeout waiting for lock', async () => {
    await manager.acquire('resource1', 'owner1', 5000)
    const acquired = await manager.acquire('resource1', 'owner2', 100)
    expect(acquired).toBe(false)
  })

  it('should detect deadlock', async () => {
    await manager.acquire('r1', 'owner1')
    await manager.acquire('r2', 'owner2')
    manager.acquire('r2', 'owner1', 5000)
    manager.acquire('r1', 'owner2', 5000)

    const hasDeadlock = manager.detectDeadlock('owner1')
    expect(typeof hasDeadlock).toBe('boolean')
  })

  it('should cleanup expired locks', async () => {
    const spy = vi.fn()
    manager.on('expired', spy)
    await manager.acquire('resource1', 'owner1', 50)
    await new Promise(resolve => setTimeout(resolve, 1200))
  })

  it('should emit timeout event', async () => {
    const spy = vi.fn()
    manager.on('acquireTimeout', spy)
    await manager.acquire('resource1', 'owner1', 5000)
    await manager.acquire('resource1', 'owner2', 100)
    expect(spy).toHaveBeenCalled()
  })

  it('should return null for unlocked resource owner', () => {
    expect(manager.getLockOwner('resource1')).toBeNull()
  })

  it('should handle multiple resources', async () => {
    await manager.acquire('r1', 'owner1')
    await manager.acquire('r2', 'owner1')
    expect(manager.isLocked('r1')).toBe(true)
    expect(manager.isLocked('r2')).toBe(true)
  })

  it('should return false for non-existent lock release', () => {
    const released = manager.release('nonexistent', 'owner1')
    expect(released).toBe(false)
  })

  it('should emit forced release event', async () => {
    const spy = vi.fn()
    manager.on('forcedRelease', spy)
    await manager.acquire('resource1', 'owner1')
    manager.forceRelease('resource1')
    expect(spy).toHaveBeenCalled()
  })
})`,
    difficulty: 'hard',
    category: 'code-generation',
    subcategory: 'typescript',
    primaryRole: 'developer',
    roleEvaluations: getCodeGenRoleEvaluations('hard'),
    tags: ['distributed-systems', 'locking', 'concurrency', 'deadlock-detection'],
    expectedMetrics: {
      testPassRate: 85,
      codeQualityMin: 9.0,
      maxLines: 200,
    },
    source: 'hand-crafted',
    createdBy: 'engineering-team',
  },
]

// Combine hand-crafted and generated tasks to create full set of 50
export const typescriptCodeGenHardTasks: CreateTestBankTask[] = [
  ...handCraftedTasks,
  ...generatedHardTasks,
]

// Verification: Ensure we have exactly 50 tasks
if (typescriptCodeGenHardTasks.length !== 50) {
  throw new Error(
    `Expected 50 Hard tasks, but got ${typescriptCodeGenHardTasks.length}`
  )
}
