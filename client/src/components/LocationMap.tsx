import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  /** The selected position. null = nothing selected yet: the map shows `view` as a plain temporary map view with no pin. */
  latitude: number | null;
  longitude: number | null;
  /** Radius in metres of the uncertainty circle (only shown when it is large enough to matter). */
  accuracy?: number | null;
  /** When set the customer can place the pin by clicking / tapping the map or dragging the pin. Called with the new coordinates. */
  onMove?: (latitude: number, longitude: number) => void;
  /** Temporary map view used only while nothing is selected. It is NOT a location of the customer. */
  view?: { latitude: number; longitude: number; zoom: number };
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

const round6 = (n: number) => Number(n.toFixed(6));

/**
 * Map with at most one pin at [latitude, longitude] (Leaflet takes latitude first). The pin follows the coordinates it is given,
 * so it re-centres whenever they change, and with `onMove` the customer can place it by clicking the map or dragging it.
 * OpenStreetMap tiles: no API key needed.
 */
export default function LocationMap({ latitude, longitude, accuracy, onMove, view, label = "Map showing the selected location", className = "h-56 sm:h-72" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const moved = useRef(onMove);
  moved.current = onMove;

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const start: L.LatLngExpression = latitude !== null && longitude !== null ? [latitude, longitude] : view ? [view.latitude, view.longitude] : [20.5937, 78.9629];
    const m = L.map(el.current, { center: start, zoom: latitude !== null ? 17 : view?.zoom ?? 5, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    // Click / tap anywhere to place the pin (the only way to choose a spot far from a rough position, where dragging is impractical).
    m.on("click", (e: L.LeafletMouseEvent) => {
      m.scrollWheelZoom.enable(); // wheel zoom is switched on only after the customer interacts, so the page still scrolls normally
      moved.current?.(round6(e.latlng.lat), round6(e.latlng.lng));
    });
    m.on("mouseout", () => m.scrollWheelZoom.disable());
    map.current = m;
    // The container may still be laying out (modal, step change): re-measure so the tiles fill it and the centre is right.
    const t = setTimeout(() => m.invalidateSize(), 0);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(el.current);
    return () => { clearTimeout(t); ro?.disconnect(); m.remove(); map.current = null; marker.current = null; circle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin (and the view) in step with the coordinates, using the values from this render (no stale state).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    circle.current?.remove();
    circle.current = null;
    if (latitude === null || longitude === null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const at: L.LatLngExpression = [latitude, longitude];
    if (!marker.current) {
      const mk = L.marker(at, { icon: pin, draggable: !!moved.current, keyboard: false, alt: "Selected location" }).addTo(m);
      mk.on("dragend", () => {
        const p = mk.getLatLng();
        moved.current?.(round6(p.lat), round6(p.lng)); // the marker's real position, never the initial one
      });
      marker.current = mk;
    } else marker.current.setLatLng(at);
    // interactive:false so the uncertainty circle never swallows clicks meant for placing the pin
    circle.current = accuracy && accuracy > 50 ? L.circle(at, { radius: accuracy, color: "#d97706", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(m) : null;
    // A rough fix is shown zoomed out so the whole uncertainty area is visible; a precise one is shown close up.
    if (circle.current && accuracy && accuracy > 1000) m.fitBounds(circle.current.getBounds(), { padding: [12, 12], maxZoom: 15 });
    else m.setView(at, Math.max(m.getZoom(), 16));
  }, [latitude, longitude, accuracy]);

  return <div ref={el} role="img" aria-label={label} data-testid="location-map" className={`z-0 w-full overflow-hidden rounded-xl border border-line ${className}`} />;
}
