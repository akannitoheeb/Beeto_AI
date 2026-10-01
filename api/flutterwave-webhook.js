// ============================================================
// /api/flutterwave-webhook
//
// Flutterwave calls this whenever a payment completes. We verify the
// signature, re-verify the transaction with Flutterwave's API, and only
// then grant Pro, and ONLY for genuine Pro subscription payments:
//   - tx_ref must start with "beeto-pro-" (support/donation payments
//     use "beeto-support-" and never grant Pro)
//   - meta.type must not be "support"
//   - currency and amount must match the Pro plan price
//
// Env vars: FLW_SECRET_KEY, FLW_WEBHOOK_HASH, SUPABASE_SERVICE_KEY
// ============================================================
const SUPABASE_URL = "https://jouvcvrnsegzecqdkody.supabase.co";

const PRO_PRICES = { NGN: 8000, USD: 9 };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function supabaseHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Prefer": "resolution=merge-duplicates"
  };
}

// Recurring charges may arrive without meta, so fall back to the
// user id embedded in tx_ref ("beeto-pro-<uuid>-<timestamp>").
function extractUserId(tx) {
  const fromMeta = tx.meta?.user_id;
  if (typeof fromMeta === "string" && UUID_RE.test(fromMeta)) return fromMeta.match(UUID_RE)[0];
  const m = String(tx.tx_ref || "").match(UUID_RE);
  return m ? m[0] : null;
}

module.exports = async function (req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const signature = req.headers["verif-hash"];
  if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
    console.error("Webhook: signature mismatch or missing FLW_WEBHOOK_HASH");
    return res.status(401).end();
  }

  try {
    const event = req.body || {};
    // Supports both payload shapes Flutterwave uses (flat or wrapped in data).
    const status = event.status || event.data?.status;
    const txId = event.id || event.data?.id;

    if (status !== "successful" || !txId) {
      return res.status(200).json({ received: true, ignored: true });
    }

    // Never trust the webhook body: verify directly with Flutterwave.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(txId)}/verify`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();
    const tx = verifyData.data;

    if (!tx || tx.status !== "successful") {
      console.error("Webhook: verify did not return a successful transaction", txId);
      return res.status(200).json({ received: true });
    }

    const txRef = String(tx.tx_ref || "");
    if (!txRef.startsWith("beeto-pro-") || tx.meta?.type === "support") {
      console.log("Webhook: not a Pro subscription payment, ignored:", txRef.slice(0, 20));
      return res.status(200).json({ received: true });
    }

    const expected = PRO_PRICES[tx.currency];
    if (!expected || Number(tx.amount) < expected) {
      console.error("Webhook: amount/currency mismatch", tx.currency, tx.amount);
      return res.status(200).json({ received: true });
    }

    const userId = extractUserId(tx);
    if (!userId) {
      console.error("Webhook: no user id found for tx", txId);
      return res.status(200).json({ received: true });
    }

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        user_id: userId,
        plan: "pro",
        status: "active",
        currency: tx.currency,
        tx_ref: tx.tx_ref,
        current_period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!upsertRes.ok) {
      console.error("Webhook: Supabase upsert FAILED", upsertRes.status, await upsertRes.text());
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.status(200).json({ received: true });
  }
};
