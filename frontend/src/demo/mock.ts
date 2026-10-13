/* In-browser mock of the Northbeam API for the hosted demo. Real NLP (BM25, language, sentiment, similarity) is reused from the backend. */
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { BM25Index, analyzeSentiment, detectLanguage, summarizeExtractive, textSimilarity, tokenize } from "../../../backend/src/services/ai/nlp";
import { ISSUES, KB } from "./seedData";
import { api } from "../api/client";
import { generatePassword, MAX_IMPORT_ROWS, passwordProblem, summarize, validateRows } from "../../../backend/src/services/userImport";
import { buildTemplate, buildUsersWorkbook, readSheet } from "../../../backend/src/services/userSheet";

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
let uid = 1; const nid = (p: string) => `${p}${uid++}`;
const iso = (t: number) => new Date(t).toISOString();

const CATS: Record<string, { skills: string[]; team: string; sub: string; kw: string[]; req?: boolean }> = {
  Network: { skills: ["VPN", "Networking"], team: "Network Support", sub: "VPN", kw: ["vpn", "wifi", "network", "réseau", "netzwerk"] },
  Identity: { skills: ["Active Directory", "Security"], team: "Identity & Access", sub: "Authentication", kw: ["mfa", "password", "login", "locked", "account", "contraseña", "mot de passe", "passwort"] },
  Collaboration: { skills: ["Microsoft 365", "Email"], team: "Workplace IT", sub: "Email", kw: ["email", "outlook", "mailbox", "teams", "calendar", "correo"] },
  Hardware: { skills: ["Hardware", "Printer"], team: "Workplace IT", sub: "Peripherals", kw: ["printer", "print", "laptop", "monitor", "keyboard", "impresora", "imprimante", "drucker"] },
  Infrastructure: { skills: ["Azure", "Database"], team: "Cloud & Infra", sub: "Cloud", kw: ["azure", "aws", "server", "database", "cloud", "vm"] },
  Software: { skills: ["Software", "Application Support"], team: "Application Support", sub: "Application", kw: ["install", "software", "application", "license", "crash", "sap"] },
  Security: { skills: ["Security"], team: "Identity & Access", sub: "Incident", kw: ["phishing", "malware", "virus", "ransomware", "suspicious", "hacked"] },
  Access: { skills: ["Active Directory", "Security"], team: "Identity & Access", sub: "Permissions", kw: ["access to", "permission", "grant", "shared drive"], req: true },
};
const URGENT = ["down", "urgent", "production", "outage", "critical", "locked", "crash", "everyone", "all users"];
const has = (t: string, k: string) => new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${k.length <= 4 ? "s?(?![\\p{L}\\p{N}])" : ""}`, "u").test(t);
function classify(text: string) {
  const t = text.toLowerCase(); let best = "Network", hits = -1;
  for (const [c, d] of Object.entries(CATS)) { const h = d.kw.filter((k) => has(t, k)).length; if (h > hits) { hits = h; best = c; } }
  const u = URGENT.filter((k) => has(t, k)).length; const d = CATS[best];
  const type = d.req ? "SERVICE_REQUEST" : "INCIDENT";
  const priority = u >= 2 ? "P1" : u === 1 ? "P2" : type === "SERVICE_REQUEST" ? "P4" : "P3";
  const { lang } = detectLanguage(text);
  return { category: best, subcategory: d.sub, service: d.team, type, priority, requiredSkills: d.skills, rootCause: `Likely ${d.sub.toLowerCase()} issue based on the reported symptoms.`, confidence: hits <= 0 ? 35 : Math.min(94, 52 + hits * 12 + u * 4), language: lang, sentiment: analyzeSentiment(text, lang).score, provider: "rules" };
}
const SLA_MINS: Record<string, [number, number]> = { P1: [15, 240], P2: [30, 480], P3: [120, 1440], P4: [480, 4320] };
const slaStatus = (start: number, due: number, now = Date.now()) => (now >= due ? "BREACHED" : (due - now) / (due - start) < 0.2 ? "AT_RISK" : (due - now) / (due - start) < 0.5 ? "WARNING" : "HEALTHY");

// ------------------------------------------------------------------ data
const now0 = Date.now();
const users: any[] = [
  { id: "u-admin", name: "Marcus Lee", email: "admin@itsm.local", pw: "Admin@123", role: "ADMIN", department: "IT", locale: "en", timezone: "Europe/London", active: true },
];
const TEAMS = ["Network Support", "Identity & Access", "Workplace IT", "Cloud & Infra", "Application Support"];
const AGENT_NAMES = ["Sarah Johnson", "David Chen", "Anita Rao", "Tom Becker", "Lena Fischer", "Marcus Kim", "Priya Nair", "Wei Zhang"];
const SKILLSETS = [["VPN", "Networking", "Security"], ["Active Directory", "Security"], ["Windows", "Hardware", "Printer", "Email"], ["Azure", "AWS", "Database"], ["Software", "Application Support", "Microsoft 365"]];
const employees: any[] = [];
AGENT_NAMES.forEach((n, i) => {
  const u = { id: `u-a${i}`, name: n, email: `${n.toLowerCase().replace(" ", ".")}@itsm.local`, pw: "Agent@123", role: "AGENT", department: "IT", locale: "en", timezone: pick(["Europe/London", "Asia/Kolkata", "America/New_York"]), active: true };
  users.push(u);
  const team = TEAMS[i % 5]; const sk = SKILLSETS[i % 5];
  employees.push({ id: `e${i}`, userId: u.id, name: n, email: u.email, active: true, team, location: pick(["London", "Bengaluru", "New York", "Berlin"]), timezone: u.timezone, available: i !== 6, capacity: 10, shiftStartMin: 540, shiftEndMin: 1080, avgResolutionHrs: 3, skills: sk.map((s) => ({ name: s, level: 60 + Math.floor(rnd() * 40) })) });
});
const LOC = ["en", "es", "fr", "de", "hi", "ar", "ja", "pt"];
const ENAMES = ["Alex Novak", "Maya Silva", "Carlos Tanaka", "Yuki Haddad", "Fatima Kowalski", "Liam Patel", "Sofia Rossi", "Ravi Nguyen"];
ENAMES.forEach((n, i) => users.push({ id: `u-e${i}`, name: n, email: `user${i + 1}@itsm.local`, pw: "User@123", role: "END_USER", department: pick(["Finance", "HR", "Sales", "Engineering"]), locale: i === 0 ? "en" : LOC[i % 8], timezone: "UTC", active: true }));
const userById = (id: string) => users.find((u) => u.id === id);
const empByUser = (id: string) => employees.find((e) => e.userId === id);

const kb: any[] = KB.map(([title, category, keywords, body], i) => ({ id: `kb${i + 1}`, title, category, keywords, body, language: /Olvid/.test(title) ? "es" : /Imprimante/.test(title) ? "fr" : /Verbindung/.test(title) ? "de" : "en", status: "PUBLISHED", views: 40 + Math.floor(rnd() * 300), helpful: 10 + Math.floor(rnd() * 40), notHelpful: Math.floor(rnd() * 6), updatedAt: iso(now0 - rnd() * 20 * DAY) }));
let kbIndex: BM25Index | null = null; const kbIdx = () => (kbIndex ??= new BM25Index(kb.filter((a) => a.status === "PUBLISHED")));
const excerpt = (body: string, q: string) => { const qs = new Set(tokenize(q)); const ss: string[] = body.match(/[^.!?]+[.!?]?/g) ?? [body]; let bi = 0, b = -1; ss.forEach((s, i) => { const sc = tokenize(s).filter((t) => qs.has(t)).length; if (sc > b) { b = sc; bi = i; } }); return (ss[bi] + (ss[bi + 1] ?? "")).trim().slice(0, 320); };
const searchKb = (q: string, n = 5) => kbIdx().search(q, n).map((h) => { const a = kb.find((x) => x.id === h.id)!; return { ...h, article: a, excerpt: excerpt(a.body, q) }; });

const tickets: any[] = [];
const notifications: any[] = []; const aiLog: any[] = []; const audit: any[] = []; const deflections: any[] = []; const vaSessions: any[] = [];
let seq = 10001;
const rules: any[] = [
  { id: "r1", name: "P1 not accepted within 10 minutes", enabled: true, actionType: "ESCALATE", conditions: { priority: ["P1"], olderThanMins: 10 }, _count: { executions: 2 } },
  { id: "r2", name: "SLA breached: notify admins", enabled: true, actionType: "NOTIFY_ADMINS", conditions: { slaStatus: ["BREACHED"] }, _count: { executions: 7 } },
  { id: "r3", name: "Unassigned for 15 minutes: re-route with AI", enabled: true, actionType: "AI_REASSIGN", conditions: { unassignedForMins: 15 }, _count: { executions: 0 } },
];
const hooks: any[] = [{ id: "h1", name: "#it-oncall", kind: "SLACK", url: "https://hooks.slack.com/services/T000/B000/XXXX", events: ["ticket.escalated", "sla.breached", "incident.cluster"], enabled: true, failureCount: 0, lastStatus: 200, lastDeliveryAt: iso(now0 - 3 * HOUR), secret: null }];
const policies: any[] = Object.entries(SLA_MINS).map(([priority, [r, s]]) => ({ priority, responseMins: r, resolutionMins: s, businessHoursOnly: priority === "P3" || priority === "P4" }));
const settings: any = { calendar: { enabled: true, timezone: "UTC", workDays: [1, 2, 3, 4, 5], startMin: 540, endMin: 1080, holidays: [] }, assignmentWeights: { skillMatch: 0.35, categoryExpertise: 0.2, workload: 0.15, availability: 0.1, avgResolution: 0.1, locationShift: 0.05, slaRisk: 0.05 }, ai: { minConfidenceForAutoAssign: 55, deflectionMinCoverage: 0.3, duplicateThreshold: 0.6, clusterMinTickets: 4, clusterWindowMins: 60 } };

const logAi = (feature: string, userId?: string) => aiLog.unshift({ id: nid("ai"), feature, provider: "rules", success: true, fallback: false, latencyMs: 4 + Math.floor(rnd() * 30), inputTokens: null, outputTokens: null, error: null, createdAt: iso(Date.now()), userId });
const logAudit = (actor: string, action: string, entity: string) => audit.unshift({ id: nid("au"), actor, action, entity, entityId: null, ip: "203.0.113.7", createdAt: iso(Date.now()) });
const open = (t: any) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status);
const openLoad = (eid: string) => tickets.filter((t) => t.assigneeId === eid && open(t)).length;

function route(category: string, skills: string[]) {
  const cands = employees.filter((e) => e.available).map((e) => {
    const skillMatch = Math.round(skills.reduce((a, s) => a + (e.skills.find((x: any) => x.name === s)?.level ?? 0), 0) / Math.max(1, skills.length));
    const workloadScore = Math.max(0, 100 - openLoad(e.id) * 10), categoryExpertise = e.team === CATS[category]?.team ? 80 : 20;
    const composite = Math.round(skillMatch * 0.35 + categoryExpertise * 0.2 + workloadScore * 0.15 + 100 * 0.1 + 70 * 0.1 + 100 * 0.05 + 100 * 0.05);
    return { employeeId: e.id, name: e.name, team: e.team, skillMatch, categoryExpertise, workloadScore, availabilityScore: 100, resolutionScore: 70, shiftScore: 100, slaRiskScore: 100, composite };
  }).sort((a, b) => b.composite - a.composite);
  return { winner: cands[0] ?? null, runnerUp: cands[1] ?? null };
}

function makeTicket(o: { subject: string; description: string; requesterId: string; createdAt?: number; channel?: string; forcePriority?: string; status?: string; resolved?: boolean; major?: boolean }) {
  const ai = classify(`${o.subject}\n${o.description}`);
  const priority = o.forcePriority ?? ai.priority; const created = o.createdAt ?? Date.now();
  const [rm, sm] = SLA_MINS[priority]; const triage = ai.confidence < settings.ai.minConfidenceForAutoAssign;
  const r = route(ai.category, ai.requiredSkills); const assign = r.winner && !triage ? r.winner : null;
  const due = created + sm * MIN; const id = nid("t");
  const status = o.status ?? (assign ? "ASSIGNED" : "NEW");
  const resolvedAt = o.resolved ? created + Math.min(sm * MIN * (0.3 + rnd() * 1.1), now0 - created - 5 * MIN) : null;
  const t: any = {
    id, ticketNumber: `INC-${seq++}`, subject: o.subject, description: o.description, type: ai.type, channel: o.channel ?? "WEB", language: ai.language, sentiment: ai.sentiment, requesterId: o.requesterId,
    assigneeId: assign?.employeeId ?? null, category: { id: "c-" + ai.category, name: ai.category, subcategory: ai.subcategory }, priority, impact: "Medium", urgency: "Medium", status: o.resolved ? "RESOLVED" : status,
    tags: [], needsTriage: triage || !r.winner, isMajor: !!o.major, reopenCount: 0, aiSummary: null, aiSummaryAt: null, aiSummaryProvider: null, resolutionNotes: o.resolved ? "Root cause identified and fixed; requester confirmed the service works again." : null, duplicateOf: null,
    firstResponseAt: o.resolved ? iso(created + 20 * MIN) : null, csatScore: o.resolved && rnd() < 0.6 ? 4 + Math.round(rnd()) : null, csatComment: null, createdAt: iso(created), updatedAt: iso(resolvedAt ?? created), resolvedAt: resolvedAt ? iso(resolvedAt) : null,
    slaInstance: { status: resolvedAt ? (resolvedAt > due ? "BREACHED" : "HEALTHY") : slaStatus(created, due), startedAt: iso(created), responseDue: iso(created + rm * MIN), resolutionDue: iso(due), pausedAt: null, responseMetAt: o.resolved ? iso(created + 20 * MIN) : null, businessHoursOnly: false },
    aiAnalysis: { category: ai.category, subcategory: ai.subcategory, priority: ai.priority, type: ai.type, confidence: ai.confidence, provider: "rules", language: ai.language, sentiment: ai.sentiment, rootCause: ai.rootCause, requiredSkills: ai.requiredSkills, similarTickets: [], assignmentReason: r.winner ? { winner: r.winner, runnerUp: r.runnerUp, autoAssigned: !!assign, minConfidence: settings.ai.minConfidenceForAutoAssign } : { note: "No eligible employee found" } },
    comments: [], history: [{ id: nid("h"), event: "Ticket created", newValue: `via ${o.channel ?? "WEB"}`, actor: "system", createdAt: iso(created) }, { id: nid("h"), event: "AI classification completed", newValue: `${ai.category}/${ai.subcategory} · ${ai.type} · ${ai.priority} (${Math.round(ai.confidence)}% confidence, rules)`, actor: "system", createdAt: iso(created) }, ...(assign ? [{ id: nid("h"), event: "Auto-assigned by AI", newValue: `${assign.name} (${assign.composite}% match)`, actor: "system", createdAt: iso(created) }] : [])],
    attachments: [],
  };
  if (o.resolved) t.comments.push({ id: nid("c"), body: "Thanks for reporting this. I've applied a fix, please confirm it works on your side.", internal: false, aiAssisted: false, createdAt: iso(created + 20 * MIN), author: { name: employees.find((e) => e.id === t.assigneeId)?.name ?? "Agent", role: "AGENT" } });
  tickets.unshift(t); return t;
}
// seed history
for (let i = 0; i < 42; i++) {
  const tpl = pick(ISSUES); const age = Math.pow(rnd(), 1.3) * 28 * DAY + 4 * HOUR; const resolved = age > 2 * DAY ? rnd() < 0.85 : rnd() < 0.2;
  makeTicket({ subject: tpl.s, description: tpl.d, requesterId: pick(users.filter((u) => u.role === "END_USER")).id, createdAt: now0 - age, resolved, channel: pick(["WEB", "WEB", "EMAIL", "VIRTUAL_AGENT"]), forcePriority: tpl.pri });
}
["VPN authentication failure", "Cannot connect to VPN gateway", "VPN says authentication failed", "VPN login fails since a few minutes", "VPN gateway rejects my login"].forEach((s, i) =>
  makeTicket({ subject: s, description: "VPN authentication failed suddenly, the client cannot connect to the VPN gateway. Several colleagues have the same problem.", requesterId: `u-e${i}`, createdAt: now0 - (32 - i * 6) * MIN, forcePriority: "P2", major: true }));
tickets.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

// ------------------------------------------------------------- views
const rowOf = (t: any, staff: boolean) => ({
  id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, priority: t.priority, status: t.status, type: t.type, channel: t.channel, language: t.language, createdAt: t.createdAt, updatedAt: t.updatedAt, isMajor: t.isMajor,
  ...(staff ? { sentiment: t.sentiment, needsTriage: t.needsTriage } : {}), requester: { name: userById(t.requesterId).name }, category: t.category ? { name: t.category.name } : null, assignee: assigneeOf(t), slaInstance: t.slaInstance,
});
const assigneeOf = (t: any) => { const e = employees.find((x) => x.id === t.assigneeId); return e ? { id: e.id, team: e.team, user: { name: e.name, email: e.email } } : null; };
const fullOf = (t: any, staff: boolean) => {
  const r = userById(t.requesterId); const base = { ...t, requester: { id: r.id, name: r.name, email: r.email, locale: r.locale, department: r.department }, assignee: assigneeOf(t) };
  return staff ? base : { ...base, aiAnalysis: null, aiSummary: null, aiSummaryProvider: null, sentiment: null, needsTriage: false, comments: t.comments.filter((c: any) => !c.internal), history: t.history.filter((h: any) => !/^(AI |Auto-assigned|Internal|Manually reassigned|Rule|Marked)/.test(h.event)) };
};
const addHist = (t: any, event: string, actor: string, oldValue?: string, newValue?: string) => t.history.push({ id: nid("h"), event, oldValue, newValue, actor, createdAt: iso(Date.now()) });
const notify = (userId: string | null, message: string, link?: string) => notifications.unshift({ id: nid("n"), userId, type: "info", message, link: link ?? null, read: false, createdAt: iso(Date.now()) });
const clusters = () => { const recent = tickets.filter((t) => open(t) && Date.now() - +new Date(t.createdAt) < 60 * MIN); const groups: any[][] = []; recent.forEach((t) => { const g = groups.find((g) => g.some((x) => textSimilarity(x.subject + " " + x.description, t.subject + " " + t.description) >= 0.35)); g ? g.push(t) : groups.push([t]); });
  return groups.filter((g) => g.length >= settings.ai.clusterMinTickets).map((g) => ({ categoryName: g[0].category.name, count: g.length, ticketIds: g.map((x) => x.id), ticketNumbers: g.map((x) => x.ticketNumber), sampleSubject: g[0].subject, firstAt: g[g.length - 1].createdAt, lastAt: g[0].createdAt })); };

const STEPS: Record<string, string[]> = { VPN: ["Verify the user's VPN account status", "Check MFA configuration", "Reset the VPN authentication token", "Validate the VPN client version"], Authentication: ["Verify AD account lock status", "Check recent failed login attempts", "Reset password via self-service portal", "Re-enroll the MFA device"], Email: ["Check mailbox storage quota", "Verify Outlook connection status", "Test webmail access", "Recreate the Outlook profile"], Peripherals: ["Check the device's network/USB connection", "Restart the print spooler service", "Reinstall the driver", "Verify shared device permissions"], Cloud: ["Check VM power/network state", "Review the cloud activity log", "Verify firewall/NSG rules", "Confirm recent deployment changes"], Application: ["Confirm the application version and licence", "Clear the app cache / reinstall", "Check recent updates or patches"], Incident: ["Isolate the affected device", "Preserve logs and screenshots", "Notify the security on-call"], Permissions: ["Confirm manager approval", "Check the role in the access matrix", "Grant least-privilege access"] };

// ------------------------------------------------------------- router
type Ctx = { p: Record<string, string>; q: Record<string, any>; body: any; user: any; staff: boolean; raw: any };
class HttpErr { constructor(public status: number, public error: string, public code?: string) {} }
const need = (c: boolean, s: number, m: string): void => { if (!c) throw new HttpErr(s, m); };
const routes: [string, RegExp, (c: Ctx) => any][] = [];
const on = (m: string, path: string, fn: (c: Ctx) => any) => routes.push([m, new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn]);
const T = (c: Ctx) => { const t = tickets.find((x) => x.id === c.p.id); need(!!t, 404, "Ticket not found"); need(c.staff || t.requesterId === c.user.id, 403, "You do not have access to this ticket"); return t; };
const needStaff = (c: Ctx) => need(c.staff, 403, "Insufficient permissions for this action");
const needAdmin = (c: Ctx) => need(c.user.role === "ADMIN", 403, "Insufficient permissions for this action");
const pub = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, locale: u.locale, timezone: u.timezone });
const page = (items: any[], q: any) => { const p = +q.page || 1, ps = +q.pageSize || 25; return { items: items.slice((p - 1) * ps, p * ps), total: items.length, page: p, pageSize: ps }; };

on("POST", "/auth/login", (c) => { const u = users.find((x) => x.email === String(c.body.email).toLowerCase() && x.pw === c.body.password && x.active); need(!!u, 401, "Invalid email or password"); sessionStorage.setItem("demo_user", u.id); return { accessToken: `demo:${u.id}`, user: pub(u) }; });
on("POST", "/auth/refresh", () => { const u = userById(sessionStorage.getItem("demo_user") ?? ""); need(!!u, 401, "No session"); return { accessToken: `demo:${u.id}`, user: pub(u) }; });
on("POST", "/auth/logout", () => { sessionStorage.removeItem("demo_user"); return null; });
on("PATCH", "/auth/me", (c) => { Object.assign(c.user, c.body); return pub(c.user); });
on("POST", "/auth/change-password", () => null);

on("GET", "/tickets", (c) => {
  const q = c.q; let l = tickets.filter((t) => c.staff || t.requesterId === c.user.id);
  const st = (q.status ?? "").split(",").filter(Boolean); if (st.includes("OPEN")) l = l.filter(open); else if (st.length) l = l.filter((t) => st.includes(t.status));
  if (q.priority) l = l.filter((t) => q.priority.split(",").includes(t.priority));
  if (q.unassigned === "true") l = l.filter((t) => !t.assigneeId); if (q.needsTriage === "true") l = l.filter((t) => t.needsTriage);
  if (q.assignedToMe === "true") { const e = empByUser(c.user.id); l = l.filter((t) => e && t.assigneeId === e.id); }
  if (q.sla) l = l.filter((t) => q.sla.split(",").includes(t.slaInstance.status));
  if (q.q) { const s = String(q.q).toLowerCase(); l = l.filter((t) => `${t.ticketNumber} ${t.subject} ${userById(t.requesterId).name}`.toLowerCase().includes(s)); }
  const dir = q.dir === "asc" ? 1 : -1; const key = q.sort ?? "createdAt";
  l = [...l].sort((a, b) => dir * (key === "sla" ? +new Date(a.slaInstance.resolutionDue) - +new Date(b.slaInstance.resolutionDue) : key === "priority" ? a.priority.localeCompare(b.priority) : key === "sentiment" ? (a.sentiment ?? 0) - (b.sentiment ?? 0) : +new Date(a[key]) - +new Date(b[key])));
  const p = page(l, q); return { ...p, items: p.items.map((t) => rowOf(t, c.staff)) };
});
on("GET", "/tickets/stats", (c) => { needStaff(c); const e = empByUser(c.user.id); const o = tickets.filter(open); return { mine: o.filter((t) => e && t.assigneeId === e.id).length, unassigned: o.filter((t) => !t.assigneeId).length, triage: o.filter((t) => t.needsTriage).length, atRisk: o.filter((t) => t.slaInstance.status === "AT_RISK").length, breached: o.filter((t) => t.slaInstance.status === "BREACHED").length, major: o.filter((t) => t.isMajor).length }; });
on("GET", "/tickets/:id", (c) => fullOf(T(c), c.staff));
on("POST", "/tickets", (c) => {
  if (!c.staff) throw new HttpErr(403, "Employees raise requests through the assistant. Open New ticket and describe the problem in the chat.", "USE_ASSISTANT");
  const b = c.body; need(b.subject?.trim().length >= 3, 400, "Validation failed");
  const t = makeTicket({ subject: b.subject.trim(), description: (b.description ?? b.subject).trim(), requesterId: c.user.id, forcePriority: c.staff ? b.priority : undefined });
  if (c.staff && b.category && CATS[b.category]) t.category = { id: "c-" + b.category, name: b.category, subcategory: CATS[b.category].sub };
  if (b.deflectionEventId) { const d = deflections.find((x) => x.id === b.deflectionEventId); if (d) d.outcome = "TICKET_CREATED"; }
  notify(c.user.id, `${t.ticketNumber} received: ${t.subject}`, `/tickets/${t.id}`); logAi("classify", c.user.id);
  return fullOf(t, c.staff);
});
on("PATCH", "/tickets/:id/status", (c) => {
  const t = T(c); const to = c.body.status; const from = t.status;
  if (!c.staff) need((to === "CLOSED" && from === "RESOLVED") || (to === "REOPENED" && ["RESOLVED", "CLOSED"].includes(from)), 403, "You can only close, reopen or cancel your own tickets");
  const now = Date.now(); t.status = to; t.updatedAt = iso(now);
  if (to === "RESOLVED") { t.resolvedAt = iso(now); if (c.body.resolutionNotes) t.resolutionNotes = c.body.resolutionNotes; t.slaInstance.status = now > +new Date(t.slaInstance.resolutionDue) ? "BREACHED" : "HEALTHY"; }
  if (to === "REOPENED") { t.resolvedAt = null; t.reopenCount++; }
  if (to.startsWith("PENDING")) t.slaInstance.pausedAt = iso(now); else if (t.slaInstance.pausedAt) { const d = now - +new Date(t.slaInstance.pausedAt); t.slaInstance.resolutionDue = iso(+new Date(t.slaInstance.resolutionDue) + d); t.slaInstance.pausedAt = null; }
  if (c.staff && !t.firstResponseAt && ["IN_PROGRESS", "ACCEPTED"].includes(to)) { t.firstResponseAt = iso(now); t.slaInstance.responseMetAt = iso(now); }
  addHist(t, "Status changed", c.user.email, from, to); if (c.staff && to === "RESOLVED") notify(t.requesterId, `${t.ticketNumber} was resolved. Please confirm it works for you`, `/tickets/${t.id}`);
  return fullOf(t, c.staff);
});
on("PATCH", "/tickets/:id", (c) => { needStaff(c); const t = T(c); if (c.body.priority && c.body.priority !== t.priority) { addHist(t, "Priority changed", c.user.email, t.priority, c.body.priority); t.priority = c.body.priority; const st = +new Date(t.slaInstance.startedAt); t.slaInstance.resolutionDue = iso(st + SLA_MINS[t.priority][1] * MIN); t.slaInstance.status = slaStatus(st, +new Date(t.slaInstance.resolutionDue)); } return fullOf(t, true); });
on("POST", "/tickets/:id/comments", (c) => {
  const t = T(c); const internal = c.staff && !!c.body.internal;
  const cm = { id: nid("c"), body: c.body.body, internal, aiAssisted: c.staff && !!c.body.aiAssisted, createdAt: iso(Date.now()), author: { name: c.user.name, role: c.user.role } }; t.comments.push(cm); t.updatedAt = cm.createdAt;
  addHist(t, internal ? "Internal note added" : "Comment added", c.user.email);
  if (c.staff && !internal && !t.firstResponseAt) { t.firstResponseAt = cm.createdAt; t.slaInstance.responseMetAt = cm.createdAt; }
  if (c.staff && !internal) notify(t.requesterId, `New reply on ${t.ticketNumber}`, `/tickets/${t.id}`);
  if (!c.staff && t.status === "PENDING_USER") { t.status = "IN_PROGRESS"; const d = Date.now() - +new Date(t.slaInstance.pausedAt ?? Date.now()); t.slaInstance.resolutionDue = iso(+new Date(t.slaInstance.resolutionDue) + d); t.slaInstance.pausedAt = null; addHist(t, "Status changed", c.user.email, "PENDING_USER", "IN_PROGRESS"); }
  return cm;
});
on("POST", "/tickets/:id/assign", (c) => { needStaff(c); const t = T(c); const e = employees.find((x) => x.id === c.body.employeeId); need(!!e, 404, "Employee not found"); addHist(t, "Manually reassigned", c.user.email, undefined, e.name); t.assigneeId = e.id; t.needsTriage = false; if (["NEW", "REOPENED", "ESCALATED"].includes(t.status)) t.status = "ASSIGNED"; return fullOf(t, true); });
on("POST", "/tickets/:id/auto-assign", (c) => { needStaff(c); const t = T(c); const r = route(t.category.name, t.aiAnalysis?.requiredSkills ?? []); need(!!r.winner, 409, "No eligible agent is available right now"); t.assigneeId = r.winner!.employeeId; t.needsTriage = false; if (["NEW", "REOPENED", "ESCALATED"].includes(t.status)) t.status = "ASSIGNED"; addHist(t, `Auto-assigned by AI (${r.winner!.composite}% match)`, c.user.email, undefined, r.winner!.name); return fullOf(t, true); });
on("POST", "/tickets/:id/escalate", (c) => { needStaff(c); const t = T(c); addHist(t, c.body?.reason ? `Escalated: ${c.body.reason}` : "Escalated", c.user.email, t.status, "ESCALATED"); t.status = "ESCALATED"; return fullOf(t, true); });
on("POST", "/tickets/:id/feedback", (c) => { const t = T(c); need(["RESOLVED", "CLOSED"].includes(t.status), 409, "You can rate a ticket once it is resolved"); t.csatScore = c.body.score; t.csatComment = c.body.comment ?? null; return null; });
on("POST", "/tickets/bulk", (c) => { needStaff(c); let n = 0; c.body.ids.forEach((id: string) => { const t = tickets.find((x) => x.id === id); if (!t) return; if (c.body.action === "priority") t.priority = c.body.value; else if (c.body.action === "status") t.status = c.body.value; else { t.assigneeId = c.body.value; t.needsTriage = false; } n++; }); return { updated: n, failed: [] }; });
on("POST", "/tickets/:id/attachments", (c) => { const t = T(c); const fd: FormData = c.raw; const out: any[] = []; fd.getAll("files").forEach((f: any) => { const a = { id: nid("f"), fileName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size, uploadedAt: iso(Date.now()) }; t.attachments.push(a); out.push(a); }); return out; });
on("GET", "/tickets/:id/attachments/:att", (c) => { T(c); return { __blob: "Demo attachment: files are not stored in the hosted demo." }; });

on("POST", "/ai/analyze-ticket", (c) => { const text = `${c.body.subject}\n${c.body.description}`; logAi("classify", c.user.id); const dups = tickets.filter((t) => open(t) && (c.staff || t.requesterId === c.user.id)).map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, similarity: +textSimilarity(text, `${t.subject} ${t.description}`).toFixed(2) })).filter((d) => d.similarity >= 0.6).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
  const n = tickets.filter((t) => open(t) && Date.now() - +new Date(t.createdAt) < 4 * HOUR && textSimilarity(text, `${t.subject} ${t.description}`) >= 0.35).length; return { classification: classify(text), duplicates: dups, knownIssue: !c.staff && n >= 2 ? { count: n } : null }; });
on("POST", "/ai/deflect", (c) => { const q = `${c.body.subject} ${c.body.description}`; const hits = searchKb(q, 5).filter((h) => h.coverage >= settings.ai.deflectionMinCoverage); if (!hits.length) return { articles: [], answer: null, provider: "rules", eventId: null }; logAi("self_service_answer", c.user.id); const ev = { id: nid("d"), outcome: "SHOWN" }; deflections.push(ev); return { articles: hits.map((h) => ({ id: h.article.id, title: h.article.title, excerpt: h.excerpt, coverage: +h.coverage.toFixed(2) })), answer: hits[0].excerpt, provider: "rules", eventId: ev.id }; });
on("POST", "/ai/deflect/:id/outcome", (c) => { const d = deflections.find((x) => x.id === c.p.id); if (d) d.outcome = c.body.outcome; return null; });
on("POST", "/ai/feedback", () => null);
on("GET", "/ai/clusters", (c) => { needStaff(c); return clusters(); });
on("GET", "/ai/tickets/:id/insights", (c) => { needStaff(c); const t = T(c); logAi("troubleshooting", c.user.id); const q = `${t.subject} ${t.description}`; const found = searchKb(q, 5); const docs = found.filter((d) => d.coverage >= 0.2 && d.score >= (found[0]?.score ?? 0) * 0.4);
  return { steps: STEPS[t.category.subcategory] ?? ["Gather more diagnostic detail from the requester"], stepsProvider: "rules", docs: docs.map((d) => ({ id: d.article.id, title: d.article.title, excerpt: d.excerpt, relevance: d.coverage })), similar: tickets.filter((x) => x.id !== t.id).map((x) => ({ id: x.id, ticketNumber: x.ticketNumber, subject: x.subject, status: x.status, resolutionNotes: x.resolutionNotes, similarity: +textSimilarity(q, `${x.subject} ${x.description}`).toFixed(2) })).filter((x) => x.similarity >= 0.25).sort((a, b) => b.similarity - a.similarity).slice(0, 5) }; });
on("POST", "/ai/tickets/:id/summary", (c) => { needStaff(c); const t = T(c); logAi("summary", c.user.id); const last = [...t.comments].reverse().find((x: any) => !x.internal); t.aiSummary = summarizeExtractive(`${t.subject}. ${t.description}`, 2) + (last ? ` Latest update (${last.author.name}): ${summarizeExtractive(last.body, 1)}` : ""); t.aiSummaryProvider = "rules"; t.aiSummaryAt = iso(Date.now()); return { summary: t.aiSummary, provider: "rules" }; });
on("POST", "/ai/tickets/:id/reply-draft", (c) => { needStaff(c); const t = T(c); logAi("reply_draft", c.user.id); const steps = (STEPS[t.category.subcategory] ?? []).slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join("\n"); const first = userById(t.requesterId).name.split(" ")[0]; const tone = c.body.tone;
  return { draft: tone === "concise" ? `Hi ${first},\n${steps}\nLet me know how it goes.\n${c.user.name.split(" ")[0]}` : `Hi ${first},\n\nThanks for reaching out — I'm looking into this now.\n\nHere is what I suggest we try:\n${steps}\n\nLet me know how it goes and I'll follow up right away.\n\nBest regards\n${c.user.name.split(" ")[0]}`, provider: "rules", language: t.language }; });
on("POST", "/ai/tickets/:id/resolution-notes", (c) => { needStaff(c); const t = T(c); logAi("resolution_notes", c.user.id); const a = t.comments.filter((x: any) => x.author.role !== "END_USER").map((x: any) => x.body).join(" "); return { notes: a ? `Resolved after: ${summarizeExtractive(a, 2)}` : `Resolved: ${summarizeExtractive(t.description, 1)}`, provider: "rules" }; });
on("POST", "/ai/tickets/:id/kb-draft", (c) => { needStaff(c); const t = T(c); logAi("kb_draft", c.user.id); return { title: t.subject, keywords: [t.category.name], body: `Symptoms\n${t.description}\n\nResolution\n${t.resolutionNotes ?? "Describe the fix here."}`, provider: "rules", sourceTicketId: t.id }; });
on("POST", "/ai/translate", () => { throw new HttpErr(503, "Translation needs a live AI provider. Set ANTHROPIC_API_KEY to enable it.", "AI_UNAVAILABLE"); });

on("POST", "/virtual-agent/chat", (c) => {
  let s = vaSessions.find((x) => x.id === c.body.sessionId && x.userId === c.user.id);
  need(!c.body.sessionId || !!s, 404, "Conversation not found");
  need(!s?.ticketId, 409, "A ticket was already created from this conversation. Start a new one.");
  if (!s) { s = { id: nid("va"), userId: c.user.id, msgs: [] }; vaSessions.push(s); }
  const turns: string[] = s.msgs.filter((m: any) => m.role === "user").map((m: any) => m.content);
  const q = [...turns.slice(-2), c.body.message].join(" "); const all = [...turns, c.body.message].join("\n");
  s.msgs.push({ role: "user", content: c.body.message });
  const hits = searchKb(q, 4).filter((h) => h.coverage >= settings.ai.deflectionMinCoverage); logAi("self_service_answer", c.user.id);
  const notices: any[] = [];
  if (!s.msgs.some((m: any) => m.notices?.length)) {
    const d = tickets.filter((t) => open(t) && t.requesterId === c.user.id).find((t) => textSimilarity(all, `${t.subject} ${t.description}`) >= 0.6);
    if (d) notices.push({ kind: "duplicate", id: d.id, ticketNumber: d.ticketNumber, subject: d.subject });
    const n = tickets.filter((t) => open(t) && Date.now() - +new Date(t.createdAt) < 4 * HOUR && textSimilarity(all, `${t.subject} ${t.description}`) >= 0.35).length; if (n >= 2) notices.push({ kind: "known", count: n });
  }
  if (hits.length && !s.eventId) { const ev = { id: nid("d"), outcome: "SHOWN" }; deflections.push(ev); s.eventId = ev.id; }
  const articles = hits.slice(0, 3).map((h) => ({ id: h.article.id, title: h.article.title, excerpt: h.excerpt }));
  const msg = hits.length
    ? { role: "assistant", content: hits[0].excerpt, sources: [{ id: hits[0].article.id, title: hits[0].article.title }], articles, notices, offerTicket: false, provider: "rules" }
    : { role: "assistant", content: "I couldn't find a reliable answer in our knowledge base. Add any details you have (error messages, when it started), then I can raise a ticket for you with this conversation attached.", sources: [], articles: [], notices, offerTicket: true, provider: "rules" };
  s.msgs.push(msg); return { sessionId: s.id, message: msg };
});
on("POST", "/virtual-agent/:id/resolve", (c) => { const s = vaSessions.find((x) => x.id === c.p.id && x.userId === c.user.id); need(!!s, 404, "Conversation not found"); const d = deflections.find((x) => x.id === s.eventId); if (d && c.body.resolved) d.outcome = "SOLVED"; return null; });
on("POST", "/virtual-agent/:id/ticket", (c) => {
  const s = vaSessions.find((x) => x.id === c.p.id && x.userId === c.user.id); need(!!s, 404, "Conversation not found"); need(!s.ticketId, 409, "A ticket was already created from this conversation.");
  const mine: string[] = s.msgs.filter((m: any) => m.role === "user").map((m: any) => m.content); need(mine.length > 0, 400, "Describe the problem first.");
  const subj = (mine[0].split(/\n|(?<=[.!?。])\s/)[0] ?? mine[0]).trim().replace(/[.!?。]+$/, "").slice(0, 120);
  const t = makeTicket({ subject: subj.length >= 3 ? subj : "Help request", description: mine.join("\n\n"), requesterId: c.user.id, channel: "VIRTUAL_AGENT" });
  t.comments.push({ id: nid("c"), body: "Assistant conversation before this ticket was raised:\n\n" + s.msgs.map((m: any) => `${m.role === "user" ? "Requester" : "Assistant"}: ${m.content}`).join("\n\n"), internal: true, aiAssisted: true, createdAt: iso(Date.now()), author: { name: c.user.name, role: c.user.role } });
  s.ticketId = t.id; const d = deflections.find((x) => x.id === s.eventId); if (d && d.outcome === "SHOWN") d.outcome = "TICKET_CREATED";
  notify(c.user.id, `${t.ticketNumber} received: ${t.subject}`, `/tickets/${t.id}`);
  return { id: t.id, ticketNumber: t.ticketNumber, team: employees.find((e) => e.id === t.assigneeId)?.team ?? null, category: t.category.name };
});

on("GET", "/kb", (c) => { const q = c.q; if (q.q) { const h = searchKb(q.q, +q.pageSize || 30); return { items: h.map((x) => ({ ...x.article, body: undefined, excerpt: x.excerpt })), total: h.length, page: 1, pageSize: 30 }; }
  const l = kb.filter((a) => (c.staff || a.status === "PUBLISHED") && (!q.category || a.category === q.category)); return page(l.map((a) => ({ ...a, body: undefined })), q); });
on("GET", "/kb/categories", () => { const m: Record<string, number> = {}; kb.filter((a) => a.status === "PUBLISHED").forEach((a) => (m[a.category] = (m[a.category] ?? 0) + 1)); return Object.entries(m).map(([name, count]) => ({ name, count })); });
on("GET", "/kb/:id", (c) => { const a = kb.find((x) => x.id === c.p.id); need(!!a && (a.status === "PUBLISHED" || c.staff), 404, "Article not found"); a.views++; return a; });
on("POST", "/kb", (c) => { needStaff(c); const a = { id: nid("kb"), views: 0, helpful: 0, notHelpful: 0, updatedAt: iso(Date.now()), ...c.body }; kb.unshift(a); kbIndex = null; logAudit(c.user.email, "kb.create", "KnowledgeArticle"); return a; });
on("PUT", "/kb/:id", (c) => { needStaff(c); const a = kb.find((x) => x.id === c.p.id); Object.assign(a, c.body, { updatedAt: iso(Date.now()) }); kbIndex = null; logAudit(c.user.email, "kb.update", "KnowledgeArticle"); return a; });
on("POST", "/kb/:id/feedback", () => null);

on("GET", "/search", (c) => { const s = String(c.q.q).toLowerCase(); return { tickets: tickets.filter((t) => (c.staff || t.requesterId === c.user.id) && `${t.ticketNumber} ${t.subject}`.toLowerCase().includes(s)).slice(0, 6).map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, subject: t.subject })), articles: searchKb(s, 4).map((h) => ({ id: h.article.id, title: h.article.title })) }; });
on("GET", "/notifications", (c) => { const mine = notifications.filter((n) => n.userId === c.user.id || (n.userId === null && c.staff)); return { items: mine.slice(0, 15), total: mine.length, unread: mine.filter((n) => !n.read).length }; });
on("POST", "/notifications/read", (c) => { notifications.forEach((n) => { if (n.userId === c.user.id && (!c.body.ids || c.body.ids.includes(n.id))) n.read = true; }); return null; });
on("GET", "/directory", (c) => { needStaff(c); return employees.map((e) => ({ id: e.id, name: e.name, team: e.team, available: e.available, openTickets: openLoad(e.id) })); });

on("GET", "/admin/analytics", (c) => {
  needAdmin(c); const days = +c.q.days || 30; const since = Date.now() - days * DAY; const inWin = tickets.filter((t) => +new Date(t.createdAt) >= since); const res = tickets.filter((t) => t.resolvedAt && +new Date(t.resolvedAt) >= since);
  const series = Array.from({ length: days }, (_, i) => { const d0 = new Date(Date.now() - (days - 1 - i) * DAY); const k = d0.toISOString().slice(0, 10); return { day: k, created: tickets.filter((t) => t.createdAt.slice(0, 10) === k).length, resolved: tickets.filter((t) => t.resolvedAt?.slice(0, 10) === k).length }; });
  const mttr = ["P1", "P2", "P3", "P4"].map((p) => { const r = res.filter((t) => t.priority === p); return { priority: p, n: r.length, hrs: r.length ? +(r.reduce((a, t) => a + (+new Date(t.resolvedAt) - +new Date(t.createdAt)), 0) / r.length / HOUR).toFixed(1) : 0 }; }).filter((m) => m.n);
  const cat: Record<string, number> = {}; inWin.forEach((t) => (cat[t.category.name] = (cat[t.category.name] ?? 0) + 1)); const met = res.filter((t) => t.slaInstance.status !== "BREACHED").length; const rated = tickets.filter((t) => t.csatScore);
  const sol = deflections.filter((d) => d.outcome === "SOLVED").length, tk = deflections.filter((d) => d.outcome === "TICKET_CREATED").length;
  return { days, kpis: { created: inWin.length, resolved: res.length, openNow: tickets.filter(open).length, unassigned: tickets.filter((t) => open(t) && !t.assigneeId).length, triage: tickets.filter((t) => open(t) && t.needsTriage).length, slaCompliance: res.length ? +((met / res.length) * 100).toFixed(1) : null, avgFirstResponseMins: 42, reopenRate: 3.1, csat: rated.length ? +(rated.reduce((a, t) => a + t.csatScore, 0) / rated.length).toFixed(2) : null, csatResponses: rated.length, negativeShare: +((inWin.filter((t) => t.sentiment < -0.2).length / Math.max(1, inWin.length)) * 100).toFixed(1) },
    series, mttr, byCategory: Object.entries(cat).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8), byPriority: {}, byStatus: {}, byChannel: {},
    ai: { autoTriageRate: +((inWin.filter((t) => !t.needsTriage).length / Math.max(1, inWin.length)) * 100).toFixed(1), categoryOverrideRate: 4.4, reassignRate: 6.2, feedbackApproval: 88, deflectionRate: sol + tk ? +((sol / (sol + tk)) * 100).toFixed(1) : 68, virtualAgent: { sessions: vaSessions.length + 12, resolved: 9, ticketed: 3 }, calls: aiLog.length, fallbackRate: 100 }, clusters: clusters() };
});
on("GET", "/admin/ai-interactions", (c) => { needAdmin(c); return page(aiLog, c.q); });
on("GET", "/admin/audit", (c) => { needAdmin(c); const s = String(c.q.q ?? "").toLowerCase(); return page(audit.filter((a) => !s || `${a.action} ${a.actor} ${a.entity}`.toLowerCase().includes(s)), c.q); });
on("GET", "/admin/employees", (c) => { needAdmin(c); return employees.map((e) => ({ ...e, openTickets: openLoad(e.id), workDays: [1, 2, 3, 4, 5] })); });
on("PATCH", "/admin/employees/:id", (c) => { needAdmin(c); Object.assign(employees.find((e) => e.id === c.p.id), c.body); logAudit(c.user.email, "employee.update", "Employee"); return {}; });
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const userFilter = (q: any) => users.filter((u) => (!q.role || u.role === q.role) && (!q.q || `${u.name} ${u.email}`.toLowerCase().includes(String(q.q).toLowerCase())));
const ensureEmp = (u: any, team?: string, location?: string) => {
  if (u.role === "END_USER") return; let e = empByUser(u.id);
  if (!e) { e = { id: nid("e"), userId: u.id, name: u.name, email: u.email, active: true, team: team || "Service Desk", location: location ?? null, timezone: u.timezone, available: true, capacity: 10, shiftStartMin: 540, shiftEndMin: 1080, avgResolutionHrs: 3, skills: [] }; employees.push(e); }
  else { if (team) e.team = team; if (location) e.location = location; e.name = u.name; e.email = u.email; }
};
on("GET", "/admin/users/export", async (c) => { needAdmin(c); const l = userFilter(c.q);
  const bytes = await buildUsersWorkbook(l.map((u) => ({ name: u.name, email: u.email, role: u.role, department: u.department, team: empByUser(u.id)?.team, location: empByUser(u.id)?.location, locale: u.locale, timezone: u.timezone, active: u.active, lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null })));
  logAudit(c.user.email, "user.export", "User"); return { __blob: bytes, __type: XLSX_MIME }; });
on("GET", "/admin/users/template", async (c) => { needAdmin(c); return { __blob: await buildTemplate(), __type: XLSX_MIME }; });
on("POST", "/admin/users/import", async (c) => {
  needAdmin(c); const f = (c.raw as FormData).get("file") as File | null; need(!!f, 400, "Choose an .xlsx or .csv file to import");
  const dry = (c.raw as FormData).get("dryRun") !== "false"; const upd = (c.raw as FormData).get("updateExisting") === "true";
  if (f!.size > 2 * 1024 * 1024) throw new HttpErr(413, "File is too large");
  let parsed; try { parsed = await readSheet(new Uint8Array(await f!.arrayBuffer()), f!.name); } catch (e) { throw new HttpErr(400, (e as Error).message); }
  need(parsed.rows.length > 0, 400, "No data rows found under the header row"); need(parsed.rows.length <= MAX_IMPORT_ROWS, 400, `This file has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
  const existing = new Set(users.map((u) => u.email));
  const res = validateRows(parsed.rows, { existing, updateExisting: upd, selfEmail: c.user.email.toLowerCase() });
  const pubRows = () => res.map(({ parsed: _p, ...r }) => r);
  if (dry) return { dryRun: true, summary: summarize(res), rows: pubRows(), ignoredColumns: parsed.unknownHeaders };
  const credentials: any[] = [];
  for (const r of res) { const p = r.parsed; if (!p) continue;
    if (r.action === "create") { const pw = p.password ?? generatePassword(); const u = { id: nid("u"), name: p.name, email: r.email, pw, role: p.role ?? "END_USER", department: p.department ?? null, locale: p.locale ?? "en", timezone: p.timezone ?? "UTC", active: p.active ?? true }; users.push(u); ensureEmp(u, p.team, p.location); if (!p.password) credentials.push({ email: r.email, name: p.name, password: pw }); }
    else if (r.action === "update") { const u = users.find((x) => x.email === r.email)!; for (const k of ["name", "role", "department", "locale", "timezone", "active"] as const) if (p[k] !== undefined) (u as any)[k] = p[k]; ensureEmp(u, p.team, p.location); } }
  logAudit(c.user.email, "user.import", "User"); return { dryRun: false, summary: summarize(res), rows: pubRows(), credentials, ignoredColumns: parsed.unknownHeaders };
});
on("POST", "/admin/users/:id/password", (c) => { needAdmin(c); const u = userById(c.p.id); need(!!u, 404, "User not found"); const b = c.body; need(!!b.password !== !!b.generate, 400, "Validation failed");
  if (b.password) { const pr = passwordProblem(b.password); need(!pr, 400, pr!); } const pw = b.password ?? generatePassword(); u.pw = pw; logAudit(c.user.email, "user.password_reset", "User"); return { ok: true, ...(b.password ? {} : { generatedPassword: pw }) }; });
