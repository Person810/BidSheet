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
            window.api.saveTakeoffSurface({ ...latest, id: result.id })
              .catch(reportSaveError('surface'));
          }
        }
      })
      .catch((err) => { creatingRef.current = false; reportSaveError('surface')(err); });
  }, []);

  const addSpotElevation = useCallback((point: PdfPoint, z: number, pdfPage: number) => {
    if (!jobId) return;
    const newPoint: SurfacePoint = { x: point.x, y: point.y, z, pdfPage };
    setSurface((cur) => {
      const base: TakeoffSurface = cur ?? {
        id: nextLocalId--, jobId, kind: 'existing', name: 'Existing Grade', points: [],
      };
      const next = { ...base, points: [...base.points, newPoint] };
      // Persist after state derive so the ref/closure sees the new shape.
      if (next.id <= 0 && creatingRef.current) {
        // create still in flight — local state updates; persist rides the swap
      } else {
        if (next.id <= 0) creatingRef.current = true;
        persist(next);
      }
      return next;
    });
  }, [jobId, persist]);

  const removePoint = useCallback((index: number) => {
    setSurface((cur) => {
      if (!cur) return cur;
      const next = { ...cur, points: cur.points.filter((_p, i) => i !== index) };
      if (next.id > 0) persist(next);
      return next;
    });
  }, [persist]);

  return {
    surface,
    points: surface?.points ?? [],
    addSpotElevation,
    removePoint,
    reload,
  };
}
