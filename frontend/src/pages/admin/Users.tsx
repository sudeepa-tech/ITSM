import { Check, Copy, Download, Eye, EyeOff, FileSpreadsheet, KeyRound, Pencil, Plus, Upload, Wand2 } from "lucide-react";
import { ReactNode, useRef, useState } from "react";
import { api, errMsg } from "../../api/client";
import { Page } from "../../api/types";
import { useApi } from "../../api/useApi";
import { Avatar, cx, Field, Modal, PageHeader, Pager, Segmented, Skeleton, Spinner, useDebounced } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { Key, LOCALES, useI18n } from "../../i18n";
import { Table, Toggle, useSave } from "./Admin";

interface U { id: string; name: string; email: string; role: "END_USER" | "AGENT" | "ADMIN"; active: boolean; department: string | null; locale: string; lastLoginAt: string | null; employee: { team: string; location: string | null } | null }
type Cred = { name: string; email: string; password: string };
interface ImportRow { row: number; email: string; name: string; role: string; action: "create" | "update" | "skip" | "error"; errors: string[]; notes: string[] }
interface ImportResult { dryRun: boolean; summary: { total: number; create: number; update: number; skip: number; error: number }; rows: ImportRow[]; credentials?: Cred[]; ignoredColumns: string[] }

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no look-alikes (I l 1 O 0)
function genPassword(n = 12) {
  const limit = Math.floor(2 ** 32 / ALPHA.length) * ALPHA.length;
  for (;;) {
    let out = ""; const buf = crypto.getRandomValues(new Uint32Array(n * 3));
    for (const x of buf) if (x < limit && out.length < n) out += ALPHA[x % ALPHA.length];
    if (out.length === n && /[A-Za-z]/.test(out) && /\d/.test(out)) return out;
  }
}
function saveBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
const credentialsCsv = (c: Cred[]) => "\uFEFF" + ["Name,Email,Temporary password", ...c.map((x) => [x.name, x.email, x.password].map(csvCell).join(","))].join("\r\n");
const ROLES: [U["role"], Key][] = [["END_USER", "role.END_USER"], ["AGENT", "role.AGENT"], ["ADMIN", "role.ADMIN"]];

function PasswordInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input id={id} className="input pe-10 font-mono" type={show ? "text" : "password"} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="absolute top-1/2 -translate-y-1/2 end-2 text-ink3 hover:text-ink" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
      <button type="button" className="btn-quiet" onClick={() => { onChange(genPassword()); setShow(true); }}><Wand2 size={15} />Generate</button>
    </div>
  );
}

/** Shows a password exactly once, with copy. */
function SecretBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-ok/40 bg-ok-tint/50 p-4">
      <p className="text-[12.5px] font-semibold text-ink2 mb-1.5">{label}</p>
      <div className="flex items-center gap-2"><code className="flex-1 font-mono text-[17px] tracking-wide select-all break-all">{value}</code>
        <button className="btn-quiet btn-sm" onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button></div>
      <p className="text-ink2 text-[12.5px] mt-2">Share it securely. It is not stored in readable form and cannot be shown again.</p>
    </div>
  );
}

