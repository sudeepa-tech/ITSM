import { Plus, Search, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errMsg } from "../api/client";
import { Article, Page } from "../api/types";
import { useApi } from "../api/useApi";
import { cx, EmptyState, Field, PageHeader, Skeleton, useDebounced } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Key, useI18n } from "../i18n";

export function KnowledgeList() {
  const { user } = useAuth();
  const { t, fmt } = useI18n();
  const staff = user!.role !== "END_USER";
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const dq = useDebounced(q, 300);
  const cats = useApi<{ name: string; count: number }[]>("/kb/categories");
  const list = useApi<Page<Article>>("/kb", { q: dq || undefined, category: cat || undefined, pageSize: 30 });
  return (
    <div>
      <PageHeader title={t("kb.title")} lede={t("kb.lede")} actions={staff ? <Link to="/kb/new" className="btn-primary"><Plus size={16} />{t("kb.new")}</Link> : undefined} />
      <div className="relative max-w-xl mb-4"><Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3.5 text-ink3" aria-hidden /><input className="input !h-11 ps-10 text-[15px]" placeholder={t("kb.search")} aria-label={t("kb.search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="flex flex-wrap gap-2 mb-5">
        {[{ name: "", count: 0 }, ...(cats.data ?? [])].map((c) => <button key={c.name} onClick={() => setCat(c.name)} className={cx("h-8 px-3 rounded-full text-[13px] font-semibold border", cat === c.name ? "bg-solid text-white border-transparent" : "bg-surface border-line text-ink2 hover:text-ink")}>{c.name || t("kb.all")}</button>)}
      </div>
      {list.loading && !list.data && <Skeleton className="h-32" />}
      {list.data?.items.length === 0 && <EmptyState title={t("kb.empty")} />}
      <ul className="grid md:grid-cols-2 gap-3">
        {list.data?.items.map((a) => (
          <li key={a.id}><Link to={`/kb/${a.id}`} className="panel block p-4 h-full hover:border-brand/50 transition-colors">
            <div className="flex items-center gap-2 text-[12.5px] text-ink3 mb-1">{a.category}{a.status !== "PUBLISHED" && <span className="chip bg-warn-tint text-warn">{t(`kb.${a.status.toLowerCase()}` as Key)}</span>}<span className="ms-auto uppercase">{a.language}</span></div>
            <h2 className="text-[15.5px] mb-1" lang={a.language}>{a.title}</h2>
            {a.excerpt && <p className="text-ink2 line-clamp-2">{a.excerpt}</p>}
            <p className="text-ink3 text-[12.5px] mt-2">{t("kb.views", { n: fmt.number(a.views) })} · {t("kb.updated", { t: fmt.relative(a.updatedAt) })}</p>
          </Link></li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeArticle() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, fmt } = useI18n();
  const toast = useToast();
  const a = useApi<Article>(`/kb/${id}`);
  const [voted, setVoted] = useState(false);
  const d = a.data;
  if (a.error) return <p className="text-bad">{a.error}</p>;
  if (!d) return <Skeleton className="h-64" />;
  const vote = (helpful: boolean) => { setVoted(true); api.post(`/kb/${id}/feedback`, { helpful }).catch(() => undefined); };
  return (
    <article className="max-w-3xl">
      <Link to="/kb" className="text-ink2 hover:text-ink">← {t("nav.kb")}</Link>
      <div className="flex items-start justify-between gap-3 mt-3 mb-1"><h1 className="text-[28px] leading-tight" lang={d.language}>{d.title}</h1>{user!.role !== "END_USER" && <Link className="btn-quiet btn-sm shrink-0" to={`/kb/${d.id}/edit`}>{t("common.edit")}</Link>}</div>
      <p className="text-ink3 mb-6">{d.category} · {t("kb.updated", { t: fmt.relative(d.updatedAt) })}</p>
      <div className="whitespace-pre-wrap leading-[1.7] text-[15.5px] max-w-[68ch]" lang={d.language}>{d.body}</div>
      <div className="mt-10 pt-5 border-t border-line flex items-center gap-3"><span className="font-semibold">{voted ? t("kb.thanks") : t("kb.helpful_q")}</span>
        {!voted && <><button className="btn-quiet btn-sm" onClick={() => vote(true)}><ThumbsUp size={15} />{t("common.yes")}</button><button className="btn-quiet btn-sm" onClick={() => { vote(false); toast(t("kb.thanks")); }}><ThumbsDown size={15} />{t("common.no")}</button></>}
        {voted && <Link to="/tickets/new" className="text-brand font-semibold hover:underline ms-2">{t("nav.new")}</Link>}
      </div>
    </article>
  );
}

export function KnowledgeEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const fromTicket = sp.get("ticket");
  const nav = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ title: "", body: "", category: "", keywords: "", status: "DRAFT" as Article["status"], language: "en" });
  const [aiFrom, setAiFrom] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id) api.get<Article>(`/kb/${id}`).then((r) => setF({ title: r.data.title, body: r.data.body ?? "", category: r.data.category ?? "", keywords: r.data.keywords.join(", "), status: r.data.status, language: r.data.language }));
    else if (fromTicket) api.post(`/ai/tickets/${fromTicket}/kb-draft`, {}).then((r) => { setF((x) => ({ ...x, title: r.data.title, body: r.data.body, keywords: r.data.keywords.join(", ") })); setAiFrom(fromTicket); }).catch((e) => toast(errMsg(e), "error"));
  }, [id, fromTicket, toast]);
  const save = async () => {
    setBusy(true);
    const body = { title: f.title, body: f.body, category: f.category || null, language: f.language, status: f.status, keywords: f.keywords.split(",").map((s) => s.trim()).filter(Boolean), sourceTicketId: fromTicket ?? undefined };
    try { const r = id ? await api.put(`/kb/${id}`, body) : await api.post("/kb", body); toast(t("common.saved")); nav(`/kb/${r.data.id}`); } catch (e) { toast(errMsg(e), "error"); setBusy(false); }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title={t(id ? "kb.edit" : "kb.new")} />
      {aiFrom && <p className="ai-block mb-4 flex items-center gap-2"><Sparkles size={15} className="text-ai" />{t("kb.drafted_from", { n: aiFrom.slice(0, 8) })}</p>}
      <div className="panel p-5">
        <Field label={t("kb.f.title")}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={t("kb.f.body")}><textarea className="input min-h-[280px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t("f.category")}><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label={t("f.language")}><input className="input" value={f.language} maxLength={5} onChange={(e) => setF({ ...f, language: e.target.value })} /></Field>
          <Field label={t("kb.f.status")}><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Article["status"] })}>{(["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((s) => <option key={s} value={s}>{t(`kb.${s.toLowerCase()}` as Key)}</option>)}</select></Field>
        </div>
        <Field label={t("kb.f.keywords")}><input className="input" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></Field>
        <button className="btn-primary" disabled={busy || f.title.length < 3 || f.body.length < 10} onClick={save}>{t("common.save")}</button>
      </div>
    </div>
  );
}
