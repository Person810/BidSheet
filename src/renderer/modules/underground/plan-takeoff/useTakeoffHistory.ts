import { useState, useCallback, useRef } from 'react';
import type { TakeoffRun, TakeoffItem, TakeoffNode, TakeoffArea } from './types';

const MAX_HISTORY = 50;

interface TakeoffSnapshot {
  runs: TakeoffRun[];
  items: TakeoffItem[];
  nodes: TakeoffNode[];
  areas: TakeoffArea[];
}

interface UseTakeoffHistoryOptions {
  jobId: number;
  /** Current in-memory state, read at record/undo time */
  getState: () => TakeoffSnapshot;
  /** Re-fetch all managers from the DB after a restore */
  reloadAll: () => Promise<void>;
}

export interface TakeoffHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Capture the current state before a mutation. Clears the redo stack. */
  record: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * Snapshot-based undo/redo for the takeoff editor.
 *
 * Every user-level mutation calls record() first, pushing a deep copy of the
 * current state. Undo restores the snapshot to the DB in one transaction
 * (preserving entity IDs so later snapshots stay valid), then reloads the
 * managers from the DB so memory and disk always converge.
 *
 * Entities with negative IDs (drawn but not yet saved) are excluded from
 * snapshots — in-progress drawing has its own point-by-point undo.
 */
export function useTakeoffHistory({ jobId, getState, reloadAll }: UseTakeoffHistoryOptions): TakeoffHistory {
  const undoStack = useRef<TakeoffSnapshot[]>([]);
  const redoStack = useRef<TakeoffSnapshot[]>([]);
  const restoring = useRef(false);
  // Re-entrancy guard: a second Ctrl+Z while a restore is in flight would
  // capture mid-restore state and corrupt both stacks
  const busy = useRef(false);
  // Stack sizes mirrored into state so button disabled-states re-render
  const [, setVersion] = useState(0);

  const capture = useCallback((): TakeoffSnapshot => {
    const state = getState();
    return structuredClone({
      runs: state.runs.filter((r) => r.id > 0),
      items: state.items.filter((i) => i.id > 0),
      nodes: state.nodes.filter((n) => n.id > 0),
      areas: state.areas.filter((a) => a.id > 0),
    });
  }, [getState]);

  const record = useCallback(() => {
    if (restoring.current) return;
    undoStack.current.push(capture());
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setVersion((v) => v + 1);
  }, [capture]);

  const restore = useCallback(async (snapshot: TakeoffSnapshot) => {
    restoring.current = true;
    try {
      await window.api.replaceTakeoffState(jobId, snapshot);
      await reloadAll();
    } finally {
      restoring.current = false;
    }
  }, [jobId, reloadAll]);

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
