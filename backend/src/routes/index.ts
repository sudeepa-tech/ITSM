import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler as h } from "../utils/asyncHandler";
import authRoutes from "./authRoutes";
import ticketRoutes from "./ticketRoutes";
import * as ai from "../controllers/aiController";
import * as va from "../controllers/virtualAgentController";
import * as kb from "../controllers/kbController";
import * as a from "../controllers/adminController";
import * as m from "../controllers/miscController";

const router = Router();
const staff = requireRole("AGENT", "ADMIN");
const admin = requireRole("ADMIN");
// AI endpoints cost money and CPU: cap per authenticated user, not per IP.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.sub ?? req.ip ?? "anon", message: { error: "AI request limit reached. Please wait a moment." } });

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.get("/ready", h(m.ready));
router.post("/inbound/email", rateLimit({ windowMs: 60_000, max: 60 }), h(m.inboundEmail));

router.use("/auth", authRoutes);
router.use("/tickets", ticketRoutes);

const ar = Router();
ar.use(requireAuth, aiLimiter);
ar.post("/analyze-ticket", h(ai.analyzeTicket));
ar.post("/deflect", h(ai.deflect));
ar.post("/deflect/:id/outcome", h(ai.deflectionOutcome));
ar.post("/feedback", h(ai.feedback));
ar.get("/clusters", staff, h(ai.clusters));
ar.get("/tickets/:id/insights", staff, h(ai.insights));
ar.post("/tickets/:id/summary", staff, h(ai.summary));
ar.post("/tickets/:id/reply-draft", staff, h(ai.replyDraft));
ar.post("/tickets/:id/resolution-notes", staff, h(ai.resolutionNotes));
ar.post("/tickets/:id/kb-draft", staff, h(ai.kbDraft));
ar.post("/translate", staff, h(ai.translate));
router.use("/ai", ar);

const vr = Router();
vr.use(requireAuth, aiLimiter);
vr.post("/chat", h(va.chat));
vr.post("/:id/resolve", h(va.resolve));
vr.post("/:id/ticket", h(va.toTicket));
router.use("/virtual-agent", vr);

const kr = Router();
kr.use(requireAuth);
kr.get("/", h(kb.list));
kr.get("/categories", h(kb.categories));
kr.get("/:id", h(kb.get));
kr.post("/:id/feedback", h(kb.feedback));
kr.post("/", staff, h(kb.create));
kr.put("/:id", staff, h(kb.update));
kr.delete("/:id", admin, h(kb.remove));
router.use("/kb", kr);

router.get("/search", requireAuth, h(m.search));
router.get("/notifications", requireAuth, h(m.listNotifications));
router.post("/notifications/read", requireAuth, h(m.markRead));
router.get("/directory", requireAuth, staff, h(a.directory));

const adm = Router();
adm.use(requireAuth, admin);
adm.get("/analytics", h(a.analytics));
adm.get("/ai-interactions", h(a.aiInteractions));
adm.get("/employees", h(a.listEmployees));
adm.patch("/employees/:id", h(a.updateEmployee));
adm.put("/employees/:id/skills", h(a.setSkills));
adm.get("/skills", h(a.listSkills));
adm.get("/users", h(a.listUsers));
adm.post("/users", h(a.createUser));
adm.patch("/users/:id", h(a.updateUser));
adm.get("/sla-policies", h(a.listPolicies));
adm.put("/sla-policies/:priority", h(a.updatePolicy));
adm.get("/settings", h(a.getSettings));
adm.put("/settings/:key", h(a.putSetting));
adm.get("/rules", h(a.listRules));
adm.post("/rules", h(a.createRule));
adm.patch("/rules/:id", h(a.updateRule));
adm.delete("/rules/:id", h(a.deleteRule));
adm.get("/webhooks", h(a.listHooks));
adm.post("/webhooks", h(a.createHook));
adm.patch("/webhooks/:id", h(a.updateHook));
adm.delete("/webhooks/:id", h(a.deleteHook));
adm.post("/webhooks/:id/test", h(a.testHook));
adm.get("/audit", h(a.auditLog));
router.use("/admin", adm);

export default router;
