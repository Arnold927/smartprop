import crypto from "crypto";

export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex"); // hex token
}

export function tokenExpiry(hours: number): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hours);
  return expiry;
}
