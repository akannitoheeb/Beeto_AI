const SUPABASE_URL = "https://jouvcvrnsegzecqdkody.supabase.co";

const TOKEN_ENDPOINTS = {
  klaviyo: "https://a.klaviyo.com/oauth/token",
  mailchimp: "https://login.mailchimp.com/oauth2/token"
};

function supabaseHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`
  };
}

async function exchangeCodeForToken(provider, code, redirectUri) {
  const isKlaviyo = provider === "klaviyo";
  const clientId = isKlaviyo ? process.env.KLAVIYO_CLIENT_ID : process.env.MAILCHIMP_CLIENT_ID;
  const clientSecret = isKlaviyo ? process.env.KLAVIYO_CLIENT_SECRET : process.env.MAILCHIMP_CLIENT_SECRET;

  const response = await fetch(TOKEN_ENDPOINTS[provider], {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Mailchimp's metadata endpoint returns the real account owner's login
// email — this is what makes "Continue with Mailchimp" a genuine login.
async function getMailchimpIdentity(accessToken) {
  const response = await fetch("https://login.mailchimp.com/oauth2/metadata", {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  if (!response.ok) throw new Error("Could not read Mailchimp account info.");
  const data = await response.json();
  const dc = typeof data.dc === "string" && /^[a-z]{2}\d+$/i.test(data.dc) ? data.dc : null;
  return {
    email: data.login?.email || null,
    dc
  };
}

// Klaviyo has no per-user "who am I" endpoint tied to OAuth — this reads
// the account's default sender email as a best-effort identity. It is
// NOT guaranteed to be the actual logged-in person, only the account's
// marketing sender, so this is used with a confirmation step client-side.
async function getKlaviyoIdentity(accessToken) {
  const response = await fetch("https://a.klaviyo.com/api/accounts/", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      revision: "2024-10-15"
    }
  });
  if (!response.ok) throw new Error("Could not read Klaviyo account info.");
  const data = await response.json();
  const attrs = data?.data?.[0]?.attributes;
  return {
    email: attrs?.contact_information?.default_sender_email || null,
    dc: null
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

module.exports = async function (req, res) {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state.");

  let provider, mode, nonce;
  try {
    ({ provider, mode, nonce } = JSON.parse(Buffer.from(state, "base64url").toString()));
  } catch {
    return res.status(400).send("Invalid state.");
  }

  // CSRF protection: the nonce in state must match the cookie set by oauth-start.
  const cookieNonce = readCookie(req, "beeto_oauth_nonce");
  res.setHeader("Set-Cookie", "beeto_oauth_nonce=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  if (!nonce || !cookieNonce || nonce !== cookieNonce) {
    return res.status(400).send("Invalid or expired login attempt. Please start again.");
  }
  if (!TOKEN_ENDPOINTS[provider] || (mode !== "login" && mode !== "connect")) {
    return res.status(400).send("Invalid state.");
  }
  // Klaviyo's sender email is not a verified identity: never allow it to log in.
  if (mode === "login" && provider !== "mailchimp") {
    return res.redirect(`${process.env.OAUTH_REDIRECT_BASE}/oauth-finish.html#error=login_not_supported&provider=${provider}`);
  }

  const redirectUri = `${process.env.OAUTH_REDIRECT_BASE}/api/oauth-callback`;

  try {
    const tokenData = await exchangeCodeForToken(provider, code, redirectUri);
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    let identity = { email: null, dc: null };
    if (provider === "mailchimp") {
      identity = await getMailchimpIdentity(tokenData.access_token);
    } else if (provider === "klaviyo") {
      identity = await getKlaviyoIdentity(tokenData.access_token);
    }

    if (mode === "login") {
      if (!identity.email) {
        return res.redirect(`${process.env.OAUTH_REDIRECT_BASE}/oauth-finish.html#error=no_email&provider=${provider}`);
      }

      // Find-or-create the Supabase user by email, then generate a
      // magic-link token the browser can redeem to actually log in.
      // generate_link below creates the user if missing, so we only need to
      // make sure the email is confirmed; no list lookup required.
      let userExists = false;

      if (!userExists) {
        const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: "POST",
          headers: supabaseHeaders(),
          body: JSON.stringify({ email: identity.email, email_confirm: true })
        });
        // 422 = user already exists, which is fine: we just want a login link.
        if (!createRes.ok && createRes.status !== 422) throw new Error("Could not create account.");
      }

      const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: supabaseHeaders(),
        body: JSON.stringify({ type: "magiclink", email: identity.email })
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) throw new Error("Could not generate login link.");

      const payload = Buffer.from(JSON.stringify({
        mode: "login",
        provider,
        email: identity.email,
        token_hash: linkData.hashed_token || linkData.properties?.hashed_token,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        provider_account_id: identity.dc,
        needs_confirm: false
      })).toString("base64url");

      return res.redirect(`${process.env.OAUTH_REDIRECT_BASE}/oauth-finish.html#data=${payload}`);
    }

    // connect mode — same as before
    const payload = Buffer.from(JSON.stringify({
      mode: "connect",
      provider,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
      provider_account_id: identity.dc
    })).toString("base64url");

    res.redirect(`${process.env.OAUTH_REDIRECT_BASE}/oauth-finish.html#data=${payload}`);
  } catch (error) {
    console.error("OAuth callback failed:", error.message);
    res.status(500).send("Something went wrong connecting your account.");
  }
};
