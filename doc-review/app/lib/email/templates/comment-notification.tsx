import React from 'react';
import type { Comment, User } from '../service.server';

interface CommentNotificationProps {
  comment: Comment;
  recipient: User;
  appUrl: string;
  unsubscribeUrl: string;
}

export function renderCommentNotification({
  comment,
  recipient,
  appUrl,
  unsubscribeUrl,
}: CommentNotificationProps): { html: string; text: string } {
  const docUrl = `${appUrl}/docs/${encodeURIComponent(comment.docPath)}#comment-${comment.id}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Comment</title>
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
    .comment-box {
      background-color: #f9fafb;
      border-left: 4px solid #4f46e5;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .comment-meta {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .comment-content {
      color: #1f2937;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .context {
      background-color: #fef3c7;
      border: 1px solid #fbbf24;
      padding: 10px;
      border-radius: 4px;
      margin: 15px 0;
      font-size: 14px;
    }
    .context-label {
      font-weight: bold;
      color: #92400e;
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
      <h1>📝 New Comment on Document</h1>
    </div>

    <p>Hi ${recipient.name},</p>

    <p>${comment.parentId ? 'Someone replied to your comment' : 'A new comment was posted'} on <strong>"${comment.document?.title || 'the document'}"</strong>:</p>

    <div class="comment-box">
      <div class="comment-meta">
        ${comment.user.avatarUrl ? `<img src="${comment.user.avatarUrl}" alt="${comment.user.name}" class="avatar">` : ''}
        <strong>${comment.user.name}</strong> commented
      </div>
      <div class="comment-content">${escapeHtml(comment.content)}</div>
    </div>

    ${comment.lineContent ? `
    <div class="context">
      <span class="context-label">Context (Line ${comment.lineNumber}):</span><br>
      <code>${escapeHtml(comment.lineContent)}</code>
    </div>
    ` : ''}

    <div style="text-align: center;">
      <a href="${docUrl}" class="button">View Comment</a>
    </div>

    <div class="footer">
      <p>You're receiving this because you're watching this document or participating in the discussion.</p>
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
New Comment on Document

Hi ${recipient.name},

${comment.parentId ? 'Someone replied to your comment' : 'A new comment was posted'} on "${comment.document?.title || 'the document'}":

${comment.user.name} commented:
${comment.content}

${comment.lineContent ? `Context (Line ${comment.lineNumber}): ${comment.lineContent}` : ''}

View comment: ${docUrl}

---
You're receiving this because you're watching this document or participating in the discussion.
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