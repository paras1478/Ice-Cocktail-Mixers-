import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import { c } from "../lib/theme";

interface Props {
  /** The selected position. null = nothing selected yet: the map shows `view` as a plain temporary map view with no pin. */
  latitude: number | null;
  longitude: number | null;
  /** Radius in metres of the uncertainty circle (only shown when it is large enough to matter). */
  accuracy?: number | null;
  /** When set the customer can place the pin by tapping the map or dragging the pin. Called with the new coordinates. */
  onMove?: (latitude: number, longitude: number) => void;
  /** Temporary map view used only while nothing is selected. It is NOT a location of the customer. */
  view?: { latitude: number; longitude: number; zoom: number };
  height?: number;
}

const round6 = (n: number) => Number(n.toFixed(6));
/** Approximate degrees of latitude visible at a web-map zoom level. */
const deltaForZoom = (zoom: number) => Math.min(60, 360 / Math.pow(2, zoom));

/** Region that keeps a rough fix zoomed out (so the whole uncertainty area is visible) and a precise one close up. */
function regionFor(lat: number, lng: number, accuracy?: number | null): Region {
  const delta = accuracy && accuracy > 1000 ? (accuracy * 4) / 111_000 : 0.004;
  return { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
}

/**
 * Map with at most one pin. The pin follows the coordinates it is given, so the map re-centres whenever they change;
 * with `onMove` the customer can place it by tapping the map or dragging it.
 */
export default function LocationMap({ latitude, longitude, accuracy, onMove, view, height = 220 }: Props) {
  const ref = useRef<MapView>(null);
  const has = latitude !== null && longitude !== null;
  const initial: Region = has
    ? regionFor(latitude, longitude, accuracy)
    : view
      ? { latitude: view.latitude, longitude: view.longitude, latitudeDelta: deltaForZoom(view.zoom), longitudeDelta: deltaForZoom(view.zoom) }
      : { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 30, longitudeDelta: 30 };

  useEffect(() => {
    if (has) ref.current?.animateToRegion(regionFor(latitude, longitude, accuracy), 400);
  }, [has, latitude, longitude, accuracy]);

  return (
    <View style={{ width: "100%", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.imgWell, height }} accessibilityLabel={has ? "Selected location. Tap the map or drag the pin to adjust it." : "Map. Tap your delivery spot to place the pin."}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={initial}
        onPress={onMove ? (e) => onMove(round6(e.nativeEvent.coordinate.latitude), round6(e.nativeEvent.coordinate.longitude)) : undefined}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {has ? (
          <>
            <Marker
              coordinate={{ latitude, longitude }}
              draggable={!!onMove}
              pinColor="#d97706"
              onDragEnd={(e) => onMove?.(round6(e.nativeEvent.coordinate.latitude), round6(e.nativeEvent.coordinate.longitude))}
            />
            {accuracy && accuracy > 50 ? <Circle center={{ latitude, longitude }} radius={accuracy} strokeColor="#d97706" fillColor="rgba(217,119,6,0.12)" strokeWidth={1} /> : null}
          </>
        ) : null}
      </MapView>
    </View>
  );
}

