'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail } from 'lucide-react';
import Link from 'next/link';

import { forgotPasswordSchema, type ForgotPasswordInput } from '@/schemas/password.schema';
import { passwordService } from '@/services/password.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await passwordService.requestReset(data.email);
      
      // Redirect to confirmation page with email (for display)
      const emailParam = encodeURIComponent(data.email);
      router.push(`/auth/reset-password-sent?email=${emailParam}`);
    } catch (error) {
      // Generic error message for security (prevent email enumeration)
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Mail className="h-8 w-8 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
            <p className="mt-2 text-sm text-gray-600">
              No worries! Enter your email address and we will send you a link to reset your password.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              {...register('email')}
              type="email"
              label="Email address"
              placeholder="Enter your email address"
              error={errors.email?.message}
              autoComplete="email"
              autoFocus
            />

            {submitError && (
              <div
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm"
                role="alert"
              >
                {submitError}
              </div>
            )}

            <Button type="submit" fullWidth loading={isSubmitting}>
              Send Reset Link
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <Link
              href="/auth/login"
              className="flex items-center justify-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Return to sign in
            </Link>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>Security note:</strong> For your security, we will send the reset link only if this email is registered with us. The link will expire in 1 hour.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
