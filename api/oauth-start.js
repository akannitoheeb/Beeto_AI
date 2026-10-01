const crypto = require("crypto");

const PROVIDERS = {
  klaviyo: {
    authUrl: "https://www.klaviyo.com/oauth/authorize",
    clientId: process.env.KLAVIYO_CLIENT_ID,
    scope: "campaigns:write lists:read lists:write"
  },
  mailchimp: {
    authUrl: "https://login.mailchimp.com/oauth2/authorize",
    clientId: process.env.MAILCHIMP_CLIENT_ID,
    scope: ""
  }
};

module.exports = async function (req, res) {
  const { provider, mode } = req.query; // mode: "login" or "connect"

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: "Unknown provider" });
  if (mode !== "login" && mode !== "connect") return res.status(400).json({ error: "Invalid mode" });

  // Only Mailchimp gives a verified account email. Klaviyo's sender email
  // can be set to anything, so Klaviyo may only be used to CONNECT.
  if (mode === "login" && provider !== "mailchimp") {
    return res.status(400).json({ error: "Login with this provider isn't supported. Log in with email, then connect it in Settings." });
  }

  const redirectUri = `${process.env.OAUTH_REDIRECT_BASE}/api/oauth-callback`;

  // Random nonce, bound to this browser via an HttpOnly cookie and checked
  // in the callback. Stops login-CSRF and forged callbacks.
  const nonce = crypto.randomBytes(24).toString("base64url");
  const state = Buffer.from(JSON.stringify({ provider, mode, nonce })).toString("base64url");
  res.setHeader("Set-Cookie", `beeto_oauth_nonce=${nonce}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state
  });
  if (cfg.scope) params.set("scope", cfg.scope);

  res.redirect(`${cfg.authUrl}?${params.toString()}`);
};
