import type { Request, Response } from "express";
import { getPrisma } from "../../infrastructure/prisma";

export function getHealth(_request: Request, response: Response) {
  response.status(200).json({
    status: "ok",
    service: "hijau-ai-backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

export async function getReadiness(_request: Request, response: Response) {
  try {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error("DATABASE_URL is required");
    }
    await getPrisma().$queryRaw`SELECT 1`;
    response.status(200).json({ status: "ready", service: "hijau-ai-backend" });
  } catch {
    response.status(503).json({ status: "not_ready", error: "Database dependency is not ready" });
  }
}
