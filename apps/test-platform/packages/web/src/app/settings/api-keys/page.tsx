import { APIKeysPage } from '@/pages/settings/APIKeysPage';

export const metadata = {
  title: 'API Keys | Tamma',
  description: 'Manage your API keys for programmatic access',
};

export default function APIKeysRoute() {
  return <APIKeysPage />;
}
