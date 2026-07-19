/**
 * The active unit system (#97), loaded once at app start and updated when
 * Settings saves. Metric is display-only: components convert with
 * shared/unitSystem.ts at the input/render boundary; stored data and the calc
 * engines stay imperial.
 *
 * Usage:
 *   const system = useUnitSystem();          // 'imperial' | 'metric'
 *   formatQty(result.excavationCY, 'cy', system)
 */

import { create } from 'zustand';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../../shared/unitSystem';

interface UnitsState {
  unitSystem: UnitSystem;
  /** Set from App's settings load and from Settings on save. */
  setUnitSystem: (system: UnitSystem) => void;
}

export const useUnitsStore = create<UnitsState>((set) => ({
  unitSystem: DEFAULT_UNIT_SYSTEM,
  setUnitSystem: (system: UnitSystem) => set({ unitSystem: system }),
}));

/** The current unit system, for render-boundary conversion. */
export function useUnitSystem(): UnitSystem {
  return useUnitsStore((s) => s.unitSystem);
}
