import { Resend } from 'resend';
import type { CommentRecord, SuggestionRecord, ReviewSessionRecord } from '../db/schema';
import { renderCommentNotification } from './templates/comment-notification';
import { renderSuggestionNotification } from './templates/suggestion-notification';
import { renderReviewRequestNotification } from './templates/review-request';
import { renderDigest } from './templates/digest';
import { queueEmail, type QueuedEmail } from './queue.server';
import { generateUnsubscribeToken } from '../auth/tokens.server';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export interface Comment extends CommentRecord {
  user: User;
  document?: {
    path: string;
    title: string;
  };
}

export interface Suggestion extends SuggestionRecord {
  user: User;
  document?: {
    path: string;
    title: string;
  };
}

export interface ReviewSession extends ReviewSessionRecord {
  owner: User;
  documents: Array<{
    path: string;
    title: string;
  }>;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface IEmailService {
  sendEmail(options: EmailOptions): Promise<void>;
  sendCommentNotification(comment: Comment, recipients: User[]): Promise<void>;
  sendSuggestionNotification(suggestion: Suggestion, recipients: User[]): Promise<void>;
  sendReviewRequestNotification(session: ReviewSession, recipients: User[]): Promise<void>;
  sendDigestNotification(userId: string, digest: DigestData): Promise<void>;
}

export interface DigestData {
  user: User;
  period: 'daily' | 'weekly';
  startDate: Date;
  endDate: Date;
  comments: Comment[];
  suggestions: Suggestion[];
  reviews: ReviewSession[];
  documentsUpdated: Array<{
    path: string;
    title: string;
    changeCount: number;
  }>;
}

export class ResendEmailService implements IEmailService {
  private resend: Resend;
  private fromEmail: string;
  private appUrl: string;
  private isDevelopment: boolean;

  constructor(
    apiKey: string,
    fromEmail: string,
    appUrl: string,
    isDevelopment = false
  ) {
    this.resend = new Resend(apiKey);
    this.fromEmail = fromEmail;
    this.appUrl = appUrl;
    this.isDevelopment = isDevelopment;
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    if (this.isDevelopment) {
      console.log('📧 [DEV] Would send email:', {
        to: options.to,
        subject: options.subject,
        preview: options.html.substring(0, 200) + '...'
      });
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: options.replyTo,
        headers: options.headers,
        tags: options.tags,
      });

      if (error) {
        console.error('Failed to send email:', error);
        throw new Error(`Email send failed: ${error.message}`);
      }

      console.log('Email sent successfully:', data?.id);
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async sendCommentNotification(comment: Comment, recipients: User[]): Promise<void> {
    for (const recipient of recipients) {
      const unsubscribeToken = await generateUnsubscribeToken(recipient.id);
      const unsubscribeUrl = `${this.appUrl}/unsubscribe/${unsubscribeToken}`;

      const { html, text } = await renderCommentNotification({
        comment,
        recipient,
        appUrl: this.appUrl,
        unsubscribeUrl,
      });

      await queueEmail({
        to: recipient.email,
        subject: `New comment on "${comment.document?.title || 'document'}"`,
        html,
        text,
        userId: recipient.id,
        type: 'comment_notification',
        metadata: {
          commentId: comment.id,
          docPath: comment.docPath,
        },
      });
    }
  }

  async sendSuggestionNotification(suggestion: Suggestion, recipients: User[]): Promise<void> {
    for (const recipient of recipients) {
      const unsubscribeToken = await generateUnsubscribeToken(recipient.id);
      const unsubscribeUrl = `${this.appUrl}/unsubscribe/${unsubscribeToken}`;

      const { html, text } = await renderSuggestionNotification({
        suggestion,
        recipient,
        appUrl: this.appUrl,
        unsubscribeUrl,
      });

      const subject = suggestion.status === 'pending'
        ? `New suggestion on "${suggestion.document?.title || 'document'}"`
        : `Suggestion ${suggestion.status} on "${suggestion.document?.title || 'document'}"`;

      await queueEmail({
        to: recipient.email,
        subject,
        html,
        text,
        userId: recipient.id,
        type: 'suggestion_notification',
        metadata: {
          suggestionId: suggestion.id,
          docPath: suggestion.docPath,
          status: suggestion.status,
        },
      });
    }
  }

  async sendReviewRequestNotification(session: ReviewSession, recipients: User[]): Promise<void> {
    for (const recipient of recipients) {
      const unsubscribeToken = await generateUnsubscribeToken(recipient.id);
      const unsubscribeUrl = `${this.appUrl}/unsubscribe/${unsubscribeToken}`;

      const { html, text } = await renderReviewRequestNotification({
        session,
        recipient,
        appUrl: this.appUrl,
        unsubscribeUrl,
      });

      await queueEmail({
        to: recipient.email,
        subject: `Review requested: ${session.title}`,
        html,
        text,
        userId: recipient.id,
        type: 'review_request',
        metadata: {
          sessionId: session.id,
          prNumber: session.prNumber?.toString(),
        },
      });
    }
  }

  async sendDigestNotification(userId: string, digest: DigestData): Promise<void> {
    const unsubscribeToken = await generateUnsubscribeToken(userId);
    const unsubscribeUrl = `${this.appUrl}/unsubscribe/${unsubscribeToken}`;

    const { html, text } = await renderDigest({
      digest,
      appUrl: this.appUrl,
      unsubscribeUrl,
    });

    const periodText = digest.period === 'daily' ? 'Daily' : 'Weekly';
    const subject = `${periodText} Doc Review Digest - ${digest.comments.length} comments, ${digest.suggestions.length} suggestions`;

    await queueEmail({
      to: digest.user.email,
      subject,
      html,
      text,
      userId,
      type: 'digest',
      metadata: {
        period: digest.period,
        commentCount: digest.comments.length.toString(),
        suggestionCount: digest.suggestions.length.toString(),
      },
    });
  }
}

// Factory function to create email service with environment config
export function createEmailService(env: {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APP_URL?: string;
  ENVIRONMENT?: string;
}): IEmailService {
  const apiKey = env.RESEND_API_KEY || '';
  const fromEmail = env.RESEND_FROM_EMAIL || 'notifications@doc-review.com';
  const appUrl = env.APP_URL || 'http://localhost:6700';
  const isDevelopment = env.ENVIRONMENT !== 'production' || !apiKey;

  if (!apiKey && !isDevelopment) {
    throw new Error('RESEND_API_KEY is required in production');
  }

  return new ResendEmailService(apiKey, fromEmail, appUrl, isDevelopment);
}