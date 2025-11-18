import { data as json, redirect } from 'react-router';
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, Form, useNavigation, useActionData } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { notificationPreferences, documentWatches } from '../lib/db/schema';
import { requireAuth } from '../lib/auth/session.server';
import { createEmailService } from '../lib/email/service.server';

interface LoaderData {
  preferences: {
    commentReplies: boolean;
    newComments: boolean;
    newSuggestions: boolean;
    suggestionStatus: boolean;
    reviewRequests: boolean;
    digestFrequency: 'none' | 'daily' | 'weekly';
  };
  watchedDocuments: Array<{
    id: string;
    docPath: string;
    createdAt: number;
  }>;
  testEmailSent?: boolean;
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const user = await requireAuth(request, context);
  const db = drizzle(context.env.DB);

  // Get user's notification preferences
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id))
    .limit(1);

  // Get watched documents
  const watches = await db
    .select()
    .from(documentWatches)
    .where(eq(documentWatches.userId, user.id));

  // Check if test email was sent (from query param)
  const url = new URL(request.url);
  const testEmailSent = url.searchParams.get('test') === 'sent';

  // Convert DB preferences to LoaderData format
  const preferences: LoaderData['preferences'] = prefs ? {
    commentReplies: prefs.commentReplies,
    newComments: prefs.newComments,
    newSuggestions: prefs.newSuggestions,
    suggestionStatus: prefs.suggestionStatus,
    reviewRequests: prefs.reviewRequests,
    digestFrequency: prefs.digestFrequency as 'none' | 'daily' | 'weekly',
  } : {
    commentReplies: true,
    newComments: true,
    newSuggestions: true,
    suggestionStatus: true,
    reviewRequests: true,
    digestFrequency: 'none' as const,
  };

  return json<LoaderData>({
    preferences,
    watchedDocuments: watches,
    testEmailSent,
  });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const user = await requireAuth(request, context);
  const db = drizzle(context.env.DB);
  const formData = await request.formData();
  const action = formData.get('_action');

  if (action === 'update_preferences') {
    const now = Date.now();
    const preferences = {
      userId: user.id,
      commentReplies: formData.get('commentReplies') === 'on',
      newComments: formData.get('newComments') === 'on',
      newSuggestions: formData.get('newSuggestions') === 'on',
      suggestionStatus: formData.get('suggestionStatus') === 'on',
      reviewRequests: formData.get('reviewRequests') === 'on',
      digestFrequency: formData.get('digestFrequency') as 'none' | 'daily' | 'weekly',
      createdAt: now,
      updatedAt: now,
    };

    // Upsert preferences
    await db
      .insert(notificationPreferences)
      .values(preferences)
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          commentReplies: preferences.commentReplies,
          newComments: preferences.newComments,
          newSuggestions: preferences.newSuggestions,
          suggestionStatus: preferences.suggestionStatus,
          reviewRequests: preferences.reviewRequests,
          digestFrequency: preferences.digestFrequency,
          updatedAt: now,
        },
      });

    return json({ success: true, message: 'Preferences updated successfully' });
  }

  if (action === 'test_email') {
    const emailService = createEmailService(context.env);

    await emailService.sendEmail({
      to: user.email,
      subject: 'Test Notification - Doc Review',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Test Email Notification</h2>
          <p>Hi ${user.name},</p>
          <p>This is a test email to verify your notification settings are working correctly.</p>
          <p>If you're seeing this, your email notifications are properly configured!</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px;">
            You're receiving this because you requested a test email from your notification settings.
          </p>
        </div>
      `,
      text: `Test Email Notification\n\nHi ${user.name},\n\nThis is a test email to verify your notification settings are working correctly.\n\nIf you're seeing this, your email notifications are properly configured!`,
    });

    return redirect('/settings/notifications?test=sent');
  }

  if (action === 'unwatch_document') {
    const watchId = formData.get('watchId') as string;
    await db
      .delete(documentWatches)
      .where(eq(documentWatches.id, watchId));

    return json({ success: true, message: 'Document unwatched' });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};

export default function NotificationSettings() {
  const { preferences, watchedDocuments, testEmailSent } = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Notification Settings</h1>

      {testEmailSent && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">Test email sent successfully! Check your inbox.</p>
        </div>
      )}

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

      <Form method="post" className="space-y-8">
        <input type="hidden" name="_action" value="update_preferences" />

        {/* Email Notifications */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Email Notifications</h2>

          <div className="space-y-4">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="commentReplies"
                defaultChecked={preferences.commentReplies}
                className="h-4 w-4 text-indigo-600 rounded"
              />
              <div>
                <span className="font-medium">Comment Replies</span>
                <p className="text-sm text-gray-600">Get notified when someone replies to your comments</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="newComments"
                defaultChecked={preferences.newComments}
                className="h-4 w-4 text-indigo-600 rounded"
              />
              <div>
                <span className="font-medium">New Comments</span>
                <p className="text-sm text-gray-600">Get notified about new comments on documents you watch</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="newSuggestions"
                defaultChecked={preferences.newSuggestions}
                className="h-4 w-4 text-indigo-600 rounded"
              />
              <div>
                <span className="font-medium">New Suggestions</span>
                <p className="text-sm text-gray-600">Get notified about new suggestions on your documents</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="suggestionStatus"
                defaultChecked={preferences.suggestionStatus}
                className="h-4 w-4 text-indigo-600 rounded"
              />
              <div>
                <span className="font-medium">Suggestion Status Updates</span>
                <p className="text-sm text-gray-600">Get notified when your suggestions are approved or rejected</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                name="reviewRequests"
                defaultChecked={preferences.reviewRequests}
                className="h-4 w-4 text-indigo-600 rounded"
              />
              <div>
                <span className="font-medium">Review Requests</span>
                <p className="text-sm text-gray-600">Get notified when you're assigned as a reviewer</p>
              </div>
            </label>
          </div>
        </div>

        {/* Digest Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Activity Digest</h2>

          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input
                type="radio"
                name="digestFrequency"
                value="none"
                defaultChecked={preferences.digestFrequency === 'none'}
                className="h-4 w-4 text-indigo-600"
              />
              <span>No digest emails</span>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="radio"
                name="digestFrequency"
                value="daily"
                defaultChecked={preferences.digestFrequency === 'daily'}
                className="h-4 w-4 text-indigo-600"
              />
              <span>Daily digest (sent at 9 AM)</span>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="radio"
                name="digestFrequency"
                value="weekly"
                defaultChecked={preferences.digestFrequency === 'weekly'}
                className="h-4 w-4 text-indigo-600"
              />
              <span>Weekly digest (sent on Mondays at 9 AM)</span>
            </label>
          </div>
        </div>

        <div className="flex space-x-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </Form>

      {/* Test Email */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Test Notifications</h2>
        <p className="text-gray-600 mb-4">
          Send a test email to verify your notification settings are working correctly.
        </p>
        <Form method="post">
          <input type="hidden" name="_action" value="test_email" />
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
          >
            Send Test Email
          </button>
        </Form>
      </div>

      {/* Watched Documents */}
      {watchedDocuments.length > 0 && (
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Watched Documents</h2>
          <p className="text-gray-600 mb-4">
            You'll receive notifications for activity on these documents:
          </p>
          <div className="space-y-2">
            {watchedDocuments.map((watch) => (
              <div key={watch.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="font-mono text-sm">{watch.docPath}</span>
                <Form method="post" className="inline">
                  <input type="hidden" name="_action" value="unwatch_document" />
                  <input type="hidden" name="watchId" value={watch.id} />
                  <button
                    type="submit"
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Unwatch
                  </button>
                </Form>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}