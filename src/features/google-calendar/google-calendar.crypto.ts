import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { ApiError } from "../../shared/api-error";

function key() {
  if (!env.appEncryptionKey) throw new ApiError(503, "Google Calendar is not configured");
  return createHash("sha256").update(env.appEncryptionKey).digest();
}

export function encryptCalendarToken(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptCalendarToken(value: string) {
  const [iv, tag, encrypted, extra] = value.split(".");
  if (!iv || !tag || !encrypted || extra) throw new ApiError(503, "Stored Google Calendar credentials are invalid");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ApiError(503, "Stored Google Calendar credentials are invalid"); }
}
