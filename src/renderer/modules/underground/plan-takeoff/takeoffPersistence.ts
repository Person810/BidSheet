/**
 * Shared error reporting for takeoff persistence.
 *
 * All takeoff writes are optimistic — local state updates first, the DB write
 * rides an IPC promise. Those promises used to be fire-and-forget, so a
 * rejected save (DB locked, disk full) left a shape that looked committed but
 * vanished on next reload with no feedback. Attach `reportSaveError` to every
 * save/delete so a failure becomes a visible toast and a log line instead.
 *
 * Uses the store's getState() rather than the React hook so it's callable from
 * inside callbacks / promise chains, not just component render.
 */
import { useToastStore } from '../../../stores/toast-store';

export function reportSaveError(context: string): (err: unknown) => void {
  return (err) => {
    console.error(`[takeoff] failed to persist ${context}`, err);
    useToastStore.getState().addToast(
      `Couldn't save ${context} — your last change may not stick after reload. Check the log and try again.`,
      'error',
    );
  };
}