export function Users() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const save = useSave();
  const [q, setQ] = useState(""); const [role, setRole] = useState(""); const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const list = useApi<Page<U>>("/admin/users", { q: dq || undefined, role: role || undefined, page, pageSize: 20 });
  const [modal, setModal] = useState<null | "add" | "import" | { edit: U } | { reset: U }>(null);
  const [exporting, setExporting] = useState(false);
  const close = () => setModal(null);
  const patch = (id: string, b: object) => save(() => api.patch(`/admin/users/${id}`, b)).then(() => list.reload());

  const download = async (url: string, params: object, name: string) => {
    try { const r = await api.get(url, { params, responseType: "blob" }); saveBlob(r.data, name); } catch (e) { toast(errMsg(e), "error"); }
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const doExport = async () => { setExporting(true); await download("/admin/users/export", { q: dq || undefined, role: role || undefined }, `users-${stamp}.xlsx`); setExporting(false); };

  return (
    <div>
      <PageHeader title={t("nav.users")} lede="Add employees, agents and admins, set their passwords, and move whole lists in and out with Excel."
        actions={<>
          <button className="btn-quiet" onClick={doExport} disabled={exporting}>{exporting ? <Spinner /> : <Download size={16} />}Export Excel</button>
          <button className="btn-quiet" onClick={() => setModal("import")}><Upload size={16} />Import</button>
          <button className="btn-primary" onClick={() => setModal("add")}><Plus size={16} />Add user</button>
        </>} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input className="input max-w-xs" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search users" />
        <select className="input w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Filter by role"><option value="">All roles</option>{ROLES.map(([r, k]) => <option key={r} value={r}>{t(k)}</option>)}</select>
        {list.data && <span className="self-center text-ink3 tnum">{fmt.number(list.data.total)}</span>}
      </div>
      <Table head={["User", "Role", "Team", "Language", "Last sign-in", "Active", ""]}>
        {list.data?.items.map((u) => (
          <tr key={u.id}>
            <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={u.name} /><span className="min-w-0"><span className="font-semibold block leading-tight truncate">{u.name}</span><span className="text-ink3 text-[12.5px]">{u.email}</span></span></span></td>
            <td className="px-4"><select className="input !h-8 w-auto" value={u.role} aria-label={`Role for ${u.name}`} onChange={(e) => patch(u.id, { role: e.target.value })}>{ROLES.map(([r, k]) => <option key={r} value={r}>{t(k)}</option>)}</select></td>
            <td className="px-4 text-ink2">{u.employee?.team ?? "—"}</td><td className="px-4 text-ink2 uppercase">{u.locale}</td>
            <td className="px-4 text-ink2">{u.lastLoginAt ? fmt.relative(u.lastLoginAt) : "—"}</td>
            <td className="px-4"><Toggle on={u.active} label={`Active: ${u.name}`} onChange={(v) => patch(u.id, { active: v })} /></td>
            <td className="px-4 whitespace-nowrap text-end">
              <button className="btn-icon" aria-label={`Edit ${u.name}`} title="Edit" onClick={() => setModal({ edit: u })}><Pencil size={16} /></button>
              <button className="btn-icon" aria-label={`Reset password for ${u.name}`} title="Reset password" onClick={() => setModal({ reset: u })}><KeyRound size={16} /></button>
            </td>
          </tr>))}
      </Table>
      {list.loading && !list.data && <Skeleton className="h-20 mt-3" />}
      {list.data && <div className="panel mt-3"><Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} /></div>}

      {modal === "add" && <AddUser onClose={close} onDone={() => list.reload()} />}
      {modal === "import" && <ImportDialog onClose={close} onDone={() => list.reload()} download={download} />}
      {modal && typeof modal === "object" && "edit" in modal && <EditUser u={modal.edit} onClose={close} onDone={() => list.reload()} />}
      {modal && typeof modal === "object" && "reset" in modal && <ResetPassword u={modal.reset} onClose={close} />}
    </div>
  );
}

function RoleTeamFields({ role, setRole, team, setTeam }: { role: U["role"]; setRole: (r: U["role"]) => void; team: string; setTeam: (t: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Role"><select className="input" value={role} onChange={(e) => setRole(e.target.value as U["role"])}>{ROLES.map(([r, k]) => <option key={r} value={r}>{t(k)}</option>)}</select></Field>
      <Field label="Team" hint={role === "END_USER" ? "Agents and admins only" : undefined}><input className="input" value={team} disabled={role === "END_USER"} onChange={(e) => setTeam(e.target.value)} placeholder="Service Desk" /></Field>
    </div>
  );
}
const LangSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>;

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const save = useSave();
  const [f, setF] = useState({ name: "", email: "", role: "END_USER" as U["role"], team: "", department: "", locale: "en", password: "" });
  const [made, setMade] = useState<{ name: string; email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = f.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && (!f.password || f.password.length >= 8);
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/users", { name: f.name.trim(), email: f.email.trim(), role: f.role, locale: f.locale, ...(f.team && f.role !== "END_USER" ? { team: f.team } : {}), ...(f.department ? { department: f.department } : {}), ...(f.password ? { password: f.password } : {}) });
      onDone();
      if (data.generatedPassword) setMade({ name: f.name, email: f.email, password: data.generatedPassword }); else { await save(async () => undefined, "User created"); onClose(); }
    } catch (e) { await save(async () => { throw e; }); } finally { setBusy(false); }
  };
  if (made) return (
    <Modal open onClose={onClose} title="User created" footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <p className="mb-3"><b>{made.name}</b> can now sign in with <b>{made.email}</b>.</p>
      <SecretBox label="Temporary password" value={made.password} />
    </Modal>
  );
  return (
    <Modal open onClose={onClose} title="Add user" footer={<><button className="btn-quiet" onClick={onClose}>{t("common.cancel")}</button><button className="btn-primary" disabled={!valid || busy} onClick={submit}>{busy && <Spinner />}{t("common.add")}</button></>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Work email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <RoleTeamFields role={f.role} setRole={(role) => setF({ ...f, role })} team={f.team} setTeam={(team) => setF({ ...f, team })} />
      <div className="grid grid-cols-2 gap-3"><Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field><Field label="Language"><LangSelect value={f.locale} onChange={(locale) => setF({ ...f, locale })} /></Field></div>
      <Field label="Password" hint="Leave blank to generate a secure one (shown once). Otherwise at least 8 characters with a letter and a number."><PasswordInput value={f.password} onChange={(password) => setF({ ...f, password })} /></Field>
    </Modal>
  );
}

