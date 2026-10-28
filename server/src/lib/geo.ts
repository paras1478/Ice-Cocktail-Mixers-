import { env } from "./env.js";
import { HttpError } from "./errors.js";
import { stateCodeFor } from "./states.js";

// Postal PIN lookup answers "which post offices / district / state is this PIN in?" for ANY Indian PIN code the provider knows.
// It says nothing about whether we deliver there: serviceability comes from the ServiceArea table.

export interface PostOffice {
  name: string;
  district: string;
  state: string;
  stateCode: string | null;
  block?: string;
}
export interface PostalInfo {
  pincode: string;
  offices: PostOffice[];
  district: string | null;
  state: string | null;
  /** ISO 3166-2:IN code derived from the state name (the postal API does not return one). */
  stateCode: string | null;
}

// Successful lookups are cached for a long time, "no such PIN" for a short time (data can be corrected), failures are never cached.
// The cache is bounded (oldest entries drop first) and identical concurrent lookups share one upstream request.
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const TIMEOUT_MS = 7000;
const cache = new Map<string, { at: number; ttl: number; value: PostalInfo | null }>();
const inflight = new Map<string, Promise<PostalInfo | null>>();

export const clearPostalCache = () => { cache.clear(); inflight.clear(); };

const remember = (pin: string, value: PostalInfo | null) => {
  cache.delete(pin);
  cache.set(pin, { at: Date.now(), ttl: value ? FOUND_TTL_MS : MISSING_TTL_MS, value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
};

async function fetchPostal(pincode: string): Promise<PostalInfo | null> {
  let body: unknown;
  try {
    const res = await fetch(`${env.PINCODE_API_URL}/${pincode}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new HttpError(502, `The postal PIN lookup service is unavailable (${timedOut ? "timed out" : e instanceof Error ? e.message : "error"}). You can enter the area, district and state manually.`);
  }
  const first = Array.isArray(body) ? (body[0] as { Status?: string; PostOffice?: Record<string, string>[] } | undefined) : undefined;
  if (!first) throw new HttpError(502, "The postal PIN lookup service returned an unexpected response. You can enter the area, district and state manually.");
  if (first.Status === "Success" && Array.isArray(first.PostOffice) && first.PostOffice.length) {
    const offices = first.PostOffice.map((o) => ({ name: o.Name, district: o.District, state: o.State, stateCode: stateCodeFor(o.State), block: o.Block && o.Block !== "NA" ? o.Block : undefined }));
    return { pincode, offices, district: offices[0].district ?? null, state: offices[0].state ?? null, stateCode: offices[0].stateCode };
  }
  return null; // the provider has no record of this PIN
}

/** Returns null for a PIN the postal service does not know. Throws HttpError(502) when the lookup itself fails. */
export async function lookupPincode(pincode: string): Promise<PostalInfo | null> {
  const hit = cache.get(pincode);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const pending = inflight.get(pincode);
  if (pending) return pending;
  const p = fetchPostal(pincode).then((v) => { remember(pincode, v); return v; }).finally(() => inflight.delete(pincode));
  inflight.set(pincode, p);
  return p;
}

export interface ReverseGeocode {
  line1: string | null;
  area: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  displayName: string | null;
}

/** Optional reverse geocoding for the customer's GPS position (OpenStreetMap Nominatim by default). */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode> {
  let body: { display_name?: string; address?: Record<string, string> };
  try {
    const url = `${env.REVERSE_GEOCODE_URL}?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": env.GEOCODER_USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new HttpError(502, `Could not turn your location into an address (${e instanceof Error ? e.message : "error"}). You can enter it manually.`);
  }
  const a = body.address ?? {};
  const pincode = a.postcode && /^[1-9]\d{5}$/.test(a.postcode.replace(/\s/g, "")) ? a.postcode.replace(/\s/g, "") : null;
  return {
    line1: [a.house_number, a.road].filter(Boolean).join(" ") || null,
    area: a.suburb ?? a.neighbourhood ?? a.village ?? null,
    city: a.city ?? a.town ?? a.village ?? a.county ?? null,
    district: a.state_district ?? a.county ?? null,
    state: a.state ?? null,
    pincode,
    displayName: body.display_name ?? null,
  };
}
