import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, apiError } from "../lib/api";
import { pincodeError } from "../lib/pincode";
import type { Delivery, PincodeResult, PostalResult } from "../lib/types";

/** idle: nothing chosen · checking: request in flight · serviceable · unavailable: valid PIN we do not serve · error: the check itself failed */
export type DeliveryStatus = "idle" | "checking" | "serviceable" | "unavailable" | "error";

interface LocationApi {
  pincode: string | null;
  delivery: Delivery | null;
  /** Postal suggestions (area / district / state) for the same PIN. Independent of delivery coverage. */
  postal: PostalResult | null;
  status: DeliveryStatus;
  error: string | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  /** Validates, asks the server, and remembers the PIN. Throws on invalid input or a failed check. */
  setPincode: (pincode: string) => Promise<PincodeResult>;
  retry: () => Promise<void>;
}

const KEY = "icx_pincode";
const Ctx = createContext<LocationApi | null>(null);
const readStored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function LocationProvider({ children }: { children: ReactNode }) {
  const [pincode, setPin] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [postal, setPostal] = useState<PostalResult | null>(null);
  const [status, setStatus] = useState<DeliveryStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const last = useRef<string | null>(null);
  const seq = useRef(0); // ignore out-of-order responses when the PIN is changed quickly

  const check = useCallback(async (pin: string, remember: boolean): Promise<PincodeResult> => {
    const bad = pincodeError(pin);
    if (bad) throw new Error(bad);
    const mine = ++seq.current;
    last.current = pin;
    setStatus("checking");
    setError(null);
    try {
      const { data } = await api.get<PincodeResult>(`/pincode/${pin}`);
      if (mine !== seq.current) return data;
      setPin(pin);
      setDelivery(data.delivery);
      setPostal(data.postal);
      setStatus(data.delivery.serviceable ? "serviceable" : "unavailable");
      if (remember) { try { localStorage.setItem(KEY, pin); } catch { /* storage unavailable */ } }
      return data;
    } catch (e) {
      const msg = apiError(e).fields.pincode ?? apiError(e).message;
      if (mine === seq.current) { setStatus("error"); setError(msg); }
      throw new Error(msg);
    }
  }, []);

  // Re-check the saved PIN on load so availability is never stale or assumed.
  useEffect(() => {
    const saved = readStored();
    if (saved) check(saved, false).catch(() => undefined);
  }, [check]);

  const setPincode = useCallback((pin: string) => check(pin, true), [check]);
  const retry = useCallback(async () => { if (last.current) await check(last.current, true).catch(() => undefined); }, [check]);

  const value = useMemo(
    () => ({ pincode, delivery, postal, status, error, modalOpen, openModal: () => setModalOpen(true), closeModal: () => setModalOpen(false), setPincode, retry }),
    [pincode, delivery, postal, status, error, modalOpen, setPincode, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocationCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLocationCtx outside LocationProvider");
  return c;
}
