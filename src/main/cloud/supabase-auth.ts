/**
 * Supabase auth client for cloud sync (Phase 3).
 *
 * Talks straight to the GoTrue REST endpoints with fetch — no SDK. Cloud
 * access requires a completed TOTP challenge (the Worker rejects aal1
 * tokens), so the flow is: password sign-in (aal1) → enroll TOTP once →
 * challenge + verify (aal2) → call the API.
 *
 * Only the refresh token is persisted (encrypted with Electron safeStorage
 * in the cloud_auth row); access tokens live in memory and are refreshed
 * when they near expiry. Supabase preserves aal2 across refreshes, so the
 * user enters a TOTP code once per sign-in, not once per hour.
 */

import { safeStorage } from 'electron';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; factors?: SupabaseFactor[] };
}

interface SupabaseFactor {
  id: string;
  factor_type: string;
  status: 'verified' | 'unverified';
  friendly_name?: string;
}

export interface AuthStatus {
  signedIn: boolean;
  email: string | null;
  aal: 'aal1' | 'aal2' | null;
  /** Sign-in succeeded but no verified TOTP factor exists yet. */
  needsEnroll: boolean;
  /** Sign-in succeeded; a TOTP code is needed to reach aal2. */
  needsTotp: boolean;
  /**
   * False when the OS keyring is unavailable, meaning cached secrets — the
   * refresh token AND the E2EE DEK / member private key — fall back to plain
   * base64 in the local DB (obfuscation, not encryption). Surfaced so the UI
   * can warn instead of leaving the downgrade log-only.
   */
  keyringAvailable: boolean;
}

export class CloudAuthError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

/**
 * GoTrue error codes that actually prove the stored refresh token is dead.
 * Anything outside this list leaves the token alone — see provesRefreshTokenDead.
 */
const DEAD_REFRESH_CODES = new Set([
  'invalid_grant', // classic OAuth rejection; older GoTrue puts it in `error`
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'bad_jwt',
  'user_not_found',
  'user_banned',
]);

/**
 * Does this refresh failure prove the stored token is dead?
 *
 * Only `true` for a 4xx that GoTrue itself attributed to the token, identified
 * by an error code from DEAD_REFRESH_CODES. Everything else keeps the token so
 * a later getAccessToken() — or the next launch — can retry.
 *
 * The status code alone is NOT enough. Plenty of 4xx responses reach us from
 * something in front of GoTrue and say nothing about the token: a Supabase or
 * Cloudflare edge 403/404, a WAF block, a paused project. Destroying the
 * session on those forces a full password + TOTP re-login over a token that
 * was never invalid — and it tends to happen on bad networks, i.e. at a
 * jobsite. Requiring GoTrue's own error code keeps the wipe to the cases that
 * actually mean the token is gone.
 *
 * This is not a defence against a hostile network. Anything that can forge a
 * 4xx for an https:// host already holds a trusted CA, and could just as
 * easily return `{"error_code":"refresh_token_not_found"}` to force the wipe.
 * The genuinely offline cases — no DNS, no route, a TLS failure against a
 * captive portal — never reach here at all: `fetch` throws and gotrue() turns
 * that into `code:'network'`, status 0.
 *
 * The failure mode of being wrong in the other direction is mild and
 * self-correcting: a genuinely dead token we can't classify is kept, the app
 * reads signed-out, and the user signs in again by hand.
 */
export function provesRefreshTokenDead(err: unknown): boolean {
  if (!(err instanceof CloudAuthError)) return false;
  if (err.code === 'network') return false;
  const status = err.status ?? 0;
  if (status < 400 || status >= 500) return false;
  return !!err.code && DEAD_REFRESH_CODES.has(err.code.trim().toLowerCase());
}

/**
 * The machine-readable error code out of a GoTrue error body, across both
 * shapes it ships in: newer `{ error_code: "refresh_token_not_found", ... }`
 * and older/OAuth-style `{ error: "invalid_grant", ... }`. Deliberately does
 * NOT read `data.code` — in newer GoTrue that's the numeric HTTP status, not a
 * code. Undefined when the body wasn't JSON at all (an HTML error page parses
 * to `{}`), which is exactly what keeps provesRefreshTokenDead from firing.
 */
