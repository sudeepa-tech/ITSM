import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en, Key } from "./locales/en";

export type { Key };
export const LOCALES = [
  { code: "en", name: "English", dir: "ltr" }, { code: "es", name: "Español", dir: "ltr" }, { code: "fr", name: "Français", dir: "ltr" }, { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "pt", name: "Português", dir: "ltr" }, { code: "hi", name: "हिन्दी", dir: "ltr" }, { code: "ar", name: "العربية", dir: "rtl" }, { code: "ja", name: "日本語", dir: "ltr" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];
type Dict = Partial<Record<Key, string>>;

const loaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Dict }>> = {
  es: () => import("./locales/es"), fr: () => import("./locales/fr"), de: () => import("./locales/de"), pt: () => import("./locales/pt"),
  hi: () => import("./locales/hi"), ar: () => import("./locales/ar"), ja: () => import("./locales/ja"),
};

const STORAGE = "itsm_locale";
const detect = (): Locale => {
  const saved = localStorage.getItem(STORAGE) as Locale | null;
  if (saved && LOCALES.some((l) => l.code === saved)) return saved;
  const nav = navigator.language.slice(0, 2) as Locale;
  return LOCALES.some((l) => l.code === nav) ? nav : "en";
};

export interface Formatters {
  date: (d: string | Date) => string; dateTime: (d: string | Date) => string; time: (d: string | Date) => string;
  relative: (d: string | Date) => string; number: (n: number, opts?: Intl.NumberFormatOptions) => string; percent: (n: number) => string;
  /** Compact duration from minutes: "3h 20m", "2d 4h". */
  duration: (mins: number) => string; bytes: (n: number) => string;
}

interface Ctx { t: (key: Key, vars?: Record<string, string | number>) => string; locale: Locale; dir: "ltr" | "rtl"; setLocale: (l: Locale) => void; timeZone: string; setTimeZone: (tz: string) => void; fmt: Formatters }
const I18nCtx = createContext<Ctx>(null!);
export const useI18n = () => useContext(I18nCtx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detect);
  const [dict, setDict] = useState<Dict>({});
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const meta = LOCALES.find((l) => l.code === locale)!;

  useEffect(() => {
    let live = true;
    if (locale === "en") setDict({});
    else loaders[locale]().then((m) => live && setDict(m.default)).catch(() => live && setDict({}));
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
    return () => { live = false; };
  }, [locale, meta.dir]);

  const setLocale = useCallback((l: Locale) => { localStorage.setItem(STORAGE, l); setLocaleState(l); }, []);

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => {
    let s: string = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [dict]);

  const fmt = useMemo<Formatters>(() => {
    const opt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone, ...o });
    const d = (x: string | Date) => (x instanceof Date ? x : new Date(x));
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    const unit = (u: string, n: number) => new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "narrow", maximumFractionDigits: 0 }).format(n);
    return {
      date: (x) => opt({ dateStyle: "medium" }).format(d(x)),
      dateTime: (x) => opt({ dateStyle: "medium", timeStyle: "short" }).format(d(x)),
      time: (x) => opt({ timeStyle: "short" }).format(d(x)),
      relative: (x) => {
        const s = (d(x).getTime() - Date.now()) / 1000, a = Math.abs(s);
        if (a < 60) return rtf.format(0, "second");
        if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
        if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
        if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
        return opt({ dateStyle: "medium" }).format(d(x));
      },
      number: (n, o) => new Intl.NumberFormat(locale, o).format(n),
      percent: (n) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(n),
      duration: (m) => {
        const mins = Math.max(0, Math.round(m));
        if (mins >= 1440) { const days = Math.floor(mins / 1440), h = Math.round((mins % 1440) / 60); return h ? `${unit("day", days)} ${unit("hour", h)}` : unit("day", days); }
        if (mins >= 60) { const h = Math.floor(mins / 60), mm = mins % 60; return mm ? `${unit("hour", h)} ${unit("minute", mm)}` : unit("hour", h); }
        return unit("minute", mins);
      },
      bytes: (n) => (n < 1024 ? unit("byte", n) : n < 1048576 ? unit("kilobyte", n / 1024) : unit("megabyte", n / 1048576)),
    };
  }, [locale, timeZone]);

  const value = useMemo(() => ({ t, locale, dir: meta.dir, setLocale, timeZone, setTimeZone, fmt }), [t, locale, meta.dir, setLocale, timeZone, fmt]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}
