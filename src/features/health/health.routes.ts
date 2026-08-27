import { Router } from "express";
import { getHealth, getReadiness } from "./health.controller";

const healthRouter = Router();

healthRouter.get("/", getHealth);
healthRouter.get("/ready", getReadiness);

export default healthRouter;
