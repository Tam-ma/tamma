import nodemailer, { Transporter } from 'nodemailer'
import handlebars from 'handlebars'

interface EmailOptions {
  to: string
  subject: string
  html: string
  text: string
  category?: string
  attachments?: Array<{
    filename: string
    content?: string
    path?: string
  }>
}

interface EmailConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  from: string
}

export class EmailService {
  private transporter: Transporter | null = null
  private config: EmailConfig
  private templates: Map<string, handlebars.TemplateDelegate> = new Map()

  constructor() {
    // Configure based on environment
    this.config = {
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || '',
      },
      from: process.env.EMAIL_FROM || 'Test Platform <noreply@testplatform.com>',
    }

    this.initializeTransporter()
    this.registerTemplates()
  }

  private initializeTransporter(): void {
    if (process.env.NODE_ENV === 'test') {
      // Use test account for testing
      this.transporter = nodemailer.createTransport({
        host: 'localhost',
        port: 1025,
        secure: false,
        ignoreTLS: true,
      })
    } else if (process.env.NODE_ENV === 'development') {
      // Use Ethereal for development
      nodemailer.createTestAccount((err, account) => {
        if (err) {
          console.error('Failed to create test email account', err)
          return
        }

        this.transporter = nodemailer.createTransporter({
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          auth: {
            user: account.user,
            pass: account.pass,
          },
        })

        console.log('Test email account created:', account.user)
        console.log('Preview URL will be generated for sent emails')
      })
    } else {
      // Production configuration
      this.transporter = nodemailer.createTransporter({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth,
      })

      // Verify connection
      this.transporter.verify((error) => {
        if (error) {
          console.error('Email transporter verification failed:', error)
        } else {
          console.log('Email server is ready to send emails')
        }
      })
    }
  }

  private registerTemplates(): void {
    // Register password reset template
    const passwordResetTemplate = handlebars.compile(this.getPasswordResetTemplate())
    this.templates.set('password_reset', passwordResetTemplate)

    // Register password changed template
    const passwordChangedTemplate = handlebars.compile(this.getPasswordChangedTemplate())
    this.templates.set('password_changed', passwordChangedTemplate)

    // Register welcome template
    const welcomeTemplate = handlebars.compile(this.getWelcomeTemplate())
    this.templates.set('welcome', welcomeTemplate)

    // Register email verification template
    const emailVerificationTemplate = handlebars.compile(this.getEmailVerificationTemplate())
    this.templates.set('email_verification', emailVerificationTemplate)
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      console.error('Email transporter not initialized')
      return
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
        headers: {
          'X-Category': options.category || 'general',
        },
      })

      console.log('Email sent successfully', {
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
        category: options.category,
      })

      // Log preview URL for development
      if (process.env.NODE_ENV === 'development') {
        const previewUrl = nodemailer.getTestMessageUrl(info)
        if (previewUrl) {
          console.log('Preview URL:', previewUrl)
        }
      }
    } catch (error) {
      console.error('Failed to send email', { error, to: options.to, subject: options.subject })
      throw error
    }
  }

  async sendPasswordResetEmail(email: string, token: string, firstName?: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`
    const expiryHours = 2

    const template = this.templates.get('password_reset')
    if (!template) {
      throw new Error('Password reset template not found')
    }

    const html = template({
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
    const template = this.templates.get('password_changed')
    if (!template) {
      throw new Error('Password changed template not found')
    }

    const html = template({
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
    const template = this.templates.get('welcome')
    if (!template) {
      throw new Error('Welcome template not found')
    }

    const html = template({
      firstName: firstName || 'there',
      loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`,
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
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`
    const expiryHours = 24

    const template = this.templates.get('email_verification')
    if (!template) {
      throw new Error('Email verification template not found')
    }

    const html = template({
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
        <title>Email Verification - Test Platform</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #3b82f6; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .link-box { word-break: break-all; background: #e2e8f0; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 13px; }
          .icon { display: inline-block; width: 60px; height: 60px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email Address</h1>
          </div>
          <div class="content">
            <p>Hello {{firstName}},</p>
            <p>Thank you for registering with Test Platform! We're excited to have you on board.</p>

            <p>Please verify your email address by clicking the button below:</p>
            <div style="text-align: center;">
              <a href="{{verifyUrl}}" class="button">Verify Email Address</a>
            </div>

            <p>Or copy and paste this link into your browser:</p>
            <div class="link-box">
              {{verifyUrl}}
            </div>

            <div class="warning">
              <strong>Important:</strong>
              <ul style="margin: 10px 0;">
                <li>This link will expire in {{expiryHours}} hours</li>
                <li>If you didn't create this account, please ignore this email</li>
                <li>Never share this verification link with anyone</li>
              </ul>
            </div>

            <p>Once verified, you'll have full access to all Test Platform features.</p>

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
}

export const emailService = new EmailService()