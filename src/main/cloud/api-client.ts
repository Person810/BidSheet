/**
 * Thin client for the BidSheet Worker API (Phase 3).
 *
 * Every call carries a fresh aal2 JWT from CloudAuth. R2 keys follow
 * accountId/jobId/<objectId>, the object id being an HMAC of the file's
 * logical name under the DEK (see sync-crypto fileObjectKey); the Worker enforces that
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

/**
 * The account's key material — opaque to the server (zero-knowledge). Format 1
 * is the legacy single-key shape (recovery key directly unwraps wrapped_dek).
 * Format 2 (per-member) additionally returns THIS caller's own material:
 * my_wrapped_priv (their private key under their recovery key) and
 * my_wrapped_dek (the DEK sealed to their pubkey — null until an owner approves
 * them).
 */
export interface KeyMaterial {
  format: number;
  wrapped_dek: string;
  dek_fingerprint: string;
  my_status?: 'pending' | 'active' | null;
  my_wrapped_priv?: string | null;
  my_wrapped_dek?: string | null;
}

/** Body for PUT /keys. Format 2 setup/upgrade adds the caller's member fields. */
export interface KeyMaterialUpload {
  format: number;
  wrapped_dek: string;
  dek_fingerprint: string;
  pubkey?: string;
  wrapped_priv?: string;
  sealed_dek?: string;
}

export interface OrgMember {
  user_id: string;
  role: string;
  email: string | null;
  created_at: string;
  /** null = no E2EE key registered; pending = joined, awaiting approval; active = has a DEK wrap. */
  key_status: 'pending' | 'active' | null;
  pubkey: string | null;
  has_wrap: number;
}

export interface OrgInvite {
  id: string;
  role: string;
  expires_at: string;
  opened_count: number;
  created_at: string;
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

  async me(): Promise<{ user_id: string; email: string; account: CloudAccount; role?: string }> {
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

  /** One job's current cloud record, or null if it doesn't exist yet. */
  async getJob(cloudJobId: string): Promise<CloudJob | null> {
    try {
      const data: any = await (await this.request(`/jobs/${encodeURIComponent(cloudJobId)}`)).json();
      return (data.job as CloudJob) ?? null;
    } catch (err) {
      if (err instanceof CloudApiError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  /**
   * expected_snapshot_hash (when present, null included) makes the Worker
   * apply the update only if the job's snapshot_hash still matches — a 412
   * `snapshot_conflict` CloudApiError means another seat pushed first.
   */
  async putJob(
    cloudJobId: string,
    body: {
      name_enc: string;
      status?: string | null;
      snapshot_hash: string;
      expected_snapshot_hash?: string | null;
    }
  ): Promise<void> {
    await this.request(`/jobs/${encodeURIComponent(cloudJobId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  /**
   * `metaEnc` is the encrypted metadata blob (name, kind, timestamps) the
   * server stores and hands back verbatim — the only place a filename exists
   * cloud-side. Omitting it on an overwrite leaves the stored blob alone.
   */
  async putFile(
    key: string,
    body: Buffer | string,
    contentType: string,
    metaEnc?: string
  ): Promise<void> {
    const query = metaEnc ? `?meta_enc=${encodeURIComponent(metaEnc)}` : '';
    await this.request(`/files/${encodeKey(key)}${query}`, {
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

  async putKeyMaterial(material: KeyMaterialUpload): Promise<void> {
    await this.request('/keys', {
      method: 'PUT',
      body: JSON.stringify(material),
      contentType: 'application/json',
    });
  }

  /** Regenerate-recovery on format 2: replace only this member's wrapped private key. */
  async rewrapPrivateKey(wrappedPriv: string): Promise<void> {
    await this.request('/keys/rewrap', {
      method: 'POST',
      body: JSON.stringify({ wrapped_priv: wrappedPriv }),
      contentType: 'application/json',
    });
  }

  // ---- organizations / multi-user ----

  async createInvite(role: 'member' | 'owner' = 'member'): Promise<{ id: string; token: string; role: string }> {
    return (await this.request('/invites', {
      method: 'POST',
      body: JSON.stringify({ role }),
      contentType: 'application/json',
    })).json() as any;
  }

  async listInvites(): Promise<OrgInvite[]> {
    const data: any = await (await this.request('/invites')).json();
    return data.invites ?? [];
  }

  async revokeInvite(id: string): Promise<void> {
    await this.request(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async redeemInvite(body: {
    token: string;
    pubkey: string;
    wrapped_priv: string;
  }): Promise<{ account_id: string; role: string; status: string }> {
    return (await this.request('/invites/redeem', {
      method: 'POST',
      body: JSON.stringify(body),
      contentType: 'application/json',
    })).json() as any;
  }

  async listMembers(): Promise<{ members: OrgMember[]; me: { user_id: string; role: string } }> {
    return (await this.request('/members')).json() as any;
  }

  async approveMember(userId: string, body: { wrapped_dek: string; dek_fingerprint: string }): Promise<void> {
    await this.request(`/members/${encodeURIComponent(userId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  async removeMember(userId: string): Promise<void> {
    await this.request(`/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
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
