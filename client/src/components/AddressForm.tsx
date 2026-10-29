import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Crosshair, MapPin } from "lucide-react";
import { api, apiError } from "../lib/api";
import { cleanPin, pincodeError } from "../lib/pincode";
import { mapLink } from "../lib/format";
import { accuracyNote, currentFix, describeAccuracy, GEO_MESSAGES, GeoError, inIndia, isCoarse } from "../lib/geolocate";
import { usePincodeLookup } from "../lib/usePincodeLookup";
import type { AddressType, PostOffice } from "../lib/types";
import { PinFeedback } from "./DeliveryInfo";
import { FieldError } from "./ui";

const LocationMap = lazy(() => import("./LocationMap")); // Leaflet is only downloaded when a location is actually shown
const MapFallback = () => <div className="h-56 animate-pulse rounded-xl bg-tint sm:h-72" aria-hidden />;

export interface AddressDraft {
  type: AddressType;
  house: string;
  line1: string;
  landmark: string;
  /** Postal area / post office. */
  area: string;
  district: string;
  state: string;
  /** ISO 3166-2:IN code, shown read-only; only present while it matches the state the lookup detected. */
  stateCode: string;
  /** Contact number for this address (10-digit Indian mobile). */
  phone: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

export const emptyAddress: AddressDraft = { type: "HOME", house: "", line1: "", landmark: "", area: "", district: "", state: "", stateCode: "", phone: "", pincode: "", latitude: null, longitude: null };

/** Client-side checks mirroring the server rules. Returns field -> message. */
export function validateAddress(a: AddressDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.house.trim()) e.house = "Enter your house / flat number";
  if (a.line1.trim().length < 3) e.line1 = "Enter the building, street or locality";
  if (a.district.trim().length < 2) e.district = "Enter the district";
  if (a.state.trim().length < 2) e.state = "Enter the state";
  if (!/^[6-9]\d{9}$/.test(a.phone)) e.phone = "Enter a valid 10-digit mobile number";
  const p = pincodeError(a.pincode);
  if (p) e.pincode = p;
  return e;
}

export const addressPayload = (a: AddressDraft) => ({
  type: a.type, house: a.house.trim(), line1: a.line1.trim(), landmark: a.landmark.trim() || null,
  area: a.area.trim() || null, district: a.district.trim(), city: a.district.trim(), state: a.state.trim(), phone: a.phone, pincode: a.pincode,
  latitude: a.latitude, longitude: a.longitude,
});

/** Saved-address and order records use `city`; the form edits `district` (they are the same place). */
export const draftFromRecord = (a: { type: AddressType | null; house: string | null; line1: string; landmark: string | null; area?: string | null; district?: string | null; city: string; state: string; stateCode?: string | null; phone?: string | null; pincode: string; latitude: number | null; longitude: number | null }): AddressDraft => ({
  type: a.type ?? "HOME", house: a.house ?? "", line1: a.line1, landmark: a.landmark ?? "", area: a.area ?? "", district: a.district ?? a.city, state: a.state, stateCode: a.stateCode ?? "", phone: a.phone ?? "", pincode: a.pincode, latitude: a.latitude, longitude: a.longitude,
});

interface Detected { latitude: number; longitude: number; accuracy?: number | null; outside?: boolean; coarse?: boolean; address?: { line1: string | null; area: string | null; district: string | null; city: string | null; state: string | null; pincode: string | null }; note?: string }

