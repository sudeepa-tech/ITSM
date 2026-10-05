import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { isStaff } from "../middleware/rbac";
import { searchKb } from "../services/ai/knowledge";
import * as svc from "../services/ticketService";
import { stripQuoted } from "../utils/email";
import { pageArgs, pageQuery } from "../utils/pagination";

// ------------------------------------------------------------- notifications
export async function listNotifications(req: Request, res: Response) {
  const q = pageQuery.parse(req.query);
  const where = { userId: req.user!.sub };
  const [total, unread, items] = await Promise.all([
    prisma.notification.count({ where }), prisma.notification.count({ where: { ...where, read: false } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
  ]);
  res.json({ items, total, unread });
}
export async function markRead(req: Request, res: Response) {
  const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
  await prisma.notification.updateMany({ where: { userId: req.user!.sub, read: false, ...(ids ? { id: { in: ids } } : {}) }, data: { read: true } });
  res.status(204).end();
}

// -------------------------------------------------------------- global search
export async function search(req: Request, res: Response) {
  const q = z.string().trim().min(2).max(100).parse(req.query.q);
  const user = req.user!;
  const [tickets, articles] = await Promise.all([
    prisma.ticket.findMany({
      where: { AND: [user.role === "END_USER" ? { requesterId: user.sub } : {}, { OR: [{ ticketNumber: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }] }] },
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true }, orderBy: { createdAt: "desc" }, take: 6,
    }),
    searchKb(q, 4),
  ]);
  res.json({ tickets, articles: articles.map((a) => ({ id: a.article.id, title: a.article.title, category: a.article.category })) });
}

// ---------------------------------------------------------------- inbound email
/** POST /api/inbound/email — normalised payload from your mail provider's inbound-parse webhook. */
export async function inboundEmail(req: Request, res: Response) {
  const secret = env.INBOUND_EMAIL_SECRET;
  const given = String(req.get("x-inbound-secret") ?? "");
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) throw new ApiError(401, "Invalid inbound secret");
  const b = z.object({ from: z.string().email().transform((s) => s.toLowerCase()), name: z.string().max(80).optional(), subject: z.string().min(1).max(200), text: z.string().min(1).max(50_000) }).parse(req.body);

  let user = await prisma.user.findUnique({ where: { email: b.from } });
  if (!user) user = await prisma.user.create({ data: { email: b.from, name: b.name ?? b.from.split("@")[0], passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10), role: "END_USER" } });
  if (!user.active) throw new ApiError(403, "Sender account is disabled");
  const body = stripQuoted(b.text) || b.text.slice(0, 2000);

  const ref = b.subject.match(/\[?(INC-\d{5,})\]?/i)?.[1]?.toUpperCase();
  const existing = ref ? await prisma.ticket.findUnique({ where: { ticketNumber: ref } }) : null;
  if (existing && (existing.requesterId === user.id || user.role !== "END_USER")) {
    await svc.addComment(existing.id, { sub: user.id, role: user.role, email: user.email }, body, false);
    return res.status(200).json({ action: "comment_added", ticketNumber: existing.ticketNumber });
  }
  const { ticket } = await svc.createTicket({ subject: b.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 200), description: body, requesterId: user.id, actor: user.email, actorIsStaff: false, channel: "EMAIL" });
  res.status(201).json({ action: "ticket_created", ticketNumber: ticket.ticketNumber });
}

// ------------------------------------------------------------------- health
export async function ready(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
}
export { isStaff };
