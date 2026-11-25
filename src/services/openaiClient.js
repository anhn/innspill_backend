const OpenAI = require("openai");
const { createClaudeClient, claudeApiKey, resolveClaudeModel } = require("./claudeClient");

let sharedClient;
let sharedProvider;

/**
 * LLM_PROVIDER=claude uses CLAUDE_API. LLM_PROVIDER=openai keeps the OpenAI client
 * (the system-test mock). When the variable is unset, a Claude key selects Claude.
 */
function llmProvider() {
  const explicit = String(process.env.LLM_PROVIDER || "").toLowerCase();
  if (explicit === "claude" || explicit === "anthropic") return "claude";
  if (explicit === "openai") return "openai";
  if (claudeApiKey()) return "claude";
  return "openai";
}

function llmConfigured() {
  return llmProvider() === "claude" ? Boolean(claudeApiKey()) : Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Shared chat client for routes and agents.
 * Embeddings stay on OpenAI: Claude has no embeddings API.
 */
function getOpenAIClient() {
  const provider = llmProvider();
  if (sharedClient && sharedProvider === provider) return sharedClient;
  if (provider === "claude") {
    sharedClient = createClaudeClient();
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      });
      sharedClient.embeddings = openai.embeddings;
    }
  } else {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    sharedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  sharedProvider = provider;
  return sharedClient;
}

function defaultChatModel() {
  if (llmProvider() === "claude") return resolveClaudeModel();
  return process.env.OPENAI_CHAT_MODEL || process.env.FEEDBACK_MODEL || "gpt-4o-mini";
}

/**
 * Parse JSON from model text that may include markdown fences (legacy behaviour).
 */
function parseJsonFromModel(text) {
  let jsonText = String(text || "")
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return JSON.parse(jsonText);
}

module.exports = { getOpenAIClient, defaultChatModel, parseJsonFromModel, llmProvider, llmConfigured };