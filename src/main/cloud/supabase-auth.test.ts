import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

// database.ts and supabase-auth.ts import electron only for getDbPath() and
// safeStorage. Force the no-keyring path so stored tokens are recoverable
// base64 (no OS crypto in the test env), and stub app.getPath for migrations.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { initializeDatabase } from '../database';
import { CloudAuth, encryptToken, isTransientAuthError, CloudAuthError } from './supabase-auth';

function seedSession(db: Database.Database, refreshToken: string): void {
  db.prepare(
    `INSERT INTO cloud_auth (id, email, user_id, refresh_token_enc)
     VALUES (1, 'e@example.com', 'user-1', ?)`
  ).run(encryptToken(refreshToken));
}

function storedToken(db: Database.Database): string | null {
  const row = db.prepare('SELECT refresh_token_enc FROM cloud_auth WHERE id = 1').get() as any;
  return row?.refresh_token_enc ?? null;
}

let db: Database.Database;
beforeEach(() => {
  db = initializeDatabase(':memory:');
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

describe('CloudAuth.restore — offline / transient resilience', () => {
  it('keeps the stored refresh token when the refresh fails with a network error', async () => {
    // Regression: launching the app offline used to wipe the token, forcing a
    // full password + TOTP re-login at a no-signal jobsite.
    seedSession(db, 'refresh-abc');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const status = await new CloudAuth(db).restore();

    expect(status.signedIn).toBe(false); // can't verify while offline...
    expect(storedToken(db)).not.toBeNull(); // ...but the token must survive
  });

  it('keeps the stored token on a transient 5xx from the auth service', async () => {
    seedSession(db, 'refresh-abc');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ msg: 'upstream error' }), { status: 503 }))
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).not.toBeNull();
  });

  it('keeps the stored token when the auth service rate-limits the refresh', async () => {
    seedSession(db, 'refresh-abc');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error_code: 'over_request_rate_limit' }), { status: 429 })
      )
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).not.toBeNull();
  });

  it('drops the stored token when the refresh token is definitively rejected (400)', async () => {
    // A genuinely invalid/expired token must still be cleared, so a stale
    // session does not linger forever.
    seedSession(db, 'refresh-stale');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }),
          { status: 400 }
        )
      )
    );

    const status = await new CloudAuth(db).restore();

    expect(status.signedIn).toBe(false);
    expect(storedToken(db)).toBeNull();
  });
});

describe('isTransientAuthError', () => {
  it('treats network, timeout, rate-limit, and 5xx as transient (keep the session)', () => {
    expect(isTransientAuthError(new CloudAuthError('offline', 'network', 0))).toBe(true);
    expect(isTransientAuthError(new CloudAuthError('timeout', undefined, 408))).toBe(true);
    expect(isTransientAuthError(new CloudAuthError('rate', 'over_request_rate_limit', 429))).toBe(true);
    expect(isTransientAuthError(new CloudAuthError('down', undefined, 503))).toBe(true);
  });

  it('treats a 4xx auth rejection as definitive (drop the session)', () => {
    expect(isTransientAuthError(new CloudAuthError('bad token', 'refresh_token_not_found', 400))).toBe(false);
    expect(isTransientAuthError(new CloudAuthError('unauthorized', undefined, 401))).toBe(false);
  });

  it('treats an unrecognised (non-CloudAuthError) failure as transient', () => {
    // Never sign the user out on an error we cannot classify.
    expect(isTransientAuthError(new Error('unexpected'))).toBe(true);
  });
});
