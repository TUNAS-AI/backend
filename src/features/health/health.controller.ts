import type { Request, Response } from "express";

export function getHealth(_request: Request, response: Response) {
  response.status(200).json({
    status: "ok",
    service: "hijau-ai-backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
