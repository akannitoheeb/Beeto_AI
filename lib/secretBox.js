// AES-256-GCM helper for storing third-party tokens (Brevo/Mailchimp/Klaviyo).
// Set INTEGRATION_ENC_KEY in Vercel to a 32-byte key encoded as base64 or hex:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// If the key is missing, values pass through unchanged so nothing breaks.
// Old plaintext rows keep working: only values starting with "enc:v1:" are decrypted.
const crypto = require("crypto");
const PREFIX = "enc:v1:";

function getKey() {
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

function encryptSecret(value) {
  if (value == null || value === "") return value;
  const key = getKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptSecret(value) {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) throw new Error("INTEGRATION_ENC_KEY is missing, cannot decrypt stored token.");
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
