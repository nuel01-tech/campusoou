import { appError } from './errors';
import type { GeoFix } from '@/types';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. Matches public.distance_m in SQL. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

interface LocateOptions {
  /** Keep watching until accuracy is at or below this many metres. */
  targetAccuracy?: number;
  /** Give up after this many ms without a sufficiently accurate fix. */
  timeoutMs?: number;
  /** Never return a fix whose reported uncertainty exceeds this many metres. */
  maxAccuracy?: number;
}

/**
 * Inspects the browser Geolocation runtime for script injection, console monkey-patching,
 * spoofing extensions (e.g., Location Guard / Vytal), or headless automation.
 */
export function detectGeolocationTampering(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  // 1. Block automated headless browsers (Puppeteer / Playwright / Selenium)
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) {
    return true;
  }

  // Do not inspect Function#toString or property descriptors here. Legitimate
  // browsers, privacy tools, accessibility layers and OEM WebViews can wrap these
  // methods. Those heuristics reject real phones without proving GPS spoofing.
  // Keep the reliable automation signal; validate the actual fix below and enforce
  // the attendance geofence again in the database.
  return false;
}

function isSyntheticPosition(pos: GeolocationPosition): boolean {
  try {
    if (!pos || !pos.coords) return true;
    const { latitude, longitude, accuracy } = pos.coords;
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(accuracy) ||
      accuracy <= 0
    ) {
      return true;
    }

    // Do not require a particular GeolocationCoordinates prototype or descriptor
    // layout: those vary across browser engines and embedded Android WebViews.
  } catch {
    return true;
  }
  return false;
}

/**
 * Gets the current position. Phones often return a coarse fix first and then
 * refine it, so we watch briefly and return the most accurate reading.
 */
export function locate({ targetAccuracy = 30, timeoutMs = 25_000, maxAccuracy = 150 }: LocateOptions = {}): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(appError('GEO_INSECURE'));
    if (!('geolocation' in navigator)) return reject(appError('GEO_UNSUPPORTED'));
    if (detectGeolocationTampering()) return reject(appError('GEO_SPOOF_DETECTED'));

    let best: GeoFix | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      fn();
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (isSyntheticPosition(pos)) {
          return finish(() => reject(appError('GEO_SPOOF_DETECTED')));
        }
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= targetAccuracy) finish(() => resolve(fix));
      },
      (err) => {
        // A coarse network/cell-tower fix is not safe for attendance geofencing.
        if (best && best.accuracy <= maxAccuracy) return finish(() => resolve(best!));
        if (best) return finish(() => reject(appError('GEO_LOW_ACCURACY', String(Math.round(best!.accuracy)))));
        const code =
          err.code === err.PERMISSION_DENIED
            ? 'GEO_DENIED'
            : err.code === err.TIMEOUT
              ? 'GEO_TIMEOUT'
              : 'GEO_UNAVAILABLE';
        finish(() => reject(appError(code)));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );

    const timer = setTimeout(() => {
      if (best && best.accuracy <= maxAccuracy) {
        finish(() => resolve(best!));
      } else if (best) {
        finish(() => reject(appError('GEO_LOW_ACCURACY', String(Math.round(best!.accuracy)))));
      } else {
        finish(() => reject(appError('GEO_TIMEOUT')));
      }
    }, timeoutMs);
  });
}
