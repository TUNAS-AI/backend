import type { NextFunction, Response } from "express";

export class ApiError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

export function sendApiError(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof ApiError) return response.status(error.status).json({ error: error.message });
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") return response.status(409).json({ error: "A record with these values already exists" });
    if (error.code === "P2003" || error.code === "P2025") return response.status(404).json({ error: "Referenced resource not found" });
  }
  next(error);
}
