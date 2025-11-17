import { Resend } from 'resend'

interface EmailOptions {
  to: string
  subject: string
  html: string
  text: string
  category?: string
}

export class EmailService {
  private resend: Resend
  private fromEmail: string

  constructor() {
    // Initialize Resend with API key
    const apiKey = process.env.RESEND_API_KEY || 're_cmjpryvG_8A6PKNjHm9VSiENDahAC7G1m'
    this.resend = new Resend(apiKey)

    // Set from email
    this.fromEmail = process.env.EMAIL_FROM || 'Mithqal <mithqal@tamma.dev>'
  }

  private replaceTemplate(template: string, data: Record<string, any>): string {
    let result = template
    for (const [key, value] of Object.entries(data)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
    }
    return result
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        tags: options.category ? [{ name: 'category', value: options.category }] : undefined,
      })

      if (error) {
        console.error('Failed to send email via Resend', { error, to: options.to, subject: options.subject })
        throw error
      }

      console.log('Email sent successfully via Resend', {
        id: data?.id,
        to: options.to,
        subject: options.subject,
        category: options.category,
      })
    } catch (error) {
      console.error('Failed to send email', { error, to: options.to, subject: options.subject })
      throw error
    }
  }

  async sendPasswordResetEmail(email: string, token: string, firstName?: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3100'}/reset-password?token=${token}`
    const expiryHours = 2

    const html = this.replaceTemplate(this.getPasswordResetTemplate(), {
      firstName: firstName || 'there',
      resetUrl,
      expiryHours,
      currentYear: new Date().getFullYear(),
    })

    const text = `
      Password Reset - Test Platform

      Hello ${firstName || 'there'},

      We received a request to reset your password for your Test Platform account.

      Click the link below to reset your password:
      ${resetUrl}

      Important:
      - This link will expire in ${expiryHours} hours
      - If you didn't request this password reset, please ignore this email
      - Never share this link with anyone

      If you have any questions, please contact our support team.

      Best regards,
      The Test Platform Team
    `

    await this.sendEmail({
      to: email,
      subject: 'Reset your Test Platform password',
      html,
      text,
      category: 'password_reset',
    })
  }

  async sendPasswordChangedNotification(
    email: string,
    firstName?: string,
    context?: {
      ipAddress?: string
      userAgent?: string
    }
  ): Promise<void> {
    const html = this.replaceTemplate(this.getPasswordChangedTemplate(), {
      firstName: firstName || 'there',
      ipAddress: context?.ipAddress || 'Unknown',
      userAgent: context?.userAgent || 'Unknown',
      changeTime: new Date().toLocaleString(),
      currentYear: new Date().getFullYear(),
    })

    const text = `
      Password Changed Successfully - Test Platform

      Hello ${firstName || 'there'},

      Your password for your Test Platform account has been successfully changed.

      Change details:
      - IP Address: ${context?.ipAddress || 'Unknown'}
      - Device: ${context?.userAgent || 'Unknown'}
      - Time: ${new Date().toLocaleString()}

      Security Notice:
      If you didn't make this change, please:
      - Contact our support team immediately
      - Check your account for any unauthorized activity
      - Consider enabling two-factor authentication

      If you have any concerns about your account security, please don't hesitate to reach out.

      Best regards,
      The Test Platform Team
    `

    await this.sendEmail({
      to: email,
      subject: 'Your Test Platform password has been changed',
      html,
      text,
      category: 'password_changed',
    })
  }

  async sendWelcomeEmail(email: string, firstName?: string): Promise<void> {
    const html = this.replaceTemplate(this.getWelcomeTemplate(), {
      firstName: firstName || 'there',
      loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3100'}/login`,
      currentYear: new Date().getFullYear(),
    })

    const text = `
      Welcome to Test Platform!

      Hello ${firstName || 'there'},

      Thank you for joining Test Platform. We're excited to have you on board!

      You can now log in to your account and start exploring our features.

      If you have any questions or need assistance, our support team is here to help.

      Best regards,
      The Test Platform Team
    `

    await this.sendEmail({
      to: email,
      subject: 'Welcome to Test Platform!',
      html,
      text,
      category: 'welcome',
    })
  }

  async sendEmailVerification(email: string, token: string, firstName?: string): Promise<void> {
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3100'}/verify-email?token=${token}`
    const expiryHours = 24

    const html = this.replaceTemplate(this.getEmailVerificationTemplate(), {
      firstName: firstName || 'there',
      verifyUrl,
      expiryHours,
      currentYear: new Date().getFullYear(),
    })

    const text = `
      Email Verification - Test Platform

      Hello ${firstName || 'there'},

      Thank you for registering with Test Platform!

      Please verify your email address by clicking the link below:
      ${verifyUrl}

      Important:
      - This link will expire in ${expiryHours} hours
      - If you didn't create this account, please ignore this email
      - Never share this link with anyone

      If you have any questions, please contact our support team.

      Best regards,
      The Test Platform Team
    `

    await this.sendEmail({
      to: email,
      subject: 'Please verify your email for Test Platform',
      html,
      text,
      category: 'email_verification',
    })
  }

  private getPasswordResetTemplate(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - Test Platform</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #2563eb; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .link-box { word-break: break-all; background: #e2e8f0; padding: 10px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <p>Hello {{firstName}},</p>
            <p>We received a request to reset your password for your Test Platform account.</p>

            <p>Click the button below to reset your password:</p>
            <div style="text-align: center;">
              <a href="{{resetUrl}}" class="button">Reset Password</a>
            </div>

            <p>Or copy and paste this link into your browser:</p>
            <div class="link-box">
              {{resetUrl}}
            </div>

            <div class="warning">
              <strong>Important:</strong>
              <ul>
                <li>This link will expire in {{expiryHours}} hours</li>
                <li>If you didn't request this password reset, please ignore this email</li>
                <li>Never share this link with anyone</li>
              </ul>
            </div>

            <p>If you have any questions, please contact our support team.</p>

            <p>Best regards,<br>The Test Platform Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; {{currentYear}} Test Platform. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getPasswordChangedTemplate(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed - Test Platform</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10b981; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .alert { background: #fee2e2; border: 1px solid #ef4444; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .details { background: #e0e7ff; padding: 15px; border-radius: 6px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Changed Successfully</h1>
          </div>
          <div class="content">
            <p>Hello {{firstName}},</p>
            <p>Your password for your Test Platform account has been successfully changed.</p>

            <div class="details">
              <strong>Change details:</strong>
              <ul>
                <li>IP Address: {{ipAddress}}</li>
                <li>Device: {{userAgent}}</li>
                <li>Time: {{changeTime}}</li>
              </ul>
            </div>

            <div class="alert">
              <strong>Security Notice:</strong>
              <p>If you didn't make this change, please:</p>
              <ul>
                <li>Contact our support team immediately</li>
                <li>Check your account for any unauthorized activity</li>
                <li>Consider enabling two-factor authentication</li>
              </ul>
            </div>

            <p>If you have any concerns about your account security, please don't hesitate to reach out.</p>

            <p>Best regards,<br>The Test Platform Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; {{currentYear}} Test Platform. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getWelcomeTemplate(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome - Test Platform</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 28px; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #2563eb; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .features { background: #e0e7ff; padding: 20px; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Test Platform!</h1>
          </div>
          <div class="content">
            <p>Hello {{firstName}},</p>
            <p>Thank you for joining Test Platform. We're excited to have you on board!</p>

            <div class="features">
              <strong>What you can do now:</strong>
              <ul>
                <li>Create and manage test cases</li>
                <li>Run automated tests</li>
                <li>View detailed test reports</li>
                <li>Collaborate with your team</li>
              </ul>
            </div>

            <p>Ready to get started?</p>
            <div style="text-align: center;">
              <a href="{{loginUrl}}" class="button">Log In to Your Account</a>
            </div>

            <p>If you have any questions or need assistance, our support team is here to help.</p>

            <p>Best regards,<br>The Test Platform Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; {{currentYear}} Test Platform. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getEmailVerificationTemplate(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification - Mithqal</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f9fafb; }
          .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 40px 30px; text-align: center; }
          .logo { width: 80px; height: 80px; margin: 0 auto 20px; background: white; border-radius: 16px; padding: 12px; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
          .header p { margin: 8px 0 0; font-size: 16px; opacity: 0.95; }
          .content { padding: 40px 30px; background: #ffffff; }
          .greeting { font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 16px; }
          .button { display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white !important; padding: 16px 32px; text-decoration: none; border-radius: 8px; margin: 24px 0; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3); transition: transform 0.2s; }
          .button:hover { transform: translateY(-2px); }
          .footer { text-align: center; padding: 30px; background: #f9fafb; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; }
          .info-box { background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 6px; margin: 20px 0; }
          .link-box { word-break: break-all; background: #f3f4f6; padding: 12px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 13px; color: #4b5563; margin: 20px 0; }
          .divider { height: 1px; background: #e5e7eb; margin: 30px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="56" height="56">
                <circle cx="50" cy="50" r="40" fill="#6366f1"/>
                <text x="50" y="65" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white" text-anchor="middle">M</text>
              </svg>
            </div>
            <h1>Verify Your Email</h1>
            <p>AI Benchmark Platform</p>
          </div>
          <div class="content">
            <p class="greeting">Hello {{firstName}}! 👋</p>
            <p>Welcome to <strong>Mithqal</strong> - the ultimate AI Benchmark Platform! We're excited to have you join our community.</p>

            <p>To get started and unlock full access to our platform, please verify your email address by clicking the button below:</p>

            <div style="text-align: center;">
              <a href="{{verifyUrl}}" class="button">✓ Verify Email Address</a>
            </div>

            <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <div class="link-box">{{verifyUrl}}</div>

            <div class="info-box">
              <strong style="color: #1f2937;">⏱️ Important Information:</strong>
              <ul style="margin: 10px 0; padding-left: 20px; color: #4b5563;">
                <li>This verification link expires in <strong>{{expiryHours}} hours</strong></li>
                <li>If you didn't create this account, you can safely ignore this email</li>
                <li>Keep this link confidential and don't share it with anyone</li>
              </ul>
            </div>

            <div class="divider"></div>

            <p style="color: #6b7280;">Need help? Our support team is here for you at <a href="mailto:support@mithqal.com" style="color: #6366f1; text-decoration: none;">support@mithqal.com</a></p>

            <p style="margin-top: 30px;">Best regards,<br><strong>The Mithqal Team</strong></p>
          </div>
          <div class="footer">
            <p style="margin: 0;">This is an automated message. Please do not reply to this email.</p>
            <p style="margin: 8px 0 0;">&copy; {{currentYear}} Mithqal - AI Benchmark Platform. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }
}

export const emailService = new EmailService()
