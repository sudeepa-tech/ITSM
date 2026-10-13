import { BookOpen, CornerDownLeft, FilePlus2, LayoutDashboard, Moon, Search, Settings, Ticket as TicketIcon } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../i18n";
import { cx, useDebounced } from "./ui";

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void }

/** Ctrl/Cmd+K: jump anywhere, run an action, or search tickets and articles without leaving the keyboard. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const theme = useTheme();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [found, setFound] = useState<{ tickets: { id: string; ticketNumber: string; subject: string }[]; articles: { id: string; title: string }[] }>({ tickets: [], articles: [] });
  const dq = useDebounced(q, 200);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setCursor(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (dq.trim().length < 2) { setFound({ tickets: [], articles: [] }); return; }
    let live = true;
    api.get("/search", { params: { q: dq } }).then((r) => live && setFound(r.data)).catch(() => undefined);
    return () => { live = false; };
  }, [dq]);

  const go = (path: string) => () => { nav(path); onClose(); };
  const staff = user?.role !== "END_USER";
  const actions: Item[] = useMemo(() => [
    { id: "a-new", group: "Actions", label: t("nav.new"), icon: <FilePlus2 size={16} />, run: go("/tickets/new") },
    { id: "a-tickets", group: "Go to", label: staff ? t("nav.tickets") : t("nav.my_tickets"), icon: <TicketIcon size={16} />, run: go("/tickets") },
    ...(staff ? [{ id: "a-home", group: "Go to", label: t("nav.dashboard"), icon: <LayoutDashboard size={16} />, run: go("/") }] : []),
    { id: "a-kb", group: "Go to", label: t("nav.kb"), icon: <BookOpen size={16} />, run: go("/kb") },
    { id: "a-pref", group: "Go to", label: t("nav.profile"), icon: <Settings size={16} />, run: go("/preferences") },
    { id: "a-theme", group: "Actions", label: t("top.theme"), icon: <Moon size={16} />, run: () => { theme.toggle(); onClose(); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, staff]);

  const items: Item[] = useMemo(() => {
    const lower = q.trim().toLowerCase();
    const acts = lower ? actions.filter((a) => a.label.toLowerCase().includes(lower)) : actions;
    return [
      ...found.tickets.map((x) => ({ id: `t-${x.id}`, group: t("nav.tickets"), label: x.subject, hint: x.ticketNumber, icon: <TicketIcon size={16} />, run: go(`/tickets/${x.id}`) })),
      ...found.articles.map((x) => ({ id: `k-${x.id}`, group: t("nav.kb"), label: x.title, icon: <BookOpen size={16} />, run: go(`/kb/${x.id}`) })),
      ...acts,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, found, actions, t]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === "Enter") { e.preventDefault(); items[cursor]?.run(); }
    if (e.key === "Escape") onClose();
  };
  let last = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-ink/40 animate-fade" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("top.palette")} className="relative w-full max-w-xl bg-surface border border-line rounded-xl shadow-pop animate-rise overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <Search size={17} className="text-ink3" aria-hidden />
          <input ref={input} className="flex-1 h-12 bg-transparent outline-none placeholder:text-ink3" placeholder={t("top.palette")} value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={items[cursor]?.id} />
          <kbd className="text-[11px] text-ink3 border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto scroll-y py-1.5">
          {items.length === 0 && <li className="px-4 py-8 text-center text-ink2">{t("top.no_results")}</li>}
          {items.map((it, i) => {
            const header = it.group !== last ? (last = it.group) : null;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="px-4 pt-2 pb-1 text-[12px] font-semibold text-ink3">{header}</div>}
                <button id={it.id} role="option" aria-selected={i === cursor} onMouseMove={() => setCursor(i)} onClick={it.run}
                  className={cx("w-full flex items-center gap-3 px-4 h-10 text-start", i === cursor ? "bg-tint text-brand" : "text-ink")}>
                  <span className="text-ink3">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-ink3 text-[12.5px] tnum">{it.hint}</span>}
                  {i === cursor && <CornerDownLeft size={13} className="text-ink3" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
