'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, Mail, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

import { passwordService } from '@/services/password.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const RESEND_COOLDOWN = 60;

function maskEmail(email: string): string {
  if (!email) return '';
  const parts = email.split('@');
  const username = parts[0];
  const domain = parts[1];
  if (!username || !domain) return email;
  const len = username.length;
  if (len <= 2) return email;
  const masked = username[0] + '*'.repeat(len - 2) + username[len - 1];
  return masked + '@' + domain;
}

export default function ResetPasswordSentPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams?.get('email') || '';
  
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (!email) {
      router.push('/auth/forgot-password');
    }
  }, [email, router]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0 || !email) return;
    
    setIsResending(true);
    setResendError(null);
    setResendSuccess(false);

    try {
      await passwordService.requestReset(email);
      setResendSuccess(true);
      setResendCooldown(RESEND_COOLDOWN);
    } catch (error) {
      setResendError(getErrorMessage(error));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', duration: 0.5 }}
              className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4"
            >
              <CheckCircle className="h-12 w-12 text-green-600" />
            </motion.div>
            
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h1>
            
            <p className="text-gray-600 mb-4">
              We have sent a password reset link to
            </p>
            
            <p className="font-medium text-gray-900 mb-6">{maskEmail(email)}</p>
            
            <div className="p-4 bg-blue-50 rounded-lg mb-6 text-left">
              <div className="flex gap-3">
                <Mail className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">What to do next:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Check your inbox for an email from us</li>
                    <li>Click the reset password link in the email</li>
                    <li>The link will expire in 1 hour for security</li>
                    <li>Check your spam folder if you do not see it</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm text-gray-600">
                Did not receive the email?
              </div>
              
              {resendSuccess && (
                <div
                  className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm"
                  role="status"
                >
                  Email sent successfully! Check your inbox.
                </div>
              )}
              
              {resendError && (
                <div
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm"
                  role="alert"
                >
                  {resendError}
                </div>
              )}

              <Button
                variant="outline"
                fullWidth
                onClick={handleResend}
                disabled={resendCooldown > 0 || isResending}
                loading={isResending}
              >
                {resendCooldown > 0 
                  ? `Resend link (${resendCooldown}s)` 
                  : 'Resend reset link'}
              </Button>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <Link
              href="/auth/login"
              className="flex items-center justify-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Return to sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
