import { Request } from "express";
import { prisma } from "../config/db";
import { logger } from "../config/logger";

/** Append-only audit trail for security- and configuration-relevant actions. Never throws. */
export async function audit(req: Request | null, action: string, entity: string, entityId?: string, oldValue?: unknown, newValue?: unknown, actorOverride?: string) {
  try {
    await prisma.auditLog.create({
      data: {
        actor: actorOverride ?? req?.user?.email ?? "system",
        action, entity, entityId,
        oldValue: oldValue as any, newValue: newValue as any,
        ip: req?.ip,
      },
    });
  } catch (err) {
    logger.error({ err, action }, "audit write failed");
  }
}
