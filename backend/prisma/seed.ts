import bcrypt from "bcryptjs";
import { Priority, TicketStatus } from "@prisma/client";
import { prisma } from "../src/config/db";
import { ruleBasedClassify } from "../src/services/ai/classifier";
import { DEFAULT_CALENDAR } from "../src/services/sla/businessTime";
import { computeDueDates, computeSLAStatus } from "../src/services/sla/slaService";

// Deterministic PRNG so every seed run produces the same demo data.
let seed = 20260928;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const SKILLS = ["Windows", "Linux", "Networking", "VPN", "Active Directory", "Microsoft 365", "Azure", "AWS", "Database", "SAP", "Hardware", "Software", "Security", "Email", "Printer", "Application Support"];
const TEAMS: Record<string, { skills: string[]; tz: string; loc: string }[]> = {
  "Network Support": [{ skills: ["VPN", "Networking", "Security"], tz: "Asia/Kolkata", loc: "Bengaluru" }, { skills: ["VPN", "Networking", "Linux"], tz: "Europe/London", loc: "London" }],
  "Identity & Access": [{ skills: ["Active Directory", "Microsoft 365", "Security"], tz: "America/New_York", loc: "New York" }, { skills: ["Active Directory", "Security"], tz: "Asia/Singapore", loc: "Singapore" }],
  "Workplace IT": [{ skills: ["Windows", "Hardware", "Printer", "Email"], tz: "Europe/Berlin", loc: "Berlin" }, { skills: ["Windows", "Hardware", "Email"], tz: "Asia/Kolkata", loc: "Bengaluru" }],
  "Cloud & Infra": [{ skills: ["Azure", "AWS", "Linux", "Database"], tz: "America/Los_Angeles", loc: "San Francisco" }, { skills: ["Azure", "Linux", "Database"], tz: "Europe/London", loc: "London" }],
  "Application Support": [{ skills: ["SAP", "Application Support", "Software", "Database"], tz: "Europe/Berlin", loc: "Berlin" }, { skills: ["Software", "Application Support", "Microsoft 365"], tz: "Asia/Singapore", loc: "Singapore" }],
};
const DEPARTMENTS = ["Finance", "HR", "Sales", "Engineering", "Operations", "Legal", "Marketing"];
const FIRST = ["Sarah", "David", "Anita", "Tom", "Lena", "Marcus", "Priya", "Wei", "Grace", "Rahul", "Nina", "Jon", "Amit", "Chloe", "Omar", "Hana", "Luis", "Ivy", "Noah", "Zara"];
const LAST = ["Johnson", "Chen", "Rao", "Becker", "Fischer", "Lee", "Nair", "Zhang", "Kim", "Mehta", "Ortiz", "Ade", "Sharma", "Dubois", "Khan", "Sato", "Garcia", "Wong", "Miller", "Ali"];
const UFIRST = ["Alex", "Maya", "Carlos", "Yuki", "Fatima", "Liam", "Sofia", "Ravi", "Emma", "Hassan"];
const ULAST = ["Novak", "Silva", "Tanaka", "Haddad", "Kowalski", "Patel", "Rossi", "Nguyen", "Park", "Costa"];
const LOCALES = ["en", "en", "en", "en", "es", "fr", "de", "hi", "ar", "ja", "pt"];

