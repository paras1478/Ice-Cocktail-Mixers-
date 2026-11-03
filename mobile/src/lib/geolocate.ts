import * as Location from "expo-location";

/** Device location with honest, specific errors. Never invents a position. */
export interface Fix {
  latitude: number;
  longitude: number;
  /** Radius in metres within which the real position lies. Large values mean network based positioning, not GPS. */
  accuracy: number | null;
}

export type GeoFailure = "denied" | "disabled" | "unavailable" | "timeout";

export const GEO_MESSAGES: Record<GeoFailure, string> = {
  denied: "Location permission was denied. Allow location for this app in your phone's Settings, then try again, or enter your address manually.",
  disabled: "Location services are turned off. Turn on Location / GPS in your phone's settings, then try again, or enter the address manually.",
  unavailable: "Your device could not determine its location. Turn on Location / GPS, then try again, or enter the address manually.",
  timeout: "Finding your location took too long. Check that Location is on and try again, or enter the address manually.",
};

export class GeoError extends Error {
  constructor(public reason: GeoFailure) {
    super(GEO_MESSAGES[reason]);
  }
}

/** A fix at least this precise needs no refinement. */
export const GOOD_M = 100;
/** How long to keep listening for a better fix after a rough first one. */
export const REFINE_MS = 10_000;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new GeoError("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

type Pos = Location.LocationObject;

/** Keep listening briefly and use the best reading; a position that never improves is returned as it is (and labelled approximate by the caller). */
async function refine(first: Pos, ms: number): Promise<Pos> {
  if ((first.coords.accuracy ?? Infinity) <= GOOD_M) return first;
  return new Promise<Pos>((resolve) => {
    let best = first;
    let done = false;
    let sub: Location.LocationSubscription | undefined;
    const timer = setTimeout(() => finish(), ms);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.remove();
      resolve(best);
    }
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (p) => {
      if ((p.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) best = p;
      if ((best.coords.accuracy ?? Infinity) <= GOOD_M) finish();
    })
      .then((s) => {
        sub = s;
        if (done) s.remove();
      })
      .catch(() => finish());
  });
}

/**
 * 1) ask permission (only when the customer taps the button);
 * 2) high accuracy (GPS), always a fresh reading; if that fails, one attempt with balanced (network) accuracy;
 * 3) refine for a few seconds. A permission denial is final.
 */
export async function currentFix(refineMs = REFINE_MS): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new GeoError("denied");
  if (!(await Location.hasServicesEnabledAsync())) throw new GeoError("disabled");
  let pos: Pos;
  try {
    pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 15_000);
  } catch {
    try {
      pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 20_000);
    } catch (e2) {
      throw e2 instanceof GeoError ? e2 : new GeoError("unavailable");
    }
  }
  pos = await refine(pos, refineMs);
  const { latitude, longitude, accuracy } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new GeoError("unavailable");
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: accuracy !== null && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
  };
}

/** Above this the device gave a city-level guess (network based), which cannot place a pin on a street, let alone a house. */
export const COARSE_M = 5000;
export const isCoarse = (accuracy: number | null) => accuracy !== null && accuracy > COARSE_M;

/** The accuracy radius exactly as reported, e.g. "±12 m" or "±200 km". */
export function describeAccuracy(accuracy: number | null): string {
  if (accuracy === null) return "unknown";
  if (accuracy < 1000) return `±${accuracy} m`;
  const km = accuracy / 1000;
  return `±${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

/** What the accuracy means for the customer. Never presents a coarse position as GPS-level. */
export function accuracyNote(accuracy: number | null): string | null {
  if (accuracy === null) return null;
  if (accuracy > COARSE_M) return `Very approximate location (${describeAccuracy(accuracy)}). Your device gave a network based position, not GPS, so this is only roughly your city. Search your address or PIN code above, or tap the map on your exact delivery spot.`;
  if (accuracy > 1000) return `Approximate location (${describeAccuracy(accuracy)}), probably from Wi-Fi or your network, not GPS. Drag the pin to your exact spot.`;
  if (accuracy > 150) return `Accuracy ${describeAccuracy(accuracy)}. Drag the pin to your exact spot if needed.`;
  return null;
}

/** Delivery is India only; the reverse-geocoding endpoint accepts these bounds. */
export const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
