import React from 'react';
import type { ReviewSession, User } from '../service.server';

interface ReviewRequestNotificationProps {
  session: ReviewSession;
  recipient: User;
  appUrl: string;
  unsubscribeUrl: string;
}

export function renderReviewRequestNotification({
  session,
  recipient,
  appUrl,
  unsubscribeUrl,
}: ReviewRequestNotificationProps): { html: string; text: string } {
  const reviewUrl = `${appUrl}/reviews/${session.id}`;
  const prUrl = session.prUrl || (session.prNumber ? `${appUrl}/pr/${session.prNumber}` : null);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Request</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      border-bottom: 2px solid #4f46e5;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #4f46e5;
      font-size: 24px;
      margin: 0;
    }
    .review-box {
      background-color: #f0f9ff;
      border: 1px solid #0284c7;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .review-title {
      font-size: 18px;
      font-weight: 600;
      color: #0c4a6e;
      margin-bottom: 10px;
    }
    .review-meta {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .document-list {
      margin: 15px 0;
      padding: 0;
      list-style: none;
    }
    .document-item {
      background-color: #f9fafb;
      border-left: 3px solid #4f46e5;
      padding: 10px 15px;
      margin: 8px 0;
      border-radius: 4px;
      transition: background-color 0.2s;
    }
    .document-item:hover {
      background-color: #f3f4f6;
    }
    .document-item a {
      color: #1f2937;
      text-decoration: none;
      display: flex;
      align-items: center;
    }
    .document-icon {
      margin-right: 8px;
      color: #6b7280;
    }
    .summary-box {
      background-color: #fef3c7;
      border: 1px solid #fbbf24;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
    }
    .summary-label {
      font-weight: 600;
      color: #92400e;
      margin-bottom: 8px;
    }
    .pr-info {
      display: flex;
      align-items: center;
      gap: 15px;
      background-color: #f3f4f6;
      padding: 12px 15px;
      border-radius: 6px;
      margin: 15px 0;
    }
    .pr-badge {
      background-color: #10b981;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #4f46e5;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin: 20px 0;
    }
    .button:hover {
      background-color: #4338ca;
    }
    .button-secondary {
      background-color: #6b7280;
      margin-left: 10px;
    }
    .button-secondary:hover {
      background-color: #4b5563;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: inline-block;
      vertical-align: middle;
      margin-right: 8px;
      background-color: #e5e7eb;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .footer a {
      color: #4f46e5;
      text-decoration: none;
    }
    @media (max-width: 600px) {
      body {
        padding: 10px;
      }
      .container {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>👀 Review Request</h1>
    </div>

    <p>Hi ${recipient.name},</p>

    <p>You've been requested to review documents in the following session:</p>

    <div class="review-box">
      <div class="review-title">${escapeHtml(session.title)}</div>
      <div class="review-meta">
        ${session.owner.avatarUrl ? `<img src="${session.owner.avatarUrl}" alt="${session.owner.name}" class="avatar">` : ''}
        Requested by <strong>${session.owner.name}</strong>
      </div>

      ${session.summary ? `
      <div class="summary-box">
        <div class="summary-label">Summary:</div>
        ${escapeHtml(session.summary)}
      </div>
      ` : ''}

      ${prUrl ? `
      <div class="pr-info">
        <span class="pr-badge">PR #${session.prNumber}</span>
        <span>Branch: <code>${session.branch}</code></span>
      </div>
      ` : ''}

      <div style="margin-top: 15px;">
        <strong>Documents to review (${session.documents.length}):</strong>
      </div>
      <ul class="document-list">
        ${session.documents.map(doc => `
          <li class="document-item">
            <a href="${appUrl}/docs/${encodeURIComponent(doc.path)}">
              <span class="document-icon">📄</span>
              ${escapeHtml(doc.title)}
            </a>
          </li>
        `).join('')}
      </ul>
    </div>

    <div style="text-align: center;">
      <a href="${reviewUrl}" class="button">Start Review</a>
      ${prUrl ? `<a href="${prUrl}" class="button button-secondary">View PR</a>` : ''}
    </div>

    <div class="footer">
      <p>You're receiving this because you were assigned as a reviewer.</p>
      <p>
        <a href="${unsubscribeUrl}">Unsubscribe</a> •
        <a href="${appUrl}/settings/notifications">Manage Notifications</a> •
        <a href="${appUrl}">Doc Review</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Review Request

Hi ${recipient.name},

You've been requested to review documents in the following session:

${session.title}
Requested by: ${session.owner.name}

${session.summary ? `Summary:\n${session.summary}\n` : ''}
${session.prNumber ? `PR #${session.prNumber} - Branch: ${session.branch}\n` : ''}

Documents to review (${session.documents.length}):
${session.documents.map(doc => `- ${doc.title}`).join('\n')}

Start Review: ${reviewUrl}
${prUrl ? `View PR: ${prUrl}` : ''}

---
You're receiving this because you were assigned as a reviewer.
Unsubscribe: ${unsubscribeUrl}
Manage Notifications: ${appUrl}/settings/notifications
  `.trim();

  return { html, text };
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}