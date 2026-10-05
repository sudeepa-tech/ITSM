import { NextFunction, Request, Response } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Verifies the Bearer access token. Role and identity always come from the token, never the body. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing or malformed Authorization header" });
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token", code: "TOKEN_EXPIRED" });
  }
}
