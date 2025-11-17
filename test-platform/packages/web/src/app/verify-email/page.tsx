'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authService } from '@/services/auth.service';

const backgroundImages = [
  '/background/1.png',
  '/background/2.png',
  '/background/3.jpeg',
  '/background/4.jpeg',
  '/background/5.jpeg',
  '/background/6.jpeg',
  '/background/7.png',
  '/background/8.png',
  '/background/9.png',
  '/background/10.png',
];

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'waiting'>('loading');
  const [message, setMessage] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [backgroundImage] = useState(() => backgroundImages[Math.floor(Math.random() * backgroundImages.length)]);

  const token = searchParams.get('token');
  const email = searchParams.get('email');

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    } else if (email) {
      // User has email but no token - they need to check their email
      setStatus('waiting');
      setMessage('Please check your email for the verification link.');
    } else {
      setStatus('error');
      setMessage('Invalid verification link. Please check your email for the correct link.');
    }
  }, [token, email]);

  const verifyEmail = async (verificationToken: string) => {
    try {
      setStatus('loading');
      await authService.verifyEmail(verificationToken);

      setStatus('success');
      setMessage('Your email has been successfully verified!');

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login?verified=true');
      }, 3000);
    } catch (error: any) {
      setStatus('error');
      setMessage(
        error.response?.data?.message ||
        'Email verification failed. The link may have expired.'
      );
    }
  };

  const handleResendVerification = async () => {
    if (!email) {
      setResendMessage('Email address is required to resend verification.');
      return;
    }

    setIsResending(true);
    setResendMessage('');

    try {
      await authService.resendVerification(email);
      setResendMessage('Verification email sent! Please check your inbox.');
    } catch (error: any) {
      setResendMessage(
        error.response?.data?.message ||
        'Failed to resend verification email. Please try again.'
      );
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        position: 'relative'
      }}
    >
      {/* Dark overlay for better readability */}
      <div className="absolute inset-0 bg-black/40" style={{ zIndex: 0 }} />

      <div className="relative z-10">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo/Branding */}
        <div className="flex justify-center">
          <img
            src="/logo.png"
            alt="Logo"
            className="h-32 w-32 object-contain"
          />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Email Verification
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white/60 backdrop-blur-sm py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Loading State */}
          {status === 'loading' && (
            <div className="text-center">
              <svg
                className="animate-spin h-12 w-12 text-primary-600 mx-auto"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="mt-4 text-sm text-gray-600">
                Verifying your email...
              </p>
            </div>
          )}

          {/* Success State */}
          {status === 'success' && (
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                Email Verified Successfully!
              </h3>
              <p className="mt-2 text-sm text-gray-600">{message}</p>
              <p className="mt-2 text-sm text-gray-500">
                Redirecting you to login...
              </p>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && (
            <div>
              <div className="text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  Verification Failed
                </h3>
                <p className="mt-2 text-sm text-gray-600">{message}</p>
              </div>

              {/* Resend Verification */}
              {email && (
                <div className="mt-6">
                  <button
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isResending ? (
                      <>
                        <svg
                          className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      'Resend Verification Email'
                    )}
                  </button>

                  {resendMessage && (
                    <p
                      className={`mt-2 text-sm text-center ${
                        resendMessage.includes('sent')
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {resendMessage}
                    </p>
                  )}
                </div>
              )}

              {/* Back to Login */}
              <div className="mt-6 text-center">
                <a
                  href="/login"
                  className="font-medium text-primary-600 hover:text-primary-500"
                >
                  Return to Login
                </a>
              </div>
            </div>
          )}

          {/* Waiting for Verification (no token) */}
          {status === 'waiting' && (
            <div>
              <div className="text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
                  <svg
                    className="h-6 w-6 text-blue-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  Check Your Email
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  We've sent a verification link to <strong>{email}</strong>.
                  Please check your inbox and click the link to verify your email address.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Didn't receive the email? Check your spam folder or click below to resend.
                </p>
              </div>

              {/* Resend Verification Button */}
              <div className="mt-6">
                <button
                  onClick={handleResendVerification}
                  disabled={isResending}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResending ? (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    'Resend Verification Email'
                  )}
                </button>

                {resendMessage && (
                  <p
                    className={`mt-2 text-sm text-center ${
                      resendMessage.includes('sent')
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {resendMessage}
                  </p>
                )}
              </div>

              {/* Back to Login */}
              <div className="mt-6 text-center">
                <a
                  href="/login"
                  className="font-medium text-primary-600 hover:text-primary-500"
                >
                  Return to Login
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
