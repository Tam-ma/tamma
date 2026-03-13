
import { ProviderHealthDashboard } from '../../components/settings/health/ProviderHealthDashboard.js';

export function ProviderHealthPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Provider Health</h1>
      <ProviderHealthDashboard />
    </div>
  );
}
