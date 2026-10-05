import { NextFunction, Request, Response } from "express";

type Role = "END_USER" | "AGENT" | "ADMIN";

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions for this action" });
  next();
};

export const isStaff = (req: Request) => req.user?.role === "AGENT" || req.user?.role === "ADMIN";
