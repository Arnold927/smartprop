/**
 * server/utils/credentialEncryption.ts
 *
 * AES-256-GCM encryption for secrets that must be stored at rest — currently
 * used for per-landlord Daraja (Lipa Na M-Pesa Online) consumer secrets and
 * passkeys in landlordPaymentSettings. These are genuine API credentials,
 * not display data, so they're encrypted rather than stored in the freeform
 * payment-info JSONB alongside things like a Paybill number or instructions
 * text.
 *
 * Requires CREDENTIALS_ENCRYPTION_KEY — a 32-byte key, base64 or hex encoded.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Stored format: base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with: " +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
      "and set it as an environment variable before storing any landlord M-Pesa credentials."
    );
  }
  // Accept either base64 or hex — whichever decodes to exactly 32 bytes.
  const asBase64 = Buffer.from(raw, "base64");
  if (asBase64.length === 32) return asBase64;
  const asHex = Buffer.from(raw, "hex");
  if (asHex.length === 32) return asHex;
  throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex).");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted credential — expected 3 parts");
  const [ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/** True if CREDENTIALS_ENCRYPTION_KEY is configured — lets callers give a
 *  clear setup error instead of an opaque crypto exception. */
export function encryptionConfigured(): boolean {
  try { getKey(); return true; } catch { return false; }
}

/** Masks a secret for display — e.g. in a settings page confirming a
 *  passkey is saved without ever showing it again. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return "••••" + plaintext.slice(-4);
}