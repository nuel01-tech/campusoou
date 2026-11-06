/** Normalisation shared by import, display and tests. Mirrors the SQL helpers. */

export function normalizeMatric(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** "okafor CHINEDU" → "Okafor Chinedu". Only used for display of typed input. */
export function titleCase(value: string): string {
  return normalizeName(value)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Extracts lowercase alphabetic word tokens, mirroring SQL `public.name_tokens()`. */
export function nameTokens(value: string): string[] {
  return (value || '')
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function oneWayNameMatch(rosterName: string, typedName: string): boolean {
  const r = Array.from(new Set(nameTokens(rosterName)));
  const u = Array.from(new Set(nameTokens(typedName)));
  if (u.length === 0 || r.length === 0) return false;
  const rSet = new Set(r);
  if (!u.every((token) => rSet.has(token))) return false;
  return u.length >= Math.min(2, r.length);
}

/**
 * Symmetric name match between a roster student name and a Class Rep profile name.
 * Word order and extra middle names/initials do not prevent matching.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return oneWayNameMatch(a, b) || oneWayNameMatch(b, a);
}

