import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffRun, RunConfig, PdfPoint, OverlayMode } from './types';
import { UTILITY_COLORS } from './types';

interface UseRunManagerOptions {
  jobId: number | null;
  pageNum: number;
  calibrating: boolean;
  calibrationHandlePointClick: (point: PdfPoint) => void;
}

export type InteractionMode = 'normal' | 'moveVertex';

export interface RunManager {
  // State
  runs: TakeoffRun[];
  activeRunId: number | null;
  selectedRunId: number | null;
  showConfigModal: boolean;
  mousePos: PdfPoint | null;
  isDrawing: boolean;
  pendingDeleteId: number | null;
  interactionMode: InteractionMode;
  movingVertex: { runId: number; vertexIndex: number } | null;
  movePreviewPos: PdfPoint | null;

  // Derived
  pageRuns: TakeoffRun[];
  overlayMode: OverlayMode;
  lastRunConfig: RunConfig | null;
  editingConfig: RunConfig | undefined;
  canAddRun: boolean;

  // Actions
  handleAddRun: () => void;
  handleConfigConfirm: (config: RunConfig) => void;
  handleConfigCancel: () => void;
  handlePointClick: (point: PdfPoint) => void;
  handleRunSelect: (runId: number | null) => void;
  handleEditRun: (runId: number) => void;
  handleDeleteRun: (runId: number) => void;
  handleMouseMove: (point: PdfPoint) => void;
  undoLastPoint: () => void;
  finishActiveRun: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  updateVertexElevation: (runId: number, vertexIndex: number, data: { invertElev: number | null; rimElev: number | null; structureType: string | null }) => void;
  startMoveVertex: (runId: number, vertexIndex: number) => void;
  cancelMoveVertex: () => void;
  deleteVertex: (runId: number, vertexIndex: number) => void;
  addVertexOnSegment: (runId: number, segmentIndex: number, point: PdfPoint) => void;
}

function runToConfig(run: TakeoffRun): RunConfig {
  return {
    label: run.label,
    utilityType: run.utilityType,
    pipeSizeIn: run.pipeSizeIn,
    pipeMaterial: run.pipeMaterial,
    pipeMaterialId: run.pipeMaterialId,
    startDepthFt: run.startDepthFt,
    gradePct: run.gradePct,
    trenchWidthFt: run.trenchWidthFt,
    benchWidthFt: run.benchWidthFt,
    beddingType: run.beddingType,
    beddingDepthFt: run.beddingDepthFt,
    beddingMaterialId: run.beddingMaterialId,
    backfillType: run.backfillType,
    backfillMaterialId: run.backfillMaterialId,
  };
}

// Module-scoped counter so local IDs are unique across remounts
let globalNextLocalId = -1;

