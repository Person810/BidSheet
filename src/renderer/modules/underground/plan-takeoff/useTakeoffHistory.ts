import { useCallback } from 'react';
import type { TakeoffRun, TakeoffItem, TakeoffNode, TakeoffArea, TakeoffAnnotation } from './types';
import { reportSaveError } from './takeoffPersistence';
import { useSnapshotHistory, type SnapshotHistory } from '../../../hooks/useSnapshotHistory';

interface TakeoffSnapshot {
  runs: TakeoffRun[];
  items: TakeoffItem[];
  nodes: TakeoffNode[];
  areas: TakeoffArea[];
  annotations: TakeoffAnnotation[];
}

interface UseTakeoffHistoryOptions {
  jobId: number;
  /** Current in-memory state, read at record/undo time */
  getState: () => TakeoffSnapshot;
  /** Re-fetch all managers from the DB after a restore */
  reloadAll: () => Promise<void>;
}

export type TakeoffHistory = SnapshotHistory;

/**
 * Entities with negative IDs (drawn but not yet saved) are excluded from
 * snapshots — in-progress drawing has its own point-by-point undo. Restore
 * preserves entity IDs so later snapshots stay valid.
 */
function normalizeTakeoff(state: TakeoffSnapshot): TakeoffSnapshot {
  return {
    runs: state.runs.filter((r) => r.id > 0),
    items: state.items.filter((i) => i.id > 0),
    nodes: state.nodes.filter((n) => n.id > 0),
    areas: state.areas.filter((a) => a.id > 0),
    annotations: state.annotations.filter((a) => a.id > 0),
  };
}

/**
 * Snapshot-based undo/redo for the takeoff editor. Thin wrapper over the
 * shared [[useSnapshotHistory]] hook.
 */
export function useTakeoffHistory({ jobId, getState, reloadAll }: UseTakeoffHistoryOptions): TakeoffHistory {
  return useSnapshotHistory<TakeoffSnapshot>({
    getState,
    reloadAll,
    normalize: normalizeTakeoff,
    persist: useCallback((snapshot) => window.api.replaceTakeoffState(jobId, snapshot), [jobId]),
    onError: useCallback((err) => reportSaveError('undo/redo')(err), []),
  });
}
