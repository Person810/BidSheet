/**
 * Shared cloud sync state for the renderer.
 *
 * Mirrors what the main process reports: auth status (signed out / needs
 * authenticator / ready) and the per-job sync overview. Components call
 * initCloudStore() once on mount; the store stays current via the
 * 'cloud-sync-status' push events the sync engine emits.
 */

import { create } from 'zustand';

export interface CloudAuthStatus {
  signedIn: boolean;
  email: string | null;
  aal: 'aal1' | 'aal2' | null;
  needsEnroll: boolean;
  needsTotp: boolean;
}

export interface CloudJobSync {
  jobId: number;
  cloudId: string;
  name: string;
  enabled: boolean;
  status: 'pending' | 'synced' | 'conflict' | 'error';
  error: string | null;
  lastSyncedAt: string | null;
}

export interface CloudSyncOverview {
  jobs: CloudJobSync[];
  cloudOnly: { cloudId: string; name: string; status: string | null; updatedAt: string | null; bytesUsed: number }[];
  syncing: boolean;
  lastCheckAt: string | null;
}

interface CloudState {
  auth: CloudAuthStatus | null;
  sync: CloudSyncOverview | null;
  refresh: () => Promise<void>;
}

export const useCloudStore = create<CloudState>((set) => ({
  auth: null,
  sync: null,
  refresh: async () => {
    const status = await window.api.cloudStatus();
    set({ auth: status.auth, sync: status.sync });
  },
}));

let initialized = false;

/** Idempotent; safe to call from every component that shows cloud state. */
export function initCloudStore(): void {
  if (initialized) return;
  initialized = true;
  useCloudStore.getState().refresh().catch(() => {
    // Status unavailable (e.g. stale preload during dev) — fall back to a
    // signed-out shape so the UI shows the sign-in form instead of an
    // endless "checking" state; individual actions surface their own errors.
    useCloudStore.setState({
      auth: { signedIn: false, email: null, aal: null, needsEnroll: false, needsTotp: false },
    });
  });
  window.api.onCloudSyncStatus((sync) => {
    useCloudStore.setState({ sync });
    // Auth can flip (token expiry) without a dedicated event; cheap to re-ask.
    window.api.cloudStatus().then((s) => useCloudStore.setState({ auth: s.auth })).catch(() => {});
  });
}
