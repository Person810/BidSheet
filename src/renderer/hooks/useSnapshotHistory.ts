import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY = 50;

export interface SnapshotHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Capture the current state before a mutation. Clears the redo stack. */
  record: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface SnapshotHistoryOptions<T> {
  /** Current in-memory state, read at record/undo time. */
  getState: () => T;
  /** Re-fetch state from the DB after a restore so memory + disk converge. */
  reloadAll: () => Promise<void>;
  /** Persist a snapshot back to the DB in one transaction (the replace-state IPC call). The resolved value is ignored. */
  persist: (snapshot: T) => Promise<unknown>;
  /** Surface a restore failure to the user. */
  onError: (err: any) => void;
  /**
   * Optional pre-clone transform applied when capturing — e.g. dropping
   * never-saved (negative-ID) rows. Defaults to identity.
   */
  normalize?: (state: T) => T;
}

/**
 * Generic snapshot-based undo/redo. Every user-level mutation calls record()
 * first, pushing a deep copy of the current state. undo/redo restore a snapshot
 * via `persist` (one transaction) then `reloadAll` so memory and disk always
 * converge. Re-entrancy is guarded so a second undo mid-restore can't corrupt
 * the stacks, and record() is suppressed while a restore writes back.
 *
 * Shared by the bid grid ([[useBidHistory]]) and the takeoff editor
 * ([[useTakeoffHistory]]); each supplies its own snapshot type, persist call,
 * error reporter, and optional normalize.
 */
export function useSnapshotHistory<T>({
  getState, reloadAll, persist, onError, normalize,
}: SnapshotHistoryOptions<T>): SnapshotHistory {
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  // Suppresses record() while a restore writes back to the DB and reloads.
  const restoring = useRef(false);
  // Re-entrancy guard: a second undo while a restore is in flight would
  // capture mid-restore state and corrupt both stacks.
  const busy = useRef(false);
  // Stack sizes mirrored into state so button disabled-states re-render.
  const [, setVersion] = useState(0);

  const capture = useCallback((): T => {
    const state = getState();
    return structuredClone(normalize ? normalize(state) : state);
  }, [getState, normalize]);

  const record = useCallback(() => {
    if (restoring.current) return;
    undoStack.current.push(capture());
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setVersion((v) => v + 1);
  }, [capture]);

  const restore = useCallback(async (snapshot: T) => {
    restoring.current = true;
    try {
      await persist(snapshot);
      await reloadAll();
    } catch (err: any) {
      // Don't let an undo/redo write fail silently — surface it and resync
      // local state from the DB so the view matches what actually persisted.
      onError(err);
      await reloadAll().catch(() => { /* already reporting the primary error */ });
    } finally {
      restoring.current = false;
    }
  }, [persist, reloadAll, onError]);

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
