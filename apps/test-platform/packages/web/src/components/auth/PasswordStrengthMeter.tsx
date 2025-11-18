'use client';

import { calculatePasswordStrength } from '@/schemas/password.schema';
import { cn } from '@/lib/cn';
import { motion } from 'framer-motion';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const strength = calculatePasswordStrength(password);

  if (!password) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">Password strength:</span>
        <span
          className={cn('font-medium', {
            'text-red-600': strength.score <= 1,
            'text-yellow-600': strength.score === 2,
            'text-blue-600': strength.score === 3,
            'text-green-600': strength.score === 4,
          })}
        >
          {strength.label}
        </span>
      </div>
      
      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className={cn('h-full transition-all duration-300', strength.color)}
          initial={{ width: 0 }}
          animate={{ width: `${strength.percentage}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
