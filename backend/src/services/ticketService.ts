import { Channel, Prisma, Priority, TicketStatus, TicketType } from "@prisma/client";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { JwtPayload } from "../utils/jwt";
import { classifyTicket } from "./ai/classifier";
import { detectClusters, findDuplicates } from "./ai/duplicates";
// import { CandidateEmployee, pickAssignee } from "./assignmentEngine";
import {
  CandidateEmployee,
  pickAssignee,
  scoreCandidates,
} from "./assignmentEngine";
import { dispatchEvent, notifyStaff, notifyUser } from "./notifications";
import { emitToStaff, emitToUser } from "./socket";
import { getCalendar, getSetting, getWeights } from "./settings";
import { onShift } from "./sla/businessTime";
import { CLOSED_STATUSES, PAUSED_STATUSES, computeDueDates, computeSLAStatus, extendForPause } from "./sla/slaService";

const link = (id: string) => `/tickets/${id}`;

export async function nextTicketNumber() {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('ticket_number_seq') AS n`;
  return `INC-${r[0].n}`;
}

export const logHistory = (ticketId: string, event: string, actor: string, oldValue?: string, newValue?: string) =>
  prisma.ticketHistory.create({ data: { ticketId, event, actor, oldValue, newValue } });

export const ticketInclude = {
  requester: { select: { id: true, name: true, email: true, locale: true, department: true } },
  assignee: { include: { user: { select: { name: true, email: true } } } },
  category: true,
  aiAnalysis: true,
  slaInstance: true,
  duplicateOf: { select: { id: true, ticketNumber: true, subject: true } },
  comments: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
  attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true }, orderBy: { uploadedAt: "asc" as const } },
} satisfies Prisma.TicketInclude;

export const getFullTicket = (id: string) => prisma.ticket.findUnique({ where: { id }, include: ticketInclude });
type Full = NonNullable<Awaited<ReturnType<typeof getFullTicket>>>;

const INTERNAL_EVENT = /^(AI |Auto-assigned|Internal|Manually reassigned|Rule|Marked)/;

/** What a requester is allowed to see: no internal notes, AI internals, sentiment or routing history. */
export function requesterView(t: Full) {
  return {
    ...t,
    aiAnalysis: null, aiSummary: null, aiSummaryProvider: null, sentiment: null, needsTriage: false,
    comments: t.comments.filter((c) => !c.internal),
    history: t.history.filter((h) => !INTERNAL_EVENT.test(h.event)),
    assignee: t.assignee ? { id: t.assignee.id, team: t.assignee.team, user: { name: t.assignee.user.name } } : null,
  };
}

export function assertCanView(t: { requesterId: string }, user: JwtPayload) {
  if (user.role === "END_USER" && t.requesterId !== user.sub) throw new ApiError(403, "You do not have access to this ticket");
}

// ------------------------------------------------------------------ assignment
async function loadCandidates(categoryId: string | null): Promise<CandidateEmployee[]> {
  const [employees, open, expertise, risky] = await Promise.all([
    prisma.employee.findMany({ where: { user: { active: true } }, include: { user: { select: { name: true } }, skills: { include: { skill: true } } } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, status: { notIn: CLOSED_STATUSES as TicketStatus[] } }, _count: true }),
    categoryId ? prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, categoryId, status: { in: ["RESOLVED", "CLOSED"] } }, _count: true }) : Promise.resolve([]),
    prisma.ticket.findMany({ where: { assigneeId: { not: null }, status: { notIn: CLOSED_STATUSES as TicketStatus[] }, slaInstance: { status: { in: ["AT_RISK", "BREACHED"] } } }, select: { assigneeId: true } }),
  ]);
  const openMap = new Map(open.map((o) => [o.assigneeId, o._count as number]));
  const expMap = new Map(expertise.map((o) => [o.assigneeId, o._count as number]));
  const riskMap = new Map<string, number>();
  risky.forEach((r) => riskMap.set(r.assigneeId!, (riskMap.get(r.assigneeId!) ?? 0) + 1));
  const now = new Date();
  return employees.map((e) => ({
    id: e.id, name: e.user.name, team: e.team, available: e.available, avgResolutionHrs: e.avgResolutionHrs, capacity: e.capacity,
    openTicketCount: openMap.get(e.id) ?? 0,
    skillLevels: Object.fromEntries(e.skills.map((s) => [s.skill.name, s.level])),
    resolvedInCategoryCount: expMap.get(e.id) ?? 0,
    onShift: onShift(now, e.timezone, e.workDays, e.shiftStartMin, e.shiftEndMin),
    atRiskTicketCount: riskMap.get(e.id) ?? 0,
  }));
}

/** Re-run AI routing for an existing ticket (used by the "reassign via AI" rule action and the UI). */
export async function autoAssign(ticketId: string, actor = "system") {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { category: true, aiAnalysis: true } });
  if (!t) throw new ApiError(404, "Ticket not found");
  const skills = t.aiAnalysis?.requiredSkills?.length ? t.aiAnalysis.requiredSkills : t.category?.requiredSkills ?? [];
  const { winner } = pickAssignee(skills, await loadCandidates(t.categoryId), await getWeights());
  if (!winner) return null;
  await assignTicket(ticketId, winner.employeeId, actor, `Auto-assigned by AI (${winner.composite}% match)`);
  return winner;
}

export async function assignTicket(ticketId: string, employeeId: string, actor: string, event = "Manually reassigned") {
  const [t, emp] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: ticketId } }),
    prisma.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  if (!t) throw new ApiError(404, "Ticket not found");
  if (!emp) throw new ApiError(404, "Employee not found");
  const status: TicketStatus = (["NEW", "AI_ANALYSIS", "REOPENED", "ESCALATED"] as string[]).includes(t.status) ? "ASSIGNED" : t.status;
  await prisma.ticket.update({ where: { id: t.id }, data: { assigneeId: emp.id, status, needsTriage: false } });
  await logHistory(t.id, event, actor, t.assigneeId ?? undefined, emp.user.name);
  emitToStaff("ticket:assigned", { ticketId: t.id, assigneeId: emp.id });
  await notifyUser(emp.user.id, { type: "assignment", message: `${t.ticketNumber} was assigned to you: ${t.subject}`, link: link(t.id) });
  void dispatchEvent("ticket.assigned", { title: `${t.ticketNumber} assigned to ${emp.user.name}`, ticketNumber: t.ticketNumber, url: env.APP_URL + link(t.id) });
}

// -------------------------------------------------------------------- creation
export interface CreateInput {
  subject: string;
  description: string;
  requesterId: string;
  actor: string;
  actorIsStaff: boolean;
  channel?: Channel;
  overrides?: { category?: string; priority?: Priority; type?: TicketType };
  /** Text used for classification and duplicate detection when `description` also carries other material (e.g. a transcript). */
  aiText?: string;
}

/** Raise → classify → detect duplicates → set SLA → route → notify. Shared by web, email and chat channels. */
export async function createTicket(input: CreateInput) {
  const aiBase = input.aiText ?? input.description;
  const ai = await classifyTicket(input.subject, aiBase, { userId: input.requesterId });
  const aiSettings = await getSetting("ai");
  const duplicates = await findDuplicates(input.subject, aiBase, { requesterId: input.requesterId });

  // Only staff may override AI priority/type — otherwise everyone would pick P1.
  const priority: Priority = (input.actorIsStaff && input.overrides?.priority) || ai.priority;
  const type: TicketType = (input.actorIsStaff && input.overrides?.type) || ai.type;
  const categoryName = input.overrides?.category?.trim() || ai.category;

  let category = await prisma.category.findFirst({ where: { name: categoryName, active: true } });
  if (!category) {
    category = await prisma.category.create({ data: { name: categoryName, subcategory: ai.subcategory, service: ai.service, requiredSkills: ai.requiredSkills } });
  }

  const needsTriage = ai.confidence < aiSettings.minConfidenceForAutoAssign;
  const { winner, ranked } = pickAssignee(ai.requiredSkills.length ? ai.requiredSkills : category.requiredSkills, await loadCandidates(category.id), await getWeights());
  const assign = winner && !needsTriage ? winner : null;

  const [policy, calendar] = await Promise.all([prisma.sLAPolicy.findUnique({ where: { priority } }), getCalendar()]);
  const now = new Date();
  const due = computeDueDates(priority, policy, calendar, now);
  const ticketNumber = await nextTicketNumber();

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber, subject: input.subject, description: input.description, requesterId: input.requesterId,
      channel: input.channel ?? "WEB", type, language: ai.language, sentiment: ai.sentiment,
      categoryId: category.id, priority, impact: ai.impact, urgency: ai.urgency,
      status: assign ? "ASSIGNED" : "NEW", assigneeId: assign?.employeeId, needsTriage: needsTriage || !winner,
      aiAnalysis: {
        create: {
          category: ai.category, subcategory: ai.subcategory, priority: ai.priority, type: ai.type, confidence: ai.confidence, provider: ai.provider,
          language: ai.language, sentiment: ai.sentiment, rootCause: ai.rootCause, requiredSkills: ai.requiredSkills,
          similarTickets: duplicates.map((d) => d.ticketNumber),
          assignmentReason: winner
            ? ({ winner, runnerUp: ranked[1] ?? null, autoAssigned: !!assign, minConfidence: aiSettings.minConfidenceForAutoAssign } as any)
            : { note: "No eligible employee found" },
        },
      },
      slaInstance: {
        create: {
          policyId: (policy ?? (await prisma.sLAPolicy.upsert({ where: { priority }, update: {}, create: { priority, responseMins: 60, resolutionMins: 1440 } }))).id,
          startedAt: now, responseDue: due.responseDue, resolutionDue: due.resolutionDue, businessHoursOnly: due.businessHoursOnly,
          status: computeSLAStatus(now, due.resolutionDue, now),
        },
      },
      history: {
        create: [
          { event: "Ticket created", actor: input.actor, newValue: `via ${input.channel ?? "WEB"}` },
          { event: "AI classification completed", actor: "system", newValue: `${ai.category}/${ai.subcategory} · ${ai.type} · ${ai.priority} (${Math.round(ai.confidence)}% confidence, ${ai.provider})` },
          ...(assign ? [{ event: "Auto-assigned by AI", actor: "system", newValue: `${assign.name} (${assign.composite}% match)` }] : []),
          ...(needsTriage ? [{ event: "AI confidence below threshold — sent to human triage", actor: "system", newValue: `${Math.round(ai.confidence)}% < ${aiSettings.minConfidenceForAutoAssign}%` }] : []),
          ...(duplicates.length ? [{ event: "AI flagged possible duplicates", actor: "system", newValue: duplicates.map((d) => d.ticketNumber).join(", ") }] : []),
        ],
      },
    },
    include: ticketInclude,
  });

  // Side effects (never block or fail ticket creation).
  void afterCreate(ticket, assign?.employeeId ?? null, needsTriage || !winner).catch(() => undefined);
  return { ticket, duplicates };
}

async function afterCreate(t: Full, assigneeEmployeeId: string | null, triage: boolean) {
  emitToUser(t.requesterId, "ticket:created", { ticketId: t.id, ticketNumber: t.ticketNumber });
  emitToStaff("ticket:created", { ticketId: t.id, ticketNumber: t.ticketNumber, priority: t.priority });
  await notifyUser(t.requesterId, { type: "ticket", message: `${t.ticketNumber} received — ${t.subject}`, link: link(t.id), email: { subject: `[${t.ticketNumber}] We received your request`, text: `Thanks — we've logged "${t.subject}" as ${t.ticketNumber}.\n\nTrack it: ${env.APP_URL}${link(t.id)}` } });
  if (assigneeEmployeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: assigneeEmployeeId }, select: { userId: true } });
    if (emp) await notifyUser(emp.userId, { type: "assignment", message: `${t.ticketNumber} (${t.priority}) assigned to you: ${t.subject}`, link: link(t.id) });
  }
  if (triage) await notifyStaff({ type: "triage", message: `${t.ticketNumber} needs human triage (low AI confidence)`, link: link(t.id) });
  void dispatchEvent("ticket.created", { title: `${t.ticketNumber} [${t.priority}] ${t.subject}`, ticketNumber: t.ticketNumber, url: env.APP_URL + link(t.id) });
  await checkCluster(t);
}