export function useRunManager({
  jobId, pageNum, calibrating, calibrationHandlePointClick,
}: UseRunManagerOptions): RunManager {
  const [runs, setRuns] = useState<TakeoffRun[]>([]);
  const runsRef = useRef<TakeoffRun[]>([]);
  runsRef.current = runs;
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingRunId, setEditingRunId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('normal');
  const [movingVertex, setMovingVertex] = useState<{ runId: number; vertexIndex: number } | null>(null);
  const [movePreviewPos, setMovePreviewPos] = useState<PdfPoint | null>(null);

  const isDrawing = activeRunId !== null;

  // Load runs from DB when job changes
  useEffect(() => {
    if (!jobId) { setRuns([]); return; }
    window.api.listTakeoffRuns(jobId).then((loaded: TakeoffRun[]) => {
      setRuns(loaded);
      setActiveRunId(null);
      setSelectedRunId(null);
    });
  }, [jobId]);

  // -- Finish / discard active run --

  const finishActiveRun = useCallback(() => {
    if (!activeRunId) return;
    const localId = activeRunId;

    const run = runsRef.current.find((r) => r.id === localId);
    if (!run || run.points.length < 2) {
      // Discard incomplete run
      setRuns((prev) => prev.filter((r) => r.id !== localId));
    } else if (jobId) {
      // Save completed run to DB (outside state updater to avoid double-fire in strict mode)
      const payload = { ...run, jobId, sortOrder: runsRef.current.indexOf(run) };
      window.api.saveTakeoffRun(payload).then((result: { id: number }) => {
        setRuns((cur) => cur.map((r) => r.id === localId ? { ...r, id: result.id } : r));
      });
    }

    setActiveRunId(null);
    setMousePos(null);
  }, [activeRunId, jobId]);

  // -- Modal --

  const handleAddRun = useCallback(() => {
    setEditingRunId(null);
    setShowConfigModal(true);
  }, []);

  const handleConfigConfirm = useCallback((config: RunConfig) => {
    if (editingRunId !== null) {
      setRuns((prev) => {
        const updated = prev.map((r) => {
          if (r.id !== editingRunId) return r;
          return { ...r, ...config, color: UTILITY_COLORS[config.utilityType] };
        });

        // Persist config change for saved runs
        if (editingRunId > 0 && jobId) {
          const run = updated.find((r) => r.id === editingRunId);
          if (run) {
            window.api.saveTakeoffRun({ ...run, jobId, sortOrder: updated.indexOf(run) });
          }
        }

        return updated;
      });
      setShowConfigModal(false);
      setEditingRunId(null);
      return;
    }

    const id = globalNextLocalId--;
    const newRun: TakeoffRun = {
      id,
      ...config,
      color: UTILITY_COLORS[config.utilityType],
      pdfPage: pageNum,
      points: [],
    };
    setRuns((prev) => [...prev, newRun]);
    setActiveRunId(id);
    setSelectedRunId(null);
    setShowConfigModal(false);
  }, [editingRunId, pageNum, jobId]);

  const handleConfigCancel = useCallback(() => {
    setShowConfigModal(false);
    setEditingRunId(null);
  }, []);

  // -- Drawing --

  const handlePointClick = useCallback((point: PdfPoint) => {
    if (calibrating) {
      calibrationHandlePointClick(point);
      return;
    }

    // Move vertex: confirm placement
    if (interactionMode === 'moveVertex' && movingVertex) {
      const { runId, vertexIndex } = movingVertex;
      setRuns((prev) => prev.map((r) => {
        if (r.id !== runId) return r;
        const newPoints = [...r.points];
        newPoints[vertexIndex] = { ...newPoints[vertexIndex], x: point.x, y: point.y };
        return { ...r, points: newPoints };
      }));
      // Persist
      if (runId > 0 && jobId) {
        const run = runsRef.current.find((r) => r.id === runId);
        if (run) {
          const updatedPoints = [...run.points];
          updatedPoints[vertexIndex] = { ...updatedPoints[vertexIndex], x: point.x, y: point.y };
          window.api.saveTakeoffRun({ ...run, points: updatedPoints, jobId, sortOrder: runsRef.current.indexOf(run) });
        }
      }
      setInteractionMode('normal');
      setMovingVertex(null);
      setMovePreviewPos(null);
      return;
    }

    if (!activeRunId) return;

    setRuns((prev) => prev.map((r) =>
      r.id === activeRunId ? { ...r, points: [...r.points, point] } : r
    ));
  }, [calibrating, calibrationHandlePointClick, activeRunId, interactionMode, movingVertex, jobId]);

  const undoLastPoint = useCallback(() => {
    if (!activeRunId) return;
    setRuns((prev) => prev.map((r) => {
      if (r.id !== activeRunId || r.points.length === 0) return r;
      return { ...r, points: r.points.slice(0, -1) };
    }));
  }, [activeRunId]);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (activeRunId) setMousePos(point);
    if (interactionMode === 'moveVertex') setMovePreviewPos(point);
  }, [activeRunId, interactionMode]);

  // -- Selection --

  const handleRunSelect = useCallback((runId: number | null) => {
    if (activeRunId) return;
    setSelectedRunId(runId);
  }, [activeRunId]);

  // -- Edit / Delete --

  const handleEditRun = useCallback((runId: number) => {
    setEditingRunId(runId);
    setShowConfigModal(true);
  }, []);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const handleDeleteRun = useCallback((runId: number) => {
    setPendingDeleteId(runId);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    if (pendingDeleteId > 0) {
      window.api.deleteTakeoffRun(pendingDeleteId);
    }
    setRuns((prev) => prev.filter((r) => r.id !== pendingDeleteId));
    if (selectedRunId === pendingDeleteId) setSelectedRunId(null);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedRunId]);

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  // -- Derived --

  const pageRuns = useMemo(() => runs.filter((r) => r.pdfPage === pageNum), [runs, pageNum]);

  const overlayMode: OverlayMode = activeRunId ? 'draw' : interactionMode === 'moveVertex' ? 'draw' : 'none';

  const lastRunConfig = useMemo((): RunConfig | null => {
    if (runs.length === 0) return null;
    const last = runs[runs.length - 1];
    return { ...runToConfig(last), label: '' };
  }, [runs]);

  const editingConfig = useMemo((): RunConfig | undefined => {
    if (editingRunId === null) return undefined;
    const run = runs.find((r) => r.id === editingRunId);
    if (!run) return undefined;
    return runToConfig(run);
  }, [editingRunId, runs]);

  const canAddRun = !calibrating && !activeRunId;

  // -- Vertex manipulation --

  const startMoveVertex = useCallback((runId: number, vertexIndex: number) => {
    setInteractionMode('moveVertex');
    setMovingVertex({ runId, vertexIndex });
    setMovePreviewPos(null);
  }, []);

  const cancelMoveVertex = useCallback(() => {
    setInteractionMode('normal');
    setMovingVertex(null);
    setMovePreviewPos(null);
  }, []);

  const deleteVertex = useCallback((runId: number, vertexIndex: number) => {
    const run = runsRef.current.find((r) => r.id === runId);
    if (!run) return;

    if (run.points.length <= 2) {
      // Deleting from a 2-point run deletes the whole run
      handleDeleteRun(runId);
      return;
    }

    const newPoints = run.points.filter((_, i) => i !== vertexIndex);
    const updatedRun = { ...run, points: newPoints };
    setRuns((prev) => prev.map((r) => r.id === runId ? updatedRun : r));
    if (runId > 0 && jobId) {
      window.api.saveTakeoffRun({ ...updatedRun, jobId, sortOrder: runsRef.current.indexOf(run) });
    }
  }, [handleDeleteRun, jobId]);

  const addVertexOnSegment = useCallback((runId: number, segmentIndex: number, point: PdfPoint) => {
    const run = runsRef.current.find((r) => r.id === runId);
    if (!run) return;

    const newPoints = [...run.points];
    newPoints.splice(segmentIndex + 1, 0, { x: point.x, y: point.y });
    const updatedRun = { ...run, points: newPoints };
    setRuns((prev) => prev.map((r) => r.id === runId ? updatedRun : r));
    if (runId > 0 && jobId) {
      window.api.saveTakeoffRun({ ...updatedRun, jobId, sortOrder: runsRef.current.indexOf(run) });
    }
  }, [jobId]);

  // -- Vertex elevation update --

  const updateVertexElevation = useCallback((runId: number, vertexIndex: number, data: { invertElev: number | null; rimElev: number | null; structureType: string | null }) => {
    setRuns((prev) => prev.map((r) => {
      if (r.id !== runId) return r;
      const newPoints = [...r.points];
      newPoints[vertexIndex] = { ...newPoints[vertexIndex], ...data };
      return { ...r, points: newPoints };
    }));

    // Persist to DB if run is saved
    if (runId > 0) {
      window.api.updateTakeoffPoint({
        runId,
        sortOrder: vertexIndex,
        invertElev: data.invertElev,
        rimElev: data.rimElev,
        structureType: data.structureType,
      });
    }
  }, []);

  return {
    runs, activeRunId, selectedRunId, showConfigModal, mousePos, isDrawing,
    interactionMode, movingVertex, movePreviewPos,
    pageRuns, overlayMode, lastRunConfig, editingConfig, canAddRun,
    handleAddRun, handleConfigConfirm, handleConfigCancel,
    handlePointClick, handleRunSelect, handleEditRun, handleDeleteRun,
    handleMouseMove, undoLastPoint, finishActiveRun,
    pendingDeleteId, confirmDelete, cancelDelete,
    updateVertexElevation,
    startMoveVertex, cancelMoveVertex, deleteVertex, addVertexOnSegment,
  };
}
