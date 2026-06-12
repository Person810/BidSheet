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
  name: string;
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
            : data.error || `Cloud API error (HTTP ${res.status}).`;
      throw new CloudApiError(msg, res.status, code);
    }
    return res;
  }

  async me(): Promise<{ user_id: string; email: string; account: CloudAccount }> {
    return (await this.request('/me')).json() as any;
  }

  async listJobs(): Promise<CloudJob[]> {
    const data: any = await (await this.request('/jobs')).json();
    return data.jobs as CloudJob[];
  }

  async putJob(cloudJobId: string, body: { name: string; status?: string | null; snapshot_hash: string }): Promise<void> {
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
