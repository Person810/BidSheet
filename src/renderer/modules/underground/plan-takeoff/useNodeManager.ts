import { useState, useCallback, useMemo, useEffect } from 'react';
import type { TakeoffNode, PdfPoint } from './types';

interface UseNodeManagerOptions {
  jobId: number | null;
  pageNum: number;
}

export interface NodeManager {
  nodes: TakeoffNode[];
  pageNodes: TakeoffNode[];
  createNode: (point: PdfPoint, pdfPage: number, opts?: Partial<TakeoffNode>) => Promise<TakeoffNode>;
  updateNode: (nodeId: number, updates: Partial<TakeoffNode>) => void;
  moveNode: (nodeId: number, newPos: PdfPoint) => void;
  deleteNode: (nodeId: number) => void;
  findNearbyNode: (point: PdfPoint, threshold: number) => TakeoffNode | null;
  getNodeById: (nodeId: number) => TakeoffNode | undefined;
}

let globalNextLocalId = -1;

export function useNodeManager({ jobId, pageNum }: UseNodeManagerOptions): NodeManager {
  const [nodes, setNodes] = useState<TakeoffNode[]>([]);

  useEffect(() => {
    if (!jobId) { setNodes([]); return; }
    window.api.listTakeoffNodes(jobId).then((loaded: TakeoffNode[]) => setNodes(loaded));
  }, [jobId]);

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
    const result = await window.api.saveTakeoffNode(node);
    const saved = { ...node, id: result.id };
    setNodes((cur) => cur.map((n) => n.id === localId ? saved : n));
    return saved;
  }, [jobId]);

  const updateNode = useCallback((nodeId: number, updates: Partial<TakeoffNode>) => {
    setNodes((prev) => prev.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, ...updates };
    }));
    if (nodeId > 0) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) window.api.saveTakeoffNode({ ...node, ...updates });
    }
  }, [nodes]);

  const moveNode = useCallback((nodeId: number, newPos: PdfPoint) => {
    setNodes((prev) => prev.map((n) =>
      n.id === nodeId ? { ...n, xPx: newPos.x, yPx: newPos.y } : n,
    ));
    if (nodeId > 0) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) window.api.saveTakeoffNode({ ...node, xPx: newPos.x, yPx: newPos.y });
    }
  }, [nodes]);

  const deleteNode = useCallback((nodeId: number) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    if (nodeId > 0) window.api.deleteTakeoffNode(nodeId);
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
    findNearbyNode, getNodeById,
  };
}