const ISSUES: { s: string; d: string; pri: Priority; lang?: string }[] = [
  { s: "VPN authentication failure", d: "Unable to connect to VPN, the client says authentication failed since this morning.", pri: "P2" },
  { s: "VPN drops every 10 minutes", d: "The VPN connection keeps disconnecting every ten minutes while I work from home.", pri: "P3" },
  { s: "Account locked after MFA attempts", d: "I cannot login, my account is locked after several failed MFA prompts.", pri: "P2" },
  { s: "Outlook not syncing", d: "Emails stopped arriving in Outlook today, webmail works fine.", pri: "P3" },
  { s: "Printer offline on 3rd floor", d: "The shared printer shows offline for the whole team, nobody can print.", pri: "P3" },
  { s: "Production database timeouts", d: "Application timeout, the production database connection pool is exhausted and orders are failing.", pri: "P1" },
  { s: "Azure VM unreachable", d: "Production VM not responding to RDP, the server is down and customers are affected.", pri: "P1" },
  { s: "Laptop won't boot", d: "Laptop shows a black screen after the Windows update and will not start.", pri: "P3" },
  { s: "Need access to the finance shared drive", d: "Please grant me access to the finance shared drive for the quarter close, manager approved.", pri: "P4" },
  { s: "Install Adobe Acrobat", d: "Please install Adobe Acrobat Pro on my laptop, I need it to sign contracts.", pri: "P4" },
  { s: "Suspicious email asking for my password", d: "I received a phishing email pretending to be HR asking me to confirm my password.", pri: "P2" },
  { s: "Teams meetings have no audio", d: "In Teams calls other people cannot hear me, microphone works in other apps.", pri: "P3" },
  { s: "No puedo iniciar sesión, olvidé mi contraseña", d: "Hola, olvidé mi contraseña y ahora la cuenta está bloqueada. Necesito acceder urgentemente.", pri: "P3", lang: "es" },
  { s: "L'imprimante du 2e étage ne fonctionne plus", d: "Bonjour, l'imprimante du deuxième étage est hors ligne depuis ce matin, personne ne peut imprimer.", pri: "P3", lang: "fr" },
  { s: "VPN-Verbindung bricht ständig ab", d: "Guten Tag, die VPN-Verbindung bricht im Homeoffice ständig ab und ich kann nicht arbeiten.", pri: "P3", lang: "de" },
  { s: "This is the THIRD time my laptop crashes!!", d: "My laptop crashed again during the client demo. This is unacceptable, I keep waiting for a fix and nothing happens.", pri: "P2" },
];

