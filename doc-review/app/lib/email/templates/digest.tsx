import React from 'react';
import type { DigestData } from '../service.server';

interface DigestNotificationProps {
  digest: DigestData;
  appUrl: string;
  unsubscribeUrl: string;
}

export function renderDigest({
  digest,
  appUrl,
  unsubscribeUrl,
}: DigestNotificationProps): { html: string; text: string } {
  const periodText = digest.period === 'daily' ? 'Daily' : 'Weekly';
  const dateRange = `${formatDate(digest.startDate)} - ${formatDate(digest.endDate)}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${periodText} Doc Review Digest</title>
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
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      margin: -30px -30px 30px -30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      margin: 0;
      font-weight: 600;
    }
    .header .date-range {
      font-size: 14px;
      opacity: 0.9;
      margin-top: 5px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin: 30px 0;
    }
    .stat-card {
      background-color: #f9fafb;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
      border: 1px solid #e5e7eb;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #4f46e5;
    }
    .stat-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      margin-top: 5px;
    }
    .section {
      margin: 30px 0;
    }
    .section-header {
      display: flex;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e5e7eb;
    }
    .section-icon {
      font-size: 20px;
      margin-right: 10px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #1f2937;
    }
    .section-count {
      margin-left: auto;
      background-color: #4f46e5;
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
    }
    .activity-item {
      background-color: #f9fafb;
      border-left: 3px solid #4f46e5;
      padding: 12px 15px;
      margin: 10px 0;
      border-radius: 4px;
      transition: background-color 0.2s;
    }
    .activity-item:hover {
      background-color: #f3f4f6;
    }
    .activity-meta {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 5px;
    }
    .activity-content {
      color: #1f2937;
      margin: 5px 0;
    }
    .activity-link {
      color: #4f46e5;
      text-decoration: none;
      font-size: 14px;
    }
    .empty-state {
      text-align: center;
      padding: 20px;
      color: #6b7280;
      font-style: italic;
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
    .footer {
      margin-top: 40px;
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
      .header {
        margin: -20px -20px 20px -20px;
        padding: 20px;
      }
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 ${periodText} Doc Review Digest</h1>
      <div class="date-range">${dateRange}</div>
    </div>

    <p>Hi ${digest.user.name},</p>
    <p>Here's your ${periodText.toLowerCase()} summary of document review activity:</p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${digest.comments.length}</div>
        <div class="stat-label">Comments</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${digest.suggestions.length}</div>
        <div class="stat-label">Suggestions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${digest.documentsUpdated.length}</div>
        <div class="stat-label">Docs Updated</div>
      </div>
    </div>

    ${digest.comments.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">💬</span>
        <span class="section-title">Recent Comments</span>
        <span class="section-count">${digest.comments.length}</span>
      </div>
      ${digest.comments.slice(0, 5).map(comment => `
        <div class="activity-item">
          <div class="activity-meta">
            ${comment.user.name} • ${comment.document?.title || 'Document'}
          </div>
          <div class="activity-content">
            ${truncate(escapeHtml(comment.content), 150)}
          </div>
          <a href="${appUrl}/docs/${encodeURIComponent(comment.docPath)}#comment-${comment.id}" class="activity-link">
            View comment →
          </a>
        </div>
      `).join('')}
      ${digest.comments.length > 5 ? `
        <p style="text-align: center; margin-top: 15px;">
          <a href="${appUrl}/activity" style="color: #4f46e5;">View all ${digest.comments.length} comments →</a>
        </p>
      ` : ''}
    </div>
    ` : ''}

    ${digest.suggestions.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">💡</span>
        <span class="section-title">Recent Suggestions</span>
        <span class="section-count">${digest.suggestions.length}</span>
      </div>
      ${digest.suggestions.slice(0, 5).map(suggestion => `
        <div class="activity-item">
          <div class="activity-meta">
            ${suggestion.user.name} • ${suggestion.document?.title || 'Document'} • ${suggestion.status}
          </div>
          <div class="activity-content">
            ${suggestion.description ? truncate(escapeHtml(suggestion.description), 150) : 'Text change suggestion'}
          </div>
          <a href="${appUrl}/docs/${encodeURIComponent(suggestion.docPath)}#suggestion-${suggestion.id}" class="activity-link">
            View suggestion →
          </a>
        </div>
      `).join('')}
      ${digest.suggestions.length > 5 ? `
        <p style="text-align: center; margin-top: 15px;">
          <a href="${appUrl}/suggestions" style="color: #4f46e5;">View all ${digest.suggestions.length} suggestions →</a>
        </p>
      ` : ''}
    </div>
    ` : ''}

    ${digest.reviews.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">👀</span>
        <span class="section-title">Review Sessions</span>
        <span class="section-count">${digest.reviews.length}</span>
      </div>
      ${digest.reviews.map(review => `
        <div class="activity-item">
          <div class="activity-meta">
            ${review.owner.name} • ${review.status}
          </div>
          <div class="activity-content">
            <strong>${escapeHtml(review.title)}</strong><br>
            ${review.documents.length} documents
          </div>
          <a href="${appUrl}/reviews/${review.id}" class="activity-link">
            View session →
          </a>
        </div>
      `).join('')}
    </div>
    ` : ''}

    ${digest.documentsUpdated.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">📝</span>
        <span class="section-title">Documents Updated</span>
        <span class="section-count">${digest.documentsUpdated.length}</span>
      </div>
      ${digest.documentsUpdated.slice(0, 10).map(doc => `
        <div class="activity-item">
          <div class="activity-meta">
            ${doc.changeCount} change${doc.changeCount !== 1 ? 's' : ''}
          </div>
          <div class="activity-content">
            ${escapeHtml(doc.title)}
          </div>
          <a href="${appUrl}/docs/${encodeURIComponent(doc.path)}" class="activity-link">
            View document →
          </a>
        </div>
      `).join('')}
    </div>
    ` : ''}

    ${digest.comments.length === 0 && digest.suggestions.length === 0 && digest.reviews.length === 0 ? `
    <div class="empty-state">
      No activity during this period. Enjoy the quiet time! 🎉
    </div>
    ` : ''}

    <div style="text-align: center;">
      <a href="${appUrl}/dashboard" class="button">View Dashboard</a>
    </div>

    <div class="footer">
      <p>You're receiving this ${periodText.toLowerCase()} digest based on your notification preferences.</p>
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
${periodText} Doc Review Digest
${dateRange}

Hi ${digest.user.name},

Here's your ${periodText.toLowerCase()} summary of document review activity:

SUMMARY
-------
• ${digest.comments.length} Comments
• ${digest.suggestions.length} Suggestions
• ${digest.documentsUpdated.length} Documents Updated

${digest.comments.length > 0 ? `
RECENT COMMENTS
---------------
${digest.comments.slice(0, 5).map(comment => `
• ${comment.user.name} on "${comment.document?.title || 'Document'}":
  ${truncate(comment.content, 100)}
  View: ${appUrl}/docs/${encodeURIComponent(comment.docPath)}#comment-${comment.id}
`).join('\n')}
${digest.comments.length > 5 ? `\n...and ${digest.comments.length - 5} more comments` : ''}
` : ''}

${digest.suggestions.length > 0 ? `
RECENT SUGGESTIONS
------------------
${digest.suggestions.slice(0, 5).map(suggestion => `
• ${suggestion.user.name} on "${suggestion.document?.title || 'Document'}" (${suggestion.status}):
  ${suggestion.description || 'Text change suggestion'}
  View: ${appUrl}/docs/${encodeURIComponent(suggestion.docPath)}#suggestion-${suggestion.id}
`).join('\n')}
${digest.suggestions.length > 5 ? `\n...and ${digest.suggestions.length - 5} more suggestions` : ''}
` : ''}

${digest.reviews.length > 0 ? `
REVIEW SESSIONS
---------------
${digest.reviews.map(review => `
• ${review.title} by ${review.owner.name}
  ${review.documents.length} documents - Status: ${review.status}
  View: ${appUrl}/reviews/${review.id}
`).join('\n')}
` : ''}

${digest.documentsUpdated.length > 0 ? `
DOCUMENTS UPDATED
-----------------
${digest.documentsUpdated.slice(0, 10).map(doc => `
• ${doc.title} (${doc.changeCount} changes)
  View: ${appUrl}/docs/${encodeURIComponent(doc.path)}
`).join('\n')}
` : ''}

View Dashboard: ${appUrl}/dashboard

---
You're receiving this ${periodText.toLowerCase()} digest based on your notification preferences.
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
}