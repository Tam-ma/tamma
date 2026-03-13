
import { BudgetOverview } from '../../components/settings/budget/BudgetOverview.js';

export function BudgetPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Budget & Cost Tracking</h1>
      <BudgetOverview />
    </div>
  );
}
