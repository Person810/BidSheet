#!/usr/bin/env node
/**
 * Headless end-to-end test of Phase 3 desktop sync.
 *
 * Simulates two computers on one account:
 *   machine 1: create a job (bid + takeoff + plan PDF) → enable sync → push
 *   machine 2: discover the cloud job → pull → verify everything arrived
 *   then: edit on 1 → sync both ways; edit on BOTH → expect a conflict →
 *   resolve by keeping the cloud copy.
 *
 * Auth is real (Supabase signup + TOTP enroll, codes computed in-process per
 * RFC 6238). The Worker API defaults to the deployed URL; point
 * BIDSHEET_CLOUD_API_URL at a local `wrangler dev` to test pre-deploy.
 *
 * Run from the repo root after `npm run build:main`:
 *   BIDSHEET_CLOUD_API_URL=http://localhost:8787 node scripts/cloud-sync-e2e.js
 */

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ---- electron stub so the compiled main-process modules load under plain node ----
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bidsheet-e2e-'));
const electronStub = {
  app: {
    getPath: (name) => {
      const dir = path.join(tmpRoot, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    getVersion: () => '0.0.0-e2e',
    isPackaged: true,
  },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {} },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  // The repo's better-sqlite3 is compiled for Electron's ABI; under plain
  // node, point at a node-ABI copy (BS3_NODE_PATH=/path/to/node_modules/better-sqlite3).
  if (request === 'better-sqlite3' && process.env.BS3_NODE_PATH) {
    return origLoad.call(this, process.env.BS3_NODE_PATH, ...rest);
  }
  return origLoad.call(this, request, ...rest);
};

const { initializeDatabase } = require('../dist/main/database');
const { CloudAuth } = require('../dist/main/cloud/supabase-auth');
const { CloudApiClient } = require('../dist/main/cloud/api-client');
const { SyncEngine } = require('../dist/main/cloud/sync-engine');
const { exportJob } = require('../dist/main/cloud/serializer');

// ---- TOTP (RFC 6238) ----
function base32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, offsetWindows = 0) {
  const counter = Math.floor(Date.now() / 30000) + offsetWindows;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(off) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function seedJob(db) {
  const j = db.prepare(
    `INSERT INTO jobs (name, job_number, client, location, status, overhead_percent, profit_percent)
     VALUES ('Elm St Sewer Extension', 'E2E-001', 'ACME GC', 'Las Vegas, NV', 'draft', 12, 8)`
  ).run();
  const jobId = Number(j.lastInsertRowid);
  const s = db.prepare(`INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, 'Sewer Main', 0)`).run(jobId);
  const sectionId = Number(s.lastInsertRowid);
  db.prepare(
    `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, labor_total, total_cost, unit_cost)
     VALUES (?, ?, '8in SDR-35 0-6ft', 450, 'LF', 9000, 24750, 55)`
  ).run(sectionId, jobId);
  db.prepare(
    `INSERT INTO trench_profiles (job_id, label, pipe_size_in, start_depth_ft, run_length_lf) VALUES (?, 'Main run', 8, 6, 450)`
  ).run(jobId);
  db.prepare(`INSERT INTO quotes (job_id, scope, vendor, amount) VALUES (?, 'Dewatering', 'PumpCo', 12500)`).run(jobId);
  const n = db.prepare(`INSERT INTO takeoff_nodes (job_id, x_px, y_px, structure_type, label) VALUES (?, 100, 100, 'manhole', 'MH-1')`).run(jobId);
  const r = db.prepare(`INSERT INTO takeoff_runs (job_id, label, pipe_size_in, pdf_page) VALUES (?, 'Run A', 8, 1)`).run(jobId);
  const runId = Number(r.lastInsertRowid);
  db.prepare(`INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order, node_id) VALUES (?, 100, 100, 0, ?)`)
    .run(runId, Number(n.lastInsertRowid));
  db.prepare(`INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order) VALUES (?, 400, 250, 1)`).run(runId);
  db.prepare(`INSERT INTO takeoff_annotations (job_id, pdf_page, kind, x1_px, y1_px, text) VALUES (?, 1, 'text', 50, 50, 'Tie-in here')`).run(jobId);
  db.prepare(`INSERT INTO takeoff_page_scales (job_id, page_number, scale_px_per_ft) VALUES (?, 1, 4.2)`).run(jobId);
  // plan "PDF"
  const planPath = path.join(tmpRoot, 'elm-st-plans.pdf');
  fs.writeFileSync(planPath, crypto.randomBytes(48 * 1024));
  db.prepare(`INSERT INTO takeoff_job_settings (job_id, pdf_path) VALUES (?, ?)`).run(jobId, planPath);
  return { jobId, planPath };
}

(async () => {
  const apiUrl = process.env.BIDSHEET_CLOUD_API_URL || 'https://bidsheet-api.lm-wiley.workers.dev';
  const email = process.env.E2E_EMAIL || `phase3-e2e-${Date.now()}@bidsheet.co`;
  const password = process.env.E2E_PASSWORD || `E2e!${crypto.randomBytes(9).toString('base64url')}aA1`;
  console.log(`API: ${apiUrl}`);
  console.log(`User: ${email}`);

  console.log('\n1. Machine 1: open database, seed a job');
  const db1 = initializeDatabase(path.join(tmpRoot, 'machine1.db'));
  const { jobId, planPath } = seedJob(db1);
  check('job seeded', !!jobId);

  console.log('\n2. Sign up + enroll TOTP + verify (aal2)');
  const auth1 = new CloudAuth(db1);
  let st = await auth1.signUp(email, password);
  check('signup → aal1 session', st.signedIn && st.aal === 'aal1');
  const enroll = await auth1.enrollTotp();
  check('TOTP enroll returned secret + QR', !!enroll.secret && enroll.qrCode.startsWith('data:'));
  try {
    st = await auth1.verifyTotp(totp(enroll.secret), enroll.factorId);
  } catch {
    st = await auth1.verifyTotp(totp(enroll.secret, 1), enroll.factorId); // clock edge
  }
  check('verify → aal2', st.aal === 'aal2');

  console.log('\n3. Machine 1: enable sync (pushes job, plan, markup)');
  const engine1 = new SyncEngine(db1, auth1, new CloudApiClient(auth1));
  await engine1.enableJob(jobId);
  const ov1 = engine1.overview();
  check('job status synced', ov1.jobs[0]?.status === 'synced', JSON.stringify(ov1.jobs[0]));
  const cloudId = db1.prepare('SELECT cloud_id FROM jobs WHERE id = ?').get(jobId).cloud_id;
  check('cloud id assigned', !!cloudId);

  console.log('\n4. Machine 2: fresh database, same account → discover + pull');
  const db2 = initializeDatabase(path.join(tmpRoot, 'machine2.db'));
  const auth2 = new CloudAuth(db2);
  await auth2.signIn(email, password);
  st = await auth2.verifyTotp(totp(enroll.secret)).catch(() => auth2.verifyTotp(totp(enroll.secret, 1)));
  check('machine 2 at aal2', st.aal === 'aal2');
  const engine2 = new SyncEngine(db2, auth2, new CloudApiClient(auth2));
  let ov2 = await engine2.checkAll();
  check('cloud-only job visible', ov2.cloudOnly.length === 1 && ov2.cloudOnly[0].name === 'Elm St Sewer Extension', JSON.stringify(ov2.cloudOnly));
  const localId2 = await engine2.pullJob(cloudId);

  const job2 = db2.prepare('SELECT * FROM jobs WHERE id = ?').get(localId2);
  check('pulled job fields', job2.name === 'Elm St Sewer Extension' && job2.client === 'ACME GC' && job2.job_number === 'E2E-001');
  const counts = (db, id) => ({
    sections: db.prepare('SELECT COUNT(*) c FROM bid_sections WHERE job_id = ?').get(id).c,
    items: db.prepare('SELECT COUNT(*) c FROM bid_line_items WHERE job_id = ?').get(id).c,
    runs: db.prepare('SELECT COUNT(*) c FROM takeoff_runs WHERE job_id = ?').get(id).c,
    points: db.prepare('SELECT COUNT(*) c FROM takeoff_points p JOIN takeoff_runs r ON r.id = p.run_id WHERE r.job_id = ?').get(id).c,
    nodes: db.prepare('SELECT COUNT(*) c FROM takeoff_nodes WHERE job_id = ?').get(id).c,
    annotations: db.prepare('SELECT COUNT(*) c FROM takeoff_annotations WHERE job_id = ?').get(id).c,
    scales: db.prepare('SELECT COUNT(*) c FROM takeoff_page_scales WHERE job_id = ?').get(id).c,
    profiles: db.prepare('SELECT COUNT(*) c FROM trench_profiles WHERE job_id = ?').get(id).c,
    quotes: db.prepare('SELECT COUNT(*) c FROM quotes WHERE job_id = ?').get(id).c,
  });
  check('child row counts match', JSON.stringify(counts(db1, jobId)) === JSON.stringify(counts(db2, localId2)),
    `m1=${JSON.stringify(counts(db1, jobId))} m2=${JSON.stringify(counts(db2, localId2))}`);
  const li2 = db2.prepare('SELECT * FROM bid_line_items WHERE job_id = ?').get(localId2);
  check('line item costs intact', li2.total_cost === 24750 && li2.labor_total === 9000);
  const point2 = db2.prepare(
    'SELECT p.* FROM takeoff_points p JOIN takeoff_runs r ON r.id = p.run_id WHERE r.job_id = ? AND p.sort_order = 0'
  ).get(localId2);
  check('point→node link remapped', point2.node_id !== null);
  const pdf2 = db2.prepare('SELECT pdf_path FROM takeoff_job_settings WHERE job_id = ?').get(localId2);
  check('plan downloaded + bytes identical',
    pdf2?.pdf_path && fs.existsSync(pdf2.pdf_path) &&
    fs.readFileSync(pdf2.pdf_path).equals(fs.readFileSync(planPath)));

  console.log('\n5. Edit on machine 1 → push → machine 2 pulls the change');
  db1.prepare(`UPDATE jobs SET name = 'Elm St Sewer Extension REV2' WHERE id = ?`).run(jobId);
  await engine1.checkAll();
  ov2 = await engine2.checkAll();
  const renamed = db2.prepare('SELECT name FROM jobs WHERE id = ?').get(localId2);
  check('rename propagated', renamed.name === 'Elm St Sewer Extension REV2', renamed.name);
  check('machine 2 synced after pull', ov2.jobs.find((j) => j.jobId === localId2)?.status === 'synced');

  console.log('\n6. Edit on BOTH machines → conflict → resolve with cloud copy');
  db1.prepare(`UPDATE jobs SET notes = 'machine 1 note' WHERE id = ?`).run(jobId);
  db2.prepare(`UPDATE jobs SET notes = 'machine 2 note' WHERE id = ?`).run(localId2);
  await engine1.checkAll(); // machine 1 pushes its edit first
  ov2 = await engine2.checkAll();
  const conflictRow = ov2.jobs.find((j) => j.jobId === localId2);
  check('conflict detected on machine 2', conflictRow?.status === 'conflict', JSON.stringify(conflictRow));
  await engine2.resolveConflict(localId2, 'cloud');
  const notes2 = db2.prepare('SELECT notes FROM jobs WHERE id = ?').get(localId2);
  check('cloud copy won', notes2.notes === 'machine 1 note', notes2.notes);
  check('machine 2 synced after resolve', engine2.overview().jobs.find((j) => j.jobId === localId2)?.status === 'synced');

  console.log('\n7. No-change sync pass is a no-op');
  const before = db2.prepare('SELECT last_hash_local, last_hash_remote FROM cloud_sync_state WHERE job_id = ?').get(localId2);
  ov2 = await engine2.checkAll();
  const after = db2.prepare('SELECT last_hash_local, last_hash_remote FROM cloud_sync_state WHERE job_id = ?').get(localId2);
  check('hashes stable across idle pass', JSON.stringify(before) === JSON.stringify(after));

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
  console.log(`(test user to clean up in Supabase: ${email})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nUNCAUGHT:', err);
  process.exit(1);
});
