import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { TakeoffNode, PdfPoint } from './types';
import { reportSaveError } from './takeoffPersistence';

interface UseNodeManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface NodeManager {
  nodes: TakeoffNode[];
  pageNodes: TakeoffNode[];
  createNode: (point: PdfPoint, pdfPage: number, opts?: Partial<TakeoffNode>) => Promise<TakeoffNode>;
  updateNode: (nodeId: number, updates: Partial<TakeoffNode>) => void;
  moveNode: (nodeId: number, newPos: PdfPoint, opts?: { persist?: boolean }) => void;
  deleteNode: (nodeId: number) => void;
  findNearbyNode: (point: PdfPoint, threshold: number) => TakeoffNode | null;
  getNodeById: (nodeId: number) => TakeoffNode | undefined;
  /** Re-fetch state from the DB (used by undo/redo restore) */
  reload: () => Promise<void>;
}

let globalNextLocalId = -1;

export function useNodeManager({ jobId, pageNum }: UseNodeManagerOptions): NodeManager {
  const [nodes, setNodes] = useState<TakeoffNode[]>([]);
  const nodesRef = useRef<TakeoffNode[]>([]);
  nodesRef.current = nodes;
  // Local ids of nodes deleted while their create-save was in flight.
  const pendingDeletesRef = useRef<Set<number>>(new Set());

  const reload = useCallback(async () => {
    if (!jobId) { setNodes([]); return; }
    const loaded: TakeoffNode[] = await window.api.listTakeoffNodes(jobId);
    setNodes(loaded);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  const pageNodes = useMemo(() => nodes.filter((n) => n.pdfPage === pageNum), [nodes, pageNum]);

  const createNode = useCallback(async (point: PdfPoint, pdfPage: number, opts?: Partial<TakeoffNode>): Promise<TakeoffNode> => {
    if (!jobId) throw new Error('No job');
    const localId = globalNextLocalId--;
    const node: TakeoffNode = {
      id: localId,
      jobId,
      xPx: point.x,
      yPx: point.y,
      pdfPage,
      invertElev: opts?.invertElev ?? null,
      rimElev: opts?.rimElev ?? null,
      structureType: opts?.structureType ?? null,
      label: opts?.label ?? '',
    };
    setNodes((prev) => [...prev, node]);
    let result: { id: number };
    try {
      result = await window.api.saveTakeoffNode(node);
    } catch (err) {
      // Keep the optimistic node locally so drawing doesn't crash, but surface
      // the failure — it won't have persisted.
      reportSaveError('junction node')(err);
      return node;
    }
    const realId = result.id;
    if (pendingDeletesRef.current.has(localId)) {
      pendingDeletesRef.current.delete(localId);
      window.api.deleteTakeoffNode(realId).catch(reportSaveError('node deletion'));
      setNodes((cur) => cur.filter((n) => n.id !== localId && n.id !== realId));
      return { ...node, id: realId };
    }
    const saved = { ...node, id: realId };
    setNodes((cur) => cur.map((n) => n.id === localId ? saved : n));
    // Re-persist any move/edit the id>0 guard skipped while mid-save.
    const latest = nodesRef.current.find((n) => n.id === localId);
    if (latest) {
      window.api.saveTakeoffNode({ ...latest, id: realId }).catch(reportSaveError('junction node'));
    }
    return saved;
  }, [jobId]);

  const updateNode = useCallback((nodeId: number, updates: Partial<TakeoffNode>) => {
    setNodes((prev) => prev.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, ...updates };
    }));
    if (nodeId > 0) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) window.api.saveTakeoffNode({ ...node, ...updates }).catch(reportSaveError('junction node'));
    }
  }, [nodes]);

  const moveNode = useCallback((nodeId: number, newPos: PdfPoint, opts?: { persist?: boolean }) => {
    setNodes((prev) => prev.map((n) =>
      n.id === nodeId ? { ...n, xPx: newPos.x, yPx: newPos.y } : n,
    ));
    // persist: false supports live drag previews — call again with true on release
    if ((opts?.persist ?? true) && nodeId > 0) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        window.api.saveTakeoffNode({ ...node, xPx: newPos.x, yPx: newPos.y }).catch(reportSaveError('junction node'));
      }
    }
  }, [nodes]);

  const deleteNode = useCallback((nodeId: number) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    if (nodeId > 0) {
      window.api.deleteTakeoffNode(nodeId).catch(reportSaveError('node deletion'));
    } else {
      // Still mid-create: defer to the create-save completion.
      pendingDeletesRef.current.add(nodeId);
    }
  }, []);

  const findNearbyNode = useCallback((point: PdfPoint, threshold: number): TakeoffNode | null => {
    let closest: TakeoffNode | null = null;
    let closestDist = threshold;
    for (const node of pageNodes) {
      const dx = node.xPx - point.x;
      const dy = node.yPx - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = node;
      }
    }
    return closest;
  }, [pageNodes]);

  const getNodeById = useCallback((nodeId: number): TakeoffNode | undefined => {
    return nodes.find((n) => n.id === nodeId);
  }, [nodes]);

  return {
    nodes, pageNodes,
    createNode, updateNode, moveNode, deleteNode,
    findNearbyNode, getNodeById, reload,
  };
}
