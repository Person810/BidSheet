import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * Additional pipes/conduits on a Plan Takeoff run (#150) must survive every
 * path a run takes through the database. The run modal, 3D view and Send to
 * Profiles all carried the list, but takeoff_runs had no column for it until
 * V53, so it was silently dropped on save, reload, undo/redo (replace-state)
 * and job duplication.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('./documents', () => ({ removeJobFiles: vi.fn() }));

import { initializeDatabase } from '../database';
import { registerTakeoffHandlers } from './takeoff';
import { registerJobHandlers } from './jobs';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

const PIPES = JSON.stringify([
  { pipeSizeIn: 4, pipeMaterialId: null },
  { pipeSizeIn: 2, pipeMaterialId: null },
]);

function runPayload(jobId: number, extra: Record<string, any> = {}) {
  return {
    jobId, label: 'MH-1 to MH-2', utilityType: 'sewer', pipeSizeIn: 8, pipeMaterial: 'PVC',
    pipeMaterialId: null, startDepthFt: 6, gradePct: 1, trenchWidthFt: 3, benchWidthFt: 0,
    beddingType: '', beddingDepthFt: 0.5, beddingMaterialId: null, backfillType: 'Native Material',
    backfillMaterialId: null, color: '#10b981', sortOrder: 0, pdfPage: 1,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    hddAdditionalPipesJson: PIPES,
    ...extra,
  };
}

describe('takeoff run additional pipes persistence', () => {
  let db: Database.Database;
  let jobId: number;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerTakeoffHandlers(db);
    registerJobHandlers(db);
    jobId = Number(db.prepare("INSERT INTO jobs (name) VALUES ('Canal St Sewer')").run().lastInsertRowid);
  });

  it('round-trips through insert, list and update', async () => {
    const { id } = await call('db:takeoff-runs:save', runPayload(jobId));
    let [run] = await call('db:takeoff-runs:list', jobId);
    expect(run.hddAdditionalPipesJson).toBe(PIPES);

    await call('db:takeoff-runs:save', runPayload(jobId, { id, hddAdditionalPipesJson: null }));
    [run] = await call('db:takeoff-runs:list', jobId);
    expect(run.hddAdditionalPipesJson).toBeNull();
  });

  it('survives an undo/redo state replace', async () => {
    const { id } = await call('db:takeoff-runs:save', runPayload(jobId));
    const runs = await call('db:takeoff-runs:list', jobId);
    await call('db:takeoff:replace-state', jobId, {
      nodes: [], runs, items: [], areas: [], walls: [], annotations: [],
    });
    const [run] = await call('db:takeoff-runs:list', jobId);
    expect(run.id).toBe(id);
    expect(run.hddAdditionalPipesJson).toBe(PIPES);
  });

  it('is carried into a duplicated job', async () => {
    await call('db:takeoff-runs:save', runPayload(jobId));
    const { newJobId } = await call('db:jobs:duplicate', jobId, 'Copy');
    const [run] = await call('db:takeoff-runs:list', newJobId);
    expect(run.hddAdditionalPipesJson).toBe(PIPES);
  });
});
