import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, Priority } from "@prisma/client";
import { prisma } from "../config/db";
import { ApiError } from "../middleware/errorHandler";
import { detectClusters } from "../services/ai/duplicates";
import { audit } from "../services/audit";
import { assertPublicUrl, deliverToHook } from "../services/notifications";
import { conditionsSchema, ACTIONS } from "../services/automation";
import { DEFAULT_AI, getSetting, setSetting } from "../services/settings";
import { CLOSED_STATUSES } from "../services/sla/slaService";
import { pageArgs, pageQuery } from "../utils/pagination";
import { LOCALES } from "./authController";
import multer from "multer";
import { generatePassword, MAX_IMPORT_ROWS, summarize, validateRows, validTimezone } from "../services/userImport";
import { buildTemplate, buildUsersWorkbook, readSheet } from "../services/userSheet";

// ----------------------------------------------------------------- analytics
export async function analytics(req: Request, res: Response) {
  const days = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days);
  const since = new Date(Date.now() - days * 86_400_000);
  const open: Prisma.TicketWhereInput = { status: { notIn: CLOSED_STATUSES as any } };

  const [series, mttr, firstResp, sla, override, byCategory, openNow, unassigned, triage, byPriority, byStatus, byChannel, created, resolved, reopened, csat, negative, sentimentTotal,
    aiCalls, aiFeedback, deflections, vaTotal, vaResolved, vaTicketed, manual, auto, clusters] = await Promise.all([
    prisma.$queryRaw<{ day: string; created: number; resolved: number }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n,0)::int AS created, COALESCE(r.n,0)::int AS resolved
      FROM generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => ${days - 1}::int), date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') d
      LEFT JOIN (SELECT date_trunc('day',"createdAt") AS day, count(*) n FROM "Ticket" WHERE "createdAt" >= ${since} GROUP BY 1) c ON c.day = d
      LEFT JOIN (SELECT date_trunc('day',"resolvedAt") AS day, count(*) n FROM "Ticket" WHERE "resolvedAt" >= ${since} GROUP BY 1) r ON r.day = d
      ORDER BY d`,
    prisma.$queryRaw<{ priority: string; n: number; hrs: number }[]>`
      SELECT priority::text AS priority, count(*)::int AS n, (avg(extract(epoch FROM ("resolvedAt" - "createdAt"))) / 3600)::float AS hrs
      FROM "Ticket" WHERE "resolvedAt" >= ${since} GROUP BY priority ORDER BY priority`,
    prisma.$queryRaw<{ mins: number | null }[]>`SELECT (avg(extract(epoch FROM ("firstResponseAt" - "createdAt"))) / 60)::float AS mins FROM "Ticket" WHERE "createdAt" >= ${since} AND "firstResponseAt" IS NOT NULL`,
    prisma.$queryRaw<{ met: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE s.status <> 'BREACHED')::int AS met, count(*)::int AS total
      FROM "Ticket" t JOIN "SLAInstance" s ON s."ticketId" = t.id WHERE t."resolvedAt" >= ${since}`,
    prisma.$queryRaw<{ overridden: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE a.category <> COALESCE(c.name, ''))::int AS overridden, count(*)::int AS total
      FROM "AIAnalysis" a JOIN "Ticket" t ON t.id = a."ticketId" LEFT JOIN "Category" c ON c.id = t."categoryId" WHERE t."createdAt" >= ${since}`,
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT COALESCE(c.name, 'Uncategorised') AS name, count(*)::int AS n FROM "Ticket" t LEFT JOIN "Category" c ON c.id = t."categoryId"
      WHERE t."createdAt" >= ${since} GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    prisma.ticket.count({ where: open }),
    prisma.ticket.count({ where: { ...open, assigneeId: null } }),
    prisma.ticket.count({ where: { ...open, needsTriage: true } }),
    prisma.ticket.groupBy({ by: ["priority"], where: open, _count: true }),
    prisma.ticket.groupBy({ by: ["status"], _count: true }),
    prisma.ticket.groupBy({ by: ["channel"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.ticket.count({ where: { createdAt: { gte: since } } }),
    prisma.ticket.count({ where: { resolvedAt: { gte: since } } }),
    prisma.ticket.count({ where: { createdAt: { gte: since }, reopenCount: { gt: 0 } } }),
    prisma.ticket.aggregate({ where: { csatAt: { gte: since } }, _avg: { csatScore: true }, _count: { csatScore: true } }),
    prisma.ticket.count({ where: { createdAt: { gte: since }, sentiment: { lt: -0.2 } } }),
    prisma.ticket.count({ where: { createdAt: { gte: since }, sentiment: { not: null } } }),
    prisma.aIInteraction.groupBy({ by: ["feature", "provider"], where: { createdAt: { gte: since } }, _count: true, _avg: { latencyMs: true }, _sum: { inputTokens: true, outputTokens: true } }),
    prisma.aIFeedback.groupBy({ by: ["feature", "verdict"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.deflectionEvent.groupBy({ by: ["outcome"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.virtualAgentSession.count({ where: { createdAt: { gte: since } } }),
    prisma.virtualAgentSession.count({ where: { createdAt: { gte: since }, resolved: true } }),
    prisma.virtualAgentSession.count({ where: { createdAt: { gte: since }, ticketId: { not: null } } }),
    prisma.ticketHistory.count({ where: { createdAt: { gte: since }, event: "Manually reassigned" } }),
    prisma.ticketHistory.count({ where: { createdAt: { gte: since }, event: "Auto-assigned by AI" } }),
    detectClusters(),
  ]);

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const defl = Object.fromEntries(deflections.map((d) => [d.outcome, d._count])) as Record<string, number>;
  const calls = aiCalls.reduce((a, c) => a + c._count, 0);
  const fallbackCalls = aiCalls.filter((c) => c.provider === "rules").reduce((a, c) => a + c._count, 0);
  const up = aiFeedback.filter((f) => f.verdict === "UP").reduce((a, f) => a + f._count, 0);
  const down = aiFeedback.filter((f) => f.verdict === "DOWN").reduce((a, f) => a + f._count, 0);
  const sc = await prisma.ticket.count({ where: { createdAt: { gte: since }, needsTriage: false } });

  res.json({
    days,
    kpis: {
      created, resolved, openNow, unassigned, triage, clusters: clusters.length,
      slaCompliance: pct(sla[0]?.met ?? 0, sla[0]?.total ?? 0),
      avgFirstResponseMins: firstResp[0]?.mins ? Math.round(firstResp[0].mins) : null,
      reopenRate: pct(reopened, created),
      csat: csat._avg.csatScore ? +csat._avg.csatScore.toFixed(2) : null, csatResponses: csat._count.csatScore,
      negativeShare: pct(negative, sentimentTotal),
    },
    series, mttr: mttr.map((m) => ({ ...m, hrs: +m.hrs.toFixed(1) })), byCategory,
    byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c._count])),
    ai: {
      autoTriageRate: pct(sc, created), categoryOverrideRate: pct(override[0]?.overridden ?? 0, override[0]?.total ?? 0),
      reassignRate: pct(manual, auto + manual), feedbackUp: up, feedbackDown: down, feedbackApproval: pct(up, up + down),
      deflectionRate: pct(defl.SOLVED ?? 0, (defl.SOLVED ?? 0) + (defl.TICKET_CREATED ?? 0)), deflection: { shown: defl.SHOWN ?? 0, solved: defl.SOLVED ?? 0, ticketed: defl.TICKET_CREATED ?? 0 },
      virtualAgent: { sessions: vaTotal, resolved: vaResolved, ticketed: vaTicketed },
      calls, fallbackRate: pct(fallbackCalls, calls),
      byFeature: aiCalls.map((c) => ({ feature: c.feature, provider: c.provider, calls: c._count, avgLatencyMs: Math.round(c._avg.latencyMs ?? 0), inputTokens: c._sum.inputTokens ?? 0, outputTokens: c._sum.outputTokens ?? 0 })),
    },
    clusters,
  });
}

export async function aiInteractions(req: Request, res: Response) {
  const q = pageQuery.parse(req.query);
  const [total, items] = await Promise.all([prisma.aIInteraction.count(), prisma.aIInteraction.findMany({ orderBy: { createdAt: "desc" }, ...pageArgs(q) })]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}

// ------------------------------------------------------------ staff directory
export async function directory(_req: Request, res: Response) {
  const [emps, open] = await Promise.all([
    prisma.employee.findMany({ where: { user: { active: true } }, include: { user: { select: { name: true } } } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, status: { notIn: CLOSED_STATUSES as any } }, _count: true }),
  ]);
  const m = new Map(open.map((o) => [o.assigneeId, o._count as number]));
  res.json(emps.map((e) => ({ id: e.id, name: e.user.name, team: e.team, available: e.available, openTickets: m.get(e.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name)));
}

// ------------------------------------------------------------------ employees
export async function listEmployees(_req: Request, res: Response) {
  const [emps, open] = await Promise.all([
    prisma.employee.findMany({ include: { user: { select: { name: true, email: true, active: true } }, skills: { include: { skill: true } } } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, status: { notIn: CLOSED_STATUSES as any } }, _count: true }),
  ]);
  const m = new Map(open.map((o) => [o.assigneeId, o._count as number]));
  res.json(emps.map((e) => ({
    id: e.id, name: e.user.name, email: e.user.email, active: e.user.active, team: e.team, location: e.location, timezone: e.timezone, available: e.available, capacity: e.capacity,
    shiftStartMin: e.shiftStartMin, shiftEndMin: e.shiftEndMin, workDays: e.workDays, avgResolutionHrs: e.avgResolutionHrs, openTickets: m.get(e.id) ?? 0,
    skills: e.skills.map((s) => ({ name: s.skill.name, level: s.level })),
  })));
}

const empSchema = z.object({
  available: z.boolean().optional(), capacity: z.number().int().min(1).max(100).optional(), team: z.string().max(60).optional(), location: z.string().max(60).optional(),
  timezone: z.string().optional(), shiftStartMin: z.number().int().min(0).max(1439).optional(), shiftEndMin: z.number().int().min(1).max(1440).optional(), workDays: z.array(z.number().int().min(0).max(6)).optional(),
});
export async function updateEmployee(req: Request, res: Response) {
  const b = empSchema.parse(req.body);
  if (b.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }); } catch { throw new ApiError(400, "Unknown time zone"); } }
  const e = await prisma.employee.update({ where: { id: req.params.id }, data: b });
  await audit(req, "employee.update", "Employee", e.id, undefined, b);
  res.json(e);
}

export async function setSkills(req: Request, res: Response) {
  const skills = z.array(z.object({ name: z.string().min(1).max(40), level: z.number().int().min(0).max(100) })).max(40).parse(req.body);
  const empId = req.params.id;
  await prisma.$transaction(async (tx) => {
    await tx.employeeSkill.deleteMany({ where: { employeeId: empId } });
    for (const s of skills) {
      const skill = await tx.skill.upsert({ where: { name: s.name }, update: {}, create: { name: s.name } });
      await tx.employeeSkill.create({ data: { employeeId: empId, skillId: skill.id, level: s.level } });
    }
  });
  await audit(req, "employee.skills", "Employee", empId, undefined, skills);
  res.status(204).end();
}

export const listSkills = async (_req: Request, res: Response) => res.json((await prisma.skill.findMany({ orderBy: { name: "asc" } })).map((s) => s.name));

// ---------------------------------------------------------------------- users
const userSelect = { id: true, name: true, email: true, role: true, active: true, department: true, locale: true, timezone: true, lastLoginAt: true, createdAt: true, employee: { select: { team: true, location: true } } } as const;
const userWhere = (q: { q?: string; role?: "END_USER" | "AGENT" | "ADMIN" }): Prisma.UserWhereInput => ({ role: q.role, ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}) });

export async function listUsers(req: Request, res: Response) {
  const q = pageQuery.extend({ q: z.string().max(100).optional(), role: z.enum(["END_USER", "AGENT", "ADMIN"]).optional() }).parse(req.query);
  const where = userWhere(q);
  const [total, items] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, select: userSelect, orderBy: { name: "asc" }, ...pageArgs(q) })]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}

const password = z.string().min(8).max(128).regex(/[A-Za-z]/, "Password needs a letter").regex(/\d/, "Password needs a digit");
const roleEnum = z.enum(["END_USER", "AGENT", "ADMIN"]);
const tzSchema = z.string().refine(validTimezone, "Unknown time zone");
const localeSchema = z.enum(LOCALES as [string, ...string[]]);

/** Admin creates an employee, agent or admin. Leave the password out to have a strong one generated (returned once). */
export async function createUser(req: Request, res: Response) {
  const b = z.object({
    name: z.string().trim().min(2).max(80), email: z.string().trim().email().transform((s) => s.toLowerCase()), password: password.optional(), role: roleEnum,
    team: z.string().trim().max(60).optional(), location: z.string().trim().max(60).optional(), department: z.string().trim().max(80).optional(),
    locale: localeSchema.default("en"), timezone: tzSchema.default("UTC"), active: z.boolean().default(true),
  }).parse(req.body);
  const generated = b.password ? undefined : generatePassword();
  const u = await prisma.user.create({
    data: {
      name: b.name, email: b.email, role: b.role, department: b.department, locale: b.locale, timezone: b.timezone, active: b.active, passwordHash: await bcrypt.hash(b.password ?? generated!, 12),
      ...(b.role !== "END_USER" ? { employee: { create: { team: b.team || "Service Desk", location: b.location, timezone: b.timezone } } } : {}),
    },
  });
  await audit(req, "user.create", "User", u.id, undefined, { email: u.email, role: u.role, passwordGenerated: !!generated });
  res.status(201).json({ id: u.id, ...(generated ? { generatedPassword: generated } : {}) });
}

export async function updateUser(req: Request, res: Response) {
  const b = z.object({
    role: roleEnum.optional(), active: z.boolean().optional(), team: z.string().trim().max(60).optional(), name: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(), department: z.string().trim().max(80).nullish(), locale: localeSchema.optional(),
  }).parse(req.body);
  const old = await prisma.user.findUnique({ where: { id: req.params.id }, include: { employee: true } });
  if (!old) throw new ApiError(404, "User not found");
  if (old.id === req.user!.sub && (b.active === false || (b.role && b.role !== "ADMIN"))) throw new ApiError(400, "You cannot demote or deactivate your own account");
  const u = await prisma.user.update({ where: { id: old.id }, data: { role: b.role, active: b.active, name: b.name, email: b.email, department: b.department, locale: b.locale } });
  if ((b.role === "AGENT" || b.role === "ADMIN") && !old.employee) await prisma.employee.create({ data: { userId: u.id, team: b.team || "Service Desk", timezone: old.timezone } });
  else if (b.team && old.employee) await prisma.employee.update({ where: { id: old.employee.id }, data: { team: b.team } });
  if (b.active === false) await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, "user.update", "User", u.id, { role: old.role, active: old.active, email: old.email }, { role: u.role, active: u.active, email: u.email });
  res.json({ id: u.id });
}

/** Admin sets (or generates) a user's password. Signs them out everywhere and clears any lockout. The password is never logged. */
export async function setUserPassword(req: Request, res: Response) {
  const b = z.object({ password: password.optional(), generate: z.boolean().optional() }).refine((v) => !!v.password !== !!v.generate, "Provide either a password or generate: true").parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!u) throw new ApiError(404, "User not found");
  const pw = b.password ?? generatePassword();
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 12), failedLogins: 0, lockedUntil: null } });
  await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, "user.password_reset", "User", u.id, undefined, { targetEmail: u.email, generated: !b.password });
  res.json({ ok: true, ...(b.password ? {} : { generatedPassword: pw }) });
}

// ------------------------------------------------------------- Excel import/export
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sendXlsx = (res: Response, name: string, bytes: Uint8Array) => {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(bytes));
};
const today = () => new Date().toISOString().slice(0, 10);

export async function exportUsers(req: Request, res: Response) {
  const q = z.object({ q: z.string().max(100).optional(), role: roleEnum.optional() }).parse(req.query);
  const users = await prisma.user.findMany({ where: userWhere(q), select: userSelect, orderBy: { name: "asc" }, take: 20_000 });
  const bytes = await buildUsersWorkbook(users.map((u) => ({ ...u, team: u.employee?.team, location: u.employee?.location })));
  await audit(req, "user.export", "User", undefined, undefined, { count: users.length });
  sendXlsx(res, `users-${today()}.xlsx`, bytes);
}

export async function templateUsers(_req: Request, res: Response) {
  sendXlsx(res, "users-import-template.xlsx", await buildTemplate());
}

export const uploadSheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/** Bulk create/update from .xlsx or .csv. dryRun (the default) validates and previews without writing anything. */
export async function importUsers(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw new ApiError(400, "Choose an .xlsx or .csv file to import");
  const dryRun = req.body?.dryRun !== "false";
  const updateExisting = req.body?.updateExisting === "true";
  const filename = Buffer.from(file.originalname, "latin1").toString("utf8");
  let parsed;
  try { parsed = await readSheet(new Uint8Array(file.buffer), filename); } catch (e) { throw new ApiError(400, (e as Error).message); }
  if (!parsed.rows.length) throw new ApiError(400, "No data rows found under the header row");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, `This file has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);

  const emails = parsed.rows.map((r) => (r.cells.email ?? "").trim().toLowerCase()).filter(Boolean);
  const existing = new Set((await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((u) => u.email));
  const results = validateRows(parsed.rows, { existing, updateExisting, selfEmail: req.user!.email.toLowerCase() });
  const publicRows = () => results.map(({ parsed: _p, ...r }) => r); // never echo passwords back
  if (dryRun) return res.json({ dryRun: true, summary: summarize(results), rows: publicRows(), ignoredColumns: parsed.unknownHeaders });

  const credentials: { email: string; name: string; password: string }[] = [];
  for (const r of results) {
    const p = r.parsed;
    try {
      if (r.action === "create" && p) {
        const pw = p.password ?? generatePassword();
        const role = p.role ?? "END_USER";
        const tz = p.timezone ?? "UTC";
        // bcrypt is deliberately slow. Generated passwords are random 12-character strings (~70 bits), so cost 8 is ample and keeps a
        // 200-row import to a few seconds; passwords typed into the file are human-chosen, so they keep cost 10.
        await prisma.user.create({ data: { name: p.name!, email: r.email, role, department: p.department, locale: p.locale ?? "en", timezone: tz, active: p.active ?? true, passwordHash: await bcrypt.hash(pw, p.password ? 10 : 8), ...(role !== "END_USER" ? { employee: { create: { team: p.team ?? "Service Desk", location: p.location, timezone: tz } } } : {}) } });
        if (!p.password) credentials.push({ email: r.email, name: p.name!, password: pw });
      } else if (r.action === "update" && p) {
        const old = await prisma.user.findUniqueOrThrow({ where: { email: r.email }, include: { employee: true } });
        const u = await prisma.user.update({ where: { id: old.id }, data: { name: p.name, role: p.role, department: p.department, locale: p.locale, timezone: p.timezone, active: p.active } });
        const staff = u.role !== "END_USER";
        if (staff && !old.employee) await prisma.employee.create({ data: { userId: u.id, team: p.team ?? "Service Desk", location: p.location, timezone: u.timezone } });
        else if (old.employee && (p.team || p.location || p.timezone)) await prisma.employee.update({ where: { id: old.employee.id }, data: { team: p.team, location: p.location, timezone: p.timezone } });
        if (p.active === false) await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    } catch (e) {
      r.errors.push(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" ? "Email already exists" : "Could not save this row");
      r.action = "error";
    }
  }
  const summary = summarize(results);
  await audit(req, "user.import", "User", undefined, undefined, { file: filename, ...summary, updateExisting });
  res.json({ dryRun: false, summary, rows: publicRows(), credentials, ignoredColumns: parsed.unknownHeaders });
}

// ----------------------------------------------------------- SLA & settings
export async function listPolicies(_req: Request, res: Response) {
  res.json(await prisma.sLAPolicy.findMany({ orderBy: { priority: "asc" } }));
}
export async function updatePolicy(req: Request, res: Response) {
  const p = z.nativeEnum(Priority).parse(req.params.priority);
  const b = z.object({ responseMins: z.number().int().min(1).max(100_000), resolutionMins: z.number().int().min(1).max(1_000_000), businessHoursOnly: z.boolean() }).refine((v) => v.resolutionMins >= v.responseMins, "Resolution target must be at least the response target").parse(req.body);
  const old = await prisma.sLAPolicy.findUnique({ where: { priority: p } });
  const row = await prisma.sLAPolicy.upsert({ where: { priority: p }, update: b, create: { priority: p, ...b } });
  await audit(req, "sla.update", "SLAPolicy", row.id, old, b);
  res.json(row);
}

const calendarSchema = z.object({ enabled: z.boolean(), timezone: z.string(), workDays: z.array(z.number().int().min(0).max(6)).min(1), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440), holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400) })
  .refine((c) => c.endMin > c.startMin, "Day must end after it starts").refine((c) => { try { new Intl.DateTimeFormat("en", { timeZone: c.timezone }); return true; } catch { return false; } }, "Unknown time zone");
