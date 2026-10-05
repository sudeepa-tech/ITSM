import pino from "pino";
import { env, isProd } from "./env";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "*.password", "*.passwordHash"],
  transport: !isProd && env.NODE_ENV !== "test" ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } : undefined,
});