/** `onChange` receives a patch, never a whole object, so a slow lookup can't overwrite fields typed in the meantime. */
export function AddressForm({ value, errors, onChange }: { value: AddressDraft; errors: Record<string, string>; onChange: (patch: Partial<AddressDraft>) => void }) {
  const lookup = usePincodeLookup(value.pincode);
  const [gps, setGps] = useState<{ busy: boolean; error: string | null; found: Detected | null }>({ busy: false, error: null, found: null });
  const latest = useRef(value);
  latest.current = value;
  // What we last filled in automatically, so a new PIN may replace those values but never the customer's own edits.
  const auto = useRef<{ area: string; district: string; state: string; stateCode: string }>({ area: "", district: "", state: "", stateCode: "" });
  const result = lookup.status === "done" ? lookup.result : null;
  const postal = result?.postal ?? null;
  const offices: PostOffice[] = postal?.status === "found" ? postal.offices : [];

  useEffect(() => {
    if (postal?.status !== "found") return;
    const cur = latest.current;
    const mine = (field: "area" | "district" | "state" | "stateCode") => cur[field] === "" || cur[field] === auto.current[field];
    const next = { area: offices.length === 1 ? offices[0].name : "", district: postal.district ?? "", state: postal.state ?? "", stateCode: postal.stateCode ?? "" };
    const patch: Partial<AddressDraft> = {};
    for (const f of ["area", "district", "state", "stateCode"] as const) {
      // With several post offices the area is left for the customer to choose.
      if (mine(f) && (f !== "area" || offices.length === 1 || cur.area === auto.current.area)) { if (cur[f] !== next[f]) patch[f] = next[f]; auto.current[f] = next[f]; }
    }
    if (Object.keys(patch).length) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postal]);

  const pickOffice = (name: string) => {
    const o = offices.find((x) => x.name === name);
    if (!o) return onChange({ area: "" });
    auto.current.area = o.name;
    const keepState = !!value.state && value.state !== auto.current.state;
    onChange({ area: o.name, district: value.district && value.district !== auto.current.district ? value.district : o.district, ...(keepState ? {} : { state: o.state, stateCode: o.stateCode ?? "" }) });
  };

  // Only the most recent request may update the screen (a slow reverse lookup must not overwrite a newer pin).
  const seq = useRef(0);
  const reverse = async (latitude: number, longitude: number, accuracy: number | null, id: number) => {
    if (!inIndia(latitude, longitude)) {
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, outside: true, note: "This location is outside India, where we deliver, so we can't suggest an address or use this pin. Enter your address manually." } });
      return;
    }
    if (isCoarse(accuracy)) {
      // A city-level guess is not an address: looking it up would just name a landmark near the city centre, so no address is suggested.
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, coarse: true, note: "We can't suggest an address from such a rough position. Drag the pin to your delivery spot and the address will be looked up for that spot." } });
      return;
    }
    try {
      const { data } = await api.post("/geo/reverse", { latitude, longitude });
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, address: data } });
    } catch (e) {
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, note: apiError(e).message } });
    }
  };
  const locate = async () => {
    const id = ++seq.current;
    setGps({ busy: true, error: null, found: null });
    try {
      const fix = await currentFix();
      if (id === seq.current) await reverse(fix.latitude, fix.longitude, fix.accuracy, id);
    } catch (e) {
      if (id === seq.current) setGps({ busy: false, found: null, error: e instanceof GeoError ? e.message : GEO_MESSAGES.unavailable });
    }
  };
  // The pin was dragged: the address shown must belong to the NEW coordinates, so look it up again.
  const moveFound = (latitude: number, longitude: number) => {
    const id = ++seq.current;
    setGps((g) => ({ ...g, found: { latitude, longitude, accuracy: null, note: "Looking up the address for the moved pin…" } }));
    void reverse(latitude, longitude, null, id);
  };
  // Nothing is filled until the customer confirms what was detected.
  const useDetected = (d: Detected, withAddress: boolean) => {
    const a = d.address;
    const cur = latest.current;
    onChange({
      latitude: d.latitude, longitude: d.longitude,
      ...(withAddress && a ? {
        line1: cur.line1 || [a.line1, a.area].filter(Boolean).join(", "),
        area: cur.area || a.area || "", district: cur.district || a.district || a.city || "", state: cur.state || a.state || "", pincode: cur.pincode || a.pincode || "",
      } : {}),
    });
    setGps({ busy: false, error: null, found: null });
  };

  const field = (id: keyof AddressDraft, label: string, props: { autoComplete?: string; placeholder?: string } = {}) => (
    <div>
      <label htmlFor={`addr-${id}`} className="label">{label}</label>
      <input id={`addr-${id}`} className="input" value={String(value[id] ?? "")} aria-invalid={!!errors[id]} aria-describedby={`addr-${id}-err`} onChange={(e) => onChange({ [id]: id === "phone" ? e.target.value.replace(/\D/g, "").slice(0, 10) : e.target.value } as Partial<AddressDraft>)} inputMode={id === "phone" ? "numeric" : undefined} {...props} />
      <FieldError id={`addr-${id}-err`} message={errors[id]} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-band p-3">
        <button type="button" className="btn-ghost w-full sm:w-auto" onClick={locate} disabled={gps.busy}><Crosshair className="h-4 w-4" aria-hidden />{gps.busy ? "Locating…" : "Use my current location"}</button>
        <p className="mt-1.5 text-xs text-muted">Optional. Your browser will ask for permission; we only use your position to help fill this address and we never track you.</p>
        {gps.error && <p role="alert" className="mt-2 text-xs font-semibold text-warn">{gps.error}</p>}
        {gps.found && (
          <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm" data-testid="gps-found">
            {gps.found.address ? <p><b>Detected:</b> {[gps.found.address.line1, gps.found.address.area, gps.found.address.district ?? gps.found.address.city, gps.found.address.state, gps.found.address.pincode].filter(Boolean).join(", ")}</p>
              : <p className="text-warn">{gps.found.note}</p>}
            {!gps.found.outside && <div className="mt-3"><Suspense fallback={<MapFallback />}><LocationMap latitude={gps.found.latitude} longitude={gps.found.longitude} accuracy={gps.found.accuracy} onMove={moveFound} label="Your detected location. Drag the pin to adjust it." /></Suspense></div>}
            <p className="mt-1 text-xs text-muted" data-testid="gps-coords">Latitude {gps.found.latitude}, longitude {gps.found.longitude} · accuracy {describeAccuracy(gps.found.accuracy ?? null)}{!gps.found.outside && " · drag the pin to adjust it"}</p>
            {accuracyNote(gps.found.accuracy ?? null) && <p className="mt-1 text-xs font-semibold text-warn">{accuracyNote(gps.found.accuracy ?? null)}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {gps.found.address && <button type="button" className="btn-add-solid" onClick={() => useDetected(gps.found!, true)}>Use this address</button>}
              {!gps.found.outside && !gps.found.coarse && <button type="button" className="btn-ghost" onClick={() => useDetected(gps.found!, false)}>Use pin only</button>}
              <button type="button" className="btn-ghost" onClick={() => setGps({ busy: false, error: null, found: null })}>Dismiss</button>
            </div>
          </div>
        )}
        {value.latitude !== null && value.longitude !== null && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs"><MapPin className="h-3.5 w-3.5" aria-hidden />GPS pin saved with this address ·
            <a className="font-semibold underline" href={mapLink(value.latitude, value.longitude)} target="_blank" rel="noreferrer">View on map</a>
            <button type="button" className="font-semibold underline" onClick={() => onChange({ latitude: null, longitude: null })}>Remove pin</button></p>
        )}
        {value.latitude !== null && value.longitude !== null && <div className="mt-2"><Suspense fallback={<MapFallback />}><LocationMap latitude={value.latitude} longitude={value.longitude} label="Map showing the pin saved with this address" /></Suspense></div>}
      </div>

      <div>
        <label htmlFor="addr-pincode" className="label">PIN code</label>
        <input id="addr-pincode" className="input sm:max-w-48" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={value.pincode} aria-invalid={!!errors.pincode} aria-describedby="addr-pincode-err addr-pincode-status"
          onChange={(e) => onChange({ pincode: cleanPin(e.target.value) })} placeholder="6 digits" />
        <FieldError id="addr-pincode-err" message={errors.pincode} />
        <div id="addr-pincode-status" className="mt-2" aria-live="polite">
          <PinFeedback status={lookup.status} postal={postal} delivery={result?.delivery ?? null} error={lookup.error} onRetry={lookup.retry} />
        </div>
      </div>

      {offices.length > 1 && (
        <div>
          <label htmlFor="addr-office" className="label">Select your post office / area</label>
          <select id="addr-office" className="input" value={offices.some((o) => o.name === value.area) ? value.area : ""} onChange={(e) => pickOffice(e.target.value)}>
            <option value="">Choose your area…</option>
            {offices.map((o) => <option key={o.name} value={o.name}>{o.name}{o.block ? ` (${o.block})` : ""}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{offices.length} areas share this PIN code. You can also type your own area below.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("house", "House / flat no.", { autoComplete: "address-line1", placeholder: "e.g. 12B" })}
        {field("line1", "Street / locality", { autoComplete: "address-line2" })}
        {field("area", "Area / post office", { placeholder: "Filled from your PIN code" })}
        {field("district", "City / district", { autoComplete: "address-level2" })}
        <div>
          <label htmlFor="addr-state" className="label">State</label>
          <input id="addr-state" className="input" autoComplete="address-level1" value={value.state} aria-invalid={!!errors.state} aria-describedby="addr-state-err addr-state-code" onChange={(e) => onChange({ state: e.target.value, stateCode: "" })} />
          <FieldError id="addr-state-err" message={errors.state} />
          {value.stateCode && <p id="addr-state-code" className="mt-1 text-xs text-muted" data-testid="state-code">State code: <b>{value.stateCode}</b></p>}
        </div>
        {field("landmark", "Landmark (optional)", { placeholder: "Near…" })}
        {field("phone", "Mobile number", { autoComplete: "tel-national", placeholder: "10-digit mobile" })}
        <div>
          <label htmlFor="addr-type" className="label">Address type</label>
          <select id="addr-type" className="input" value={value.type} onChange={(e) => onChange({ type: e.target.value as AddressType })}>
            <option value="HOME">Home</option><option value="WORK">Work</option><option value="OTHER">Other</option>
          </select>
        </div>
      </div>
    </div>
  );
}
