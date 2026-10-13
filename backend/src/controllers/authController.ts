import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/db";
import { env, isProd } from "../config/env";
import { signAccessToken } from "../utils/jwt";
import { ApiError } from "../middleware/errorHandler";
import { audit } from "../services/audit";

export const LOCALES = ["en", "es", "fr", "de", "pt", "hi", "ar", "ja"];
const COOKIE = "itsm_rt";
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10); // equalises timing for unknown emails

const password = z.string().min(8).max(128).regex(/[A-Za-z]/, "Password needs a letter").regex(/\d/, "Password needs a digit");
const registerSchema = z.object({ name: z.string().min(2).max(80), email: z.string().email().transform((s) => s.toLowerCase()), password, department: z.string().max(80).optional(), locale: z.enum(LOCALES as [string, ...string[]]).optional() });
const loginSchema = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1) });
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const publicUser = (u: { id: string; name: string; email: string; role: any; department?: string | null; locale: string; timezone: string }) =>
  ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, locale: u.locale, timezone: u.timezone });

async function issue(req: Request, res: Response, user: Parameters<typeof publicUser>[0], family: string = crypto.randomUUID()) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: sha(raw), family, expiresAt, userAgent: req.get("user-agent")?.slice(0, 200), ip: req.ip } });
  res.cookie(COOKIE, raw, { httpOnly: true, sameSite: "strict", secure: isProd, path: "/api/auth", expires: expiresAt });
  return { accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email }), user: publicUser(user) };
}

/** Cookie-authenticated endpoints: SameSite=Strict already blocks cross-site sends; also verify Origin when present. */
function sameOrigin(req: Request) {
  const o = req.get("origin");
  if (o && o !== env.CLIENT_ORIGIN) throw new ApiError(403, "Cross-origin request blocked");
}

export async function register(req: Request, res: Response) {
  if (!env.ALLOW_REGISTRATION) throw new ApiError(403, "Self-registration is disabled. Ask your administrator for an account.");
  const b = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw new ApiError(409, "An account with this email already exists");
  const user = await prisma.user.create({ data: { name: b.name, email: b.email, department: b.department, locale: b.locale ?? "en", passwordHash: await bcrypt.hash(b.password, 12), role: "END_USER" } });
  await audit(req, "auth.register", "User", user.id, undefined, { email: user.email }, user.email);
  res.status(201).json(await issue(req, res, user));
}

export async function login(req: Request, res: Response) {
  const b = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: b.email } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}.`, "ACCOUNT_LOCKED");
  }
  const ok = await bcrypt.compare(b.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    if (user) {
      const fails = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: fails } });
    }
    await audit(req, "auth.login_failed", "User", user?.id, undefined, { email: b.email }, b.email);
    throw new ApiError(401, "Invalid email or password");
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit(req, "auth.login", "User", user.id, undefined, undefined, user.email);
  res.json(await issue(req, res, user));
}

export async function refresh(req: Request, res: Response) {
  sameOrigin(req);
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (!raw) throw new ApiError(401, "No session");
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha(raw) }, include: { user: true } });
  if (!row) throw new ApiError(401, "Invalid session");
  if (row.revokedAt) {
    // A rotated token was replayed: assume theft and kill the whole token family.
    await prisma.refreshToken.updateMany({ where: { family: row.family, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, "auth.refresh_reuse_detected", "User", row.userId, undefined, undefined, row.user.email);
    res.clearCookie(COOKIE, { path: "/api/auth" });
    throw new ApiError(401, "Session invalidated. Please sign in again.");
  }
  if (row.expiresAt < new Date() || !row.user.active) throw new ApiError(401, "Session expired");
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  res.json(await issue(req, res, row.user, row.family));
}

export async function logout(req: Request, res: Response) {
  sameOrigin(req);
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (raw) await prisma.refreshToken.updateMany({ where: { tokenHash: sha(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(COOKIE, { path: "/api/auth" });
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) throw new ApiError(404, "User not found");
  res.json(publicUser(user));
}

const prefsSchema = z.object({ name: z.string().min(2).max(80).optional(), locale: z.enum(LOCALES as [string, ...string[]]).optional(), timezone: z.string().refine(validTz, "Unknown time zone").optional() });
export async function updatePreferences(req: Request, res: Response) {
  const b = prefsSchema.parse(req.body);
  res.json(publicUser(await prisma.user.update({ where: { id: req.user!.sub }, data: b })));
}

export async function changePassword(req: Request, res: Response) {
  const b = z.object({ currentPassword: z.string(), newPassword: password }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!(await bcrypt.compare(b.currentPassword, user.passwordHash))) throw new ApiError(400, "Current password is incorrect");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(b.newPassword, 12) } });
  await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }); // sign out everywhere
  await audit(req, "auth.password_changed", "User", user.id);
  res.status(204).end();
}
