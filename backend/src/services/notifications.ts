import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import nodemailer from "nodemailer";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { emitToStaff, emitToUser } from "./socket";

// ------------------------------------------------------------------ in-app + email
let mailer: nodemailer.Transporter | null | undefined;
function getMailer() {
  if (mailer === undefined) mailer = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
  return mailer;
}

export async function sendEmail(to: string, subject: string, text: string) {
  const m = getMailer();
  if (!m) return false;
  try {
    await m.sendMail({ from: env.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    logger.error({ err }, "email send failed");
    return false;
  }
}

export interface NotifyInput { type: string; message: string; link?: string; email?: { subject: string; text: string } }

/** Persist an in-app notification, push it over the socket and (optionally) email the user. */
export async function notifyUser(userId: string, n: NotifyInput) {
  const row = await prisma.notification.create({ data: { userId, type: n.type, message: n.message, link: n.link } });
  emitToUser(userId, "notification", row);
  if (n.email) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (u) void sendEmail(u.email, n.email.subject, n.email.text);
  }
}

export async function notifyStaff(n: NotifyInput, opts: { adminsOnly?: boolean } = {}) {
  const staff = await prisma.user.findMany({ where: { role: opts.adminsOnly ? "ADMIN" : { in: ["AGENT", "ADMIN"] }, active: true }, select: { id: true } });
  if (!staff.length) return;
  await prisma.notification.createMany({ data: staff.map((s) => ({ userId: s.id, type: n.type, message: n.message, link: n.link })) });
  emitToStaff("notification", { type: n.type, message: n.message, link: n.link, createdAt: new Date() });
}

// ------------------------------------------------------------------------ webhooks
/** Reject webhook targets that could reach internal infrastructure (SSRF). */
export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  const dev = env.NODE_ENV !== "production";
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) throw new Error("Webhook URLs must use https");
  if (dev && ["localhost", "127.0.0.1"].includes(u.hostname)) return;
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(address)) {
      throw new Error("Webhook URL resolves to a private or reserved address");
    }
  }
}

export type EventName = "ticket.created" | "ticket.assigned" | "ticket.escalated" | "ticket.resolved" | "sla.at_risk" | "sla.breached" | "incident.cluster";

type Hook = { id: string; kind: string; url: string; secret: string | null };

export async function deliverToHook(h: Hook, event: string, payload: { title: string; url?: string; [k: string]: unknown }) {
  const text = `[${event}] ${payload.title}${payload.url ? ` — ${payload.url}` : ""}`;
  const body = h.kind === "GENERIC" ? JSON.stringify({ event, ...payload, sentAt: new Date().toISOString() }) : JSON.stringify({ text });
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Northbeam-ITSM-Webhook/2" };
  if (h.secret) headers["x-itsm-signature"] = "sha256=" + crypto.createHmac("sha256", h.secret).update(body).digest("hex");
  let status = 0;
  let error: string | undefined;
  try {
    await assertPublicUrl(h.url);
    const res = await fetch(h.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000), redirect: "error" });
    status = res.status;
  } catch (err) {
    error = (err as Error).message;
    logger.warn({ err, hook: h.id }, "webhook delivery failed");
  }
  await prisma.webhook.update({
    where: { id: h.id },
    data: { lastStatus: status, lastDeliveryAt: new Date(), failureCount: status >= 200 && status < 300 ? 0 : { increment: 1 } },
  });
  return { status, error };
}

export async function dispatchEvent(event: EventName, payload: { title: string; ticketNumber?: string; url?: string; [k: string]: unknown }) {
  const hooks = await prisma.webhook.findMany({ where: { enabled: true, events: { has: event } } });
  await Promise.allSettled(hooks.map((h) => deliverToHook(h, event, payload)));
}
