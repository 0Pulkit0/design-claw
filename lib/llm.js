// Provider-agnostic LLM client. Anything OpenAI-compatible works: OpenAI,
// Groq, Gemini's OpenAI-compat endpoint, OpenRouter, a local server, etc.
// Nothing about the provider or model is hardcoded — base URL, key, and model
// all come from the options page. This is the plan's "one call behind a thin
// interface," kept deliberately small.
//
// Chat uses POST {base}/chat/completions ; model discovery uses GET {base}/models.
// Auth is the OpenAI-standard `Authorization: Bearer <key>` header (Groq, OpenAI,
// Gemini-compat, OpenRouter all accept it), never a URL query param.

export async function getConfig() {
  const { apiBaseUrl, apiKey, model } = await chrome.storage.local.get([
    "apiBaseUrl",
    "apiKey",
    "model",
  ]);
  return {
    apiBaseUrl: apiBaseUrl || "",
    apiKey: apiKey || "",
    model: model || "",
  };
}

function normBase(base) {
  return (base || "").trim().replace(/\/+$/, "");
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function errMsg(data) {
  if (!data) return "";
  if (typeof data.error === "string") return data.error;
  return data?.error?.message || data?.message || "";
}

// GET {base}/models — validates the key and surfaces the exact IDs the key can
// use, so the user picks a model instead of memorizing a churning string.
export async function listModels(overrides = {}) {
  const cfg = { ...(await getConfig()), ...overrides };
  const base = normBase(cfg.apiBaseUrl);
  if (!base) throw new Error("Set an API base URL first.");
  const res = await fetch(`${base}/models`, { headers: authHeaders(cfg.apiKey) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`List models ${res.status}: ${errMsg(data) || res.statusText}`);
  const list = data.data || data.models || [];
  return list.map((m) => m.id || m.name).filter(Boolean).sort();
}

export async function generateText(prompt, overrides = {}) {
  const cfg = { ...(await getConfig()), ...overrides };
  const base = normBase(cfg.apiBaseUrl);
  if (!base) {
    throw new Error("No API base URL. Open Options and set one (e.g. https://api.groq.com/openai/v1).");
  }
  if (!cfg.model) {
    throw new Error("No model selected. Open Options, list models, and pick one.");
  }
  const messages = overrides.system
    ? [{ role: "system", content: overrides.system }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg.apiKey) },
    body: JSON.stringify({ model: cfg.model, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LLM ${res.status}: ${errMsg(data) || res.statusText}`);
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, raw: data };
}
