import { useMemo } from 'react';
import clsx from 'clsx';
import { calculatePasswordStrength, getPasswordStrengthColor, getPasswordStrengthWidth } from '@/utils/passwordStrength';
import { PasswordStrength } from '@/types/auth';

interface PasswordStrengthMeterProps {
  password: string;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const strength = useMemo(() => calculatePasswordStrength(password), [password]);

  if (!password) return null;

  const strengthLabels: Record<PasswordStrength, string> = {
    weak: 'Weak',
    fair: 'Fair',
    good: 'Good',
    strong: 'Strong',
  };

  return (
    <div className="space-y-1">
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full transition-all duration-300',
            getPasswordStrengthColor(strength),
            getPasswordStrengthWidth(strength)
          )}
        />
      </div>
      <p className={clsx('text-xs font-medium', {
        'text-red-600': strength === 'weak',
        'text-orange-600': strength === 'fair',
        'text-yellow-600': strength === 'good',
        'text-green-600': strength === 'strong',
      })}>
        Password strength: {strengthLabels[strength]}
      </p>
    </div>
  );
}
