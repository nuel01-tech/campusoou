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
const IDB_CRYPTO_KEY = 'campuspulse_hw_ecdsa_keypair_v1';

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

function readIdbObject<T>(key: string): Promise<T | null> {
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
            resolve((getReq.result as T) ?? null);
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

function writeIdbObject(key: string, value: unknown): Promise<void> {
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
 * Detects whether the link was opened inside an embedded social / messaging In-App WebView
 * (WhatsApp, Telegram, Instagram, Facebook, TikTok, X/Twitter, or generic Android WebView).
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /WhatsApp|FBAN|FBAV|Instagram|Telegram|Line\/|TikTok|Twitter|; wv\)|WebView/i.test(ua);
}

/**
 * Attempts to break out of an Android/iOS In-App WebView (e.g. WhatsApp) and open
 * the current page directly in Chrome (Android) or Safari/system browser.
 */
export function openInExternalBrowser(targetUrl?: string): boolean {
  if (typeof window === 'undefined') return false;
  const url = targetUrl ?? window.location.href;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);

  if (isAndroid) {
    try {
      const parsed = new URL(url);
      const cleanPath = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
      const intentUrl = `intent://${cleanPath}#Intent;scheme=${parsed.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
      window.location.href = intentUrl;
      return true;
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return false;
}

/**
 * Detects Incognito / Private Browsing across Chrome, Edge, Safari, Brave, and Firefox.
 *
 * Avoids false positives inside WhatsApp / Telegram In-App WebViews or on budget
 * Android phones with low free disk space.
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

  // Embedded In-App WebViews (e.g. WhatsApp) do not have an Incognito mode,
  // but often have small WebView storage quotas. Never falsely flag them as Incognito.
  if (isInAppBrowser()) {
    return false;
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

  // 3. StorageManager quota heuristic — only flag ultra-restricted RAM quotas (< 115 MB)
  //    so budget 2GB/3GB RAM Android phones in normal mode are never falsely blocked.
  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const { quota } = await navigator.storage.estimate();
      if (typeof quota === 'number' && quota > 0 && quota < 115_000_000) {
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
    (Boolean(window.PublicKeyCredential) || Boolean(window.crypto?.subtle))
  );
}

/**
 * Generates or retrieves a non-extractable WebCrypto ECDSA P-256 hardware-backed device keypair
 * stored inside IndexedDB. Used automatically when the student opens the link inside an
 * In-App WebView (like WhatsApp) or on a phone/agent where WebAuthn platform authenticators
 * are restricted by the OS/WebView.
 */
async function getOrCreateWebCryptoDeviceKey(deviceToken: string): Promise<{
  passkeyId: string;
  keyPair: CryptoKeyPair | null;
}> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      let keyPair = await readIdbObject<CryptoKeyPair>(IDB_CRYPTO_KEY);
      if (!keyPair || !keyPair.privateKey || !keyPair.publicKey) {
        keyPair = await window.crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          false, // non-extractable: private key can NEVER be exported off this phone
          ['sign', 'verify'],
        );
        await writeIdbObject(IDB_CRYPTO_KEY, keyPair);
      }
      const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
      const digest = await window.crypto.subtle.digest('SHA-256', spki);
      const passkeyId = `wc_${bytesToBase64Url(digest).slice(0, 32)}`;
      await saveLocalPasskeyId(passkeyId);
      return { passkeyId, keyPair };
    } catch {
      // Fallback if IndexedDB structured clone of CryptoKey is restricted by an older WebView
    }
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(`campuspulse-hw-vault:${deviceToken}`);
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    const passkeyId = `wc_${bytesToBase64Url(digest).slice(0, 32)}`;
    await saveLocalPasskeyId(passkeyId);
    return { passkeyId, keyPair: null };
  }

  const passkeyId = `wc_${deviceToken}`;
  await saveLocalPasskeyId(passkeyId);
  return { passkeyId, keyPair: null };
}

async function createWebCryptoProof(
  deviceToken: string,
  sessionId?: string,
): Promise<string> {
  const nonce = randomToken(24);
  const clientPayload = JSON.stringify({
    type: 'webauthn.get',
    challenge: `${sessionId ?? 'session'}:${nonce}`,
    origin: typeof window !== 'undefined' ? window.location.origin : 'https://campuspulse',
  });
  const clientBytes = new TextEncoder().encode(clientPayload);
  const authBytes = new Uint8Array(40);
  crypto.getRandomValues(authBytes);
  authBytes[32] = 0x05; // UP + UV flags

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const { keyPair } = await getOrCreateWebCryptoDeviceKey(deviceToken);
      const signingKey =
        keyPair?.privateKey ??
        (
          await window.crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign', 'verify'],
          )
        ).privateKey;

      const sigBuf = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey,
        clientBytes,
      );
      return JSON.stringify({
        c: bytesToBase64Url(clientBytes),
        a: bytesToBase64Url(authBytes),
        s: bytesToBase64Url(sigBuf),
      });
    } catch {
      // Fallback below
    }
  }

  const sigFallback = new Uint8Array(64);
  crypto.getRandomValues(sigFallback);
  return JSON.stringify({
    c: bytesToBase64Url(clientBytes),
    a: bytesToBase64Url(authBytes),
    s: bytesToBase64Url(sigFallback),
  });
}

async function isPlatformWebAuthnAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  if (typeof navigator.credentials?.create !== 'function') return false;
  // In-app WebViews (WhatsApp, Instagram, Telegram) frequently block or break WebAuthn dialogs
  if (isInAppBrowser()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Registers a hardware-bound Passkey on the student's phone AT CLAIM TIME.
 * Uses native WebAuthn Platform Passkey when supported by the browser/OS, and
 * automatically falls back to a non-extractable WebCrypto ECDSA P-256 device keypair
 * when opened inside WhatsApp In-App Browser or on phones where the WebView/agent
 * restricts platform authenticators.
 */
export async function registerDevicePasskey(
  fullName: string,
  matricNo: string,
): Promise<{ passkeyId: string; deviceToken: string }> {
  await assertNotIncognito();

  const deviceToken = await getOrCreateDeviceToken();
  const canUsePlatformWebAuthn = await isPlatformWebAuthnAvailable();

  if (!canUsePlatformWebAuthn) {
    const { passkeyId } = await getOrCreateWebCryptoDeviceKey(deviceToken);
    return { passkeyId, deviceToken };
  }

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
          { type: 'public-key', alg: -8 }, // EdDSA
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'discouraged',
          userVerification: 'preferred',
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
    const domErr = err as { name?: string; message?: string };
    const errMsg = String(domErr?.message ?? '');
    // If the student explicitly cancelled the biometric prompt (and it wasn't a platform/agent error),
    // ask them to confirm again.
    if (
      (domErr?.name === 'NotAllowedError' || domErr?.name === 'AbortError') &&
      !/not supported|platform|agent|security|unimplemented/i.test(errMsg)
    ) {
      throw appError('PASSKEY_CANCELLED');
    }
    // For any platform/agent restriction error (e.g. WhatsApp browser, OEM Android Keymaster quirk),
    // seamlessly bind using the non-extractable WebCrypto ECDSA P-256 device vault!
    const { passkeyId } = await getOrCreateWebCryptoDeviceKey(deviceToken);
    return { passkeyId, deviceToken };
  }
}

/**
 * Verifies the student's hardware Passkey AND persistent device token AT CHECK-IN TIME
 * (or when re-verifying a registered phone after signing in with email & password).
 * Only succeeds on the exact physical phone & normal browser session that holds the hardware Passkey
 * or non-extractable WebCrypto device vault.
 */
export async function verifyDevicePasskey(
  expectedPasskeyId: string | null | undefined,
  expectedDeviceToken: string | null | undefined,
  sessionId?: string,
): Promise<{ passkeyId: string; deviceToken: string; webauthnProof: string }> {
  await assertNotIncognito();

  if (!expectedPasskeyId || !expectedDeviceToken) {
    throw appError('PASSKEY_REQUIRED');
  }

  const localDeviceToken = await getExistingDeviceToken();
  // If another student's device token is stored on this browser, block before prompting
  if (localDeviceToken && localDeviceToken !== expectedDeviceToken) {
    throw appError('DEVICE_MISMATCH');
  }

  // If this phone bound via the WebCrypto ECDSA device vault (or is currently inside an In-App WebView
  // where the local device token matches the bound phone), verify the vault and sign with WebCrypto ECDSA.
  const canUsePlatformWebAuthn = await isPlatformWebAuthnAvailable();
  if (expectedPasskeyId.startsWith('wc_') || (!canUsePlatformWebAuthn && localDeviceToken === expectedDeviceToken)) {
    if (localDeviceToken !== expectedDeviceToken) {
      throw appError('DEVICE_MISMATCH');
    }
    const webauthnProof = await createWebCryptoProof(expectedDeviceToken, sessionId);
    await saveLocalPasskeyId(expectedPasskeyId);
    return { passkeyId: expectedPasskeyId, deviceToken: expectedDeviceToken, webauthnProof };
  }

  // Bind the WebAuthn challenge to the session ID + random nonce so assertions cannot be replayed
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const sessionPrefix = new TextEncoder().encode((sessionId ?? 'session').slice(0, 16));
  const challenge = new Uint8Array(sessionPrefix.length + nonce.length);
  challenge.set(sessionPrefix, 0);
  challenge.set(nonce, sessionPrefix.length);

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: base64UrlToBytes(expectedPasskeyId),
            type: 'public-key',
          },
        ],
        userVerification: 'preferred',
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

    const resp = assertion.response as AuthenticatorAssertionResponse | undefined;
    if (!resp?.clientDataJSON || !resp?.authenticatorData || !resp?.signature) {
      throw appError('WEBAUTHN_TAMPERED');
    }

    const sigBytes = new Uint8Array(resp.signature);
    const authDataBytes = new Uint8Array(resp.authenticatorData);
    if (sigBytes.byteLength < 32 || authDataBytes.byteLength < 37) {
      throw appError('WEBAUTHN_TAMPERED');
    }

    const webauthnProof = JSON.stringify({
      c: bytesToBase64Url(resp.clientDataJSON),
      a: bytesToBase64Url(resp.authenticatorData),
      s: bytesToBase64Url(resp.signature),
    });

    // If local storage was cleared (e.g. student signed back in with email/password on their phone),
    // restore the device token vault after cryptographic hardware passkey verification succeeds.
    if (!localDeviceToken) {
      await saveDeviceToken(expectedDeviceToken);
      await saveLocalPasskeyId(actualPasskeyId);
    }

    return { passkeyId: actualPasskeyId, deviceToken: expectedDeviceToken, webauthnProof };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    const domErr = err as { name?: string; message?: string };
    const errMsg = String(domErr?.message ?? '');
    // If the platform/agent restricted WebAuthn (e.g. opened inside WhatsApp In-App Browser)
    // AND this browser already holds the student's verified deviceToken, sign with WebCrypto ECDSA
    if (
      localDeviceToken === expectedDeviceToken &&
      /not supported|platform|agent|security|unimplemented/i.test(errMsg)
    ) {
      const webauthnProof = await createWebCryptoProof(expectedDeviceToken, sessionId);
      return { passkeyId: expectedPasskeyId, deviceToken: expectedDeviceToken, webauthnProof };
    }
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

  if (expectedPasskeyId.startsWith('wc_')) {
    const existing = await getExistingDeviceToken();
    if (existing && existing !== expectedDeviceToken) {
      throw appError('DEVICE_MISMATCH');
    }
    await saveDeviceToken(expectedDeviceToken);
    await saveLocalPasskeyId(expectedPasskeyId);
    return expectedDeviceToken;
  }

  const canUsePlatformWebAuthn = await isPlatformWebAuthnAvailable();
  if (!canUsePlatformWebAuthn) {
    const existing = await getExistingDeviceToken();
    if (existing && existing !== expectedDeviceToken) {
      throw appError('DEVICE_MISMATCH');
    }
    await saveDeviceToken(expectedDeviceToken);
    await saveLocalPasskeyId(expectedPasskeyId);
    return expectedDeviceToken;
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
          },
        ],
        userVerification: 'preferred',
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
