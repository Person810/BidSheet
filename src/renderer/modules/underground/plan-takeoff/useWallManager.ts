import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffWall, WallConfig, PdfPoint } from './types';
import { WALL_COLOR } from './types';
import { reportSaveError } from './takeoffPersistence';

interface UseWallManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface WallManager {
  walls: TakeoffWall[];
  activeWallId: number | null;
  selectedWallId: number | null;
  showConfigModal: boolean;
  mousePos: PdfPoint | null;
  isDrawing: boolean;
  pendingDeleteId: number | null;

  pageWalls: TakeoffWall[];
  lastWallConfig: WallConfig | null;
  editingConfig: WallConfig | undefined;

  handleAddWall: () => void;
  handleConfigConfirm: (config: WallConfig) => void;
  handleConfigCancel: () => void;
  handlePointClick: (point: PdfPoint) => void;
  handleWallSelect: (wallId: number | null) => void;
  handleEditWall: (wallId: number) => void;
  handleDeleteWall: (wallId: number) => void;
  handleMouseMove: (point: PdfPoint) => void;
  undoLastPoint: () => void;
  finishActiveWall: () => void;
  moveWallVertexTo: (wallId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  reload: () => Promise<void>;
}

function wallToConfig(wall: TakeoffWall): WallConfig {
  return {
    label: wall.label,
    heightFt: wall.heightFt,
    thicknessIn: wall.thicknessIn,
    faces: wall.faces,
    memberSpacingIn: wall.memberSpacingIn,
    materialId: wall.materialId,
    assemblyId: wall.assemblyId,
  };
}

// Module-scoped counter so local IDs stay unique across remounts and never
// collide with the area/run managers' negative IDs within the same session.
let globalNextLocalId = -100000;

export function useWallManager({ jobId, pageNum }: UseWallManagerOptions): WallManager {
  const [walls, setWalls] = useState<TakeoffWall[]>([]);
  const wallsRef = useRef<TakeoffWall[]>([]);
  wallsRef.current = walls;
  const pendingDeletesRef = useRef<Set<number>>(new Set());
  const [activeWallId, setActiveWallId] = useState<number | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<number | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingWallId, setEditingWallId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<PdfPoint | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const isDrawing = activeWallId !== null;

  const reload = useCallback(async () => {
    if (!jobId) { setWalls([]); return; }
    const loaded: TakeoffWall[] = await window.api.listTakeoffWalls(jobId);
    setWalls(loaded);
    setActiveWallId(null);
    setSelectedWallId(null);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  const finishActiveWall = useCallback(() => {
    if (!activeWallId) return;
    const localId = activeWallId;
    const wall = wallsRef.current.find((w) => w.id === localId);
    if (!wall || wall.points.length < 2) {
      // A wall run needs at least 2 vertices — discard incomplete lines
      setWalls((prev) => prev.filter((w) => w.id !== localId));
    } else if (jobId) {
      const payload = { ...wall, jobId, sortOrder: wallsRef.current.indexOf(wall) };
      window.api.saveTakeoffWall(payload).then((result: { id: number }) => {
        const realId = result.id;
        if (pendingDeletesRef.current.has(localId)) {
          pendingDeletesRef.current.delete(localId);
          window.api.deleteTakeoffWall(realId).catch(reportSaveError('wall deletion'));
          setWalls((cur) => cur.filter((w) => w.id !== localId && w.id !== realId));
          return;
        }
        setWalls((cur) => cur.map((w) => w.id === localId ? { ...w, id: realId } : w));
        const latest = wallsRef.current.find((w) => w.id === localId);
        if (latest) {
          window.api.saveTakeoffWall({ ...latest, id: realId, jobId, sortOrder: wallsRef.current.indexOf(latest) })
            .catch(reportSaveError('wall'));
        }
      }).catch(reportSaveError('wall'));
    }
    setActiveWallId(null);
    setMousePos(null);
  }, [activeWallId, jobId]);

  const handleAddWall = useCallback(() => {
    setEditingWallId(null);
    setShowConfigModal(true);
  }, []);

  const handleConfigConfirm = useCallback((config: WallConfig) => {
    if (editingWallId !== null) {
      const updated = wallsRef.current.map((w) =>
        w.id === editingWallId ? { ...w, ...config } : w
      );
      setWalls(updated);
      if (editingWallId > 0 && jobId) {
        const wall = updated.find((w) => w.id === editingWallId);
        if (wall) {
          window.api.saveTakeoffWall({ ...wall, jobId, sortOrder: updated.indexOf(wall) })
            .catch(reportSaveError('wall'));
        }
      }
      setShowConfigModal(false);
      setEditingWallId(null);
      return;
    }

    // Starting a second wall while one is still being drawn used to orphan
    // the first: it stayed in `walls` with its points but never reached the
    // database, so it vanished from the canvas on reload while sendWallsToBid
    // still measured and billed it. The toolbar now refuses the click, but
    // finish (or discard, for a <2-point stub) rather than abandon — any
    // other route into this function gets the same guarantee.
    finishActiveWall();

    const id = globalNextLocalId--;
    const newWall: TakeoffWall = {
      id,
      jobId: jobId ?? 0,
      ...config,
      color: WALL_COLOR,
      pdfPage: pageNum,
      points: [],
    };
    setWalls((prev) => [...prev, newWall]);
    setActiveWallId(id);
    setSelectedWallId(null);
    setShowConfigModal(false);
  }, [editingWallId, pageNum, jobId, finishActiveWall]);

  const handleConfigCancel = useCallback(() => {
    setShowConfigModal(false);
    setEditingWallId(null);
  }, []);

  const handlePointClick = useCallback((point: PdfPoint) => {
    if (!activeWallId) return;
    setWalls((prev) => prev.map((w) =>
      w.id === activeWallId ? { ...w, points: [...w.points, point] } : w
    ));
  }, [activeWallId]);

  const undoLastPoint = useCallback(() => {
    if (!activeWallId) return;
    setWalls((prev) => prev.map((w) => {
      if (w.id !== activeWallId || w.points.length === 0) return w;
      return { ...w, points: w.points.slice(0, -1) };
    }));
  }, [activeWallId]);

  const handleMouseMove = useCallback((point: PdfPoint) => {
    if (activeWallId) setMousePos(point);
  }, [activeWallId]);

  const moveWallVertexTo = useCallback((wallId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => {
    const wall = wallsRef.current.find((w) => w.id === wallId);
    if (!wall || !wall.points[vertexIndex]) return;
    const newPoints = [...wall.points];
    newPoints[vertexIndex] = { x: point.x, y: point.y };
    setWalls((prev) => prev.map((w) =>
      w.id === wallId ? { ...w, points: newPoints } : w
    ));
    if (commit && wallId > 0 && jobId) {
      window.api.saveTakeoffWall({ ...wall, points: newPoints, jobId, sortOrder: wallsRef.current.indexOf(wall) })
        .catch(reportSaveError('wall'));
    }
  }, [jobId]);

  const handleWallSelect = useCallback((wallId: number | null) => {
    if (activeWallId) return;
    setSelectedWallId(wallId);
  }, [activeWallId]);

  const handleEditWall = useCallback((wallId: number) => {
    setEditingWallId(wallId);
    setShowConfigModal(true);
  }, []);

  const handleDeleteWall = useCallback((wallId: number) => {
    setPendingDeleteId(wallId);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId === null) return;
    if (pendingDeleteId > 0) {
      window.api.deleteTakeoffWall(pendingDeleteId).catch(reportSaveError('wall deletion'));
    } else {
      pendingDeletesRef.current.add(pendingDeleteId);
    }
    setWalls((prev) => prev.filter((w) => w.id !== pendingDeleteId));
    if (selectedWallId === pendingDeleteId) setSelectedWallId(null);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedWallId]);

  const cancelDelete = useCallback(() => setPendingDeleteId(null), []);

  const pageWalls = useMemo(() => walls.filter((w) => w.pdfPage === pageNum), [walls, pageNum]);

  const lastWallConfig = useMemo((): WallConfig | null => {
    if (walls.length === 0) return null;
    return { ...wallToConfig(walls[walls.length - 1]), label: '' };
  }, [walls]);

  const editingConfig = useMemo((): WallConfig | undefined => {
    if (editingWallId === null) return undefined;
    const wall = walls.find((w) => w.id === editingWallId);
    return wall ? wallToConfig(wall) : undefined;
  }, [editingWallId, walls]);

  return {
    walls, activeWallId, selectedWallId, showConfigModal, mousePos, isDrawing,
    pendingDeleteId, pageWalls, lastWallConfig, editingConfig,
    handleAddWall, handleConfigConfirm, handleConfigCancel,
    handlePointClick, handleWallSelect, handleEditWall, handleDeleteWall,
    handleMouseMove, undoLastPoint, finishActiveWall, moveWallVertexTo,
    confirmDelete, cancelDelete, reload,
  };
}
