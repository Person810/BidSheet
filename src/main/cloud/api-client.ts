/**
 * Thin client for the BidSheet Worker API (Phase 3).
 *
 * Every call carries a fresh aal2 JWT from CloudAuth. R2 keys follow
 * accountId/jobId/<plans|markup|job>/<filename>; the Worker enforces that
 * accountId matches the token's account.
 */

import type { CloudAuth } from './supabase-auth';
import { CLOUD_API_URL } from './config';

export interface CloudJob {
  id: string;
  account_id: string;
  /** Non-content placeholder under E2EE; the real name is in name_enc. */
  name: string;
  /** Encrypted {name, status} blob (base64) — decrypted client-side. */
  name_enc: string | null;
  status: string | null;
  lifecycle_state: string;
  synced: number;
  updated_at: string | null;
  snapshot_hash: string | null;
  created_at: string;
  file_count: number;
  bytes_used: number;
}

export interface CloudAccount {
  id: string;
  name: string;
  plan: string;
  storage_bytes_used: number;
  storage_cap_bytes: number;
  /** trial | active | past_due | canceled | comped */
  subscription_status: string;
  trial_ends_at: string | null;
}

export interface CloudCatalogMeta {
  hash: string | null;
  size_bytes: number;
  updated_at: string;
}

export interface CloudBackupMeta {
  account_id: string;
  size_bytes: number;
  app_version: string | null;
  schema_version: number | null;
  created_at: string;
}

/** The account's wrapped DEK — opaque to the server (zero-knowledge). */
export interface KeyMaterial {
  format: number;
  wrapped_dek: string;
  dek_fingerprint: string;
}

export class CloudApiError extends Error {
  constructor(message: string, public httpStatus: number, public code?: string) {
    super(message);
  }
}

export class CloudApiClient {
  constructor(private auth: CloudAuth) {}

  private async request(
    path: string,
    opts: { method?: string; body?: string | Buffer; contentType?: string } = {}
  ): Promise<Response> {
    const token = await this.auth.getAccessToken();
    let res: Response;
    try {
      res = await fetch(`${CLOUD_API_URL}${path}`, {
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
        },
        body: opts.body as any,
      });
    } catch {
      throw new CloudApiError('Could not reach the cloud. Check your internet connection.', 0);
    }
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const code = data.code;
      const msg =
        code === 'mfa_required'
          ? 'Cloud session needs a new authenticator code. Open Settings → Cloud Sync.'
          : code === 'storage_cap_exceeded'
            ? 'Cloud storage is full. Turn off sync for old jobs to free space — they stay on this computer.'
            : code === 'subscription_required'
              ? 'Cloud subscription needed — your free trial has ended. Subscribe in Settings → Cloud Sync; your synced data is still there to download.'
              : data.error || `Cloud API error (HTTP ${res.status}).`;
      throw new CloudApiError(msg, res.status, code);
    }
    return res;
  }

  async me(): Promise<{ user_id: string; email: string; account: CloudAccount }> {
    return (await this.request('/me')).json() as any;
  }

  /** Paddle hosted-checkout URL for the $20/mo subscription. */
  async checkout(): Promise<string> {
    const data: any = await (await this.request('/billing/checkout', { method: 'POST' })).json();
    return data.checkout_url;
  }

  /** Paddle customer-portal URL (manage card, cancel). */
  async billingPortal(): Promise<string> {
    const data: any = await (await this.request('/billing/portal', { method: 'POST' })).json();
    return data.portal_url;
  }

  async listJobs(): Promise<CloudJob[]> {
    return (await this.listSync()).jobs;
  }

  /**
   * The account's whole sync surface in one request: every job's
   * snapshot_hash plus the catalog meta — the §8 "anything changed?" check.
   */
  async listSync(): Promise<{ jobs: CloudJob[]; catalog: CloudCatalogMeta | null }> {
    const data: any = await (await this.request('/jobs')).json();
    return { jobs: data.jobs as CloudJob[], catalog: data.catalog ?? null };
  }

  // ---- catalog snapshot (Phase 3d) ----
  // Body is BSE1 ciphertext (encrypted client-side); the Worker stores it
  // opaquely. `hash` is the (HMAC) change-detection tag, opaque to the server.

  async putCatalog(body: Buffer, hash: string): Promise<void> {
    await this.request(`/catalog?hash=${encodeURIComponent(hash)}`, {
      method: 'PUT',
      body,
      contentType: 'application/octet-stream',
    });
  }

  async getCatalog(): Promise<Buffer> {
    const res = await this.request('/catalog');
    return Buffer.from(await res.arrayBuffer());
  }

  async putJob(
    cloudJobId: string,
    body: { name_enc: string; status?: string | null; snapshot_hash: string }
  ): Promise<void> {
    await this.request(`/jobs/${encodeURIComponent(cloudJobId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  async putFile(key: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.request(`/files/${encodeKey(key)}`, {
      method: 'PUT',
      body,
      contentType,
    });
  }

  async getFile(key: string): Promise<Buffer> {
    const res = await this.request(`/files/${encodeKey(key)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getFileJson<T>(key: string): Promise<T> {
    return (await this.request(`/files/${encodeKey(key)}`)).json() as Promise<T>;
  }

  async deleteFile(key: string): Promise<void> {
    await this.request(`/files/${encodeKey(key)}`, { method: 'DELETE' });
  }

  // ---- encrypted whole-DB backup (Phase 3a) ----
  // The body is ciphertext before it gets here; the Worker stores it as an
  // opaque blob and only ever returns it to this account.

  async putBackup(body: Buffer, appVersion: string, schemaVersion: number): Promise<void> {
    const params = new URLSearchParams({
      app_version: appVersion,
      schema_version: String(schemaVersion),
    });
    await this.request(`/backup?${params}`, {
      method: 'PUT',
      body,
      contentType: 'application/octet-stream',
    });
  }

  async getBackup(): Promise<Buffer> {
    const res = await this.request('/backup');
    return Buffer.from(await res.arrayBuffer());
  }

  async getBackupMeta(): Promise<CloudBackupMeta | null> {
    const data: any = await (await this.request('/backup/meta')).json();
    return data.backup ?? null;
  }

  async deleteBackup(): Promise<void> {
    await this.request('/backup', { method: 'DELETE' });
  }

  // ---- end-to-end encryption key material ----
  // The wrapped DEK the server stores but cannot open. GET returns null when
  // E2EE has never been set up for the account (404).

  async getKeyMaterial(): Promise<KeyMaterial | null> {
    try {
      return (await (await this.request('/keys')).json()) as KeyMaterial;
    } catch (err) {
      if (err instanceof CloudApiError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  async putKeyMaterial(material: KeyMaterial): Promise<void> {
    await this.request('/keys', {
      method: 'PUT',
      body: JSON.stringify(material),
      contentType: 'application/json',
    });
  }

  async listJobFiles(cloudJobId: string): Promise<any[]> {
    const data: any = await (
      await this.request(`/jobs/${encodeURIComponent(cloudJobId)}/files`)
    ).json();
    return data.files;
  }
}

/** Encode each segment but keep the / separators the Worker routes on. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
