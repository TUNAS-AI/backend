import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { ApiError } from "../../shared/api-error";
import { FarmService } from "../farm/farm.service";

const sessionRouter = Router();
const farms = new FarmService();

export function sessionPayload(request: {
  userId?: string;
  authIdentity?: { email: string | null; displayName: string | null };
}, hasFarm: boolean) {
  return {
    userId: request.userId,
    email: request.authIdentity?.email ?? null,
    displayName: request.authIdentity?.displayName ?? null,
    hasFarm,
  };
}

sessionRouter.get("/session", requireAuth, async (request, response, next) => {
  try {
    if (!request.userId) throw new ApiError(401, "A Supabase bearer token is required");
    response.json(sessionPayload(request, await farms.hasFarm(request.userId)));
  } catch (error) {
    next(error);
  }
});

export default sessionRouter;
