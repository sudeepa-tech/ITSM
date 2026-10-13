import crypto from "crypto";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler } from "./middleware/errorHandler";
import routes from "./routes";

const app = express();
if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY);
app.disable("x-powered-by");

app.use((req, res, next) => {
  (req as any).id = req.get("x-request-id") ?? crypto.randomUUID();
  res.setHeader("x-request-id", (req as any).id);
  next();
});
app.use(pinoHttp({ logger, genReqId: (req) => (req as any).id, autoLogging: { ignore: (req) => req.url === "/api/health" } }));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === "/api/health" }));

app.use("/api", routes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

export default app;
