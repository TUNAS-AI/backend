import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { tunasController } from "./tunas.controller";

const router = Router();
router.use(requireAuth);
router.get("/messages", tunasController.messages);
router.get("/interactions", tunasController.interactions);
router.post("/daily-check", tunasController.dailyCheck);
router.post("/messages/read", tunasController.markRead);
router.post("/actions/:messageId", tunasController.act);
router.post("/test-alerts/:scenario", tunasController.test);
router.post("/interactions", tunasController.interact);
router.post("/pending/:pendingActionId/approve", tunasController.approve);
router.post("/pending/:pendingActionId/reject", tunasController.reject);
router.get("/missions/:id/timeline", tunasController.timeline);
router.get("/missions/:id/reports", tunasController.reports);
export default router;
