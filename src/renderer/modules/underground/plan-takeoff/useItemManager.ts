import { useState, useCallback, useMemo, useEffect } from 'react';
import type { TakeoffItem, PdfPoint } from './types';

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
}

// Module-scoped counter so local IDs are unique across remounts
let globalNextLocalId = -1;

export function useItemManager({
  jobId, pageNum,
}: UseItemManagerOptions): ItemManager {
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  // Load items from DB when job changes
  useEffect(() => {
    if (!jobId) { setItems([]); return; }
    window.api.listTakeoffItems(jobId).then((loaded: TakeoffItem[]) => {
      setItems(loaded);
      setSelectedItemId(null);
    });
  }, [jobId]);

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
    window.api.saveTakeoffItem(newItem).then((result: { id: number }) => {
      setItems((cur) => cur.map((i) => i.id === localId ? { ...i, id: result.id } : i));
    });
  }, [jobId]);

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
      window.api.deleteTakeoffItem(id);
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedItemId]);

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

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
  };
}
