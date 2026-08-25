import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { onboardingController } from "./onboarding.controller";

const router = Router();
router.use(requireAuth);
router.post("/", onboardingController.create);

export default router;
