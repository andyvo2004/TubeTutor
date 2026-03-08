import { ChatOpenAI } from "@langchain/openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable.");
  }

  return apiKey;
}

export function createOpenRouterChatModel(model = DEFAULT_OPENROUTER_MODEL) {
  return new ChatOpenAI({
    apiKey: getOpenRouterApiKey(),
    model,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
    },
  });
}

export const openRouterChatModel = createOpenRouterChatModel();
