module.exports = async function (req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const result = {
    ok: true,
    node: process.version,
    runtime: process.env.VERCEL ? "vercel" : "unknown",
    env: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      supabaseService: Boolean(process.env.SUPABASE_SERVICE_KEY)
    },
    modules: {},
    supabase: {}
  };

  try {
    require("../lib/groqChatClient");
    result.modules.groqChatClient = "ok";
  } catch (error) {
    result.ok = false;
    result.modules.groqChatClient = "error";
    result.modules.groqChatClientError = error?.message || String(error);
  }

  try {
    require("../lib/geminiAdapter");
    result.modules.geminiAdapter = "ok";
  } catch (error) {
    result.ok = false;
    result.modules.geminiAdapter = "error";
    result.modules.geminiAdapterError = error?.message || String(error);
  }

  try {
    const supabaseUrl =
      process.env.SUPABASE_URL || "https://jouvcvrnsegzecqdkody.supabase.co";

    const response = await fetch(`${supabaseUrl}/auth/v1/settings`);
    result.supabase = {
      reachable: true,
      status: response.status,
      ok: response.ok
    };
  } catch (error) {
    result.ok = false;
    result.supabase = {
      reachable: false,
      error: error?.message || String(error)
    };
  }

  return res.status(result.ok ? 200 : 500).json(result);
};
