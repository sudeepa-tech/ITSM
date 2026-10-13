import "dotenv/config";
import { z } from "zod";

const bool = (d: boolean) =>
  z.enum(["true", "false", "1", "0"]).default(d ? "true" : "false").transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(14),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  TRUST_PROXY: z.coerce.number().default(0),
  ALLOW_REGISTRATION: bool(true),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  AI_TIMEOUT_MS: z.coerce.number().default(20_000),
  AI_REDACT_PII: bool(true),
  // Files
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  // Email
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Northbeam ITSM <no-reply@itsm.local>"),
  INBOUND_EMAIL_SECRET: z.string().optional(),
  APP_URL: z.string().default("http://localhost:5173"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${msg}`);
}
if (parsed.data.NODE_ENV === "production" && /replace-with|changeme|secret$/i.test(parsed.data.JWT_SECRET)) {
  throw new Error("Refusing to start in production with a placeholder JWT_SECRET.");
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
