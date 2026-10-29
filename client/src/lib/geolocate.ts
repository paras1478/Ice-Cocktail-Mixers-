/** Browser geolocation with a sensible fallback and honest, specific errors. Never invents a position. */
export interface Fix {
  latitude: number;
  longitude: number;
  /** Radius in metres within which the real position lies (68% confidence). Large values mean Wi-Fi / IP based positioning, not GPS. */
  accuracy: number | null;
}

export type GeoFailure = "unsupported" | "insecure" | "denied" | "unavailable" | "timeout";

export const GEO_MESSAGES: Record<GeoFailure, string> = {
  unsupported: "Your browser does not support location access. Enter the address manually.",
  insecure: "Location only works on a secure (https) page. Open the site with https:// and try again, or enter the address manually.",
  denied: "Location permission was denied. Allow location for this site in your browser's address bar (lock icon → Site settings), then try again, or enter your address manually.",
  unavailable: "Your device could not determine its location. Turn on Location / GPS (on a laptop, Wi-Fi helps), then try again, or enter the address manually.",
  timeout: "Finding your location took too long. Check that Location is on and try again, or enter the address manually.",
};

export class GeoError extends Error {
  constructor(public reason: GeoFailure) {
    super(GEO_MESSAGES[reason]);
  }
}

// GeolocationPositionError codes (numbers, so this also works with minimal browser/test implementations)
const reasonOf = (code: number | undefined): GeoFailure => (code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable");

const ask = (options: PositionOptions) =>
  new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new GeoError(reasonOf(e?.code))), options));

/**
 * 1) high accuracy (GPS on phones), always a fresh reading;
 * 2) if that times out or is unavailable (typical on laptops without GPS), one attempt with network positioning, which is far more likely to answer.
 * A permission denial is final and is not retried.
 */
export async function currentFix(): Promise<Fix> {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new GeoError("unsupported");
  if (typeof window !== "undefined" && window.isSecureContext === false) throw new GeoError("insecure");
  let pos: GeolocationPosition;
  try {
    pos = await ask({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  } catch (e) {
    if (!(e instanceof GeoError) || e.reason === "denied") throw e;
    pos = await ask({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 0 }); // never a cached position
  }
  const { latitude, longitude, accuracy } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new GeoError("unavailable");
  return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)), accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null };
}

/** Above this the browser gave a city-level guess (network / IP based), which cannot place a pin on a street, let alone a house. */
export const COARSE_M = 5000;
export const isCoarse = (accuracy: number | null) => accuracy !== null && accuracy > COARSE_M;

/** The accuracy radius exactly as the browser reported it, e.g. "±12 m" or "±200 km". */
export function describeAccuracy(accuracy: number | null): string {
  if (accuracy === null) return "unknown";
  if (accuracy < 1000) return `±${accuracy} m`;
  const km = accuracy / 1000;
  return `±${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

/** What the accuracy means for the customer. Never presents a coarse position as GPS-level. */
export function accuracyNote(accuracy: number | null): string | null {
  if (accuracy === null) return null;
  if (accuracy > COARSE_M) return `Very approximate location (${describeAccuracy(accuracy)}). Your browser or device gave a network / IP based position, not GPS, so this is only roughly your city. Zoom in and drag the pin to your exact delivery spot, or enter your PIN code below.`;
  if (accuracy > 1000) return `Approximate location (${describeAccuracy(accuracy)}), probably from Wi-Fi or your network, not GPS. Drag the pin to your exact spot.`;
  if (accuracy > 150) return `Accuracy ${describeAccuracy(accuracy)}. Drag the pin to your exact spot if needed.`;
  return null;
}

/** Delivery is India only; the reverse-geocoding endpoint accepts these bounds. */
export const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
