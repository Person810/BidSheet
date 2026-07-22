import { useState, useCallback, useEffect, useRef } from 'react';
import type { PdfPoint, SurfacePoint, TakeoffSurface } from './types';
import { reportSaveError } from './takeoffPersistence';

interface UseSurfaceManagerOptions {
  jobId: number | null;
}

export interface SurfaceManager {
  /** The job's single 'existing' surface (spot elevations), or null if none yet. */
  surface: TakeoffSurface | null;
  /** Convenience accessor for the surface's points (empty when no surface). */
  points: SurfacePoint[];
  addSpotElevation: (point: PdfPoint, z: number, pdfPage: number) => void;
  removePoint: (index: number) => void;
  reload: () => Promise<void>;
}

let nextLocalId = -1;

/**
 * Manages the job's existing-ground surface: a single accumulating set of spot
 * elevations that feed the cut/fill TIN and ground pipe runs against real
 * terrain. Writes are optimistic and persisted whole (like areas), since a
 * surface is small and edited a point at a time.
 */
export function useSurfaceManager({ jobId }: UseSurfaceManagerOptions): SurfaceManager {
  const [surface, setSurface] = useState<TakeoffSurface | null>(null);
  const surfaceRef = useRef<TakeoffSurface | null>(null);
  surfaceRef.current = surface;
  // True while a create-save is in flight, so we don't spawn a second surface.
  const creatingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!jobId) { setSurface(null); return; }
    const all: TakeoffSurface[] = await window.api.listTakeoffSurfaces(jobId);
    setSurface(all.find((s) => s.kind === 'existing') ?? null);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  const persist = useCallback((next: TakeoffSurface) => {
    window.api.saveTakeoffSurface(next)
      .then((result: { id: number }) => {
        creatingRef.current = false;
        if (next.id <= 0) {
          // Swap the temp id for the real one, keeping any points added meanwhile.
          setSurface((cur) => cur ? { ...cur, id: result.id } : cur);
          const latest = surfaceRef.current;
          if (latest && latest.id <= 0) {
            const swapped = { ...latest, id: result.id };
            // Keep the ref in step with the swap so an edit landing before
            // the next render doesn't re-create the surface.
            surfaceRef.current = swapped;
            window.api.saveTakeoffSurface(swapped)
              .catch(reportSaveError('surface'));
          }
        }
      })
      .catch((err) => { creatingRef.current = false; reportSaveError('surface')(err); });
  }, []);

  // Derive the next state from surfaceRef (kept current below for rapid
  // successive edits) instead of inside the setSurface updater: updaters must
  // be pure — StrictMode/concurrent React may invoke them twice, which
  // double-fired the save IPC (and double-decremented the temp id) when
  // persist() lived inside them.
  const addSpotElevation = useCallback((point: PdfPoint, z: number, pdfPage: number) => {
    if (!jobId) return;
    const newPoint: SurfacePoint = { x: point.x, y: point.y, z, pdfPage };
    const base: TakeoffSurface = surfaceRef.current ?? {
      id: nextLocalId--, jobId, kind: 'existing', name: 'Existing Grade', points: [],
    };
    const next = { ...base, points: [...base.points, newPoint] };
    surfaceRef.current = next;
    setSurface(next);
    if (next.id <= 0 && creatingRef.current) {
      // create still in flight — local state updates; persist rides the swap
    } else {
      if (next.id <= 0) creatingRef.current = true;
      persist(next);
    }
  }, [jobId, persist]);

  const removePoint = useCallback((index: number) => {
    const cur = surfaceRef.current;
    if (!cur) return;
    const next = { ...cur, points: cur.points.filter((_p, i) => i !== index) };
    surfaceRef.current = next;
    setSurface(next);
    if (next.id > 0) persist(next);
  }, [persist]);

  return {
    surface,
    points: surface?.points ?? [],
    addSpotElevation,
    removePoint,
    reload,
  };
}