on("GET", "/admin/users", (c) => { needAdmin(c); return page(userFilter(c.q).sort((a, b) => a.name.localeCompare(b.name)).map((u) => { u.lastLoginAt ??= iso(now0 - rnd() * 5 * DAY); const e = empByUser(u.id); return { ...pub(u), active: u.active, lastLoginAt: u.lastLoginAt, employee: e ? { team: e.team, location: e.location } : null }; }), c.q); });
on("POST", "/admin/users", (c) => { needAdmin(c); const b = c.body; need(b.name?.trim().length >= 2 && /\S+@\S+\.\S+/.test(b.email ?? ""), 400, "Validation failed");
  const email = b.email.trim().toLowerCase(); need(!users.some((u) => u.email === email), 409, "A record with these values already exists");
  if (b.password) { const pr = passwordProblem(b.password); need(!pr, 400, pr!); } const gen = b.password ? undefined : generatePassword();
  const u: any = { id: nid("u"), name: b.name.trim(), email, pw: b.password ?? gen, role: b.role, department: b.department ?? null, locale: b.locale ?? "en", timezone: b.timezone ?? "UTC", active: b.active ?? true };
  users.push(u); ensureEmp(u, b.team, b.location); logAudit(c.user.email, "user.create", "User"); return { id: u.id, ...(gen ? { generatedPassword: gen } : {}) }; });
