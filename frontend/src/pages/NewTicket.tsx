import { CheckCircle2, Paperclip, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { Classification, DeflectResult, Priority } from "../api/types";
import { PriorityChip } from "../components/Badges";
import { AiMark, Field, PageHeader, Spinner, useDebounced } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Key, useI18n } from "../i18n";

interface Analysis { classification: Classification; duplicates: { id: string; ticketNumber: string; subject: string; similarity: number }[]; knownIssue: { count: number } | null }
const MAX_MB = 10;

export default function NewTicket() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const staff = user!.role !== "END_USER";
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [deflect, setDeflect] = useState<DeflectResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const [pri, setPri] = useState<Priority | "">("");
  const seq = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const dSubject = useDebounced(subject, 900), dDesc = useDebounced(description, 900);

  // Look for instant answers and duplicates while the person types (debounced, stale replies ignored).
  useEffect(() => {
    if (dSubject.trim().length < 5 || (dSubject + dDesc).trim().length < 15) { setDeflect(null); setAnalysis(null); return; }
    const my = ++seq.current; setChecking(true); setDismissed(false);
    const body = { subject: dSubject.trim(), description: (dDesc.trim() || dSubject).trim() };
    Promise.allSettled([api.post("/ai/deflect", body), api.post("/ai/analyze-ticket", body)]).then(([d, a]) => {
      if (my !== seq.current) return;
      if (d.status === "fulfilled") setDeflect(d.value.data);
      if (a.status === "fulfilled") { setAnalysis(a.value.data); setCat((c) => c || ""); }
    }).finally(() => my === seq.current && setChecking(false));
  }, [dSubject, dDesc]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => f.size <= MAX_MB * 1048576);
    if (ok.length < list.length) toast(t("nt.attach_hint", { mb: MAX_MB }), "error");
    setFiles((f) => [...f, ...ok].slice(0, 5));
  };

  const solved = async () => {
    if (deflect?.eventId) await api.post(`/ai/deflect/${deflect.eventId}/outcome`, { outcome: "SOLVED" }).catch(() => undefined);
    toast(t("nt.solved_thanks")); nav("/tickets");
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/tickets", { subject: subject.trim(), description: description.trim() || subject.trim(), deflectionEventId: deflect?.eventId ?? undefined, ...(staff && cat ? { category: cat } : {}), ...(staff && pri ? { priority: pri } : {}) });
      if (files.length) {
        const fd = new FormData(); files.forEach((f) => fd.append("files", f));
        await api.post(`/tickets/${data.id}/attachments`, fd).catch((e) => toast(errMsg(e), "error"));
      }
      toast(t("nt.created", { n: data.ticketNumber })); nav(`/tickets/${data.id}`);
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  const valid = subject.trim().length >= 3;
  const c = analysis?.classification;
  const showAnswers = deflect && deflect.articles.length > 0 && !dismissed;

  return (
    <div>
      <PageHeader title={t("nt.title")} lede={t("nt.lede")} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <div className="panel p-5">
          <Field label={t("nt.subject")} htmlFor="subject"><input id="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("nt.subject_ph")} maxLength={200} autoFocus /></Field>
          <Field label={t("nt.desc")} htmlFor="desc"><textarea id="desc" className="input min-h-[170px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("nt.desc_ph")} maxLength={10000} /></Field>
          <Field label={t("nt.attach")} hint={t("nt.attach_hint", { mb: MAX_MB })}>
            <input ref={file} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt,.log,.csv" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-quiet btn-sm" onClick={() => file.current?.click()}><Paperclip size={15} />{t("nt.add_files")}</button>
              {files.map((f, i) => <span key={i} className="chip bg-sunken text-ink2 ring-1 ring-inset ring-line !h-7">{f.name}<button aria-label={t("common.delete")} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={13} /></button></span>)}
            </div>
          </Field>
          {staff && (
            <div className="grid sm:grid-cols-2 gap-3 mb-2">
              <Field label={t("nt.override")}><input className="input" value={cat} onChange={(e) => setCat(e.target.value)} placeholder={c?.category} /></Field>
              <Field label={t("nt.pri_override")}><select className="input" value={pri} onChange={(e) => setPri(e.target.value as Priority)}><option value="">{c ? t(`pri.${c.priority}` as Key) : "—"}</option>{["P1", "P2", "P3", "P4"].map((p) => <option key={p} value={p}>{t(`pri.${p}` as Key)}</option>)}</select></Field>
            </div>
          )}
          {error && <p role="alert" className="text-bad font-medium mb-3">{error}</p>}
          <button className="btn-primary h-10" disabled={!valid || busy} onClick={submit}>{busy ? <><Spinner />{t("nt.submitting")}</> : t("nt.submit")}</button>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20" aria-live="polite">
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-2"><h2 className="text-[15px]">{t("nt.side.title")}</h2>{checking && <span className="flex items-center gap-1.5 text-ink3 text-[12.5px]"><Spinner size={13} />{t("nt.checking")}</span>}</div>
            {!deflect && !analysis && !checking && <p className="text-ink2">{t("nt.side.idle")}</p>}
            {analysis?.knownIssue && <p className="rounded-md bg-warn-tint text-warn px-3 py-2 mb-3 flex gap-2"><Users size={16} className="mt-0.5 shrink-0" />{t("nt.known", { n: analysis.knownIssue.count })}</p>}
            {analysis && analysis.duplicates.length > 0 && (
              <div className="rounded-md bg-tint px-3 py-2 mb-3"><p className="font-semibold text-brand mb-1">{t("nt.dupe")}</p>{analysis.duplicates.map((d) => <Link key={d.id} to={`/tickets/${d.id}`} className="block hover:underline"><span className="tnum font-semibold">{d.ticketNumber}</span> {d.subject}</Link>)}</div>
            )}
            {showAnswers && (
              <div>
                <h3 className="text-[13.5px] mb-2 text-ink2">{t("nt.answers")}</h3>
                {deflect.answer && <div className="ai-block mb-2 whitespace-pre-wrap">{deflect.answer}<div className="mt-1.5"><AiMark provider={deflect.provider} /></div></div>}
                <ul className="space-y-1.5 mb-3">{deflect.articles.slice(0, 3).map((a) => <li key={a.id}><Link to={`/kb/${a.id}`} target="_blank" className="font-semibold text-brand hover:underline">{a.title}</Link>{!deflect.answer && <p className="text-ink2 text-[13px] line-clamp-2">{a.excerpt}</p>}</li>)}</ul>
                <div className="flex gap-2"><button className="btn-primary btn-sm" onClick={solved}><CheckCircle2 size={15} />{t("nt.solved")}</button><button className="btn-quiet btn-sm" onClick={() => setDismissed(true)}>{t("nt.not_solved")}</button></div>
              </div>
            )}
            {deflect && deflect.articles.length === 0 && !checking && <p className="text-ink3">{t("nt.no_answers")}</p>}
          </div>
          {c && (
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3"><h2 className="text-[15px]">{t("nt.reading")}</h2><AiMark provider={c.provider} /></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
                <dt className="text-ink3">{t("f.category")}</dt><dd className="font-semibold">{c.category}</dd>
                <dt className="text-ink3">{t("f.type")}</dt><dd className="font-semibold">{t(`type.${c.type}` as Key)}</dd>
                <dt className="text-ink3">{t("f.priority")}</dt><dd><PriorityChip p={c.priority} /></dd>
                <dt className="text-ink3">{t("f.language")}</dt><dd className="font-semibold uppercase">{c.language}</dd>
                <dt className="text-ink3">{t("f.confidence")}</dt><dd className="font-semibold tnum">{Math.round(c.confidence)}%</dd>
              </dl>
              {!staff && <p className="text-ink3 text-[12.5px] mt-3">{t("nt.priority_note")}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