function errorCodeOf(data: any): string | undefined {
  if (typeof data?.error_code === 'string') return data.error_code;
  if (typeof data?.error === 'string') return data.error;
  return undefined;
}

function friendlyAuthMessage(status: number, data: any): string {
  const code = data?.error_code || data?.code || '';
  const msg = data?.msg || data?.message || data?.error_description || data?.error || '';
  if (code === 'invalid_credentials') return 'Email or password is incorrect.';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) {
    return 'An account with this email already exists — sign in instead.';
  }
  if (code === 'weak_password' || /password/i.test(msg) && status === 422) {
    return `Password rejected: ${msg}`;
  }
  if (code === 'mfa_verification_failed' || /invalid totp/i.test(msg)) {
    return "That code didn't match. Check your authenticator app and try again.";
  }
  if (code === 'over_request_rate_limit') return 'Too many attempts. Wait a minute and try again.';
  if (status === 0) return 'Could not reach the sign-in service. Check your internet connection.';
  return msg || `Sign-in service error (HTTP ${status}).`;
}

async function gotrue(path: string, body?: unknown, token?: string, method?: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: method || 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err: any) {
    throw new CloudAuthError(friendlyAuthMessage(0, null), 'network', 0);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudAuthError(friendlyAuthMessage(res.status, data), errorCodeOf(data), res.status);
  return data;
}

function decodeJwtPayload(jwt: string): any {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  } catch {
    return {};
  }
}

/** safeStorage-wrap a secret for at-rest storage (also used for the backup key). */
export function encryptToken(token: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(token).toString('base64');
  }
  // No OS keyring (some Linux setups). Obfuscation only — and this path also
  // carries the E2EE DEK and member private key, not just session tokens, so
  // local read access defeats the zero-knowledge guarantee for this device.
  // Logged AND surfaced via AuthStatus.keyringAvailable so it's never a
  // silent downgrade.
  logger.warn(
    'cloud-auth',
    'OS keyring unavailable; storing secret (may include the sync encryption key) base64-encoded only'
  );
  return 'b64:' + Buffer.from(token).toString('base64');
}

export function decryptToken(stored: string): string | null {
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString();
    }
    return null;
  } catch (err: any) {
    logger.warn('cloud-auth', 'Could not decrypt stored refresh token', err.message);
    return null;
  }
}

export class CloudAuth {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private email: string | null = null;
  private userId: string | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(private db: Database.Database) {}

  // ---- session state ----

  private get payload(): any {
    return this.accessToken ? decodeJwtPayload(this.accessToken) : {};
  }