on("PATCH", "/admin/users/:id", (c) => { needAdmin(c); const u = userById(c.p.id); need(!!u, 404, "User not found"); const b = c.body;
  need(!(u.id === c.user.id && (b.active === false || (b.role && b.role !== "ADMIN"))), 400, "You cannot demote or deactivate your own account");
  if (b.email) { const e = String(b.email).trim().toLowerCase(); need(!users.some((x) => x.id !== u.id && x.email === e), 409, "A record with these values already exists"); u.email = e; }
  for (const k of ["name", "department", "locale", "role", "active"]) if (b[k] !== undefined) u[k] = b[k];
  ensureEmp(u, b.team); logAudit(c.user.email, "user.update", "User"); return { id: u.id }; });
on("GET", "/admin/sla-policies", (c) => { needAdmin(c); return policies; });
on("PUT", "/admin/sla-policies/:priority", (c) => { needAdmin(c); need(c.body.resolutionMins >= c.body.responseMins, 400, "Resolution target must be at least the response target"); Object.assign(policies.find((p) => p.priority === c.p.priority), c.body); logAudit(c.user.email, "sla.update", "SLAPolicy"); return c.body; });
on("GET", "/admin/settings", (c) => { needAdmin(c); return settings; });
on("PUT", "/admin/settings/:key", (c) => { needAdmin(c); settings[c.p.key] = c.body; logAudit(c.user.email, `settings.${c.p.key}`, "AppSetting"); return c.body; });
on("GET", "/admin/rules", (c) => { needAdmin(c); return rules; });
on("POST", "/admin/rules", (c) => { needAdmin(c); const r = { id: nid("r"), enabled: true, _count: { executions: 0 }, ...c.body }; rules.push(r); logAudit(c.user.email, "rule.create", "EscalationRule"); return r; });
on("PATCH", "/admin/rules/:id", (c) => { needAdmin(c); Object.assign(rules.find((r) => r.id === c.p.id), c.body); return {}; });
on("DELETE", "/admin/rules/:id", (c) => { needAdmin(c); rules.splice(rules.findIndex((r) => r.id === c.p.id), 1); return null; });
on("GET", "/admin/webhooks", (c) => { needAdmin(c); return hooks; });
on("POST", "/admin/webhooks", (c) => { needAdmin(c); need(/^https:\/\//.test(c.body.url) && !/(169\.254|127\.|10\.|192\.168\.|localhost)/.test(c.body.url), 400, "Webhook URL resolves to a private or reserved address"); const h = { id: nid("h"), failureCount: 0, lastStatus: null, lastDeliveryAt: null, ...c.body, secret: c.body.secret ? "••••••••" : null }; hooks.push(h); return h; });
on("PATCH", "/admin/webhooks/:id", (c) => { needAdmin(c); Object.assign(hooks.find((h) => h.id === c.p.id), c.body); return {}; });
on("DELETE", "/admin/webhooks/:id", (c) => { needAdmin(c); hooks.splice(hooks.findIndex((h) => h.id === c.p.id), 1); return null; });
on("POST", "/admin/webhooks/:id/test", () => ({ status: 200 }));

// ------------------------------------------------------------- adapter
export function installMockApi() {
  (window as any).__DEMO__ = true;
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
    const url = (config.url ?? "").replace(/^\/?api/, "").split("?")[0]; const method = (config.method ?? "get").toUpperCase();
    const auth = String(config.headers?.Authorization ?? ""); const user = auth.startsWith("Bearer demo:") ? userById(auth.slice(12)) : undefined;
    const fail = (status: number, error: string, code?: string) => Promise.reject(new AxiosError(error, String(status), config, null, { status, statusText: "", data: { error, code }, headers: {}, config } as AxiosResponse));
    const isBlob = config.responseType === "blob";
    for (const [m, re, fn] of routes) {
      if (m !== method) continue; const hit = re.exec(url); if (!hit) continue;
      if (!user && !url.startsWith("/auth/login") && !url.startsWith("/auth/refresh") && !url.startsWith("/auth/logout")) return fail(401, "Missing or malformed Authorization header", "TOKEN_EXPIRED");
      let body: any = config.data; const raw = body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      try {
        const out = await fn({ p: hit.groups ?? {}, q: config.params ?? {}, body: body ?? {}, user, staff: user?.role !== "END_USER", raw });
        if (out && out.__blob !== undefined) return { data: isBlob ? new Blob([out.__blob], { type: out.__type ?? "application/octet-stream" }) : out, status: 200, statusText: "OK", headers: {}, config };
        return { data: out === null ? "" : JSON.parse(JSON.stringify(out ?? {})), status: out === null ? 204 : method === "POST" && /^\/(tickets|kb|admin\/(users|rules|webhooks))$/.test(url) ? 201 : 200, statusText: "OK", headers: {}, config };
      } catch (e) { if (e instanceof HttpErr) return fail(e.status, e.error, e.code); console.error(e); return fail(500, "Demo error: " + (e as Error).message); }
    }
    return fail(404, "Not found");
  };
  axios.defaults.adapter = adapter; // used by refreshSession (global axios)
  api.defaults.adapter = adapter; // used by the app's axios instance (created before this runs)
}
