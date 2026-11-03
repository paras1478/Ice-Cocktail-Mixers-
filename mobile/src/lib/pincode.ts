// Indian postal PIN codes are exactly six digits and never start with 0.
export const PIN_RE = /^[1-9]\d{5}$/;

/** Returns an error message, or null when the PIN is well formed. */
export function pincodeError(pin: string): string | null {
  if (!pin) return "Enter your 6-digit PIN code";
  if (!/^\d+$/.test(pin)) return "PIN code can only contain digits";
  if (pin.length !== 6) return "PIN code must be 6 digits";
  if (!PIN_RE.test(pin)) return "PIN code cannot start with 0";
  return null;
}

/** Keep only digits, max 6 (for controlled inputs). */
export const cleanPin = (v: string) => v.replace(/\D/g, "").slice(0, 6);
