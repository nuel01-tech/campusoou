/**
 * Biometric / Passkey Web Authentication helper.
 * Uses window.PublicKeyCredential to prompt Face ID / Touch ID / Fingerprint / Device PIN.
 */

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);
}

/**
 * Creates or verifies a biometric passkey on the student's physical device.
 * When checking in, this verifies biometric user presence (Face ID / Fingerprint / Device PIN)
 * right before GPS transmission.
 */
export async function authenticateWithPasskey(
  userName: string,
  userMatric: string
): Promise<{ success: boolean; error?: string }> {
  if (!isPasskeySupported()) {
    // If browser/device doesn't support WebAuthn, we allow graceful fallback
    return { success: true };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Prompt device biometric / screen lock (Touch ID, Face ID, Android Fingerprint, Windows Hello)
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'CampusPulse Attendance',
          id: window.location.hostname,
        },
        user: {
          id: new TextEncoder().encode(userMatric),
          name: userMatric,
          displayName: userName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // built-in biometric / device PIN
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });

    if (credential) {
      return { success: true };
    }
    return { success: false, error: 'Biometric verification cancelled.' };
  } catch (err: unknown) {
    const errorObj = err as { name?: string; message?: string };
    if (errorObj?.name === 'NotAllowedError') {
      return {
        success: false,
        error: 'Biometric verification was cancelled or timed out. Please verify with fingerprint or Face ID to check in.',
      };
    }
    // If platform authenticator not available on this specific hardware, gracefully continue
    console.warn('WebAuthn platform auth fallback:', err);
    return { success: true };
  }
}