const weightsSchema = z.object({ skillMatch: z.number().min(0).max(1), categoryExpertise: z.number().min(0).max(1), workload: z.number().min(0).max(1), availability: z.number().min(0).max(1), avgResolution: z.number().min(0).max(1), locationShift: z.number().min(0).max(1), slaRisk: z.number().min(0).max(1) });
const aiSchema = z.object({ minConfidenceForAutoAssign: z.number().min(0).max(100), deflectionMinCoverage: z.number().min(0).max(1), duplicateThreshold: z.number().min(0.1).max(1), clusterMinTickets: z.number().int().min(2).max(50), clusterWindowMins: z.number().int().min(5).max(1440) });
const SETTINGS = { calendar: calendarSchema, assignmentWeights: weightsSchema, ai: aiSchema } as const;

export async function getSettings(_req: Request, res: Response) {
  res.json({ calendar: await getSetting("calendar"), assignmentWeights: await getSetting("assignmentWeights"), ai: { ...DEFAULT_AI, ...(await getSetting("ai")) } });
}
export async function putSetting(req: Request, res: Response) {
  const key = req.params.key as keyof typeof SETTINGS;
  if (!(key in SETTINGS)) throw new ApiError(404, "Unknown setting");
  const value = SETTINGS[key].parse(req.body);
  const old = await getSetting(key);
  await setSetting(key, value as any);
  await audit(req, `settings.${key}`, "AppSetting", key, old, value);
  res.json(value);
}