function EditUser({ u, onClose, onDone }: { u: U; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const save = useSave();
  const [f, setF] = useState({ name: u.name, email: u.email, role: u.role, team: u.employee?.team ?? "", department: u.department ?? "", locale: u.locale });
  return (
    <Modal open onClose={onClose} title={`Edit ${u.name}`} footer={<><button className="btn-quiet" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn-primary" disabled={f.name.trim().length < 2} onClick={async () => { if (await save(() => api.patch(`/admin/users/${u.id}`, { name: f.name.trim(), email: f.email.trim(), role: f.role, locale: f.locale, department: f.department || null, ...(f.team && f.role !== "END_USER" ? { team: f.team } : {}) }))) { onDone(); onClose(); } }}>{t("common.save")}</button></>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Work email" hint="Changing the email changes how this person signs in."><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <RoleTeamFields role={f.role} setRole={(role) => setF({ ...f, role })} team={f.team} setTeam={(team) => setF({ ...f, team })} />
      <div className="grid grid-cols-2 gap-3"><Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field><Field label="Language"><LangSelect value={f.locale} onChange={(locale) => setF({ ...f, locale })} /></Field></div>
    </Modal>
  );
}

function ResetPassword({ u, onClose }: { u: U; onClose: () => void }) {
  const { t } = useI18n(); const save = useSave();
  const [mode, setMode] = useState<"generate" | "choose">("generate");
  const [pw, setPw] = useState(""); const [result, setResult] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ok = mode === "generate" || (pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw));
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/users/${u.id}/password`, mode === "generate" ? { generate: true } : { password: pw });
      if (data.generatedPassword) setResult(data.generatedPassword); else { await save(async () => undefined, "Password updated"); onClose(); }
    } catch (e) { await save(async () => { throw e; }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Reset password for ${u.name}`} footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <><button className="btn-quiet" onClick={onClose}>{t("common.cancel")}</button><button className="btn-primary" disabled={!ok || busy} onClick={submit}>{busy && <Spinner />}Reset password</button></>}>
      {result ? <><p className="mb-3">New password for <b>{u.email}</b>:</p><SecretBox label="Temporary password" value={result} /></> : <>
        <p className="text-ink2 mb-4">This signs {u.name.split(" ")[0]} out on every device and clears any lockout.</p>
        <Segmented label="Password source" value={mode} onChange={setMode} options={[{ id: "generate", label: "Generate for me" }, { id: "choose", label: "I'll choose one" }]} />
        {mode === "choose" && <div className="mt-4"><Field label="New password" hint="At least 8 characters with a letter and a number."><PasswordInput value={pw} onChange={setPw} /></Field></div>}
      </>}
    </Modal>
  );
}

const CHIP: Record<ImportRow["action"], [string, string]> = { create: ["New", "bg-ok-tint text-ok"], update: ["Update", "bg-tint text-brand"], skip: ["Skipped", "bg-sunken text-ink3 ring-1 ring-inset ring-line"], error: ["Error", "bg-bad-tint text-bad"] };
function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) { return <div className="px-4 py-2.5"><div className={cx("text-[22px] font-semibold leading-none tnum", tone)}>{n}</div><div className="text-ink2 text-[12.5px] mt-1">{label}</div></div>; }

