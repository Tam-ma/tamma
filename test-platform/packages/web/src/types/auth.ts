export interface RegisterData {
  email: string;
  password: string;
  fullName?: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  userId?: string;
}

export interface VerifyEmailResponse {
  success: boolean;
  message: string;
  alreadyVerified?: boolean;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
  retryAfter?: number;
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';
