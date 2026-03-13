import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings/store.js';

export function usePromptTemplates() {
  const templates = useSettingsStore((s) => s.promptTemplates);
  const loading = useSettingsStore((s) => s.promptsLoading);
  const error = useSettingsStore((s) => s.promptsError);
  const load = useSettingsStore((s) => s.loadPromptTemplates);
  const save = useSettingsStore((s) => s.savePromptTemplate);

  useEffect(() => {
    if (Object.keys(templates).length === 0 && !loading) {
      void load();
    }
  }, [templates, loading, load]);

  return { templates, loading, error, reload: load, save };
}
