import { useState, useCallback, useRef } from 'react';
import type { BidSectionRow, BidLineItemRow } from '../../../shared/types/ipc';
import { useToastStore } from '../../stores/toast-store';

const MAX_HISTORY = 50;

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

export interface BidHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Capture the current state before a mutation. Clears the redo stack. */
  record: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * Snapshot-based undo/redo for the bid estimate grid, ported from the takeoff
 * editor's history (see useTakeoffHistory). Every user-level mutation calls
 * record() first, pushing a deep copy of the current sections + line items.
 * Undo restores the snapshot to the DB in one transaction — preserving row
 * ids AND uuids so later snapshots stay valid and cloud-sync identity is
 * stable — then reloads from the DB so memory and disk always converge.
 */
export function useBidHistory({ jobId, getState, reloadAll }: UseBidHistoryOptions): BidHistory {
  const addToast = useToastStore((s) => s.addToast);
  const undoStack = useRef<BidSnapshot[]>([]);
  const redoStack = useRef<BidSnapshot[]>([]);
  // Suppresses record() while a restore writes back to the DB and reloads.
  const restoring = useRef(false);
  // Re-entrancy guard: a second Ctrl+Z while a restore is in flight would
  // capture mid-restore state and corrupt both stacks.
  const busy = useRef(false);
  // Stack sizes mirrored into state so button disabled-states re-render.
  const [, setVersion] = useState(0);

  const capture = useCallback((): BidSnapshot => {
    const state = getState();
    return structuredClone({
      sections: state.sections,
      lineItems: state.lineItems,
    });
  }, [getState]);

  const record = useCallback(() => {
    if (restoring.current) return;
    undoStack.current.push(capture());
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setVersion((v) => v + 1);
  }, [capture]);

  const restore = useCallback(async (snapshot: BidSnapshot) => {
    restoring.current = true;
    try {
      await window.api.replaceBidState(jobId, snapshot);
      await reloadAll();
    } catch (err: any) {
      // Don't let an undo/redo write fail silently — surface it and resync
      // local state from the DB so the view matches what actually persisted.
      addToast(err?.message || 'Undo/redo failed.', 'error');
      await reloadAll().catch(() => { /* already reporting the primary error */ });
    } finally {
      restoring.current = false;
    }
  }, [jobId, reloadAll, addToast]);

  const undo = useCallback(async () => {
    if (busy.current) return;
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    busy.current = true;
    try {
      redoStack.current.push(capture());
      await restore(snapshot);
    } finally {
      busy.current = false;
    }
    setVersion((v) => v + 1);
  }, [capture, restore]);

  const redo = useCallback(async () => {
    if (busy.current) return;
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    busy.current = true;
    try {
      undoStack.current.push(capture());
      await restore(snapshot);
    } finally {
      busy.current = false;
    }
    setVersion((v) => v + 1);
  }, [capture, restore]);

  return {
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    record,
    undo,
    redo,
  };
}
