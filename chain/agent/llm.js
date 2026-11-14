// Talks to the language model through Groq's OpenAI-compatible API.

const { describeError, isConnectionError } = require("./errors");
const { requestText } = require("./http");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Which model to use when the configured one is not offered to this key.
// Model line-ups differ between accounts and change over time.
const PREFERRED = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "llama-3.1-8b-instant",
];

/** The configured model if this key can use it, otherwise the best one it can. Null if none. */
function chooseModel(configured, available) {
  if (available.includes(configured)) return configured;
  return PREFERRED.find((id) => available.includes(id)) || null;
}

function createGroq({ apiKey, model, baseUrl = "https://api.groq.com/openai/v1", timeoutMs = 90000, retryDelays = [1000, 3000] }) {
  if (!apiKey) throw new Error("GROQ_API_KEY is empty. Fill it in the .env file.");

  async function request(path, init = {}) {
    let res = null;
    let failure = null;
    for (let attempt = 0; attempt <= retryDelays.length && !res; attempt++) {
      try {
        res = await requestText(`${baseUrl}${path}`, {
          method: init.method || "GET",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: init.body || null,
          timeoutMs,
        });
      } catch (cause) {
        failure = cause;
        if (!isConnectionError(cause)) break;
        if (attempt < retryDelays.length) await sleep(retryDelays[attempt]);
      }
    }
    if (!res) {
      const error = new Error(`Could not reach the language model: ${describeError(failure)}`);
      error.transient = true;
      throw error;
    }
    if (res.status < 200 || res.status >= 300) {
      const error = new Error(
        res.status === 429
          ? "The language model's limit for this key is reached for the moment. Wait a minute, then try again."
          : `The language model answered ${res.status}: ${res.text.slice(0, 300)}`
      );
      error.status = res.status;
      error.transient = res.status === 429 || res.status >= 500;
      throw error;
    }
    try {
      return JSON.parse(res.text);
    } catch {
      const error = new Error("The language model sent an answer that is not JSON.");
      error.transient = true;
      throw error;
    }
  }

  async function chat(messages, plain) {
    const body = { model: llm.model, messages, temperature: 0, max_completion_tokens: 3000 };
    if (!plain) {
      body.response_format = { type: "json_object" };
      // These models think before answering. Keep that short and out of the reply.
      if (llm.model.startsWith("openai/gpt-oss")) {
        body.reasoning_effort = "low";
        body.include_reasoning = false;
      }
    }
    const data = await request("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    return data?.choices?.[0]?.message?.content ?? "";
  }

  const llm = {
    model,

    /** Sends the messages and returns the model's text reply. */
    async complete(messages) {
      try {
        return await chat(messages, false);
      } catch (error) {
        // A 400 means the model refused an option or wrote broken JSON.
        // Ask again with the plainest possible request and let the parser deal with the reply.
        if (error.status === 400) return chat(messages, true);
        throw error;
      }
    },

    /** IDs of the models this key can use. */
    async listModels() {
      const data = await request("/models");
      return (data?.data || []).map((m) => m.id).sort();
    },

    /**
     * Makes sure the model in use is one this key is offered.
     * Returns { model, replaced } where `replaced` is the unavailable model, or null.
     */
    async ready() {
      const available = await llm.listModels();
      const chosen = chooseModel(llm.model, available);
      if (!chosen) {
        throw new Error(
          `The model "${llm.model}" is not available to this key, and none of the usual ones is either.\n` +
            `Set GROQ_MODEL in .env to one of: ${available.join(", ")}`
        );
      }
      const replaced = chosen === llm.model ? null : llm.model;
      llm.model = chosen;
      return { model: chosen, replaced };
    },
  };
  return llm;
}

module.exports = { createGroq, chooseModel };