const alertedClusters = new Map<string, number>();
async function checkCluster(t: Full) {
  const clusters = await detectClusters();
  const mine = clusters.find((c) => c.ticketIds.includes(t.id));
  if (!mine) return;
  const key = mine.ticketIds.slice().sort()[0];
  const last = alertedClusters.get(key) ?? 0;
  if (mine.count <= last) return;
  alertedClusters.set(key, mine.count);
  await prisma.ticket.updateMany({ where: { id: { in: mine.ticketIds } }, data: { isMajor: true } });
  const msg = `Possible major incident: ${mine.count} similar tickets (${mine.categoryName}) — e.g. "${mine.sampleSubject}"`;
  await notifyStaff({ type: "incident", message: msg, link: "/dashboard" });
  void dispatchEvent("incident.cluster", { title: msg, count: mine.count, tickets: mine.ticketNumbers });
}

// ---------------------------------------------------------------------- status
const REQUESTER_ALLOWED = (from: string, to: string) => (to === "CLOSED" && from === "RESOLVED") || (to === "REOPENED" && ["RESOLVED", "CLOSED"].includes(from)) || (to === "CANCELLED" && !["RESOLVED", "CLOSED", "CANCELLED"].includes(from));

export async function changeStatus(ticketId: string, to: TicketStatus, user: JwtPayload, opts: { resolutionNotes?: string } = {}) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { slaInstance: true } });
  if (!t) throw new ApiError(404, "Ticket not found");
  assertCanView(t, user);
  if (t.status === to) return t;
  const staff = user.role !== "END_USER";
  if (!staff && !REQUESTER_ALLOWED(t.status, to)) throw new ApiError(403, "You can only close, reopen or cancel your own tickets");
  if (["CLOSED", "CANCELLED"].includes(t.status) && to !== "REOPENED") throw new ApiError(409, `A ${t.status.toLowerCase()} ticket can only be reopened`);
  if (["NEW", "AI_ANALYSIS"].includes(to)) throw new ApiError(400, "That status is set automatically");

  const now = new Date();
  const data: Prisma.TicketUpdateInput = { status: to };
  if (to === "RESOLVED") { data.resolvedAt = now; if (opts.resolutionNotes) data.resolutionNotes = opts.resolutionNotes; }
  if (to === "CLOSED") { data.closedAt = now; if (!t.resolvedAt) data.resolvedAt = now; }
  if (to === "REOPENED") { data.resolvedAt = null; data.closedAt = null; data.reopenCount = { increment: 1 }; }
  if (staff && !t.firstResponseAt && (["ACCEPTED", "IN_PROGRESS"] as string[]).includes(to)) data.firstResponseAt = now;

  const sla = t.slaInstance;
  if (sla) {
    const slaData: Prisma.SLAInstanceUpdateInput = {};
    const nowPaused = PAUSED_STATUSES.includes(to);
    if (nowPaused && !sla.pausedAt) slaData.pausedAt = now;
    if (!nowPaused && sla.pausedAt) {
      const cal = await getCalendar();
      slaData.pausedAt = null;
      slaData.resolutionDue = extendForPause(sla.resolutionDue, sla.pausedAt, now, sla.businessHoursOnly, cal);
      if (!sla.responseMetAt) slaData.responseDue = extendForPause(sla.responseDue, sla.pausedAt, now, sla.businessHoursOnly, cal);
    }
    if (staff && !sla.responseMetAt && (["ACCEPTED", "IN_PROGRESS", "RESOLVED"] as string[]).includes(to)) slaData.responseMetAt = now;
    if (to === "RESOLVED") slaData.status = now > sla.resolutionDue ? "BREACHED" : "HEALTHY";
    if (Object.keys(slaData).length) await prisma.sLAInstance.update({ where: { id: sla.id }, data: slaData });
  }

  await prisma.ticket.update({ where: { id: t.id }, data });
  await logHistory(t.id, "Status changed", user.email, t.status, to);
  emitToUser(t.requesterId, "ticket:updated", { ticketId: t.id, status: to });
  emitToStaff("ticket:updated", { ticketId: t.id, status: to });

  if (staff && ["RESOLVED", "PENDING_USER"].includes(to)) {
    const msg = to === "RESOLVED" ? `${t.ticketNumber} was resolved — please confirm it works for you` : `${t.ticketNumber} needs more information from you`;
    await notifyUser(t.requesterId, { type: "ticket", message: msg, link: link(t.id), email: { subject: `[${t.ticketNumber}] ${msg}`, text: `${msg}\n\n${env.APP_URL}${link(t.id)}` } });
  }
  if (to === "RESOLVED") void dispatchEvent("ticket.resolved", { title: `${t.ticketNumber} resolved`, ticketNumber: t.ticketNumber, url: env.APP_URL + link(t.id) });
  return t;
}

