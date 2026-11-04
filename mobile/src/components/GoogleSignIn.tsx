import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { Ionicons } from "@expo/vector-icons";
import { api, errMsg } from "../lib/api";
import { c } from "../lib/theme";
import { useAuth } from "../context/AuthContext";

WebBrowser.maybeCompleteAuthSession();

interface Ids { webClientId: string | null; androidClientId: string | null; iosClientId: string | null }

/** "Continue with Google". Hidden until the backend reports Google client IDs (see GOOGLE_* in server/.env). */
export default function GoogleSignIn({ onError }: { onError: (m: string | null) => void }) {
  const [ids, setIds] = useState<Ids | null>(null);
  useEffect(() => {
    api.get<{ google?: Ids }>("/config").then((r) => setIds(r.data.google ?? null)).catch(() => undefined);
  }, []);
  const usable = ids && (Platform.OS === "android" ? ids.androidClientId : Platform.OS === "ios" ? ids.iosClientId : ids.webClientId);
  if (!ids || !usable) return null;
  return <Inner ids={ids} onError={onError} />;
}

function Inner({ ids, onError }: { ids: Ids; onError: (m: string | null) => void }) {
  const { google } = useAuth();
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: ids.webClientId ?? undefined,
    androidClientId: ids.androidClientId ?? undefined,
    iosClientId: ids.iosClientId ?? undefined,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const idToken = response.params?.id_token ?? response.authentication?.idToken;
      if (!idToken) { onError("Google did not return a sign-in token."); setBusy(false); return; }
      google(idToken).catch((e) => onError(errMsg(e))).finally(() => setBusy(false));
    } else {
      if (response.type === "error") onError("Google sign-in failed. Please try again.");
      setBusy(false);
    }
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = async () => {
    onError(null);
    if (Constants.appOwnership === "expo") {
      onError("Google sign-in works in the installed app (APK / development build), not inside Expo Go.");
      return;
    }
    setBusy(true);
    try { await promptAsync(); } catch { onError("Could not open Google sign-in."); setBusy(false); }
  };

  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
        <Text style={{ color: c.muted, fontSize: 12, marginHorizontal: 10 }}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
      </View>
      <Pressable
        onPress={press}
        disabled={!request || busy}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, backgroundColor: c.tint, borderRadius: 14, paddingVertical: 13, opacity: !request || busy ? 0.6 : 1 }}
      >
        <Ionicons name="logo-google" size={18} color={c.text} />
        <Text style={{ color: c.text, fontWeight: "700", marginLeft: 10 }}>{busy ? "Opening Google…" : "Continue with Google"}</Text>
      </Pressable>
    </View>
  );
}
