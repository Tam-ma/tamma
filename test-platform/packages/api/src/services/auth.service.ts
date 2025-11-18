/**
 * Authentication service for user management
 * Handles registration, login, email verification, password reset, etc.
 */

import { eq, and } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import {
  users,
  verificationTokens,
  passwordResetTokens,
  type User,
  type InsertUser,
  type InsertVerificationToken,
  type InsertPasswordResetToken,
} from '../db/schema'
import {
  hashPassword,
  verifyPassword,
  generateToken,
  generateId,
} from '../utils/crypto'
import { generateTokenPair } from '../utils/jwt'
import { validateEmail, validatePassword } from '../utils/validation'
import { EmailService } from './email.service'

export interface AuthServiceContext {
  db: DrizzleD1Database<typeof import('../db/schema')>
  jwtSecret: string
  kv?: KVNamespace
  emailService?: EmailService
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash'>
  accessToken: string
  refreshToken: string
}

export class AuthService {
  private db: DrizzleD1Database<typeof import('../db/schema')>
  private jwtSecret: string
  private kv?: KVNamespace
  private emailService?: EmailService

  constructor({ db, jwtSecret, kv, emailService }: AuthServiceContext) {
    this.db = db
    this.jwtSecret = jwtSecret
    this.kv = kv
    this.emailService = emailService || new EmailService()
  }

