import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { telegramController } from "./telegram.controller";

const router = Router();
router.post("/webhook", telegramController.webhook);
router.get("/", requireAuth, telegramController.status);
router.post("/connect", requireAuth, telegramController.connect);
export default router;
