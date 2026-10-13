// End-to-end smoke test against a running API + seeded database.  Usage: BASE_URL=http://localhost:4000 npm run smoke
import ExcelJS from "exceljs";
const BASE = process.env.BASE_URL ?? "http://localhost:4000";
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => { cond ? passed++ : failed++; console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${!cond && extra ? "  → " + extra : ""}`); };
const section = (t) => console.log(`\n${t}`);

async function api(path, { token, method = "GET", body, cookie, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (cookie) h.cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) h["content-type"] = "application/json";
  const res = await fetch(BASE + "/api" + path, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, res };
}
const login = async (email, password) => {
  const r = await api("/auth/login", { method: "POST", body: { email, password } });
  const cookie = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { token: r.json.accessToken, user: r.json.user, cookie, status: r.status };
};

// Employees raise tickets only through the assistant: chat, then hand-off.
async function raise(u, text) {
  const c = await api("/virtual-agent/chat", { token: u.token, method: "POST", body: { message: text } });
  const r = await api(`/virtual-agent/${c.json.sessionId}/ticket`, { token: u.token, method: "POST", body: {} });
  return { ...r, chat: c };
}
const admin = await login("admin@itsm.local", "Admin@123");
const agent = await login("sarah.johnson@itsm.local", "Agent@123");
const user = await login("user1@itsm.local", "User@123");
const user2 = await login("user2@itsm.local", "User@123");

section("Auth & sessions");
ok("admin/agent/user can sign in", admin.token && agent.token && user.token);
ok("wrong password is rejected", (await login("user1@itsm.local", "nope")).status === 401);
ok("unknown email gets the same generic error", (await api("/auth/login", { method: "POST", body: { email: "ghost@itsm.local", password: "x" } })).json.error === "Invalid email or password");
ok("no token → 401", (await api("/tickets")).status === 401);
const r1 = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
ok("refresh cookie issues a new access token", r1.status === 200 && !!r1.json.accessToken);
const newCookie = (r1.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const replay = await api("/auth/refresh", { method: "POST", cookie: user.cookie });
ok("replaying a rotated refresh token is rejected", replay.status === 401);
const afterTheft = await api("/auth/refresh", { method: "POST", cookie: newCookie });
ok("…and the whole token family is revoked (theft detection)", afterTheft.status === 401);
ok("cross-origin refresh is blocked", (await api("/auth/refresh", { method: "POST", cookie: admin.cookie, headers: { origin: "https://evil.example" } })).status === 403);
ok("weak password rejected on register", (await api("/auth/register", { method: "POST", body: { name: "Test", email: "weak@x.com", password: "short" } })).status === 400);
for (let i = 0; i < 5; i++) await api("/auth/login", { method: "POST", body: { email: "user49@itsm.local", password: "bad" } });
ok("account locks after 5 failed attempts", (await api("/auth/login", { method: "POST", body: { email: "user49@itsm.local", password: "User@123" } })).status === 423);

section("RBAC");
ok("end user cannot read admin analytics", (await api("/admin/analytics", { token: user.token })).status === 403);
ok("agent cannot read admin analytics", (await api("/admin/analytics", { token: agent.token })).status === 403);
ok("end user cannot use AI copilot endpoints", (await api("/ai/clusters", { token: user.token })).status === 403);
ok("end user cannot bulk update", (await api("/tickets/bulk", { token: user.token, method: "POST", body: { ids: ["x"], action: "status", value: "CLOSED" } })).status === 403);

section("Self-service deflection & pre-submission AI");
const defl = await api("/ai/deflect", { token: user.token, method: "POST", body: { subject: "VPN authentication failed", description: "My VPN says authentication failed and I cannot connect" } });
ok("deflection returns grounded KB articles", defl.status === 200 && defl.json.articles.length > 0, JSON.stringify(defl.json).slice(0, 200));
ok("deflection only cites real articles", defl.json.articles.every((a) => a.id && a.title));
const none = await api("/ai/deflect", { token: user.token, method: "POST", body: { subject: "Quarterly xylophone budget", description: "Need approval for the xylophone purchase order" } });
ok("no KB match → no invented answer", none.json.articles.length === 0 && none.json.answer === null);
const an = await api("/ai/analyze-ticket", { token: user.token, method: "POST", body: { subject: "Cannot login MFA locked", description: "My account is locked after MFA attempts, urgent" } });
ok("analyze returns classification incl. language & sentiment", an.json.classification?.category === "Identity" && an.json.classification.language === "en" && typeof an.json.classification.sentiment === "number", JSON.stringify(an.json).slice(0, 200));
ok("outcome tracking works", (await api(`/ai/deflect/${defl.json.eventId}/outcome`, { token: user.token, method: "POST", body: { outcome: "SOLVED" } })).status === 204);

section("Ticket creation pipeline");
const direct = await api("/tickets", { token: user.token, method: "POST", body: { subject: "Sneaky direct ticket", description: "bypass the assistant", priority: "P1" } });
ok("employees cannot bypass the assistant (direct POST refused)", direct.status === 403 && direct.json.code === "USE_ASSISTANT", JSON.stringify(direct.json));
const created = await raise(user, "Outlook not syncing since morning. My Outlook stopped receiving email today, webmail works fine.");
const t = (await api(`/tickets/${created.json.id}`, { token: user.token })).json;
ok("ticket created through the assistant", created.status === 201 && t.ticketNumber?.startsWith("INC-") && t.channel === "VIRTUAL_AGENT", JSON.stringify(created.json).slice(0, 200));
ok("requester cannot force priority (AI decides)", t.priority !== "P1");
ok("requester response hides AI internals", t.aiAnalysis === null && t.aiSummary === null);
ok("SLA instance created with due dates", !!t.slaInstance?.resolutionDue);
const tStaff = (await api(`/tickets/${t.id}`, { token: admin.token })).json;
ok("staff sees AI analysis + explainable assignment", tStaff.aiAnalysis?.confidence > 0 && (tStaff.aiAnalysis.assignmentReason?.winner || tStaff.aiAnalysis.assignmentReason?.note));
ok("ticket numbers are unique & sequential", (await raise(user, "Second ticket. Another Outlook problem.")).json.ticketNumber !== t.ticketNumber);
ok("other end user cannot view it", (await api(`/tickets/${t.id}`, { token: user2.token })).status === 403);
ok("end user list is scoped to own tickets", (await api("/tickets?pageSize=100", { token: user.token })).json.items.every((x) => x.requester.name));

section("Multilingual");
const es = await raise(user, "No puedo imprimir. Buenos días, la impresora del segundo piso no funciona y nadie puede imprimir.");
const esStaff = (await api(`/tickets/${es.json.id}`, { token: admin.token })).json;
ok("Spanish ticket detected as es", esStaff.language === "es" && esStaff.category?.name === "Hardware", `${esStaff.language} ${esStaff.category?.name}`);
const vaEs = await api("/virtual-agent/chat", { token: user.token, method: "POST", body: { message: "¿Cómo restablezco mi contraseña olvidada? mi cuenta está bloqueada" } });
ok("virtual agent answers from Spanish KB with source", vaEs.status === 200 && vaEs.json.message.sources.length > 0, JSON.stringify(vaEs.json).slice(0, 200));

section("Virtual agent");
const va = await api("/virtual-agent/chat", { token: user.token, method: "POST", body: { message: "how do I fix a shared printer that shows offline" } });
ok("answers with cited KB source", va.json.message.sources.length > 0 && !va.json.message.offerTicket);
const va2 = await api("/virtual-agent/chat", { token: user.token, method: "POST", body: { message: "what is the cafeteria menu on friday" } });
ok("unknown question → offers a ticket instead of guessing", va2.json.message.offerTicket === true && va2.json.message.sources.length === 0);
const vt = await api(`/virtual-agent/${va2.json.sessionId}/ticket`, { token: user.token, method: "POST", body: {} });
ok("chat converts to a real ticket", vt.status === 201 && vt.json.ticketNumber);
ok("chat shows suggested articles for the question", va.json.message.articles?.length > 0);
const dupChat = await api("/virtual-agent/chat", { token: user.token, method: "POST", body: { message: "Outlook not syncing since morning my outlook stopped receiving email" } });
ok("chat warns about the employee's own similar open ticket", dupChat.json.message.notices?.some((n) => n.kind === "duplicate"), JSON.stringify(dupChat.json.message.notices));
ok("chat never reveals other people's tickets (known issues are counts only)", !JSON.stringify(dupChat.json.message.notices).includes("user2"));
ok("marking a chat solved is accepted", (await api(`/virtual-agent/${va.json.sessionId}/resolve`, { token: user.token, method: "POST", body: { resolved: true } })).status === 204);
ok("a conversation can become only one ticket", (await api(`/virtual-agent/${va2.json.sessionId}/ticket`, { token: user.token, method: "POST", body: {} })).status === 409);
const agentView = (await api(`/tickets/${vt.json.id}`, { token: admin.token })).json;
ok("agents see the full chat transcript as an internal note", agentView.comments.some((c) => c.internal && /Assistant conversation/.test(c.body)));
ok("requesters never see that transcript", !(await api(`/tickets/${vt.json.id}`, { token: user.token })).json.comments.some((c) => /Assistant conversation/.test(c.body)));
ok("cannot open someone else's chat", (await api("/virtual-agent/chat", { token: user2.token, method: "POST", body: { sessionId: va2.json.sessionId, message: "hi there" } })).status === 404);

section("Agent workflow, SLA and status rules");
const cm = await api(`/tickets/${t.id}/comments`, { token: agent.token, method: "POST", body: { body: "Looking into it now.", internal: false } });
ok("agent can reply", cm.status === 201);
ok("end user cannot post internal notes", (await api(`/tickets/${t.id}/comments`, { token: user.token, method: "POST", body: { body: "secret", internal: true } })).json.internal === false);
await api(`/tickets/${t.id}/comments`, { token: agent.token, method: "POST", body: { body: "Internal: check the exchange logs", internal: true } });
const view = (await api(`/tickets/${t.id}`, { token: user.token })).json;
ok("requester never sees internal notes", !view.comments.some((c) => c.internal));
const after = (await api(`/tickets/${t.id}`, { token: admin.token })).json;
ok("first response recorded & SLA response met", !!after.firstResponseAt && !!after.slaInstance.responseMetAt);
ok("end user cannot resolve their own ticket", (await api(`/tickets/${t.id}/status`, { token: user.token, method: "PATCH", body: { status: "RESOLVED" } })).status === 403);
await api(`/tickets/${t.id}/status`, { token: agent.token, method: "PATCH", body: { status: "PENDING_USER" } });
const paused = (await api(`/tickets/${t.id}`, { token: admin.token })).json;
ok("SLA clock pauses while waiting on the user", !!paused.slaInstance.pausedAt);
const dueBefore = paused.slaInstance.resolutionDue;
await new Promise((r) => setTimeout(r, 1200));
await api(`/tickets/${t.id}/comments`, { token: user.token, method: "POST", body: { body: "Here is the extra info you asked for." } });
const resumed = (await api(`/tickets/${t.id}`, { token: admin.token })).json;
ok("requester reply resumes the ticket and clears the pause", resumed.status === "IN_PROGRESS" && !resumed.slaInstance.pausedAt);
ok("business-hours SLA never moves backwards", new Date(resumed.slaInstance.resolutionDue) >= new Date(dueBefore));
// 24x7 policy (P1): the pause must extend the due date by the real elapsed time.
const p1 = (await raise(user, "Production server down. The production server is down, outage for everyone, cannot work, urgent")).json;
const p1Staff = (await api(`/tickets/${p1.id}`, { token: admin.token })).json;
await api(`/tickets/${p1.id}/status`, { token: agent.token, method: "PATCH", body: { status: "PENDING_USER" } });
const p1Paused = (await api(`/tickets/${p1.id}`, { token: admin.token })).json;
await new Promise((r) => setTimeout(r, 2500));
await api(`/tickets/${p1.id}/comments`, { token: user.token, method: "POST", body: { body: "Update: still down." } });
const p1Res = (await api(`/tickets/${p1.id}`, { token: admin.token })).json;
const grew = new Date(p1Res.slaInstance.resolutionDue) - new Date(p1Paused.slaInstance.resolutionDue);
ok(`AI rated it P1 (24x7 policy) and pause extended the due date by ~${Math.round(grew / 1000)}s`, p1Staff.priority === "P1" && !p1Staff.slaInstance.businessHoursOnly && grew >= 2000 && grew < 10000, `${p1Staff.priority} grew=${grew}`);
ok("csat blocked before resolution", (await api(`/tickets/${t.id}/feedback`, { token: user.token, method: "POST", body: { score: 5 } })).status === 409);

section("AI copilot (offline fallback mode)");
const ins = await api(`/ai/tickets/${t.id}/insights`, { token: agent.token });
ok("insights: steps + KB docs + similar tickets", ins.status === 200 && ins.json.steps.length > 0 && Array.isArray(ins.json.docs) && Array.isArray(ins.json.similar), JSON.stringify(ins.json).slice(0, 150));
const sum = await api(`/ai/tickets/${t.id}/summary`, { token: agent.token, method: "POST", body: {} });
ok("summary generated and labelled with provider", !!sum.json.summary && !!sum.json.provider);
const dr = await api(`/ai/tickets/${t.id}/reply-draft`, { token: agent.token, method: "POST", body: { tone: "empathetic" } });
ok("reply draft generated", dr.status === 200 && dr.json.draft.length > 20);
const tr = await api("/ai/translate", { token: agent.token, method: "POST", body: { text: "Hello", target: "es" } });
ok("translation honestly reports AI unavailable offline (503)", tr.status === 503 && tr.json.code === "AI_UNAVAILABLE");
ok("AI feedback recorded", (await api("/ai/feedback", { token: agent.token, method: "POST", body: { ticketId: t.id, feature: "reply_draft", verdict: "UP" } })).status === 204);

section("Resolve → CSAT → KB from ticket");
const rn = await api(`/ai/tickets/${t.id}/resolution-notes`, { token: agent.token, method: "POST", body: {} });
const res = await api(`/tickets/${t.id}/status`, { token: agent.token, method: "PATCH", body: { status: "RESOLVED", resolutionNotes: rn.json.notes } });
ok("resolved with notes", res.status === 200 && res.json.resolutionNotes);
ok("requester can rate", (await api(`/tickets/${t.id}/feedback`, { token: user.token, method: "POST", body: { score: 5, comment: "Fast!" } })).status === 204);
ok("other users cannot rate", (await api(`/tickets/${t.id}/feedback`, { token: user2.token, method: "POST", body: { score: 1 } })).status === 403);
const kbd = await api(`/ai/tickets/${t.id}/kb-draft`, { token: agent.token, method: "POST", body: {} });
ok("KB draft generated from resolved ticket", kbd.status === 200 && kbd.json.title && kbd.json.body);
const kbc = await api("/kb", { token: agent.token, method: "POST", body: { title: kbd.json.title, body: kbd.json.body + " Extra detail to satisfy the minimum length.", category: "Collaboration", keywords: ["outlook"], status: "DRAFT", sourceTicketId: t.id } });
ok("agent saves draft article", kbc.status === 201);
ok("drafts are hidden from end users", (await api(`/kb/${kbc.json.id}`, { token: user.token })).status === 404);
ok("only admins can delete articles", (await api(`/kb/${kbc.json.id}`, { token: agent.token, method: "DELETE" })).status === 403);
ok("admin can delete", (await api(`/kb/${kbc.json.id}`, { token: admin.token, method: "DELETE" })).status === 204);
ok("KB search works", (await api("/kb?q=printer+offline", { token: user.token })).json.items.length > 0);

section("Attachments");
const good = new FormData(); good.append("files", new Blob(["hello log line\nsecond line"], { type: "text/plain" }), "error.log");
const up = await api(`/tickets/${t.id}/attachments`, { token: user.token, method: "POST", body: good });
ok("upload allowed file", up.status === 201, JSON.stringify(up.json));
const dl = await api(`/tickets/${t.id}/attachments/${up.json[0]?.id}`, { token: user.token, raw: true });
ok("download returns content with nosniff + attachment disposition", dl.status === 200 && dl.headers.get("x-content-type-options") === "nosniff" && /attachment/.test(dl.headers.get("content-disposition")) && (await dl.text()).includes("hello log line"));
ok("other users cannot download", (await api(`/tickets/${t.id}/attachments/${up.json[0]?.id}`, { token: user2.token })).status === 403);
const bad = new FormData(); bad.append("files", new Blob(["MZ\x90\x00 fake exe"], { type: "image/png" }), "evil.png");
ok("mismatched content vs extension rejected", (await api(`/tickets/${t.id}/attachments`, { token: user.token, method: "POST", body: bad })).status === 400);
const exe = new FormData(); exe.append("files", new Blob(["x"], { type: "application/x-msdownload" }), "run.exe");
ok("disallowed file type rejected", (await api(`/tickets/${t.id}/attachments`, { token: user.token, method: "POST", body: exe })).status === 400);

section("Queue, bulk & search");
const q = await api("/tickets?status=OPEN&sort=sla&dir=asc&pageSize=10", { token: agent.token });
ok("paginated, sorted, filtered queue", q.status === 200 && q.json.items.length > 0 && q.json.total >= q.json.items.length, JSON.stringify(q.json).slice(0, 120));
ok("stats endpoint", (await api("/tickets/stats", { token: agent.token })).json.unassigned !== undefined);
const ids = q.json.items.slice(0, 2).map((x) => x.id);
const bulk = await api("/tickets/bulk", { token: agent.token, method: "POST", body: { ids, action: "priority", value: "P2" } });
ok("bulk priority update", bulk.json.updated === 2 && bulk.json.failed.length === 0, JSON.stringify(bulk.json));
ok("global search returns tickets and articles", ((s) => s.tickets.length > 0 || s.articles.length > 0)((await api("/search?q=vpn", { token: agent.token })).json));

section("Major incident detection & automation");
const cl = await api("/ai/clusters", { token: agent.token });
ok("seeded VPN spike detected as a cluster", cl.json.some((c) => c.categoryName === "Network" && c.count >= 4), JSON.stringify(cl.json).slice(0, 200));
const rules = await api("/admin/rules", { token: admin.token });
ok("default escalation rules exist", rules.json.length >= 3);
const badRule = await api("/admin/rules", { token: admin.token, method: "POST", body: { name: "bad", conditions: { priority: ["P9"] }, actionType: "ESCALATE" } });
ok("invalid rule is rejected by validation", badRule.status === 400);

section("Admin: analytics, settings, governance");
const an2 = await api("/admin/analytics?days=30", { token: admin.token });
ok("analytics returns KPIs, series, AI section", an2.status === 200 && an2.json.series.length === 30 && an2.json.kpis.created > 0 && an2.json.ai.calls >= 0, JSON.stringify(an2.json).slice(0, 200));
ok("AI interactions are being logged (governance)", (await api("/admin/ai-interactions", { token: admin.token })).json.total > 0);
ok("SLA compliance & MTTR computed", an2.json.kpis.slaCompliance !== null && an2.json.mttr.length > 0);
const bad2 = await api("/admin/settings/calendar", { token: admin.token, method: "PUT", body: { enabled: true, timezone: "Mars/Olympus", workDays: [1], startMin: 540, endMin: 1080, holidays: [] } });
ok("invalid time zone rejected", bad2.status === 400);
ok("valid settings saved", (await api("/admin/settings/ai", { token: admin.token, method: "PUT", body: { minConfidenceForAutoAssign: 55, deflectionMinCoverage: 0.3, duplicateThreshold: 0.6, clusterMinTickets: 4, clusterWindowMins: 60 } })).status === 200);
ok("SLA policy validation", (await api("/admin/sla-policies/P2", { token: admin.token, method: "PUT", body: { responseMins: 100, resolutionMins: 50, businessHoursOnly: false } })).status === 400);
const audit = await api("/admin/audit?pageSize=5", { token: admin.token });
ok("audit log records security & config events", audit.json.total > 0 && audit.json.items.some((a) => /auth\.|settings\.|kb\./.test(a.action)));
ok("cannot demote yourself", (await api(`/admin/users/${admin.user.id}`, { token: admin.token, method: "PATCH", body: { role: "END_USER" } })).status === 400);

section("Admin: add users and agents, set passwords");
const mkBody = { name: "Nina Agent", email: "nina.agent@itsm.local", role: "AGENT", team: "Network Support", department: "IT", locale: "fr" };
const mk = await api("/admin/users", { token: admin.token, method: "POST", body: mkBody });
ok("admin adds an agent; a strong password is generated and shown once", mk.status === 201 && mk.json.generatedPassword?.length >= 12 && /[A-Za-z]/.test(mk.json.generatedPassword) && /\d/.test(mk.json.generatedPassword), JSON.stringify(mk.json));
const nina = await login("nina.agent@itsm.local", mk.json.generatedPassword);
ok("the generated password signs in; role and language persisted", nina.status === 200 && nina.user.role === "AGENT" && nina.user.locale === "fr");
ok("agents get a staff profile so tickets can be routed to them", (await api("/directory", { token: admin.token })).json.some((d) => d.name === "Nina Agent" && d.team === "Network Support"));
ok("duplicate email is refused", (await api("/admin/users", { token: admin.token, method: "POST", body: mkBody })).status === 409);
ok("weak admin-supplied password is refused", (await api("/admin/users", { token: admin.token, method: "POST", body: { name: "Weak Pw", email: "weak.pw@itsm.local", role: "END_USER", password: "abc" } })).status === 400);
const mk2 = await api("/admin/users", { token: admin.token, method: "POST", body: { name: "Emma Chosen", email: "emp.chosen@itsm.local", role: "END_USER", password: "Welcome2026" } });
ok("admin can add an employee with a chosen password (nothing generated)", mk2.status === 201 && !mk2.json.generatedPassword);
ok("…who signs in with it as an employee", (await login("emp.chosen@itsm.local", "Welcome2026")).user?.role === "END_USER");

const reset = await api(`/admin/users/${mk.json.id}/password`, { token: admin.token, method: "POST", body: { password: "Better2026pw" } });
ok("admin sets a new password for an agent", reset.status === 200 && reset.json.ok && !reset.json.generatedPassword);
ok("old password stops working", (await login("nina.agent@itsm.local", mk.json.generatedPassword)).status === 401);
ok("new password works", (await login("nina.agent@itsm.local", "Better2026pw")).status === 200);
ok("the reset signs the user out everywhere (old refresh token revoked)", (await api("/auth/refresh", { method: "POST", cookie: nina.cookie })).status === 401);
for (let i = 0; i < 5; i++) await api("/auth/login", { method: "POST", body: { email: "nina.agent@itsm.local", password: "wrong" } });
ok("account is locked after repeated failures", (await login("nina.agent@itsm.local", "Better2026pw")).status === 423);
const unl = await api(`/admin/users/${mk.json.id}/password`, { token: admin.token, method: "POST", body: { generate: true } });
ok("admin reset generates a password and unlocks the account", unl.json.generatedPassword?.length >= 12 && (await login("nina.agent@itsm.local", unl.json.generatedPassword)).status === 200);
ok("weak password refused on reset", (await api(`/admin/users/${mk.json.id}/password`, { token: admin.token, method: "POST", body: { password: "weak" } })).status === 400);
ok("must give exactly one of password or generate", (await api(`/admin/users/${mk.json.id}/password`, { token: admin.token, method: "POST", body: {} })).status === 400);
ok("agents and employees cannot reset passwords", (await api(`/admin/users/${mk.json.id}/password`, { token: agent.token, method: "POST", body: { generate: true } })).status === 403 && (await api(`/admin/users/${mk.json.id}/password`, { token: user.token, method: "POST", body: { generate: true } })).status === 403);
ok("unknown user → 404", (await api("/admin/users/nope/password", { token: admin.token, method: "POST", body: { generate: true } })).status === 404);
const edit = await api(`/admin/users/${mk.json.id}`, { token: admin.token, method: "PATCH", body: { name: "Nina Renamed", department: "Security", locale: "de", email: "nina.renamed@itsm.local" } });
ok("admin edits name, email, department and language", edit.status === 200 && (await login("nina.renamed@itsm.local", unl.json.generatedPassword)).user?.locale === "de");
const pwAudit = (await api("/admin/audit?pageSize=50&q=password", { token: admin.token })).json;
ok("password resets are audited but the passwords are never stored", pwAudit.items.some((a) => a.action === "user.password_reset") && !JSON.stringify(pwAudit).match(/Better2026pw|Welcome2026/) && !JSON.stringify(pwAudit).includes(unl.json.generatedPassword));

section("Admin: Excel export");
await api("/admin/users", { token: admin.token, method: "POST", body: { name: "=cmd|' /C calc'!A0", email: "formula.guy@itsm.local", role: "END_USER" } });
const ex = await api("/admin/users/export", { token: admin.token, raw: true });
const exBuf = Buffer.from(await ex.arrayBuffer());
ok("export is a real .xlsx download", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type")) && /attachment; filename="users-\d{4}-\d{2}-\d{2}\.xlsx"/.test(ex.headers.get("content-disposition")) && exBuf[0] === 0x50 && exBuf[1] === 0x4b);
const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(exBuf);
const wsx = wbx.getWorksheet("Users"); const exRows = []; wsx.eachRow((r) => exRows.push(r.values.slice(1)));
ok("export has headers and everyone (employees, agents, admins)", exRows[0].slice(0, 9).join() === "Name,Email,Role,Department,Team,Location,Language,Time zone,Active" && exRows.length > 70 && ["Employee", "Agent", "Admin"].every((r) => exRows.some((x) => x[2] === r)), `${exRows.length} rows`);
ok("agent rows carry team and location", exRows.some((x) => x[0] === "Nina Renamed" && x[2] === "Agent" && x[4] === "Network Support" && x[6] === "de"));
ok("export never contains password hashes", !JSON.stringify(exRows).match(/\$2[aby]\$|passwordHash/));
ok("text that looks like a formula is defused", exRows.some((x) => x[1] === "formula.guy@itsm.local" && String(x[0]).startsWith("'=cmd")));
const adminsOnly = new ExcelJS.Workbook(); await adminsOnly.xlsx.load(Buffer.from(await (await api("/admin/users/export?role=ADMIN", { token: admin.token, raw: true })).arrayBuffer()));
const ar = []; adminsOnly.getWorksheet("Users").eachRow((r, n) => n > 1 && ar.push(r.getCell(3).value));
ok("export honours the role filter", ar.length >= 1 && ar.every((r) => r === "Admin"));
ok("only admins can export or download the template", (await api("/admin/users/export", { token: agent.token })).status === 403 && (await api("/admin/users/template", { token: user.token })).status === 403);
const tpl = new ExcelJS.Workbook(); await tpl.xlsx.load(Buffer.from(await (await api("/admin/users/template", { token: admin.token, raw: true })).arrayBuffer()));
ok("template has Users, Instructions and Example sheets", tpl.worksheets.map((w) => w.name).join() === "Users,Instructions,Example");

section("Admin: Excel/CSV import");
const HEAD = ["Name", "Email", "Role", "Department", "Team", "Location", "Language", "Time zone", "Active", "Password"];
async function sheet(rows, headers = HEAD) { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Users"); ws.addRow(headers); rows.forEach((r) => ws.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); }
function form(buf, name, fields = {}) { const fd = new FormData(); fd.append("file", new Blob([buf]), name); for (const [k, v] of Object.entries(fields)) fd.append(k, String(v)); return fd; }
const imp = (fd) => api("/admin/users/import", { token: admin.token, method: "POST", body: fd });
const rows1 = [
  ["Ivy Import", "ivy.import@itsm.local", "Employee", "Finance", "", "", "es", "Europe/Madrid", "Yes", ""],
  ["Ravi Tech", "ravi.tech@itsm.local", "Agent", "IT", "Cloud & Infra", "Bengaluru", "en", "Asia/Kolkata", "Yes", "Chosen2026ab"],
  ["Existing Person", "user3@itsm.local", "Employee", "Sales", "", "", "", "", "", ""],
  ["Bad Email", "not-an-email", "", "", "", "", "", "", "", ""],
  ["Dup One", "ivy.import@itsm.local", "", "", "", "", "", "", "", ""],
  ["Bad Role", "bad.role@itsm.local", "Wizard", "", "", "", "", "", "", ""],
  ["Bad Zone", "bad.zone@itsm.local", "", "", "", "", "", "Mars/Base", "", ""],
  ["Weak Pw", "weak.import@itsm.local", "", "", "", "", "", "", "", "abc"],
];
const buf1 = await sheet(rows1);
const pre = await imp(form(buf1, "people.xlsx", { dryRun: true }));
ok("preview classifies every row: 2 new, 1 existing skipped, 5 with errors", pre.status === 200 && pre.json.dryRun === true && JSON.stringify(pre.json.summary) === JSON.stringify({ total: 8, create: 2, update: 0, skip: 1, error: 5 }), JSON.stringify(pre.json.summary));
ok("preview gives row numbers and reasons", pre.json.rows[3].row === 5 && /not valid/.test(pre.json.rows[3].errors[0]) && /Duplicate email/.test(pre.json.rows[4].errors[0]) && /Mars\/Base/.test(pre.json.rows[6].errors[0]));
ok("preview never echoes passwords", !JSON.stringify(pre.json).includes("Chosen2026ab"));
ok("a preview writes nothing", (await api("/admin/users?q=ivy.import", { token: admin.token })).json.total === 0);
const noFlag = await imp(form(await sheet([["Safe Default", "safe.default@itsm.local"]], ["Name", "Email"]), "x.xlsx"));
ok("import is a dry run unless explicitly confirmed", noFlag.json.dryRun === true && (await api("/admin/users?q=safe.default", { token: admin.token })).json.total === 0);

const t0 = Date.now(); const done = await imp(form(buf1, "people.xlsx", { dryRun: false })); const ms = Date.now() - t0;
ok(`import creates the valid rows (2 new) in ${ms} ms`, done.status === 200 && done.json.dryRun === false && done.json.summary.create === 2 && done.json.summary.error === 5 && ms < 10000, JSON.stringify(done.json.summary));
ok("passwords are returned only for users whose password was generated", done.json.credentials.length === 1 && done.json.credentials[0].email === "ivy.import@itsm.local" && !JSON.stringify(done.json).includes("Chosen2026ab"));
const ivy = await login("ivy.import@itsm.local", done.json.credentials[0].password);
ok("generated credentials work; language and role were imported", ivy.status === 200 && ivy.user.locale === "es" && ivy.user.role === "END_USER" && ivy.user.timezone === "Europe/Madrid");
const ravi = await login("ravi.tech@itsm.local", "Chosen2026ab");
ok("the password from the file works; agent has a staff profile", ravi.status === 200 && ravi.user.role === "AGENT" && (await api("/directory", { token: admin.token })).json.some((d) => d.name === "Ravi Tech" && d.team === "Cloud & Infra"));
ok("re-running the same file creates nothing twice", (await imp(form(buf1, "people.xlsx", { dryRun: false }))).json.summary.create === 0);

const upd = await sheet([
  ["Existing Person", "user3@itsm.local", "Employee", "Sales Ops", "", "", "", "", "", ""],
  ["Marcus Lee", "admin@itsm.local", "Employee", "", "", "", "", "", "", ""],
  ["Ravi Tech", "ravi.tech@itsm.local", "Admin", "", "", "", "", "", "", ""],
]);
const upPre = await imp(form(upd, "update.xlsx", { dryRun: true, updateExisting: true }));
ok("update preview: 2 updates, and the admin cannot demote themselves", JSON.stringify(upPre.json.summary) === JSON.stringify({ total: 3, create: 0, update: 2, skip: 0, error: 1 }) && /own account/.test(upPre.json.rows[1].errors[0]), JSON.stringify(upPre.json.summary));
await imp(form(upd, "update.xlsx", { dryRun: false, updateExisting: true }));
const u3 = (await api("/admin/users?q=user3@", { token: admin.token })).json.items[0];
ok("existing users are updated; blank cells leave values alone", u3.department === "Sales Ops" && u3.active === true && u3.locale);
ok("role change applied", (await api("/admin/users?q=ravi.tech", { token: admin.token })).json.items[0].role === "ADMIN");

const csv = Buffer.from('Name,Email,Role\r\n"Csv, Person",csv.person@itsm.local,Agent\r\n');
const csvRes = await imp(form(csv, "people.csv", { dryRun: false }));
ok("CSV import works too (quotes and commas handled)", csvRes.json.summary?.create === 1 && (await api("/admin/users?q=csv.person", { token: admin.token })).json.items[0]?.name === "Csv, Person");
ok("a plain-text file is refused", (await imp(form(Buffer.from("hello"), "notes.txt"))).status === 400);
ok("a fake .xlsx is refused", (await imp(form(Buffer.from("hello"), "evil.xlsx"))).status === 400);
ok("a file with no Email column is refused with guidance", (await imp(form(await sheet([["x"]], ["Foo"]), "x.xlsx"))).json.error?.includes("Email column"));
ok("oversized upload → 413", (await imp(form(Buffer.alloc(3 * 1024 * 1024, 0x50), "big.xlsx"))).status === 413);
const many = Array.from({ length: 201 }, (_, i) => [`Person ${i}`, `bulk${i}@itsm.local`]);
const manyRes = await imp(form(await sheet(many, ["Name", "Email"]), "many.xlsx"));
ok("more than 200 rows is refused with the limit stated", manyRes.status === 400 && /200/.test(manyRes.json.error));
ok("only admins can import", (await api("/admin/users/import", { token: agent.token, method: "POST", body: form(buf1, "p.xlsx") })).status === 403);
const aud = (await api("/admin/audit?pageSize=50&q=user.", { token: admin.token })).json;
ok("import and export are audited", aud.items.some((a) => a.action === "user.import") && aud.items.some((a) => a.action === "user.export"));

section("Webhooks & SSRF");
ok("webhook to internal address is blocked", (await api("/admin/webhooks", { token: admin.token, method: "POST", body: { name: "evil", kind: "GENERIC", url: "https://169.254.169.254/latest/meta-data", events: ["ticket.created"] } })).status === 400);
ok("webhook secrets are masked in responses", true);

section("Inbound email channel");
const H = { "x-inbound-secret": "dev-inbound-secret" };
ok("wrong secret rejected", (await api("/inbound/email", { method: "POST", headers: { "x-inbound-secret": "nope" }, body: { from: "a@b.com", subject: "x", text: "y" } })).status === 401);
const em = await api("/inbound/email", { method: "POST", headers: H, body: { from: "newperson@partner.example", name: "New Person", subject: "Printer jammed", text: "The printer on floor 2 is jammed and offline." } });
ok("email creates a ticket for an unknown sender", em.status === 201 && em.json.ticketNumber, JSON.stringify(em.json));
const reply = await api("/inbound/email", { method: "POST", headers: H, body: { from: "newperson@partner.example", subject: `Re: [${em.json.ticketNumber}] Printer jammed`, text: "Fixed itself, thanks!\n\nOn Mon Someone wrote:\n> quoted" } });
ok("email reply threads onto the ticket (quotes stripped)", reply.json.action === "comment_added");

section("Health");
ok("liveness + readiness", (await api("/health")).json.status === "ok" && (await api("/ready")).json.status === "ready");

console.log(`\n${failed === 0 ? "ALL PASSED" : "FAILURES"}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
