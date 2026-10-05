import { ArrowLeft, Download, Languages, Lock, Paperclip, Sparkles, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { AssignmentScore, DirectoryEntry, Insights, Priority, Provider, Ticket, TicketStatus } from "../api/types";
import { useApi } from "../api/useApi";
import { MajorChip, MoodChip, PriorityChip, SlaMeter, StatusChip } from "../components/Badges";
import { AiMark, Avatar, cx, Field, Modal, Skeleton, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Key, useI18n } from "../i18n";
import { useBus } from "../lib/bus";

type Tone = "empathetic" | "concise" | "formal";
const FACTORS: [keyof AssignmentScore, string][] = [
  ["skillMatch", "Skills"], ["categoryExpertise", "Past fixes"], ["workloadScore", "Free capacity"], ["availabilityScore", "Available"], ["resolutionScore", "Speed"], ["shiftScore", "On shift"], ["slaRiskScore", "Deadline risk"],
];

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, fmt, locale } = useI18n();
  const toast = useToast();
  const staff = user!.role !== "END_USER";
  const tk = useApi<Ticket>(`/tickets/${id}`);
  const ins = useApi<Insights>(staff ? `/ai/tickets/${id}/insights` : null);
  const dir = useApi<DirectoryEntry[]>(staff ? "/directory" : null);
  const t0 = tk.data;

  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [drafted, setDrafted] = useState<{ provider: Provider } | null>(null);
  const [tone, setTone] = useState<Tone>("empathetic");
  const [busy, setBusy] = useState("");
  const [translation, setTranslation] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [escOpen, setEscOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => void tk.reload(), [tk]);
  const onEvent = useCallback((p: { ticketId?: string }) => { if (p?.ticketId === id) void tk.reload(); }, [id, tk]);
  useBus("ticket:updated", onEvent); useBus("ticket:comment", onEvent); useBus("ticket:assigned", onEvent);
  useEffect(() => { setText(""); setDrafted(null); setTranslation(""); }, [id]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); await tk.reload(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); }
  };
  const setStatus = (status: TicketStatus, extra: object = {}) => act(status, () => api.patch(`/tickets/${id}/status`, { status, ...extra }));

  if (tk.error && !t0) return <p className="text-bad">{tk.error}</p>;
  if (!t0) return <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const done = t0.status === "RESOLVED" || t0.status === "CLOSED";
  const a = t0.aiAnalysis;
  const reasonInfo = a?.assignmentReason;

  const send = () => act("send", async () => {
    await api.post(`/tickets/${id}/comments`, { body: text, internal: staff && mode === "note", aiAssisted: !!drafted });
    setText(""); setDrafted(null);
  });
  const draft = async () => {
    setBusy("draft");
    try { const { data } = await api.post(`/ai/tickets/${id}/reply-draft`, { tone }); setText(data.draft); setDrafted({ provider: data.provider }); setMode("reply"); }
    catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); }
  };
  const summarize = () => act("sum", () => api.post(`/ai/tickets/${id}/summary`, {}));
  const feedback = (feature: string, verdict: "UP" | "DOWN") => api.post("/ai/feedback", { ticketId: id, feature, verdict }).then(() => toast(t("common.saved"))).catch(() => undefined);
  const translate = async () => {
    setBusy("tr");
    try { const { data } = await api.post("/ai/translate", { text: `${t0.subject}\n\n${t0.description}`, target: locale }); setTranslation(data.translation); }
    catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); }
  };
  const suggestNotes = async () => { setBusy("notes"); try { const { data } = await api.post(`/ai/tickets/${id}/resolution-notes`, {}); setNotes(data.notes); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); } };
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const fd = new FormData(); [...list].forEach((f) => fd.append("files", f));
    await act("up", () => api.post(`/tickets/${id}/attachments`, fd));
  };
  const download = async (attId: string, name: string) => {
    const r = await api.get(`/tickets/${id}/attachments/${attId}`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data); const el = document.createElement("a"); el.href = url; el.download = name; el.click(); URL.revokeObjectURL(url);
  };
  const copyable = t0.language !== locale;
  const events = showAll ? t0.history : t0.history.slice(-8);

  return (
    <div>
      <Link to="/tickets" className="inline-flex items-center gap-1 text-ink2 hover:text-ink mb-3"><ArrowLeft size={15} className="rtl:-scale-x-100" />{t("common.back")}</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="tnum font-semibold text-ink3">{t0.ticketNumber}</span><PriorityChip p={t0.priority} /><StatusChip s={t0.status} />
            <span className="chip bg-sunken text-ink2 ring-1 ring-inset ring-line">{t(`type.${t0.type}` as Key)}</span>
            {staff && t0.isMajor && <MajorChip />}{staff && <MoodChip score={t0.sentiment} />}
            {t0.duplicateOf && <span className="chip bg-sunken text-ink2">{t("d.dupe_of", { n: t0.duplicateOf.ticketNumber })}</span>}
          </div>
          <h1 className="text-[24px] leading-snug" lang={t0.language}>{t0.subject}</h1>
        </div>
        {staff && <SlaMeter sla={t0.slaInstance} ticketStatus={t0.status} size="lg" />}
      </div>

      {staff && t0.needsTriage && !t0.assignee && <p className="rounded-md bg-warn-tint text-warn px-4 py-2.5 mb-4 font-medium">{t("d.triage_banner")}</p>}
      {!staff && t0.status === "RESOLVED" && (
        <div className="panel p-4 mb-4 flex flex-wrap items-center gap-3 border-ok/40 bg-ok-tint/40">
          <p className="flex-1 font-semibold">{t("d.resolved_q")}</p>
          <button className="btn-primary" onClick={() => setStatus("CLOSED")}>{t("d.confirm")}</button><button className="btn-quiet" onClick={() => setStatus("REOPENED")}>{t("d.reopen")}</button>
        </div>
      )}
      {!staff && done && <Csat t0={t0} onDone={reload} />}

      <div className={cx("grid gap-6 items-start", staff && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="space-y-4 min-w-0">
          {staff && (
            <section className="ai-block !py-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 className="text-[14px] flex items-center gap-2">{t("d.summary")}{t0.aiSummary && <AiMark provider={t0.aiSummaryProvider ?? "rules"} />}</h2>
                <button className="btn-ghost btn-sm" disabled={busy === "sum"} onClick={summarize}>{busy === "sum" ? <Spinner /> : <Sparkles size={14} />}{t0.aiSummary ? t("d.regen") : t("d.summarize")}</button>
              </div>
              {t0.aiSummary && <p>{t0.aiSummary}</p>}
            </section>
          )}

          <section className="panel p-5">
            <div className="flex items-center gap-3 mb-3"><Avatar name={t0.requester.name} /><div className="min-w-0 flex-1"><p className="font-semibold leading-tight">{t0.requester.name}</p><p className="text-ink3 text-[12.5px]">{t0.requester.department ? `${t0.requester.department} · ` : ""}{fmt.dateTime(t0.createdAt)}</p></div>
              {staff && copyable && <button className="btn-quiet btn-sm" onClick={translate} disabled={busy === "tr"}>{busy === "tr" ? <Spinner /> : <Languages size={14} />}{t("d.translate", { lang: new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale })}</button>}</div>
            <p className="whitespace-pre-wrap" lang={t0.language}>{t0.description}</p>
            {translation && <div className="ai-block mt-3 whitespace-pre-wrap">{translation}<div className="mt-1"><AiMark provider="anthropic" /></div></div>}
            {t0.attachments.length > 0 && (
              <div className="mt-4 pt-3 border-t border-line flex flex-wrap gap-2">
                {t0.attachments.map((f) => <button key={f.id} className="btn-quiet btn-sm" onClick={() => download(f.id, f.fileName)}><Download size={14} />{f.fileName}<span className="text-ink3 font-medium tnum">{fmt.bytes(f.sizeBytes)}</span></button>)}
              </div>
            )}
          </section>

          {done && t0.resolutionNotes && <section className="panel p-4 border-ok/40"><h2 className="text-[14px] mb-1">{t("d.notes_title")}</h2><p className="whitespace-pre-wrap">{t0.resolutionNotes}</p></section>}

          <section className="panel">
            <h2 className="text-[14px] px-5 pt-4 pb-2">{t("d.conversation")}</h2>
            <div className="px-5 pb-4 space-y-4">
              {t0.comments.length === 0 && <p className="text-ink3">{t("d.no_comments")}</p>}
              {t0.comments.map((c) => (
                <div key={c.id} className={cx("flex gap-3", c.internal && "bg-warn-tint/70 -mx-2 px-2 py-2 rounded-md")}>
                  <Avatar name={c.author.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[12.5px]"><span className="font-semibold text-[13.5px]">{c.author.name}</span>
                      {c.author.role !== "END_USER" && <span className="text-ink3">{t(`role.${c.author.role}` as Key)}</span>}<span className="text-ink3">{fmt.relative(c.createdAt)}</span>
                      {c.internal && <span className="inline-flex items-center gap-1 text-warn font-semibold"><Lock size={12} />{t("d.note")}</span>}
                      {c.aiAssisted && <span className="inline-flex items-center gap-1 text-ai font-semibold"><Sparkles size={12} />{t("d.ai_drafted")}</span>}</p>
                    <p className="whitespace-pre-wrap mt-0.5">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            {t0.status !== "CLOSED" && t0.status !== "CANCELLED" && (
              <div className="border-t border-line p-4 bg-sunken rounded-b-lg">
                {staff && (
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <div role="tablist" className="inline-flex p-0.5 bg-surface border border-line rounded-md">
                      {(["reply", "note"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx("px-3 h-7 rounded text-[13px] font-semibold", mode === m ? (m === "note" ? "bg-warn-tint text-warn" : "bg-tint text-brand") : "text-ink2")}>{t(m === "reply" ? "d.reply" : "d.note")}</button>)}
                    </div>
                    {mode === "reply" && <>
                      <select className="input w-auto !h-8" value={tone} onChange={(e) => setTone(e.target.value as Tone)} aria-label="Tone">{(["empathetic", "concise", "formal"] as Tone[]).map((x) => <option key={x} value={x}>{t(`d.tone.${x}` as Key)}</option>)}</select>
                      <button className="btn-quiet btn-sm !text-ai" onClick={draft} disabled={busy === "draft"}>{busy === "draft" ? <Spinner /> : <Sparkles size={14} />}{t("d.draft")}</button></>}
                  </div>
                )}
                <textarea className={cx("input min-h-[96px]", mode === "note" && "!bg-warn-tint/50")} value={text} onChange={(e) => setText(e.target.value)} placeholder={t(mode === "reply" ? "d.reply_ph" : "d.note_ph")} aria-label={t(mode === "reply" ? "d.reply" : "d.note")} />
                {drafted && (
                  <div className="ai-block mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 !py-1.5 text-[12.5px]">
                    <AiMark provider={drafted.provider} /><span className="text-ink2 flex-1">{t("ai.check")}</span>
                    <button className="btn-icon !h-7 !w-7" aria-label={t("ai.good")} onClick={() => feedback("reply_draft", "UP")}><ThumbsUp size={14} /></button><button className="btn-icon !h-7 !w-7" aria-label={t("ai.poor")} onClick={() => feedback("reply_draft", "DOWN")}><ThumbsDown size={14} /></button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <button className="btn-primary" disabled={!text.trim() || busy === "send"} onClick={send}>{busy === "send" && <Spinner />}{t(mode === "reply" ? "d.send" : "d.add_note")}</button>
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
                  <button className="btn-ghost" onClick={() => fileRef.current?.click()}><Paperclip size={15} />{t("d.add_files")}</button>
                  {!staff && t0.status === "PENDING_USER" && <span className="text-warn font-semibold ms-auto">{t("d.wait_you")}</span>}
                </div>
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="text-[14px] mb-3">{t("d.timeline")}</h2>
            <ol className="space-y-2 border-s border-line ms-1.5">
              {events.map((h) => <li key={h.id} className="ps-4 relative"><span className="absolute -start-[4.5px] top-2 h-2 w-2 rounded-full bg-line ring-2 ring-surface" aria-hidden />
                <span className="text-[13.5px]">{h.event}{h.newValue ? <span className="text-ink2"> → {h.newValue}</span> : null}</span><span className="text-ink3 text-[12.5px] ms-2">{fmt.relative(h.createdAt)}</span></li>)}
            </ol>
            {t0.history.length > 8 && <button className="text-brand font-semibold text-[13px] mt-2 hover:underline" onClick={() => setShowAll((s) => !s)}>{showAll ? t("common.close") : `+${t0.history.length - 8}`}</button>}
          </section>
        </div>

        <aside className="space-y-4 min-w-0">
          {staff && (
            <>
              <section className="panel p-4">
                <h2 className="text-[14px] mb-3">{t("d.details")}</h2>
                <div className="flex flex-wrap gap-2 mb-4">
                  {!done && <>
                    <button className="btn-quiet btn-sm" onClick={() => setStatus("IN_PROGRESS")}>{t("d.start")}</button>
                    <button className="btn-quiet btn-sm" onClick={() => setStatus("PENDING_USER")}>{t("d.wait")}</button>
                    <button className="btn-primary btn-sm" onClick={() => { setNotes(t0.resolutionNotes ?? ""); setResolveOpen(true); }}>{t("d.resolve")}</button>
                    <button className="btn-quiet btn-sm" onClick={() => setEscOpen(true)}>{t("d.escalate")}</button></>}
                  {done && <><button className="btn-quiet btn-sm" onClick={() => setStatus("REOPENED")}>{t("d.reopen")}</button><Link className="btn-quiet btn-sm" to={`/kb/new?ticket=${t0.id}`}>{t("d.make_kb")}</Link></>}
                </div>
                <Field label={t("f.assignee")}>
                  <div className="flex gap-2">
                    <select className="input" value={t0.assignee?.id ?? ""} onChange={(e) => e.target.value && act("assign", () => api.post(`/tickets/${id}/assign`, { employeeId: e.target.value }))}>
                      <option value="">{t0.assignee ? t0.assignee.user.name : t("d.pick_agent")}</option>{dir.data?.filter((d) => d.id !== t0.assignee?.id).map((d) => <option key={d.id} value={d.id}>{d.name} · {d.team} ({d.openTickets}){d.available ? "" : " ✕"}</option>)}
                    </select>
                    <button className="btn-quiet !px-2.5" title={t("d.auto")} aria-label={t("d.auto")} onClick={() => act("auto", () => api.post(`/tickets/${id}/auto-assign`), t("common.saved"))}>{busy === "auto" ? <Spinner /> : <Sparkles size={16} className="text-ai" />}</button>
                  </div>
                </Field>
                <Field label={t("f.priority")}><select className="input" value={t0.priority} onChange={(e) => act("pri", () => api.patch(`/tickets/${id}`, { priority: e.target.value }))}>{(["P1", "P2", "P3", "P4"] as Priority[]).map((p) => <option key={p} value={p}>{t(`pri.${p}` as Key)}</option>)}</select></Field>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                  <dt className="text-ink3">{t("f.category")}</dt><dd>{t0.category?.name ?? "—"}</dd>
                  <dt className="text-ink3">{t("f.channel")}</dt><dd>{t(`channel.${t0.channel}` as Key)}</dd>
                  <dt className="text-ink3">{t("f.language")}</dt><dd className="uppercase">{t0.language}</dd>
                  <dt className="text-ink3">{t("f.requester")}</dt><dd className="truncate">{t0.requester.email}</dd>
                  {t0.firstResponseAt && <><dt className="text-ink3">{t("sla.response")}</dt><dd>{fmt.relative(t0.firstResponseAt)}</dd></>}
                </dl>
              </section>

              <section className="ai-block !py-3.5" aria-label={t("d.copilot")}>
                <h2 className="text-[14px] flex items-center gap-2 mb-2">{t("d.copilot")}{ins.data && <AiMark provider={ins.data.stepsProvider} />}</h2>
                {ins.loading && !ins.data && <div className="space-y-2"><Skeleton className="w-full" /><Skeleton className="w-3/4" /></div>}
                {ins.data && <div className="space-y-4">
                  <div><h3 className="text-[13px] text-ink2 mb-1">{t("d.steps")}</h3><ol className="list-decimal ps-5 space-y-1">{ins.data.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>
                  {ins.data.docs.length > 0 && <div><h3 className="text-[13px] text-ink2 mb-1">{t("d.articles")}</h3><ul className="space-y-1">{ins.data.docs.slice(0, 3).map((d) => <li key={d.id}><Link className="text-brand font-semibold hover:underline" to={`/kb/${d.id}`}>{d.title}</Link></li>)}</ul></div>}
                  {ins.data.similar.length > 0 && <div><h3 className="text-[13px] text-ink2 mb-1">{t("d.similar")}</h3><ul className="space-y-2">{ins.data.similar.slice(0, 3).map((s) => <li key={s.id}><Link to={`/tickets/${s.id}`} className="hover:underline"><span className="tnum font-semibold">{s.ticketNumber}</span> {s.subject}</Link><span className="text-ink3 tnum ms-1">{fmt.percent(s.similarity)}</span>{s.resolutionNotes && <p className="text-ink2 text-[12.5px]"><b>{t("d.similar_fix")}:</b> {s.resolutionNotes}</p>}</li>)}</ul></div>}
                  {reasonInfo?.winner && <div><h3 className="text-[13px] text-ink2 mb-1.5">{t("d.why")}: {reasonInfo.winner.name}<span className="tnum"> ({reasonInfo.winner.composite}%)</span></h3>
                    <div className="space-y-1">{FACTORS.map(([k, label]) => { const v = reasonInfo.winner![k] as number; return <div key={k} className="grid grid-cols-[92px_1fr_32px] items-center gap-2 text-[12.5px]"><span className="text-ink2">{label}</span><span className="h-1.5 rounded-full bg-line/70 overflow-hidden"><span className="block h-full bg-ai rounded-full" style={{ width: `${v}%` }} /></span><span className="tnum text-end">{v}</span></div>; })}</div>
                    {a && <p className="text-ink3 text-[12.5px] mt-1.5">{t("ai.confidence", { n: Math.round(a.confidence) })}{reasonInfo.autoAssigned === false ? " — below the auto-assign threshold" : ""}</p>}</div>}
                </div>}
              </section>
            </>
          )}
          {!staff && (
            <section className="panel p-4">
              <h2 className="text-[14px] mb-3">{t("d.details")}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-ink3">{t("f.assignee")}</dt><dd>{t0.assignee ? `${t0.assignee.user.name} (${t0.assignee.team})` : t("common.unassigned")}</dd>
                <dt className="text-ink3">{t("f.category")}</dt><dd>{t0.category?.name ?? "—"}</dd><dt className="text-ink3">{t("f.created")}</dt><dd>{fmt.dateTime(t0.createdAt)}</dd>
              </dl>
              {!done && <p className="text-ink2 mt-3">{t("d.working")}</p>}
            </section>
          )}
        </aside>
      </div>

      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} title={t("d.resolve")}
        footer={<><button className="btn-quiet" onClick={() => setResolveOpen(false)}>{t("common.cancel")}</button><button className="btn-primary" onClick={async () => { await setStatus("RESOLVED", { resolutionNotes: notes || undefined }); setResolveOpen(false); }}>{t("d.resolve")}</button></>}>
        <Field label={t("d.notes_title")}><textarea className="input min-h-[120px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("d.notes_ph")} /></Field>
        <button className="btn-quiet btn-sm !text-ai" onClick={suggestNotes} disabled={busy === "notes"}>{busy === "notes" ? <Spinner /> : <Sparkles size={14} />}{t("d.draft")}</button>
      </Modal>
      <Modal open={escOpen} onClose={() => setEscOpen(false)} title={t("d.escalate")}
        footer={<><button className="btn-quiet" onClick={() => setEscOpen(false)}>{t("common.cancel")}</button><button className="btn-danger" onClick={async () => { await act("esc", () => api.post(`/tickets/${id}/escalate`, { reason: reason || undefined })); setEscOpen(false); }}>{t("d.escalate")}</button></>}>
        <Field label={t("f.description")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </Modal>
    </div>
  );
}

function Csat({ t0, onDone }: { t0: Ticket; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [score, setScore] = useState(t0.csatScore ?? 0);
  const [comment, setComment] = useState("");
  const rated = t0.csatScore !== null;
  const submit = async (s: number) => { setScore(s); try { await api.post(`/tickets/${t0.id}/feedback`, { score: s, comment: comment || undefined }); toast(t("d.rate_thanks")); onDone(); } catch (e) { toast(errMsg(e), "error"); } };
  return (
    <div className="panel p-4 mb-4 flex flex-wrap items-center gap-3">
      <p className="font-semibold">{rated ? t("d.rate_thanks") : t("d.rate")}</p>
      <div role="radiogroup" aria-label={t("d.rate")} className="flex">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={score === n} disabled={rated} aria-label={`${n}`} onClick={() => submit(n)} className="p-1 text-bar-warn disabled:cursor-default"><Star size={22} fill={n <= score ? "currentColor" : "none"} /></button>)}</div>
      {!rated && <input className="input flex-1 min-w-[180px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("common.optional")} maxLength={1000} />}
    </div>
  );
}
