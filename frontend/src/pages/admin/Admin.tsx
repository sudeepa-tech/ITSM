import { Plus, Trash2 } from "lucide-react";
import { ReactNode, useState } from "react";
import { api, errMsg } from "../../api/client";
import { Page } from "../../api/types";
import { useApi } from "../../api/useApi";
import { AiMark, Avatar, cx, Field, Modal, PageHeader, Pager, Skeleton, Tabs, useDebounced } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { Key, useI18n } from "../../i18n";

// Admin screens are English-only for now; the shell and navigation are localised.
const useSave = () => { const toast = useToast(); return async (fn: () => Promise<unknown>, ok = "Saved") => { try { await fn(); toast(ok); return true; } catch (e) { toast(errMsg(e), "error"); return false; } }; };
const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="panel overflow-x-auto scroll-y"><table className="w-full text-[13.5px]"><thead><tr className="bg-sunken text-ink3 text-[12.5px] border-b border-line">{head.map((h) => <th key={h} className="text-start font-semibold px-4 py-2.5">{h}</th>)}</tr></thead><tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">{children}</tbody></table></div>
);
const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx("relative h-5 w-9 rounded-full transition-colors", on ? "bg-solid" : "bg-line")}><span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "start-[18px]" : "start-0.5")} /></button>
);

// ------------------------------------------------------------------ users
interface U { id: string; name: string; email: string; role: string; active: boolean; department: string | null; lastLoginAt: string | null; employee: { team: string } | null }
export function Users() {
  const { t, fmt } = useI18n(); const save = useSave();
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const dq = useDebounced(q, 300);
  const list = useApi<Page<U>>("/admin/users", { q: dq || undefined, page, pageSize: 20 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "END_USER", team: "" });
  const patch = (id: string, b: object) => save(() => api.patch(`/admin/users/${id}`, b)).then(() => list.reload());
  return (
    <div>
      <PageHeader title={t("nav.users")} actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add user</button>} />
      <input className="input max-w-xs mb-3" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search users" />
      <Table head={["User", "Role", "Team", "Last sign-in", "Active"]}>
        {list.data?.items.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={u.name} /><span><span className="font-semibold block leading-tight">{u.name}</span><span className="text-ink3 text-[12.5px]">{u.email}</span></span></span></td>
            <td className="px-4"><select className="input !h-8 w-auto" value={u.role} aria-label="Role" onChange={(e) => patch(u.id, { role: e.target.value })}>{["END_USER", "AGENT", "ADMIN"].map((r) => <option key={r} value={r}>{t(`role.${r}` as Key)}</option>)}</select></td>
            <td className="px-4 text-ink2">{u.employee?.team ?? "—"}</td><td className="px-4 text-ink2">{u.lastLoginAt ? fmt.relative(u.lastLoginAt) : "—"}</td>
            <td className="px-4"><Toggle on={u.active} label="Active" onChange={(v) => patch(u.id, { active: v })} /></td>
          </tr>))}
      </Table>
      {list.loading && !list.data && <Skeleton className="h-20 mt-3" />}
      {list.data && <div className="panel mt-3"><Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} /></div>}
      <Modal open={open} onClose={() => setOpen(false)} title="Add user" footer={<><button className="btn-quiet" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="btn-primary" onClick={async () => { if (await save(() => api.post("/admin/users", { ...f, team: f.team || undefined }), "User created")) { setOpen(false); void list.reload(); } }}>{t("common.add")}</button></>}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Initial password" hint="At least 8 characters with a letter and a number."><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{["END_USER", "AGENT", "ADMIN"].map((r) => <option key={r} value={r}>{t(`role.${r}` as Key)}</option>)}</select></Field>
          <Field label="Team (staff)"><input className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></Field></div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------- team
