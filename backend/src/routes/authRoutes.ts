import { Router } from "express";
import rateLimit from "express-rate-limit";
import { changePassword, login, logout, me, refresh, register, updatePreferences } from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts, please try again later." } });

router.post("/register", limiter, asyncHandler(register));
router.post("/login", limiter, asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
router.post("/logout", asyncHandler(logout));
router.get("/me", requireAuth, asyncHandler(me));
router.patch("/me", requireAuth, asyncHandler(updatePreferences));
router.post("/change-password", requireAuth, limiter, asyncHandler(changePassword));

export default router;
