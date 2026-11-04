import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { User } from "../lib/types";

interface AuthApi {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<User>;
  google: (idToken: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}
const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    // { user: null } means "not logged in"; any failure also leaves the user logged out rather than blocking the app.
    api.get<{ user: User | null }>("/auth/me").then((r) => live && setUser(r.data.user)).catch(() => undefined).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ user: User }>("/auth/login", { email, password });
    setUser(data.user);
    return data.user;
  }, []);
  const register = useCallback(async (input: { name: string; email: string; password: string; phone?: string }) => {
    const { data } = await api.post<{ user: User }>("/auth/register", input);
    setUser(data.user);
    return data.user;
  }, []);
  const google = useCallback(async (idToken: string) => {
    const { data } = await api.post<{ user: User }>("/auth/google", { idToken });
    setUser(data.user);
    return data.user;
  }, []);
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
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
