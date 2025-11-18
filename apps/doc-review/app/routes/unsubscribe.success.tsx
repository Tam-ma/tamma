import { useSearchParams } from 'react-router';

export default function UnsubscribeSuccess() {
  const [searchParams] = useSearchParams();
  const isPartial = searchParams.get('partial') === 'true';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="text-green-600 text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {isPartial ? 'Preferences Updated' : 'Unsubscribed Successfully'}
        </h1>
        <p className="text-gray-600 mb-6">
          {isPartial
            ? 'Your email notification preferences have been updated.'
            : 'You have been unsubscribed from all email notifications.'}
        </p>

        <div className="space-y-3">
          <a
            href="/"
            className="block px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Go to Homepage
          </a>

          {!isPartial && (
            <p className="text-sm text-gray-500">
              Changed your mind? You can re-enable notifications in your{' '}
              <a href="/settings/notifications" className="text-indigo-600 hover:underline">
                account settings
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}