import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { logger } from "../config/logger";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  if (err instanceof MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large" : "Upload failed: " + err.message });
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return res.status(404).json({ error: "Record not found" });
    if (err.code === "P2002") return res.status(409).json({ error: "A record with these values already exists" });
  }
  logger.error({ err, requestId: (req as any).id }, "unhandled error");
  return res.status(500).json({ error: "Internal server error", requestId: (req as any).id });
}
