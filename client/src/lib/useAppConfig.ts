import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppConfig } from "./types";

let cached: Promise<AppConfig | null> | null = null;
const load = () => (cached ??= api.get<AppConfig>("/config").then((r) => r.data).catch(() => { cached = null; return null; }));

/** The server's public config (delivery fee and free-delivery threshold). null until loaded or if it can't be reached; callers then show nothing rather than guess. */
export function useAppConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    let live = true;
    load().then((c) => { if (live) setCfg(c); });
    return () => { live = false; };
  }, []);
  return cfg;
}

/** "Delivery ₹29, free above ₹499" built only from the server's configuration; null when it isn't available. */
export function deliveryFeeText(cfg: AppConfig | null, fmt: (minor: number) => string): string | null {
  if (!cfg || typeof cfg.deliveryFeeMinor !== "number") return null;
  if (cfg.deliveryFeeMinor === 0) return "Free delivery";
  const free = cfg.freeDeliveryThresholdMinor > 0 && cfg.freeDeliveryThresholdMinor < Number.MAX_SAFE_INTEGER ? `, free above ${fmt(cfg.freeDeliveryThresholdMinor)}` : "";
  return `Delivery ${fmt(cfg.deliveryFeeMinor)}${free}`;
}
