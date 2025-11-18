'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, AlertCircle } from 'lucide-react';

import { resetPasswordSchema, type ResetPasswordInput } from '@/schemas/password.schema';
import { passwordService } from '@/services/password.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { PasswordRequirementsChecklist } from '@/components/auth/PasswordRequirementsChecklist';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isValidatingToken, setIsValidatingToken] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onChange',
  });

  const password = watch('password', '');

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        router.push('/auth/reset-error');
        return;
      }

      setIsValidatingToken(true);
      try {
        const result = await passwordService.validateToken(token);
        if (!result.valid) {
          router.push('/auth/reset-error');
        } else {
          setIsTokenValid(true);
        }
      } catch {
        router.push('/auth/reset-error');
      } finally {
        setIsValidatingToken(false);
      }
    };

    validateToken();
  }, [token, router]);

  const onSubmit = async (data: ResetPasswordInput) => {
    if (!token) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await passwordService.resetPassword(token, data.password);
      router.push('/auth/reset-success');
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('expired') || message.includes('invalid')) {
        router.push('/auth/reset-error');
      } else {
        setSubmitError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isValidatingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <div className="py-8">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-600 border-t-transparent mb-4" />
            <p className="text-gray-600">Validating reset link...</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!isTokenValid) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Lock className="h-8 w-8 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
            <p className="mt-2 text-sm text-gray-600">
              Enter a new password for your account
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              {...register('password')}
              type="password"
              label="New password"
              placeholder="Enter new password"
              error={errors.password?.message}
              autoComplete="new-password"
              autoFocus
            />

            <PasswordStrengthMeter password={password} />

            <Input
              {...register('confirmPassword')}
              type="password"
              label="Confirm password"
              placeholder="Confirm new password"
              error={errors.confirmPassword?.message}
              autoComplete="new-password"
            />

            <PasswordRequirementsChecklist password={password} />

            {submitError && (
              <div
                className="p-3 rounded-lg bg-red-50 border border-red-200 flex gap-3"
                role="alert"
              >
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">{submitError}</div>
              </div>
            )}

            <Button type="submit" fullWidth loading={isSubmitting} disabled={!isValid}>
              Reset Password
            </Button>
          </form>

          <div className="mt-6 p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>Password security tips:</strong> Use a unique password that you do not use
              on other websites. Consider using a password manager to generate and store strong
              passwords.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
