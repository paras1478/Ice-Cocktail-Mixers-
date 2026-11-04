import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, loadToken, saveToken } from "../lib/api";
import type { User } from "../lib/types";

interface AuthApi {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<void>;
  google: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}
const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (await loadToken()) setUser((await api.get<{ user: User | null }>("/auth/me")).data.user);
      } catch {
        /* offline or expired: stay logged out */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const finish = useCallback(async (data: { user: User; token?: string }) => {
    if (!data.token) throw new Error("The server did not return a session token. Update the backend.");
    await saveToken(data.token);
    setUser(data.user);
  }, []);
  const login = useCallback(async (email: string, password: string) => finish((await api.post("/auth/login", { email, password })).data), [finish]);
  const register = useCallback(async (input: { name: string; email: string; password: string; phone?: string }) => finish((await api.post("/auth/register", input)).data), [finish]);
  const google = useCallback(async (idToken: string) => finish((await api.post("/auth/google", { idToken })).data), [finish]);
  const logout = useCallback(async () => {
    await saveToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, google, logout, setUser }), [user, loading, login, register, google, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
