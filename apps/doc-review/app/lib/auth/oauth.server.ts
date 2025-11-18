import { OAUTH_CONFIGS, type OAuthConfig } from './oauth-configs';

export interface OAuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string;
  provider: string;
  accessToken: string;
  role?: string;
}

export class OAuthService {
  constructor(
    private provider: string,
    private config: OAuthConfig,
    private kv: KVNamespace
  ) {}

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      response_type: 'code',
    });

    return `${this.config.authorizationUrl}?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    if (data.error) {
      throw new Error(`OAuth error: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  /**
   * Get user info from provider
   */
  async getUserInfo(accessToken: string): Promise<OAuthUser> {
    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    // Parse provider-specific response
    return this.parseUserInfo(data, accessToken);
  }

  /**
   * Create session and store in KV
   */
  async createSession(user: OAuthUser): Promise<string> {
    const sessionId = crypto.randomUUID();
    const sessionData = {
      userId: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      provider: this.provider,
      accessToken: user.accessToken,
      role: user.role,
      createdAt: Date.now(),
    };

    // Handle dev mode without KV
    if (!this.kv) {
      console.warn('Warning: KV not available. Session will not persist.');
      return sessionId;
    }

    // Store in KV with 7 day expiration
    await this.kv.put(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
    );

    return sessionId;
  }

  /**
   * Get session from KV
   */
  async getSession(sessionId: string): Promise<OAuthUser | null> {
    // Handle dev mode without KV
    if (!this.kv) return null;

    const data = await this.kv.get(`session:${sessionId}`, 'json');

    if (!data) return null;

    return data as OAuthUser;
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Handle dev mode without KV
    if (!this.kv) return;

    await this.kv.delete(`session:${sessionId}`);
  }

  /**
   * Refresh session (extend expiration)
   */
  async refreshSession(sessionId: string): Promise<void> {
    // Handle dev mode without KV
    if (!this.kv) return;

    const session = await this.getSession(sessionId);

    if (session) {
      await this.kv.put(`session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: 60 * 60 * 24 * 7,
      });
    }
  }

  /**
   * Parse provider-specific user info
   */
  private parseUserInfo(data: any, accessToken: string): OAuthUser {
    if (this.provider === 'github') {
      return {
        id: data.id.toString(),
        username: data.login,
        name: data.name || data.login,
        email: data.email || '',
        avatarUrl: data.avatar_url,
        provider: 'github',
        accessToken,
      };
    } else if (this.provider === 'gitlab') {
      return {
        id: data.id.toString(),
        username: data.username,
        name: data.name,
        email: data.email,
        avatarUrl: data.avatar_url,
        provider: 'gitlab',
        accessToken,
      };
    } else if (this.provider === 'gitea') {
      return {
        id: data.id.toString(),
        username: data.login || data.username,
        name: data.full_name || data.login,
        email: data.email,
        avatarUrl: data.avatar_url,
        provider: 'gitea',
        accessToken,
      };
    }

    throw new Error(`Unknown provider: ${this.provider}`);
  }
}

/**
 * Create OAuth service from environment
 */
export function createOAuthService(
  provider: string,
  env: { CACHE: KVNamespace; [key: string]: any }
): OAuthService {
  const config = { ...OAUTH_CONFIGS[provider] };

  // Set credentials from environment
  config.clientId = env[`${provider.toUpperCase()}_CLIENT_ID`];
  config.clientSecret = env[`${provider.toUpperCase()}_CLIENT_SECRET`];

  // For self-hosted instances (Gitea/GitLab)
  if (provider === 'gitea') {
    const baseUrl = env.GITEA_URL;
    if (baseUrl) {
      config.authorizationUrl = `${baseUrl}/login/oauth/authorize`;
      config.tokenUrl = `${baseUrl}/login/oauth/access_token`;
      config.userInfoUrl = `${baseUrl}/api/v1/user`;
    }
  }

  return new OAuthService(provider, config, env.CACHE);
}