const KB = [
  ["Fix VPN 'authentication failed' errors", "Network", ["vpn", "authentication", "mfa", "token"], "If the VPN client reports authentication failed, first confirm your password works on the company portal. Then check that your MFA device time is correct, because a clock drift of more than one minute breaks one-time codes. Next, sign out of the VPN client completely and sign in again to refresh your token. If it still fails, update the VPN client to the latest version from the software portal. Raise a ticket if your account shows as disabled."],
  ["VPN disconnects or drops repeatedly", "Network", ["vpn", "disconnect", "drops", "wifi"], "Frequent VPN drops are usually caused by unstable Wi-Fi or an outdated client. Move closer to the router or use a cable. Switch the VPN protocol to TCP in the client settings. Disable battery saver on your laptop because it can suspend the network adapter. Update the VPN client to the newest release."],
  ["Reset MFA after getting a new phone", "Identity", ["mfa", "authenticator", "new phone", "2fa"], "To move MFA to a new phone, keep your old phone until the process finishes. Open the security page, choose Add sign-in method and scan the new QR code with the authenticator app. Remove the old device after the new one works. If you no longer have the old phone, raise a ticket so the service desk can verify your identity and reset MFA."],
  ["My account is locked", "Identity", ["locked", "account", "password", "login"], "Accounts lock automatically after five failed sign-ins. Wait fifteen minutes and try again, or reset your password using the self-service portal. Make sure saved passwords on your phone and mail app are updated because old saved passwords trigger repeated lockouts."],
  ["Reset a forgotten password (self-service)", "Identity", ["password", "reset", "forgot", "self-service"], "Open the self-service portal and choose Forgot password. Verify with your registered authenticator app. Choose a new password with at least twelve characters. Wait two minutes, then sign in again on all devices."],
  ["Outlook is not syncing new email", "Collaboration", ["outlook", "email", "sync", "mailbox"], "First check webmail to confirm the mailbox receives mail. In Outlook select Send/Receive and make sure Work Offline is off. Check your mailbox size, because a full mailbox stops delivery. Create a new Outlook profile from Control Panel if the problem continues."],
  ["Microphone or audio not working in Teams", "Collaboration", ["teams", "audio", "microphone", "meeting"], "In Teams open Settings and Devices and select the right microphone. Check the operating system privacy settings allow Teams to use the microphone. Restart Teams fully from the system tray. Update audio drivers if headphones still fail."],
  ["Shared printer shows offline", "Hardware", ["printer", "offline", "print"], "Check that the printer is powered on and connected to the network. On your computer remove the printer and add it again from the print server. Restart the print spooler service. If nobody on the floor can print, the printer itself needs attention, so raise a ticket with the printer label."],
  ["Laptop does not start after a Windows update", "Hardware", ["laptop", "boot", "black screen", "update"], "Hold the power button for fifteen seconds to force a full shutdown, then start again. Disconnect all external devices. If Windows shows recovery options choose Startup Repair. Do not reinstall Windows yourself because local files may be lost. Raise a ticket if the screen stays black."],
  ["Request access to a shared drive or application", "Access", ["access", "permission", "shared drive", "request"], "Access requests need manager approval. Submit a service request with the exact folder or application name and the business reason. Access is granted at the least level needed and reviewed every six months."],
  ["Install approved software", "Software", ["install", "software", "license", "application"], "Approved applications are available in the software portal and install without a ticket. For software that is not listed, raise a service request with the business justification and licence cost centre. Security review takes up to three working days."],
  ["How to report a phishing email", "Security", ["phishing", "suspicious", "email", "malware"], "Do not click links or open attachments. Use the Report Phishing button in Outlook. If you already entered your password, change it immediately and raise a high priority ticket so security can revoke sessions. Never forward the email to colleagues."],
  ["Checklist: Azure virtual machine not reachable", "Infrastructure", ["azure", "vm", "rdp", "unreachable", "server"], "Check the VM power state in the portal. Review the network security group for a blocking rule and check recent deployment changes. Look at boot diagnostics for a stuck operating system. Restart the VM only after capturing diagnostics. Escalate to Cloud and Infra if the host shows a platform incident."],
  ["Olvidé mi contraseña o mi cuenta está bloqueada", "Identity", ["contraseña", "bloqueada", "cuenta", "restablecer"], "Si olvidó su contraseña, abra el portal de autoservicio y elija Olvidé mi contraseña. Verifique su identidad con la aplicación de autenticación y cree una contraseña nueva de al menos doce caracteres. Si la cuenta está bloqueada, espere quince minutos antes de intentarlo de nuevo."],
  ["Imprimante hors ligne : que faire ?", "Hardware", ["imprimante", "hors ligne", "imprimer"], "Vérifiez que l'imprimante est allumée et connectée au réseau. Supprimez l'imprimante de votre ordinateur puis ajoutez-la de nouveau depuis le serveur d'impression. Si personne ne peut imprimer, ouvrez un ticket en indiquant l'étiquette de l'imprimante."],
  ["VPN-Verbindung bricht ab", "Network", ["vpn", "verbindung", "abbruch", "homeoffice"], "Wenn die VPN-Verbindung häufig abbricht, prüfen Sie zuerst Ihr WLAN und nutzen Sie nach Möglichkeit ein Netzwerkkabel. Aktualisieren Sie den VPN-Client und wechseln Sie das Protokoll auf TCP. Deaktivieren Sie den Energiesparmodus des Netzwerkadapters."],
] as const;

