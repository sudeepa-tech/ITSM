import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler as h } from "../utils/asyncHandler";
import * as c from "../controllers/ticketController";

const r = Router();
r.use(requireAuth);
const staff = requireRole("AGENT", "ADMIN");

r.post("/", h(c.createTicket));
r.get("/", h(c.listTickets));
r.get("/stats", staff, h(c.stats));
r.post("/bulk", staff, h(c.bulk));
r.get("/:id", h(c.getTicket));
r.patch("/:id", staff, h(c.patchTicket));
r.post("/:id/comments", h(c.addComment));
r.patch("/:id/status", h(c.updateStatus)); // role rules enforced in the service
r.post("/:id/assign", staff, h(c.assign));
r.post("/:id/auto-assign", staff, h(c.autoAssign));
r.post("/:id/escalate", staff, h(c.escalate));
r.post("/:id/feedback", h(c.feedback));
r.post("/:id/attachments", c.upload.array("files", 5), h(c.addAttachments));
r.get("/:id/attachments/:attId", h(c.downloadAttachment));

export default r;
