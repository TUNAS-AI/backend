import type { Request, Response } from "express";
import { getAgentModelConfig } from "../../agent/runtime";
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
    getAgentModelConfig();
    if (!process.env.DATABASE_URL?.trim() || !process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_ANON_KEY?.trim() || !process.env.MISSION_PREVIEW_SECRET?.trim()) throw new Error("Required mission configuration is missing");
    await getPrisma().$queryRaw`SELECT 1`;
    response.status(200).json({ status: "ready", service: "hijau-ai-backend" });
  } catch {
    response.status(503).json({ status: "not_ready", error: "Mission service dependencies are not ready" });
  }
}
