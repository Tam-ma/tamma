'use client';

import { getPasswordRequirements } from '@/schemas/password.schema';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PasswordRequirementsChecklistProps {
  password: string;
  className?: string;
}

export function PasswordRequirementsChecklist({
  password,
  className,
}: PasswordRequirementsChecklistProps) {
  const requirements = getPasswordRequirements(password);
  const showChecklist = password.length > 0;

  if (!showChecklist) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium text-gray-700">Password requirements:</p>
      <ul className="space-y-1">
        {requirements.map((requirement, index) => (
          <li
            key={index}
            className={cn('flex items-center gap-2 text-sm transition-colors', {
              'text-green-600': requirement.met,
              'text-gray-500': !requirement.met,
            })}
          >
            <span className="flex-shrink-0">
              {requirement.met ? (
                <Check className="h-4 w-4" aria-label="Requirement met" />
              ) : (
                <X className="h-4 w-4" aria-label="Requirement not met" />
              )}
            </span>
            <span>{requirement.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
