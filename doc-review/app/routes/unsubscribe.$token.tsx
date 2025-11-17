import { json, redirect, type LoaderFunction, type ActionFunction } from '@react-router/cloudflare';
import { useLoaderData, Form, useNavigation } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { notificationPreferences, users } from '../lib/db/schema';
import { verifyUnsubscribeToken } from '../lib/auth/tokens.server';

interface LoaderData {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  preferences?: {
    commentReplies: boolean;
    newComments: boolean;
    newSuggestions: boolean;
    suggestionStatus: boolean;
    reviewRequests: boolean;
    digestFrequency: string;
  };
  error?: string;
}

export const loader: LoaderFunction = async ({ params, context }) => {
  const token = params.token;

  if (!token) {
    return json<LoaderData>({
      valid: false,
      error: 'Invalid unsubscribe link',
    });
  }

  // Verify the token
  const { userId, valid } = await verifyUnsubscribeToken(token);

  if (!valid || !userId) {
    return json<LoaderData>({
      valid: false,
      error: 'Invalid or expired unsubscribe link',
    });
  }

  const db = drizzle(context.env.DB);

  // Get user info
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return json<LoaderData>({
      valid: false,
      error: 'User not found',
    });
  }

  // Get current preferences
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  return json<LoaderData>({
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    preferences: prefs || {
      commentReplies: true,
      newComments: true,
      newSuggestions: true,
      suggestionStatus: true,
      reviewRequests: true,
      digestFrequency: 'none',
    },
  });
};

export const action: ActionFunction = async ({ params, request, context }) => {
  const token = params.token;

  if (!token) {
    return json({ error: 'Invalid unsubscribe link' }, { status: 400 });
  }

  const { userId, valid } = await verifyUnsubscribeToken(token);

  if (!valid || !userId) {
    return json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 });
  }

  const db = drizzle(context.env.DB);
  const formData = await request.formData();
  const action = formData.get('_action');

  if (action === 'unsubscribe_all') {
    // Disable all notifications
    const now = Date.now();
    await db
      .insert(notificationPreferences)
      .values({
        userId,
        commentReplies: false,
        newComments: false,
        newSuggestions: false,
        suggestionStatus: false,
        reviewRequests: false,
        digestFrequency: 'none',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          commentReplies: false,
          newComments: false,
          newSuggestions: false,
          suggestionStatus: false,
          reviewRequests: false,
          digestFrequency: 'none',
          updatedAt: now,
        },
      });

    return redirect('/unsubscribe/success');
  }

  if (action === 'update_preferences') {
    // Update specific preferences
    const now = Date.now();
    const preferences = {
      userId,
      commentReplies: formData.get('commentReplies') === 'on',
      newComments: formData.get('newComments') === 'on',
      newSuggestions: formData.get('newSuggestions') === 'on',
      suggestionStatus: formData.get('suggestionStatus') === 'on',
      reviewRequests: formData.get('reviewRequests') === 'on',
      digestFrequency: formData.get('digestFrequency') as string || 'none',
      createdAt: now,
      updatedAt: now,
    };

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

    return redirect('/unsubscribe/success?partial=true');
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};

export default function UnsubscribePage() {
  const { valid, user, preferences, error } = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  if (!valid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Unsubscribe Link</h1>
          <p className="text-gray-600 mb-6">{error || 'This unsubscribe link is invalid or has expired.'}</p>
          <a
            href="/"
            className="inline-block px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Go to Homepage
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="text-indigo-600 text-5xl mb-4">📧</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Manage Email Notifications</h1>
          <p className="text-gray-600">
            {user?.email}
          </p>
        </div>

        <div className="space-y-6">
          {/* Quick unsubscribe option */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">Unsubscribe from All Emails</h2>
            <p className="text-red-700 mb-4">
              Click below to stop receiving all email notifications from Doc Review.
            </p>
            <Form method="post">
              <input type="hidden" name="_action" value="unsubscribe_all" />
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Unsubscribe from All'}
              </button>
            </Form>
          </div>

          <div className="border-t pt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Or Choose What to Receive</h2>

            <Form method="post" className="space-y-4">
              <input type="hidden" name="_action" value="update_preferences" />

              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="commentReplies"
                    defaultChecked={preferences?.commentReplies}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <div>
                    <span className="font-medium">Comment Replies</span>
                    <p className="text-sm text-gray-600">Notifications when someone replies to your comments</p>
                  </div>
                </label>

                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="newComments"
                    defaultChecked={preferences?.newComments}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <div>
                    <span className="font-medium">New Comments</span>
                    <p className="text-sm text-gray-600">Notifications about new comments on documents you watch</p>
                  </div>
                </label>

                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="newSuggestions"
                    defaultChecked={preferences?.newSuggestions}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <div>
                    <span className="font-medium">New Suggestions</span>
                    <p className="text-sm text-gray-600">Notifications about new suggestions on your documents</p>
                  </div>
                </label>

                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="suggestionStatus"
                    defaultChecked={preferences?.suggestionStatus}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <div>
                    <span className="font-medium">Suggestion Updates</span>
                    <p className="text-sm text-gray-600">Notifications when your suggestions are approved or rejected</p>
                  </div>
                </label>

                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="reviewRequests"
                    defaultChecked={preferences?.reviewRequests}
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <div>
                    <span className="font-medium">Review Requests</span>
                    <p className="text-sm text-gray-600">Notifications when you're assigned as a reviewer</p>
                  </div>
                </label>
              </div>

              <div className="border-t pt-4">
                <label className="block mb-3">
                  <span className="font-medium">Activity Digest Frequency</span>
                  <select
                    name="digestFrequency"
                    defaultValue={preferences?.digestFrequency || 'none'}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="none">No digest emails</option>
                    <option value="daily">Daily digest</option>
                    <option value="weekly">Weekly digest</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Update Preferences'}
              </button>
            </Form>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t text-center text-sm text-gray-600">
          <p>
            Need help? <a href="/contact" className="text-indigo-600 hover:underline">Contact support</a>
          </p>
        </div>
      </div>
    </div>
  );
}