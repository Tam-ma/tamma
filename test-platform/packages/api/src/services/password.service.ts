import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface PasswordHashResult {
  hash: string;
  salt: string;
  rounds: number;
}

export interface PasswordStrengthResult {
  score: number;
  feedback: string[];
  isStrong: boolean;
}

export class PasswordService {
  private readonly SALT_ROUNDS = 12;
  private readonly PEPPER = process.env.PASSWORD_PEPPER || '';
  private readonly MIN_PASSWORD_LENGTH = 8;

  /**
   * Hash a password using bcrypt with pepper
   */
  async hashPassword(password: string): Promise<PasswordHashResult> {
    try {
      // Generate salt
      const salt = await bcrypt.genSalt(this.SALT_ROUNDS);

      // Add pepper if configured
      const pepperedPassword = password + this.PEPPER;

      // Hash password
      const hash = await bcrypt.hash(pepperedPassword, salt);

      console.log('Password hashed successfully', {
        saltRounds: this.SALT_ROUNDS,
        hashLength: hash.length,
      });

      return {
        hash,
        salt,
        rounds: this.SALT_ROUNDS,
      };
    } catch (error) {
      console.error('Password hashing failed', { error });
      throw new Error('Failed to hash password');
    }
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      // Add pepper if configured
      const pepperedPassword = password + this.PEPPER;

      // Verify password
      const isValid = await bcrypt.compare(pepperedPassword, hash);

      console.log('Password verification completed', {
        isValid,
        hashLength: hash.length,
      });

      return isValid;
    } catch (error) {
      console.error('Password verification failed', { error });
      throw new Error('Failed to verify password');
    }
  }

  /**
   * Check password strength and provide feedback
   */
  async checkPasswordStrength(password: string): Promise<PasswordStrengthResult> {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 12) {
      score += 2;
    } else if (password.length >= 8) {
      score += 1;
      feedback.push('Consider using a longer password (12+ characters)');
    } else {
      feedback.push('Password must be at least 8 characters long');
    }

    // Character variety checks
    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('Include lowercase letters');

    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('Include uppercase letters');

    if (/\d/.test(password)) score += 1;
    else feedback.push('Include numbers');

    if (/[^a-zA-Z\d]/.test(password)) score += 1;
    else feedback.push('Include special characters');

    // Common patterns check
    if (this.hasCommonPatterns(password)) {
      score -= 2;
      feedback.push('Avoid common patterns or dictionary words');
    }

    // Repeated characters check
    if (this.hasRepeatedCharacters(password)) {
      score -= 1;
      feedback.push('Avoid repeated characters');
    }

    // Sequential characters check
    if (this.hasSequentialCharacters(password)) {
      score -= 1;
      feedback.push('Avoid sequential characters');
    }

    const isStrong = score >= 5;

    return {
      score: Math.max(0, Math.min(8, score)),
      feedback,
      isStrong,
    };
  }

  /**
   * Generate a secure random password
   */
  generateSecurePassword(length: number = 16): string {
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';

    // Ensure at least one character from each category
    const categories = [
      'abcdefghijklmnopqrstuvwxyz',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '0123456789',
      '!@#$%^&*()_+-=[]{}|;:,.<>?',
    ];

    // Add one character from each category
    for (const category of categories) {
      const randomIndex = crypto.randomInt(0, category.length);
      password += category[randomIndex];
    }

    // Fill remaining length with random characters
    for (let i = password.length; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }

    // Shuffle the password
    return password
      .split('')
      .sort(() => crypto.randomInt(0, 2) - 1)
      .join('');
  }

  /**
   * Generate a random salt
   */
  generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a password with PBKDF2 (alternative to bcrypt)
   */
  async hashPasswordPBKDF2(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password + this.PEPPER, salt, 100000, 64, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex'));
      });
    });
  }

  /**
   * Check if password contains common patterns
   */
  private hasCommonPatterns(password: string): boolean {
    const commonPatterns = [
      /123456/,
      /password/i,
      /qwerty/i,
      /admin/i,
      /letmein/i,
      /welcome/i,
      /abc123/i,
      /111111/,
      /123123/,
      /monkey/i,
      /dragon/i,
      /football/i,
      /iloveyou/i,
      /master/i,
      /superman/i,
      /michael/i,
      /shadow/i,
      /batman/i,
    ];

    return commonPatterns.some((pattern) => pattern.test(password));
  }

  /**
   * Check for repeated characters (3 or more consecutive identical characters)
   */
  private hasRepeatedCharacters(password: string): boolean {
    return /(.)\1{2,}/.test(password);
  }

  /**
   * Check for sequential characters (3 or more consecutive sequential characters)
   */
  private hasSequentialCharacters(password: string): boolean {
    for (let i = 0; i < password.length - 2; i++) {
      const char1 = password.charCodeAt(i);
      const char2 = password.charCodeAt(i + 1);
      const char3 = password.charCodeAt(i + 2);

      if ((char2 === char1 + 1 && char3 === char2 + 1) ||
          (char2 === char1 - 1 && char3 === char2 - 1)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate password meets minimum requirements
   */
  validatePasswordRequirements(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < this.MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_PASSWORD_LENGTH} characters long`);
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/[^a-zA-Z\d]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Export singleton instance
export const passwordService = new PasswordService();