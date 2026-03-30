import { useState, useCallback, useMemo, useEffect } from 'react';
import type { TakeoffItem, PdfPoint, OverlayMode } from './types';

/** Decrementing counter for local-only item IDs. Negative = unsaved. */
let nextLocalId = -1;

interface UseItemManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface PlacingMaterial {
  id: number;
  name: string;
}

export interface ItemManager {
  // State
  items: TakeoffItem[];
  placingMaterial: PlacingMaterial | null;
  selectedItemId: number | null;
  mousePos: PdfPoint | null;
  pendingDeleteId: number | null;
  isPlacing: boolean;

  // Derived
  pageItems: TakeoffItem[];
  overlayMode: OverlayMode;

  // Actions
  startPlacing: (material: PlacingMaterial) => void;
  cancelPlacing: () => void;
  placeItem: (point: PdfPoint, pdfPage: number) => void;
  selectItem: (id: number | null) => void;
  deleteItem: (id: number) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  handleMouseMove: (point: PdfPoint) => void;
}

export function useItemManager({
  jobId, pageNum,
}: UseItemManagerOptions): ItemManager {
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const [placingMaterial, setPlacingMaterial] = useState<PlacingMaterial | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const isPlacing = placingMaterial !== null;

  // Load items from DB when job changes
  useEffect(() => {
    if (!jobId) { setItems([]); return; }
    window.api.listTakeoffItems(jobId).then((loaded: TakeoffItem[]) => {
      setItems(loaded);
      setSelectedItemId(null);
      setPlacingMaterial(null);
    }).catch(console.error);
  }, [jobId]);

  const startPlacing = useCallback((material: PlacingMaterial) => {
    setPlacingMaterial(material);
    setSelectedItemId(null);
  }, []);

  const cancelPlacing = useCallback(() => {
    setPlacingMaterial(null);
    setMousePos(null);
  }, []);

  const placeItem = useCallback((point: PdfPoint, pdfPage: number) => {
    if (!placingMaterial || !jobId) return;

    const localId = nextLocalId--;
    const newItem: TakeoffItem = {
      id: localId,
      jobId,
      materialId: placingMaterial.id,
      materialName: placingMaterial.name,
      xPx: point.x,
      yPx: point.y,
      quantity: 1,
      label: placingMaterial.name,
      pdfPage,
      nearRunId: null,
    };

    setItems((prev) => [...prev, newItem]);

    // Save immediately to DB
    window.api.saveTakeoffItem(newItem).then((result: { id: number }) => {
      setItems((cur) => cur.map((i) => i.id === localId ? { ...i, id: result.id } : i));
    }).catch(console.error);

    // Stay in placement mode -- user can keep clicking to place more
  }, [placingMaterial, jobId]);

  const selectItem = useCallback((id: number | null) => {
    if (isPlacing) return;
    setSelectedItemId(id);
  }, [isPlacing]);

  const deleteItem = useCallback((id: number) => {
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    const id = pendingDeleteId;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedItemId === id) setSelectedItemId(null);
    if (id > 0) {
      window.api.deleteTakeoffItem(id).catch(console.error);
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedItemId]);

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (isPlacing) setMousePos(point);
  }, [isPlacing]);

  const pageItems = useMemo(
    () => items.filter((i) => i.pdfPage === pageNum),
    [items, pageNum],
  );

  const overlayMode: OverlayMode = isPlacing ? 'place-item' : 'none';

  return {
    items,
    placingMaterial,
    selectedItemId,
    mousePos,
    pendingDeleteId,
    isPlacing,
    pageItems,
    overlayMode,
    startPlacing,
    cancelPlacing,
    placeItem,
    selectItem,
    deleteItem,
    confirmDelete,
    cancelDelete,
    handleMouseMove,
  };
}
