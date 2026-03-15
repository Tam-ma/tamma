import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings/store.js';

export function useAgentsConfig() {
  const config = useSettingsStore((s) => s.agentsConfig);
  const loading = useSettingsStore((s) => s.agentsLoading);
  const error = useSettingsStore((s) => s.agentsError);
  const load = useSettingsStore((s) => s.loadAgentsConfig);
  const save = useSettingsStore((s) => s.saveAgentsConfig);

  useEffect(() => {
    if (!config && !loading) {
      void load();
    }
  }, [config, loading, load]);

  return { config, loading, error, reload: load, save };
}
