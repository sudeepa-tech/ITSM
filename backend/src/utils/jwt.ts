import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  sub: string;
  role: "END_USER" | "AGENT" | "ADMIN";
  email: string;
}

export const signAccessToken = (p: JwtPayload) =>
  jwt.sign(p, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"], issuer: "northbeam-itsm" });

export const verifyAccessToken = (token: string): JwtPayload => {
  const d = jwt.verify(token, env.JWT_SECRET, { issuer: "northbeam-itsm" }) as JwtPayload;
  return { sub: d.sub, role: d.role, email: d.email };
};
