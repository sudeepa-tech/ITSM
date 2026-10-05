import { Inbox, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { DirectoryEntry, Page, Priority, TicketRow } from "../api/types";
import { useApi } from "../api/useApi";
import { MajorChip, MoodChip, PriorityChip, SlaMeter, StatusChip } from "../components/Badges";
import { Avatar, cx, EmptyState, PageHeader, Pager, Skeleton, useDebounced } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Key, useI18n } from "../i18n";
import { useBus } from "../lib/bus";

type View = "open" | "mine" | "unassigned" | "triage" | "risk" | "resolved" | "all";
const PARAMS: Record<View, Record<string, string>> = {
  open: { status: "OPEN" }, mine: { status: "OPEN", assignedToMe: "true" }, unassigned: { status: "OPEN", unassigned: "true" }, triage: { status: "OPEN", needsTriage: "true" },
  risk: { status: "OPEN", sla: "AT_RISK,BREACHED" }, resolved: { status: "RESOLVED,CLOSED" }, all: {},
};
const SORTS = ["sla", "createdAt", "priority", "updatedAt", "sentiment"] as const;

export default function Tickets() {
  const { user } = useAuth();
  const { t, fmt } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const staff = user!.role !== "END_USER";
  const views: View[] = staff ? ["open", "mine", "unassigned", "triage", "risk", "resolved", "all"] : ["open", "resolved", "all"];
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]>(staff ? "sla" : "updatedAt");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dq = useDebounced(q, 300);
  const dir = sort === "sla" ? "asc" : "desc";
  const list = useApi<Page<TicketRow>>("/tickets", { ...PARAMS[view], q: dq || undefined, sort, dir, page, pageSize: 25 });
  const dirEntries = useApi<DirectoryEntry[]>(staff ? "/directory" : null);
  useEffect(() => { setPage(1); setSel(new Set()); }, [view, dq, sort]);
  useBus("ticket:created", useCallback(() => void list.reload(), [list]));
  useBus("ticket:updated", useCallback(() => void list.reload(), [list]));

  const items = list.data?.items ?? [];
  const allSel = items.length > 0 && items.every((i) => sel.has(i.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async (action: string, value: string) => {
    if (!value) return;
    try {
      const { data } = await api.post("/tickets/bulk", { ids: [...sel], action, value });
      toast(t("q.bulk.done", { n: data.updated }), data.failed.length ? "info" : "success");
      setSel(new Set()); void list.reload();
    } catch (e) { toast(errMsg(e), "error"); }
  };

  return (
    <div>
      <PageHeader title={t(staff ? "q.title.staff" : "q.title.user")} actions={<Link to="/tickets/new" className="btn-primary">{t("nav.new")}</Link>} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="tablist" className="flex gap-1 overflow-x-auto scroll-y max-w-full">
          {views.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("h-8 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap border transition-colors", view === v ? "bg-solid text-white border-transparent" : "bg-surface border-line text-ink2 hover:text-ink")}>{t(`q.view.${v}` as Key)}</button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-ink3" aria-hidden />
          <input className="input ps-9" placeholder={t("q.search")} aria-label={t("q.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          {SORTS.filter((s) => staff || (s !== "sla" && s !== "sentiment")).map((s) => <option key={s} value={s}>{t(`q.sort.${s}` as Key)}</option>)}
        </select>
      </div>

      {sel.size > 0 && (
        <div className="panel mb-3 px-4 py-2.5 flex flex-wrap items-center gap-2 bg-tint border-brand/30 sticky top-16 z-20">
          <span className="font-semibold tnum me-2">{t("q.selected", { n: sel.size })}</span>
          <select className="input w-auto" value="" onChange={(e) => bulk("assign", e.target.value)} aria-label={t("q.bulk.assign")}>
            <option value="">{t("q.bulk.assign")}</option>{dirEntries.data?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.openTickets})</option>)}
          </select>
          <select className="input w-auto" value="" onChange={(e) => bulk("status", e.target.value)} aria-label={t("q.bulk.status")}>
            <option value="">{t("q.bulk.status")}</option>{["IN_PROGRESS", "PENDING_USER", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{t(`status.${s}` as Key)}</option>)}
          </select>
          <select className="input w-auto" value="" onChange={(e) => bulk("priority", e.target.value)} aria-label={t("q.bulk.priority")}>
            <option value="">{t("q.bulk.priority")}</option>{(["P1", "P2", "P3", "P4"] as Priority[]).map((p) => <option key={p} value={p}>{t(`pri.${p}` as Key)}</option>)}
          </select>
          <button className="btn-ghost btn-sm ms-auto" onClick={() => setSel(new Set())}>{t("common.cancel")}</button>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto scroll-y">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-start text-ink3 text-[12.5px] border-b border-line bg-sunken">
                {staff && <th className="w-10 ps-4 py-2.5"><input type="checkbox" aria-label={t("q.select_all")} checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(items.map((i) => i.id)))} /></th>}
                <th className="text-start font-semibold px-4 py-2.5">{t("f.subject")}</th>
                <th className="text-start font-semibold px-3 py-2.5 hidden sm:table-cell">{t("f.priority")}</th>
                <th className="text-start font-semibold px-3 py-2.5">{t("f.status")}</th>
                <th className="text-start font-semibold px-3 py-2.5 hidden lg:table-cell">{staff ? t("f.assignee") : t("f.team")}</th>
                <th className="text-start font-semibold px-3 py-2.5 hidden md:table-cell">{staff ? t("f.sla") : t("f.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && !list.data && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-b border-line"><td colSpan={6} className="px-4 py-3.5"><Skeleton className="h-5" /></td></tr>)}
              {items.map((tk) => (
                <tr key={tk.id} className={cx("border-b border-line last:border-0 hover:bg-sunken/70 cursor-pointer", sel.has(tk.id) && "bg-tint/50")} onClick={() => nav(`/tickets/${tk.id}`)}>
                  {staff && <td className="ps-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={tk.ticketNumber} checked={sel.has(tk.id)} onChange={() => toggle(tk.id)} /></td>}
                  <td className="px-4 py-3 max-w-[460px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-ink3 tnum font-semibold">{tk.ticketNumber}</span>
                      {staff && tk.isMajor && <MajorChip />}
                      {staff && tk.needsTriage && <span className="chip bg-warn-tint text-warn">{t("q.triage")}</span>}
                      {staff && <MoodChip score={tk.sentiment} />}
                    </div>
                    <Link to={`/tickets/${tk.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-brand block truncate" lang={tk.language}>{tk.subject}</Link>
                    <div className="text-ink3 text-[12.5px]">{staff && <>{tk.requester.name}{tk.category ? ` · ${tk.category.name}` : ""}</>}{!staff && tk.category?.name}</div>
                  </td>
                  <td className="px-3 hidden sm:table-cell"><PriorityChip p={tk.priority} /></td>
                  <td className="px-3"><StatusChip s={tk.status} /></td>
                  <td className="px-3 hidden lg:table-cell">
                    {tk.assignee ? <span className="inline-flex items-center gap-2">{staff && <Avatar name={tk.assignee.user.name} size={22} />}<span>{staff ? tk.assignee.user.name : tk.assignee.team}</span></span> : <span className={staff ? "text-bad font-semibold" : "text-ink3"}>{t("common.unassigned")}</span>}
                  </td>
                  <td className="px-3 hidden md:table-cell">{staff ? <SlaMeter sla={tk.slaInstance} ticketStatus={tk.status} /> : <span className="text-ink2">{fmt.relative(tk.updatedAt)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && items.length === 0 && <EmptyState icon={<Inbox size={30} />} title={t("q.empty.title")} body={t(staff || view !== "open" ? "q.empty.body" : "q.empty.user")} />}
        {list.error && <p className="p-4 text-bad">{list.error}</p>}
        {list.data && list.data.total > 0 && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />}
      </div>
    </div>
  );
}