interface E { id: string; name: string; team: string; location: string | null; timezone: string; available: boolean; capacity: number; openTickets: number; shiftStartMin: number; shiftEndMin: number; skills: { name: string; level: number }[] }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function Team() {
  const { t } = useI18n(); const save = useSave();
  const list = useApi<E[]>("/admin/employees");
  const patch = (id: string, b: object) => save(() => api.patch(`/admin/employees/${id}`, b)).then(() => list.reload());
  return (
    <div><PageHeader title={t("nav.team")} lede="Availability, capacity and shifts feed the AI routing engine." />
      <Table head={["Agent", "Top skills", "Load", "Shift (local)", "Available"]}>
        {list.data?.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5"><span className="font-semibold block leading-tight">{e.name}</span><span className="text-ink3 text-[12.5px]">{e.team} · {e.location ?? e.timezone}</span></td>
            <td className="px-4 text-ink2">{[...e.skills].sort((a, b) => b.level - a.level).slice(0, 3).map((s) => `${s.name} ${s.level}`).join(", ")}</td>
            <td className="px-4"><span className="tnum font-semibold">{e.openTickets}</span><span className="text-ink3 tnum"> / {e.capacity}</span></td>
            <td className="px-4 tnum text-ink2">{hhmm(e.shiftStartMin)}–{hhmm(e.shiftEndMin)}</td>
            <td className="px-4"><Toggle on={e.available} label="Available" onChange={(v) => patch(e.id, { available: v })} /></td>
          </tr>))}
      </Table>
    </div>
  );
}

