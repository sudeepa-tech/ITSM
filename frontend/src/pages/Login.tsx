import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { errMsg } from "../api/client";
import { Logo } from "../components/Logo";
import { Field, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { Key, useI18n } from "../i18n";

const demo: [Key, string, string][] = [["role.ADMIN", "admin@itsm.local", "Admin@123"], ["role.AGENT", "sarah.johnson@itsm.local", "Agent@123"], ["role.END_USER", "user1@itsm.local", "User@123"]];

export default function Login() {
  const { user, login, sessionExpired } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await login(email, password); nav("/"); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen grid lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="hidden lg:flex flex-col justify-between p-12 bg-solid text-white relative overflow-hidden" aria-hidden>
        <div className="flex items-center gap-2.5"><Logo size={30} /><span className="text-[19px] font-semibold tracking-tight">Northbeam</span></div>
        {/* Decorative: the same meter used on every ticket, drawn large. */}
        <div className="max-w-md">
          <p className="text-[34px] leading-[1.15] font-semibold tracking-tight">Every request finds the right person, before the clock does.</p>
          <div className="mt-10 space-y-5">
            {[["78%", "bg-[#2CC48A]"], ["42%", "bg-[#F2B233]"], ["93%", "bg-[#F0704A]"]].map(([w, c], i) => (
              <div key={i} className="h-1.5 rounded-full bg-white/20 overflow-hidden"><div className={`h-full rounded-full ${c}`} style={{ width: w }} /></div>
            ))}
          </div>
        </div>
        <svg className="absolute -bottom-24 -end-24 opacity-[.12]" width="520" height="520" viewBox="0 0 32 32"><path d="M2 30 L30 2 M2 30 L30 18 M2 30 L18 2" stroke="#fff" strokeWidth=".6" fill="none" /></svg>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8"><Logo size={30} /><span className="text-[19px] font-semibold tracking-tight">Northbeam</span></div>
          <h1 className="text-[28px]">{t("auth.title")}</h1>
          <p className="text-ink2 mt-1 mb-7">{t("auth.subtitle")}</p>
          {sessionExpired && <p role="alert" className="mb-4 rounded-md bg-warn-tint text-warn px-3 py-2">{t("auth.session")}</p>}
          <Field label={t("auth.email")} htmlFor="email"><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label={t("auth.password")} htmlFor="pw"><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error && <p role="alert" className="mb-4 text-bad font-medium">{error}</p>}
          <button className="btn-primary w-full h-10" disabled={busy}>{busy ? <><Spinner />{t("auth.submitting")}</> : t("auth.submit")}</button>
          <div className="mt-8 pt-5 border-t border-line">
            <p className="text-ink3 text-[12.5px] mb-2">{t("auth.demo")}</p>
            <div className="flex flex-wrap gap-2">
              {demo.map(([role, e, p]) => <button type="button" key={e} className="btn-quiet btn-sm" onClick={() => { setEmail(e); setPassword(p); }}>{t(role)}</button>)}
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
