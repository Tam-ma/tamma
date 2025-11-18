'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, CheckCircle, AlertCircle } from 'lucide-react';

import { changePasswordSchema, type ChangePasswordInput } from '@/schemas/password.schema';
import { passwordService } from '@/services/password.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { PasswordRequirementsChecklist } from '@/components/auth/PasswordRequirementsChecklist';

export default function ChangePasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isValid },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onChange',
  });

  const password = watch('password', '');

  const onSubmit = async (data: ChangePasswordInput) => {
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      await passwordService.changePassword(data.currentPassword, data.password);
      setSubmitSuccess(true);
      reset();

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setSubmitSuccess(false);
      }, 5000);
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Change Password</h1>
          <p className="text-gray-600">
            Update your password to keep your account secure
          </p>
        </div>

        <Card>
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 bg-primary-100 rounded-full">
                <Lock className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Password Settings</h2>
                <p className="text-sm text-gray-600">
                  Choose a strong, unique password
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <Input
                {...register('currentPassword')}
                type="password"
                label="Current password"
                placeholder="Enter your current password"
                error={errors.currentPassword?.message}
                autoComplete="current-password"
              />

              <div className="pt-4 border-t border-gray-200">
                <Input
                  {...register('password')}
                  type="password"
                  label="New password"
                  placeholder="Enter new password"
                  error={errors.password?.message}
                  autoComplete="new-password"
                />

                <div className="mt-3">
                  <PasswordStrengthMeter password={password} />
                </div>
              </div>

              <Input
                {...register('confirmPassword')}
                type="password"
                label="Confirm new password"
                placeholder="Confirm new password"
                error={errors.confirmPassword?.message}
                autoComplete="new-password"
              />

              <PasswordRequirementsChecklist password={password} />
            </div>

            {submitSuccess && (
              <div
                className="p-4 rounded-lg bg-green-50 border border-green-200 flex gap-3"
                role="status"
              >
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-green-900">Password changed successfully!</p>
                  <p className="text-sm text-green-800 mt-1">
                    Your password has been updated. Use your new password the next time you sign in.
                  </p>
                </div>
              </div>
            )}

            {submitError && (
              <div
                className="p-4 rounded-lg bg-red-50 border border-red-200 flex gap-3"
                role="alert"
              >
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-900">Failed to change password</p>
                  <p className="text-sm text-red-800 mt-1">{submitError}</p>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button type="submit" loading={isSubmitting} disabled={!isValid}>
                Change Password
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                  setSubmitError(null);
                  setSubmitSuccess(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="text-sm font-medium text-blue-900 mb-2">Security tips:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>Use a unique password that you do not use on other websites</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>Consider using a password manager to generate and store passwords</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>Enable two-factor authentication for additional security</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>Change your password regularly, especially if you suspect it has been compromised</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
