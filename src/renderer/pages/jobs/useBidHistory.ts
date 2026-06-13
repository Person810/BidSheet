import { useCallback } from 'react';
import type { BidSectionRow, BidLineItemRow } from '../../../shared/types/ipc';
import { useToastStore } from '../../stores/toast-store';
import { useSnapshotHistory, type SnapshotHistory } from '../../hooks/useSnapshotHistory';

export interface BidSnapshot {
  sections: BidSectionRow[];
  lineItems: Record<number, BidLineItemRow[]>;
}

interface UseBidHistoryOptions {
  jobId: number;
  /** Current in-memory bid state, read at record/undo time. */
  getState: () => BidSnapshot;
  /** Re-fetch sections + line items from the DB after a restore. */
  reloadAll: () => Promise<void>;
}

export type BidHistory = SnapshotHistory;

/**
 * Snapshot-based undo/redo for the bid estimate grid. Restore preserves row
 * ids AND uuids (see the `db:bid:replace-state` handler) so later snapshots
 * stay valid and cloud-sync identity is stable. Thin wrapper over the shared
 * [[useSnapshotHistory]] hook.
 */
export function useBidHistory({ jobId, getState, reloadAll }: UseBidHistoryOptions): BidHistory {
  const addToast = useToastStore((s) => s.addToast);
  return useSnapshotHistory<BidSnapshot>({
    getState,
    reloadAll,
    persist: useCallback((snapshot) => window.api.replaceBidState(jobId, snapshot), [jobId]),
    onError: useCallback((err) => addToast(err?.message || 'Undo/redo failed.', 'error'), [addToast]),
  });
}
