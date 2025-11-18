export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

export const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  github: {
    clientId: '', // Set via env
    clientSecret: '', // Set via env/secret
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user', 'user:email'],
  },

  gitlab: {
    clientId: '',
    clientSecret: '',
    authorizationUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    userInfoUrl: 'https://gitlab.com/api/v4/user',
    scopes: ['api', 'read_user', 'read_repository', 'write_repository'],
  },

  gitea: {
    clientId: '',
    clientSecret: '',
    authorizationUrl: '', // Set based on instance URL
    tokenUrl: '', // Set based on instance URL
    userInfoUrl: '', // Set based on instance URL
    scopes: ['repo', 'user'],
  },
};
