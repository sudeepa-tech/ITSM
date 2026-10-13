/**
 * Pure (no I/O) validation for bulk user import, shared by the API and the browser demo.
 * Header names are forgiving (aliases, any case); values are cleaned of control characters.
 */
export type RoleName = "END_USER" | "AGENT" | "ADMIN";
export const LOCALE_CODES = ["en", "es", "fr", "de", "pt", "hi", "ar", "ja"];
export const MAX_IMPORT_ROWS = 200;

export const FIELDS = ["name", "email", "role", "department", "team", "location", "locale", "timezone", "active", "password"] as const;
export type Field = (typeof FIELDS)[number];

const ALIASES: Record<Field, string[]> = {
  name: ["name", "fullname", "employeename", "displayname"],
  email: ["email", "emailaddress", "workemail", "mail"],
  role: ["role", "type", "accounttype"],
  department: ["department", "dept"],
  team: ["team", "group"],
  location: ["location", "office", "city"],
  locale: ["language", "locale", "lang"],
  timezone: ["timezone", "tz"],
  active: ["active", "status", "enabled"],
  password: ["password", "initialpassword", "temporarypassword"],
};

export function canonicalHeader(h: string): Field | null {
  const k = h.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return FIELDS.find((f) => ALIASES[f].includes(k)) ?? null;
}

const LOCALE_NAMES: Record<string, string> = { english: "en", spanish: "es", español: "es", espanol: "es", french: "fr", français: "fr", francais: "fr", german: "de", deutsch: "de", portuguese: "pt", português: "pt", portugues: "pt", hindi: "hi", हिन्दी: "hi", arabic: "ar", العربية: "ar", japanese: "ja", 日本語: "ja" };

export interface SheetRow { row: number; cells: Partial<Record<Field, string>>; hasFormula?: boolean }
export type Action = "create" | "update" | "skip" | "error";
export interface ParsedRow { name?: string; role?: RoleName; department?: string; team?: string; location?: string; locale?: string; timezone?: string; active?: boolean; password?: string }
export interface RowResult { row: number; email: string; name: string; role: string; action: Action; errors: string[]; notes: string[]; parsed?: ParsedRow }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE = ["yes", "y", "true", "1", "active", "enabled"];
const FALSE = ["no", "n", "false", "0", "inactive", "disabled", "deactivated"];

/** Strips control characters and the apostrophe the exporter adds to text that looks like a formula. */
export function clean(v: string | undefined): string {
  let s = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s;
}

export function parseRole(v: string): RoleName | null {
  const k = v.toLowerCase().replace(/[^a-z]/g, "");
  if (["enduser", "employee", "user", "requester"].includes(k)) return "END_USER";
  if (["agent", "technician", "staff"].includes(k)) return "AGENT";
  if (["admin", "administrator"].includes(k)) return "ADMIN";
  return null;
}
export const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Password must be at least 8 characters";
  if (p.length > 128) return "Password is too long";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password needs a letter and a number";
  return null;
}

export function validateRows(rows: SheetRow[], o: { existing: Set<string>; updateExisting: boolean; selfEmail?: string }): RowResult[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const c = r.cells;
    const errors: string[] = [], notes: string[] = [];
    const email = clean(c.email).toLowerCase();
    const name = clean(c.name);
    if (r.hasFormula) errors.push("Cells with formulas are not allowed");
    if (!email) errors.push("Email is missing");
    else if (!EMAIL_RE.test(email) || email.length > 254) errors.push("Email is not valid");
    else if (seen.has(email)) errors.push(`Duplicate email in file (first on row ${seen.get(email)})`);
    else seen.set(email, r.row);

    const p: ParsedRow = {};
    if (name) { if (name.length < 2 || name.length > 80) errors.push("Name must be 2 to 80 characters"); else p.name = name; }
    const roleRaw = clean(c.role);
    if (roleRaw) { const role = parseRole(roleRaw); if (role) p.role = role; else errors.push(`Role "${roleRaw}" is not recognised (use Employee, Agent or Admin)`); }
    for (const [f, max] of [["department", 80], ["team", 60], ["location", 60]] as const) {
      const v = clean(c[f]);
      if (v) { if (v.length > max) errors.push(`${f[0].toUpperCase() + f.slice(1)} is longer than ${max} characters`); else p[f] = v; }
    }
    const locRaw = clean(c.locale).toLowerCase();
    if (locRaw) { const code = LOCALE_CODES.includes(locRaw) ? locRaw : LOCALE_NAMES[locRaw]; if (code) p.locale = code; else errors.push(`Language "${locRaw}" is not supported (${LOCALE_CODES.join(", ")})`); }
    const tz = clean(c.timezone);
    if (tz) { if (validTimezone(tz)) p.timezone = tz; else errors.push(`Time zone "${tz}" is not a valid IANA name (e.g. Europe/London)`); }
    const actRaw = clean(c.active).toLowerCase();
    if (actRaw) { if (TRUE.includes(actRaw)) p.active = true; else if (FALSE.includes(actRaw)) p.active = false; else errors.push(`Active must be Yes or No, got "${actRaw}"`); }
    const pw = (c.password ?? "").trim();
    if (pw) { const prob = passwordProblem(pw); if (prob) errors.push(prob); else p.password = pw; }

    const exists = !!email && o.existing.has(email);
    let action: Action = exists ? (o.updateExisting ? "update" : "skip") : "create";
    if (action === "create" && !name && !errors.some((e) => e.startsWith("Name"))) errors.push("Name is missing");
    if (action === "update" && p.password) { notes.push("Password column is ignored for existing users; use Reset password"); delete p.password; }
    if (action === "update" && email === o.selfEmail && (p.role && p.role !== "ADMIN" || p.active === false)) errors.push("You cannot demote or deactivate your own account");
    if (action === "skip") notes.push("Already exists. Tick “Update existing users” to change it");
    if (errors.length) action = "error";
    return { row: r.row, email, name, role: p.role ?? "", action, errors, notes, parsed: action === "create" || action === "update" ? p : undefined };
  });
}

export const summarize = (rs: RowResult[]) => ({ total: rs.length, create: rs.filter((r) => r.action === "create").length, update: rs.filter((r) => r.action === "update").length, skip: rs.filter((r) => r.action === "skip").length, error: rs.filter((r) => r.action === "error").length });

/** Random password without look-alike characters; always contains a letter and a digit. Uses Web Crypto (Node 20+ and browsers). */
export function generatePassword(length = 12): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const limit = Math.floor(0x100000000 / A.length) * A.length;
  for (;;) {
    let out = "";
    while (out.length < length) {
      const [n] = globalThis.crypto.getRandomValues(new Uint32Array(1));
      if (n < limit) out += A[n % A.length];
    }
    if (/[A-Za-z]/.test(out) && /\d/.test(out)) return out;
  }
}