function ImportDialog({ onClose, onDone, download }: { onClose: () => void; onDone: () => void; download: (url: string, params: object, name: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [update, setUpdate] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const run = async (dry: boolean) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("dryRun", String(dry)); fd.append("updateExisting", String(update));
      const { data } = await api.post<ImportResult>("/admin/users/import", fd); setRes(data); if (!dry) onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const s = res?.summary; const todo = (s?.create ?? 0) + (s?.update ?? 0);
  let footer: ReactNode;
  if (res && !res.dryRun) footer = <button className="btn-primary" onClick={onClose}>Done</button>;
  else if (res) footer = <><button className="btn-quiet" onClick={() => setRes(null)}>Back</button><button className="btn-primary" disabled={!todo || busy} onClick={() => run(false)}>{busy && <Spinner />}Import {todo} {todo === 1 ? "user" : "users"}</button></>;
  else footer = <><button className="btn-quiet" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!file || busy} onClick={() => run(true)}>{busy && <Spinner />}Check file</button></>;

  return (
    <Modal open onClose={onClose} wide title={res ? (res.dryRun ? "Review before importing" : "Import finished") : "Import users from Excel"} footer={footer}>
      {!res && <>
        <p className="text-ink2 mb-3">Upload an <b>.xlsx</b> or <b>.csv</b> with one person per row (up to 200). You see a preview before anything is saved. Re-importing an exported file updates people in bulk.</p>
        <button className="btn-quiet btn-sm mb-4" onClick={() => download("/admin/users/template", {}, "users-import-template.xlsx")}><FileSpreadsheet size={15} />Download template</button>
        <input ref={input} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(""); e.target.value = ""; }} />
        <button className={cx("w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors", file ? "border-brand bg-tint/40" : "border-line hover:border-ink3")} onClick={() => input.current?.click()}>
          <Upload size={22} className="mx-auto text-ink3 mb-1.5" /><span className="font-semibold block">{file ? file.name : "Choose a file"}</span><span className="text-ink3 text-[12.5px]">{file ? `${(file.size / 1024).toFixed(0)} KB. Click to choose a different file` : "Excel (.xlsx) or CSV, up to 2 MB"}</span>
        </button>
        <label className="flex items-start gap-2 mt-4"><input type="checkbox" className="mt-1" checked={update} onChange={(e) => setUpdate(e.target.checked)} /><span><b>Update existing users</b><span className="block text-ink3 text-[12.5px]">Matched by email. Blank cells keep the current value. Passwords are never changed by an import.</span></span></label>
        {err && <p role="alert" className="text-bad font-medium mt-3">{err}</p>}
      </>}
      {res && s && <>
        <div className="panel grid grid-cols-4 divide-x divide-line rtl:divide-x-reverse mb-3 overflow-hidden"><Stat n={s.create} label={res.dryRun ? "New users" : "Created"} tone="text-ok" /><Stat n={s.update} label={res.dryRun ? "Updates" : "Updated"} tone="text-brand" /><Stat n={s.skip} label="Skipped" /><Stat n={s.error} label="With errors" tone={s.error ? "text-bad" : ""} /></div>
        {!res.dryRun && res.credentials && res.credentials.length > 0 && (
          <div className="rounded-lg border border-ok/40 bg-ok-tint/50 p-3.5 mb-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]"><p className="font-semibold">{res.credentials.length} generated {res.credentials.length === 1 ? "password" : "passwords"}</p><p className="text-ink2 text-[12.5px]">Shown once. Download the list now and share each password securely.</p></div>
            <button className="btn-primary btn-sm" onClick={() => saveBlob(new Blob([credentialsCsv(res.credentials!)], { type: "text/csv;charset=utf-8" }), `temporary-passwords-${new Date().toISOString().slice(0, 10)}.csv`)}><Download size={15} />Download CSV</button>
          </div>)}
        {res.ignoredColumns.length > 0 && <p className="text-ink3 text-[12.5px] mb-2">Ignored columns: {res.ignoredColumns.join(", ")}</p>}
        <div className="panel overflow-auto max-h-[44vh] scroll-y"><table className="w-full text-[13px]"><thead className="sticky top-0 bg-sunken text-ink3 text-[12px]"><tr><th className="text-start font-semibold px-3 py-2 w-12">Row</th><th className="text-start font-semibold px-3">Person</th><th className="text-start font-semibold px-3">Role</th><th className="text-start font-semibold px-3">Result</th></tr></thead>
          <tbody>{res.rows.slice(0, 200).map((r) => (
            <tr key={r.row} className="border-t border-line align-top"><td className="px-3 py-2 tnum text-ink3">{r.row}</td>
              <td className="px-3 py-2"><span className="font-semibold block">{r.name || "—"}</span><span className="text-ink3">{r.email || "—"}</span></td>
              <td className="px-3 py-2 text-ink2">{r.role ? ROLE_LABEL[r.role] ?? r.role : "—"}</td>
              <td className="px-3 py-2"><span className={cx("chip", CHIP[r.action][1])}>{CHIP[r.action][0]}</span>{r.errors.map((e, i) => <span key={i} className="block text-bad text-[12.5px] mt-1">{e}</span>)}{r.notes.map((e, i) => <span key={i} className="block text-ink3 text-[12.5px] mt-1">{e}</span>)}</td></tr>))}</tbody></table></div>
        {res.dryRun && todo === 0 && <p className="text-warn font-medium mt-3">Nothing to import yet. Fix the errors in your file and check it again.</p>}
        {res.dryRun && s.error > 0 && todo > 0 && <p className="text-ink2 mt-3">Rows with errors are skipped. The valid rows will be imported.</p>}
      </>}
    </Modal>
  );
}
const ROLE_LABEL: Record<string, string> = { END_USER: "Employee", AGENT: "Agent", ADMIN: "Admin" };
