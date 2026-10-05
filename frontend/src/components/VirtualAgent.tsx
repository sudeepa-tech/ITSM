import { CheckCheck, MessageCircleQuestion, RotateCcw, SendHorizontal, Ticket as TicketIcon, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { Provider } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useI18n } from "../i18n";
import { AiMark, cx, Spinner } from "./ui";

interface Msg { role: "user" | "assistant"; content: string; sources?: { id: string; title: string }[]; offerTicket?: boolean; provider?: Provider }

/** Self-service chat. Answers are grounded in the knowledge base; when nothing matches it offers a ticket instead of guessing. */
export function VirtualAgent() {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const reset = () => { setMsgs([]); setSession(null); setSolved(false); };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText(""); setMsgs((m) => [...m, { role: "user", content: message }]); setBusy(true);
    try {
      const { data } = await api.post("/virtual-agent/chat", { sessionId: session ?? undefined, message });
      setSession(data.sessionId); setMsgs((m) => [...m, data.message]);
    } catch (err) { toast(errMsg(err), "error"); } finally { setBusy(false); }
  };
  const makeTicket = async () => {
    try {
      const { data } = await api.post(`/virtual-agent/${session}/ticket`, {});
      toast(t("va.ticket_made", { n: data.ticketNumber })); setOpen(false); reset(); nav(`/tickets/${data.id}`);
    } catch (err) { toast(errMsg(err), "error"); }
  };
  const markSolved = async () => { setSolved(true); await api.post(`/virtual-agent/${session}/resolve`, { resolved: true }).catch(() => undefined); };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed z-30 bottom-4 end-4 h-12 ps-4 pe-5 rounded-full bg-solid text-white shadow-pop inline-flex items-center gap-2 font-semibold hover:bg-solid-hover transition-colors">
          <MessageCircleQuestion size={19} />{t("va.open")}
        </button>
      )}
      {open && (
        <section aria-label={t("va.title")} className="fixed z-40 bottom-0 end-0 sm:bottom-4 sm:end-4 w-full sm:w-[392px] h-[min(620px,100dvh)] sm:h-[min(620px,calc(100dvh-2rem))] bg-surface border border-line sm:rounded-xl shadow-pop flex flex-col animate-rise">
          <header className="flex items-center gap-2 ps-4 pe-2 h-14 border-b border-line">
            <div className="flex-1 min-w-0"><h2 className="text-[15px] leading-tight">{t("va.title")}</h2><p className="text-[12px] text-ink3 truncate">{t("va.sub")}</p></div>
            <button className="btn-icon" onClick={reset} aria-label={t("va.new")} title={t("va.new")}><RotateCcw size={16} /></button>
            <button className="btn-icon" onClick={() => setOpen(false)} aria-label={t("common.close")}><X size={18} /></button>
          </header>
          <div className="flex-1 overflow-y-auto scroll-y px-4 py-4 space-y-3" aria-live="polite">
            <div className="bg-sunken rounded-lg rounded-ss-sm px-3 py-2 max-w-[88%]">{t("va.hello", { name: user?.name.split(" ")[0] ?? "" })}</div>
            {msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex justify-end"><div className="bg-solid text-white rounded-lg rounded-se-sm px-3 py-2 max-w-[88%] whitespace-pre-wrap">{m.content}</div></div>
            ) : (
              <div key={i} className="max-w-[92%]">
                <div className={cx("rounded-lg rounded-ss-sm px-3 py-2 whitespace-pre-wrap", m.sources?.length ? "ai-block !rounded-lg" : "bg-sunken")}>{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 ps-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <AiMark provider={m.provider} /><span className="text-ink3">{t("va.sources")}:</span>
                    {m.sources.map((s) => <Link key={s.id} to={`/kb/${s.id}`} className="text-brand font-semibold hover:underline" onClick={() => setOpen(false)}>{s.title}</Link>)}
                  </div>
                )}
                {m.offerTicket && i === msgs.length - 1 && <button className="btn-primary btn-sm mt-2" onClick={makeTicket}><TicketIcon size={15} />{t("va.ticket")}</button>}
                {!m.offerTicket && i === msgs.length - 1 && !solved && <button className="btn-quiet btn-sm mt-2" onClick={markSolved}><CheckCheck size={15} />{t("va.solved")}</button>}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-ink3 text-[13px]"><Spinner />{t("va.thinking")}</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="p-3 border-t border-line flex gap-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("va.ph")} aria-label={t("va.ph")} maxLength={2000} />
            <button className="btn-primary !px-3" disabled={!text.trim() || busy} aria-label={t("common.send")}><SendHorizontal size={17} className="rtl:-scale-x-100" /></button>
          </form>
        </section>
      )}
    </>
  );
}
