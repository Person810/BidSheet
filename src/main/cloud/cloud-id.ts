/**
 * Cloud job id validation.
 *
 * Lives in its own module, free of any `electron` import, so it can be tested
 * on CI — where the Electron binary is not downloaded and anything that
 * transitively imports `electron` fails to load. Same reason `window-policy.ts`
 * is split out of `main.ts`.
 */

const CLOUD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A cloud job id is a `crypto.randomUUID()` this machine minted — but only for
 * jobs this machine pushed. Ids also arrive from GET /jobs, i.e. from the
 * Worker, which this codebase deliberately models as untrusted (see the
 * validate-snapshot header), and from any org member running a patched client.
 * `pullJob` builds a directory from that id, so an id of `../../..` walks out
 * of the plan store and a plan filename of `.bashrc` then lands wherever it
 * points — code execution on next login, from one click on a job in the sync
 * list.
 *
 * Assert the shape once, at every boundary the id enters through, rather than
 * sanitizing at each use: an id that is not a canonical UUID is not a job this
 * system can have produced, so there is nothing to salvage.
 */
export function assertCloudId(cloudId: unknown): string {
  if (typeof cloudId !== 'string' || !CLOUD_ID_RE.test(cloudId)) {
    throw new Error(`Invalid cloud job id: ${JSON.stringify(cloudId)}`);
  }
  return cloudId;
}
