import { createHmac, randomBytes } from 'crypto';

// Generate secure unsubscribe token
export async function generateUnsubscribeToken(userId: string, secret?: string): Promise<string> {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}:${timestamp}:${nonce}`;

  // Use provided secret or environment variable
  const hmacSecret = secret || process.env.UNSUBSCRIBE_SECRET || 'default-secret-change-in-production';

  const signature = createHmac('sha256', hmacSecret)
    .update(payload)
    .digest('hex');

  // Encode as URL-safe base64
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return token;
}

// Verify unsubscribe token
export async function verifyUnsubscribeToken(token: string, secret?: string): Promise<{ userId: string; valid: boolean }> {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [userId, timestamp, nonce, signature] = decoded.split(':');

    if (!userId || !timestamp || !nonce || !signature) {
      return { userId: '', valid: false };
    }

    // Check token age (7 days validity)
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    if (tokenAge > maxAge) {
      return { userId, valid: false };
    }

    // Verify signature
    const payload = `${userId}:${timestamp}:${nonce}`;
    const hmacSecret = secret || process.env.UNSUBSCRIBE_SECRET || 'default-secret-change-in-production';

    const expectedSignature = createHmac('sha256', hmacSecret)
      .update(payload)
      .digest('hex');

    const valid = signature === expectedSignature;
    return { userId, valid };
  } catch (error) {
    console.error('Error verifying unsubscribe token:', error);
    return { userId: '', valid: false };
  }
}

// Generate password reset token
export async function generatePasswordResetToken(email: string, secret?: string): Promise<string> {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${email}:${timestamp}:${nonce}`;

  const hmacSecret = secret || process.env.RESET_SECRET || 'default-reset-secret-change-in-production';

  const signature = createHmac('sha256', hmacSecret)
    .update(payload)
    .digest('hex');

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return token;
}

// Verify password reset token
export async function verifyPasswordResetToken(token: string, secret?: string): Promise<{ email: string; valid: boolean }> {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [email, timestamp, nonce, signature] = decoded.split(':');

    if (!email || !timestamp || !nonce || !signature) {
      return { email: '', valid: false };
    }

    // Check token age (1 hour validity)
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const maxAge = 60 * 60 * 1000; // 1 hour in milliseconds

    if (tokenAge > maxAge) {
      return { email, valid: false };
    }

    // Verify signature
    const payload = `${email}:${timestamp}:${nonce}`;
    const hmacSecret = secret || process.env.RESET_SECRET || 'default-reset-secret-change-in-production';

    const expectedSignature = createHmac('sha256', hmacSecret)
      .update(payload)
      .digest('hex');

    const valid = signature === expectedSignature;
    return { email, valid };
  } catch (error) {
    console.error('Error verifying reset token:', error);
    return { email: '', valid: false };
  }
}