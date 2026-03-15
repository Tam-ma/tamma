
import { PhaseRoleMatrix } from '../../components/settings/phases/PhaseRoleMatrix.js';

export function PhaseRolePage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Phase-Role Mapping</h1>
      <PhaseRoleMatrix />
    </div>
  );
}
