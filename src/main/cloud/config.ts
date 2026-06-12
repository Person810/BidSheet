/**
 * Cloud endpoints for BidSheet sync (Phase 3).
 *
 * Both values are public by design: the publishable key only identifies the
 * Supabase project (auth still requires the user's password + TOTP), and the
 * Worker rejects anything without a verified aal2 JWT. Env vars override for
 * pointing a dev build at a staging stack.
 */
export const SUPABASE_URL =
  process.env.BIDSHEET_SUPABASE_URL || 'https://ugyhtckanjemsgigwcax.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.BIDSHEET_SUPABASE_KEY || 'sb_publishable_VSD3Iez_jQCLG4tvYzqlmg_rBHE-KP5';

export const CLOUD_API_URL =
  process.env.BIDSHEET_CLOUD_API_URL || 'https://bidsheet-api.lm-wiley.workers.dev';
