import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { farmController } from "./farm.controller";
const router = Router(); router.use(requireAuth); router.get("/snapshot", farmController.snapshot); router.route("/").get(farmController.get).post(farmController.create).patch(farmController.update).delete(farmController.delete);
export default router;
