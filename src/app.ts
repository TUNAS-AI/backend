import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./config/env";
import healthRouter from "./features/health/health.routes";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json());

app.get("/", (_request, response) => {
  response.json({ service: "hijau-ai-backend" });
});
app.use("/health", healthRouter);
app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});
app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error.message);
  response.status(500).json({ error: "Internal server error" });
});

export default app;