// -------------------------------------------------------------- SLA & hours
interface Policy { priority: string; responseMins: number; resolutionMins: number; businessHoursOnly: boolean }
interface Cal { enabled: boolean; timezone: string; workDays: number[]; startMin: number; endMin: number; holidays: string[] }
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function Sla() {
  const { t } = useI18n(); const save = useSave();
  const pol = useApi<Policy[]>("/admin/sla-policies"); const st = useApi<{ calendar: Cal }>("/admin/settings");
  const [edit, setEdit] = useState<Record<string, Policy>>({}); const [cal, setCal] = useState<Cal | null>(null);
  const c = cal ?? st.data?.calendar;
  const zones = (Intl as any).supportedValuesOf?.("timeZone") as string[] ?? ["UTC"];
  return (
    <div className="max-w-4xl"><PageHeader title={t("nav.sla")} lede="Targets per priority. Business-hours policies pause outside the working calendar." />
      <Table head={["Priority", "First response (min)", "Resolution (min)", "Business hours only", ""]}>
        {pol.data?.map((p0) => { const p = edit[p0.priority] ?? p0; const set = (b: Partial<Policy>) => setEdit({ ...edit, [p0.priority]: { ...p, ...b } }); return (
          <tr key={p.priority}><td className="px-4 py-2.5 font-semibold">{t(`pri.${p.priority}` as Key)}</td>
            <td className="px-4"><input className="input !h-8 w-28 tnum" type="number" min={1} value={p.responseMins} onChange={(e) => set({ responseMins: +e.target.value })} /></td>
            <td className="px-4"><input className="input !h-8 w-28 tnum" type="number" min={1} value={p.resolutionMins} onChange={(e) => set({ resolutionMins: +e.target.value })} /></td>
            <td className="px-4"><Toggle on={p.businessHoursOnly} label="Business hours only" onChange={(v) => set({ businessHoursOnly: v })} /></td>
            <td className="px-4 text-end"><button className="btn-quiet btn-sm" disabled={!edit[p0.priority]} onClick={() => save(() => api.put(`/admin/sla-policies/${p.priority}`, { responseMins: p.responseMins, resolutionMins: p.resolutionMins, businessHoursOnly: p.businessHoursOnly })).then(() => pol.reload())}>{t("common.save")}</button></td></tr>); })}
      </Table>
      {c && <section className="panel p-5 mt-5"><h2 className="text-[15px] mb-3">Business calendar</h2>
        <div className="grid sm:grid-cols-3 gap-3"><Field label="Time zone"><select className="input" value={c.timezone} onChange={(e) => setCal({ ...c, timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</select></Field>
          <Field label="Day starts"><input className="input" type="time" value={hhmm(c.startMin)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); setCal({ ...c, startMin: h * 60 + m }); }} /></Field>
          <Field label="Day ends"><input className="input" type="time" value={hhmm(c.endMin)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); setCal({ ...c, endMin: h * 60 + m }); }} /></Field></div>
        <Field label="Working days"><div className="flex gap-1.5 flex-wrap">{DAYS.map((d, i) => <button key={d} aria-pressed={c.workDays.includes(i)} onClick={() => setCal({ ...c, workDays: c.workDays.includes(i) ? c.workDays.filter((x) => x !== i) : [...c.workDays, i] })} className={cx("h-8 px-3 rounded-md border font-semibold", c.workDays.includes(i) ? "bg-solid text-white border-transparent" : "bg-surface border-line text-ink2")}>{d}</button>)}</div></Field>
        <Field label="Holidays (YYYY-MM-DD, comma separated)"><input className="input" value={c.holidays.join(", ")} onChange={(e) => setCal({ ...c, holidays: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Field>
        <button className="btn-primary" disabled={!cal} onClick={() => save(() => api.put("/admin/settings/calendar", cal)).then(() => st.reload())}>{t("common.save")}</button></section>}
    </div>
  );
}

// -------------------------------------------------------------- automation
interface Rule { id: string; name: string; enabled: boolean; actionType: string; conditions: Record<string, unknown>; _count: { executions: number } }
const describe = (c: Record<string, unknown>) => Object.entries(c).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join(" · ");
export function Automation() {
  const { t } = useI18n(); const save = useSave();
  const list = useApi<Rule[]>("/admin/rules");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", actionType: "ESCALATE", priority: "", olderThanMins: "", slaStatus: "" });
  const create = async () => {
    const conditions: Record<string, unknown> = {};
    if (f.priority) conditions.priority = [f.priority]; if (f.olderThanMins) conditions.olderThanMins = +f.olderThanMins; if (f.slaStatus) conditions.slaStatus = [f.slaStatus];
    if (await save(() => api.post("/admin/rules", { name: f.name, actionType: f.actionType, conditions }), "Rule created")) { setOpen(false); void list.reload(); }
  };
  return (
    <div><PageHeader title={t("nav.automation")} lede="Each rule fires at most once per ticket. Rules run every minute on one API instance." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add rule</button>} />
      <Table head={["Rule", "When", "Then", "Fired", "On", ""]}>
        {list.data?.map((r) => <tr key={r.id}><td className="px-4 py-2.5 font-semibold">{r.name}</td><td className="px-4 text-ink2">{describe(r.conditions)}</td><td className="px-4"><span className="chip bg-tint text-brand">{r.actionType.replace(/_/g, " ").toLowerCase()}</span></td>
          <td className="px-4 tnum">{r._count.executions}</td><td className="px-4"><Toggle on={r.enabled} label="Enabled" onChange={(v) => save(() => api.patch(`/admin/rules/${r.id}`, { enabled: v })).then(() => list.reload())} /></td>
          <td className="px-4"><button className="btn-icon" aria-label="Delete rule" onClick={() => save(() => api.delete(`/admin/rules/${r.id}`), "Deleted").then(() => list.reload())}><Trash2 size={16} /></button></td></tr>)}
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Add rule" footer={<button className="btn-primary" disabled={f.name.length < 3} onClick={create}>{t("common.add")}</button>}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Any</option>{["P1", "P2", "P3", "P4"].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Older than (min)"><input className="input" type="number" min={1} value={f.olderThanMins} onChange={(e) => setF({ ...f, olderThanMins: e.target.value })} /></Field>
          <Field label="SLA state"><select className="input" value={f.slaStatus} onChange={(e) => setF({ ...f, slaStatus: e.target.value })}><option value="">Any</option>{["WARNING", "AT_RISK", "BREACHED"].map((p) => <option key={p}>{p}</option>)}</select></Field></div>
        <Field label="Action"><select className="input" value={f.actionType} onChange={(e) => setF({ ...f, actionType: e.target.value })}>{["ESCALATE", "NOTIFY_ADMINS", "BUMP_PRIORITY", "AI_REASSIGN"].map((a) => <option key={a}>{a}</option>)}</select></Field>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- AI settings
type Settings = { assignmentWeights: Record<string, number>; ai: Record<string, number> };
const W: [string, string][] = [["skillMatch", "Skill match"], ["categoryExpertise", "Past fixes in category"], ["workload", "Free capacity"], ["availability", "Availability"], ["avgResolution", "Speed"], ["locationShift", "On shift"], ["slaRisk", "Deadline risk"]];
const T: [string, string, number, number, number][] = [["minConfidenceForAutoAssign", "Auto-assign only above this confidence (%)", 0, 100, 1], ["deflectionMinCoverage", "Share of question terms an article must match to be offered", 0, 1, 0.05], ["duplicateThreshold", "Similarity that flags a duplicate", 0.1, 1, 0.05], ["clusterMinTickets", "Similar tickets that raise a major-incident alert", 2, 50, 1], ["clusterWindowMins", "Alert window (minutes)", 5, 1440, 5]];
export function AiSettings() {
  const { t } = useI18n(); const save = useSave();
  const st = useApi<Settings>("/admin/settings"); const [w, setW] = useState<Record<string, number> | null>(null); const [ai, setAi] = useState<Record<string, number> | null>(null);
  const weights = w ?? st.data?.assignmentWeights; const th = ai ?? st.data?.ai;
  return (
    <div className="max-w-3xl"><PageHeader title={t("nav.ai")} lede="Tune how the AI routes, answers and raises alarms. Changes apply within 30 seconds." />
      {weights && <section className="panel p-5 mb-4"><h2 className="text-[15px] mb-1">Routing weights</h2><p className="text-ink2 mb-4">Relative importance of each factor when choosing an assignee. They are normalised, so they need not sum to 1.</p>
        {W.map(([k, l]) => <div key={k} className="grid grid-cols-[180px_1fr_44px] items-center gap-3 mb-2"><label htmlFor={k}>{l}</label><input id={k} type="range" min={0} max={1} step={0.05} value={weights[k]} onChange={(e) => setW({ ...weights, [k]: +e.target.value })} className="accent-[rgb(var(--ai))]" /><span className="tnum text-end font-semibold">{weights[k].toFixed(2)}</span></div>)}
        <button className="btn-primary mt-3" disabled={!w} onClick={() => save(() => api.put("/admin/settings/assignmentWeights", w)).then(() => st.reload())}>{t("common.save")}</button></section>}
      {th && <section className="panel p-5"><h2 className="text-[15px] mb-4">Thresholds</h2>
        {T.map(([k, l, min, max, step]) => <Field key={k} label={l}><input className="input w-32 tnum" type="number" min={min} max={max} step={step} value={th[k]} onChange={(e) => setAi({ ...th, [k]: +e.target.value })} /></Field>)}
        <button className="btn-primary" disabled={!ai} onClick={() => save(() => api.put("/admin/settings/ai", ai)).then(() => st.reload())}>{t("common.save")}</button></section>}
    </div>
  );
}

// ------------------------------------------------------------ integrations
interface Hook { id: string; name: string; kind: string; url: string; events: string[]; enabled: boolean; failureCount: number; lastStatus: number | null; lastDeliveryAt: string | null }
const EVENTS = ["ticket.created", "ticket.assigned", "ticket.escalated", "ticket.resolved", "sla.at_risk", "sla.breached", "incident.cluster"];
export function Integrations() {
  const { t, fmt } = useI18n(); const save = useSave();
  const list = useApi<Hook[]>("/admin/webhooks"); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", kind: "SLACK", url: "", secret: "", events: ["ticket.escalated", "sla.breached", "incident.cluster"] });
  return (
    <div><PageHeader title={t("nav.integrations")} lede="Send events to Slack, Microsoft Teams or any HTTPS endpoint. Generic hooks are signed with HMAC-SHA256 in the X-ITSM-Signature header." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add webhook</button>} />
      <Table head={["Name", "Type", "Events", "Last delivery", "On", ""]}>
        {list.data?.map((h) => <tr key={h.id}><td className="px-4 py-2.5"><span className="font-semibold block">{h.name}</span><span className="text-ink3 text-[12.5px]">{new URL(h.url).host}</span></td><td className="px-4">{h.kind}</td><td className="px-4 text-ink2 max-w-xs">{h.events.join(", ")}</td>
          <td className="px-4">{h.lastDeliveryAt ? <span className={h.lastStatus && h.lastStatus < 300 ? "text-ok" : "text-bad"}>{h.lastStatus || "failed"} · {fmt.relative(h.lastDeliveryAt)}</span> : "—"}</td>
          <td className="px-4"><Toggle on={h.enabled} label="Enabled" onChange={(v) => save(() => api.patch(`/admin/webhooks/${h.id}`, { enabled: v })).then(() => list.reload())} /></td>
          <td className="px-4 whitespace-nowrap"><button className="btn-quiet btn-sm me-1" onClick={() => save(async () => { const r = await api.post(`/admin/webhooks/${h.id}/test`); if (r.data.status < 200 || r.data.status >= 300) throw new Error(r.data.error ?? `HTTP ${r.data.status}`); }, "Test delivered").then(() => list.reload())}>Test</button><button className="btn-icon" aria-label="Delete webhook" onClick={() => save(() => api.delete(`/admin/webhooks/${h.id}`), "Deleted").then(() => list.reload())}><Trash2 size={16} /></button></td></tr>)}
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Add webhook" wide footer={<button className="btn-primary" onClick={async () => { if (await save(() => api.post("/admin/webhooks", { ...f, secret: f.secret || undefined }), "Webhook added")) { setOpen(false); void list.reload(); } }}>{t("common.add")}</button>}>
        <div className="grid grid-cols-2 gap-3"><Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["SLACK", "TEAMS", "GENERIC"].map((k) => <option key={k}>{k}</option>)}</select></Field></div>
        <Field label="HTTPS URL" hint="Private and internal addresses are blocked."><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://hooks.slack.com/services/…" /></Field>
        {f.kind === "GENERIC" && <Field label="Signing secret"><input className="input" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></Field>}
        <Field label="Events"><div className="flex flex-wrap gap-2">{EVENTS.map((e) => <label key={e} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={f.events.includes(e)} onChange={() => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] })} />{e}</label>)}</div></Field>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------- governance
