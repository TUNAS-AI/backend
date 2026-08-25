import type { Request, Response } from "express";
import { env } from "../../config/env";
import { googleSignInUrl } from "./google-oauth.service";
import { swaggerGoogleAuthCallbackPath } from "./auth.types";
import { googleCallbackPage } from "./google-callback.page";

function frontendCallbackUrl(): string {
  return `${env.frontendUrl}/auth/callback`;
}

function swaggerCallbackUrl(request: Request): string {
  return `${request.protocol}://localhost:${env.port}${swaggerGoogleAuthCallbackPath}`;
}

export function startGoogleSignIn(request: Request, response: Response) {
  if (!env.supabaseUrl) {
    response.status(503).json({ error: "Google sign-in is not configured" });
    return;
  }

  response.redirect(302, googleSignInUrl(env.supabaseUrl, frontendCallbackUrl()));
}

export function startSwaggerGoogleSignIn(request: Request, response: Response) {
  if (!env.supabaseUrl) {
    response.status(503).json({ error: "Google sign-in is not configured" });
    return;
  }

  response.redirect(302, googleSignInUrl(env.supabaseUrl, swaggerCallbackUrl(request)));
}

export function showGoogleCallback(_request: Request, response: Response) {
  response.type("html").send(googleCallbackPage());
}
