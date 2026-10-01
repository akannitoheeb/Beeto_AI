const SUPABASE_URL = "https://jouvcvrnsegzecqdkody.supabase.co";
const { encryptSecret } = require("../lib/secretBox");

const ALLOWED_PROVIDERS = new Set(["brevo", "mailchimp", "klaviyo"]);
const MAILCHIMP_DC_RE = /^[a-z]{2}\d+$/i;

async function verifySupabaseToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY }
  });
  if (!response.ok) return null;
  return response.json();
}

function supabaseHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Prefer": "resolution=merge-duplicates,return=representation"
  };
}

module.exports = async function (req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await verifySupabaseToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Not logged in." });

  const { provider, access_token, refresh_token, expires_at, provider_account_id } = req.body || {};
  if (!provider || !access_token) return res.status(400).json({ error: "Missing data." });
  if (!ALLOWED_PROVIDERS.has(provider)) return res.status(400).json({ error: "Unknown provider." });
  // provider_account_id is used to build https://<dc>.api.mailchimp.com, so it must be a bare datacenter code.
  if (provider === "mailchimp" && !MAILCHIMP_DC_RE.test(String(provider_account_id || ""))) {
    return res.status(400).json({ error: "Invalid Mailchimp datacenter." });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/integrations?on_conflict=user_id,provider`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify([{
      user_id: user.id,
      provider,
      access_token: encryptSecret(access_token),
      refresh_token: encryptSecret(refresh_token),
      token_expires_at: expires_at,
      provider_account_id
    }])
  });

  if (!response.ok) {
    console.error("save-integration failed:", await response.text());
    return res.status(500).json({ error: "Could not save integration." });
  }

  res.status(200).json({ ok: true });
};