interface Interaction { id: string; feature: string; provider: "anthropic" | "rules"; success: boolean; fallback: boolean; latencyMs: number; inputTokens: number | null; outputTokens: number | null; error: string | null; createdAt: string }
interface Audit { id: string; actor: string; action: string; entity: string; entityId: string | null; createdAt: string; ip: string | null }
export function Governance() {
  const { t, fmt } = useI18n();
  const [tab, setTab] = useState<"ai" | "audit">("ai"); const [page, setPage] = useState(1); const [q, setQ] = useState(""); const dq = useDebounced(q);
  const ai = useApi<Page<Interaction>>(tab === "ai" ? "/admin/ai-interactions" : null, { page, pageSize: 25 }, [tab]);
  const au = useApi<Page<Audit>>(tab === "audit" ? "/admin/audit" : null, { page, pageSize: 25, q: dq || undefined }, [tab]);
  const cur = tab === "ai" ? ai.data : au.data;
  return (
    <div><PageHeader title={t("nav.governance")} lede="Every AI call is logged with provider, latency and token use. Configuration and security events are in the audit trail." />
      <Tabs tabs={[{ id: "ai", label: "AI activity" }, { id: "audit", label: "Audit trail" }]} value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
      <div className="mt-4">
        {tab === "audit" && <input className="input max-w-xs mb-3" placeholder="Filter by action, actor or entity" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Filter audit log" />}
        {tab === "ai" ? <Table head={["When", "Feature", "Provider", "Latency", "Tokens in/out", "Note"]}>{ai.data?.items.map((r) => <tr key={r.id}><td className="px-4 py-2 text-ink2">{fmt.dateTime(r.createdAt)}</td><td className="px-4 font-semibold">{r.feature}</td><td className="px-4"><AiMark provider={r.provider} /></td><td className="px-4 tnum">{r.latencyMs} ms</td><td className="px-4 tnum text-ink2">{r.inputTokens ?? "–"} / {r.outputTokens ?? "–"}</td><td className="px-4 text-ink3 max-w-[280px] truncate">{r.fallback ? `fallback: ${r.error ?? ""}` : ""}</td></tr>)}</Table>
          : <Table head={["When", "Who", "Action", "Entity", "IP"]}>{au.data?.items.map((r) => <tr key={r.id}><td className="px-4 py-2 text-ink2">{fmt.dateTime(r.createdAt)}</td><td className="px-4">{r.actor}</td><td className="px-4 font-semibold">{r.action}</td><td className="px-4 text-ink2">{r.entity}</td><td className="px-4 text-ink3 tnum">{r.ip}</td></tr>)}</Table>}
        {cur && <div className="panel mt-3"><Pager page={page} pageSize={25} total={cur.total} onChange={setPage} /></div>}
      </div>
    </div>
  );
}
