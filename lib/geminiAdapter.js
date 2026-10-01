// ============================================================
// lib/geminiAdapter.js
//
// Gemini's API isn't OpenAI-compatible, so this file exists purely
// to translate both directions:
//   - OpenAI/Groq-style `messages` + `response_format` (JSON schema)
//     -> Gemini's `contents` + `systemInstruction` + `generationConfig`
//   - Gemini's response
//     -> an OpenAI-shaped `{ choices: [{ message: { content } }] }`
//      object, so callers (groqChatClient.js, api/chat.js) don't need
//      to know Gemini was involved at all.
//
// Model: gemini-3.5-flash handles both text and vision in one model,
// so there's no separate "vision model" concept here the way there
// is on the Groq side.
//
// Known limitation: function/tool calling (the send_email tool) is
// NOT translated. If a request includes `tools`, this adapter drops
// them and Gemini will just answer in plain text instead of calling
// a tool. That only matters for the rare case where Groq's entire
// account is down or fully rate-limited while a user is mid tool-call
// — normal chat/campaign/sequence/vision generation is unaffected.
// ============================================================

const GEMINI_MODEL = "gemini-3.5-flash";

function dataUrlToInlineData(url) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url || "");
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

// OpenAI message `content` is either a plain string or an array of
// parts ({type:"text",...} / {type:"image_url",...}). Gemini wants an
// array of `parts` ({text:...} / {inlineData:...}) either way.
function convertContentToParts(content) {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  if (!Array.isArray(content)) return [{ text: "" }];

  const parts = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ text: part.text || "" });
    } else if (part.type === "image_url") {
      const inlineData = dataUrlToInlineData(part.image_url?.url);
      if (inlineData) {
        parts.push({ inlineData });
      } else {
        // A remote (non-data:) image URL — Gemini's generateContent
        // can't fetch arbitrary URLs the way Groq/OpenAI-style APIs
        // can, so note it in text rather than silently dropping it.
        parts.push({ text: "[image omitted: not a base64 data URL]" });
      }
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

// OpenAI messages -> Gemini { systemInstruction, contents }
function convertMessages(messages) {
  let systemInstruction;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: typeof msg.content === "string" ? msg.content : "" }] };
      continue;
    }
    if (msg.role === "tool") {
      // No function-calling translation (see file header) — fold the
      // tool result into a plain user-visible note so the model at
      // least has the context, instead of dropping it silently.
      contents.push({ role: "user", parts: [{ text: `[Result of a prior action: ${msg.content}]` }] });
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: convertContentToParts(msg.content) });
  }

  return { systemInstruction, contents };
}

// OpenAI JSON Schema (lowercase types: object/string/array/integer/
// boolean/number) -> Gemini's schema format (uppercase type enum).
// Drops fields Gemini doesn't support (additionalProperties, strict,
// minItems/maxItems) rather than erroring on them.
function convertSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;

  const out = {};
  if (schema.type) out.type = schema.type.toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;

  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = convertSchema(value);
    }
  }
  if (schema.items) out.items = convertSchema(schema.items);
  if (schema.required) out.required = schema.required;

  return out;
}

// OpenAI-style `payload` (messages, response_format, max_completion_tokens
// via voiceTuning, tools — tools ignored, see header) -> a Gemini
// generateContent request body.
function buildGeminiRequestBody(payload) {
  const { systemInstruction, contents } = convertMessages(payload.messages || []);

  const generationConfig = {};
  if (payload.max_completion_tokens) {
    generationConfig.maxOutputTokens = payload.max_completion_tokens;
  }
  if (payload.response_format?.type === "json_schema") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = convertSchema(payload.response_format.json_schema?.schema);
  }

  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  };
}

// Gemini response -> OpenAI-shaped `{ choices: [{ message }] }` so
// existing code that reads `data.choices[0].message.content` doesn't
// need to change.
function toOpenAiShape(geminiData) {
  const text = geminiData?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("") || "";

  return {
    choices: [
      { message: { role: "assistant", content: text } }
    ]
  };
}

async function callGemini({ apiKey, payload }) {
  const body = buildGeminiRequestBody(payload);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body)
    }
  );

  const raw = await response.json();

  if (!response.ok) {
    // Surface Gemini's real error rather than a blank object, so
    // logs show what actually went wrong.
    return { response, data: { error: raw?.error || raw } };
  }

  return { response, data: toOpenAiShape(raw) };
}

module.exports = { callGemini, GEMINI_MODEL };
