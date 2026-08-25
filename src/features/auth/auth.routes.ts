import { Router } from "express";
import { showGoogleCallback, startGoogleSignIn, startSwaggerGoogleSignIn } from "./google-auth.controller";

const authRouter = Router();

authRouter.get("/google", startGoogleSignIn);
authRouter.get("/google/swagger", startSwaggerGoogleSignIn);
authRouter.get("/google/callback", showGoogleCallback);

export default authRouter;
