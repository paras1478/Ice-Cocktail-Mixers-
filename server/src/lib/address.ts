import { z } from "zod";
import { prisma } from "./db.js";
import { stateCodeFor } from "./states.js";

const pincode = z.string().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code");

// Rough bounding box of India (incl. islands). Catches swapped or nonsensical GPS values, not borders.
const lat = z.number().min(6).max(38).nullable().optional();
const lng = z.number().min(68).max(98).nullable().optional();

export const addressFields = z.object({
  type: z.enum(["HOME", "WORK", "OTHER"]).default("HOME"),
  house: z.string().trim().min(1, "Enter your house / flat number").max(80),
  line1: z.string().trim().min(3, "Enter the building, street or area").max(200),
  landmark: z.string().trim().max(120).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().min(2, "Enter the state").max(80),
  pincode,
  latitude: lat,
  longitude: lng,
});

/** GPS coordinates are optional but must come as a pair. */
export function checkCoords(a: { latitude?: number | null; longitude?: number | null }) {
  const has = (n: number | null | undefined) => n !== null && n !== undefined;
  return has(a.latitude) === has(a.longitude);
}
export const COORD_MESSAGE = "Latitude and longitude must be provided together";

export const addressBody = addressFields
  .extend({
    label: z.string().trim().min(1).max(40).default("Home"),
    recipientName: z.string().trim().min(2).max(80).nullable().optional(),
    phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number").nullable().optional(),
    isDefault: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  })
  .refine(checkCoords, { message: COORD_MESSAGE, path: ["latitude"] })
  .refine((a) => Boolean((a.city && a.city.trim().length >= 2) || (a.district && a.district.trim().length >= 2)), { message: "Enter the district", path: ["district"] });

/** City and district are the same place for most Indian addresses: accept either and fill in the other, so neither is ever blank. */
export function normalizeAddress<T extends { city?: string | null; district?: string | null; area?: string | null; state: string }>(a: T): T & { city: string; district: string; area: string | null; stateCode: string | null } {
  const city = a.city?.trim() || a.district?.trim() || "";
  const district = a.district?.trim() || city;
  // The state code is derived on the server from the state name, never taken from the client.
  return { ...a, city, district, area: a.area?.trim() || null, stateCode: stateCodeFor(a.state) };
}

/** An address needs a district (or city) to be deliverable. Used as a zod refinement. */
export const hasPlace = (a: { city?: string | null; district?: string | null }) => Boolean((a.city && a.city.trim().length >= 2) || (a.district && a.district.trim().length >= 2));
export const PLACE_MESSAGE = "Enter the district";

export type Serviceability =
  | { serviceable: true; pincode: string; areaName: string; city: string | null; state: string | null; etaMinutes: number; isSample: boolean }
  | { serviceable: false; pincode: string; reason: "not_covered" | "paused" };

/** Actual delivery coverage. Independent of the postal lookup: a valid PIN is not necessarily deliverable. */
export async function serviceability(pin: string): Promise<Serviceability> {
  const area = await prisma.serviceArea.findUnique({ where: { pincode: pin } });
  if (!area) return { serviceable: false, pincode: pin, reason: "not_covered" };
  if (!area.isActive) return { serviceable: false, pincode: pin, reason: "paused" };
  return { serviceable: true, pincode: pin, areaName: area.areaName, city: area.city, state: area.state, etaMinutes: area.etaMinutes, isSample: area.isSample };
}
