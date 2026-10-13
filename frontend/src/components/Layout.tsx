import { BookOpen, Bot, Cpu, FilePlus2, Globe, LayoutDashboard, LogOut, Menu, Moon, Plug, ScrollText, Search, Settings, ShieldCheck, Sun, Ticket as TicketIcon, Timer, Users, Workflow, X } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { getAccessToken, onTokenChange } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { bus } from "../lib/bus";
import { Key, LOCALES, Locale, useI18n } from "../i18n";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { VirtualAgent } from "./VirtualAgent";
import { Avatar, cx, Popover } from "./ui";

interface NavItem { to: string; label: Key; icon: ReactNode; end?: boolean }

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, updateUser } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const staff = user!.role !== "END_USER";

  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setPalette(true); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  // Real-time: one socket per session; the auth callback always supplies the freshest access token.
  useEffect(() => {
    if ((window as any).__DEMO__) return; // hosted demo has no socket server
    const socket = io({ auth: (cb) => cb({ token: getAccessToken() }) });
    ["ticket:created", "ticket:assigned", "ticket:updated", "ticket:comment", "ticket:escalated", "sla:alert"].forEach((ev) => socket.on(ev, (p) => bus.emit(ev, p)));
    socket.on("notification", (n) => { bus.emit("notification", n); if (n?.message) toast(n.message, "info"); });
    const off = onTokenChange(() => { if (socket.connected) socket.disconnect().connect(); });
    return () => { off(); socket.disconnect(); };
  }, [toast]);

  const main: NavItem[] = [
    ...(staff ? [{ to: "/", label: "nav.dashboard" as Key, icon: <LayoutDashboard size={17} />, end: true }] : []),
    { to: "/tickets", label: staff ? "nav.tickets" : "nav.my_tickets", icon: <TicketIcon size={17} />, end: true },
    { to: "/tickets/new", label: "nav.new", icon: <FilePlus2 size={17} /> },
    { to: "/kb", label: "nav.kb", icon: <BookOpen size={17} /> },
  ];
  const admin: NavItem[] = user!.role === "ADMIN" ? [
    { to: "/admin/users", label: "nav.users", icon: <Users size={17} /> }, { to: "/admin/team", label: "nav.team", icon: <Cpu size={17} /> },
    { to: "/admin/sla", label: "nav.sla", icon: <Timer size={17} /> }, { to: "/admin/automation", label: "nav.automation", icon: <Workflow size={17} /> },
    { to: "/admin/ai", label: "nav.ai", icon: <Bot size={17} /> }, { to: "/admin/integrations", label: "nav.integrations", icon: <Plug size={17} /> },
    { to: "/admin/governance", label: "nav.governance", icon: <ScrollText size={17} /> },
  ] : [];

  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex items-center gap-2.5 h-9 px-2.5 rounded-md font-medium transition-colors", isActive ? "bg-tint text-brand" : "text-ink2 hover:bg-sunken hover:text-ink")}>
      {n.icon}<span className="truncate">{t(n.label)}</span>
    </NavLink>
  );

  const sidebar = (
    <nav aria-label="Main" className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 h-14 px-4 shrink-0"><Logo /><span className="font-semibold text-[16px] tracking-tight">Northbeam</span></div>
      <div className="px-3 flex-1 overflow-y-auto scroll-y space-y-0.5 pb-4">
        {main.map(link)}
        {admin.length > 0 && <><div className="flex items-center gap-1.5 px-2.5 pt-5 pb-1.5 text-[12.5px] font-semibold text-ink3"><ShieldCheck size={14} />{t("nav.admin")}</div>{admin.map(link)}</>}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-[70] focus:top-2 focus:start-2 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md focus:shadow-pop">{t("nav.skip")}</a>
      <aside className="hidden lg:block sticky top-0 h-screen bg-surface border-e border-line">{sidebar}</aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/40 animate-fade" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 start-0 w-[264px] bg-surface shadow-pop animate-fade">
            <button className="btn-icon absolute top-2.5 end-2" onClick={() => setDrawer(false)} aria-label={t("common.close")}><X size={18} /></button>{sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 h-14 bg-surface/90 backdrop-blur border-b border-line flex items-center gap-1 sm:gap-2 px-2 sm:px-5">
          <button className="btn-icon lg:hidden" onClick={() => setDrawer(true)} aria-label={t("nav.menu")}><Menu size={19} /></button>
          <button onClick={() => setPalette(true)} className="flex-1 min-w-0 max-w-md h-9 flex items-center gap-2 px-3 rounded-md border border-line bg-sunken text-ink3 hover:border-ink3 transition-colors text-start" aria-label={t("top.search")}>
            <Search size={15} /><span className="flex-1 truncate">{t("top.search")}</span><kbd className="hidden sm:inline text-[11px] border border-line rounded px-1.5 py-0.5 bg-surface">Ctrl K</kbd>
          </button>
          <div className="hidden sm:block flex-1" />
          <Popover label={t("top.language")} trigger={({ toggle }) => <button className="btn-icon" onClick={toggle} aria-label={t("top.language")}><Globe size={18} /></button>}>
            {(close) => (
              <ul className="w-44 py-1.5">
                {LOCALES.map((l) => (
                  <li key={l.code}><button lang={l.code} className={cx("w-full text-start px-3.5 h-9 hover:bg-sunken flex items-center justify-between", l.code === locale && "text-brand font-semibold")}
                    onClick={() => { close(); setLocale(l.code as Locale); void updateUser({ locale: l.code }).catch(() => undefined); }}>{l.name}{l.code === locale && <span aria-hidden>✓</span>}</button></li>
                ))}
              </ul>
            )}
          </Popover>
          <button className="btn-icon" onClick={theme.toggle} aria-label={t("top.theme")}>{theme.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <NotificationBell />
          <Popover label={user!.name} trigger={({ toggle }) => <button onClick={toggle} className="rounded-full ms-1" aria-label={user!.name}><Avatar name={user!.name} size={32} /></button>}>
            {(close) => (
              <div className="w-64">
                <div className="px-4 py-3 border-b border-line"><p className="font-semibold truncate">{user!.name}</p><p className="text-ink3 text-[12.5px] truncate">{user!.email}</p><p className="text-[12.5px] text-ink2 mt-0.5">{t(`role.${user!.role}` as Key)}</p></div>
                <div className="py-1.5">
                  <button className="w-full text-start px-4 h-9 hover:bg-sunken flex items-center gap-2.5" onClick={() => { close(); nav("/preferences"); }}><Settings size={16} />{t("nav.profile")}</button>
                  <button className="w-full text-start px-4 h-9 hover:bg-sunken flex items-center gap-2.5" onClick={async () => { close(); await logout(); nav("/login"); }}><LogOut size={16} />{t("nav.signout")}</button>
                </div>
              </div>
            )}
          </Popover>
        </header>
        <main id="main" className="flex-1 px-4 sm:px-6 py-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      {!(user!.role === "END_USER" && loc.pathname === "/tickets/new") && <VirtualAgent />}
    </div>
  );
}
