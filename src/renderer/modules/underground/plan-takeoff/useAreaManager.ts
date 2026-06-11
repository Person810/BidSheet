import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffArea, AreaConfig, PdfPoint } from './types';
import { AREA_COLORS } from './types';

interface UseAreaManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface AreaManager {
  // State
  areas: TakeoffArea[];
  activeAreaId: number | null;
  selectedAreaId: number | null;
  showConfigModal: boolean;
  mousePos: PdfPoint | null;
  isDrawing: boolean;
  pendingDeleteId: number | null;

  // Derived
  pageAreas: TakeoffArea[];
  lastAreaConfig: AreaConfig | null;
  editingConfig: AreaConfig | undefined;

  // Actions
  handleAddArea: () => void;
  handleConfigConfirm: (config: AreaConfig) => void;
  handleConfigCancel: () => void;
  handlePointClick: (point: PdfPoint) => void;
  handleAreaSelect: (areaId: number | null) => void;
  handleEditArea: (areaId: number) => void;
  handleDeleteArea: (areaId: number) => void;
  handleMouseMove: (point: PdfPoint) => void;
  undoLastPoint: () => void;
  finishActiveArea: () => void;
  /**
   * Move a polygon vertex (drag flow). Pass commit: false for live updates
   * while dragging (no DB write), then true once on release.
   */
  moveAreaVertexTo: (areaId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  /** Re-fetch state from the DB (used by undo/redo restore) */
  reload: () => Promise<void>;
}

function areaToConfig(area: TakeoffArea): AreaConfig {
  return {
    label: area.label,
    areaType: area.areaType,
    depthFt: area.depthFt,
    materialId: area.materialId,
    assemblyId: area.assemblyId,
  };
}

// Module-scoped counter so local IDs are unique across remounts
let globalNextLocalId = -1;

export function useAreaManager({ jobId, pageNum }: UseAreaManagerOptions): AreaManager {
  const [areas, setAreas] = useState<TakeoffArea[]>([]);
  const areasRef = useRef<TakeoffArea[]>([]);
  areasRef.current = areas;
  const [activeAreaId, setActiveAreaId] = useState<number | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingAreaId, setEditingAreaId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const isDrawing = activeAreaId !== null;

  // Load areas from DB when job changes (also used by undo/redo restore)
  const reload = useCallback(async () => {
    if (!jobId) { setAreas([]); return; }
    const loaded: TakeoffArea[] = await window.api.listTakeoffAreas(jobId);
    setAreas(loaded);
    setActiveAreaId(null);
    setSelectedAreaId(null);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  const finishActiveArea = useCallback(() => {
    if (!activeAreaId) return;
    const localId = activeAreaId;
    const area = areasRef.current.find((a) => a.id === localId);
    if (!area || area.points.length < 3) {
      // A polygon needs at least 3 vertices — discard incomplete shapes
      setAreas((prev) => prev.filter((a) => a.id !== localId));
    } else if (jobId) {
      const payload = { ...area, jobId, sortOrder: areasRef.current.indexOf(area) };
      window.api.saveTakeoffArea(payload).then((result: { id: number }) => {
        setAreas((cur) => cur.map((a) => a.id === localId ? { ...a, id: result.id } : a));
      });
    }
    setActiveAreaId(null);
    setMousePos(null);
  }, [activeAreaId, jobId]);

  // -- Modal --

  const handleAddArea = useCallback(() => {
    setEditingAreaId(null);
    setShowConfigModal(true);
  }, []);

  const handleConfigConfirm = useCallback((config: AreaConfig) => {
    if (editingAreaId !== null) {
      setAreas((prev) => {
        const updated = prev.map((a) => {
          if (a.id !== editingAreaId) return a;
          return { ...a, ...config, color: AREA_COLORS[config.areaType] };
        });
        if (editingAreaId > 0 && jobId) {
          const area = updated.find((a) => a.id === editingAreaId);
          if (area) {
            window.api.saveTakeoffArea({ ...area, jobId, sortOrder: updated.indexOf(area) });
          }
        }
        return updated;
      });
      setShowConfigModal(false);
      setEditingAreaId(null);
      return;
    }

    const id = globalNextLocalId--;
    const newArea: TakeoffArea = {
      id,
      jobId: jobId ?? 0,
      ...config,
      color: AREA_COLORS[config.areaType],
      pdfPage: pageNum,
      points: [],
    };
    setAreas((prev) => [...prev, newArea]);
    setActiveAreaId(id);
    setSelectedAreaId(null);
    setShowConfigModal(false);
  }, [editingAreaId, pageNum, jobId]);

  const handleConfigCancel = useCallback(() => {
    setShowConfigModal(false);
    setEditingAreaId(null);
  }, []);

  // -- Drawing --

  const handlePointClick = useCallback((point: PdfPoint) => {
    if (!activeAreaId) return;
    setAreas((prev) => prev.map((a) =>
      a.id === activeAreaId ? { ...a, points: [...a.points, point] } : a
    ));
  }, [activeAreaId]);

  const undoLastPoint = useCallback(() => {
    if (!activeAreaId) return;
    setAreas((prev) => prev.map((a) => {
      if (a.id !== activeAreaId || a.points.length === 0) return a;
      return { ...a, points: a.points.slice(0, -1) };
    }));
  }, [activeAreaId]);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (activeAreaId) setMousePos(point);
  }, [activeAreaId]);

  // -- Vertex repositioning (drag flow) --

  const moveAreaVertexTo = useCallback((areaId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => {
    const area = areasRef.current.find((a) => a.id === areaId);
    if (!area || !area.points[vertexIndex]) return;
    const newPoints = [...area.points];
    newPoints[vertexIndex] = { x: point.x, y: point.y };
    setAreas((prev) => prev.map((a) =>
      a.id === areaId ? { ...a, points: newPoints } : a
    ));
    if (commit && areaId > 0 && jobId) {
      window.api.saveTakeoffArea({ ...area, points: newPoints, jobId, sortOrder: areasRef.current.indexOf(area) });
    }
  }, [jobId]);

  // -- Selection / Edit / Delete --

  const handleAreaSelect = useCallback((areaId: number | null) => {
    if (activeAreaId) return;
    setSelectedAreaId(areaId);
  }, [activeAreaId]);

  const handleEditArea = useCallback((areaId: number) => {
    setEditingAreaId(areaId);
    setShowConfigModal(true);
  }, []);

  const handleDeleteArea = useCallback((areaId: number) => {
    setPendingDeleteId(areaId);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    if (pendingDeleteId > 0) window.api.deleteTakeoffArea(pendingDeleteId);
    setAreas((prev) => prev.filter((a) => a.id !== pendingDeleteId));
    if (selectedAreaId === pendingDeleteId) setSelectedAreaId(null);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedAreaId]);

  const cancelDelete = useCallback(() => setPendingDeleteId(null), []);

  // -- Derived --

  const pageAreas = useMemo(() => areas.filter((a) => a.pdfPage === pageNum), [areas, pageNum]);

  const lastAreaConfig = useMemo((): AreaConfig | null => {
    if (areas.length === 0) return null;
    return { ...areaToConfig(areas[areas.length - 1]), label: '' };
  }, [areas]);

  const editingConfig = useMemo((): AreaConfig | undefined => {
    if (editingAreaId === null) return undefined;
    const area = areas.find((a) => a.id === editingAreaId);
    return area ? areaToConfig(area) : undefined;
  }, [editingAreaId, areas]);

  return {
    areas, activeAreaId, selectedAreaId, showConfigModal, mousePos, isDrawing,
    pendingDeleteId, pageAreas, lastAreaConfig, editingConfig,
    handleAddArea, handleConfigConfirm, handleConfigCancel,
    handlePointClick, handleAreaSelect, handleEditArea, handleDeleteArea,
    handleMouseMove, undoLastPoint, finishActiveArea, moveAreaVertexTo,
    confirmDelete, cancelDelete, reload,
  };
}
