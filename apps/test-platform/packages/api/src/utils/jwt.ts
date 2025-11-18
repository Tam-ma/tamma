/**
 * JWT utility functions using @tsndr/cloudflare-worker-jwt
 * Provides token generation, verification, and decoding for authentication
 */

import jwt from '@tsndr/cloudflare-worker-jwt'

export interface TokenPayload {
  userId: string
  email: string
  type: 'access' | 'refresh'
  iat?: number
  exp?: number
}

export interface DecodedToken extends TokenPayload {
  iat: number
  exp: number
}

/**
 * Sign a JWT token with the provided payload and options
 */
export async function signToken(
  payload: TokenPayload,
  secret: string,
  expiresIn: string = '15m'
): Promise<string> {
  try {
    // Convert expiresIn string to seconds
    const expirationSeconds = parseExpiration(expiresIn)

    // Add issued at and expiration times
    const tokenPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expirationSeconds
    }

    // Sign with algorithm specified
    return await jwt.sign(tokenPayload, secret, { algorithm: 'HS256' })
  } catch (error) {
    throw new Error(`Failed to sign token: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Verify a JWT token and return the decoded payload
 */
export async function verifyToken(token: string, secret: string): Promise<DecodedToken | null> {
  try {
    const isValid = await jwt.verify(token, secret, { algorithm: 'HS256' })
    if (!isValid) {
      console.error('Token verification failed: invalid signature')
      return null
    }

    const decodedResult = jwt.decode(token)
    // The library returns { payload: {...}, header: {...} }
    const decoded = (decodedResult?.payload || decodedResult) as DecodedToken

    // Check if token is expired
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      console.error('Token expired')
      return null
    }

    return decoded
  } catch (error) {
    console.error('Token verification failed:', error)
    return null
  }
}

/**
 * Decode a JWT token without verifying the signature
 * Use this only when you need to read the payload without verification
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const decodedResult = jwt.decode(token)
    // The library returns { payload: {...}, header: {...} }
    return (decodedResult?.payload || decodedResult) as DecodedToken
  } catch (error) {
    console.error('Token decoding failed:', error)
    return null
  }
}

/**
 * Generate access and refresh tokens for a user
 */
export async function generateTokenPair(
  userId: string,
  email: string,
  secret: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await signToken(
    { userId, email, type: 'access' },
    secret,
    '15m' // 15 minutes
  )

  const refreshToken = await signToken(
    { userId, email, type: 'refresh' },
    secret,
    '7d' // 7 days
  )

  return { accessToken, refreshToken }
}

/**
 * Parse expiration string to seconds
 * Supports formats like '15m', '1h', '7d', '30s'
 */
function parseExpiration(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/)
  if (!match) {
    throw new Error(`Invalid expiration format: ${expiresIn}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 's': return value
    case 'm': return value * 60
    case 'h': return value * 3600
    case 'd': return value * 86400
    default: throw new Error(`Invalid time unit: ${unit}`)
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null
  }

  return parts[1]
}