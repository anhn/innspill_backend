process.env.NODE_ENV = "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "test-session-secret-at-least-32-chars-long";
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-key";
process.env.MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jest-no-connect";
