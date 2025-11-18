import { PasswordStrength } from '@/types/auth';

export function calculatePasswordStrength(password: string): PasswordStrength {
  if (!password) return 'weak';
  
  let score = 0;
  
  // Length check
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  
  // Character type checks
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  
  // Variety check
  const uniqueChars = new Set(password).size;
  if (uniqueChars > 8) score += 1;
  
  if (score <= 2) return 'weak';
  if (score <= 4) return 'fair';
  if (score <= 5) return 'good';
  return 'strong';
}

export function getPasswordStrengthColor(strength: PasswordStrength): string {
  const colors = {
    weak: 'bg-red-500',
    fair: 'bg-orange-500',
    good: 'bg-yellow-500',
    strong: 'bg-green-500',
  };
  return colors[strength];
}

export function getPasswordStrengthWidth(strength: PasswordStrength): string {
  const widths = {
    weak: 'w-1/4',
    fair: 'w-2/4',
    good: 'w-3/4',
    strong: 'w-full',
  };
  return widths[strength];
}
