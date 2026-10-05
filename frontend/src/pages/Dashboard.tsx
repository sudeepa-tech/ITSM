import { Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Cluster, Page, TicketRow } from "../api/types";
import { useApi } from "../api/useApi";
import { PriorityChip, SlaMeter, StatusChip } from "../components/Badges";
import { cx, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { Key, useI18n } from "../i18n";

interface Analytics {
  days: number;
  kpis: { created: number; resolved: number; openNow: number; unassigned: number; triage: number; slaCompliance: number | null; avgFirstResponseMins: number | null; csat: number | null; csatResponses: number; negativeShare: number | null; reopenRate: number | null };
  series: { day: string; created: number; resolved: number }[]; mttr: { priority: string; n: number; hrs: number }[]; byCategory: { name: string; n: number }[];
  ai: { autoTriageRate: number | null; categoryOverrideRate: number | null; reassignRate: number | null; feedbackApproval: number | null; deflectionRate: number | null; virtualAgent: { sessions: number; resolved: number; ticketed: number }; calls: number; fallbackRate: number | null };
  clusters: Cluster[];
}
interface Stats { mine: number; unassigned: number; triage: number; atRisk: number; breached: number; major: number }
const axis = { fontSize: 12, fill: "rgb(var(--ink3))" };

export function IncidentBanner({ c }: { c: Cluster }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-bad-tint border border-bad/30 px-4 py-3 mb-5 flex flex-wrap items-center gap-3">
      <Flame className="text-bad shrink-0" size={20} />
      <div className="flex-1 min-w-[240px]"><p className="font-semibold text-bad">{t("db.incident")}</p><p className="text-ink">{t("db.incident_body", { n: c.count, cat: c.categoryName, sample: c.sampleSubject })}</p></div>
      <Link to="/tickets" className="btn-quiet btn-sm">{t("db.incident_cta")}</Link>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return user!.role === "ADMIN" ? <AdminBoard /> : <AgentBoard />;
}

function Stat({ label, value, tone, to }: { label: string; value: string | number; tone?: string; to?: string }) {
  const inner = <div className="px-5 py-4 h-full"><div className={cx("text-[28px] font-semibold leading-none tnum", tone)}>{value}</div><div className="text-ink2 mt-1.5">{label}</div></div>;
  return to ? <Link to={to} className="hover:bg-sunken transition-colors block">{inner}</Link> : inner;
}

function AgentBoard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const stats = useApi<Stats>("/tickets/stats");
  const mine = useApi<Page<TicketRow>>("/tickets", { status: "OPEN", assignedToMe: "true", sort: "sla", dir: "asc", pageSize: 12 });
  const clusters = useApi<Cluster[]>("/ai/clusters");
  const s = stats.data;
  return (
    <div>
      <PageHeader title={t("db.hello", { name: user!.name.split(" ")[0] })} />
      {clusters.data?.[0] && <IncidentBanner c={clusters.data[0]} />}
      <div className="panel grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-line rtl:divide-x-reverse mb-5 overflow-hidden">
        <Stat label={t("db.mine")} value={s?.mine ?? "–"} /><Stat label={t("db.unassigned")} value={s?.unassigned ?? "–"} tone={s?.unassigned ? "text-risk" : ""} />
        <Stat label={t("db.triage")} value={s?.triage ?? "–"} /><Stat label={t("db.risk")} value={s?.atRisk ?? "–"} tone={s?.atRisk ? "text-risk" : ""} /><Stat label={t("db.breached")} value={s?.breached ?? "–"} tone={s?.breached ? "text-bad" : ""} />
      </div>
      <section className="panel">
        <h2 className="text-[15px] px-5 pt-4 pb-3">{t("db.my_queue")}</h2>
        {mine.data?.items.length === 0 && <EmptyState title={t("db.empty_queue")} />}
        <ul>{mine.data?.items.map((tk) => (
          <li key={tk.id} className="border-t border-line"><Link to={`/tickets/${tk.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-sunken">
            <span className="min-w-0 flex-1"><span className="tnum text-ink3 font-semibold me-2">{tk.ticketNumber}</span><span className="font-semibold">{tk.subject}</span></span>
            <span className="hidden sm:block"><PriorityChip p={tk.priority} /></span><span className="hidden md:block"><StatusChip s={tk.status} /></span><SlaMeter sla={tk.slaInstance} ticketStatus={tk.status} />
          </Link></li>))}</ul>
        {mine.loading && !mine.data && <div className="p-5"><Skeleton className="h-10" /></div>}
      </section>
    </div>
  );
}

function AdminBoard() {
  const { t, fmt } = useI18n();
  const { data, loading, error } = useApi<Analytics>("/admin/analytics", { days: 30 });
  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-24" /><Skeleton className="h-72" /></div>;
  if (!data) return <p className="text-bad">{error}</p>;
  const { kpis: k, ai } = data;
  const pct = (n: number | null) => (n === null ? "–" : `${fmt.number(n, { maximumFractionDigits: 1 })}%`);
  const aiRows: [Key, string][] = [
    ["db.ai.auto", pct(ai.autoTriageRate)], ["db.ai.override", pct(ai.categoryOverrideRate)], ["db.ai.reassign", pct(ai.reassignRate)], ["db.ai.fb", pct(ai.feedbackApproval)],
    ["db.ai.defl", pct(ai.deflectionRate)], ["db.ai.va", ai.virtualAgent.sessions ? pct((ai.virtualAgent.resolved / ai.virtualAgent.sessions) * 100) : "–"], ["db.ai.fallback", pct(ai.fallbackRate)],
  ];
  return (
    <div>
      <PageHeader title={t("db.title")} lede={t("db.range", { n: data.days })} />
      {data.clusters[0] && <IncidentBanner c={data.clusters[0]} />}
      <div className="panel grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 divide-x divide-y xl:divide-y-0 divide-line rtl:divide-x-reverse mb-5 overflow-hidden">
        <Stat label={t("db.created")} value={fmt.number(k.created)} /><Stat label={t("db.resolved")} value={fmt.number(k.resolved)} /><Stat label={t("db.open")} value={fmt.number(k.openNow)} to="/tickets" />
        <Stat label={t("db.unassigned")} value={k.unassigned} tone={k.unassigned ? "text-risk" : ""} to="/tickets" /><Stat label={t("db.sla")} value={pct(k.slaCompliance)} tone={k.slaCompliance !== null && k.slaCompliance < 85 ? "text-bad" : "text-ok"} />
        <Stat label={t("db.first")} value={k.avgFirstResponseMins === null ? "–" : fmt.duration(k.avgFirstResponseMins)} /><Stat label={t("db.csat")} value={k.csat ? `${k.csat}/5` : "–"} /><Stat label={t("db.mood")} value={pct(k.negativeShare)} />
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 mb-4">
        <section className="panel p-5">
          <h2 className="text-[15px] mb-4">{t("db.vol")}</h2>
          <div dir="ltr" className="h-64"><ResponsiveContainer><AreaChart data={data.series} margin={{ left: -18, right: 6, top: 4 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="day" tick={axis} tickFormatter={(d) => d.slice(5)} interval={4} axisLine={false} tickLine={false} /><YAxis tick={axis} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 8 }} />
            <Area type="monotone" dataKey="created" name={t("db.created")} stroke="rgb(var(--brand))" fill="rgb(var(--brand))" fillOpacity={0.14} strokeWidth={2} />
            <Area type="monotone" dataKey="resolved" name={t("db.resolved")} stroke="rgb(var(--bar-ok))" fill="rgb(var(--bar-ok))" fillOpacity={0.1} strokeWidth={2} />
          </AreaChart></ResponsiveContainer></div>
        </section>
        <section className="ai-block !p-5 !ps-6">
          <h2 className="text-[15px]">{t("db.ai")}</h2><p className="text-ink2 mb-3">{t("db.ai_sub")}</p>
          <dl className="divide-y divide-ai/15">{aiRows.map(([l, v]) => <div key={l} className="flex justify-between gap-4 py-2"><dt className="text-ink2">{t(l)}</dt><dd className="font-semibold tnum">{v}</dd></div>)}</dl>
        </section>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="panel p-5"><h2 className="text-[15px] mb-4">{t("db.mttr")}</h2>
          {data.mttr.length === 0 ? <p className="text-ink3">{t("db.no_data")}</p> : <div dir="ltr" className="h-52"><ResponsiveContainer><BarChart data={data.mttr.map((m) => ({ ...m, name: t(`pri.${m.priority}` as Key) }))} margin={{ left: -18 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} unit="h" />
            <Tooltip contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 8 }} /><Bar dataKey="hrs" name="h" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</section>
        <section className="panel p-5"><h2 className="text-[15px] mb-4">{t("db.cats")}</h2>
          <ul className="space-y-2.5">{data.byCategory.map((c) => <li key={c.name} className="grid grid-cols-[120px_1fr_36px] items-center gap-3"><span className="truncate">{c.name}</span>
            <span className="h-2 rounded-full bg-line/60 overflow-hidden"><span className="block h-full bg-brand rounded-full" style={{ width: `${(c.n / data.byCategory[0].n) * 100}%` }} /></span><span className="tnum text-end font-semibold">{c.n}</span></li>)}</ul></section>
      </div>
    </div>
  );
}
