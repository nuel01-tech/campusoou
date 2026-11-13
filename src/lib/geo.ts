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
  /** Maximum total time to wait for a usable fix. */
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
export function locate({ targetAccuracy = 50, timeoutMs = 60_000, maxAccuracy = 250 }: LocateOptions = {}): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(appError('GEO_INSECURE'));
    if (!('geolocation' in navigator)) return reject(appError('GEO_UNSUPPORTED'));
    if (detectGeolocationTampering()) return reject(appError('GEO_SPOOF_DETECTED'));

    let best: GeoFix | null = null;
    let settled = false;
    let watchId: number | undefined;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      fn();
    };

    // Do not set GeolocationPositionOptions.timeout here. On Android Chrome,
    // the browser-level timeout can fire before the phone's location provider
    // produces its first fix and prematurely ends a watch that could still work.
    // The independent timer below is the single overall deadline.
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (isSyntheticPosition(pos)) {
          return finish(() => reject(appError('GEO_SPOOF_DETECTED')));
        }
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= targetAccuracy) finish(() => resolve(fix));
      },
      (err) => {
        // Permission denial is definitive and should be shown immediately.
        // POSITION_UNAVAILABLE/TIMEOUT can be transient while Android Chrome
        // initializes GPS; keep the watch alive and let the overall deadline
        // decide whether a sufficiently accurate fix was obtained.
        if (err.code === err.PERMISSION_DENIED) {
          finish(() => reject(appError('GEO_DENIED')));
        }
      },
      {
        enableHighAccuracy: true,
        // A very recent browser fix is still useful; forcing maximumAge: 0
        // can make Android Chrome wait for a brand-new GPS acquisition even
        // when the phone already has a reliable location from another app.
        maximumAge: 10_000,
      },
    );

    timer = setTimeout(() => {
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
