import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { googleCalendarController } from "./google-calendar.controller";

const router = Router();
router.get("/callback", googleCalendarController.callback);
router.use(requireAuth);
router.get("/", googleCalendarController.status);
router.post("/connect", googleCalendarController.connect);
router.post("/sync", googleCalendarController.sync);
router.delete("/", googleCalendarController.disconnect);

export default router;