export async function setPriority(ticketId: string, priority: Priority, actor: string) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { slaInstance: true } });
  if (!t) throw new ApiError(404, "Ticket not found");
  if (t.priority === priority) return;
  const [policy, cal] = await Promise.all([prisma.sLAPolicy.findUnique({ where: { priority } }), getCalendar()]);
  await prisma.ticket.update({ where: { id: t.id }, data: { priority } });
  if (t.slaInstance && policy) {
    const due = computeDueDates(priority, policy, cal, t.slaInstance.startedAt);
    await prisma.sLAInstance.update({ where: { id: t.slaInstance.id }, data: { policyId: policy.id, responseDue: due.responseDue, resolutionDue: due.resolutionDue, businessHoursOnly: due.businessHoursOnly, status: computeSLAStatus(t.slaInstance.startedAt, due.resolutionDue) } });
  }
  await logHistory(t.id, "Priority changed", actor, t.priority, priority);
}

export async function escalate(ticketId: string, actor: string, reason?: string) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!t) throw new ApiError(404, "Ticket not found");
  await prisma.ticket.update({ where: { id: t.id }, data: { status: "ESCALATED" } });
  await logHistory(t.id, reason ? `Escalated: ${reason}` : "Escalated", actor, t.status, "ESCALATED");
  emitToStaff("ticket:escalated", { ticketId: t.id, ticketNumber: t.ticketNumber });
  await notifyStaff({ type: "escalation", message: `${t.ticketNumber} escalated${reason ? ` — ${reason}` : ""}`, link: link(t.id) }, { adminsOnly: true });
  void dispatchEvent("ticket.escalated", { title: `${t.ticketNumber} escalated${reason ? `: ${reason}` : ""}`, ticketNumber: t.ticketNumber, url: env.APP_URL + link(t.id) });
}

