import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { User } from "./types";

/** The access token lives in memory only (XSS can't read it from storage); the refresh token is an httpOnly cookie. */
let accessToken: string | null = null;
const tokenListeners = new Set<(t: string | null) => void>();
export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => { accessToken = t; tokenListeners.forEach((l) => l(t)); };
export const onTokenChange = (l: (t: string | null) => void) => { tokenListeners.add(l); return () => { tokenListeners.delete(l); }; };

let onSessionExpired: () => void = () => undefined;
export const setSessionExpiredHandler = (fn: () => void) => { onSessionExpired = fn; };

export const api = axios.create({ baseURL: "/api", withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing: Promise<{ accessToken: string; user: User } | null> | null = null;
/** Single-flight refresh so a burst of 401s triggers exactly one token rotation. */
export function refreshSession() {
  refreshing ??= axios.post("/api/auth/refresh", {}, { withCredentials: true })
    .then((r) => { setAccessToken(r.data.accessToken); return r.data as { accessToken: string; user: User }; })
    .catch(() => { setAccessToken(null); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const cfg = err.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = cfg?.url?.startsWith("/auth/login") || cfg?.url?.startsWith("/auth/refresh");
    if (err.response?.status === 401 && cfg && !cfg._retried && !isAuthCall) {
      cfg._retried = true;
      const s = await refreshSession();
      if (s) return api(cfg);
      onSessionExpired();
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e: unknown, fallback = "Something went wrong") => (e as AxiosError<{ error?: string }>)?.response?.data?.error ?? fallback;
