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

function storedDek(db: Database.Database): string | null {
  const row = db.prepare('SELECT dek_enc FROM cloud_auth WHERE id = 1').get() as any;
  return row?.dek_enc ?? null;
}

/** A structurally-valid JWT so decodeJwtPayload can read `aal` off it. */
function fakeJwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${body}.signature`;
}

/** A CloudAuth with a live in-memory session, signed in through a stubbed GoTrue. */
async function signedInAuth(db: Database.Database): Promise<CloudAuth> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: fakeJwt({ aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: 'refresh-live',
          user: {
            id: 'user-1',
            email: 'e@example.com',
            factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }],
          },
        }),
        { status: 200 }
      )
    )
  );
  const auth = new CloudAuth(db);
  await auth.signIn('e@example.com', 'pw');
  return auth;
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

describe('CloudAuth.clearLocalSession — sign-out must not land half-applied', () => {
  it('clears both the stored token and the in-memory session', async () => {
    const auth = await signedInAuth(db);
    expect(auth.status().signedIn).toBe(true);

    auth.clearLocalSession();

    expect(auth.status().signedIn).toBe(false);
    expect(storedToken(db)).toBeNull();
  });

  it('leaves the session fully intact when the row write fails', async () => {
    // The DB write must come before the in-memory nulls. Reversed, a failed
    // write signs the user out in memory while the token survives on disk —
    // the app looks signed out, then the session reappears at the next launch.
    const auth = await signedInAuth(db);
    db.exec('DROP TABLE cloud_auth');

    expect(() => auth.clearLocalSession()).toThrow();

    expect(auth.status().signedIn).toBe(true);
    expect(auth.status().email).toBe('e@example.com');
  });

  it('rolls back the dropped E2EE keys when the session write fails in the same transaction', async () => {
    // What the sign-out handler wraps: dropping the keys and clearing the
    // session are one unit. Half-applied, the keys go but the refresh token
    // stays on disk, and the next launch silently restores the session on the
    // shared computer this is meant to protect.
    const auth = await signedInAuth(db);
    db.prepare(`UPDATE cloud_auth SET dek_enc = 'cached-dek' WHERE id = 1`).run();
    // Make the session write — and only that write — fail mid-transaction.
    db.exec(`CREATE TRIGGER fail_session_clear BEFORE UPDATE OF refresh_token_enc ON cloud_auth
             BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);

    const signOutLocally = db.transaction(() => {
      db.prepare(`UPDATE cloud_auth SET dek_enc = NULL WHERE id = 1`).run(); // stands in for e2ee.lockLocal()
      auth.clearLocalSession();
    });

    expect(() => signOutLocally()).toThrow();
    expect(storedDek(db)).toBe('cached-dek'); // key drop rolled back with it
    expect(storedToken(db)).not.toBeNull();
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
