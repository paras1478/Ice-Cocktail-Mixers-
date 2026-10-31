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

interface GeoapifyResult { housenumber?: string; street?: string; name?: string; suburb?: string; district?: string; neighbourhood?: string; city?: string; town?: string; village?: string; county?: string; state_district?: string; state?: string; postcode?: string; formatted?: string; result_type?: string; lat?: number; lon?: number }

const NOT_SET_UP = "Address lookup is not set up yet. Tap the map or enter the address manually.";

// Geoapify (OpenStreetMap based) answers both "which address is at this pin?" and "where is this address?". The key stays on the server.
async function geoapify(path: string, params: Record<string, string>): Promise<GeoapifyResult[]> {
  if (!env.GEOAPIFY_API_KEY) throw new HttpError(503, NOT_SET_UP);
  try {
    const res = await fetch(`${env.GEOAPIFY_URL}${path}?${new URLSearchParams({ format: "json", lang: "en", ...params, apiKey: env.GEOAPIFY_API_KEY })}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // the URL (which holds the key) is never put in the message
    const body = (await res.json()) as { results?: GeoapifyResult[] };
    return Array.isArray(body.results) ? body.results : [];
  } catch (e) {
    throw new HttpError(502, `Could not reach the address service (${e instanceof Error ? e.message : "error"}). You can enter it manually.`);
  }
}

function fromGeoapify(r: GeoapifyResult = {}): ReverseGeocode {
  const pin = r.postcode?.replace(/\s/g, "") ?? "";
  const road = r.street ?? (r.result_type === "street" ? r.name : undefined);
  const city = r.city ?? r.town ?? r.village ?? null;
  return {
    line1: [r.housenumber, road].filter(Boolean).join(" ") || null,
    area: r.suburb ?? r.neighbourhood ?? r.district ?? null,
    city: city ?? r.county ?? null,
    district: r.county ?? r.state_district ?? city,
    state: r.state ?? null,
    pincode: /^[1-9]\d{5}$/.test(pin) ? pin : null,
    displayName: r.formatted ?? null,
  };
}

export interface PlaceMatch extends ReverseGeocode { latitude: number; longitude: number }

/** Address / PIN search (forward geocoding), India only. */
export async function searchPlaces(query: string): Promise<PlaceMatch[]> {
  const results = await geoapify("/v1/geocode/search", { text: query.trim(), filter: "countrycode:in", limit: "5" });
  return results.flatMap((r) => (typeof r.lat === "number" && typeof r.lon === "number" && Number.isFinite(r.lat) && Number.isFinite(r.lon)
    ? [{ ...fromGeoapify(r), latitude: Number(r.lat.toFixed(6)), longitude: Number(r.lon.toFixed(6)) }] : []));
}

/** Reverse geocoding for the customer's pin (the nearest address). Fields it can't determine are null. */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode> {
  const [hit] = await geoapify("/v1/geocode/reverse", { lat: String(lat), lon: String(lng) });
  return fromGeoapify(hit);
}
