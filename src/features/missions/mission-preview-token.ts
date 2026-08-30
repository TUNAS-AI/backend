import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../shared/api-error";

const ttlMs = 30 * 60 * 1000;
type SignedPayload = { exp: number; [key: string]: unknown };

function secret() {
  const value = process.env.MISSION_PREVIEW_SECRET?.trim();
  if (!value) throw new ApiError(409, "MISSION_PREVIEW_SECRET is required for mission confirmation");
  return value;
}
function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }

export function signPreview<T extends Record<string, unknown>>(payload: T) {
  const body = encode({ ...payload, exp: Date.now() + ttlMs });
  return `${body}.${sign(body)}`;
}
export function verifyPreview<T extends SignedPayload>(token: string): T {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new ApiError(400, "previewToken is invalid", "PREVIEW_TOKEN_INVALID");
  const expected = Buffer.from(sign(body)); const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new ApiError(400, "previewToken is invalid", "PREVIEW_TOKEN_INVALID");
  let payload: T;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { throw new ApiError(400, "previewToken is invalid", "PREVIEW_TOKEN_INVALID"); }
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) throw new ApiError(409, "Mission preview has expired; plan again", "PREVIEW_EXPIRED");
  return payload;
}