// -------------------------------------------------------------------- comments
export async function addComment(ticketId: string, user: JwtPayload, body: string, internal: boolean, aiAssisted = false) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { slaInstance: true, assignee: { select: { userId: true } } } });
  if (!t) throw new ApiError(404, "Ticket not found");
  assertCanView(t, user);
  const staff = user.role !== "END_USER";
  const isInternal = staff && internal;

  const comment = await prisma.ticketComment.create({
    data: { ticketId: t.id, authorId: user.sub, body, internal: isInternal, aiAssisted: staff && aiAssisted },
    include: { author: { select: { name: true, role: true } } },
  });
  await prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
  await logHistory(t.id, isInternal ? "Internal note added" : "Comment added", user.email);

  if (staff && !isInternal) {
    const now = new Date();
    if (!t.firstResponseAt) await prisma.ticket.update({ where: { id: t.id }, data: { firstResponseAt: now } });
    if (t.slaInstance && !t.slaInstance.responseMetAt) await prisma.sLAInstance.update({ where: { id: t.slaInstance.id }, data: { responseMetAt: now } });
    emitToUser(t.requesterId, "ticket:comment", { ticketId: t.id, comment });
    await notifyUser(t.requesterId, { type: "reply", message: `New reply on ${t.ticketNumber}`, link: link(t.id), email: { subject: `[${t.ticketNumber}] New reply`, text: `${comment.author.name} replied:\n\n${body}\n\n${env.APP_URL}${link(t.id)}` } });
  }
  if (!staff) {
    // A requester reply resumes a ticket that was waiting on them.
    if (t.status === "PENDING_USER") await changeStatus(t.id, "IN_PROGRESS", { ...user, role: "AGENT" });
    if (t.assignee) await notifyUser(t.assignee.userId, { type: "reply", message: `${t.ticketNumber}: requester replied`, link: link(t.id) });
    emitToStaff("ticket:comment", { ticketId: t.id });
  }
  return comment;
}
