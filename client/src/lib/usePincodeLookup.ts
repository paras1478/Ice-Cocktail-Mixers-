import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { api, apiError } from "./api";
import { pincodeError } from "./pincode";
import type { PincodeResult } from "./types";

/**
 * idle: fewer than six digits (or malformed) · looking: request in flight · done: server answered · error: our own API failed or timed out.
 * Note "done" covers a postal service outage too: that is reported inside result.postal, and delivery is still answered.
 */
export type LookupStatus = "idle" | "looking" | "done" | "error";

export interface Lookup {
  status: LookupStatus;
  result: PincodeResult | null;
  error: string | null;
  retry: () => void;
}

export const LOOKUP_DEBOUNCE_MS = 400;
export const LOOKUP_TIMEOUT_MS = 12000;

/**
 * Looks a PIN up (postal suggestions + delivery serviceability) once six valid digits are entered, after a short debounce.
 * Every PIN change aborts the previous request and ignores late answers, so an old response can never overwrite a newer PIN.
 */
export function usePincodeLookup(pin: string, debounceMs = LOOKUP_DEBOUNCE_MS): Lookup {
  const [state, setState] = useState<Omit<Lookup, "retry">>({ status: "idle", result: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (pincodeError(pin)) { setState({ status: "idle", result: null, error: null }); return; }
    const controller = new AbortController();
    let live = true;
    setState({ status: "looking", result: null, error: null });
    const timer = setTimeout(() => {
      api.get<PincodeResult>(`/pincode/${pin}`, { signal: controller.signal, timeout: LOOKUP_TIMEOUT_MS })
        .then((r) => { if (live) setState({ status: "done", result: r.data, error: null }); })
        .catch((e) => {
          if (!live || axios.isCancel(e)) return;
          setState({ status: "error", result: null, error: apiError(e).message });
        });
    }, debounceMs);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [pin, attempt, debounceMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
