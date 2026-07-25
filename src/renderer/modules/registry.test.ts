import { describe, it, expect } from 'vitest';
import {
  currentToolSelection,
  getActiveModules,
  getAllTools,
  resolveToolGroups,
} from './registry';

const TRENCH = 'trench-profiler';
const CONCRETE = 'concrete-calculator';

describe('getActiveModules', () => {
  it('maps both underground trades to a single module', () => {
    const mods = getActiveModules('water_sewer,storm_drain');
    expect(mods.map((m) => m.id)).toEqual(['underground']);
  });

  it('ignores unknown and blank trade keys', () => {
    expect(getActiveModules('roofing, ,concrete').map((m) => m.id)).toEqual(['concrete']);
    expect(getActiveModules('')).toEqual([]);
  });
});

describe('getAllTools', () => {
  it('lists every tool with its module, whatever the trades are', () => {
    const ids = getAllTools().map((entry) => entry.tool.id);
    expect(ids).toContain(TRENCH);
    expect(ids).toContain(CONCRETE);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getAllTools().every((entry) => entry.moduleName !== '')).toBe(true);
  });
});

describe('resolveToolGroups', () => {
  it('falls back to trade-derived groups when nothing was picked', () => {
    const groups = resolveToolGroups('water_sewer', null);
    expect(groups.map((g) => g.id)).toEqual(['underground']);
    expect(groups[0].tools.map((t) => t.id)).toEqual([TRENCH]);
  });

  it('treats undefined like null, for a row saved before the column existed', () => {
    expect(resolveToolGroups('concrete', undefined).map((g) => g.id)).toEqual(['concrete']);
  });

  it('puts a hand-picked selection in one Tools group', () => {
    const groups = resolveToolGroups('water_sewer', `${CONCRETE},${TRENCH}`);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Tools');
    // Sorted by name, so the group reads the same however it was saved.
    expect(groups[0].tools.map((t) => t.id)).toEqual([CONCRETE, TRENCH]);
  });

  it('lets a picked tool outrank the trades that would have hidden it', () => {
    // Only the concrete trade is seeded, but the user asked for the trench tool.
    const groups = resolveToolGroups('concrete', TRENCH);
    expect(groups[0].tools.map((t) => t.id)).toEqual([TRENCH]);
  });

  it('shows no group at all when the user picked nothing', () => {
    expect(resolveToolGroups('water_sewer,concrete', '')).toEqual([]);
  });

  it('drops ids that no longer exist instead of rendering dead links', () => {
    const groups = resolveToolGroups('', `${TRENCH},retired-tool`);
    expect(groups[0].tools.map((t) => t.id)).toEqual([TRENCH]);
    expect(resolveToolGroups('', 'retired-tool')).toEqual([]);
  });
});

describe('currentToolSelection', () => {
  it('starts from the trade-derived tools when nothing was picked', () => {
    expect(currentToolSelection('water_sewer', null)).toEqual([TRENCH]);
    expect(currentToolSelection('water_sewer,concrete', null))
      .toEqual([TRENCH, CONCRETE]);
  });

  it('returns the saved picks once there are any', () => {
    expect(currentToolSelection('water_sewer', CONCRETE)).toEqual([CONCRETE]);
  });

  it('distinguishes "picked nothing" from "never picked"', () => {
    expect(currentToolSelection('water_sewer', '')).toEqual([]);
    expect(currentToolSelection('water_sewer', null)).toEqual([TRENCH]);
  });

  it('filters out stale ids so the picker never ticks a missing tool', () => {
    expect(currentToolSelection('', `retired-tool,${CONCRETE}`)).toEqual([CONCRETE]);
  });
});
