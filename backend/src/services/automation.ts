import { Prisma, Priority, SLAStatus, TicketStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { autoAssign, escalate, logHistory, setPriority } from "./ticketService";
import { dispatchEvent, notifyStaff } from "./notifications";
import { emitToStaff } from "./socket";
import { CLOSED_STATUSES, PAUSED_STATUSES, computeSLAStatus } from "./sla/slaService";

// ------------------------------------------------------------- rule definitions
export const conditionsSchema = z.object({
  priority: z.array(z.nativeEnum(Priority)).optional(),
  status: z.array(z.nativeEnum(TicketStatus)).optional(),
  slaStatus: z.array(z.nativeEnum(SLAStatus)).optional(),
  olderThanMins: z.number().int().min(1).optional(),
  unassignedForMins: z.number().int().min(1).optional(),
  noResponseForMins: z.number().int().min(1).optional(),
  sentimentBelow: z.number().min(-1).max(1).optional(),
});
export type Conditions = z.infer<typeof conditionsSchema>;
export const ACTIONS = ["ESCALATE", "NOTIFY_ADMINS", "BUMP_PRIORITY", "AI_REASSIGN"] as const;

const ago = (mins: number) => new Date(Date.now() - mins * 60_000);

function toWhere(c: Conditions, ruleId: string): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [{ status: { notIn: CLOSED_STATUSES as TicketStatus[] } }, { ruleExecutions: { none: { ruleId } } }];
  if (c.priority?.length) and.push({ priority: { in: c.priority } });
  if (c.status?.length) and.push({ status: { in: c.status } });
  if (c.slaStatus?.length) and.push({ slaInstance: { status: { in: c.slaStatus } } });
  if (c.olderThanMins) and.push({ createdAt: { lte: ago(c.olderThanMins) } });
  if (c.unassignedForMins) and.push({ assigneeId: null, createdAt: { lte: ago(c.unassignedForMins) } });
  if (c.noResponseForMins) and.push({ firstResponseAt: null, createdAt: { lte: ago(c.noResponseForMins) } });
  if (c.sentimentBelow !== undefined) and.push({ sentiment: { lt: c.sentimentBelow } });
  return { AND: and };
}

const BUMP: Record<Priority, Priority> = { P1: "P1", P2: "P1", P3: "P2", P4: "P3" };

export async function runRules() {
  const rules = await prisma.escalationRule.findMany({ where: { enabled: true }, orderBy: { position: "asc" } });
  for (const rule of rules) {
    const parsed = conditionsSchema.safeParse(rule.conditions);
    if (!parsed.success) continue;
    const tickets = await prisma.ticket.findMany({ where: toWhere(parsed.data, rule.id), select: { id: true, ticketNumber: true, subject: true, priority: true }, take: 100 });
    for (const t of tickets) {
      // Claim first: the unique (ruleId, ticketId) row makes each rule fire at most once per ticket.
      try {
        await prisma.ruleExecution.create({ data: { ruleId: rule.id, ticketId: t.id } });
      } catch {
        continue;
      }
      const actor = `rule:${rule.name}`;
      try {
        if (rule.actionType === "ESCALATE") await escalate(t.id, actor, rule.name);
        else if (rule.actionType === "NOTIFY_ADMINS") {
          await notifyStaff({ type: "rule", message: `${t.ticketNumber}: ${rule.name}`, link: `/tickets/${t.id}` }, { adminsOnly: true });
          await logHistory(t.id, `Rule fired: ${rule.name}`, actor);
        } else if (rule.actionType === "BUMP_PRIORITY") {
          await setPriority(t.id, BUMP[t.priority], actor);
          await logHistory(t.id, `Rule fired: ${rule.name}`, actor, t.priority, BUMP[t.priority]);
        } else if (rule.actionType === "AI_REASSIGN") {
          const w = await autoAssign(t.id, actor);
          await logHistory(t.id, `Rule fired: ${rule.name}`, actor, undefined, w?.name ?? "no eligible agent");
        }
      } catch (err) {
        logger.error({ err, rule: rule.id, ticket: t.id }, "rule action failed");
      }
    }
  }
}

// ---------------------------------------------------------------- SLA monitor
export async function runSlaCheck() {
  const now = new Date();
  const open = await prisma.sLAInstance.findMany({
    where: { pausedAt: null, ticket: { status: { notIn: [...CLOSED_STATUSES, ...PAUSED_STATUSES] as TicketStatus[] } } },
    include: { ticket: { select: { id: true, ticketNumber: true, subject: true } } },
  });
  for (const inst of open) {
    const next = computeSLAStatus(inst.startedAt, inst.resolutionDue, now);
    const data: Prisma.SLAInstanceUpdateInput = {};
    if (next !== inst.status) {
      data.status = next;
      if (next === "BREACHED") data.breachedAt = now;
    }
    if (!inst.responseMetAt && !inst.responseBreachedAt && now > inst.responseDue) data.responseBreachedAt = now;
    if (!Object.keys(data).length) continue;
    await prisma.sLAInstance.update({ where: { id: inst.id }, data });
    if (next !== inst.status && (next === "AT_RISK" || next === "BREACHED")) {
      const label = next === "BREACHED" ? "breached" : "at risk";
      emitToStaff("sla:alert", { ticketId: inst.ticketId, ticketNumber: inst.ticket.ticketNumber, status: next });
      await notifyStaff({ type: "sla", message: `SLA ${label}: ${inst.ticket.ticketNumber} — ${inst.ticket.subject}`, link: `/tickets/${inst.ticketId}` }, { adminsOnly: true });
      void dispatchEvent(next === "BREACHED" ? "sla.breached" : "sla.at_risk", { title: `${inst.ticket.ticketNumber} SLA ${label}`, ticketNumber: inst.ticket.ticketNumber, url: `${env.APP_URL}/tickets/${inst.ticketId}` });
    }
  }
}

/** Only one API instance runs the tick: a transaction-scoped Postgres advisory lock elects the leader. */
async function tick() {
  await prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(727201) AS locked`;
      if (!locked) return;
      await runSlaCheck();
      await runRules();
    },
    { timeout: 55_000, maxWait: 5_000 }
  );
}

let timer: NodeJS.Timeout | null = null;
export function startAutomation(intervalMs = 60_000) {
  timer = setInterval(() => tick().catch((err) => logger.error({ err }, "automation tick failed")), intervalMs);
  timer.unref();
}
export const stopAutomation = () => timer && clearInterval(timer);
export { tick as runAutomationOnce };
