// ============================================================
// lib/groqChatClient.js
//
// Drop-in replacement for the raw `fetch(".../chat/completions")`
// calls already in api/chat.js.
//
// Fallback chain, in order:
//   1. Groq TEXT_MODEL (or Groq VISION_MODEL_CHAIN for image requests)
//   2. Gemini (gemini-3.5-flash), via lib/geminiAdapter.js
//
// Within Groq, RPM/TPM limits are per model per organization — not
// one shared budget — so qwen/qwen3.6-27b hitting its cap has NO
// effect on meta-llama/llama-4-scout-17b-16e-instruct's cap. That
// already solves "works once, fails on retry" for a single-model rate
// limit. Gemini is the layer above that: if Groq's *entire* account
// is rate-limited or having an outage, this falls through to a
// completely separate provider so Beeto still responds.
//
// Every stage only advances to the next on a 429 (rate limit) or 5xx
// (provider-side error) — a genuine 400 (bad request) or 401 (bad
// key) fails identically everywhere, so there's no point retrying
// those against a different model or provider.
// ============================================================

const { callGemini } = require("./geminiAdapter");

const TEXT_MODEL = "openai/gpt-oss-120b";

// Order matters: primary first, fallback(s) after. Add more Groq
// vision models here later if you want a longer chain.
const VISION_MODEL_CHAIN = [
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct"
];

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

async function callGroq(apiKey, model, payload) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...payload, model })
  });
  const data = await response.json();
  return { response, data };
}

// Tries every Groq model in `models` (in order), returning on the
// first success. Returns the last failed result if all of them fail.
async function tryGroqChain(apiKey, models, payload) {
  let last;
  for (const model of models) {
    const { response, data } = await callGroq(apiKey, model, payload);

    if (response.ok) {
      return { response, data, modelUsed: model };
    }

    last = { response, data, modelUsed: model };

    if (!isRetryableStatus(response.status)) {
      return last; // Not a rate-limit/outage — every model fails the same way.
    }

    console.warn(`Groq model ${model} failed (${response.status}), falling back to next model...`);
  }
  return last;
}

// `payload` is everything that currently goes in the fetch body
// EXCEPT `model` (messages, reasoning_format, response_format, tools,
// voiceTuning, etc.) — this function fills in the model(s).
//
// `geminiApiKey` is optional. Pass it (e.g. process.env.GEMINI_API_KEY)
// to enable the Gemini fallback stage; omit it to keep Groq-only
// behavior unchanged.
async function groqChatCompletion({ apiKey, usingTextModel, payload, geminiApiKey }) {
  const groqModels = usingTextModel ? [TEXT_MODEL] : VISION_MODEL_CHAIN;
  const groqResult = await tryGroqChain(apiKey, groqModels, payload);

  if (groqResult.response.ok || !isRetryableStatus(groqResult.response.status) || !geminiApiKey) {
    return groqResult;
  }

  console.warn(`All Groq models exhausted (last status ${groqResult.response.status}), falling back to Gemini...`);

  try {
    const { response, data } = await callGemini({ apiKey: geminiApiKey, payload });
    if (response.ok) {
      return { response, data, modelUsed: "gemini-3.5-flash" };
    }
    console.error("Gemini fallback also failed:", response.status, JSON.stringify(data));
    return { response, data, modelUsed: "gemini-3.5-flash" };
  } catch (err) {
    console.error("Gemini fallback threw:", err);
    return groqResult; // report the original Groq failure, not a Gemini network error
  }
}

module.exports = { groqChatCompletion, TEXT_MODEL, VISION_MODEL_CHAIN };
