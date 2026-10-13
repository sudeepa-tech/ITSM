import { ChevronDown, ChevronUp, ChevronsUp, Flame, Frown, Minus, Pause } from "lucide-react";
import { Priority, Sla, TicketStatus } from "../api/types";
import { Key, useI18n } from "../i18n";
import { cx, useNow } from "./ui";

const PRI: Record<Priority, { cls: string; icon: JSX.Element }> = {
  P1: { cls: "bg-bad-tint text-bad", icon: <ChevronsUp size={13} strokeWidth={3} /> },
  P2: { cls: "bg-risk-tint text-risk", icon: <ChevronUp size={13} strokeWidth={3} /> },
  P3: { cls: "bg-sunken text-ink2 ring-1 ring-inset ring-line", icon: <Minus size={13} strokeWidth={3} /> },
  P4: { cls: "bg-sunken text-ink3 ring-1 ring-inset ring-line", icon: <ChevronDown size={13} strokeWidth={3} /> },
};
/** Priority is encoded by icon shape and text as well as colour. */
export function PriorityChip({ p }: { p: Priority }) {
  const { t } = useI18n();
  return <span className={cx("chip", PRI[p].cls)}>{PRI[p].icon}{t(`pri.${p}` as Key)}</span>;
}

const openish: TicketStatus[] = ["NEW", "AI_ANALYSIS", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REOPENED"];
export function StatusChip({ s }: { s: TicketStatus }) {
  const { t } = useI18n();
  const cls = ["RESOLVED", "CLOSED"].includes(s) ? "bg-ok-tint text-ok" : s === "ESCALATED" ? "bg-bad-tint text-bad" : s.startsWith("PENDING") ? "bg-warn-tint text-warn" : openish.includes(s) ? "bg-tint text-brand" : "bg-sunken text-ink3";
  return <span className={cx("chip", cls)}>{t(`status.${s}` as Key)}</span>;
}

const BAR: Record<string, string> = { HEALTHY: "bg-bar-ok", WARNING: "bg-bar-warn", AT_RISK: "bg-bar-risk", BREACHED: "bg-bar-bad" };
const TXT: Record<string, string> = { HEALTHY: "text-ok", WARNING: "text-warn", AT_RISK: "text-risk", BREACHED: "text-bad" };

/** The SLA meter: a thin bar showing how much of the time budget is spent, with the remaining time in words. */
export function SlaMeter({ sla, ticketStatus, size = "sm" }: { sla: Sla | null; ticketStatus: TicketStatus; size?: "sm" | "lg" }) {
  const { t, fmt } = useI18n();
  const now = useNow();
  if (!sla) return <span className="text-ink3">{t("sla.none")}</span>;
  const done = ["RESOLVED", "CLOSED"].includes(ticketStatus);
  const due = new Date(sla.resolutionDue).getTime();
  const start = new Date(sla.startedAt ?? sla.resolutionDue).getTime();
  const spent = sla.pausedAt || done ? (new Date(sla.pausedAt ?? sla.resolutionDue).getTime() - start) : now - start;
  const pct = sla.startedAt ? Math.max(0, Math.min(1, spent / Math.max(1, due - start))) : sla.status === "BREACHED" ? 1 : 0.5;
  const left = (due - now) / 60000;
  const status = done ? (sla.status === "BREACHED" ? "BREACHED" : "HEALTHY") : sla.status;
  const label = done ? t(sla.status === "BREACHED" ? "sla.missed" : "sla.met") : sla.pausedAt ? t("sla.paused") : left < 0 ? t("sla.over", { t: fmt.duration(-left) }) : t("sla.left", { t: fmt.duration(left) });
  return (
    <div className={cx("flex flex-col gap-1", size === "sm" ? "min-w-[104px]" : "min-w-[200px]")} title={`${t(`sla.status.${status}` as Key)} · ${fmt.dateTime(sla.resolutionDue)}`}>
      <div className={cx("flex items-center gap-1 font-semibold tnum", TXT[status], size === "sm" ? "text-[12.5px]" : "text-[14px]")}>
        {sla.pausedAt && !done && <Pause size={12} aria-hidden />}{label}
      </div>
      <div className={cx("rounded-full bg-line/70 overflow-hidden", size === "sm" ? "h-1" : "h-1.5")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={t("f.sla")}>
        <div className={cx("h-full rounded-full transition-[width]", sla.pausedAt && !done ? "bg-ink3" : BAR[status])} style={{ width: `${Math.max(4, pct * 100)}%` }} />
      </div>
    </div>
  );
}

export function MoodChip({ score }: { score?: number | null }) {
  const { t } = useI18n();
  if (score === undefined || score === null || score >= -0.2) return null;
  return <span className="chip bg-risk-tint text-risk"><Frown size={13} />{t("mood.negative")}</span>;
}

export const MajorChip = () => {
  const { t } = useI18n();
  return <span className="chip bg-bad-tint text-bad" title={t("q.major")}><Flame size={13} />{t("db.incident")}</span>;
};
