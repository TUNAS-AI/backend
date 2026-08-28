import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { tunasController } from "./tunas.controller";

const router = Router();
router.use(requireAuth);
router.get("/messages", tunasController.messages);
router.post("/daily-check", tunasController.dailyCheck);
router.post("/messages/read", tunasController.markRead);
router.post("/actions/:messageId", tunasController.act);
router.post("/test-alerts/:scenario", tunasController.test);
export default router;
