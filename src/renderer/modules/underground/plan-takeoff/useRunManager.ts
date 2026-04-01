import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffRun, RunConfig, PdfPoint, OverlayMode } from './types';
import { UTILITY_COLORS } from './types';

interface UseRunManagerOptions {
  jobId: number | null;
  pageNum: number;
  calibrating: boolean;
  calibrationHandlePointClick: (point: PdfPoint) => void;
}

export interface RunManager {
  // State
  runs: TakeoffRun[];
  activeRunId: number | null;
  selectedRunId: number | null;
  showConfigModal: boolean;
  mousePos: PdfPoint | null;
  isDrawing: boolean;
  pendingDeleteId: number | null;

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

export function useRunManager({
  jobId, pageNum, calibrating, calibrationHandlePointClick,
}: UseRunManagerOptions): RunManager {
  const nextLocalId = useRef(-1);
  const [runs, setRuns] = useState<TakeoffRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingRunId, setEditingRunId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);

  const isDrawing = activeRunId !== null;

  // Load runs from DB when job changes
  useEffect(() => {
    if (!jobId) { setRuns([]); return; }
    window.api.listTakeoffRuns(jobId).then((loaded: TakeoffRun[]) => {
      setRuns(loaded);
      setActiveRunId(null);
      setSelectedRunId(null);
    }).catch(console.error);
  }, [jobId]);

  // -- Finish / discard active run --

  const finishActiveRun = useCallback(() => {
    if (!activeRunId) return;
    setRuns((prev) => {
      const run = prev.find((r) => r.id === activeRunId);
      if (!run || run.points.length < 2) return prev.filter((r) => r.id !== activeRunId);

      // Save completed run to DB
      if (jobId && run.points.length >= 2) {
        const payload = { ...run, jobId, sortOrder: prev.indexOf(run) };
        window.api.saveTakeoffRun(payload).then((result: { id: number }) => {
          setRuns((cur) => cur.map((r) => r.id === activeRunId ? { ...r, id: result.id } : r));
        }).catch(console.error);
      }

      return prev;
    });
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
            window.api.saveTakeoffRun({ ...run, jobId, sortOrder: updated.indexOf(run) }).catch(console.error);
          }
        }

        return updated;
      });
      setShowConfigModal(false);
      setEditingRunId(null);
      return;
    }

    const id = nextLocalId.current--;
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
    if (!activeRunId) return;

    setRuns((prev) => prev.map((r) =>
      r.id === activeRunId ? { ...r, points: [...r.points, point] } : r
    ));
  }, [calibrating, calibrationHandlePointClick, activeRunId]);

  const undoLastPoint = useCallback(() => {
    if (!activeRunId) return;
    setRuns((prev) => prev.map((r) => {
      if (r.id !== activeRunId || r.points.length === 0) return r;
      return { ...r, points: r.points.slice(0, -1) };
    }));
  }, [activeRunId]);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (activeRunId) setMousePos(point);
  }, [activeRunId]);

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
      window.api.deleteTakeoffRun(pendingDeleteId).catch(console.error);
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

  const overlayMode: OverlayMode = activeRunId ? 'draw' : 'none';

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

  return {
    runs, activeRunId, selectedRunId, showConfigModal, mousePos, isDrawing,
    pageRuns, overlayMode, lastRunConfig, editingConfig, canAddRun,
    handleAddRun, handleConfigConfirm, handleConfigCancel,
    handlePointClick, handleRunSelect, handleEditRun, handleDeleteRun,
    handleMouseMove, undoLastPoint, finishActiveRun,
    pendingDeleteId, confirmDelete, cancelDelete,
  };
}
