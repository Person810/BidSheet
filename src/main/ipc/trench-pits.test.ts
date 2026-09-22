import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * Trench/bore pits (#149): the job's pit list and each profile's start/end
 * pit links must persist, sanitize renderer input, and survive job duplicate
 * with the links still pointing at the copied pits.
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

const PITS = [
  { id: 'p1', label: 'Launch A', widthFt: 4, lengthFt: 8, depthFt: 6 },
  { id: 'p2', label: 'Bend @ Elm', widthFt: 4, lengthFt: 6, depthFt: 5.5 },
];

function profile(jobId: number, extra: Record<string, any> = {}) {
  return {
    jobId, label: 'Run 1', pipeSizeIn: 8, pipeMaterial: 'PVC', startDepthFt: 5, gradePct: 1,
    runLengthLF: 100, trenchWidthFt: 3, benchWidthFt: 0, beddingDepthFt: 0.5,
    backfillType: 'Native Material', method: 'open_cut', ...extra,
  };
}

describe('trench pits', () => {
  let db: Database.Database;
  let jobId: number;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerTakeoffHandlers(db);
    registerJobHandlers(db);
    jobId = Number(db.prepare("INSERT INTO jobs (name) VALUES ('Canal St Sewer')").run().lastInsertRowid);
  });

  it('saves and reads back the job pit list', async () => {
    expect(await call('db:trench-pits:get', jobId)).toEqual([]);
    await call('db:trench-pits:save', jobId, PITS);
    expect(await call('db:trench-pits:get', jobId)).toEqual(PITS);
  });

  it('sanitizes what the renderer sends', async () => {
    const saved = await call('db:trench-pits:save', jobId, [
      { id: 'p1', label: 'ok', widthFt: 4, lengthFt: 6, depthFt: 5, extra: 'dropped' },
      { label: 'no id' },
      { id: 'p1', label: 'duplicate id' },
    ]);
    expect(saved).toEqual([{ id: 'p1', label: 'ok', widthFt: 4, lengthFt: 6, depthFt: 5 }]);
    await expect(call('db:trench-pits:save', 99999, PITS)).rejects.toThrow();
  });

  it('stores each profile\'s start and end pit links', async () => {
    const { id } = await call('db:trench-profiles:save', profile(jobId, { startPitId: 'p1', endPitId: 'p2' }));
    let [row] = await call('db:trench-profiles:list', jobId);
    expect([row.start_pit_id, row.end_pit_id]).toEqual(['p1', 'p2']);

    await call('db:trench-profiles:save', profile(jobId, { id, startPitId: '', endPitId: null }));
    [row] = await call('db:trench-profiles:list', jobId);
    expect([row.start_pit_id, row.end_pit_id]).toEqual([null, null]);
  });

  it('duplicating a job copies the pits and keeps profile links valid', async () => {
    await call('db:trench-pits:save', jobId, PITS);
    await call('db:trench-profiles:save', profile(jobId, { startPitId: 'p1', endPitId: 'p2' }));
    const { newJobId } = await call('db:jobs:duplicate', jobId, 'Copy');

    expect(await call('db:trench-pits:get', newJobId)).toEqual(PITS);
    const [row] = await call('db:trench-profiles:list', newJobId);
    expect([row.start_pit_id, row.end_pit_id]).toEqual(['p1', 'p2']);
  });
});
