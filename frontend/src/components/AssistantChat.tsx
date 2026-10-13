import { CheckCheck, CheckCircle2, FileText, Paperclip, RotateCcw, SendHorizontal, Ticket as TicketIcon, Users, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { Article, Page, Provider } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../i18n";
import { AiMark, cx, Spinner } from "./ui";

type Notice = { kind: "duplicate"; id: string; ticketNumber: string; subject: string } | { kind: "known"; count: number };
interface Msg {
  role: "user" | "assistant"; content: string; sources?: { id: string; title: string }[]; articles?: { id: string; title: string; excerpt: string }[];
  notices?: Notice[]; offerTicket?: boolean; provider?: Provider;
}
interface Created { id: string; ticketNumber: string; team: string | null }

/**
 * The one place employees raise requests. The assistant answers from the knowledge base first,
 * shows suggested articles and duplicate / known-issue warnings, and files the ticket on request.
 */
export default function AssistantChat({ variant, onClose }: { variant: "page" | "widget"; onClose?: () => void }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const page = variant === "page";

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy, created, solved]);
  useEffect(() => {
    api.get<Page<Article>>("/kb", { params: { pageSize: 20 } })
      .then((r) => setTopics(r.data.items.filter((a) => a.language === locale || a.language === "en").slice(0, 4)))
      .catch(() => undefined);
  }, [locale]);

  const reset = () => { setMsgs([]); setSession(null); setSolved(false); setCreated(null); setFiles([]); setText(""); };

  const ask = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setText(""); setMsgs((m) => [...m, { role: "user", content: message }]); setBusy(true);
    try {
      const { data } = await api.post("/virtual-agent/chat", { sessionId: session ?? undefined, message });
      setSession(data.sessionId); setMsgs((m) => [...m, data.message]);
    } catch (err) { toast(errMsg(err), "error"); } finally { setBusy(false); }
  };
  const send = (e: FormEvent) => { e.preventDefault(); void ask(text); };

  const makeTicket = async () => {
    if (!session) return;
    setCreating(true);
    try {
      const { data } = await api.post(`/virtual-agent/${session}/ticket`, {});
      if (files.length) {
        const fd = new FormData(); files.forEach((f) => fd.append("files", f));
        await api.post(`/tickets/${data.id}/attachments`, fd).catch((e) => toast(errMsg(e), "error"));
      }
      setCreated({ id: data.id, ticketNumber: data.ticketNumber, team: data.team }); setFiles([]);
    } catch (err) { toast(errMsg(err), "error"); } finally { setCreating(false); }
  };
  const markSolved = async () => { setSolved(true); await api.post(`/virtual-agent/${session}/resolve`, { resolved: true }).catch(() => undefined); };
  const addFiles = (list: FileList | null) => { if (list) setFiles((f) => [...f, ...list].slice(0, 5)); };

  const lastIdx = msgs.length - 1;
  const finished = !!created || solved;

  return (
    <div className={cx("flex flex-col", page ? "panel h-[calc(100dvh-12rem)] min-h-[520px] max-w-3xl" : "h-full")}>
      <header className="flex items-center gap-2 ps-4 pe-2 h-14 border-b border-line shrink-0">
        <div className="flex-1 min-w-0"><h2 className="text-[15px] leading-tight">{t("va.title")}</h2><p className="text-[12px] text-ink3 truncate">{t("va.sub")}</p></div>
        <button className="btn-icon" onClick={reset} aria-label={t("va.new")} title={t("va.new")}><RotateCcw size={16} /></button>
        {onClose && <button className="btn-icon" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>}
      </header>

      <div className="flex-1 overflow-y-auto scroll-y px-4 py-4 space-y-3" aria-live="polite">
        <div className="bg-sunken rounded-lg rounded-ss-sm px-3 py-2 max-w-[88%]">{t("va.hello", { name: user?.name.split(" ")[0] ?? "" })}</div>
        {msgs.length === 0 && topics.length > 0 && (
          <div>
            <p className="text-[12.5px] font-semibold text-ink3 mb-1.5">{t("va.popular")}</p>
            <div className="flex flex-wrap gap-2">{topics.map((a) => <button key={a.id} className="btn-quiet btn-sm !h-auto !py-1.5 text-start whitespace-normal" onClick={() => ask(a.title)}>{a.title}</button>)}</div>
          </div>
        )}

        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end"><div className="bg-solid text-white rounded-lg rounded-se-sm px-3 py-2 max-w-[88%] whitespace-pre-wrap">{m.content}</div></div>
        ) : (
          <div key={i} className="max-w-[94%] space-y-2">
            <div className={cx("rounded-lg rounded-ss-sm px-3 py-2 whitespace-pre-wrap", m.sources?.length ? "ai-block !rounded-lg" : "bg-sunken")}>{m.content}</div>
            {m.sources && m.sources.length > 0 && <div className="ps-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"><AiMark provider={m.provider} /><span className="text-ink3">{t("va.sources")}:</span>{m.sources.map((s) => <Link key={s.id} to={`/kb/${s.id}`} target={page ? "_blank" : undefined} className="text-brand font-semibold hover:underline" onClick={() => !page && onClose?.()}>{s.title}</Link>)}</div>}
            {m.notices?.map((n, j) => n.kind === "duplicate"
              ? <div key={j} className="rounded-md bg-tint px-3 py-2 text-[13.5px]"><p className="font-semibold text-brand">{t("nt.dupe")}</p><Link className="hover:underline" to={`/tickets/${n.id}`} onClick={() => !page && onClose?.()}><b className="tnum">{n.ticketNumber}</b> {n.subject}</Link></div>
              : <p key={j} className="rounded-md bg-warn-tint text-warn px-3 py-2 flex gap-2 text-[13.5px]"><Users size={16} className="mt-0.5 shrink-0" />{t("nt.known", { n: n.count })}</p>)}
            {m.articles && m.articles.length > 0 && (
              <div><p className="text-[12.5px] font-semibold text-ink3 mb-1">{t("va.suggested")}</p>
                <ul className="space-y-1.5">{m.articles.map((a) => (
                  <li key={a.id}><Link to={`/kb/${a.id}`} target={page ? "_blank" : undefined} onClick={() => !page && onClose?.()} className="block rounded-md border border-line bg-surface px-3 py-2 hover:border-brand/50">
                    <span className="font-semibold text-brand flex items-center gap-1.5"><FileText size={14} className="shrink-0" />{a.title}</span><span className="block text-ink2 text-[12.5px] line-clamp-2">{a.excerpt}</span></Link></li>))}</ul></div>
            )}
            {i === lastIdx && !finished && (
              <div>
                <div className="flex flex-wrap gap-2">
                  {!m.offerTicket && <button className="btn-quiet btn-sm" onClick={markSolved}><CheckCheck size={15} />{t("va.solved")}</button>}
                  <button className="btn-primary btn-sm" disabled={creating} onClick={makeTicket}>{creating ? <Spinner /> : <TicketIcon size={15} />}{t("va.ticket")}</button>
                </div>
                <p className="text-ink3 text-[12.5px] mt-1.5">{t("va.detail_hint")}</p>
              </div>
            )}
          </div>
        ))}

        {busy && <div className="flex items-center gap-2 text-ink3 text-[13px]"><Spinner />{t("va.thinking")}</div>}
        {solved && !created && <div className="rounded-lg bg-ok-tint/60 border border-ok/30 p-3"><p className="font-semibold text-ok flex items-center gap-2"><CheckCircle2 size={17} />{t("va.thanks_solved")}</p><button className="btn-quiet btn-sm mt-2" onClick={reset}>{t("va.another")}</button></div>}
        {created && (
          <div className="rounded-lg bg-ok-tint/60 border border-ok/30 p-3">
            <p className="font-semibold text-ok flex items-center gap-2"><CheckCircle2 size={17} />{t("va.created", { n: created.ticketNumber })}</p>
            {created.team && <p className="text-ink2 mt-0.5">{t("va.created_body", { team: created.team })}</p>}
            <div className="flex flex-wrap gap-2 mt-2.5"><Link to={`/tickets/${created.id}`} className="btn-primary btn-sm" onClick={() => onClose?.()}>{t("va.open_ticket")}</Link><button className="btn-quiet btn-sm" onClick={reset}>{t("va.another")}</button></div>
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-line p-3 shrink-0">
        {files.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{files.map((f, i) => <span key={i} className="chip bg-sunken text-ink2 ring-1 ring-inset ring-line !h-7">{f.name}<button aria-label={t("common.delete")} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={13} /></button></span>)}</div>}
        <form onSubmit={send} className="flex gap-2">
          <input ref={fileInput} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt,.log,.csv" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" className="btn-icon border border-line" onClick={() => fileInput.current?.click()} aria-label={t("va.attach")} title={t("va.attach")}><Paperclip size={16} /></button>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("va.ph")} aria-label={t("va.ph")} maxLength={2000} disabled={!!created} autoFocus={page} />
          <button className="btn-primary !px-3" disabled={!text.trim() || busy || !!created} aria-label={t("common.send")}><SendHorizontal size={17} className="rtl:-scale-x-100" /></button>
        </form>
      </div>
    </div>
  );
}
