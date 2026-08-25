import type { NextFunction, Request, Response } from "express";
import { getSupabase } from "../infrastructure/supabase";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authIdentity?: {
        email: string | null;
        displayName: string | null;
      };
    }
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const [scheme, token] = request.header("authorization")?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    response.status(401).json({ error: "A Supabase bearer token is required" });
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    response.status(503).json({ error: "Authentication is not configured" });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    response.status(401).json({ error: "Invalid or expired bearer token" });
    return;
  }

  request.userId = data.user.id;
  const metadata = data.user.user_metadata;
  const displayName = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string"
      ? metadata.name
      : null;
  request.authIdentity = { email: data.user.email ?? null, displayName };
  next();
}
