import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffItem, PdfPoint } from './types';
import { reportSaveError } from './takeoffPersistence';

interface UseItemManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface ItemManager {
  // State
  items: TakeoffItem[];
  selectedItemId: number | null;
  pendingDeleteId: number | null;

  // Derived
  pageItems: TakeoffItem[];

  // Actions
  addItemAtPoint: (material: { id: number; name: string }, point: PdfPoint, pdfPage: number, nearRunId: number | null) => void;
  selectItem: (id: number | null) => void;
  deleteItem: (id: number) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  updateItem: (id: number, material: { id: number; name: string }) => void;
  duplicateItem: (id: number) => void;
  /**
   * Move a count item (drag flow). Pass commit: false for live updates
   * while dragging (no DB write), then true once on release.
   */
  moveItemTo: (id: number, point: PdfPoint, commit: boolean) => void;
  /** Re-fetch state from the DB (used by undo/redo restore) */
  reload: () => Promise<void>;
}

// Module-scoped counter so local IDs are unique across remounts
let globalNextLocalId = -1;

export function useItemManager({
  jobId, pageNum,
}: UseItemManagerOptions): ItemManager {
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const itemsRef = useRef<TakeoffItem[]>([]);
  itemsRef.current = items;
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  // Local ids of items deleted while their create-save was in flight.
  const pendingDeletesRef = useRef<Set<number>>(new Set());

  // Load items from DB when job changes (also used by undo/redo restore)
  const reload = useCallback(async () => {
    if (!jobId) { setItems([]); return; }
    const loaded: TakeoffItem[] = await window.api.listTakeoffItems(jobId);
    setItems(loaded);
    setSelectedItemId(null);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  // Resolve an optimistic create: delete the persisted row if it was removed
  // mid-save (else it ghosts back on reload), otherwise swap the temp id for
  // the real one and re-persist any edits the id>0 guard skipped meanwhile.
  const resolveCreate = useCallback((localId: number, result: { id: number }) => {
    const realId = result.id;
    if (pendingDeletesRef.current.has(localId)) {
      pendingDeletesRef.current.delete(localId);
      window.api.deleteTakeoffItem(realId).catch(reportSaveError('item deletion'));
      setItems((cur) => cur.filter((i) => i.id !== localId && i.id !== realId));
      return;
    }
    setItems((cur) => cur.map((i) => i.id === localId ? { ...i, id: realId } : i));
    const latest = itemsRef.current.find((i) => i.id === localId);
    if (latest) {
      window.api.saveTakeoffItem({ ...latest, id: realId }).catch(reportSaveError('item'));
    }
  }, []);

  const addItemAtPoint = useCallback((
    material: { id: number; name: string },
    point: PdfPoint,
    pdfPage: number,
    nearRunId: number | null,
  ) => {
    if (!jobId) return;

    const localId = globalNextLocalId--;
    const newItem: TakeoffItem = {
      id: localId,
      jobId,
      materialId: material.id,
      materialName: material.name,
      xPx: point.x,
      yPx: point.y,
      quantity: 1,
      label: material.name,
      pdfPage,
      nearRunId,
    };

    setItems((prev) => [...prev, newItem]);

    // Save immediately to DB
    window.api.saveTakeoffItem(newItem)
      .then((result: { id: number }) => resolveCreate(localId, result))
      .catch(reportSaveError('item'));
  }, [jobId, resolveCreate]);

  const selectItem = useCallback((id: number | null) => {
    setSelectedItemId(id);
  }, []);

  const deleteItem = useCallback((id: number) => {
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    const id = pendingDeleteId;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedItemId === id) setSelectedItemId(null);
    if (id > 0) {
      window.api.deleteTakeoffItem(id).catch(reportSaveError('item deletion'));
    } else {
      // Still mid-save: defer the delete to the create-save completion.
      pendingDeletesRef.current.add(id);
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedItemId]);

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const updateItem = useCallback((id: number, material: { id: number; name: string }) => {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      return { ...i, materialId: material.id, materialName: material.name, label: material.name };
    }));
    if (id > 0) {
      const item = items.find((i) => i.id === id);
      if (item) {
        window.api.saveTakeoffItem({
          ...item, materialId: material.id, materialName: material.name, label: material.name,
        }).catch(reportSaveError('item'));
      }
    }
  }, [items]);

  const moveItemTo = useCallback((id: number, point: PdfPoint, commit: boolean) => {
    setItems((prev) => prev.map((i) =>
      i.id === id ? { ...i, xPx: point.x, yPx: point.y } : i
    ));
    if (commit && id > 0) {
      const item = items.find((i) => i.id === id);
      if (item) {
        window.api.saveTakeoffItem({ ...item, xPx: point.x, yPx: point.y }).catch(reportSaveError('item'));
      }
    }
  }, [items]);

  const duplicateItem = useCallback((id: number) => {
    if (!jobId) return;
    const original = items.find((i) => i.id === id);
    if (!original) return;

    const offset = 20; // px offset so duplicate doesn't stack exactly on top
    const localId = globalNextLocalId--;
    const newItem: TakeoffItem = {
      ...original,
      id: localId,
      xPx: original.xPx + offset,
      yPx: original.yPx + offset,
    };

    setItems((prev) => [...prev, newItem]);
    window.api.saveTakeoffItem(newItem)
      .then((result: { id: number }) => resolveCreate(localId, result))
      .catch(reportSaveError('item'));
  }, [items, jobId, resolveCreate]);

  const pageItems = useMemo(
    () => items.filter((i) => i.pdfPage === pageNum),
    [items, pageNum],
  );

  return {
    items,
    selectedItemId,
    pendingDeleteId,
    pageItems,
    addItemAtPoint,
    selectItem,
    deleteItem,
    confirmDelete,
    cancelDelete,
    updateItem,
    duplicateItem,
    moveItemTo,
    reload,
  };
}