// -------------------------------------------------------------------- rules
const ruleSchema = z.object({ name: z.string().min(3).max(100), enabled: z.boolean().default(true), position: z.number().int().default(0), conditions: conditionsSchema, actionType: z.enum(ACTIONS) });
export const listRules = async (_req: Request, res: Response) => res.json(await prisma.escalationRule.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { executions: true } } } }));
export async function createRule(req: Request, res: Response) {
  const b = ruleSchema.parse(req.body);
  const r = await prisma.escalationRule.create({ data: { ...b, conditions: b.conditions as any } });
  await audit(req, "rule.create", "EscalationRule", r.id, undefined, b);
  res.status(201).json(r);
}
export async function updateRule(req: Request, res: Response) {
  const b = ruleSchema.partial().parse(req.body);
  const r = await prisma.escalationRule.update({ where: { id: req.params.id }, data: { ...b, conditions: b.conditions as any } });
  await audit(req, "rule.update", "EscalationRule", r.id, undefined, b);
  res.json(r);
}
export async function deleteRule(req: Request, res: Response) {
  await prisma.escalationRule.delete({ where: { id: req.params.id } });
  await audit(req, "rule.delete", "EscalationRule", req.params.id);
  res.status(204).end();
}

// ----------------------------------------------------------------- webhooks
const hookSchema = z.object({ name: z.string().min(2).max(60), kind: z.enum(["SLACK", "TEAMS", "GENERIC"]), url: z.string().url(), secret: z.string().max(200).optional(), events: z.array(z.string()).min(1), enabled: z.boolean().default(true) });
const mask = <T extends { secret: string | null }>(h: T) => ({ ...h, secret: h.secret ? "••••••••" : null });
export const listHooks = async (_req: Request, res: Response) => res.json((await prisma.webhook.findMany({ orderBy: { createdAt: "asc" } })).map(mask));
export async function createHook(req: Request, res: Response) {
  const b = hookSchema.parse(req.body);
  await assertPublicUrl(b.url).catch((e) => { throw new ApiError(400, e.message); });
  const h = await prisma.webhook.create({ data: b });
  await audit(req, "webhook.create", "Webhook", h.id, undefined, { name: h.name, url: h.url });
  res.status(201).json(mask(h));
}
export async function updateHook(req: Request, res: Response) {
  const b = hookSchema.partial().parse(req.body);
  if (b.url) await assertPublicUrl(b.url).catch((e) => { throw new ApiError(400, e.message); });
  const h = await prisma.webhook.update({ where: { id: req.params.id }, data: b });
  await audit(req, "webhook.update", "Webhook", h.id);
  res.json(mask(h));
}
export async function deleteHook(req: Request, res: Response) {
  await prisma.webhook.delete({ where: { id: req.params.id } });
  await audit(req, "webhook.delete", "Webhook", req.params.id);
  res.status(204).end();
}
export async function testHook(req: Request, res: Response) {
  const h = await prisma.webhook.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(await deliverToHook(h, "test", { title: "Test notification from Northbeam ITSM" }));
}

// -------------------------------------------------------------------- audit
export async function auditLog(req: Request, res: Response) {
  const q = pageQuery.extend({ q: z.string().max(100).optional() }).parse(req.query);
  const where: Prisma.AuditLogWhereInput = q.q ? { OR: [{ action: { contains: q.q, mode: "insensitive" } }, { actor: { contains: q.q, mode: "insensitive" } }, { entity: { contains: q.q, mode: "insensitive" } }] } : {};
  const [total, items] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(q) })]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}
