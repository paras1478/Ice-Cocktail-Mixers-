import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  latitude: number;
  longitude: number;
  /** Radius in metres of the uncertainty circle (only shown when it is large enough to matter). */
  accuracy?: number | null;
  /** When set the pin can be dragged; called with the new coordinates once the drag ends. */
  onMove?: (latitude: number, longitude: number) => void;
  label?: string;
  className?: string;
}

// An inline SVG pin: Leaflet's default marker images do not survive bundling, and this needs no asset files.
const pin = L.divIcon({
  className: "",
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  html: '<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 1C8 1 2 7.2 2 15c0 10.5 14 26 14 26s14-15.5 14-26C30 7.2 24 1 16 1z" fill="#d97706" stroke="#7c2d12" stroke-width="2"/><circle cx="16" cy="15" r="5.5" fill="#fff"/></svg>',
});

/**
 * Map with one pin at [latitude, longitude] (Leaflet takes latitude first). It re-centres and moves the pin whenever the
 * coordinates change. OpenStreetMap tiles: no API key needed.
 */
export default function LocationMap({ latitude, longitude, accuracy, onMove, label = "Map showing the selected location", className = "h-56 sm:h-72" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const moved = useRef(onMove);
  moved.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: [latitude, longitude], zoom: 17, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    const mk = L.marker([latitude, longitude], { icon: pin, draggable: !!moved.current, keyboard: false, alt: "Selected location" }).addTo(m);
    mk.on("dragend", () => {
      const p = mk.getLatLng();
      moved.current?.(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
    });
    map.current = m;
    marker.current = mk;
    // The container may still be laying out (modal, step change): re-measure so the tiles fill it and the centre is right.
    const t = setTimeout(() => m.invalidateSize(), 0);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(el.current);
    return () => { clearTimeout(t); ro?.disconnect(); m.remove(); map.current = null; marker.current = null; circle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !marker.current) return;
    const at: L.LatLngExpression = [latitude, longitude];
    marker.current.setLatLng(at);
    circle.current?.remove();
    circle.current = accuracy && accuracy > 50 ? L.circle(at, { radius: accuracy, color: "#d97706", weight: 1, fillOpacity: 0.12 }).addTo(m) : null;
    // A rough fix is shown zoomed out so the whole uncertainty area is visible; a precise one is shown close up.
    if (circle.current && accuracy && accuracy > 1000) m.fitBounds(circle.current.getBounds(), { padding: [12, 12], maxZoom: 15 });
    else m.setView(at, Math.max(m.getZoom(), 16));
  }, [latitude, longitude, accuracy]);

  return <div ref={el} role="img" aria-label={label} data-testid="location-map" className={`z-0 w-full overflow-hidden rounded-xl border border-line ${className}`} />;
}
