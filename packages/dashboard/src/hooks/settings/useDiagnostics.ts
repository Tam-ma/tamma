import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settings/store.js';

export function useDiagnostics(options?: { limit?: number; type?: string; since?: number }) {
  const events = useSettingsStore((s) => s.diagnosticsEvents);
  const loading = useSettingsStore((s) => s.diagnosticsLoading);
  const error = useSettingsStore((s) => s.diagnosticsError);
  const load = useSettingsStore((s) => s.loadDiagnostics);

  useEffect(() => {
    void load(options);
  }, [load, options?.limit, options?.type, options?.since]);

  return { events, loading, error, reload: () => load(options) };
}
