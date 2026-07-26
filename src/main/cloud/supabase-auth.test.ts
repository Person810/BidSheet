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
import { CloudAuth, encryptToken, provesRefreshTokenDead, CloudAuthError } from './supabase-auth';

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
  vi.useRealTimers(); // the refresh tests jump the clock past token expiry
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

describe('CloudAuth.restore — a 4xx that is not GoTrue must not sign the user out', () => {
  it('keeps the stored token when something in front of GoTrue answers 403', async () => {
    // An edge/WAF block or a paused project: a 4xx that says nothing about the
    // token. Status alone used to read as a definitive rejection and wipe a
    // perfectly good session.
    seedSession(db, 'refresh-abc');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Blocked</html>', { status: 403 }))
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).not.toBeNull();
  });

  it('keeps the stored token when a proxy answers 404 with a JSON body of its own', async () => {
    seedSession(db, 'refresh-abc');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'blocked' }), { status: 404 }))
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).not.toBeNull();
  });

  it('drops a structurally corrupt stored token (the live validation_failed body)', async () => {
    // Verbatim from the live project, 2026-07-26: GoTrue format-validates the
    // refresh token before looking it up, so a corrupted stored token (garbled
    // safeStorage decrypt, truncated b64 fallback) comes back validation_failed
    // rather than refresh_token_not_found. It can never succeed, so it has to
    // clear — otherwise the app reads signed-out and retries it every launch,
    // forever.
    seedSession(db, 'corrupted-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 400, error_code: 'validation_failed', msg: 'Refresh token is not valid' }),
          { status: 400 }
        )
      )
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).toBeNull();
  });

  it('drops the stored token for the live well-formed-but-unknown body', async () => {
    // Also verbatim from the live project: the ordinary expiry/rotation case.
    seedSession(db, 'refresh-stale');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 400,
            error_code: 'refresh_token_not_found',
            msg: 'Invalid Refresh Token: Refresh Token Not Found',
          }),
          { status: 400 }
        )
      )
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).toBeNull();
  });

  it('drops the stored token for an old-style GoTrue body that names the grant', async () => {
    // Older/OAuth-style rejection: {"error":"invalid_grant"} with no
    // error_code. This is the whole reason errorCodeOf() reads `error` too —
    // reading only error_code leaves the code undefined and the dead token
    // lingering forever.
    seedSession(db, 'refresh-stale');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
          { status: 400 }
        )
      )
    );

    await new CloudAuth(db).restore();

    expect(storedToken(db)).toBeNull();
  });
});

describe('CloudAuth.refresh — a 200 with no session must not blank the live session', () => {
  it('keeps the in-memory session alive when a mid-session refresh gets a bodyless 200', async () => {
    // The response parses to {}. Adopting it as a session used to set the
    // access token to undefined and, because getAccessToken() ends in
    // `return this.accessToken!`, hand that undefined straight to the API
    // client — "Bearer undefined" on every call, and a session that reads as
    // signed out until the app restarts.
    const auth = await signedInAuth(db);
    expect(auth.status().signedIn).toBe(true);
    // Force the next getAccessToken() to refresh rather than reuse the token.
    vi.setSystemTime(Date.now() + 3600_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Blocked</html>', { status: 200 }))
    );

    await expect(auth.getAccessToken()).rejects.toThrow();

    expect(auth.status().signedIn).toBe(true); // still signed in...
    expect(auth.status().aal).toBe('aal2'); // ...and still at aal2
    expect(storedToken(db)).not.toBeNull();
  });

  it('recovers on the next refresh once the service answers properly', async () => {
    const auth = await signedInAuth(db);
    vi.setSystemTime(Date.now() + 3600_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Blocked</html>', { status: 200 }))
    );
    await expect(auth.getAccessToken()).rejects.toThrow();

    // Service comes back: the single-flight promise must have been released.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: fakeJwt({ aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 7200 }),
            refresh_token: 'refresh-rotated',
            user: { id: 'user-1', email: 'e@example.com' },
          }),
          { status: 200 }
        )
      )
    );

    await expect(auth.getAccessToken()).resolves.toBeTruthy();
    expect(auth.status().signedIn).toBe(true);
  });
});

describe('provesRefreshTokenDead', () => {
  it('is false for network, timeout, rate-limit, and 5xx (keep the session)', () => {
    expect(provesRefreshTokenDead(new CloudAuthError('offline', 'network', 0))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('timeout', undefined, 408))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('rate', 'over_request_rate_limit', 429))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('down', undefined, 503))).toBe(false);
  });

  it('is true only for a 4xx GoTrue attributed to the token itself', () => {
    expect(provesRefreshTokenDead(new CloudAuthError('bad token', 'refresh_token_not_found', 400))).toBe(true);
    expect(provesRefreshTokenDead(new CloudAuthError('reused', 'refresh_token_already_used', 400))).toBe(true);
    expect(provesRefreshTokenDead(new CloudAuthError('old style', 'invalid_grant', 400))).toBe(true);
    expect(provesRefreshTokenDead(new CloudAuthError('gone', 'session_not_found', 401))).toBe(true);
  });

  it('is false for a bare 4xx with no GoTrue error code', () => {
    // Something in front of GoTrue answered. A status code on its own must
    // never be enough to destroy a session.
    expect(provesRefreshTokenDead(new CloudAuthError('unauthorized', undefined, 401))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('forbidden', undefined, 403))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('not found', undefined, 404))).toBe(false);
  });

  it('tolerates surrounding whitespace and casing on the code', () => {
    expect(provesRefreshTokenDead(new CloudAuthError('padded', ' Refresh_Token_Not_Found ', 400))).toBe(true);
  });

  it('is false for a 4xx carrying an unrelated error code', () => {
    expect(provesRefreshTokenDead(new CloudAuthError('mfa', 'mfa_verification_failed', 400))).toBe(false);
    expect(provesRefreshTokenDead(new CloudAuthError('weak', 'weak_password', 422))).toBe(false);
  });

  it('is true for validation_failed — a malformed token that can never succeed', () => {
    expect(provesRefreshTokenDead(new CloudAuthError('bad shape', 'validation_failed', 400))).toBe(true);
  });

  it('is false for an unrecognised (non-CloudAuthError) failure', () => {
    // Never sign the user out on an error we cannot classify.
    expect(provesRefreshTokenDead(new Error('unexpected'))).toBe(false);
  });
});
