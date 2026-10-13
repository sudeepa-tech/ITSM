import { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma, Priority, SLAStatus, TicketStatus, TicketType } from "@prisma/client";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { isStaff } from "../middleware/rbac";
import { audit } from "../services/audit";
import { CLOSED_STATUSES } from "../services/sla/slaService";
import { storage, validateUpload } from "../services/storage";
import * as svc from "../services/ticketService";
import { pageArgs, pageQuery } from "../utils/pagination";

const csv = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------------- create
const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(10_000),
  category: z.string().max(80).optional(),
  priority: z.nativeEnum(Priority).optional(),
  type: z.nativeEnum(TicketType).optional(),
  deflectionEventId: z.string().optional(),
});

export async function createTicket(req: Request, res: Response) {
  if (req.user!.role === "END_USER") throw new ApiError(403, "Employees raise requests through the assistant. Open New ticket and describe the problem in the chat.", "USE_ASSISTANT");
  const b = createSchema.parse(req.body);
  const { ticket, duplicates } = await svc.createTicket({
    subject: b.subject, description: b.description, requesterId: req.user!.sub, actor: req.user!.email, actorIsStaff: isStaff(req),
    channel: "WEB", overrides: { category: b.category, priority: b.priority, type: b.type },
  });
  if (b.deflectionEventId) await prisma.deflectionEvent.updateMany({ where: { id: b.deflectionEventId, userId: req.user!.sub }, data: { outcome: "TICKET_CREATED" } });
  const view = isStaff(req) ? ticket : svc.requesterView(ticket);
  res.status(201).json({ ...view, duplicates: isStaff(req) ? duplicates : [] });
}

// ----------------------------------------------------------------------- list
const listSchema = pageQuery.extend({
  status: z.string().optional(), priority: z.string().optional(), type: z.string().optional(), q: z.string().max(100).optional(),
  assignedToMe: z.enum(["true", "false"]).optional(), sla: z.string().optional(), unassigned: z.enum(["true", "false"]).optional(), needsTriage: z.enum(["true", "false"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "priority", "sla", "sentiment"]).default("createdAt"), dir: z.enum(["asc", "desc"]).default("desc"),
});

export async function listTickets(req: Request, res: Response) {
  const q = listSchema.parse(req.query);
  const user = req.user!;
  const and: Prisma.TicketWhereInput[] = [];
  if (user.role === "END_USER") and.push({ requesterId: user.sub });
  const statuses = csv(q.status);
  if (statuses.includes("OPEN")) and.push({ status: { notIn: CLOSED_STATUSES as TicketStatus[] } });
  else if (statuses.length) and.push({ status: { in: statuses as TicketStatus[] } });
  if (q.priority) and.push({ priority: { in: csv(q.priority) as Priority[] } });
  if (q.type) and.push({ type: q.type as TicketType });
  if (q.unassigned === "true") and.push({ assigneeId: null });
  if (q.sla && user.role !== "END_USER") and.push({ slaInstance: { status: { in: csv(q.sla) as SLAStatus[] } } });
  if (q.needsTriage === "true" && user.role !== "END_USER") and.push({ needsTriage: true });
  if (q.assignedToMe === "true" && user.role !== "END_USER") {
    const emp = await prisma.employee.findUnique({ where: { userId: user.sub } });
    and.push({ assigneeId: emp?.id ?? "__none__" });
  }
  if (q.q) and.push({ OR: [{ ticketNumber: { contains: q.q, mode: "insensitive" } }, { subject: { contains: q.q, mode: "insensitive" } }, { requester: { name: { contains: q.q, mode: "insensitive" } } }] });
  const where: Prisma.TicketWhereInput = { AND: and };

  const orderBy: Prisma.TicketOrderByWithRelationInput[] =
    q.sort === "sla" ? [{ slaInstance: { resolutionDue: q.dir } }] : q.sort === "sentiment" ? [{ sentiment: { sort: q.dir, nulls: "last" } }] : [{ [q.sort]: q.dir } as any];
  orderBy.push({ createdAt: "desc" });

  const staff = user.role !== "END_USER";
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where, orderBy, ...pageArgs(q),
      select: {
        id: true, ticketNumber: true, subject: true, priority: true, status: true, type: true, channel: true, language: true, createdAt: true, updatedAt: true, isMajor: true,
        sentiment: staff, needsTriage: staff,
        requester: { select: { name: true } }, category: { select: { name: true } },
        assignee: { select: { id: true, team: true, user: { select: { name: true } } } },
        slaInstance: { select: { status: true, responseDue: true, resolutionDue: true, pausedAt: true } },
      },
    }),
  ]);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}