  /**
   * Register a new user
   */
  async registerUser(
    email: string,
    password: string,
    fullName?: string
  ): Promise<{ user: User; verificationToken: string }> {
    // Validate email
    const emailValidation = validateEmail(email)
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error)
    }

    // Validate password
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join(', '))
    }

    // Check if user already exists
    const existingUser = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .get()

    if (existingUser) {
      throw new Error('User with this email already exists')
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const userId = generateId()
    const newUser: InsertUser = {
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      fullName: fullName || null,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await this.db.insert(users).values(newUser)

    // Create verification token
    const verificationToken = generateToken(32)
    const tokenData: InsertVerificationToken = {
      id: generateId(),
      userId,
      token: verificationToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date(),
    }

    await this.db.insert(verificationTokens).values(tokenData)

    // Log email sending (to be replaced with actual email service)
    console.log('Email verification link:', {
      to: email,
      token: verificationToken,
      link: `https://aibaas.com/verify-email?token=${verificationToken}`,
    })

    // Fetch created user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!user) {
      throw new Error('Failed to create user')
    }

    return { user, verificationToken }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<User> {
    // Find token
    const tokenRecord = await this.db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.token, token))
      .get()

    if (!tokenRecord) {
      throw new Error('Invalid verification token')
    }

    // Check if token is expired
    if (new Date(tokenRecord.expiresAt) < new Date()) {
      throw new Error('Verification token has expired')
    }

    // Update user email verified status
    await this.db
      .update(users)
      .set({
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, tokenRecord.userId))

    // Delete used token
    await this.db
      .delete(verificationTokens)
      .where(eq(verificationTokens.id, tokenRecord.id))

    // Return updated user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, tokenRecord.userId))
      .get()

    if (!user) {
      throw new Error('User not found')
    }

    return user
  }

  /**
   * Login user with email and password
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    // Validate email
    const emailValidation = validateEmail(email)
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error)
    }

    // Find user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .get()

    if (!user) {
      throw new Error('Invalid email or password')
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Invalid email or password')
    }

    // Note: We allow login even if email is not verified
    // The frontend will handle redirecting to verification page if needed

    // Generate JWT tokens
    const { accessToken, refreshToken } = await generateTokenPair(
      user.id,
      user.email,
      this.jwtSecret
    )

    // Store refresh token in KV if available
    if (this.kv) {
      await this.kv.put(
        `refresh_token:${user.id}`,
        refreshToken,
        {
          expirationTtl: 7 * 24 * 60 * 60, // 7 days
        }
      )
    }

    // Return user without password hash
    const { passwordHash, ...userWithoutPassword } = user

    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    // Import jwt utilities
    const { verifyToken, signToken } = await import('../utils/jwt')

    // Verify refresh token
    const decoded = await verifyToken(refreshToken, this.jwtSecret)
    if (!decoded || decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token')
    }

    // Check if refresh token exists in KV (if available)
    if (this.kv) {
      const storedToken = await this.kv.get(`refresh_token:${decoded.userId}`)
      if (storedToken !== refreshToken) {
        throw new Error('Refresh token has been revoked')
      }
    }

    // Generate new access token
    const accessToken = await signToken(
      {
        userId: decoded.userId,
        email: decoded.email,
        type: 'access',
      },
      this.jwtSecret,
      '15m'
    )

    return { accessToken }
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<void> {
    // Validate email
    const emailValidation = validateEmail(email)
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error)
    }

    // Find user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .get()

    if (!user) {
      // Don't reveal if user exists
      console.log('Password reset requested for non-existent user:', email)
      return
    }

    // Delete any existing reset tokens for this user
    await this.db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id))

    // Create new reset token
    const resetToken = generateToken(32)
    const tokenData: InsertPasswordResetToken = {
      id: generateId(),
      userId: user.id,
      token: resetToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      createdAt: new Date(),
    }

    await this.db.insert(passwordResetTokens).values(tokenData)

    // Log email sending (to be replaced with actual email service)
    console.log('Password reset link:', {
      to: email,
      token: resetToken,
      link: `https://aibaas.com/reset-password?token=${resetToken}`,
    })
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Validate new password
    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join(', '))
    }

    // Find token
    const tokenRecord = await this.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token))
      .get()

    if (!tokenRecord) {
      throw new Error('Invalid reset token')
    }

    // Check if token is expired
    if (new Date(tokenRecord.expiresAt) < new Date()) {
      throw new Error('Reset token has expired')
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword)

    // Update user password
    await this.db
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, tokenRecord.userId))

    // Delete used token
    await this.db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.id, tokenRecord.id))

    // Revoke all refresh tokens for this user (security measure)
    if (this.kv) {
      await this.kv.delete(`refresh_token:${tokenRecord.userId}`)
    }
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    // Validate new password
    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join(', '))
    }

    // Find user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!user) {
      throw new Error('User not found')
    }

    // Verify current password
    const isValidPassword = await verifyPassword(currentPassword, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Current password is incorrect')
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword)

    // Update password
    await this.db
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    // Revoke all refresh tokens (security measure)
    if (this.kv) {
      await this.kv.delete(`refresh_token:${userId}`)
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!user) {
      return null
    }

    const { passwordHash, ...userWithoutPassword } = user
    return userWithoutPassword
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    // Validate email
    const emailValidation = validateEmail(email)
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error)
    }

    // Find user
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .get()

    if (!user) {
      // Don't reveal if user exists
      console.log('Verification email requested for non-existent user:', email)
      return
    }

    if (user.emailVerified) {
      throw new Error('Email is already verified')
    }

    // Delete any existing verification tokens
    await this.db
      .delete(verificationTokens)
      .where(eq(verificationTokens.userId, user.id))

    // Create new verification token
    const verificationToken = generateToken(32)
    const tokenData: InsertVerificationToken = {
      id: generateId(),
      userId: user.id,
      token: verificationToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date(),
    }

    await this.db.insert(verificationTokens).values(tokenData)

    // Send verification email
    console.log('📧 Attempting to send verification email...', { email, hasEmailService: !!this.emailService })
    if (this.emailService) {
      try {
        console.log('📧 Calling sendEmailVerification...')
        await this.emailService.sendEmailVerification(
          email,
          verificationToken,
          user.fullName || undefined
        )
        console.log('✅ Email sent successfully!')
      } catch (error) {
        console.error('❌ Failed to send verification email:', error)
        // Don't throw error - token is created, email sending is best effort
      }
    } else {
      console.log('⚠️ No email service - logging link instead')
      console.log('Email verification link (resent):', {
        to: email,
        token: verificationToken,
        link: `http://localhost:3100/verify-email?token=${verificationToken}`,
      })
    }
  }

  /**
   * Logout user (revoke refresh token)
   */
  async logout(userId: string): Promise<void> {
    if (this.kv) {
      await this.kv.delete(`refresh_token:${userId}`)
    }
  }
}