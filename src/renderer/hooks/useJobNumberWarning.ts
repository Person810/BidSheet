import { useEffect, useState } from 'react';

/**
 * Debounced duplicate check for the job-number field. Returns a warning
 * string when another job already uses the number, null otherwise. This is
 * advisory only — duplicates stay saveable (legacy data may hold them, and
 * GC-mandated numbers must stay typeable), so failures here just clear the
 * warning rather than surfacing an error.
 */
export function useJobNumberWarning(jobNumber: string, excludeJobId?: number): string | null {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = jobNumber.trim();
    if (!trimmed) {
      setWarning(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.checkJobNumberInUse(trimmed, excludeJobId);
        if (!stale) {
          setWarning(res.inUse ? `Job number already used by "${res.jobName}"` : null);
        }
      } catch {
        if (!stale) setWarning(null);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [jobNumber, excludeJobId]);

  return warning;
}
