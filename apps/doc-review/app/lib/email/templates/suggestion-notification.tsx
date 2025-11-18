import type { Suggestion, User } from '../service.server';

interface SuggestionNotificationProps {
  suggestion: Suggestion;
  recipient: User;
  appUrl: string;
  unsubscribeUrl: string;
}

export function renderSuggestionNotification({
  suggestion,
  recipient,
  appUrl,
  unsubscribeUrl,
}: SuggestionNotificationProps): { html: string; text: string } {
  const docUrl = `${appUrl}/docs/${encodeURIComponent(suggestion.docPath)}#suggestion-${suggestion.id}`;

  const statusColors = {
    pending: { bg: '#fef3c7', border: '#fbbf24', text: '#92400e' },
    approved: { bg: '#d1fae5', border: '#34d399', text: '#065f46' },
    rejected: { bg: '#fee2e2', border: '#f87171', text: '#991b1b' },
    implemented: { bg: '#ddd6fe', border: '#a78bfa', text: '#5b21b6' },
  };

  const statusColor = statusColors[suggestion.status as keyof typeof statusColors] || statusColors.pending;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suggestion Update</title>
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
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      background-color: ${statusColor.bg};
      color: ${statusColor.text};
      border: 1px solid ${statusColor.border};
      margin-bottom: 15px;
    }
    .diff-container {
      margin: 20px 0;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
    }
    .diff-header {
      background-color: #f9fafb;
      padding: 10px 15px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
    .diff-content {
      padding: 15px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .diff-line {
      padding: 2px 0;
    }
    .diff-removed {
      background-color: #fef2f2;
      color: #991b1b;
      padding: 2px 4px;
      text-decoration: line-through;
    }
    .diff-added {
      background-color: #f0fdf4;
      color: #166534;
      padding: 2px 4px;
    }
    .description-box {
      background-color: #f9fafb;
      border-left: 4px solid #4f46e5;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
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
      <h1>💡 ${suggestion.status === 'pending' ? 'New Suggestion' : 'Suggestion Update'}</h1>
    </div>

    <p>Hi ${recipient.name},</p>

    ${suggestion.status === 'pending'
      ? `<p>A new suggestion has been made on <strong>"${suggestion.document?.title || 'the document'}"</strong>:</p>`
      : `<p>Your suggestion on <strong>"${suggestion.document?.title || 'the document'}"</strong> has been <strong>${suggestion.status}</strong>:</p>`
    }

    <div class="status-badge">${suggestion.status}</div>

    <div class="diff-container">
      <div class="diff-header">
        Lines ${suggestion.lineStart}-${suggestion.lineEnd} • Suggested by ${suggestion.user.name}
      </div>
      <div class="diff-content">
        <div class="diff-line">
          <span class="diff-removed">- ${escapeHtml(suggestion.originalText)}</span>
        </div>
        <div class="diff-line">
          <span class="diff-added">+ ${escapeHtml(suggestion.suggestedText)}</span>
        </div>
      </div>
    </div>

    ${suggestion.description ? `
    <div class="description-box">
      <strong>Description:</strong><br>
      ${escapeHtml(suggestion.description)}
    </div>
    ` : ''}

    <div style="text-align: center;">
      <a href="${docUrl}" class="button">View Suggestion</a>
      ${suggestion.status === 'pending' && recipient.id !== suggestion.userId ? `
        <a href="${appUrl}/api/suggestions/${suggestion.id}/approve" class="button button-secondary">Approve</a>
      ` : ''}
    </div>

    <div class="footer">
      <p>You're receiving this because ${
        suggestion.status === 'pending'
          ? "you're watching this document"
          : "you created this suggestion"
      }.</p>
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
${suggestion.status === 'pending' ? 'New Suggestion' : 'Suggestion Update'}

Hi ${recipient.name},

${suggestion.status === 'pending'
  ? `A new suggestion has been made on "${suggestion.document?.title || 'the document'}":`
  : `Your suggestion on "${suggestion.document?.title || 'the document'}" has been ${suggestion.status}:`
}

Status: ${suggestion.status.toUpperCase()}

Lines ${suggestion.lineStart}-${suggestion.lineEnd}
Suggested by: ${suggestion.user.name}

Original:
${suggestion.originalText}

Suggested:
${suggestion.suggestedText}

${suggestion.description ? `Description:\n${suggestion.description}\n` : ''}

View suggestion: ${docUrl}

---
You're receiving this because ${
  suggestion.status === 'pending'
    ? "you're watching this document"
    : "you created this suggestion"
}.
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