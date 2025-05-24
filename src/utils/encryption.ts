import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const ALGORITHM = "aes-256-cbc";
// IMPORTANT: ENCRYPTION_KEY must be 32 characters (256 bits) for aes-256-cbc
// Generate a strong key: require('crypto').randomBytes(32).toString('hex')
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
// IV must be 16 characters (128 bits)
const IV_STRING = process.env.ENCRYPTION_IV;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  // 32 bytes = 64 hex chars
  throw new Error(
    "ENCRYPTION_KEY is missing or not 32 bytes (64 hex characters). Please set it in .env"
  );
}
if (!IV_STRING || IV_STRING.length !== 32) {
  // 16 bytes = 32 hex chars
  throw new Error(
    "ENCRYPTION_IV is missing or not 16 bytes (32 hex characters). Please set it in .env"
  );
}

const key = Buffer.from(ENCRYPTION_KEY, "hex");
const iv = Buffer.from(IV_STRING, "hex");

export function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function decrypt(encryptedText: string): string {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    // For refresh tokens, failure to decrypt means re-authentication is needed.
    throw new Error(
      "Failed to decrypt token. Re-authentication may be required."
    );
  }
}
