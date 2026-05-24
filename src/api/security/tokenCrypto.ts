import crypto from "node:crypto";
import { apiConfig } from "../config";

const algorithm = "aes-256-gcm";

function getKey(): Buffer {
  const raw = apiConfig.encryptionKey;

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }

  throw new Error("BOT_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex chars.");
}

export function encryptToken(token: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(encryptedToken: string): string {
  const key = getKey();
  const [ivRaw, authTagRaw, ciphertextRaw] = encryptedToken.split(".");

  if (!ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error("Encrypted token payload is malformed.");
  }

  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
