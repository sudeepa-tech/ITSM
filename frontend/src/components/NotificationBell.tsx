import { Bell, BellRing } from "lucide-react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Notification } from "../api/types";
import { useApi } from "../api/useApi";
import { useBus } from "../lib/bus";
import { useI18n } from "../i18n";
import { cx, Popover } from "./ui";

export function NotificationBell() {
  const { t, fmt } = useI18n();
  const nav = useNavigate();
  const { data, reload } = useApi<{ items: Notification[]; unread: number }>("/notifications", { pageSize: 15 });
  useBus("notification", useCallback(() => void reload(), [reload]));
  const unread = data?.unread ?? 0;

  return (
    <Popover label={t("top.notifications")}
      trigger={({ toggle, open }) => (
        <button className={cx("btn-icon relative", open && "bg-sunken")} onClick={toggle} aria-label={`${t("top.notifications")}${unread ? ` (${unread})` : ""}`} aria-expanded={open}>
          {unread ? <BellRing size={18} /> : <Bell size={18} />}
          {unread > 0 && <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-bad text-white text-[10.5px] font-bold leading-4 text-center tnum">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}>
      {(close) => (
        <div className="w-[340px] max-w-[92vw]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="font-semibold">{t("top.notifications")}</span>
            {unread > 0 && <button className="text-brand font-semibold text-[13px] hover:underline" onClick={async () => { await api.post("/notifications/read", {}); void reload(); }}>{t("top.mark_read")}</button>}
          </div>
          <ul className="max-h-[380px] overflow-y-auto scroll-y">
            {data?.items.length === 0 && <li className="px-4 py-8 text-center text-ink2">{t("top.no_notifications")}</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button className={cx("w-full text-start px-4 py-2.5 hover:bg-sunken flex gap-2.5 border-b border-line/60 last:border-0", !n.read && "bg-tint/40")}
                  onClick={async () => { close(); if (!n.read) await api.post("/notifications/read", { ids: [n.id] }); void reload(); if (n.link) nav(n.link); }}>
                  <span className={cx("mt-1.5 h-2 w-2 rounded-full shrink-0", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13.5px]">{n.message}</span>
                    <span className="block text-[12px] text-ink3 mt-0.5">{fmt.relative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}
