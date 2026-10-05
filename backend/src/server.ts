import http from "http";
import app from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/db";
import { startAutomation, stopAutomation } from "./services/automation";
import { closeSocket, initSocket } from "./services/socket";

const server = http.createServer(app);
initSocket(server);
startAutomation();

server.listen(env.PORT, () => logger.info(`Northbeam ITSM API listening on :${env.PORT} (${env.NODE_ENV})`));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopAutomation();
  closeSocket();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
