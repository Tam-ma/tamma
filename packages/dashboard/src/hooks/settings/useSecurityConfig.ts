import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings/store.js';

export function useSecurityConfig() {
  const config = useSettingsStore((s) => s.securityConfig);
  const loading = useSettingsStore((s) => s.securityLoading);
  const error = useSettingsStore((s) => s.securityError);
  const load = useSettingsStore((s) => s.loadSecurityConfig);
  const save = useSettingsStore((s) => s.saveSecurityConfig);

  useEffect(() => {
    if (!config && !loading) {
      void load();
    }
  }, [config, loading, load]);

  return { config, loading, error, reload: load, save };
}
