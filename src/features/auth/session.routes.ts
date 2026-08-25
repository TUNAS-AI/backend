import { Router } from "express";
import { requireAuth } from "../../middleware/auth";

const sessionRouter = Router();

export function sessionPayload(request: {
  userId?: string;
  authIdentity?: { email: string | null; displayName: string | null };
}) {
  return {
    userId: request.userId,
    email: request.authIdentity?.email ?? null,
    displayName: request.authIdentity?.displayName ?? null,
  };
}

sessionRouter.get("/session", requireAuth, (request, response) => {
  response.json(sessionPayload(request));
});

export default sessionRouter;
