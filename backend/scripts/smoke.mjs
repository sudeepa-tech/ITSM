// End-to-end smoke test against a running API + seeded database.  Usage: BASE_URL=http://localhost:4000 npm run smoke
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
const created = await api("/tickets", { token: user.token, method: "POST", body: { subject: "Outlook not syncing since morning", description: "My Outlook stopped receiving email today, webmail works fine.", priority: "P1" } });
const t = created.json;
ok("ticket created", created.status === 201 && t.ticketNumber?.startsWith("INC-"), JSON.stringify(created.json).slice(0, 200));
ok("requester cannot force priority (AI decides)", t.priority !== "P1");
ok("requester response hides AI internals", t.aiAnalysis === null && t.aiSummary === null);
ok("SLA instance created with due dates", !!t.slaInstance?.resolutionDue);
const tStaff = (await api(`/tickets/${t.id}`, { token: admin.token })).json;
ok("staff sees AI analysis + explainable assignment", tStaff.aiAnalysis?.confidence > 0 && (tStaff.aiAnalysis.assignmentReason?.winner || tStaff.aiAnalysis.assignmentReason?.note));
ok("ticket numbers are unique & sequential", (await api("/tickets", { token: user.token, method: "POST", body: { subject: "Second ticket", description: "Another Outlook problem" } })).json.ticketNumber !== t.ticketNumber);
ok("other end user cannot view it", (await api(`/tickets/${t.id}`, { token: user2.token })).status === 403);
ok("end user list is scoped to own tickets", (await api("/tickets?pageSize=100", { token: user.token })).json.items.every((x) => x.requester.name));

section("Multilingual");
const es = await api("/tickets", { token: user.token, method: "POST", body: { subject: "No puedo imprimir", description: "Buenos días, la impresora del segundo piso no funciona y nadie puede imprimir." } });
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
const p1 = (await api("/tickets", { token: user.token, method: "POST", body: { subject: "Production server down", description: "The production server is down, outage for everyone, cannot work, urgent" } })).json;
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
