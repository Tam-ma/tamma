import { json, type LoaderFunction, type ActionFunction } from '@react-router/cloudflare';
import { useLoaderData, Form, useNavigation, useActionData } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and, gte } from 'drizzle-orm';
import { emailQueue, emailLog } from '../lib/db/schema';
import { requireAuth } from '../lib/auth/session.server';
import { processEmailQueue, retryFailedEmails, getQueueStats, cleanupOldEmails } from '../lib/email/queue.server';

interface LoaderData {
  stats: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    total: number;
  };
  recentEmails: Array<{
    id: string;
    toEmail: string;
    subject: string;
    type: string;
    status: string;
    attempts: number;
    error?: string | null;
    createdAt: number;
    sentAt?: number | null;
  }>;
  sentToday: number;
  sentThisWeek: number;
  sentThisMonth: number;
  user: {
    role: string;
  };
}

export const loader: LoaderFunction = async ({ request, context }) => {
  const user = await requireAuth(request, context);

  // Check if user is admin
  if (user.role !== 'admin') {
    throw new Response('Unauthorized', { status: 403 });
  }

  const db = drizzle(context.env.DB);

  // Get queue statistics
  const stats = await getQueueStats(context.env.DB);

  // Get recent emails
  const recentEmails = await db
    .select({
      id: emailQueue.id,
      toEmail: emailQueue.toEmail,
      subject: emailQueue.subject,
      type: emailQueue.type,
      status: emailQueue.status,
      attempts: emailQueue.attempts,
      error: emailQueue.error,
      createdAt: emailQueue.createdAt,
      sentAt: emailQueue.sentAt,
    })
    .from(emailQueue)
    .orderBy(desc(emailQueue.createdAt))
    .limit(50);

  // Calculate sent statistics
  const now = Date.now();
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now - 7 * 24 * 60 * 60 * 1000).getTime();
  const startOfMonth = new Date(now - 30 * 24 * 60 * 60 * 1000).getTime();

  const sentToday = await db
    .select()
    .from(emailLog)
    .where(gte(emailLog.sentAt, startOfDay));

  const sentThisWeek = await db
    .select()
    .from(emailLog)
    .where(gte(emailLog.sentAt, startOfWeek));

  const sentThisMonth = await db
    .select()
    .from(emailLog)
    .where(gte(emailLog.sentAt, startOfMonth));

  return json<LoaderData>({
    stats,
    recentEmails,
    sentToday: sentToday.length,
    sentThisWeek: sentThisWeek.length,
    sentThisMonth: sentThisMonth.length,
    user: {
      role: user.role,
    },
  });
};

export const action: ActionFunction = async ({ request, context }) => {
  const user = await requireAuth(request, context);

  // Check if user is admin
  if (user.role !== 'admin') {
    throw new Response('Unauthorized', { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get('_action');

  if (action === 'process_queue') {
    const result = await processEmailQueue(context.env.DB, context.env);
    return json({
      success: true,
      message: `Processed ${result.processed} emails, ${result.failed} failed`,
    });
  }

  if (action === 'retry_failed') {
    const result = await retryFailedEmails(context.env.DB, context.env);
    return json({
      success: true,
      message: `Retrying ${result.retried} failed emails`,
    });
  }

  if (action === 'cleanup_old') {
    const result = await cleanupOldEmails(context.env.DB);
    return json({
      success: true,
      message: `Cleaned up ${result.deleted} old emails`,
    });
  }

  if (action === 'resend_email') {
    const emailId = formData.get('emailId') as string;
    const db = drizzle(context.env.DB);

    // Reset email status to pending for retry
    await db
      .update(emailQueue)
      .set({
        status: 'pending',
        attempts: 0,
        error: null,
        failedAt: null,
      })
      .where(eq(emailQueue.id, emailId));

    return json({
      success: true,
      message: 'Email queued for resending',
    });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};

export default function AdminEmails() {
  const { stats, recentEmails, sentToday, sentThisWeek, sentThisMonth } = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
  const isSubmitting = navigation.state === 'submitting';

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-green-600 bg-green-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'pending':
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Email Admin Dashboard</h1>

      {actionData?.success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">{actionData.message}</p>
        </div>
      )}

      {actionData?.error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">{actionData.error}</p>
        </div>
      )}

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-2xl font-bold text-gray-900">{stats.pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-2xl font-bold text-blue-600">{stats.processing}</div>
          <div className="text-sm text-gray-600">Processing</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
          <div className="text-sm text-gray-600">Sent</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          <div className="text-sm text-gray-600">Failed</div>
        </div>
      </div>

      {/* Send Statistics */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Send Statistics</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-lg font-semibold">{sentToday}</div>
            <div className="text-sm text-gray-600">Sent Today</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{sentThisWeek}</div>
            <div className="text-sm text-gray-600">Sent This Week</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{sentThisMonth}</div>
            <div className="text-sm text-gray-600">Sent This Month</div>
          </div>
        </div>
      </div>

      {/* Queue Actions */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Queue Actions</h2>
        <div className="flex flex-wrap gap-4">
          <Form method="post" className="inline">
            <input type="hidden" name="_action" value="process_queue" />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              Process Queue Now
            </button>
          </Form>

          <Form method="post" className="inline">
            <input type="hidden" name="_action" value="retry_failed" />
            <button
              type="submit"
              disabled={isSubmitting || stats.failed === 0}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              Retry Failed Emails
            </button>
          </Form>

          <Form method="post" className="inline">
            <input type="hidden" name="_action" value="cleanup_old" />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              Cleanup Old Emails (30+ days)
            </button>
          </Form>
        </div>
      </div>

      {/* Recent Emails Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Recent Emails</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  To
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attempts
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentEmails.map((email) => (
                <tr key={email.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {email.toEmail}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="max-w-xs truncate" title={email.subject}>
                      {email.subject}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {email.type.replace('_', ' ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(email.status)}`}>
                      {email.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {email.attempts}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(email.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {(email.status === 'failed' || email.status === 'pending') && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="_action" value="resend_email" />
                        <input type="hidden" name="emailId" value={email.id} />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
                        >
                          Resend
                        </button>
                      </Form>
                    )}
                    {email.error && (
                      <span className="ml-2 text-red-600" title={email.error}>
                        ⚠️
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}