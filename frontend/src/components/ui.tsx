import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { Provider } from "../api/types";
import { useI18n } from "../i18n";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Spinner({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-ink3" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity=".25" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
export const Skeleton = ({ className }: { className?: string }) => <div className={cx("skeleton h-4", className)} aria-hidden />;

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="mb-3 text-ink3">{icon}</div>}
      <p className="font-semibold text-[15px]">{title}</p>
      {body && <p className="text-ink2 mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight">{title}</h1>
        {lede && <p className="text-ink2 mt-1 max-w-2xl">{lede}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Accessible dialog: Esc closes, focus moves in, background is inert to assistive tech. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={cx("relative bg-surface w-full rounded-t-xl sm:rounded-xl shadow-pop border border-line animate-rise max-h-[90vh] flex flex-col", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 id={id} className="text-[16px]">{title}</h2>
          <button data-close className="btn-icon !h-8 !w-8" onClick={onClose} aria-label={t("common.close")}><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto scroll-y">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-line flex justify-end gap-2 bg-sunken rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) => (
  <div className="mb-4">
    <label className="label" htmlFor={htmlFor}>{label}</label>
    {children}
    {hint && <p className="text-[12.5px] text-ink3 mt-1.5">{hint}</p>}
  </div>
);

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line overflow-x-auto scroll-y">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={value === tab.id} onClick={() => onChange(tab.id)}
          className={cx("px-3 h-10 text-[13.5px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors", value === tab.id ? "border-brand text-brand" : "border-transparent text-ink2 hover:text-ink")}>
          {tab.label}{tab.count !== undefined && <span className="ms-1.5 text-ink3 tnum font-medium">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex p-0.5 bg-sunken border border-line rounded-md">
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cx("px-2.5 h-7 rounded text-[13px] font-semibold transition-colors", value === o.id ? "bg-surface shadow-lift text-ink" : "text-ink2 hover:text-ink")}>{o.label}</button>
      ))}
    </div>
  );
}

const palette = ["#0E5A8A", "#6D4AE0", "#1E8A5A", "#B4470F", "#8A3FA0", "#1D7A8C", "#A0413F", "#546E7A"];
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => Array.from(p)[0]).join("").toUpperCase();
  return <span aria-hidden className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0" style={{ width: size, height: size, background: palette[h % palette.length], fontSize: size * 0.4 }}>{initials}</span>;
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const { t, fmt } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-line text-ink2 text-[13px]">
      <span className="tnum">{t("common.results", { n: fmt.number(total) })}</span>
      <div className="flex items-center gap-1">
        <button className="btn-icon !h-8 !w-8" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t("common.prev")}><ChevronLeft size={16} className="rtl:-scale-x-100" /></button>
        <span className="tnum px-1">{t("common.page", { p: page, n: pages })}</span>
        <button className="btn-icon !h-8 !w-8" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={t("common.next")}><ChevronRight size={16} className="rtl:-scale-x-100" /></button>
      </div>
    </div>
  );
}

/** Provenance label: says who wrote it, in words, not just colour. */
export function AiMark({ provider, className }: { provider?: Provider; className?: string }) {
  const { t } = useI18n();
  const live = provider !== "rules";
  return (
    <span className={cx("inline-flex items-center gap-1 text-[12px] font-semibold", live ? "text-ai" : "text-ink3", className)} title={live ? t("ai.anthropic") : t("ai.rules")}>
      <Sparkles size={13} aria-hidden />{live ? t("ai.label") : t("ai.rules")}
    </span>
  );
}

export function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Re-renders on an interval so countdowns stay live without refetching. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function Popover({ trigger, children, align = "end", label }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div role="dialog" aria-label={label} className={cx("absolute top-full mt-1.5 z-40 bg-surface border border-line rounded-lg shadow-pop animate-rise", align === "end" ? "end-0" : "start-0")}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
