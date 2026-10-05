import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "../api/client";
import { User } from "../api/types";
import { useI18n, Locale } from "../i18n";

interface AuthCtx {
  user: User | null; loading: boolean; sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; updateUser: (patch: Partial<Pick<User, "name" | "locale" | "timezone">>) => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setExpired] = useState(false);
  const { setLocale, setTimeZone } = useI18n();

  const adopt = useCallback((u: User | null) => {
    setUser(u);
    if (u) { setLocale(u.locale as Locale); setTimeZone(u.timezone); }
  }, [setLocale, setTimeZone]);

  useEffect(() => {
    setSessionExpiredHandler(() => { setUser(null); setExpired(true); });
    refreshSession().then((s) => adopt(s?.user ?? null)).finally(() => setLoading(false));
  }, [adopt]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    setAccessToken(data.accessToken); setExpired(false); adopt(data.user);
  }, [adopt]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null); setUser(null);
  }, []);

  const updateUser = useCallback(async (patch: Partial<Pick<User, "name" | "locale" | "timezone">>) => {
    const { data } = await api.patch<User>("/auth/me", patch);
    adopt(data);
  }, [adopt]);

  const value = useMemo(() => ({ user, loading, sessionExpired, login, logout, updateUser }), [user, loading, sessionExpired, login, logout, updateUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