export async function stats(req: Request, res: Response) {
  const emp = await prisma.employee.findUnique({ where: { userId: req.user!.sub } });
  const open: Prisma.TicketWhereInput = { status: { notIn: CLOSED_STATUSES as TicketStatus[] } };
  const [mine, unassigned, triage, atRisk, breached, major] = await Promise.all([
    prisma.ticket.count({ where: { ...open, assigneeId: emp?.id ?? "__none__" } }),
    prisma.ticket.count({ where: { ...open, assigneeId: null } }),
    prisma.ticket.count({ where: { ...open, needsTriage: true } }),
    prisma.ticket.count({ where: { ...open, slaInstance: { status: "AT_RISK" } } }),
    prisma.ticket.count({ where: { ...open, slaInstance: { status: "BREACHED" } } }),
    prisma.ticket.count({ where: { ...open, isMajor: true } }),
  ]);
  res.json({ mine, unassigned, triage, atRisk, breached, major });
}

// ------------------------------------------------------------------ read/update
export async function getTicket(req: Request, res: Response) {
  const t = await svc.getFullTicket(req.params.id);
  if (!t) throw new ApiError(404, "Ticket not found");
  svc.assertCanView(t, req.user!);
  res.json(isStaff(req) ? t : svc.requesterView(t));
}

const statusSchema = z.object({ status: z.nativeEnum(TicketStatus), resolutionNotes: z.string().max(5000).optional() });
export async function updateStatus(req: Request, res: Response) {
  const b = statusSchema.parse(req.body);
  await svc.changeStatus(req.params.id, b.status, req.user!, { resolutionNotes: b.resolutionNotes });
  const t = (await svc.getFullTicket(req.params.id))!;
  res.json(isStaff(req) ? t : svc.requesterView(t));
}

const patchSchema = z.object({ priority: z.nativeEnum(Priority).optional(), type: z.nativeEnum(TicketType).optional(), category: z.string().max(80).optional(), tags: z.array(z.string().max(30)).max(10).optional() });
export async function patchTicket(req: Request, res: Response) {
  const b = patchSchema.parse(req.body);
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id }, include: { category: true } });
  if (!t) throw new ApiError(404, "Ticket not found");
  if (b.priority) await svc.setPriority(t.id, b.priority, req.user!.email);
  const data: Prisma.TicketUpdateInput = {};
  if (b.type && b.type !== t.type) { data.type = b.type; await svc.logHistory(t.id, "Type changed", req.user!.email, t.type, b.type); }
  if (b.tags) data.tags = b.tags;
  if (b.category && b.category !== t.category?.name) {
    const c = (await prisma.category.findFirst({ where: { name: b.category, active: true } })) ?? (await prisma.category.create({ data: { name: b.category, requiredSkills: [] } }));
    data.category = { connect: { id: c.id } };
    await svc.logHistory(t.id, "Category changed", req.user!.email, t.category?.name, b.category);
  }
  if (Object.keys(data).length) await prisma.ticket.update({ where: { id: t.id }, data });
  res.json(await svc.getFullTicket(t.id));
}

