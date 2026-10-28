// Money is integer minor units (paise) end to end; formatting is the only place we divide.
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const formatMoney = (minor: number) => inr.format(minor / 100);

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export const rupeesToMinor = (rupees: string | number) => Math.round(Number(rupees) * 100);
export const minorToRupees = (minor: number) => (minor / 100).toString();

export interface AddressParts {
  house?: string | null;
  line1: string;
  landmark?: string | null;
  area?: string | null;
  district?: string | null;
  city: string;
  state: string;
  pincode: string;
}
/** One-line postal address. */
export const formatAddress = (a: AddressParts) =>
  [a.house, a.line1, a.landmark ? `Near ${a.landmark}` : null, a.area, a.district || a.city, `${a.state} ${a.pincode}`].filter(Boolean).join(", ");

/** Map link for stored GPS coordinates (OpenStreetMap; no API key needed). */
export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
