import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../utils/jwt";
import { env } from "../config/env";

let io: Server | null = null;

/** Socket.io authenticated with the same short-lived access token as REST. Each socket joins
 * `user:<id>` (targeted events) and, for staff, `staff` (queue-wide events). */
export function initSocket(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN, credentials: true } });
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Invalid auth token"));
    }
  });
  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.sub}`);
    if (user.role === "AGENT" || user.role === "ADMIN") socket.join("staff");
  });
  return io;
}

export const emitToUser = (userId: string, event: string, payload: unknown) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToStaff = (event: string, payload: unknown) => io?.to("staff").emit(event, payload);
export const closeSocket = () => io?.close();
