import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { missionController } from "./mission.controller";

const previewRouter = Router();
previewRouter.use(requireAuth);
previewRouter.post("/interpret", missionController.interpretPreview);
previewRouter.post("/plan", missionController.planPreview);

const router = Router();
router.use(requireAuth);
router.route("/").get(missionController.list).post(missionController.confirm);
router.get("/calendar", missionController.calendar);
router.get("/:id", missionController.get);
router.delete("/:id", missionController.delete);
router.post("/:id/stage", missionController.advance);
router.post("/:id/steps/:stepId/status", missionController.updateStepStatus);
router.post("/:id/closeout", missionController.closeout);
router.post("/:id/closeout/confirm", missionController.confirmCloseout);

export { previewRouter };
export default router;
