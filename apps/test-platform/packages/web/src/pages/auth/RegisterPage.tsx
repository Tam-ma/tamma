import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { registerSchema, RegisterFormData } from '@/schemas/auth.schema';
import { authService } from '@/services/auth.service';
import { FormField } from '@/components/form/FormField';
import { PasswordInput } from '@/components/form/PasswordInput';
import { PasswordStrengthMeter } from '@/components/form/PasswordStrengthMeter';
import { RateLimitModal } from '@/components/auth/RateLimitModal';
import { ApiError } from '@/types/auth';
import clsx from 'clsx';

export function RegisterPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
  });

  const password = watch('password');

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const { email, password, firstName, lastName } = data;
      await authService.register({
        email,
        password,
        firstName,
        lastName,
      });

      navigate('/verify-email?sent=true');
    } catch (err) {
      const apiError = err as ApiError;
      
      if (apiError.retryAfter) {
        setRateLimitSeconds(apiError.retryAfter);
      } else {
        setError(apiError.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900">Create Account</h1>
            <p className="mt-2 text-gray-600">
              Get started with your free account
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
                {error}
              </div>
            )}

            <FormField
              label="Email Address"
              error={errors.email?.message}
              required
              htmlFor="email"
            >
              <input
                id="email"
                type="email"
                {...register('email')}
                placeholder="Enter your email address"
                className={clsx(
                  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500',
                  errors.email ? 'border-red-500' : 'border-gray-300'
                )}
                aria-invalid={errors.email ? 'true' : 'false'}
              />
            </FormField>

            <FormField
              label="Full Name"
              error={errors.firstName?.message || errors.lastName?.message}
              htmlFor="firstName"
            >
              <div className="flex gap-2">
                <input
                  id="firstName"
                  type="text"
                  {...register('firstName')}
                  placeholder="First name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <input
                  id="lastName"
                  type="text"
                  {...register('lastName')}
                  placeholder="Last name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </FormField>

            <FormField
              label="Password"
              error={errors.password?.message}
              required
              htmlFor="password"
            >
              <PasswordInput
                id="password"
                {...register('password')}
                placeholder="Create a strong password"
                error={!!errors.password}
                aria-invalid={errors.password ? 'true' : 'false'}
              />
              <PasswordStrengthMeter password={password || ''} />
            </FormField>

            <FormField
              label="Confirm Password"
              error={errors.confirmPassword?.message}
              required
              htmlFor="confirmPassword"
            >
              <PasswordInput
                id="confirmPassword"
                {...register('confirmPassword')}
                placeholder="Confirm your password"
                error={!!errors.confirmPassword}
                aria-invalid={errors.confirmPassword ? 'true' : 'false'}
              />
            </FormField>

            <button
              type="submit"
              disabled={!isValid || isLoading}
              className={clsx(
                'w-full py-3 px-4 rounded-md font-medium text-white transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
                isValid && !isLoading
                  ? 'bg-primary-600 hover:bg-primary-700'
                  : 'bg-gray-300 cursor-not-allowed'
              )}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating account...
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <a
                href="/login"
                className="font-medium text-primary-600 hover:text-primary-500"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          By creating an account, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>

      {rateLimitSeconds && (
        <RateLimitModal
          seconds={rateLimitSeconds}
          onClose={() => setRateLimitSeconds(null)}
        />
      )}
    </div>
  );
}
