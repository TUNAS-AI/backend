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

export function authIdentityFromClaims(claims: unknown) {
  if (typeof claims !== "object" || claims === null) return null;
  const value = claims as Record<string, unknown>;
  if (typeof value.sub !== "string") return null;
  const metadata = typeof value.user_metadata === "object" && value.user_metadata !== null ? value.user_metadata as Record<string, unknown> : {};
  const displayName = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string"
      ? metadata.name
      : null;
  return { userId: value.sub, email: typeof value.email === "string" ? value.email : null, displayName };
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

  const { data, error } = await supabase.auth.getClaims(token);
  const identity = error ? null : authIdentityFromClaims(data?.claims);
  if (!identity) {
    response.status(401).json({ error: "Invalid or expired bearer token" });
    return;
  }

  request.userId = identity.userId;
  request.authIdentity = { email: identity.email, displayName: identity.displayName };
  next();
}
