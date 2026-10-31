import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { AttributionControl, Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { GEOAPIFY_KEY, MAP_UNAVAILABLE, TILE_ATTRIBUTION, TILE_URL } from "../lib/geoapify";

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

/** Click / tap anywhere to place the pin (the only way to choose a spot far from a rough position, where dragging is impractical). */
function ClickToPlace({ onMove }: { onMove?: Props["onMove"] }) {
  const map = useMapEvents({
    click: (e) => {
      if (!onMove) return;
      map.scrollWheelZoom.enable(); // wheel zoom is switched on only after the customer interacts, so the page still scrolls normally
      onMove(round6(e.latlng.lat), round6(e.latlng.lng));
    },
    mouseout: () => map.scrollWheelZoom.disable(),
  });
  return null;
}

/** Re-measures the map when its container changes size (modal, step change) so the tiles fill it. */
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(map.getContainer());
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [map]);
  return null;
}

/** Keeps the view in step with the pin: a rough fix is shown zoomed out so the whole uncertainty area is visible, a precise one close up. */
function Follow({ at, accuracy }: { at: L.LatLngTuple; accuracy?: number | null }) {
  const map = useMap();
  const [lat, lng] = at;
  useEffect(() => {
    if (accuracy && accuracy > 1000) map.fitBounds(L.latLng(lat, lng).toBounds(accuracy * 2), { padding: [12, 12], maxZoom: 15 });
    else map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [map, lat, lng, accuracy]);
  return null;
}

/**
 * Map with at most one pin at [latitude, longitude] (Leaflet takes latitude first). The pin follows the coordinates it is given,
 * so it re-centres whenever they change, and with `onMove` the customer can place it by clicking the map or dragging it.
 * Tiles come from Geoapify (OpenStreetMap data).
 */
export default function LocationMap({ latitude, longitude, accuracy, onMove, view, label = "Map showing the selected location", className = "h-56 sm:h-72" }: Props) {
  const moved = useRef(onMove);
  moved.current = onMove;
  const at: L.LatLngTuple | null = latitude !== null && longitude !== null ? [latitude, longitude] : null;
  const start = useRef<{ center: L.LatLngTuple; zoom: number }>(at ? { center: at, zoom: 17 } : { center: view ? [view.latitude, view.longitude] : [20.5937, 78.9629], zoom: view?.zoom ?? 5 });
  const handlers = useMemo(() => ({
    dragend: (e: L.LeafletEvent) => {
      const p = (e.target as L.Marker).getLatLng();
      moved.current?.(round6(p.lat), round6(p.lng)); // the marker's real position, never the initial one
    },
  }), []);

  if (!GEOAPIFY_KEY) {
    return <div role="alert" data-testid="location-map-error" className={`flex w-full items-center justify-center rounded-xl border border-line bg-tint p-4 text-center text-sm font-semibold text-warn ${className}`}>{MAP_UNAVAILABLE}</div>;
  }
  return (
    <div role="img" aria-label={label} data-testid="location-map" className={`z-0 w-full overflow-hidden rounded-xl border border-line ${className}`}>
      <MapContainer center={start.current.center} zoom={start.current.zoom} scrollWheelZoom={false} attributionControl={false} className="h-full w-full">
        <TileLayer maxZoom={19} url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <AttributionControl prefix={false} /> {/* only the tile credits (Geoapify / OpenStreetMap), no library label */}
        <KeepSized />
        <ClickToPlace onMove={onMove} />
        {at && (
          <>
            <Marker position={at} icon={pin} draggable={!!onMove} keyboard={false} alt="Selected location" eventHandlers={handlers} />
            {/* interactive:false so the uncertainty circle never swallows clicks meant for placing the pin */}
            {accuracy && accuracy > 50 && <Circle center={at} radius={accuracy} pathOptions={{ color: "#d97706", weight: 1, fillOpacity: 0.12 }} interactive={false} />}
            <Follow at={at} accuracy={accuracy} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
