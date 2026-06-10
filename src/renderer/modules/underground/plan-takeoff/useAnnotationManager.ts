import { useState, useCallback, useMemo, useEffect } from 'react';
import type { TakeoffAnnotation, AnnotationKind, PdfPoint } from './types';
import { ANNOTATION_COLOR } from './types';

interface UseAnnotationManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface AnnotationManager {
  // State
  annotations: TakeoffAnnotation[];
  /** Tool armed and waiting for canvas clicks */
  pendingKind: AnnotationKind | null;
  /** First click of a two-point annotation (arrow/cloud) */
  startPoint: PdfPoint | null;
  mousePos: PdfPoint | null;
  isDrawing: boolean;
  /** Text annotation waiting for its content (point placed, modal open) */
  pendingTextPoint: PdfPoint | null;

  // Derived
  pageAnnotations: TakeoffAnnotation[];

  // Actions
  startAnnotation: (kind: AnnotationKind) => void;
  cancelAnnotation: () => void;
  handlePointClick: (point: PdfPoint) => void;
  handleMouseMove: (point: PdfPoint) => void;
  /** Completes a pending text annotation (or edits an existing one's text) */
  commitText: (text: string, editingId?: number | null) => void;
  deleteAnnotation: (id: number) => void;
  getById: (id: number) => TakeoffAnnotation | undefined;
  reload: () => Promise<void>;
}

// Module-scoped counter so local IDs are unique across remounts
let globalNextLocalId = -1;

export function useAnnotationManager({ jobId, pageNum }: UseAnnotationManagerOptions): AnnotationManager {
  const [annotations, setAnnotations] = useState<TakeoffAnnotation[]>([]);
  const [pendingKind, setPendingKind] = useState<AnnotationKind | null>(null);
  const [startPoint, setStartPoint] = useState<PdfPoint | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);
  const [pendingTextPoint, setPendingTextPoint] = useState<PdfPoint | null>(null);

  const reload = useCallback(async () => {
    if (!jobId) { setAnnotations([]); return; }
    const loaded: TakeoffAnnotation[] = await window.api.listTakeoffAnnotations(jobId);
    setAnnotations(loaded);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  const isDrawing = pendingKind !== null;

  const startAnnotation = useCallback((kind: AnnotationKind) => {
    setPendingKind(kind);
    setStartPoint(null);
    setMousePos(null);
  }, []);

  const cancelAnnotation = useCallback(() => {
    setPendingKind(null);
    setStartPoint(null);
    setMousePos(null);
    setPendingTextPoint(null);
  }, []);

  const saveAnnotation = useCallback((ann: TakeoffAnnotation) => {
    setAnnotations((prev) => [...prev, ann]);
    window.api.saveTakeoffAnnotation(ann).then((result: { id: number }) => {
      setAnnotations((cur) => cur.map((a) => a.id === ann.id ? { ...a, id: result.id } : a));
    });
  }, []);

  const handlePointClick = useCallback((point: PdfPoint) => {
    if (!pendingKind || !jobId) return;

    if (pendingKind === 'text') {
      // Point placed — PlanTakeoff opens the text modal, commitText finishes
      setPendingTextPoint(point);
      setPendingKind(null);
      return;
    }

    if (!startPoint) {
      setStartPoint(point);
      return;
    }

    // Second click completes arrows and clouds
    saveAnnotation({
      id: globalNextLocalId--,
      jobId,
      pdfPage: pageNum,
      kind: pendingKind,
      x1: startPoint.x,
      y1: startPoint.y,
      x2: point.x,
      y2: point.y,
      text: '',
      color: ANNOTATION_COLOR,
    });
    setPendingKind(null);
    setStartPoint(null);
    setMousePos(null);
  }, [pendingKind, startPoint, jobId, pageNum, saveAnnotation]);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (pendingKind && startPoint) setMousePos(point);
  }, [pendingKind, startPoint]);

  const commitText = useCallback((text: string, editingId?: number | null) => {
    if (editingId != null) {
      setAnnotations((prev) => prev.map((a) => {
        if (a.id !== editingId) return a;
        const updated = { ...a, text };
        if (a.id > 0) window.api.saveTakeoffAnnotation(updated);
        return updated;
      }));
      return;
    }
    if (!pendingTextPoint || !jobId) return;
    if (text.trim()) {
      saveAnnotation({
        id: globalNextLocalId--,
        jobId,
        pdfPage: pageNum,
        kind: 'text',
        x1: pendingTextPoint.x,
        y1: pendingTextPoint.y,
        x2: null,
        y2: null,
        text: text.trim(),
        color: ANNOTATION_COLOR,
      });
    }
    setPendingTextPoint(null);
  }, [pendingTextPoint, jobId, pageNum, saveAnnotation]);

  const deleteAnnotation = useCallback((id: number) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    if (id > 0) window.api.deleteTakeoffAnnotation(id);
  }, []);

  const getById = useCallback(
    (id: number) => annotations.find((a) => a.id === id),
    [annotations],
  );

  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.pdfPage === pageNum),
    [annotations, pageNum],
  );

  return {
    annotations, pendingKind, startPoint, mousePos, isDrawing, pendingTextPoint,
    pageAnnotations,
    startAnnotation, cancelAnnotation, handlePointClick, handleMouseMove,
    commitText, deleteAnnotation, getById, reload,
  };
}
