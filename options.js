import { listModels, getConfig } from "./lib/llm.js";

const $ = (id) => document.getElementById(id);

// Presets fill the base URL only — the model stays whatever the user lists/picks.
const PRESETS = [
  ["OpenAI", "https://api.openai.com/v1"],
  ["Groq", "https://api.groq.com/openai/v1"],
  ["Gemini (compat)", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["Together", "https://api.together.xyz/v1"],
  ["Local :11434", "http://localhost:11434/v1"],
];

function msg(text, ok) {
  const el = $("msg");
  el.textContent = text;
  el.dataset.ok = ok ? "1" : "0";
}

function renderPresets() {
  for (const [label, url] of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = url;
    b.addEventListener("click", () => { $("base").value = url; });
    $("presets").appendChild(b);
  }
}

// Endpoints are user-configurable, so we can't declare them in the manifest.
// Request the specific origin at runtime (this click is the required gesture),
// holding permission only for the provider actually in use.
async function ensureHostPermission(base) {
  let pattern;
  try {
    const u = new URL(base);
    pattern = `${u.protocol}//${u.hostname}/*`; // no port — match patterns reject ports (covers all ports on the host)
  } catch { return false; }
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return await chrome.permissions.request({ origins: [pattern] });
}

async function load() {
  const { apiBaseUrl, apiKey, model } = await getConfig();
  $("base").value = apiBaseUrl;
  $("key").value = apiKey;
  $("model").value = model;
}

$("toggle").addEventListener("click", () => {
  const k = $("key");
  k.type = k.type === "password" ? "text" : "password";
  $("toggle").textContent = k.type === "password" ? "Show" : "Hide";
});

$("save").addEventListener("click", async () => {
  const apiBaseUrl = $("base").value.trim().replace(/\/+$/, "");
  const apiKey = $("key").value.trim();
  const model = $("model").value.trim();
  if (!apiBaseUrl) return msg("Set an API base URL (e.g. https://api.groq.com/openai/v1).", false);
  await chrome.storage.local.set({ apiBaseUrl, apiKey, model });
  const granted = await ensureHostPermission(apiBaseUrl);
  if (granted) msg(`Saved. Host access granted for ${new URL(apiBaseUrl).host}.`, true);
  else msg("Saved, but host access was denied — requests will be blocked. Click Save again and allow the prompt.", false);
});

$("list").addEventListener("click", async () => {
  const apiBaseUrl = $("base").value.trim().replace(/\/+$/, "");
  const apiKey = $("key").value.trim();
  if (!apiBaseUrl) return msg("Set an API base URL first.", false);
  if (!(await ensureHostPermission(apiBaseUrl))) {
    return msg("Host access denied — can't reach the endpoint. Allow the permission prompt.", false);
  }
  msg("Validating…", true);
  $("models").innerHTML = "";
  try {
    const ids = await listModels({ apiBaseUrl, apiKey });
    msg(`Key works. ${ids.length} models available — click one to select it.`, true);
    for (const id of ids) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = id;
      b.addEventListener("click", async () => {
        $("model").value = id;
        await chrome.storage.local.set({ apiBaseUrl, apiKey, model: id });
        msg(`Model set to ${id} and saved.`, true);
      });
      li.appendChild(b);
      $("models").appendChild(li);
    }
  } catch (e) {
    msg(e.message, false);
  }
});

renderPresets();
load();
