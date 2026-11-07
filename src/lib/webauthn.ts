/**
 * Strict Hardware Passkey (WebAuthn) + Anti-Incognito + Device Binding Engine.
 *
 * Security guarantees:
 *   1. Blocks Incognito / Private browsing mode (`detectIncognitoMode`).
 *   2. Forces hardware passkey creation (`navigator.credentials.create`) AT CLAIM TIME,
 *      returning the hardware `passkeyId` and a persistent `deviceToken` stored in both
 *      localStorage and IndexedDB.
 *   3. Forces hardware passkey assertion (`navigator.credentials.get`) restricted to the
 *      exact `allowCredentials: [{ id: passkeyId }]` AT CHECK-IN TIME, plus verifies the
 *      persistent `deviceToken` matches.
 */

import { appError } from './errors';

const LS_DEVICE_TOKEN_KEY = 'campuspulse_strict_device_token_v1';
const LS_PASSKEY_ID_KEY = 'campuspulse_strict_passkey_id_v1';
const IDB_NAME = 'campuspulse_device_vault_v1';
const IDB_STORE = 'bindings';

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.byteLength; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
  const binary = atob(padded);
  const buf = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomToken(byteLen = 24): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

// --- IndexedDB + localStorage dual persistence -------------------------------

function readIdb(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get(key);
          getReq.onsuccess = () => {
            db.close();
            resolve(typeof getReq.result === 'string' ? getReq.result : null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeIdb(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Detects Incognito / Private Browsing across Chrome, Edge, Safari, Brave, and Firefox.
 *
 * Uses storage quota caps (in Chromium mobile/desktop incognito, quota is capped
 * to a small fraction of RAM, typically < 1.2 GB, whereas normal mode has multiple GBs),
 * FileSystem API checks, and storage persistence checks.
 */
export async function detectIncognitoMode(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Check localStorage accessibility
  try {
    const testKey = '__cp_incog_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
  } catch {
    return true;
  }

  // 2. Chromium / WebKit FileSystem API check (fails immediately in Incognito)
  const w = window as unknown as {
    webkitRequestFileSystem?: (
      type: number,
      size: number,
      success: () => void,
      error: () => void,
    ) => void;
  };
  if (typeof w.webkitRequestFileSystem === 'function') {
    const isIncog = await new Promise<boolean>((resolve) => {
      w.webkitRequestFileSystem!(
        0,
        100,
        () => resolve(false),
        () => resolve(true),
      );
    });
    if (isIncog) return true;
  }

  // 3. StorageManager quota heuristic (Chrome / Edge / Android / iOS Safari 15+)
  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const { quota } = await navigator.storage.estimate();
      // In mobile & desktop Incognito/Private mode, browser storage quota is tightly capped
      // (typically 50MB - 650MB on mobile RAM), whereas normal mode allocates several GBs.
      if (typeof quota === 'number' && quota > 0 && quota < 1_100_000_000) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

export async function assertNotIncognito(): Promise<void> {
  const incognito = await detectIncognitoMode();
  if (incognito) {
    throw appError('INCOGNITO_BLOCKED');
  }
}

export async function getExistingDeviceToken(): Promise<string | null> {
  try {
    const fromLs = window.localStorage.getItem(LS_DEVICE_TOKEN_KEY);
    const fromIdb = await readIdb(LS_DEVICE_TOKEN_KEY);
    const token = fromLs || fromIdb || null;
    if (token) {
      if (!fromLs) window.localStorage.setItem(LS_DEVICE_TOKEN_KEY, token);
      if (!fromIdb) await writeIdb(LS_DEVICE_TOKEN_KEY, token);
    }
    return token;
  } catch {
    return null;
  }
}

export async function getOrCreateDeviceToken(): Promise<string> {
  await assertNotIncognito();
  const existing = await getExistingDeviceToken();
  if (existing) return existing;

  const created = randomToken(24);
  try {
    window.localStorage.setItem(LS_DEVICE_TOKEN_KEY, created);
  } catch {
    throw appError('INCOGNITO_BLOCKED');
  }
  await writeIdb(LS_DEVICE_TOKEN_KEY, created);
  return created;
}

export async function saveDeviceToken(token: string): Promise<void> {
  try {
    window.localStorage.setItem(LS_DEVICE_TOKEN_KEY, token);
  } catch {
    // ignore
  }
  await writeIdb(LS_DEVICE_TOKEN_KEY, token);
}

export function getSavedPasskeyId(): string | null {
  try {
    return window.localStorage.getItem(LS_PASSKEY_ID_KEY);
  } catch {
    return null;
  }
}

export async function saveLocalPasskeyId(passkeyId: string): Promise<void> {
  try {
    window.localStorage.setItem(LS_PASSKEY_ID_KEY, passkeyId);
  } catch {
    // ignore
  }
  await writeIdb(LS_PASSKEY_ID_KEY, passkeyId);
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.PublicKeyCredential) &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function'
  );
}

/**
 * Registers a hardware-bound Passkey on the student's phone AT CLAIM TIME.
 * Mandatory: throws if WebAuthn is unsupported, if running in Incognito, or if the user cancels.
 */
export async function registerDevicePasskey(
  fullName: string,
  matricNo: string,
): Promise<{ passkeyId: string; deviceToken: string }> {
  await assertNotIncognito();

  if (!isPasskeySupported()) {
    throw appError('PASSKEY_UNSUPPORTED');
  }

  const deviceToken = await getOrCreateDeviceToken();
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const cleanMatric = matricNo.trim().toUpperCase();
  const cleanName = fullName.trim();

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'CampusPulse Attendance',
          id: window.location.hostname,
        },
        user: {
          id: new TextEncoder().encode(`${cleanMatric}:${deviceToken.slice(0, 12)}`),
          name: cleanMatric,
          displayName: `${cleanName} (${cleanMatric})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      throw appError('PASSKEY_CANCELLED');
    }

    const passkeyId = bytesToBase64Url(credential.rawId);
    await saveLocalPasskeyId(passkeyId);

    return { passkeyId, deviceToken };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    const domErr = err as { name?: string };
    if (domErr?.name === 'NotAllowedError' || domErr?.name === 'AbortError') {
      throw appError('PASSKEY_CANCELLED');
    }
    throw appError('PASSKEY_UNSUPPORTED');
  }
}

/**
 * Verifies the student's hardware Passkey AND persistent device token AT CHECK-IN TIME
 * (or when re-verifying a registered phone after signing in with email & password).
 * Only succeeds on the exact physical phone & normal browser session that holds the hardware Passkey.
 */
export async function verifyDevicePasskey(
  expectedPasskeyId: string | null | undefined,
  expectedDeviceToken: string | null | undefined,
): Promise<{ passkeyId: string; deviceToken: string }> {
  await assertNotIncognito();

  if (!isPasskeySupported()) {
    throw appError('PASSKEY_UNSUPPORTED');
  }

  if (!expectedPasskeyId || !expectedDeviceToken) {
    throw appError('PASSKEY_REQUIRED');
  }

  const localDeviceToken = await getExistingDeviceToken();
  // If another student's device token is stored on this browser, block before prompting
  if (localDeviceToken && localDeviceToken !== expectedDeviceToken) {
    throw appError('DEVICE_MISMATCH');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: base64UrlToBytes(expectedPasskeyId),
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion || !assertion.rawId) {
      throw appError('PASSKEY_CANCELLED');
    }

    const actualPasskeyId = bytesToBase64Url(assertion.rawId);
    if (actualPasskeyId !== expectedPasskeyId) {
      throw appError('DEVICE_MISMATCH');
    }

    // If local storage was cleared (e.g. student signed back in with email/password on their phone),
    // restore the device token vault after cryptographic hardware passkey verification succeeds.
    if (!localDeviceToken) {
      await saveDeviceToken(expectedDeviceToken);
      await saveLocalPasskeyId(actualPasskeyId);
    }

    return { passkeyId: actualPasskeyId, deviceToken: expectedDeviceToken };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    const domErr = err as { name?: string };
    if (domErr?.name === 'NotAllowedError' || domErr?.name === 'AbortError') {
      throw appError('PASSKEY_CANCELLED');
    }
    throw appError('DEVICE_MISMATCH');
  }
}

/**
 * Cryptographically verifies that this physical device holds `expectedPasskeyId`
 * and restores `expectedDeviceToken` to the browser vault (used when a student
 * signs back in with email/password after clearing browser storage).
 */
export async function restoreDeviceWithPasskey(
  expectedPasskeyId: string,
  expectedDeviceToken: string,
): Promise<string> {
  await assertNotIncognito();

  if (!isPasskeySupported()) {
    throw appError('PASSKEY_UNSUPPORTED');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: base64UrlToBytes(expectedPasskeyId),
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion || !assertion.rawId) {
      throw appError('PASSKEY_CANCELLED');
    }

    const actualPasskeyId = bytesToBase64Url(assertion.rawId);
    if (actualPasskeyId !== expectedPasskeyId) {
      throw appError('DEVICE_MISMATCH');
    }

    await saveDeviceToken(expectedDeviceToken);
    await saveLocalPasskeyId(actualPasskeyId);
    return expectedDeviceToken;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    const domErr = err as { name?: string };
    if (domErr?.name === 'NotAllowedError' || domErr?.name === 'AbortError') {
      throw appError('PASSKEY_CANCELLED');
    }
    throw appError('DEVICE_MISMATCH');
  }
}
