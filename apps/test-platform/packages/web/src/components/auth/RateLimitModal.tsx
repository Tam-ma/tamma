import { useEffect, useState } from 'react';

interface RateLimitModalProps {
  seconds: number;
  onClose: () => void;
}

export function RateLimitModal({ seconds, onClose }: RateLimitModalProps) {
  const [countdown, setCountdown] = useState(seconds);

  useEffect(() => {
    setCountdown(seconds);
  }, [seconds]);

  useEffect(() => {
    if (countdown <= 0) {
      onClose();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onClose]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const secsStr = String(secs).padStart(2, '0');
    return `${minutes}:${secsStr}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
        <div className="flex justify-center mb-4">
          <svg className="h-16 w-16 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Too Many Attempts
        </h2>

        <p className="text-gray-600 text-center mb-6">
          You've made too many registration attempts. Please wait before trying again.
        </p>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <p className="text-center">
            <span className="text-sm text-gray-600">Please wait</span>
            <br />
            <span className="text-3xl font-bold text-orange-600">
              {formatTime(countdown)}
            </span>
            <br />
            <span className="text-sm text-gray-600">before trying again</span>
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
          <p className="text-sm text-blue-800 text-center">
            This security measure helps protect our platform from abuse.
          </p>
        </div>

        <p className="text-sm text-gray-500 text-center">
          Need help?{' '}
          <a href="/support" className="text-primary-600 hover:text-primary-500 font-medium">
            Contact support
          </a>
        </p>

        <button
          onClick={onClose}
          className="mt-4 w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition-colors font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