export async function addComment(req: Request, res: Response) {
  const b = z.object({ body: z.string().trim().min(1).max(10_000), internal: z.boolean().optional(), aiAssisted: z.boolean().optional() }).parse(req.body);
  res.status(201).json(await svc.addComment(req.params.id, req.user!, b.body, !!b.internal, !!b.aiAssisted));
}

export async function assign(req: Request, res: Response) {
  const { employeeId } = z.object({ employeeId: z.string() }).parse(req.body);
  await svc.assignTicket(req.params.id, employeeId, req.user!.email);
  res.json(await svc.getFullTicket(req.params.id));
}

export async function autoAssign(req: Request, res: Response) {
  const winner = await svc.autoAssign(req.params.id, req.user!.email);
  if (!winner) throw new ApiError(409, "No eligible agent is available right now");
  res.json(await svc.getFullTicket(req.params.id));
}

export async function escalate(req: Request, res: Response) {
  await svc.escalate(req.params.id, req.user!.email, z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {}).reason);
  res.json(await svc.getFullTicket(req.params.id));
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["assign", "status", "priority"]),
  value: z.string(),
});
export async function bulk(req: Request, res: Response) {
  const b = bulkSchema.parse(req.body);
  let ok = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of b.ids) {
    try {
      if (b.action === "assign") await svc.assignTicket(id, b.value, req.user!.email);
      else if (b.action === "status") await svc.changeStatus(id, z.nativeEnum(TicketStatus).parse(b.value), req.user!);
      else await svc.setPriority(id, z.nativeEnum(Priority).parse(b.value), req.user!.email);
      ok++;
    } catch (e) {
      failed.push({ id, error: (e as Error).message });
    }
  }
  await audit(req, `ticket.bulk_${b.action}`, "Ticket", undefined, undefined, { count: ok, value: b.value });
  res.json({ updated: ok, failed });
}

export async function feedback(req: Request, res: Response) {
  const b = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).parse(req.body);
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) throw new ApiError(404, "Ticket not found");
  if (t.requesterId !== req.user!.sub) throw new ApiError(403, "Only the requester can rate this ticket");
  if (!["RESOLVED", "CLOSED"].includes(t.status)) throw new ApiError(409, "You can rate a ticket once it is resolved");
  await prisma.ticket.update({ where: { id: t.id }, data: { csatScore: b.score, csatComment: b.comment, csatAt: new Date() } });
  await svc.logHistory(t.id, "Marked satisfaction rating", req.user!.email, undefined, `${b.score}/5`);
  res.status(204).end();
}

// ---------------------------------------------------------------- attachments
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 } });

export async function addAttachments(req: Request, res: Response) {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) throw new ApiError(404, "Ticket not found");
  svc.assertCanView(t, req.user!);
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw new ApiError(400, "No files were uploaded");
  const saved = [];
  for (const f of files) {
    const name = Buffer.from(f.originalname, "latin1").toString("utf8"); // multer decodes as latin1
    const v = validateUpload(name, f.buffer);
    if (typeof v === "string") throw new ApiError(400, `${name}: ${v}`);
    const key = await storage.save(f.buffer);
    saved.push(await prisma.ticketAttachment.create({ data: { ticketId: t.id, fileName: v.safeName, mimeType: v.mime, sizeBytes: f.size, storageKey: key, uploadedById: req.user!.sub }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true } }));
  }
  await svc.logHistory(t.id, "Attachment added", req.user!.email, undefined, saved.map((s) => s.fileName).join(", "));
  res.status(201).json(saved);
}

export async function downloadAttachment(req: Request, res: Response) {
  const a = await prisma.ticketAttachment.findUnique({ where: { id: req.params.attId }, include: { ticket: { select: { requesterId: true } } } });
  if (!a || a.ticketId !== req.params.id) throw new ApiError(404, "Attachment not found");
  svc.assertCanView(a.ticket, req.user!);
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  storage.open(a.storageKey).on("error", () => res.status(404).end()).pipe(res);
}
