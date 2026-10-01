// ============================================================
// /api/integrations: ONE function that replaces three:
//   list-integrations, save-integration, disconnect-integration
//
// Why: Vercel's Hobby plan allows at most 12 functions (one per file in
// /api). vercel.json rewrites keep the old URLs working, so the frontend
// (script.js, oauth-finish.html) doesn't need to change:
//   /api/list-integrations       -> /api/integrations?action=list
//   /api/save-integration        -> /api/integrations?action=save
//   /api/disconnect-integration  -> /api/integrations?action=disconnect
// ============================================================
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

function serviceHeaders(extra = {}) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

async function listIntegrations(req, res, user) {
  if (req.method !== "GET") return res.status(405).end();
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/integrations?user_id=eq.${user.id}&select=provider,created_at`,
    { headers: serviceHeaders() }
  );
  const integrations = await response.json();
  return res.status(200).json({ integrations: Array.isArray(integrations) ? integrations : [] });
}

async function saveIntegration(req, res, user) {
  if (req.method !== "POST") return res.status(405).end();

  const { provider, access_token, refresh_token, expires_at, provider_account_id } = req.body || {};
  if (!provider || !access_token) return res.status(400).json({ error: "Missing data." });
  if (!ALLOWED_PROVIDERS.has(provider)) return res.status(400).json({ error: "Unknown provider." });
  // provider_account_id is used to build https://<dc>.api.mailchimp.com, so it must be a bare datacenter code.
  if (provider === "mailchimp" && !MAILCHIMP_DC_RE.test(String(provider_account_id || ""))) {
    return res.status(400).json({ error: "Invalid Mailchimp datacenter." });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/integrations?on_conflict=user_id,provider`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    }),
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
  return res.status(200).json({ ok: true });
}

async function disconnectIntegration(req, res, user) {
  if (req.method !== "POST") return res.status(405).end();

  const { provider } = req.body || {};
  if (!ALLOWED_PROVIDERS.has(provider)) return res.status(400).json({ error: "Unknown provider." });

  await fetch(
    `${SUPABASE_URL}/rest/v1/integrations?user_id=eq.${user.id}&provider=eq.${encodeURIComponent(provider)}`,
    { method: "DELETE", headers: serviceHeaders() }
  );
  return res.status(200).json({ ok: true });
}

const ACTIONS = { list: listIntegrations, save: saveIntegration, disconnect: disconnectIntegration };

module.exports = async function (req, res) {
  const handler = ACTIONS[req.query?.action];
  if (!handler) return res.status(404).json({ error: "Unknown action." });

  const user = await verifySupabaseToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Not logged in." });

  try {
    return await handler(req, res, user);
  } catch (error) {
    console.error("integrations error:", error.message);
    return res.status(500).json({ error: "Server error." });
  }
};
