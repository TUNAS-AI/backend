import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./config/env";
import { openApiDocument } from "./config/openapi";
import authRouter from "./features/auth/auth.routes";
import sessionRouter from "./features/auth/session.routes";
import { swaggerTokenHandoffScript } from "./features/auth/swagger-token-handoff.script";
import buyerCommitmentRouter from "./features/buyer-commitments/buyer-commitment.routes";
import cropBatchRouter from "./features/crop-batches/crop-batch.routes";
import farmRouter from "./features/farm/farm.routes";
import fieldBlockRouter from "./features/field-blocks/field-block.routes";
import healthRouter from "./features/health/health.routes";
import onboardingRouter from "./features/onboarding/onboarding.routes";

const swaggerUi = require("swagger-ui-express");

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json());

app.get("/", (_request, response) => {
  response.json({ service: "hijau-ai-backend" });
});
app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/farm", farmRouter);
app.use("/api/field-blocks", fieldBlockRouter);
app.use("/api/crop-batches", cropBatchRouter);
app.use("/api/buyer-commitments", buyerCommitmentRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api", sessionRouter);
app.get("/api/openapi.json", (_request, response) => {
  response.json(openApiDocument);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, {
  customSiteTitle: "Hijau AI API Docs",
  customJsStr: swaggerTokenHandoffScript,
}));
app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});
app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error.message);
  response.status(500).json({ error: "Internal server error" });
});

export default app;
