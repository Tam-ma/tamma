import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../../stores/settings/store.js';

const POLL_INTERVAL_MS = 10_000;

export function useProviderHealth() {
  const status = useSettingsStore((s) => s.healthStatus);
  const loading = useSettingsStore((s) => s.healthLoading);
  const error = useSettingsStore((s) => s.healthError);
  const load = useSettingsStore((s) => s.loadHealthStatus);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void load();

    intervalRef.current = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [load]);

  return { status, loading, error, reload: load };
}
