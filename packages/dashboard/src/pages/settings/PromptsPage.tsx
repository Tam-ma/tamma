
import { PromptTemplatesPanel } from '../../components/settings/prompts/PromptTemplatesPanel.js';

export function PromptsPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Prompt Templates</h1>
      <PromptTemplatesPanel />
    </div>
  );
}
