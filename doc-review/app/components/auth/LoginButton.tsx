export function LoginButton({ provider }: { provider: string }) {
  const providerNames = {
    github: 'GitHub',
    gitlab: 'GitLab',
    gitea: 'Gitea',
  };

  const providerIcons = {
    github: '🐙',
    gitlab: '🦊',
    gitea: '🍵',
  };

  return (
    <a
      href="/auth/login"
      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
    >
      <span className="mr-2">{providerIcons[provider as keyof typeof providerIcons]}</span>
      Login with {providerNames[provider as keyof typeof providerNames]}
    </a>
  );
}