async function main() {
  console.log("Resetting demo data…");
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Skill","Category","SLAPolicy","KnowledgeArticle","AuditLog","AIInteraction","DeflectionEvent","EscalationRule","Webhook","AppSetting" RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE ticket_number_seq RESTART WITH 10001`);

  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const admin = await prisma.user.create({ data: { email: "admin@itsm.local", name: "Marcus Lee", passwordHash: hash("Admin@123"), role: "ADMIN", department: "IT", timezone: "Europe/London", employee: { create: { team: "Service Desk", location: "London", timezone: "Europe/London" } } } });

  const skillRows = await Promise.all(SKILLS.map((name) => prisma.skill.create({ data: { name } })));
  const skillId = Object.fromEntries(skillRows.map((s) => [s.name, s.id]));

  const policyDefs: Record<Priority, [number, number, boolean]> = { P1: [15, 240, false], P2: [30, 480, false], P3: [120, 1440, true], P4: [480, 4320, true] };
  const policies = {} as Record<Priority, { id: string; responseMins: number; resolutionMins: number; businessHoursOnly: boolean }>;
  for (const [p, [r, s, bh]] of Object.entries(policyDefs) as [Priority, [number, number, boolean]][]) {
    policies[p] = await prisma.sLAPolicy.create({ data: { priority: p, responseMins: r, resolutionMins: s, businessHoursOnly: bh } });
  }

  const cats: Record<string, string> = {};
  for (const [cat, sub, service, skills] of [
    ["Network", "VPN", "Remote Access", ["VPN", "Networking"]], ["Identity", "Authentication", "Identity & Access", ["Active Directory", "Security"]],
    ["Collaboration", "Email", "Email", ["Microsoft 365", "Email"]], ["Hardware", "Peripherals", "Workplace IT", ["Hardware", "Printer"]],
    ["Infrastructure", "Cloud", "Cloud & Infra", ["Azure", "Database", "Linux"]], ["Software", "Application", "Application Support", ["Software", "Application Support"]],
    ["Security", "Incident", "Security Operations", ["Security"]], ["Access", "Permissions", "Identity & Access", ["Active Directory", "Security"]],
  ] as const) cats[cat] = (await prisma.category.create({ data: { name: cat, subcategory: sub, service, requiredSkills: [...skills] } })).id;

  // Agents spread across time zones, each with a realistic local shift.
  const agents: { id: string; userId: string; team: string; skills: string[] }[] = [];
  let i = 0;
  for (const [team, members] of Object.entries(TEAMS)) {
    for (const m of members) for (let k = 0; k < 2; k++) {
      const name = `${FIRST[i]} ${LAST[i]}`;
      const u = await prisma.user.create({ data: { email: `${FIRST[i].toLowerCase()}.${LAST[i].toLowerCase()}@itsm.local`, name, passwordHash: hash("Agent@123"), role: "AGENT", department: "IT", timezone: m.tz, locale: i % 7 === 0 ? "es" : "en" } });
      const e = await prisma.employee.create({ data: { userId: u.id, team, location: m.loc, timezone: m.tz, shiftStartMin: 480 + (k ? 60 : 0), shiftEndMin: 1020 + (k ? 60 : 0), available: rnd() > 0.12, capacity: 8 + Math.floor(rnd() * 6), avgResolutionHrs: +between(1.5, 4.5).toFixed(1) } });
      for (const s of Array.from(new Set([...m.skills, pick(SKILLS)]))) await prisma.employeeSkill.create({ data: { employeeId: e.id, skillId: skillId[s], level: 55 + Math.floor(rnd() * 45) } });
      agents.push({ id: e.id, userId: u.id, team, skills: m.skills });
      i++;
    }
  }

  const users: { id: string }[] = [];
  for (let n = 1; n <= 50; n++) {
    users.push(await prisma.user.create({ data: { email: `user${n}@itsm.local`, name: `${UFIRST[n % 10]} ${ULAST[Math.floor(n / 5) % 10]}`, passwordHash: hash("User@123"), role: "END_USER", department: pick(DEPARTMENTS), locale: pick(LOCALES) } }));
  }

  // Knowledge base
  for (const [title, category, keywords, body] of KB) {
    const language = /[ñáéíóú]|Olvid/.test(title) ? "es" : /Imprimante/.test(title) ? "fr" : /Verbindung/.test(title) ? "de" : "en";
    await prisma.knowledgeArticle.create({ data: { title, category, keywords: [...keywords], body, language, status: "PUBLISHED", views: Math.floor(rnd() * 400), helpful: Math.floor(rnd() * 60), notHelpful: Math.floor(rnd() * 8), createdById: admin.id } });
  }

  // Default automation rules & settings
  await prisma.escalationRule.createMany({ data: [
    { name: "P1 not accepted within 10 minutes", position: 1, conditions: { priority: ["P1"], status: ["NEW", "ASSIGNED"], olderThanMins: 10 }, actionType: "ESCALATE" },
    { name: "SLA breached: notify admins", position: 2, conditions: { slaStatus: ["BREACHED"] }, actionType: "NOTIFY_ADMINS" },
    { name: "Unassigned for 15 minutes: re-route with AI", position: 3, conditions: { unassignedForMins: 15 }, actionType: "AI_REASSIGN" },
    { name: "Very unhappy requester: alert admins", position: 4, conditions: { sentimentBelow: -0.5 }, actionType: "NOTIFY_ADMINS" },
  ] });
  await prisma.appSetting.create({ data: { key: "calendar", value: { ...DEFAULT_CALENDAR } as any } });

  // Historical tickets over the last 30 days (backdated so analytics are meaningful)
  const now = Date.now();
  const seq = async () => `INC-${(await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('ticket_number_seq') AS n`)[0].n}`;
  const total = 130;
  for (let n = 0; n < total; n++) {
    const tpl = pick(ISSUES);
    const c = ruleBasedClassify(`${tpl.s}\n${tpl.d}`);
    const ageMs = Math.pow(rnd(), 1.4) * 30 * DAY + 3 * HOUR;
    const created = new Date(now - ageMs);
    const pri = tpl.pri;
    const policy = policies[pri];
    const due = computeDueDates(pri, policy, DEFAULT_CALENDAR, created);
    const eligible = agents.filter((a) => c.requiredSkills.some((s) => a.skills.includes(s)));
    const agent = pick(eligible.length ? eligible : agents);
    const old = ageMs > 2 * DAY;
    const resolved = old ? rnd() < 0.86 : rnd() < 0.15;
    const status: TicketStatus = resolved ? (rnd() < 0.7 ? "CLOSED" : "RESOLVED") : pick(["ASSIGNED", "IN_PROGRESS", "IN_PROGRESS", "PENDING_USER", "ACCEPTED"] as TicketStatus[]);
    const resolveAfter = between(0.3, 1.5) * policy.resolutionMins * MIN * (policy.businessHoursOnly ? 1.0 : 0.8);
    const resolvedAt = resolved ? new Date(Math.min(created.getTime() + resolveAfter, now - 5 * MIN)) : null;
    const respondedAt = new Date(created.getTime() + between(4, 1.2 * policy.responseMins) * MIN);
    const late = resolvedAt ? resolvedAt > due.resolutionDue : false;
    const sentiment = /THIRD|unacceptable/.test(tpl.s + tpl.d) ? -0.8 : +between(-0.35, 0.5).toFixed(2);
    const requester = pick(users);
    const overridden = rnd() < 0.08;
    const notes = resolved ? `Root cause identified and fixed by ${agent.team}; user confirmed the service works again.` : null;

    await prisma.ticket.create({ data: {
      ticketNumber: await seq(), subject: tpl.s, description: tpl.d, requesterId: requester.id, assigneeId: agent.id, categoryId: cats[c.category], priority: pri,
      type: c.type, channel: pick(["WEB", "WEB", "WEB", "EMAIL", "VIRTUAL_AGENT"] as const), language: tpl.lang ?? "en", sentiment, impact: c.impact, urgency: c.urgency,
      status, createdAt: created, updatedAt: resolvedAt ?? respondedAt, resolvedAt, closedAt: status === "CLOSED" ? resolvedAt : null, firstResponseAt: respondedAt, resolutionNotes: notes,
      reopenCount: rnd() < 0.05 ? 1 : 0,
      csatScore: resolved && rnd() < 0.55 ? Math.max(1, Math.min(5, Math.round(late ? between(2, 4) : between(3.4, 5.4)))) : null, csatAt: resolved ? resolvedAt : null,
      aiAnalysis: { create: { category: overridden ? pick(Object.keys(cats)) : c.category, subcategory: c.subcategory, priority: pri, type: c.type, confidence: c.confidence, provider: "rules", language: tpl.lang ?? "en", sentiment, rootCause: c.rootCause, requiredSkills: c.requiredSkills, similarTickets: [], createdAt: created } },
      slaInstance: { create: {
        policyId: policy.id, startedAt: created, responseDue: due.responseDue, resolutionDue: due.resolutionDue, businessHoursOnly: due.businessHoursOnly, responseMetAt: respondedAt,
        status: resolved ? (late ? "BREACHED" : "HEALTHY") : computeSLAStatus(created, due.resolutionDue, new Date(now)), breachedAt: late ? due.resolutionDue : null,
      } },
      history: { create: [
        { event: "Ticket created", actor: "seed", newValue: "via WEB", createdAt: created },
        { event: "Auto-assigned by AI", actor: "system", newValue: "seed data", createdAt: created },
        ...(resolvedAt ? [{ event: "Status changed", actor: "agent", oldValue: "IN_PROGRESS", newValue: status, createdAt: resolvedAt }] : []),
      ] },
      comments: resolved ? { create: [{ authorId: (await prisma.employee.findUniqueOrThrow({ where: { id: agent.id } })).userId, body: "Thanks for reporting this. I've applied a fix, please confirm it works on your side.", createdAt: respondedAt }] } : undefined,
    } });
  }

  // A live "possible major incident": several similar VPN tickets in the last 40 minutes.
  const vpnAgent = agents.find((a) => a.skills.includes("VPN"))!;
  for (let n = 0; n < 5; n++) {
    const created = new Date(now - (35 - n * 6) * MIN);
    const due = computeDueDates("P2", policies.P2, DEFAULT_CALENDAR, created);
    await prisma.ticket.create({ data: {
      ticketNumber: await seq(), subject: pick(["VPN authentication failure", "Cannot connect to VPN gateway", "VPN says authentication failed", "VPN login fails since a few minutes"]),
      description: "VPN authentication failed suddenly, the client cannot connect to the VPN gateway. Several colleagues have the same problem.", requesterId: users[n].id, assigneeId: vpnAgent.id,
      categoryId: cats.Network, priority: "P2", type: "INCIDENT", status: "ASSIGNED", isMajor: true, sentiment: -0.3, createdAt: created,
      aiAnalysis: { create: { category: "Network", subcategory: "VPN", priority: "P2", type: "INCIDENT", confidence: 84, provider: "rules", requiredSkills: ["VPN", "Networking"], similarTickets: [] } },
      slaInstance: { create: { policyId: policies.P2.id, startedAt: created, responseDue: due.responseDue, resolutionDue: due.resolutionDue, status: "HEALTHY" } },
      history: { create: [{ event: "Ticket created", actor: "seed", newValue: "via WEB", createdAt: created }] },
    } });
  }

  // Demo self-service and AI feedback signals
  const defl = ["SOLVED", "SOLVED", "SOLVED", "TICKET_CREATED", "SHOWN", "SOLVED", "TICKET_CREATED"];
  for (let n = 0; n < 40; n++) await prisma.deflectionEvent.create({ data: { userId: pick(users).id, query: "demo", articleIds: [], outcome: pick(defl), createdAt: new Date(now - rnd() * 30 * DAY) } });
  for (let n = 0; n < 60; n++) await prisma.aIFeedback.create({ data: { userId: pick(agents).userId, feature: pick(["reply_draft", "summary", "classify", "troubleshooting"]), verdict: rnd() < 0.82 ? "UP" : "DOWN", createdAt: new Date(now - rnd() * 30 * DAY) } });

  console.log(`Seeded: 1 admin, ${agents.length} agents, ${users.length} end users, ${KB.length} KB articles, ${total + 5} tickets.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
