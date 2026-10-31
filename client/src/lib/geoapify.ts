/**
 * Geoapify map tiles for Leaflet. The key (VITE_GEOAPIFY_API_KEY) is a *browser* key: it is bundled into the site, so restrict it to your
 * domains in the Geoapify dashboard. Geocoding (search / reverse) uses a separate key on the server and never goes through the browser.
 */
export const GEOAPIFY_KEY = (import.meta.env?.VITE_GEOAPIFY_API_KEY as string | undefined)?.trim() || "";

export const TILE_URL = `https://maps.geoapify.com/v1/tile/carto/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}`;

export const TILE_ATTRIBUTION = '&copy; <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export const MAP_UNAVAILABLE = "The map is not set up yet (missing Geoapify key). You can still enter your address manually.";