  status(): AuthStatus {
    const aal = (this.payload.aal as 'aal1' | 'aal2') || null;
    const signedIn = !!this.accessToken;
    return {
      signedIn,
      email: this.email,
      aal,
      needsEnroll: signedIn && aal === 'aal1' && !this.hasVerifiedTotp,
      needsTotp: signedIn && aal === 'aal1' && this.hasVerifiedTotp,
      keyringAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  private hasVerifiedTotp = false;

  private adoptSession(session: SupabaseSession): void {
    this.accessToken = session.access_token;
    this.refreshToken = session.refresh_token;
    this.email = session.user?.email ?? this.email;
    this.userId = session.user?.id ?? this.userId;
    if (session.user?.factors) {
      this.hasVerifiedTotp = session.user.factors.some(
        (f) => f.factor_type === 'totp' && f.status === 'verified'
      );
    }
    this.persist();
  }

  private persist(): void {
    if (!this.refreshToken) return;
    this.db
      .prepare(
        `INSERT INTO cloud_auth (id, email, user_id, refresh_token_enc, updated_at)
         VALUES (1, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT (id) DO UPDATE SET
           email = excluded.email,
           user_id = excluded.user_id,
           refresh_token_enc = excluded.refresh_token_enc,
           updated_at = excluded.updated_at`
      )
      .run(this.email, this.userId, encryptToken(this.refreshToken));
  }

  setAccountId(accountId: string): void {
    this.db.prepare('UPDATE cloud_auth SET account_id = ? WHERE id = 1').run(accountId);
  }

  getAccountId(): string | null {
    const row = this.db.prepare('SELECT account_id FROM cloud_auth WHERE id = 1').get() as any;
    return row?.account_id ?? null;
  }

  getUserId(): string | null {
    return this.userId;
  }

  /** Restore the previous session from the encrypted refresh token, if any. */
  async restore(): Promise<AuthStatus> {
    const row = this.db
      .prepare('SELECT email, user_id, refresh_token_enc FROM cloud_auth WHERE id = 1')
      .get() as any;
    if (!row?.refresh_token_enc) return this.status();
    const token = decryptToken(row.refresh_token_enc);
    if (!token) return this.status();
    this.email = row.email;
    this.userId = row.user_id;
    this.refreshToken = token;
    try {
      await this.refresh();
      logger.info('cloud-auth', `Restored cloud session for ${this.email}`);
    } catch (err: any) {
      if (provesRefreshTokenDead(err)) {
        logger.warn('cloud-auth', 'Stored cloud session is no longer valid', err.message);
        this.clearLocalSession();
      } else {
        // Offline launch, a transient server error, or a 4xx we can't pin on
        // GoTrue itself (an edge/WAF block, a paused project): the refresh
        // token may still be valid, so keep it — in memory and on disk. A later
        // getAccessToken() — or the next launch, once the service answers for
        // real — can refresh without forcing a full re-login (password + TOTP)
        // at a no-signal jobsite. The session just reads as signed-out until
        // then.
        logger.warn('cloud-auth', 'Could not verify stored cloud session; keeping it to retry', err.message);
      }
    }
    return this.status();
  }

  // ---- flows ----

  async signUp(email: string, password: string): Promise<AuthStatus> {
    const data = await gotrue('/signup', { email, password });
    if (data.access_token) {
      this.adoptSession(data as SupabaseSession);
    }
    return this.status();
  }

  async signIn(email: string, password: string): Promise<AuthStatus> {
    const data = await gotrue('/token?grant_type=password', { email, password });
    this.adoptSession(data as SupabaseSession);
    return this.status();
  }

  /**
   * Start TOTP enrollment. Returns the QR code (SVG data URI) and the secret
   * so the renderer can show both. Stale unverified factors from abandoned
   * enrollments are cleaned up first so re-enrolling never conflicts.
   */
  async enrollTotp(): Promise<{ factorId: string; qrCode: string; secret: string; uri: string }> {
    this.requireSession();
    const user = await gotrue('/user', undefined, this.accessToken!, 'GET');
    for (const f of (user.factors as SupabaseFactor[]) || []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await gotrue(`/factors/${f.id}`, undefined, this.accessToken!, 'DELETE').catch(() => {});
      }
    }
    const data = await gotrue(
      '/factors',
      { factor_type: 'totp', friendly_name: 'BidSheet Desktop' },
      this.accessToken!
    );
    // GoTrue returns the QR as raw SVG markup; the renderer wants an <img>
    // src. The SVG also ships without a viewBox, which makes it unscalable
    // (clipped) inside a sized <img> — derive one from its width/height.
    let qrCode: string = data.totp?.qr_code ?? '';
    if (qrCode && !qrCode.startsWith('data:')) {
      const tag = qrCode.match(/<svg[^>]*>/i)?.[0] ?? '';
      const w = tag.match(/width="(\d+(?:\.\d+)?)"/)?.[1];
      const h = tag.match(/height="(\d+(?:\.\d+)?)"/)?.[1];
      if (w && h && !/viewBox/i.test(tag)) {
        qrCode = qrCode.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
      }
      qrCode = `data:image/svg+xml;base64,${Buffer.from(qrCode).toString('base64')}`;
    }
    return {
      factorId: data.id,
      qrCode,
      secret: data.totp?.secret ?? '',
      uri: data.totp?.uri ?? '',
    };
  }

  /**
   * Complete an MFA challenge with a 6-digit code, against either a freshly
   * enrolled factor (factorId passed in) or the user's existing verified one.
   * On success the session is upgraded to aal2.
   */
  async verifyTotp(code: string, factorId?: string): Promise<AuthStatus> {
    this.requireSession();
    let id = factorId;
    if (!id) {
      const user = await gotrue('/user', undefined, this.accessToken!, 'GET');
      const factor = ((user.factors as SupabaseFactor[]) || []).find(
        (f) => f.factor_type === 'totp' && f.status === 'verified'
      );
      if (!factor) throw new CloudAuthError('No authenticator is set up for this account yet.');
      id = factor.id;
    }
    const challenge = await gotrue(`/factors/${id}/challenge`, {}, this.accessToken!);
    const session = await gotrue(
      `/factors/${id}/verify`,
      { challenge_id: challenge.id, code: code.replace(/\s/g, '') },
      this.accessToken!
    );
    this.hasVerifiedTotp = true;
    this.adoptSession(session as SupabaseSession);
    return this.status();
  }

  private async refresh(): Promise<void> {
    if (!this.refreshToken) throw new CloudAuthError('Not signed in.');
    // Single-flight: refresh tokens rotate on use, so concurrent refreshes
    // would invalidate each other.
    if (!this.refreshing) {
      this.refreshing = gotrue('/token?grant_type=refresh_token', {
        refresh_token: this.refreshToken,
      })
        .then((data) => {
          // A 200 that isn't a session — an edge error page, a stray HTML body
          // — parses to {}. Adopting that would blank the in-memory session and
          // read as a sign-out until the next launch, and because
          // getAccessToken() ends in `return this.accessToken!` it would hand
          // `undefined` to the API client as a bearer token. Treat a response
          // with no access token as transient rather than as a session.
          if (!data?.access_token) {
            throw new CloudAuthError(
              'Could not reach the sign-in service. Check your internet connection.',
              'network',
              0
            );
          }
          this.adoptSession(data as SupabaseSession);
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    await this.refreshing;
  }

  /** A currently-valid access token, refreshed if within 60s of expiry. */
  async getAccessToken(): Promise<string> {
    if (!this.accessToken) throw new CloudAuthError('Not signed in.');
    const exp = this.payload.exp ?? 0;
    if (Date.now() / 1000 > exp - 60) {
      await this.refresh();
    }
    return this.accessToken!;
  }

  /**
   * Best-effort server-side revoke. Never throws — a dead network must not be
   * able to block a sign-out the user asked for.
   */
  async revokeRemoteSession(): Promise<void> {
    if (this.accessToken) {
      await gotrue('/logout', {}, this.accessToken).catch(() => {});
    }
  }

  /**
   * Forget this device's session. Callers that also drop other local state
   * (the sign-out handler drops the E2EE keys) should wrap this in a single
   * db.transaction() so the writes cannot land half-applied.
   *
   * The row UPDATE runs before the in-memory fields are nulled: if the write
   * throws (SQLITE_BUSY, read-only DB), nothing has changed and the user stays
   * signed in with a visible error, rather than being signed out in memory
   * only to have the session reappear at the next launch.
   */
  clearLocalSession(): void {
    // Drop the token but keep the row — account_id stays as a record of which
    // account this machine's cloud_ids belong to, so the sync engine can
    // detect a sign-in to a *different* account and reset its bookkeeping.
    this.db
      .prepare(
        `UPDATE cloud_auth SET refresh_token_enc = NULL, updated_at = datetime('now', 'localtime') WHERE id = 1`
      )
      .run();
    this.accessToken = null;
    this.refreshToken = null;
    this.email = null;
    this.userId = null;
    this.hasVerifiedTotp = false;
  }

  private requireSession(): void {
    if (!this.accessToken) throw new CloudAuthError('Not signed in.');
  }
}
