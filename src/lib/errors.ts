/**
 * Central error handling.
 *
 * Every failure that reaches the UI is converted to an AppError with a stable
 * `code` and a `message` written for the person reading it. Database
 * functions raise short codes (e.g. MATRIC_NOT_FOUND); this module owns the
 * wording, so it can be changed in one place.
 */

export class AppError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

type MessageFor = (detail?: string) => string;

const MESSAGES: Record<string, string | MessageFor> = {
  // Accounts & Super Admin
  SIGNUP_NOT_ALLOWED:
    'A Super Admin account already exists, so self-registration is locked. Switch to the "Sign in" tab to log in with your Super Admin account.',
  REP_EXISTS: 'A class rep with that email already exists.',
  DEPARTMENT_EXISTS: 'That department already exists.',
  INVALID_DEPARTMENT: 'Enter a valid department name (at least 2 characters).',
  ACCOUNT_SUSPENDED: 'Your class rep account has been suspended. Contact the Super Admin.',
  STUDENT_SUSPENDED: 'Your account has been suspended by your class rep.',
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_NAME: 'Enter a full name (at least 2 characters).',
  WEAK_PASSWORD: 'Use at least 8 characters for the password.',
  NOT_FOUND: 'That record could not be found.',
  DB_NOT_MIGRATED:
    'Database functions are out of date. Open your Supabase SQL Editor, paste the latest supabase/migrations/0001_init.sql, and click Run.',
  SECRET_KEY_USED:
    'You pasted the Supabase SECRET key (sb_secret_...), which Supabase blocks in browsers. Please replace VITE_SUPABASE_ANON_KEY with the PUBLISHABLE / anon public key (starts with sb_publishable_... or eyJ...).',
  INVALID_API_KEY:
    'Invalid Supabase URL or anon key. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local or deployment settings.',
  EMAIL_SERVICE_503:
    'Supabase’s email server timed out (Error 503). To fix this permanently: copy and run the updated supabase/migrations/0001_init.sql in your Supabase SQL Editor (or turn off "Confirm email" under Authentication → Providers → Email).',

  // Claiming
  CLASS_NOT_FOUND: 'This class link is not valid. Ask your class rep for the correct link.',
  MATRIC_NOT_FOUND:
    'That matric number is not on the class list. Check it carefully, or ask your class rep to add you.',
  ALREADY_CLAIMED:
    'This matric number has already been claimed on another phone. If that was not you, tell your class rep to reset it.',
  NAME_MISMATCH:
    'The name does not match the class list for this matric number. Type at least your surname and first name.',
  DEVICE_ALREADY_CLAIMED:
    'This phone is already linked to another student. One phone can only be used for one student account.',
  PASSKEY_REQUIRED:
    'You must set up and verify your device Passkey (Fingerprint, Face ID, or screen lock PIN) on this phone.',
  PASSKEY_CANCELLED:
    'Passkey setup or verification was cancelled. You must confirm with your Fingerprint, Face ID, or screen lock to continue.',
  PASSKEY_UNSUPPORTED:
    'This browser does not support device Passkeys (WebAuthn). Open this link in Chrome (Android) or Safari (iPhone) in normal browsing mode.',
  DEVICE_MISMATCH:
    'This browser or phone does not match the device linked to your matric number. Open this page in your normal browser (not Incognito) on your registered phone, or ask your Class Rep to reset your phone.',
  INCOGNITO_BLOCKED:
    'Incognito / Private browsing mode is strictly disabled. Please close Incognito and open this link in your normal browser window so your phone stays permanently linked.',
  REP_CANNOT_CLAIM: 'You are signed in as staff. Sign out first to claim a student account.',

  // Check-in
  SESSION_NOT_FOUND: 'This session no longer exists.',
  SESSION_NOT_STARTED: 'This session has not started yet.',
  SESSION_CLOSED: 'This session has closed. Check-in is no longer possible.',
  NOT_IN_CLASS: 'You are not on the class list for this session.',
  ALREADY_CHECKED_IN: 'You have already checked in for this session.',
  LOW_ACCURACY:
    'Your location is not precise enough. Turn on precise location, step near a window or outside, and try again.',
  INVALID_LOCATION: 'Could not read a valid location from your phone. Try again.',
  OUT_OF_RANGE: (d) =>
    d
      ? `You are about ${d} m from the venue, which is outside the allowed area. Move closer and try again.`
      : 'You are outside the allowed area for this session. Move closer and try again.',

  // Geolocation (browser)
  GEO_UNSUPPORTED: 'This browser cannot share location. Open the link in Chrome or Safari.',
  GEO_DENIED:
    'Location permission is blocked. Allow location for this site in your browser settings, then try again.',
  GEO_UNAVAILABLE: 'Your phone could not get a location. Turn on location/GPS and try again.',
  GEO_TIMEOUT: 'Getting your location took too long. Move to an open area and try again.',
  GEO_INSECURE: 'Location only works on a secure (https) link.',

  // General
  NOT_AUTHENTICATED: 'Your session has expired. Please sign in again.',
  NETWORK: 'No connection to Supabase. Check your internet and verify VITE_SUPABASE_URL is correct.',
  DUPLICATE: 'That record already exists.',
  PERMISSION: 'You do not have permission to do that. Re-run supabase/migrations/0001_init.sql if setting up for the first time.',
  CONFIG: 'The app is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export function messageFor(code: string, detail?: string): string {
  const entry = MESSAGES[code] ?? MESSAGES.UNKNOWN!;
  return typeof entry === 'function' ? entry(detail) : entry;
}

