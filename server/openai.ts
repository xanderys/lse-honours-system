import OpenAI from "openai";
import { ENV } from "./_core/env";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!openaiClient && ENV.openaiApiKey) {
    openaiClient = new OpenAI({
      apiKey: ENV.openaiApiKey,
    });
  }
  return openaiClient;
}

export async function chatWithPDF(params: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  pdfText: string;
  systemPrompt?: string;
}) {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error("OpenAI client not configured");
  }

  const systemMessage = params.systemPrompt || "You are a helpful study assistant.";
  const contextMessage = `Here is the content from the student's lecture PDF:\n\n${params.pdfText.slice(0, 15000)}\n\nUse this content to answer the student's questions.`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemMessage },
    { role: "system", content: contextMessage },
    ...params.messages,
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  return response.choices[0].message.content || "I couldn't generate a response.";
}

