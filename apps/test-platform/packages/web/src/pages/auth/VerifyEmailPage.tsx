import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/types/auth';

type VerificationState = 'loading' | 'success' | 'already_verified' | 'expired' | 'error';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<VerificationState>('loading');
  const [countdown, setCountdown] = useState(5);
  const [email, setEmail] = useState<string>('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const token = searchParams.get('token');
  const sent = searchParams.get('sent');

  useEffect(() => {
    if (sent === 'true') {
      setState('success');
      return;
    }

    if (!token) {
      setState('error');
      return;
    }

    verifyEmail(token);
  }, [token, sent]);

  useEffect(() => {
    if (state === 'success' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }

    if (state === 'success' && countdown === 0) {
      navigate('/login?verified=true');
    }
  }, [state, countdown, navigate]);

  const verifyEmail = async (verificationToken: string) => {
    try {
      const response = await authService.verifyEmail(verificationToken);
      
      if (response.alreadyVerified) {
        setState('already_verified');
      } else {
        setState('success');
      }
    } catch (err) {
      const apiError = err as ApiError;
      
      if (apiError.message.toLowerCase().includes('expired')) {
        setState('expired');
      } else {
        setState('error');
      }
    }
  };

  const handleResendVerification = async () => {
    if (!email) return;

    setResendLoading(true);
    try {
      await authService.resendVerification(email);
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 5000);
    } catch (err) {
      const apiError = err as ApiError;
      alert(apiError.message || 'Failed to resend verification email');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          {state === 'loading' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="animate-spin h-12 w-12 text-primary-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Verifying your email...
              </h1>
              <p className="text-gray-600">
                Please wait while we verify your email address
              </p>
            </>
          )}

          {state === 'success' && sent === 'true' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="h-16 w-16 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Check your email
              </h1>
              <p className="text-gray-600 mb-6">
                We've sent a verification link to your email address.
                Please check your inbox and click the link to verify your account.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <p className="text-sm text-blue-800">
                  Didn't receive the email? Check your spam folder or{' '}
                  <button
                    onClick={() => {}}
                    className="font-medium underline hover:no-underline"
                  >
                    resend verification email
                  </button>
                </p>
              </div>
            </>
          )}

          {state === 'success' && sent !== 'true' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="h-16 w-16 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Email verified successfully!
              </h1>
              <p className="text-gray-600 mb-4">
                Your email has been verified. Redirecting to login...
              </p>
              <p className="text-sm text-gray-500">
                Redirecting in {countdown} seconds
              </p>
            </>
          )}

          {state === 'already_verified' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="h-16 w-16 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Already verified
              </h1>
              <p className="text-gray-600 mb-6">
                This email has already been verified. You can now sign in to your account.
              </p>
              <a
                href="/login"
                className="inline-block bg-primary-600 text-white px-6 py-3 rounded-md font-medium hover:bg-primary-700 transition-colors"
              >
                Go to Login
              </a>
            </>
          )}

          {state === 'expired' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="h-16 w-16 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Verification link expired
              </h1>
              <p className="text-gray-600 mb-6">
                This verification link has expired or is invalid. Please request a new verification email.
              </p>
              
              {resendSuccess ? (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
                  Verification email sent! Please check your inbox.
                </div>
              ) : (
                <div className="space-y-4">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    onClick={handleResendVerification}
                    disabled={!email || resendLoading}
                    className="w-full bg-primary-600 text-white px-6 py-3 rounded-md font-medium hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {resendLoading ? 'Sending...' : 'Resend Verification Email'}
                  </button>
                </div>
              )}
            </>
          )}

          {state === 'error' && (
            <>
              <div className="flex justify-center mb-4">
                <svg className="h-16 w-16 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Verification failed
              </h1>
              <p className="text-gray-600 mb-6">
                We couldn't verify your email address. The link may be invalid or expired.
              </p>
              <a
                href="/register"
                className="inline-block bg-primary-600 text-white px-6 py-3 rounded-md font-medium hover:bg-primary-700 transition-colors"
              >
                Back to Registration
              </a>
            </>
          )}
        </div>

        {(state === 'success' || state === 'already_verified') && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Having trouble? <a href="/support" className="text-primary-600 hover:text-primary-500">Contact support</a>
          </p>
        )}
      </div>
    </div>
  );
}
