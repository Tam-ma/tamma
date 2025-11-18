'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { tokenService } from '@/lib/services/token.service';

interface SessionWarningModalProps {
  onStaySignedIn: () => void;
  onSignOut: () => void;
}

export const SessionWarningModal: React.FC<SessionWarningModalProps> = ({
  onStaySignedIn,
  onSignOut,
}) => {
  const { accessToken } = useAuth();
  const [show, setShow] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(5);

  useEffect(() => {
    if (!accessToken) return;

    // Check token expiration every second
    const interval = setInterval(() => {
      const timeLeft = tokenService.getTimeUntilExpiration(accessToken);
      const minutesRemaining = Math.ceil(timeLeft / 60000); // Convert ms to minutes

      // Show warning 5 minutes before expiration
      if (minutesRemaining <= 5 && minutesRemaining > 0) {
        setShow(true);
        setMinutesLeft(minutesRemaining);
      } else if (minutesRemaining <= 0) {
        setShow(false);
        clearInterval(interval);
      } else {
        setShow(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [accessToken]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg
              className="h-6 w-6 text-yellow-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3
              className="text-lg font-medium text-gray-900"
              id="session-warning-title"
            >
              Session Expiring Soon
            </h3>
            <div className="mt-2 text-sm text-gray-500">
              <p>
                Your session will expire in{' '}
                <span className="font-semibold text-gray-900">
                  {minutesLeft} {minutesLeft === 1 ? 'minute' : 'minutes'}
                </span>
                . Would you like to stay signed in?
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => {
              setShow(false);
              onSignOut();
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
          >
            Sign Out
          </button>
          <button
            onClick={() => {
              setShow(false);
              onStaySignedIn();
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            type="button"
            autoFocus
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  );
};
