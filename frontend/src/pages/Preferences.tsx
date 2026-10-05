import { FormEvent, useState } from "react";
import { api, errMsg } from "../api/client";
import { Field, PageHeader, Segmented } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { LOCALES, Locale, useI18n } from "../i18n";

export default function Preferences() {
  const { user, updateUser } = useAuth();
  const { t, setLocale, locale } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const zones = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined ?? [user!.timezone];
  const [name, setName] = useState(user!.name);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const save = (patch: Parameters<typeof updateUser>[0]) => updateUser(patch).then(() => toast(t("common.saved"))).catch((e) => toast(errMsg(e), "error"));
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/auth/change-password", { currentPassword: cur, newPassword: next }); toast(t("pf.pw_done")); setCur(""); setNext(""); } catch (err) { toast(errMsg(err), "error"); }
  };
  return (
    <div className="max-w-2xl">
      <PageHeader title={t("pf.title")} lede={t("pf.lede")} />
      <section className="panel p-5 mb-4">
        <Field label={t("pf.name")}><div className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-quiet" disabled={name === user!.name || name.length < 2} onClick={() => save({ name })}>{t("common.save")}</button></div></Field>
        <Field label={t("pf.language")}><select className="input" value={locale} onChange={(e) => { setLocale(e.target.value as Locale); void save({ locale: e.target.value }); }}>{LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></Field>
        <Field label={t("pf.tz")}><select className="input" value={user!.timezone} onChange={(e) => save({ timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</select></Field>
        <Field label={t("pf.theme")}><Segmented label={t("pf.theme")} value={theme.theme} onChange={theme.set} options={[{ id: "light", label: t("pf.light") }, { id: "dark", label: t("pf.dark") }]} /></Field>
      </section>
      <form onSubmit={changePw} className="panel p-5">
        <h2 className="text-[15px] mb-3">{t("pf.pw")}</h2>
        <Field label={t("pf.pw_cur")}><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
        <Field label={t("pf.pw_new")} hint={t("pf.pw_hint")}><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field>
        <button className="btn-primary">{t("pf.pw")}</button>
      </form>
    </div>
  );
}
