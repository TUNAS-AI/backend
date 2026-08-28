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
router.get("/:id/replan", missionController.replanDraft);
router.post("/:id/replan/interpret", missionController.interpretReplan);
router.post("/:id/replan/plan", missionController.planReplan);
router.post("/:id/replan/confirm", missionController.confirmReplan);
router.post("/:id/stage", missionController.advance);
router.post("/:id/steps/:stepId/status", missionController.updateStepStatus);
router.post("/:id/closeout", missionController.closeout);
router.post("/:id/closeout/confirm", missionController.confirmCloseout);

export { previewRouter };
export default router;