export function appError(code: string, detail?: string): AppError {
  return new AppError(code, messageFor(code, detail), detail);
}

interface PgLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  status?: number;
  name?: string;
}

function isPgLike(e: unknown): e is PgLikeError {
  return typeof e === 'object' && e !== null && ('message' in e || 'code' in e || 'status' in e);
}

/** Converts anything thrown into an AppError. Never throws. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return appError('NETWORK');
  }

  if (isPgLike(e)) {
    const raw = (e.message ?? '').trim();

    // Codes raised by our SQL functions are plain upper-snake strings.
    if (/^[A-Z_]+$/.test(raw) && raw in MESSAGES) {
      return appError(raw, e.details ?? undefined);
    }
    if (/SIGNUP_NOT_ALLOWED|Database error saving new user/i.test(raw)) {
      return appError('SIGNUP_NOT_ALLOWED');
    }
    if (
      e.status === 503 ||
      e.status === 504 ||
      e.name === 'AuthRetryableFetchError' ||
      /error sending (confirmation|recovery) email|503|service unavailable/i.test(raw)
    ) {
      return appError('EMAIL_SERVICE_503');
    }
    if (
      e.code === 'PGRST202' ||
      e.code === 'PGRST205' ||
      e.code === '42P01' ||
      e.code === '42883' ||
      /could not find the (function|table)|relation .* does not exist|schema cache/i.test(raw)
    ) {
      return appError('DB_NOT_MIGRATED');
    }
    if (/forbidden use of secret api key/i.test(raw)) {
      return appError('SECRET_KEY_USED');
    }
    if (/invalid api key|apikey/i.test(raw)) {
      return appError('INVALID_API_KEY');
    }

    // Auth errors from Supabase are already human readable — check BEFORE status === 403!
    if (e.name === 'AuthApiError' || e.name === 'AuthWeakPasswordError') {
      return new AppError('AUTH', raw || messageFor('UNKNOWN'));
    }

    if (e.code === '23505') return appError('DUPLICATE');
    if (e.code === '42501' || e.status === 403) return appError('PERMISSION');
    if (e.status === 401 || /jwt|refresh token/i.test(raw)) return appError('NOT_AUTHENTICATED');
    if (/failed to fetch|network/i.test(raw)) return appError('NETWORK');

    if (raw) {
      console.error('[unmapped error]', e);
      return new AppError('UNKNOWN', raw, raw);
    }
  }

  console.error('[unexpected error]', e);
  return appError('UNKNOWN');
}

/** Unwraps a Supabase `{ data, error }` result, throwing an AppError on failure. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toAppError(result.error);
  if (result.data === null) throw appError('UNKNOWN', 'Empty response');
  return result.data;
}

/** Like unwrap, for writes that return no rows. */
export function check(result: { error: unknown }): void {
  if (result.error) throw toAppError(result.error);
}
